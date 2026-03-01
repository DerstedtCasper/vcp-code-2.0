/* eslint no-misleading-character-class: 0 */
// novacode_change: this file was pulled from Cline and adjusted for us

import { getAllModes } from "@roo/modes"
import { getBasename } from "./nova/path-webview"
import { Fzf } from "@/lib/word-boundary-fzf" // novacode_change
import { ClineRulesToggles } from "@roo/cline-rules"
import { McpServer, SkillSettings, getDefaultSkillSettings } from "@roo-code/types"

export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom" | "mcp" | "skill"
}

type SkillItem = {
	name: string
	description: string
	source: "global" | "project"
	mode?: string
}

function toSlashSafeSegment(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9_.-]/g, "-")
}

// Create a function to get all supported slash commands
export function getSupportedSlashCommands(
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	mcpServers: McpServer[] = [],
	skills: SkillItem[] = [],
	skillSettings: SkillSettings = getDefaultSkillSettings(),
): SlashCommand[] {
	// Start with non-mode commands
	const baseCommands: SlashCommand[] = [
		{
			name: "newtask",
			description: "Create a new task with context from the current task",
		},
		{
			name: "newrule",
			description: "Create a new Nova rule with context from your conversation",
		},
		{ name: "reportbug", description: "Create a NovaCode GitHub issue" },
		// novacode_change start
		{ name: "init", description: "Initialize Nova Code for this workspace" },
		{ name: "smol", description: "Condenses your current context window" },
		{ name: "condense", description: "Condenses your current context window" },
		{ name: "compact", description: "Condenses your current context window" },
		{ name: "session", description: "Session management <fork|share|show>" },
		{ name: "mcp", description: "Guide model to use MCP tools (supports /mcp.<server>.<tool>)" },
		{ name: "skill", description: "Guide model to use skills (supports /skill.<name>)" },
		{
			name: "skill.find-skills",
			description: "Use the find-skills helper to discover installable skills",
			section: "skill",
		},
		{
			name: "skill.skill-installer",
			description: "Use the skill-installer helper to install a skill package",
			section: "skill",
		},
		{
			name: "skill.skill-creator",
			description: "Use the skill-creator helper to scaffold or update a skill",
			section: "skill",
		},
		// novacode_change end
	]

	// Add mode-switching commands dynamically
	const modeCommands = getAllModes(customModes).map((mode) => ({
		name: mode.slug,
		description: `Switch to ${mode.name.replace(/^[💻🏗️❓🪲🪃]+ /, "")} mode`,
	}))

	// add workflow commands
	const workflowCommands = getWorkflowCommands(localWorkflowToggles, globalWorkflowToggles)

	const mcpCommands: SlashCommand[] = mcpServers.flatMap((server) => {
		const serverName = toSlashSafeSegment(server.name)
		if (!serverName) {
			return []
		}
		const serverCommands: SlashCommand[] = [
			{
				name: `mcp.${serverName}`,
				description: `Use MCP server ${server.name}`,
				section: "mcp",
			},
		]
		for (const tool of server.tools ?? []) {
			const toolName = toSlashSafeSegment(tool.name)
			if (!toolName) {
				continue
			}
			serverCommands.push({
				name: `mcp.${serverName}.${toolName}`,
				description: tool.description || `Use ${server.name} / ${tool.name}`,
				section: "mcp",
			})
		}
		return serverCommands
	})

	const disabledSkills = new Set((skillSettings.disabledSkills ?? []).map((name) => name.toLowerCase()))
	const skillCommands: SlashCommand[] =
		skillSettings.enabled && skillSettings.exposeInSlashCommands
			? skills
					.filter((skill) => !disabledSkills.has(skill.name.toLowerCase()))
					.map((skill) => ({
						name: `skill.${toSlashSafeSegment(skill.name)}`,
						description: skill.description,
						section: "skill",
					}))
			: []

	const unique = new Map<string, SlashCommand>()
	for (const command of [...baseCommands, ...modeCommands, ...workflowCommands, ...mcpCommands, ...skillCommands]) {
		if (!unique.has(command.name)) {
			unique.set(command.name, command)
		}
	}
	return Array.from(unique.values())
}

// Export a default instance for backward compatibility
export const SUPPORTED_SLASH_COMMANDS = getSupportedSlashCommands()

// Regex for detecting slash commands in text
export const slashCommandRegex = /\/([a-zA-Z0-9_.-]+)(\s|$)/
export const slashCommandRegexGlobal = new RegExp(slashCommandRegex.source, "g")

/**
 * Determines whether the slash command menu should be displayed based on text input
 */
// novacode_change start: Added workflow toggles parameters
export function shouldShowSlashCommandsMenu(
	text: string,
	cursorPosition: number,
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	mcpServers: McpServer[] = [],
	skills: SkillItem[] = [],
	skillSettings: SkillSettings = getDefaultSkillSettings(),
): boolean {
	// novacode_change end
	const beforeCursor = text.slice(0, cursorPosition)

	// first check if there is a slash before the cursor
	const slashIndex = beforeCursor.lastIndexOf("/")

	if (slashIndex === -1) {
		return false
	}

	// check if slash is at the very beginning (with optional whitespace)
	const textBeforeSlash = beforeCursor.slice(0, slashIndex)
	if (!/^\s*$/.test(textBeforeSlash)) {
		return false
	}

	// potential partial or full command
	const textAfterSlash = beforeCursor.slice(slashIndex + 1)

	// don't show menu if there's whitespace after the slash but before the cursor
	if (/\s/.test(textAfterSlash)) {
		return false
	}

	// novacode_change start: If there are no matching commands for the current query, don't show the menu.
	// This prevents an empty menu from capturing Enter/Tab and blocking message submission.
	const matches = getMatchingSlashCommands(
		textAfterSlash,
		customModes,
		localWorkflowToggles,
		globalWorkflowToggles,
		mcpServers,
		skills,
		skillSettings,
	)
	return matches.length > 0
	// novacode_change end
}

function enabledWorkflowToggles(workflowToggles: ClineRulesToggles): SlashCommand[] {
	return Object.entries(workflowToggles)
		.filter(([_, enabled]) => enabled)
		.map(([filePath, _]) => ({
			name: getBasename(filePath),
			section: "custom",
		}))
}

export function getWorkflowCommands(
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
): SlashCommand[] {
	return [...enabledWorkflowToggles(localWorkflowToggles), ...enabledWorkflowToggles(globalWorkflowToggles)]
}

/**
 * Gets filtered slash commands that match the current input
 */
export function getMatchingSlashCommands(
	query: string,
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	mcpServers: McpServer[] = [],
	skills: SkillItem[] = [],
	skillSettings: SkillSettings = getDefaultSkillSettings(),
): SlashCommand[] {
	const commands = getSupportedSlashCommands(
		customModes,
		localWorkflowToggles,
		globalWorkflowToggles,
		mcpServers,
		skills,
		skillSettings,
	)

	if (!query) {
		return [...commands]
	}

	// novacode_change start: Use Fzf for case-insensitive word-boundary fuzzy matching
	const fzf = new Fzf(commands, {
		selector: (cmd: SlashCommand) => cmd.name,
	})
	return fzf.find(query).map((result) => result.item)
	// novacode_change end: Use Fzf for case-insensitive word-boundary fuzzy matching
}

/**
 * Insert a slash command at position or replace partial command
 */
export function insertSlashCommand(text: string, commandName: string): { newValue: string; commandIndex: number } {
	const slashIndex = text.indexOf("/")

	// where the command ends, at the end of entire text or first space
	const commandEndIndex = text.indexOf(" ", slashIndex)

	// replace the partial command with the full command
	const newValue =
		text.substring(0, slashIndex + 1) + commandName + (commandEndIndex > -1 ? text.substring(commandEndIndex) : " ") // add extra space at the end if only slash command

	return { newValue, commandIndex: slashIndex }
}

/**
 * Determines the validation state of a slash command
 * Returns partial if we have a fuzzy match against valid commands, or full for exact match
 */
export function validateSlashCommand(
	command: string,
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	mcpServers: McpServer[] = [],
	skills: SkillItem[] = [],
	skillSettings: SkillSettings = getDefaultSkillSettings(),
): "full" | "partial" | null {
	if (!command) {
		return null
	}

	const commands = getSupportedSlashCommands(
		customModes,
		localWorkflowToggles,
		globalWorkflowToggles,
		mcpServers,
		skills,
		skillSettings,
	)

	// Check for exact match (command name equals query, case-insensitive via FZF)
	const lowerCommand = command.toLowerCase()
	const exactMatch = commands.some((cmd) => cmd.name.toLowerCase() === lowerCommand)
	if (exactMatch) {
		return "full"
	}

	// novacode_change start: Use FZF for consistent fuzzy matching with getMatchingSlashCommands
	const fzf = new Fzf(commands, {
		selector: (cmd: SlashCommand) => cmd.name,
	})
	const results = fzf.find(command)
	if (results.length > 0) {
		return "partial"
	}
	// novacode_change end: Use FZF for consistent fuzzy matching with getMatchingSlashCommands

	return null // no match
}

import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import matter from "gray-matter"

import type { ClineProvider } from "../../core/webview/ClineProvider"
import { getGlobalRooDirectory } from "../roo-config"
import { directoryExists, fileExists } from "../roo-config"
import { SkillMetadata, SkillContent } from "../../shared/skills"
import { modes, getAllModes } from "../../shared/modes"
import { ConfigChangeNotifier } from "../config/ConfigChangeNotifier" // novacode_change
import type { SkillSettings, VcpDistributedSkillRegistration } from "@roo-code/types"

// Re-export for convenience
export type { SkillMetadata, SkillContent }

export class SkillsManager {
	private skills: Map<string, SkillMetadata> = new Map()
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private isDisposed = false
	private configChangeNotifier: ConfigChangeNotifier // novacode_change

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.configChangeNotifier = new ConfigChangeNotifier(provider) // novacode_change
	}

	async initialize(): Promise<void> {
		await this.discoverSkills()
		await this.setupFileWatchers()
	}

	/**
	 * Discover all skills from global and project directories.
	 * Supports both generic skills (skills/) and mode-specific skills (skills-{mode}/).
	 * Also supports symlinks:
	 * - .novacode/skills can be a symlink to a directory containing skill subdirectories
	 * - .novacode/skills/[dirname] can be a symlink to a skill directory
	 */
	async discoverSkills(): Promise<void> {
		this.skills.clear()
		const skillsDirs = await this.getSkillsDirectories()

		for (const { dir, source, mode } of skillsDirs) {
			await this.scanSkillsDirectory(dir, source, mode)
		}

		const currentSkills = Array.from(this.skills.values()) // novacode_change
		await this.configChangeNotifier.notifyIfChanged("skill", currentSkills) // novacode_change
	}

	/**
	 * Scan a skills directory for skill subdirectories.
	 * Handles two symlink cases:
	 * 1. The skills directory itself is a symlink (resolved by directoryExists using realpath)
	 * 2. Individual skill subdirectories are symlinks
	 */
	private async scanSkillsDirectory(dirPath: string, source: "global" | "project", mode?: string): Promise<void> {
		if (!(await directoryExists(dirPath))) {
			return
		}

		try {
			// Get the real path (resolves if dirPath is a symlink)
			// If the symlink is broken, this will throw ENOENT // novacode_change
			const realDirPath = await fs.realpath(dirPath)

			// Read directory entries
			const entries = await fs.readdir(realDirPath)

			for (const entryName of entries) {
				const entryPath = path.join(realDirPath, entryName)

				// Check if this entry is a directory (follows symlinks automatically)
				const stats = await fs.stat(entryPath).catch(() => null)
				if (!stats?.isDirectory()) continue

				// Load skill metadata - the skill name comes from the entry name (symlink name if symlinked)
				await this.loadSkillMetadata(entryPath, source, mode, entryName)
			}
			// novacode_change start: Handle symlink-related errors gracefully
		} catch (error: any) {
			// Handle symlink-related errors gracefully:
			// - ENOENT: Directory/symlink target doesn't exist
			// - ELOOP: Too many symbolic links encountered
			// - ENOTCONN: Network drive not connected (for symlinks to network paths)
			if (error.code === "ENOENT" || error.code === "ELOOP" || error.code === "ENOTCONN") {
				// Silently ignore - this is expected for broken symlinks or unavailable network drives
				return
			}
			// Log other unexpected errors for debugging
			console.error(`Error scanning skills directory ${dirPath}:`, error)
		}
		// novacode_change end
	}

	/**
	 * Load skill metadata from a skill directory.
	 * @param skillDir - The resolved path to the skill directory (target of symlink if symlinked)
	 * @param source - Whether this is a global or project skill
	 * @param mode - The mode this skill is specific to (undefined for generic skills)
	 * @param skillName - The skill name (from symlink name if symlinked, otherwise from directory name)
	 */
	private async loadSkillMetadata(
		skillDir: string,
		source: "global" | "project",
		mode?: string,
		skillName?: string,
	): Promise<void> {
		const skillMdPath = path.join(skillDir, "SKILL.md")
		if (!(await fileExists(skillMdPath))) return

		try {
			const fileContent = await fs.readFile(skillMdPath, "utf-8")

			// Use gray-matter to parse frontmatter
			const { data: frontmatter, content: body } = matter(fileContent)

			// Validate required fields (only name and description for now)
			if (!frontmatter.name || typeof frontmatter.name !== "string") {
				console.error(`Skill at ${skillDir} is missing required 'name' field`)
				return
			}
			if (!frontmatter.description || typeof frontmatter.description !== "string") {
				console.error(`Skill at ${skillDir} is missing required 'description' field`)
				return
			}

			// Treat frontmatter name as the canonical skill id so symlinked/legacy directory names
			// can still be registered into VCP runtime and preinstalled manifests.
			const discoveredSkillName = skillName || path.basename(skillDir)
			const effectiveSkillName = frontmatter.name.trim()
			if (effectiveSkillName !== discoveredSkillName) {
				console.warn(
					`Skill canonical name "${effectiveSkillName}" doesn't match directory "${discoveredSkillName}", using canonical name.`,
				)
			}

			// Strict spec validation (https://agentskills.io/specification)
			// Name constraints:
			// - 1-64 chars
			// - lowercase letters/numbers/hyphens only
			// - must not start/end with hyphen
			// - must not contain consecutive hyphens
			if (effectiveSkillName.length < 1 || effectiveSkillName.length > 64) {
				console.error(
					`Skill name "${effectiveSkillName}" is invalid: name must be 1-64 characters (got ${effectiveSkillName.length})`,
				)
				return
			}
			const nameFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
			if (!nameFormat.test(effectiveSkillName)) {
				console.error(
					`Skill name "${effectiveSkillName}" is invalid: must be lowercase letters/numbers/hyphens only (no leading/trailing hyphen, no consecutive hyphens)`,
				)
				return
			}

			// Description constraints:
			// - 1-1024 chars
			// - non-empty (after trimming)
			const description = frontmatter.description.trim()
			if (description.length < 1 || description.length > 1024) {
				console.error(
					`Skill "${effectiveSkillName}" has an invalid description length: must be 1-1024 characters (got ${description.length})`,
				)
				return
			}

			// Create unique key combining canonical name, source, and mode for override resolution.
			const skillKey = this.getSkillKey(effectiveSkillName, source, mode)

			this.skills.set(skillKey, {
				name: effectiveSkillName,
				description,
				path: skillMdPath,
				source,
				mode, // undefined for generic skills, string for mode-specific
			})
		} catch (error) {
			console.error(`Failed to load skill at ${skillDir}:`, error)
		}
	}

	/**
	 * Get skills available for the current mode.
	 * Resolves overrides: project > global, mode-specific > generic.
	 *
	 * @param currentMode - The current mode slug (e.g., 'code', 'architect')
	 */
	getSkillsForMode(currentMode: string, skillSettings?: SkillSettings): SkillMetadata[] {
		if (skillSettings?.enabled === false) {
			return []
		}

		const disabledSkills = new Set((skillSettings?.disabledSkills ?? []).map((name) => name.trim().toLowerCase()))
		const sourcePreference = skillSettings?.sourcePreference ?? "project-first"
		const resolvedSkills = new Map<string, SkillMetadata>()

		for (const skill of this.skills.values()) {
			// Skip mode-specific skills that don't match current mode
			if (skill.mode && skill.mode !== currentMode) continue
			if (disabledSkills.has(skill.name.toLowerCase())) continue

			const existingSkill = resolvedSkills.get(skill.name)

			if (!existingSkill) {
				resolvedSkills.set(skill.name, skill)
				continue
			}

			// Apply override rules
			const shouldOverride = this.shouldOverrideSkill(existingSkill, skill, sourcePreference)
			if (shouldOverride) {
				resolvedSkills.set(skill.name, skill)
			}
		}

		return Array.from(resolvedSkills.values())
	}

	/**
	 * Determine if newSkill should override existingSkill based on priority rules.
	 * Priority: project > global, mode-specific > generic
	 */
	private shouldOverrideSkill(
		existing: SkillMetadata,
		newSkill: SkillMetadata,
		sourcePreference: SkillSettings["sourcePreference"] = "project-first",
	): boolean {
		// Resolve global/project priority by user preference.
		if (existing.source !== newSkill.source) {
			if (sourcePreference === "global-first") {
				return newSkill.source === "global"
			}
			return newSkill.source === "project"
		}

		// Same source: mode-specific overrides generic
		if (newSkill.mode && !existing.mode) return true
		if (!newSkill.mode && existing.mode) return false

		// Same source and same mode-specificity: keep existing (first wins)
		return false
	}

	/**
	 * Get all skills (for UI display, debugging, etc.)
	 */
	getAllSkills(): SkillMetadata[] {
		return Array.from(this.skills.values())
	}

	async getSkillContent(name: string, currentMode?: string): Promise<SkillContent | null> {
		// If mode is provided, try to find the best matching skill
		let skill: SkillMetadata | undefined

		if (currentMode) {
			const modeSkills = this.getSkillsForMode(currentMode)
			skill = modeSkills.find((s) => s.name === name)
		} else {
			// Fall back to any skill with this name
			skill = Array.from(this.skills.values()).find((s) => s.name === name)
		}

		if (!skill) return null

		const fileContent = await fs.readFile(skill.path, "utf-8")
		const { content: body } = matter(fileContent)

		return {
			...skill,
			instructions: body.trim(),
		}
	}

	/**
	 * Get all skills directories to scan, including mode-specific directories.
	 */
	private async getSkillsDirectories(): Promise<
		Array<{
			dir: string
			source: "global" | "project"
			mode?: string
		}>
	> {
		const dirs: Array<{ dir: string; source: "global" | "project"; mode?: string }> = []
		const globalRooDir = getGlobalRooDirectory()
		const provider = this.providerRef.deref()
		const projectRooDir = provider?.cwd ? path.join(provider.cwd, ".novacode") : null

		// Get list of modes to check for mode-specific skills
		const modesList = await this.getAvailableModes()

		// Global directories
		dirs.push({ dir: path.join(globalRooDir, "skills"), source: "global" })
		for (const mode of modesList) {
			dirs.push({ dir: path.join(globalRooDir, `skills-${mode}`), source: "global", mode })
		}

		// Project directories
		if (projectRooDir) {
			dirs.push({ dir: path.join(projectRooDir, "skills"), source: "project" })
			for (const mode of modesList) {
				dirs.push({ dir: path.join(projectRooDir, `skills-${mode}`), source: "project", mode })
			}
		}

		return dirs
	}

	/**
	 * Get list of available modes (built-in + custom)
	 */
	private async getAvailableModes(): Promise<string[]> {
		const provider = this.providerRef.deref()
		const builtInModeSlugs = modes.map((m) => m.slug)

		if (!provider) {
			return builtInModeSlugs
		}

		try {
			const customModes = await provider.customModesManager.getCustomModes()
			const allModes = getAllModes(customModes)
			return allModes.map((m) => m.slug)
		} catch {
			return builtInModeSlugs
		}
	}

	private getSkillKey(name: string, source: string, mode?: string): string {
		return `${source}:${mode || "generic"}:${name}`
	}

	private async setupFileWatchers(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		const provider = this.providerRef.deref()
		if (!provider?.cwd) return

		// Watch for changes in skills directories
		const globalSkillsDir = path.join(getGlobalRooDirectory(), "skills")
		const projectSkillsDir = path.join(provider.cwd, ".novacode", "skills")

		// Watch global skills directory
		this.watchDirectory(globalSkillsDir)

		// Watch project skills directory
		this.watchDirectory(projectSkillsDir)

		// Watch mode-specific directories for all available modes
		const modesList = await this.getAvailableModes()
		for (const mode of modesList) {
			this.watchDirectory(path.join(getGlobalRooDirectory(), `skills-${mode}`))
			this.watchDirectory(path.join(provider.cwd, ".novacode", `skills-${mode}`))
		}
	}

	private watchDirectory(dirPath: string): void {
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		// novacode_change start
		// Watch for direct children (skill directories) being added/changed/deleted
		// When anything changes, we'll rescan and look for SKILL.md files
		const pattern = new vscode.RelativePattern(dirPath, "*")
		// novacode_change end
		const watcher = vscode.workspace.createFileSystemWatcher(pattern)

		watcher.onDidChange(async (uri) => {
			if (this.isDisposed) return
			await this.discoverSkills()
		})

		watcher.onDidCreate(async (uri) => {
			if (this.isDisposed) return
			await this.discoverSkills()
		})

		watcher.onDidDelete(async (uri) => {
			if (this.isDisposed) return
			await this.discoverSkills()
		})

		this.disposables.push(watcher)
	}

	// novacode_change start: canonical metadata for distributed skill registration
	/**
	 * Get canonical metadata for all discovered skills, suitable for distributed registration.
	 * Uses frontmatter `name` as the canonical skill id (not the directory name).
	 */
	getCanonicalRegistrations(): Record<string, VcpDistributedSkillRegistration> {
		const registrations: Record<string, VcpDistributedSkillRegistration> = {}

		for (const skill of this.skills.values()) {
			// Use the canonical skill name; skip if already registered (first-wins).
			if (registrations[skill.name]) continue

			registrations[skill.name] = {
				canonicalName: skill.name,
				displayName: skill.name,
				version: "0.0.0", // TODO: read from frontmatter when available
				description: skill.description,
				sourceScope: skill.source,
				status: "registered",
				registeredAt: Date.now(),
			}
		}

		return registrations
	}
	// novacode_change end

	async dispose(): Promise<void> {
		this.isDisposed = true
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.skills.clear()
	}
}

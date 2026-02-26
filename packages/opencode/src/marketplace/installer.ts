import path from "path"
import os from "os"
import { mkdir, writeFile, readFile } from "fs/promises"
import { parse as parseYAML } from "yaml"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Global } from "../global"
import type {
  SkillItem,
  ModeItem,
  MCPItem,
  MCPContent,
  MCPParameter,
  InstallRequest,
  InstallResult,
} from "./types"

/**
 * Marketplace installer – handles installing skills, modes, and MCP servers
 * from marketplace items into the local configuration.
 *
 * Installation targets:
 * - Skills → .opencode/skill/<id>/SKILL.md (or .novacode/skills/<id>/SKILL.md)
 * - Modes → config.json → mode.custom
 * - MCPs → config.json → mcp.<name>
 */
export namespace MarketplaceInstaller {
  const log = Log.create({ service: "marketplace-installer" })

  // ── Install Dispatcher ───────────────────────────────────────────

  export async function install(
    request: InstallRequest,
    item: SkillItem | ModeItem | MCPItem,
  ): Promise<InstallResult> {
    switch (request.type) {
      case "skill":
        return installSkill(item as SkillItem)
      case "mode":
        return installMode(item as ModeItem)
      case "mcp":
        return installMCP(item as MCPItem, request.selectedContentIndex, request.params)
      default:
        return { success: false, message: `Unknown install type: ${request.type}` }
    }
  }

  // ── Skill Installation ───────────────────────────────────────────

  async function installSkill(skill: SkillItem): Promise<InstallResult> {
    try {
      const skillDir = await resolveSkillDir(skill.id)
      await mkdir(skillDir, { recursive: true })

      // Download and extract skill content
      // Skills in Kilo marketplace use a `content` field pointing to tar.gz
      // For now, if the content URL ends with .tar.gz we download it,
      // otherwise treat `content` as inline SKILL.md text.
      const contentUrl = skill.content
      if (contentUrl.endsWith(".tar.gz") || contentUrl.endsWith(".tgz")) {
        // Download tar.gz and extract
        const response = await fetch(contentUrl)
        if (!response.ok) {
          return { success: false, message: `Failed to download skill archive: HTTP ${response.status}` }
        }
        const buffer = await response.arrayBuffer()
        // Use Bun's built-in tar extraction or shell command
        const tarPath = path.join(skillDir, "__tmp_skill.tar.gz")
        await Bun.write(tarPath, buffer)

        // Extract using tar (Bun runs on a system that has tar)
        const proc = Bun.spawn(["tar", "-xzf", tarPath, "-C", skillDir], {
          stdout: "pipe",
          stderr: "pipe",
        })
        await proc.exited
        // Clean up tar file
        try {
          const { unlink } = await import("fs/promises")
          await unlink(tarPath)
        } catch { }
      } else if (skill.rawUrl) {
        // Fetch raw SKILL.md from rawUrl
        const response = await fetch(skill.rawUrl)
        if (!response.ok) {
          return { success: false, message: `Failed to download skill: HTTP ${response.status}` }
        }
        const text = await response.text()
        await writeFile(path.join(skillDir, "SKILL.md"), text, "utf-8")
      } else {
        // Treat content as inline SKILL.md
        await writeFile(path.join(skillDir, "SKILL.md"), contentUrl, "utf-8")
      }

      log.info("skill installed", { id: skill.id, dir: skillDir })
      return { success: true, message: `Skill "${skill.id}" installed`, installedPath: skillDir }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("skill install failed", { id: skill.id, err })
      return { success: false, message: `Skill install failed: ${msg}` }
    }
  }

  // ── Mode Installation ────────────────────────────────────────────

  async function installMode(mode: ModeItem): Promise<InstallResult> {
    try {
      // Parse the YAML content blob to extract mode definition
      const modeConfig = parseYAML(mode.content) as {
        slug?: string
        name?: string
        roleDefinition?: string
        groups?: string[]
        customInstructions?: string
      }

      if (!modeConfig || !modeConfig.slug) {
        return { success: false, message: `Invalid mode content: missing slug` }
      }

      // Write mode to global config under mode.custom
      // Config.updateGlobal merges with existing config
      const config = await Config.getGlobal()
      const existingModes = (config as any)?.mode?.custom ?? {}

      const modeEntry = {
        name: modeConfig.name ?? mode.name,
        roleDefinition: modeConfig.roleDefinition ?? mode.description,
        ...(modeConfig.groups ? { groups: modeConfig.groups } : {}),
        ...(modeConfig.customInstructions ? { customInstructions: modeConfig.customInstructions } : {}),
      }

      const updated = {
        mode: {
          custom: {
            ...existingModes,
            [modeConfig.slug]: modeEntry,
          },
        },
      } as any

      await Config.updateGlobal(updated)

      log.info("mode installed", { id: mode.id, slug: modeConfig.slug })
      return {
        success: true,
        message: `Mode "${mode.name}" (${modeConfig.slug}) installed to global config`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("mode install failed", { id: mode.id, err })
      return { success: false, message: `Mode install failed: ${msg}` }
    }
  }

  // ── MCP Installation ─────────────────────────────────────────────

  async function installMCP(
    mcp: MCPItem,
    selectedContentIndex?: number,
    params?: Record<string, string>,
  ): Promise<InstallResult> {
    try {
      // Resolve the content entry (MCPs can have multiple installation methods)
      const contentEntry = resolveMCPContent(mcp, selectedContentIndex)
      if (!contentEntry) {
        return { success: false, message: `No valid content entry found for MCP "${mcp.id}"` }
      }

      // Parse the JSON command block
      let commandText = contentEntry.content
      // Substitute parameters: {{PLACEHOLDER}} → actual value
      const allParams = [...(contentEntry.parameters ?? []), ...(mcp.parameters ?? [])]
      for (const param of allParams) {
        const value = params?.[param.key]
        if (value) {
          commandText = commandText.replace(new RegExp(`\\{\\{${param.placeholder}\\}\\}`, "g"), value)
        } else if (!param.optional) {
          // Leave placeholder as-is, user can fill in later
          log.warn("required MCP param not provided", { mcp: mcp.id, param: param.key })
        }
      }

      // Parse the command JSON to get the MCP server config
      // Format: { "mcpServers": { "<name>": { "command": "...", "args": [...], "env": {...} } } }
      // or     { "command": "...", "args": [...] }
      let mcpConfig: any
      try {
        mcpConfig = JSON.parse(commandText)
      } catch {
        return { success: false, message: `Failed to parse MCP command JSON for "${mcp.id}"` }
      }

      // Normalize: extract from mcpServers wrapper if present
      let serverName: string
      let serverConfig: any

      if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === "object") {
        const entries = Object.entries(mcpConfig.mcpServers)
        if (entries.length === 0) {
          return { success: false, message: `Empty mcpServers in MCP "${mcp.id}"` }
        }
        ;[serverName, serverConfig] = entries[0] as [string, any]
      } else if (mcpConfig.command || mcpConfig.args) {
        serverName = mcp.id
        serverConfig = mcpConfig
      } else {
        return { success: false, message: `Unrecognized MCP command format for "${mcp.id}"` }
      }

      // Convert to Config.McpLocal format
      const command: string[] = []
      if (serverConfig.command) {
        command.push(serverConfig.command)
      }
      if (Array.isArray(serverConfig.args)) {
        command.push(...serverConfig.args)
      }

      const mcpEntry: Record<string, unknown> = {
        type: "local",
        command,
        enabled: true,
      }
      if (serverConfig.env && typeof serverConfig.env === "object") {
        mcpEntry.environment = serverConfig.env
      }

      // Write to global config
      await Config.updateGlobal({
        mcp: {
          [serverName]: mcpEntry,
        },
      } as any)

      log.info("mcp installed", { id: mcp.id, serverName })
      return {
        success: true,
        message: `MCP server "${serverName}" installed to global config`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("mcp install failed", { id: mcp.id, err })
      return { success: false, message: `MCP install failed: ${msg}` }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  function resolveMCPContent(
    mcp: MCPItem,
    selectedIndex?: number,
  ): MCPContent | undefined {
    const content = mcp.content
    if (typeof content === "string") {
      return { name: mcp.name ?? mcp.id, content }
    }
    if (Array.isArray(content)) {
      const idx = selectedIndex ?? 0
      return content[idx]
    }
    // Single MCPContent object
    if (content && typeof content === "object" && "content" in content) {
      return content as MCPContent
    }
    return undefined
  }

  async function resolveSkillDir(skillId: string): Promise<string> {
    // Prefer .opencode/skill/<id> in current project directory,
    // fallback to global config cache
    const projectDir = path.join(Instance.directory, ".opencode", "skill", skillId)
    return projectDir
  }

  // ── Uninstall ────────────────────────────────────────────────────

  export async function uninstallMCP(serverName: string): Promise<InstallResult> {
    try {
      await Config.updateGlobal({
        mcp: {
          [serverName]: { enabled: false },
        },
      } as any)
      return { success: true, message: `MCP server "${serverName}" disabled` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, message: `MCP uninstall failed: ${msg}` }
    }
  }

  // ── List installed ───────────────────────────────────────────────

  export async function listInstalled(): Promise<{
    mcps: string[]
    modes: string[]
  }> {
    const config = await Config.get()
    const mcps = config.mcp ? Object.keys(config.mcp) : []
    const modes: string[] = []
    if ((config as any)?.mode?.custom) {
      modes.push(...Object.keys((config as any).mode.custom))
    }
    return { mcps, modes }
  }
}

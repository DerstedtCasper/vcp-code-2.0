import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { KiloSessions } from "@/nova-sessions/nova-sessions" // novacode_change
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { Config } from "../config/config" // novacode_change - VCP Bridge
import { VCPBridge } from "../vcp-bridge" // novacode_change - VCP Bridge
import { CodeIndex } from "../code-index" // novacode_change - Code Index T-1.12

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  KiloSessions.init() // novacode_change
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()

  // novacode_change start - Initialize VCP Bridge (WebSocket to VCPToolBox)
  try {
    const config = await Config.get()
    const toolboxCfg = config.vcp?.toolbox
    if (toolboxCfg?.enabled) {
      VCPBridge.init({
        enabled: true,
        toolboxUrl: toolboxCfg.url,
        toolboxKey: toolboxCfg.key,
        channels: toolboxCfg.channels as any,
        reconnectInterval: toolboxCfg.reconnectInterval,
      })
      Log.Default.info("VCP Bridge initialized")
    }
  } catch (err) {
    Log.Default.warn("VCP Bridge init failed (non-fatal)", { err })
  }
  // novacode_change end

  // novacode_change start - Initialize Code Index (T-1.12)
  try {
    const config = await Config.get()
    const codeIndexCfg = config.vcp?.codeIndex
    if (codeIndexCfg?.enabled) {
      await CodeIndex.init(
        {
          enabled: true,
          embedding: codeIndexCfg.embedding as any,
          vectorStore: codeIndexCfg.vectorStore as any,
          search: codeIndexCfg.search as any,
          exclude: codeIndexCfg.exclude as string[] | undefined,
        },
        Instance.directory,
      )
      Log.Default.info("Code Index initialized")

      // Subscribe to file watcher for incremental updates
      const codeExtensions = new Set([
        ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java",
        ".c", ".h", ".cpp", ".cs", ".rb", ".php", ".swift", ".lua",
        ".sh", ".sql", ".yaml", ".yml", ".json", ".html", ".css",
        ".svelte", ".vue", ".md", ".lean", ".zig", ".dart",
      ])
      let pendingUpdates: string[] = []
      let updateTimer: ReturnType<typeof setTimeout> | null = null

      Bus.subscribe(FileWatcher.Event.Updated, async (payload) => {
        if (!CodeIndex.isEnabled()) return
        const ext = payload.properties.file.slice(payload.properties.file.lastIndexOf("."))
        if (!codeExtensions.has(ext)) return

        pendingUpdates.push(payload.properties.file)
        // Debounce: batch incremental updates every 5 seconds
        if (updateTimer) clearTimeout(updateTimer)
        updateTimer = setTimeout(async () => {
          const paths = [...pendingUpdates]
          pendingUpdates = []
          try {
            await CodeIndex.update(paths)
          } catch (err) {
            Log.Default.warn("Code Index incremental update failed", { err })
          }
        }, 5000)
      })
    }
  } catch (err) {
    Log.Default.warn("Code Index init failed (non-fatal)", { err })
  }
  // novacode_change end

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}

import { Log } from "../util/log"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { VCPBridgeClient } from "./client"
import type {
  VCPRuntimeStats,
  VCPInfoMessage,
  VCPPluginCommand,
  BridgeStatus,
  ActivePlugin,
  VCPLogEntry,
  DistributedServerInfo,
  VCPChannel,
} from "./types"

/**
 * VCP Bridge — main namespace for VCPToolBox integration.
 *
 * Responsibilities:
 * 1. Manage WebSocket connection to VCPToolBox
 * 2. Aggregate VCPInfo messages into a unified VCPRuntimeStats snapshot
 * 3. Expose subscription API for frontend consumers
 * 4. Provide REST-queryable state
 */

const log = Log.create({ service: "vcp-bridge" })

export namespace VCPBridge {
  let client: VCPBridgeClient | null = null

  // ─── Aggregated State ────────────────────────────────────────────

  const MAX_RECENT_LOGS = 100

  const runtimeStats: VCPRuntimeStats = {
    connected: false,
    activePlugins: [],
    distributedServers: [],
    recentLogs: [],
  }

  // External subscribers that want the aggregated runtime stats
  const statsSubscribers = new Set<(stats: VCPRuntimeStats) => void>()

  // ─── Initialization ──────────────────────────────────────────────

  /**
   * Initialize the VCP Bridge with current config.
   * Called during opencode startup.
   */
  export function init(vcpConfig?: {
    toolboxUrl?: string
    toolboxKey?: string
    channels?: VCPChannel[]
    reconnectInterval?: number
    enabled?: boolean
  }): void {
    if (!vcpConfig?.enabled) {
      log.debug("VCP Bridge disabled by config")
      return
    }

    // Dispose existing client if re-initializing
    if (client) {
      client.dispose()
    }

    client = new VCPBridgeClient({
      toolboxUrl: vcpConfig.toolboxUrl || "ws://localhost:5800",
      toolboxKey: vcpConfig.toolboxKey,
      channels: (vcpConfig.channels || ["VCPInfo", "VCPLog"]) as VCPChannel[],
      reconnectInterval: vcpConfig.reconnectInterval || 5000,
    })

    // Subscribe to VCPInfo for state aggregation
    client.subscribe("VCPInfo", handleVCPInfoMessage)
    client.subscribe("VCPLog", handleVCPLogMessage)
    client.subscribe("DistributedServer", handleDistributedMessage)

    // Track connection status
    client.subscribeAll((msg) => {
      const wasConnected = runtimeStats.connected
      runtimeStats.connected = client?.connected ?? false
      if (wasConnected !== runtimeStats.connected) {
        notifyStatsSubscribers()
      }
    })

    client.connect()
    log.info("VCP Bridge initialized", { url: vcpConfig.toolboxUrl })
  }

  /**
   * Dispose the VCP Bridge
   */
  export function dispose(): void {
    if (client) {
      client.dispose()
      client = null
    }
    runtimeStats.connected = false
    runtimeStats.activePlugins = []
    runtimeStats.distributedServers = []
    runtimeStats.recentLogs = []
    statsSubscribers.clear()
  }

  // ─── Message Handlers ────────────────────────────────────────────

  function handleVCPInfoMessage(msg: VCPInfoMessage): void {
    const data = msg.data
    if (!data) return

    const msgType = msg.type || data.type

    switch (msgType) {
      case "plugin_status":
      case "vcpInfo": {
        const pluginName = data.pluginName || data.plugin
        if (!pluginName) break

        const idx = runtimeStats.activePlugins.findIndex((p) => p.name === pluginName)
        const update: ActivePlugin = {
          name: pluginName,
          status: data.status || "running",
          currentStep: data.step || data.currentStep,
          lastActivity: data.timestamp || Date.now(),
        }

        if (idx >= 0) {
          runtimeStats.activePlugins[idx] = update
        } else {
          runtimeStats.activePlugins.push(update)
        }
        break
      }

      case "resource_usage": {
        runtimeStats.resourceUsage = {
          memory: data.memory,
          cpu: data.cpu,
          activeConnections: data.activeConnections,
        }
        break
      }

      case "server_info": {
        runtimeStats.toolboxVersion = data.version
        runtimeStats.uptime = data.uptime
        break
      }
    }

    notifyStatsSubscribers()
  }

  function handleVCPLogMessage(msg: VCPInfoMessage): void {
    const data = msg.data
    if (!data) return

    const entry: VCPLogEntry = {
      timestamp: data.timestamp || Date.now(),
      level: data.level || "info",
      message: data.message || JSON.stringify(data),
      plugin: data.plugin || data.pluginName,
      toolCallId: data.toolCallId,
    }

    runtimeStats.recentLogs.push(entry)

    // Keep only the most recent logs
    if (runtimeStats.recentLogs.length > MAX_RECENT_LOGS) {
      runtimeStats.recentLogs = runtimeStats.recentLogs.slice(-MAX_RECENT_LOGS)
    }

    notifyStatsSubscribers()
  }

  function handleDistributedMessage(msg: VCPInfoMessage): void {
    const data = msg.data
    if (!data || !data.id) return

    const idx = runtimeStats.distributedServers.findIndex((s) => s.id === data.id)
    const update: DistributedServerInfo = {
      id: data.id,
      name: data.name || data.id,
      status: data.status || "online",
      lastHeartbeat: data.timestamp || Date.now(),
    }

    if (idx >= 0) {
      runtimeStats.distributedServers[idx] = update
    } else {
      runtimeStats.distributedServers.push(update)
    }

    notifyStatsSubscribers()
  }

  function notifyStatsSubscribers(): void {
    for (const sub of statsSubscribers) {
      try {
        sub({ ...runtimeStats })
      } catch (err) {
        log.error("stats subscriber error", { error: err })
      }
    }
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Get the current aggregated runtime stats
   */
  export function getStats(): VCPRuntimeStats {
    return { ...runtimeStats }
  }

  /**
   * Get bridge connection status
   */
  export function getStatus(): BridgeStatus {
    if (!client) {
      return {
        connected: false,
        channels: [],
        reconnectAttempts: 0,
      }
    }
    return client.getStatus()
  }

  /**
   * Subscribe to aggregated runtime stats updates
   * @returns unsubscribe function
   */
  export function onStatsUpdate(handler: (stats: VCPRuntimeStats) => void): () => void {
    statsSubscribers.add(handler)
    return () => {
      statsSubscribers.delete(handler)
    }
  }

  /**
   * Subscribe to raw messages on a specific VCPToolBox channel.
   * For direct access to un-aggregated data.
   * @returns unsubscribe function
   */
  export function subscribe(channel: VCPChannel, handler: (msg: VCPInfoMessage) => void): () => void {
    if (!client) {
      log.warn("VCP Bridge not initialized, subscription will not receive data")
      return () => {}
    }
    return client.subscribe(channel, handler)
  }

  /**
   * Send a message to VCPToolBox
   */
  export function send(data: unknown): boolean {
    if (!client) return false
    return client.send(data)
  }

  /**
   * Get plugin commands registered in VCPToolBox.
   * Fetches via REST API from VCPToolBox if available.
   */
  export async function getPluginCommands(toolboxUrl?: string): Promise<VCPPluginCommand[]> {
    const baseUrl = toolboxUrl || client?.getStatus().url?.replace("ws://", "http://").replace("wss://", "https://")
    if (!baseUrl) return []

    try {
      const response = await fetch(`${baseUrl}/api/plugins/commands`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        log.debug("VCPToolBox plugins/commands endpoint not available", { status: response.status })
        return []
      }
      const data = await response.json()
      return Array.isArray(data) ? data : data.commands || []
    } catch (err) {
      // Endpoint may not exist in older VCPToolBox versions — this is expected
      log.debug("failed to fetch VCP plugin commands", { error: err })
      return []
    }
  }

  /**
   * Check if bridge is connected
   */
  export function isConnected(): boolean {
    return client?.connected ?? false
  }
}

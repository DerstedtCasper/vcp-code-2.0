import z from "zod"

/**
 * VCP Bridge type definitions for communication with VCPToolBox WebSocket Server.
 *
 * VCPToolBox WebSocket channels:
 * - VCPInfo:   Real-time streaming plugin execution steps & status
 * - VCPLog:    Tool call final logs
 * - DistributedServer: Distributed server messages
 * - ChromeObserver/ChromeControl: Chrome automation
 * - AdminPanel: Management panel
 */

// ─── Channel Definitions ─────────────────────────────────────────────

export const VCPChannel = z.enum([
  "VCPInfo",
  "VCPLog",
  "DistributedServer",
  "ChromeObserver",
  "ChromeControl",
  "AdminPanel",
])
export type VCPChannel = z.infer<typeof VCPChannel>

// ─── VCPInfo Message Types ───────────────────────────────────────────

export const PluginStatus = z.enum(["idle", "running", "completed", "error"])
export type PluginStatus = z.infer<typeof PluginStatus>

export const VCPInfoPluginUpdate = z.object({
  pluginName: z.string(),
  step: z.string().optional(),
  status: PluginStatus,
  timestamp: z.number(),
  details: z.record(z.string(), z.any()).optional(),
})
export type VCPInfoPluginUpdate = z.infer<typeof VCPInfoPluginUpdate>

export const VCPInfoMessage = z.object({
  type: z.string(),
  channel: VCPChannel.optional().default("VCPInfo"),
  data: z.any(),
  timestamp: z.number().optional(),
})
export type VCPInfoMessage = z.infer<typeof VCPInfoMessage>

// ─── VCPLog Message ──────────────────────────────────────────────────

export const VCPLogEntry = z.object({
  timestamp: z.number(),
  level: z.enum(["info", "warn", "error", "debug"]),
  message: z.string(),
  plugin: z.string().optional(),
  toolCallId: z.string().optional(),
  details: z.record(z.string(), z.any()).optional(),
})
export type VCPLogEntry = z.infer<typeof VCPLogEntry>

// ─── Distributed Server ──────────────────────────────────────────────

export const DistributedServerInfo = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["online", "offline", "connecting"]),
  lastHeartbeat: z.number().optional(),
})
export type DistributedServerInfo = z.infer<typeof DistributedServerInfo>

// ─── Runtime Stats (aggregated from VCPInfo) ─────────────────────────

export const ActivePlugin = z.object({
  name: z.string(),
  status: PluginStatus,
  currentStep: z.string().optional(),
  lastActivity: z.number().optional(),
})
export type ActivePlugin = z.infer<typeof ActivePlugin>

export const ResourceUsage = z.object({
  memory: z.number().optional(),
  cpu: z.number().optional(),
  activeConnections: z.number().optional(),
})
export type ResourceUsage = z.infer<typeof ResourceUsage>

export const VCPRuntimeStats = z.object({
  connected: z.boolean(),
  toolboxVersion: z.string().optional(),
  uptime: z.number().optional(),
  activePlugins: z.array(ActivePlugin),
  distributedServers: z.array(DistributedServerInfo),
  resourceUsage: ResourceUsage.optional(),
  recentLogs: z.array(VCPLogEntry),
})
export type VCPRuntimeStats = z.infer<typeof VCPRuntimeStats>

// ─── Bridge Status ───────────────────────────────────────────────────

export const BridgeStatus = z.object({
  connected: z.boolean(),
  url: z.string().optional(),
  channels: z.array(VCPChannel),
  reconnectAttempts: z.number(),
  lastConnected: z.number().optional(),
  lastError: z.string().optional(),
})
export type BridgeStatus = z.infer<typeof BridgeStatus>

// ─── Plugin Command (from VCPToolBox plugins) ────────────────────────

export const VCPPluginCommand = z.object({
  name: z.string(),
  description: z.string().optional(),
  pluginName: z.string(),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().default("string"),
        required: z.boolean().default(false),
        description: z.string().optional(),
      }),
    )
    .optional(),
})
export type VCPPluginCommand = z.infer<typeof VCPPluginCommand>

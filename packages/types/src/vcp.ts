import { z } from "zod"

// novacode_change - new file

export const vcpContextFoldStyleSchema = z.enum(["details", "comment"])
export const vcpToolBridgeModeSchema = z.enum(["execute", "event"])
export const vcpAgentWaveStrategySchema = z.enum(["sequential", "parallel", "adaptive"])
export const vcpAgentHandoffFormatSchema = z.enum(["json", "markdown"])

export const vcpBridgePluginStatusSchema = z.enum(["active", "error", "idle"])
export const vcpBridgeServerStatusSchema = z.enum(["online", "offline"])
export const vcpBridgeLogLevelSchema = z.enum(["info", "warn", "error", "debug"])

export const vcpContextFoldConfigSchema = z.object({
	enabled: z.boolean(),
	style: vcpContextFoldStyleSchema,
	startMarker: z.string(),
	endMarker: z.string(),
})

export const vcpInfoConfigSchema = z.object({
	enabled: z.boolean(),
	startMarker: z.string(),
	endMarker: z.string(),
})

export const vcpHtmlConfigSchema = z.object({
	enabled: z.boolean(),
})

export const vcpToolRequestConfigSchema = z.object({
	enabled: z.boolean(),
	bridgeMode: vcpToolBridgeModeSchema,
	maxPerMessage: z.number().int().min(1),
	allowTools: z.array(z.string()),
	denyTools: z.array(z.string()),
	keepBlockInText: z.boolean(),
	startMarker: z.string(),
	endMarker: z.string(),
})

export const vcpAgentTeamMemberSchema = z.object({
	id: z.string().optional(),
	name: z.string(),
	providerID: z.string(),
	modelID: z.string(),
	rolePrompt: z.string(),
})

export const vcpAgentTeamConfigSchema = z.object({
	enabled: z.boolean(),
	maxParallel: z.number().int().min(1),
	waveStrategy: vcpAgentWaveStrategySchema,
	requireFileSeparation: z.boolean(),
	handoffFormat: vcpAgentHandoffFormatSchema,
	members: z.array(vcpAgentTeamMemberSchema),
})

export const vcpMemoryConfigSchema = z.object({
	passive: z.object({
		enabled: z.boolean(),
		maxItems: z.number().int().min(1),
		maxCharsPerItem: z.number().int().min(1),
		minImportance: z.number().min(0).max(1),
	}),
	writer: z.object({
		enabled: z.boolean(),
		triggerTokens: z.number().int().min(1),
		minChars: z.number().int().min(1),
		importanceThreshold: z.number().min(0).max(1),
		summarizeLongContent: z.boolean(),
	}),
	retrieval: z.object({
		enabled: z.boolean(),
		topK: z.number().int().min(1),
		decayFactor: z.number().min(0).max(1),
		minScore: z.number().min(0).max(1),
		recencyBias: z.number().min(0).max(2),
	}),
	refresh: z.object({
		enabled: z.boolean(),
		intervalMs: z.number().int().min(1000),
		maxItemsPerRun: z.number().int().min(1),
		cleanupDays: z.number().int().min(1),
	}),
})

export const vcpSnowCompatConfigSchema = z.object({
	enabled: z.boolean(),
	basicModel: z.string(),
	advancedModel: z.string(),
	baseUrl: z.string(),
	requestMethod: z.string(),
	maxContextTokens: z.number().int().min(0),
	maxTokens: z.number().int().min(1),
	toolResultTokenLimit: z.number().int().min(1),
	showThinking: z.boolean(),
	enableAutoCompress: z.boolean(),
	editSimilarityThreshold: z.number().min(0).max(1),
	anthropicBeta: z.string(),
	anthropicCacheTTL: z.string(),
	responsesReasoning: z.object({
		enabled: z.boolean(),
		effort: z.string(),
	}),
	proxy: z.object({
		enabled: z.boolean(),
		port: z.number().int().min(1),
		browserDebugPort: z.number().int().min(1),
	}),
})

export const vcpToolboxConfigSchema = z.object({
	enabled: z.boolean(),
	url: z.string(),
	key: z.string(),
	reconnectInterval: z.number().int().min(250),
})

export const vcpConfigSchema = z.object({
	enabled: z.boolean(),
	contextFold: vcpContextFoldConfigSchema,
	vcpInfo: vcpInfoConfigSchema,
	html: vcpHtmlConfigSchema,
	toolRequest: vcpToolRequestConfigSchema,
	agentTeam: vcpAgentTeamConfigSchema,
	memory: vcpMemoryConfigSchema,
	toolbox: vcpToolboxConfigSchema,
	snowCompat: vcpSnowCompatConfigSchema,
})

export type VcpContextFoldConfig = z.infer<typeof vcpContextFoldConfigSchema>
export type VcpInfoConfig = z.infer<typeof vcpInfoConfigSchema>
export type VcpHtmlConfig = z.infer<typeof vcpHtmlConfigSchema>
export type VcpToolRequestConfig = z.infer<typeof vcpToolRequestConfigSchema>
export type VcpAgentTeamMember = z.infer<typeof vcpAgentTeamMemberSchema>
export type VcpAgentTeamConfig = z.infer<typeof vcpAgentTeamConfigSchema>
export type VcpMemoryConfig = z.infer<typeof vcpMemoryConfigSchema>
export type VcpToolboxConfig = z.infer<typeof vcpToolboxConfigSchema>
export type VcpSnowCompatConfig = z.infer<typeof vcpSnowCompatConfigSchema>
export type VcpConfig = z.infer<typeof vcpConfigSchema>

export interface VcpBridgeActivePlugin {
	name: string
	version: string
	status: z.infer<typeof vcpBridgePluginStatusSchema>
}

export interface VcpBridgeLogEntry {
	timestamp: number
	level: z.infer<typeof vcpBridgeLogLevelSchema>
	source: string
	message: string
}

export interface VcpBridgeDistributedServer {
	id: string
	host: string
	port: number
	status: z.infer<typeof vcpBridgeServerStatusSchema>
	load: number
}

export interface VcpBridgeRuntimeStats {
	cpuPercent: number
	memoryMB: number
	connections: number
	uptime: number
}

export interface VcpBridgeStatus {
	connected: boolean
	version?: string
	stats?: VcpBridgeRuntimeStats
	activePlugins: VcpBridgeActivePlugin[]
	distributedServers: VcpBridgeDistributedServer[]
	reconnectAttempts?: number
	lastConnected?: number
	lastError?: string
	endpoint?: string
	lastLatencyMs?: number
}

export interface VcpBridgeTestResult {
	success: boolean
	endpoint?: string
	latencyMs?: number
	error?: string
}

export interface AtomicMemoryItem {
	id: string
	text: string
	category: "fact" | "preference" | "style" | "context"
	source: "passive" | "explicit"
	createdAt: number
	lastAccessed: number
	accessCount: number
	importance: number
}

export function getDefaultVcpConfig(): VcpConfig {
	return {
		enabled: false,
		contextFold: {
			enabled: true,
			style: "details",
			startMarker: "<<<[VCP_DYNAMIC_FOLD]>>>",
			endMarker: "<<<[END_VCP_DYNAMIC_FOLD]>>>",
		},
		vcpInfo: {
			enabled: true,
			startMarker: "<<<[VCPINFO]>>>",
			endMarker: "<<<[END_VCPINFO]>>>",
		},
		html: { enabled: false },
		toolRequest: {
			enabled: true,
			bridgeMode: "execute",
			maxPerMessage: 5,
			allowTools: [],
			denyTools: [],
			keepBlockInText: false,
			startMarker: "<<<[TOOL_REQUEST]>>>",
			endMarker: "<<<[END_TOOL_REQUEST]>>>",
		},
		agentTeam: {
			enabled: false,
			maxParallel: 3,
			waveStrategy: "sequential",
			requireFileSeparation: false,
			handoffFormat: "markdown",
			members: [],
		},
		memory: {
			passive: { enabled: false, maxItems: 100, maxCharsPerItem: 512, minImportance: 0.2 },
			writer: {
				enabled: false,
				triggerTokens: 1000,
				minChars: 20,
				importanceThreshold: 0.5,
				summarizeLongContent: true,
			},
			retrieval: { enabled: false, topK: 5, decayFactor: 0.95, minScore: 0.1, recencyBias: 1 },
			refresh: { enabled: false, intervalMs: 3_600_000, maxItemsPerRun: 50, cleanupDays: 30 },
		},
		toolbox: {
			enabled: false,
			url: "ws://localhost:8765",
			key: "",
			reconnectInterval: 5000,
		},
		snowCompat: {
			enabled: false,
			basicModel: "",
			advancedModel: "",
			baseUrl: "",
			requestMethod: "responses",
			maxContextTokens: 0,
			maxTokens: 32000,
			toolResultTokenLimit: 4000,
			showThinking: true,
			enableAutoCompress: true,
			editSimilarityThreshold: 0.95,
			anthropicBeta: "",
			anthropicCacheTTL: "",
			responsesReasoning: {
				enabled: true,
				effort: "medium",
			},
			proxy: {
				enabled: false,
				port: 8765,
				browserDebugPort: 9222,
			},
		},
	}
}

import { z } from "zod"

// novacode_change - new file

// ─── VCP Runtime ─────────────────────────────────────────────────────────────

export const vcpRuntimeModelRouteTargetSchema = z.enum(["default", "quick"])

export const vcpRuntimeModelBindingSchema = z.object({
	modelId: z.string(),
	displayName: z.string().optional(),
	providerId: z.string().optional(),
})

export const vcpRuntimeModelRoutesSchema = z.object({
	autocomplete: vcpRuntimeModelRouteTargetSchema,
	yoloGatekeeper: vcpRuntimeModelRouteTargetSchema,
	fileSlice: vcpRuntimeModelRouteTargetSchema,
	contextCondense: vcpRuntimeModelRouteTargetSchema,
})

export const vcpRuntimeModelCatalogEntrySchema = z.object({
	id: z.string(),
	displayName: z.string().optional(),
	owned_by: z.string().optional(),
})

export const vcpRuntimeModelCatalogStateSchema = z.object({
	models: z.array(vcpRuntimeModelCatalogEntrySchema),
	fetchedAt: z.number(),
	error: z.string().optional(),
})

export const vcpRuntimeModelsConfigSchema = z.object({
	default: vcpRuntimeModelBindingSchema,
	quick: vcpRuntimeModelBindingSchema,
	routes: vcpRuntimeModelRoutesSchema,
	catalogCache: z.object({
		ttlMs: z.number().int().min(1000),
		providers: z.record(z.string(), vcpRuntimeModelCatalogStateSchema),
	}),
})

export const vcpMediaAssetPayloadSchema = z.object({
	assetId: z.string(),
	sourceType: z.enum(["local", "remote"]),
	source: z.string(),
	mimeType: z.string(),
	alt: z.string().optional(),
	title: z.string().optional(),
	bytes: z.number().optional(),
	metadata: z.record(z.string(), z.string()).optional(),
})

export const vcpRuntimeMediaConfigSchema = z.object({
	enabled: z.boolean(),
	maxAssetBytes: z.number().int().min(0),
	allowedSchemes: z.array(z.string()),
})

export const vcpDistributedSkillStatusSchema = z.enum(["registered", "error", "unregistered", "drifted"])

export const vcpDistributedSkillRegistrationSchema = z.object({
	canonicalName: z.string(),
	remoteName: z.string().optional(),
	displayName: z.string().optional(),
	version: z.string().optional(),
	description: z.string().optional(),
	sourceScope: z.enum(["global", "project"]).optional(),
	status: vcpDistributedSkillStatusSchema,
	registeredAt: z.number().optional(),
	error: z.string().optional(),
})

export const vcpPreinstalledSkillsConfigSchema = z.object({
	manifestVersion: z.string(),
	globalSkills: z.array(z.string()),
	workspaceSkills: z.array(z.string()),
	internalOnly: z.array(z.string()),
})

export const vcpRuntimeConfigSchema = z.object({
	models: vcpRuntimeModelsConfigSchema,
	media: vcpRuntimeMediaConfigSchema,
	distributedSkills: z.object({
		registrations: z.record(z.string(), vcpDistributedSkillRegistrationSchema),
	}),
	preinstalledSkills: vcpPreinstalledSkillsConfigSchema,
})

export type VcpRuntimeModelRouteTarget = z.infer<typeof vcpRuntimeModelRouteTargetSchema>
export type VcpRuntimeModelBinding = z.infer<typeof vcpRuntimeModelBindingSchema>
export type VcpRuntimeModelRoutes = z.infer<typeof vcpRuntimeModelRoutesSchema>
export type VcpRuntimeModelCatalogEntry = z.infer<typeof vcpRuntimeModelCatalogEntrySchema>
export type VcpRuntimeModelCatalogState = z.infer<typeof vcpRuntimeModelCatalogStateSchema>
export type VcpRuntimeModelsConfig = z.infer<typeof vcpRuntimeModelsConfigSchema>
export type VcpMediaAssetPayload = z.infer<typeof vcpMediaAssetPayloadSchema>
export type VcpRuntimeMediaConfig = z.infer<typeof vcpRuntimeMediaConfigSchema>
export type VcpDistributedSkillStatus = z.infer<typeof vcpDistributedSkillStatusSchema>
export type VcpDistributedSkillRegistration = z.infer<typeof vcpDistributedSkillRegistrationSchema>
export type VcpPreinstalledSkillsConfig = z.infer<typeof vcpPreinstalledSkillsConfigSchema>
export type VcpRuntimeConfig = z.infer<typeof vcpRuntimeConfigSchema>

export function getDefaultVcpRuntimeConfig(): VcpRuntimeConfig {
	return {
		models: {
			default: { modelId: "", displayName: "", providerId: "" },
			quick: { modelId: "", displayName: "", providerId: "" },
			routes: {
				autocomplete: "quick",
				yoloGatekeeper: "quick",
				fileSlice: "quick",
				contextCondense: "quick",
			},
			catalogCache: {
				ttlMs: 300_000,
				providers: {},
			},
		},
		media: {
			enabled: false,
			maxAssetBytes: 10_485_760,
			allowedSchemes: ["https"],
		},
		distributedSkills: {
			registrations: {},
		},
		preinstalledSkills: {
			manifestVersion: "1.0.9",
			globalSkills: [
				"agent-manager",
				"codex-review",
				"create-plan",
				"gh-address-comments",
				"gh-fix-ci",
				"helloagents",
				"humanizer-zh",
				"mathprove-skill",
				"planning-with-files",
				"powershell-windows",
				"receiving-code-review",
				"requesting-code-review",
				"session-handoff",
				"using-git-worktrees",
				"verification-before-completion",
			],
			workspaceSkills: ["translation"],
			internalOnly: [".system"],
		},
	}
}

// ─── VCP Protocol Config ─────────────────────────────────────────────────────

export const vcpContextFoldStyleSchema = z.enum(["details", "comment"])
export const vcpToolBridgeModeSchema = z.enum(["execute", "event"])
export const vcpAgentWaveStrategySchema = z.enum(["sequential", "parallel", "adaptive"])
export const vcpAgentHandoffFormatSchema = z.enum(["json", "markdown"])
// novacode_change start
export const vcpAgentTeamRoleTypeSchema = z.enum(["lead", "research", "implement", "review", "test", "general"])
export const vcpAgentTeamOwnershipSchema = z.object({
	paths: z.array(z.string()),
	summary: z.string().optional(),
})
// novacode_change end

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
	apiConfigId: z.string().optional(), // novacode_change
	roleType: vcpAgentTeamRoleTypeSchema.optional(), // novacode_change
	phaseAffinity: z.array(z.string()).optional(), // novacode_change
	capabilities: z.array(z.string()).optional(), // novacode_change
	enabled: z.boolean().optional(), // novacode_change
	ownership: vcpAgentTeamOwnershipSchema.optional(), // novacode_change
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
	runtime: vcpRuntimeConfigSchema.optional(),
})

export type VcpContextFoldConfig = z.infer<typeof vcpContextFoldConfigSchema>
export type VcpInfoConfig = z.infer<typeof vcpInfoConfigSchema>
export type VcpHtmlConfig = z.infer<typeof vcpHtmlConfigSchema>
export type VcpToolRequestConfig = z.infer<typeof vcpToolRequestConfigSchema>
export type VcpAgentTeamRoleType = z.infer<typeof vcpAgentTeamRoleTypeSchema> // novacode_change
export type VcpAgentTeamOwnership = z.infer<typeof vcpAgentTeamOwnershipSchema> // novacode_change
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
	distributedConnected?: boolean
	version?: string
	stats?: VcpBridgeRuntimeStats
	activePlugins: VcpBridgeActivePlugin[]
	distributedServers: VcpBridgeDistributedServer[]
	reconnectAttempts?: number
	lastConnected?: number
	lastError?: string
	endpoint?: string
	distributedEndpoint?: string
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
		html: { enabled: true },
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
		runtime: getDefaultVcpRuntimeConfig(),
	}
}

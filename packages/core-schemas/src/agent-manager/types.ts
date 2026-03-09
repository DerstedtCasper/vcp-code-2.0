import { z } from "zod"

/**
 * Agent Manager Types
 *
 * These types are used by the agent-manager in the extension for managing
 * CLI sessions and parallel mode worktrees.
 */

export const agentTeamRoleTypeSchema = z.enum(["lead", "research", "implement", "review", "test", "general"])
export const agentTeamOwnershipSchema = z.object({
	paths: z.array(z.string()),
	summary: z.string().optional(),
})

export const teamRunStatusSchema = z.enum(["pending", "running", "completed", "failed", "cancelled"])
export const teamWaveStatusSchema = z.enum(["pending", "running", "completed", "failed", "cancelled"])
export const teamHandoffStatusSchema = z.enum(["draft", "published", "consumed"])
export const teamApprovalStatusSchema = z.enum(["pending", "approved", "rejected"])
export const teamRunEventTypeSchema = z.enum([
	"run_started",
	"wave_started",
	"member_launched",
	"session_completed",
	"handoff_published",
	"blackboard_updated",
	"approval_requested",
	"member_cancelled",
	"run_completed",
	"run_failed",
	"run_cancelled",
])
export const teamWaveStrategySchema = z.enum(["sequential", "parallel", "adaptive"])
export const teamHandoffFormatSchema = z.enum(["json", "markdown"])

/**
 * Agent status schema
 */
export const agentStatusSchema = z.enum(["creating", "running", "done", "error", "stopped"])

/**
 * Session source schema
 */
export const sessionSourceSchema = z.enum(["local", "remote"])

/**
 * Parallel mode (worktree) information schema
 */
export const parallelModeInfoSchema = z.object({
	enabled: z.boolean(),
	branch: z.string().optional(), // e.g., "add-authentication-1702734891234"
	worktreePath: z.string().optional(), // e.g., ".novacode/worktrees/add-auth..."
	parentBranch: z.string().optional(), // e.g., "main" - the branch worktree was created from
	completionMessage: z.string().optional(), // Merge instructions from CLI on completion
})

export const teamRunMemberSchema = z.object({
	teamMemberId: z.string(),
	name: z.string(),
	apiConfigId: z.string().optional(),
	providerId: z.string().optional(),
	modelId: z.string().optional(),
	rolePrompt: z.string().optional(),
	roleType: agentTeamRoleTypeSchema.optional(),
	ownership: agentTeamOwnershipSchema.optional(),
	sessionId: z.string().optional(),
	status: agentStatusSchema.optional(),
})

export const teamWaveSchema = z.object({
	waveId: z.string(),
	runId: z.string(),
	label: z.string(),
	index: z.number().int().min(0),
	status: teamWaveStatusSchema,
	strategy: teamWaveStrategySchema,
	teamMemberIds: z.array(z.string()),
	sessionIds: z.array(z.string()),
	startedAt: z.number().optional(),
	completedAt: z.number().optional(),
	error: z.string().optional(),
})

export const teamHandoffSchema = z.object({
	handoffId: z.string(),
	runId: z.string(),
	waveId: z.string().optional(),
	fromTeamMemberId: z.string(),
	toTeamMemberId: z.string().optional(),
	fromSessionId: z.string().optional(),
	toSessionId: z.string().optional(),
	status: teamHandoffStatusSchema,
	title: z.string(),
	summary: z.string(),
	canonical: z.record(z.string(), z.unknown()),
	renderedText: z.string().optional(),
	createdAt: z.number(),
	consumedAt: z.number().optional(),
})

export const teamBlackboardEntrySchema = z.object({
	entryId: z.string(),
	runId: z.string(),
	waveId: z.string().optional(),
	teamMemberId: z.string().optional(),
	sessionId: z.string().optional(),
	kind: z.enum(["note", "decision", "artifact", "handoff", "approval"]),
	title: z.string(),
	content: z.string().optional(),
	contentJson: z.record(z.string(), z.unknown()).optional(),
	tags: z.array(z.string()).optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
	consumedAt: z.number().optional(),
})

export const teamApprovalRequestSchema = z.object({
	approvalId: z.string(),
	runId: z.string(),
	waveId: z.string().optional(),
	sessionId: z.string().optional(),
	teamMemberId: z.string().optional(),
	status: teamApprovalStatusSchema,
	kind: z.enum(["command", "tool", "question", "external"]),
	title: z.string(),
	message: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.number(),
	resolvedAt: z.number().optional(),
})

export const teamRunSchema = z.object({
	runId: z.string(),
	status: teamRunStatusSchema,
	prompt: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	waveStrategy: teamWaveStrategySchema,
	handoffFormat: teamHandoffFormatSchema,
	currentWaveId: z.string().optional(),
	sourceSessionId: z.string().optional(),
	members: z.array(teamRunMemberSchema),
	waves: z.array(teamWaveSchema),
	handoffs: z.array(teamHandoffSchema),
	blackboard: z.array(teamBlackboardEntrySchema),
	approvals: z.array(teamApprovalRequestSchema),
	error: z.string().optional(),
})

export const teamRunStateSchema = z.object({
	runs: z.array(teamRunSchema),
	activeRunId: z.string().nullable(),
})

export const teamRunEventSchema = z.object({
	eventId: z.string(),
	runId: z.string(),
	kind: teamRunEventTypeSchema,
	createdAt: z.number(),
	title: z.string(),
	message: z.string().optional(),
	waveId: z.string().optional(),
	sessionId: z.string().optional(),
	teamMemberId: z.string().optional(),
	handoff: teamHandoffSchema.optional(),
	blackboardEntry: teamBlackboardEntrySchema.optional(),
	approval: teamApprovalRequestSchema.optional(),
})

/**
 * Agent session schema
 */
export const agentSessionSchema = z.object({
	sessionId: z.string(),
	label: z.string(),
	prompt: z.string(),
	status: agentStatusSchema,
	startTime: z.number(),
	endTime: z.number().optional(),
	exitCode: z.number().optional(),
	error: z.string().optional(),
	logs: z.array(z.string()),
	pid: z.number().optional(),
	source: sessionSourceSchema,
	parallelMode: parallelModeInfoSchema.optional(),
	gitUrl: z.string().optional(),
	model: z.string().optional(), // Model ID used for this session
	mode: z.string().optional(), // Mode slug used for this session (e.g., "code", "architect")
	yoloMode: z.boolean().optional(), // True if session was started with auto-approval enabled
	teamRunId: z.string().optional(),
	teamMemberId: z.string().optional(),
	waveId: z.string().optional(),
	roleType: agentTeamRoleTypeSchema.optional(),
	ownership: agentTeamOwnershipSchema.optional(),
})

/**
 * Pending session schema (waiting for CLI's session_created event)
 */
export const pendingSessionSchema = z.object({
	prompt: z.string(),
	label: z.string(),
	startTime: z.number(),
	parallelMode: z.boolean().optional(),
	gitUrl: z.string().optional(),
	yoloMode: z.boolean().optional(), // True if session will be started with auto-approval enabled
	teamRunId: z.string().optional(),
	teamMemberId: z.string().optional(),
	waveId: z.string().optional(),
	roleType: agentTeamRoleTypeSchema.optional(),
	ownership: agentTeamOwnershipSchema.optional(),
})

/**
 * Agent manager state schema
 */
export const agentManagerStateSchema = z.object({
	sessions: z.array(agentSessionSchema),
	selectedId: z.string().nullable(),
})

/**
 * Messages from Webview to Extension
 */
/**
 * Start session message schema - used for runtime validation of webview messages
 */
export const startSessionMessageSchema = z.object({
	type: z.literal("agentManager.startSession"),
	prompt: z.string(),
	parallelMode: z.boolean().optional(),
	existingBranch: z.string().optional(),
	model: z.string().optional(), // Model ID to use for this session
	mode: z.string().optional(), // Mode slug (e.g., "code", "architect")
	versions: z.number().optional(), // Number of versions for multi-version mode
	labels: z.array(z.string()).optional(), // Labels for multi-version sessions
	images: z.array(z.string()).optional(), // Image data URLs to include with the prompt
	yoloMode: z.boolean().optional(), // True to enable auto-approval (default: true)
})

export const agentManagerMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("agentManager.webviewReady") }),
	startSessionMessageSchema,
	z.object({ type: z.literal("agentManager.stopSession"), sessionId: z.string() }),
	z.object({ type: z.literal("agentManager.selectSession"), sessionId: z.string() }),
	z.object({ type: z.literal("agentManager.refreshRemoteSessions") }),
	z.object({ type: z.literal("agentManager.listBranches") }),
	z.object({ type: z.literal("agentManager.refreshModels") }),
	z.object({ type: z.literal("agentManager.setMode"), sessionId: z.string(), mode: z.string() }),
])

/**
 * Remote session schema (simplified - full type comes from shared session client)
 */
export const remoteSessionSchema = z
	.object({
		id: z.string(),
		name: z.string().optional(),
		status: z.string().optional(),
	})
	.passthrough() // Allow additional fields from the full RemoteSession type

/**
 * Available model schema (from CLI models command)
 */
export const availableModelSchema = z.object({
	id: z.string(),
	displayName: z.string().nullable(),
	contextWindow: z.number(),
	supportsImages: z.boolean().optional(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
})

/**
 * Available mode schema (for mode selection)
 */
export const availableModeSchema = z.object({
	slug: z.string(),
	name: z.string(),
	description: z.string().optional(),
	iconName: z.string().optional(),
	source: z.enum(["global", "project", "organization"]).optional(),
})

/**
 * Messages from Extension to Webview
 */
export const agentManagerExtensionMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("agentManager.state"), state: agentManagerStateSchema }),
	z.object({ type: z.literal("agentManager.sessionUpdated"), session: agentSessionSchema }),
	z.object({ type: z.literal("agentManager.sessionRemoved"), sessionId: z.string() }),
	z.object({ type: z.literal("agentManager.error"), error: z.string() }),
	z.object({ type: z.literal("agentManager.remoteSessions"), sessions: z.array(remoteSessionSchema) }),
	z.object({
		type: z.literal("agentManager.branches"),
		branches: z.array(z.string()),
		currentBranch: z.string().optional(),
	}),
	z.object({
		type: z.literal("agentManager.availableModels"),
		provider: z.string(),
		currentModel: z.string(),
		models: z.array(availableModelSchema),
	}),
	z.object({
		type: z.literal("agentManager.modelsLoadFailed"),
		error: z.string().optional(),
	}),
	z.object({
		type: z.literal("agentManager.availableModes"),
		modes: z.array(availableModeSchema),
		currentMode: z.string(),
	}),
	z.object({
		type: z.literal("agentManager.modeChanged"),
		sessionId: z.string(),
		mode: z.string(),
		previousMode: z.string().optional(),
	}),
	z.object({
		type: z.literal("agentManager.teamRunState"),
		state: teamRunStateSchema,
	}),
	z.object({
		type: z.literal("agentManager.teamRunEvent"),
		event: teamRunEventSchema,
	}),
])

// Inferred types
export type AgentTeamRoleType = z.infer<typeof agentTeamRoleTypeSchema>
export type AgentTeamOwnership = z.infer<typeof agentTeamOwnershipSchema>
export type TeamRunStatus = z.infer<typeof teamRunStatusSchema>
export type TeamWaveStatus = z.infer<typeof teamWaveStatusSchema>
export type TeamHandoffStatus = z.infer<typeof teamHandoffStatusSchema>
export type TeamApprovalStatus = z.infer<typeof teamApprovalStatusSchema>
export type TeamRunEventType = z.infer<typeof teamRunEventTypeSchema>
export type TeamRunMember = z.infer<typeof teamRunMemberSchema>
export type TeamWave = z.infer<typeof teamWaveSchema>
export type TeamHandoff = z.infer<typeof teamHandoffSchema>
export type TeamBlackboardEntry = z.infer<typeof teamBlackboardEntrySchema>
export type TeamApprovalRequest = z.infer<typeof teamApprovalRequestSchema>
export type TeamRun = z.infer<typeof teamRunSchema>
export type TeamRunState = z.infer<typeof teamRunStateSchema>
export type TeamRunEvent = z.infer<typeof teamRunEventSchema>
export type AgentStatus = z.infer<typeof agentStatusSchema>
export type SessionSource = z.infer<typeof sessionSourceSchema>
export type AvailableModel = z.infer<typeof availableModelSchema>
export type AvailableMode = z.infer<typeof availableModeSchema>
export type ParallelModeInfo = z.infer<typeof parallelModeInfoSchema>
export type AgentSession = z.infer<typeof agentSessionSchema>
export type PendingSession = z.infer<typeof pendingSessionSchema>
export type AgentManagerState = z.infer<typeof agentManagerStateSchema>
export type AgentManagerMessage = z.infer<typeof agentManagerMessageSchema>
export type AgentManagerExtensionMessage = z.infer<typeof agentManagerExtensionMessageSchema>
export type StartSessionMessage = z.infer<typeof startSessionMessageSchema>

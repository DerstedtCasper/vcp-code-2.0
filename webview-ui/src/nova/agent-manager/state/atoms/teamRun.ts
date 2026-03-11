import { atom } from "jotai"

export type AgentTeamRoleType = "lead" | "research" | "implement" | "review" | "test" | "general"
export type TeamMemberStatus =
	| "pending"
	| "creating"
	| "running"
	| "done"
	| "completed"
	| "failed"
	| "error"
	| "cancelled"

export interface AgentTeamOwnership {
	paths: string[]
	summary?: string
}

export type TeamRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled"
export type TeamWaveStatus = TeamRunStatus
export type TeamHandoffStatus = "draft" | "published" | "consumed"
export type TeamApprovalStatus = "pending" | "approved" | "rejected"
export type TeamBlackboardCategory =
	| "task_spec"
	| "risk"
	| "open_question"
	| "decision"
	| "artifact"
	| "handoff"
	| "note"
export type TeamApprovalAskType = "tool" | "command" | "browser_action_launch" | "use_mcp_server" | "followup"
export type TeamRunEventType =
	| "run_started"
	| "wave_started"
	| "member_launched"
	| "session_completed"
	| "handoff_published"
	| "blackboard_updated"
	| "approval_requested"
	| "member_cancelled"
	| "run_completed"
	| "run_failed"
	| "run_cancelled"

export interface TeamRunMember {
	teamMemberId: string
	name: string
	providerId?: string
	modelId?: string
	rolePrompt?: string
	roleType?: AgentTeamRoleType
	ownership?: AgentTeamOwnership
	sessionId?: string
	status?: TeamMemberStatus
}

export interface TeamWave {
	waveId: string
	runId: string
	label: string
	index: number
	status: TeamWaveStatus
	strategy: "sequential" | "parallel" | "adaptive"
	teamMemberIds: string[]
	sessionIds: string[]
	startedAt?: number
	completedAt?: number
	error?: string
}

export interface TeamHandoff {
	handoffId: string
	runId: string
	waveId?: string
	fromTeamMemberId: string
	toTeamMemberId?: string
	fromSessionId?: string
	toSessionId?: string
	status: TeamHandoffStatus
	title: string
	summary: string
	canonical: Record<string, unknown>
	renderedText?: string
	createdAt: number
	consumedAt?: number
}

export interface TeamBlackboardEntry {
	entryId: string
	runId: string
	waveId?: string
	teamMemberId?: string
	sessionId?: string
	kind: "note" | "decision" | "artifact" | "handoff" | "approval"
	category?: TeamBlackboardCategory
	title: string
	content?: string
	contentJson?: Record<string, unknown>
	tags?: string[]
	createdAt: number
	updatedAt: number
	consumedAt?: number
}

export interface TeamApprovalRequest {
	approvalId: string
	runId: string
	waveId?: string
	sessionId?: string
	teamMemberId?: string
	status: TeamApprovalStatus
	kind: "command" | "tool" | "question" | "external"
	askType?: TeamApprovalAskType
	requestKey?: string
	title: string
	message?: string
	metadata?: Record<string, unknown>
	createdAt: number
	resolvedAt?: number
}

export interface TeamRun {
	runId: string
	status: TeamRunStatus
	prompt: string
	createdAt: number
	updatedAt: number
	waveStrategy: "sequential" | "parallel" | "adaptive"
	handoffFormat: "json" | "markdown"
	currentWaveId?: string
	sourceSessionId?: string
	members: TeamRunMember[]
	waves: TeamWave[]
	handoffs: TeamHandoff[]
	blackboard: TeamBlackboardEntry[]
	approvals: TeamApprovalRequest[]
	error?: string
}

export interface TeamRunState {
	runs: TeamRun[]
	activeRunId: string | null
}

export interface TeamRunEvent {
	eventId: string
	runId: string
	kind: TeamRunEventType
	createdAt: number
	title: string
	message?: string
	waveId?: string
	sessionId?: string
	teamMemberId?: string
	handoff?: TeamHandoff
	blackboardEntry?: TeamBlackboardEntry
	approval?: TeamApprovalRequest
}

const MAX_TEAM_RUN_EVENTS = 40
const EMPTY_TEAM_RUN_STATE: TeamRunState = { runs: [], activeRunId: null }

const asObject = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const asString = (value: unknown): string | undefined => {
	if (typeof value !== "string") {
		return undefined
	}
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : undefined
}

const asNumber = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}
	return undefined
}

const asStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return []
	}

	return value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
}

const normalizeRunStatus = (value: unknown): TeamRunStatus => {
	const next = asString(value)
	return next === "running" || next === "completed" || next === "failed" || next === "cancelled" ? next : "pending"
}

const normalizeWaveStatus = (value: unknown): TeamWaveStatus => normalizeRunStatus(value)

const normalizeHandoffStatus = (value: unknown): TeamHandoffStatus => {
	const next = asString(value)
	return next === "published" || next === "consumed" ? next : "draft"
}

const normalizeApprovalStatus = (value: unknown): TeamApprovalStatus => {
	const next = asString(value)
	return next === "approved" || next === "rejected" ? next : "pending"
}

const normalizeMemberStatus = (value: unknown): TeamMemberStatus | undefined => {
	const next = asString(value)
	return next === "pending" ||
		next === "creating" ||
		next === "running" ||
		next === "done" ||
		next === "completed" ||
		next === "failed" ||
		next === "error" ||
		next === "cancelled"
		? next
		: undefined
}

const normalizeRoleType = (value: unknown): AgentTeamRoleType | undefined => {
	const next = asString(value)
	return next === "lead" ||
		next === "research" ||
		next === "implement" ||
		next === "review" ||
		next === "test" ||
		next === "general"
		? next
		: undefined
}

const normalizeWaveStrategy = (value: unknown): TeamRun["waveStrategy"] => {
	const next = asString(value)
	return next === "parallel" || next === "adaptive" ? next : "sequential"
}

const normalizeHandoffFormat = (value: unknown): TeamRun["handoffFormat"] => {
	return asString(value) === "json" ? "json" : "markdown"
}

function normalizeOwnership(value: unknown): AgentTeamOwnership | undefined {
	const source = asObject(value)
	if (!source) {
		return undefined
	}

	const paths = asStringArray(source.paths)
	const summary = asString(source.summary)
	if (paths.length === 0 && !summary) {
		return undefined
	}

	return { paths, summary }
}

function normalizeMember(value: unknown, index: number): TeamRunMember | null {
	const source = asObject(value)
	if (!source) {
		return null
	}

	const teamMemberId = asString(source.teamMemberId) ?? asString(source.id) ?? `member-${index + 1}`
	const name = asString(source.name) ?? teamMemberId

	return {
		teamMemberId,
		name,
		providerId: asString(source.providerId) ?? asString(source.providerID),
		modelId: asString(source.modelId) ?? asString(source.modelID),
		rolePrompt: asString(source.rolePrompt),
		roleType: normalizeRoleType(source.roleType),
		ownership: normalizeOwnership(source.ownership),
		sessionId: asString(source.sessionId),
		status: normalizeMemberStatus(source.status),
	}
}

function normalizeWave(value: unknown, index: number, runIdFallback: string): TeamWave | null {
	const source = asObject(value)
	if (!source) {
		return null
	}

	return {
		waveId: asString(source.waveId) ?? asString(source.id) ?? `wave-${index + 1}`,
		runId: asString(source.runId) ?? runIdFallback,
		label: asString(source.label) ?? asString(source.title) ?? `Wave ${index + 1}`,
		index: asNumber(source.index) ?? index,
		status: normalizeWaveStatus(source.status),
		strategy: normalizeWaveStrategy(source.strategy),
		teamMemberIds: asStringArray(source.teamMemberIds),
		sessionIds: asStringArray(source.sessionIds),
		startedAt: asNumber(source.startedAt),
		completedAt: asNumber(source.completedAt),
		error: asString(source.error),
	}
}

function normalizeHandoff(value: unknown, index: number, runIdFallback: string): TeamHandoff | null {
	const source = asObject(value)
	if (!source) {
		return null
	}

	const handoffId = asString(source.handoffId) ?? asString(source.id) ?? `handoff-${index + 1}`
	const title = asString(source.title) ?? handoffId
	const summary = asString(source.summary) ?? asString(source.renderedText) ?? ""

	return {
		handoffId,
		runId: asString(source.runId) ?? runIdFallback,
		waveId: asString(source.waveId),
		fromTeamMemberId: asString(source.fromTeamMemberId) ?? "unknown",
		toTeamMemberId: asString(source.toTeamMemberId),
		fromSessionId: asString(source.fromSessionId),
		toSessionId: asString(source.toSessionId),
		status: normalizeHandoffStatus(source.status),
		title,
		summary,
		canonical: asObject(source.canonical) ?? {},
		renderedText: asString(source.renderedText),
		createdAt: asNumber(source.createdAt) ?? Date.now(),
		consumedAt: asNumber(source.consumedAt),
	}
}

function normalizeBlackboardEntry(value: unknown, index: number, runIdFallback: string): TeamBlackboardEntry | null {
	const source = asObject(value)
	if (!source) {
		return null
	}

	const kind = asString(source.kind)
	if (kind !== "note" && kind !== "decision" && kind !== "artifact" && kind !== "handoff" && kind !== "approval") {
		return null
	}

	const category = asString(source.category)
	const normalizedCategory =
		category === "task_spec" ||
		category === "risk" ||
		category === "open_question" ||
		category === "decision" ||
		category === "artifact" ||
		category === "handoff" ||
		category === "note"
			? category
			: undefined

	return {
		entryId: asString(source.entryId) ?? asString(source.id) ?? `blackboard-${index + 1}`,
		runId: asString(source.runId) ?? runIdFallback,
		waveId: asString(source.waveId),
		teamMemberId: asString(source.teamMemberId),
		sessionId: asString(source.sessionId),
		kind,
		category: normalizedCategory,
		title: asString(source.title) ?? `Entry ${index + 1}`,
		content: asString(source.content),
		contentJson: asObject(source.contentJson),
		tags: asStringArray(source.tags),
		createdAt: asNumber(source.createdAt) ?? Date.now(),
		updatedAt: asNumber(source.updatedAt) ?? asNumber(source.createdAt) ?? Date.now(),
		consumedAt: asNumber(source.consumedAt),
	}
}

function normalizeApproval(value: unknown, index: number, runIdFallback: string): TeamApprovalRequest | null {
	const source = asObject(value)
	if (!source) {
		return null
	}

	const kind = asString(source.kind)
	if (kind !== "command" && kind !== "tool" && kind !== "question" && kind !== "external") {
		return null
	}

	const askType = asString(source.askType)
	const normalizedAskType =
		askType === "tool" ||
		askType === "command" ||
		askType === "browser_action_launch" ||
		askType === "use_mcp_server" ||
		askType === "followup"
			? askType
			: undefined

	return {
		approvalId: asString(source.approvalId) ?? asString(source.id) ?? `approval-${index + 1}`,
		runId: asString(source.runId) ?? runIdFallback,
		waveId: asString(source.waveId),
		sessionId: asString(source.sessionId),
		teamMemberId: asString(source.teamMemberId),
		status: normalizeApprovalStatus(source.status),
		kind,
		askType: normalizedAskType,
		requestKey: asString(source.requestKey),
		title: asString(source.title) ?? `Approval ${index + 1}`,
		message: asString(source.message),
		metadata: asObject(source.metadata),
		createdAt: asNumber(source.createdAt) ?? Date.now(),
		resolvedAt: asNumber(source.resolvedAt),
	}
}

function normalizeRun(value: unknown, index: number): TeamRun | null {
	const source = asObject(value)
	if (!source) {
		return null
	}

	const runId = asString(source.runId) ?? asString(source.id) ?? `run-${index + 1}`

	return {
		runId,
		status: normalizeRunStatus(source.status),
		prompt: asString(source.prompt) ?? "",
		createdAt: asNumber(source.createdAt) ?? Date.now(),
		updatedAt: asNumber(source.updatedAt) ?? asNumber(source.createdAt) ?? Date.now(),
		waveStrategy: normalizeWaveStrategy(source.waveStrategy),
		handoffFormat: normalizeHandoffFormat(source.handoffFormat),
		currentWaveId: asString(source.currentWaveId),
		sourceSessionId: asString(source.sourceSessionId),
		members: Array.isArray(source.members)
			? source.members
					.map((entry, memberIndex) => normalizeMember(entry, memberIndex))
					.filter((entry): entry is TeamRunMember => Boolean(entry))
			: [],
		waves: Array.isArray(source.waves)
			? source.waves
					.map((entry, waveIndex) => normalizeWave(entry, waveIndex, runId))
					.filter((entry): entry is TeamWave => Boolean(entry))
			: [],
		handoffs: Array.isArray(source.handoffs)
			? source.handoffs
					.map((entry, handoffIndex) => normalizeHandoff(entry, handoffIndex, runId))
					.filter((entry): entry is TeamHandoff => Boolean(entry))
			: [],
		blackboard: Array.isArray(source.blackboard)
			? source.blackboard
					.map((entry, blackboardIndex) => normalizeBlackboardEntry(entry, blackboardIndex, runId))
					.filter((entry): entry is TeamBlackboardEntry => Boolean(entry))
			: [],
		approvals: Array.isArray(source.approvals)
			? source.approvals
					.map((entry, approvalIndex) => normalizeApproval(entry, approvalIndex, runId))
					.filter((entry): entry is TeamApprovalRequest => Boolean(entry))
			: [],
		error: asString(source.error),
	}
}

const upsertById = <T, K extends keyof T>(items: T[], key: K, nextItem: T): T[] => {
	const nextValue = nextItem[key]
	const index = items.findIndex((item) => item[key] === nextValue)
	if (index === -1) {
		return [nextItem, ...items]
	}

	const nextItems = [...items]
	nextItems[index] = nextItem
	return nextItems
}

export function normalizeTeamRunState(value: unknown): TeamRunState {
	const source = asObject(value)
	if (!source) {
		return EMPTY_TEAM_RUN_STATE
	}

	const runs = Array.isArray(source.runs)
		? source.runs
				.map((entry, index) => normalizeRun(entry, index))
				.filter((entry): entry is TeamRun => Boolean(entry))
		: []
	const activeRunId = asString(source.activeRunId)

	return {
		runs,
		activeRunId: activeRunId ?? runs[0]?.runId ?? null,
	}
}

export function normalizeTeamRunEvent(value: unknown): TeamRunEvent | null {
	const source = asObject(value)
	if (!source) {
		return null
	}

	const kind = asString(source.kind)
	if (
		kind !== "run_started" &&
		kind !== "wave_started" &&
		kind !== "member_launched" &&
		kind !== "session_completed" &&
		kind !== "handoff_published" &&
		kind !== "blackboard_updated" &&
		kind !== "approval_requested" &&
		kind !== "member_cancelled" &&
		kind !== "run_completed" &&
		kind !== "run_failed" &&
		kind !== "run_cancelled"
	) {
		return null
	}

	const runId = asString(source.runId)
	const eventId = asString(source.eventId)
	const title = asString(source.title)
	if (!runId || !eventId || !title) {
		return null
	}

	return {
		eventId,
		runId,
		kind,
		createdAt: asNumber(source.createdAt) ?? Date.now(),
		title,
		message: asString(source.message),
		waveId: asString(source.waveId),
		sessionId: asString(source.sessionId),
		teamMemberId: asString(source.teamMemberId),
		handoff: normalizeHandoff(source.handoff, 0, runId) ?? undefined,
		blackboardEntry: normalizeBlackboardEntry(source.blackboardEntry, 0, runId) ?? undefined,
		approval: normalizeApproval(source.approval, 0, runId) ?? undefined,
	}
}

export const teamRunStateAtom = atom<TeamRunState>(EMPTY_TEAM_RUN_STATE)
export const teamRunEventsAtom = atom<TeamRunEvent[]>([])
export const currentTeamRunAtom = atom((get) => {
	const state = get(teamRunStateAtom)
	return state.runs.find((run) => run.runId === state.activeRunId) ?? state.runs[0] ?? null
})

export const setTeamRunStateAtom = atom(null, (get, set, state: TeamRunState) => {
	set(teamRunStateAtom, state)

	const runIds = new Set(state.runs.map((run) => run.runId))
	set(
		teamRunEventsAtom,
		get(teamRunEventsAtom)
			.filter((event) => runIds.size === 0 || runIds.has(event.runId))
			.slice(0, MAX_TEAM_RUN_EVENTS),
	)
})

export const appendTeamRunEventAtom = atom(null, (get, set, event: TeamRunEvent) => {
	set(teamRunEventsAtom, [event, ...get(teamRunEventsAtom)].slice(0, MAX_TEAM_RUN_EVENTS))

	const state = get(teamRunStateAtom)
	const runIndex = state.runs.findIndex((run) => run.runId === event.runId)
	if (runIndex === -1) {
		return
	}

	const targetRun = state.runs[runIndex]
	const nextRun: TeamRun = {
		...targetRun,
		updatedAt: event.createdAt,
		currentWaveId: event.waveId ?? targetRun.currentWaveId,
		status:
			event.kind === "run_completed"
				? "completed"
				: event.kind === "run_failed"
					? "failed"
					: event.kind === "run_cancelled"
						? "cancelled"
						: event.kind === "run_started" ||
							  event.kind === "wave_started" ||
							  event.kind === "member_launched"
							? "running"
							: targetRun.status,
		handoffs: event.handoff ? upsertById(targetRun.handoffs, "handoffId", event.handoff) : targetRun.handoffs,
		blackboard: event.blackboardEntry
			? upsertById(targetRun.blackboard, "entryId", event.blackboardEntry)
			: targetRun.blackboard,
		approvals: event.approval ? upsertById(targetRun.approvals, "approvalId", event.approval) : targetRun.approvals,
	}

	const nextRuns = [...state.runs]
	nextRuns[runIndex] = nextRun
	set(teamRunStateAtom, {
		runs: nextRuns,
		activeRunId: state.activeRunId ?? event.runId,
	})
})

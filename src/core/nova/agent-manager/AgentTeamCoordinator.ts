import * as fs from "node:fs/promises"
import * as path from "node:path"

import type { ProviderSettings, VcpAgentTeamConfig, VcpAgentTeamMember } from "@roo-code/types"
import type {
	AgentTeamOwnership,
	AgentTeamRoleType,
	TeamApprovalRequest,
	TeamBlackboardEntry,
	TeamHandoff,
	TeamRun,
	TeamRunEvent,
	TeamRunMember,
	TeamRunState,
	TeamWave,
} from "./types"

export interface AgentTeamCoordinatorDependencies {
	workspacePath: string
	getNow?: () => number
	readProviderState: () => Promise<{
		listApiConfigMeta?: Array<{ id: string; name: string; apiProvider?: string; modelId?: string }>
	}>
	resolveProviderProfile: (params: { id: string }) => Promise<ProviderSettings & { name: string }>
	launchSession: (request: {
		prompt: string
		label: string
		mode?: string
		model?: string
		apiConfigurationOverride?: ProviderSettings
		parallelMode?: boolean
		teamRunId: string
		teamMemberId: string
		waveId: string
		roleType?: AgentTeamRoleType
		ownership?: AgentTeamOwnership
	}) => Promise<{ sessionId: string }>
	cancelSession?: (sessionId: string) => Promise<void> | void
	onStateUpdated?: (state: TeamRunState) => void
	onEvent?: (event: TeamRunEvent) => void
	log?: (message: string) => void
}

export interface StartTeamRunOptions {
	prompt: string
	mode?: string
	requestedModel?: string
}

export interface AgentTeamRunResult {
	run: TeamRun
	state: TeamRunState
}

export interface TeamSessionOutcome {
	sessionId: string
	outcome: "completed" | "failed" | "cancelled"
	source: "ask_completion_result" | "complete" | "cancel_session" | "error" | "interrupted" | "process_exit"
	message?: string
	exitCode?: number
	summary?: string
}

interface PromptContextSnapshot {
	handoffs: TeamHandoff[]
	blackboardEntries: TeamBlackboardEntry[]
	sections: string[]
}

const MAX_SUMMARY_LENGTH = 280

function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

function uniqueId(prefix: string, now: number, seed: string) {
	const suffix = slugify(seed).slice(0, 24) || Math.random().toString(36).slice(2, 8)
	return `${prefix}-${now}-${suffix}`
}

function summarizePrompt(prompt: string) {
	const cleaned = prompt.replace(/\s+/g, " ").trim()
	if (cleaned.length <= MAX_SUMMARY_LENGTH) {
		return cleaned
	}
	return `${cleaned.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
}

function normalizeOwnership(ownership?: AgentTeamOwnership, fallbackPath?: string): AgentTeamOwnership | undefined {
	const paths = ownership?.paths?.map((entry) => entry.trim()).filter(Boolean) ?? []
	if (fallbackPath) {
		paths.push(fallbackPath)
	}
	const uniquePaths = Array.from(new Set(paths))
	const summary = ownership?.summary?.trim()
	if (uniquePaths.length === 0 && !summary) {
		return undefined
	}
	return {
		paths: uniquePaths,
		summary: summary || undefined,
	}
}

function isMemberTerminal(status?: TeamRunMember["status"]) {
	return status === "done" || status === "error" || status === "stopped"
}

function toBlackboardEntry(params: {
	runId: string
	waveId?: string
	teamMemberId?: string
	sessionId?: string
	kind: TeamBlackboardEntry["kind"]
	title: string
	content?: string
	contentJson?: Record<string, unknown>
	tags?: string[]
	now: number
	consumedAt?: number
}): TeamBlackboardEntry {
	return {
		entryId: uniqueId("blackboard", params.now, `${params.kind}-${params.title}`),
		runId: params.runId,
		waveId: params.waveId,
		teamMemberId: params.teamMemberId,
		sessionId: params.sessionId,
		kind: params.kind,
		title: params.title,
		content: params.content,
		contentJson: params.contentJson,
		tags: params.tags,
		createdAt: params.now,
		updatedAt: params.now,
		consumedAt: params.consumedAt,
	}
}

export class AgentTeamCoordinator {
	private readonly getNow: () => number
	private state: TeamRunState = { runs: [], activeRunId: null }
	private readonly runPlans = new Map<string, { config: VcpAgentTeamConfig; options: StartTeamRunOptions }>()

	constructor(private readonly deps: AgentTeamCoordinatorDependencies) {
		this.getNow = deps.getNow ?? (() => Date.now())
	}

	public getState(): TeamRunState {
		return this.state
	}

	public async startRun(config: VcpAgentTeamConfig, options: StartTeamRunOptions): Promise<AgentTeamRunResult> {
		const now = this.getNow()
		const runId = uniqueId("team-run", now, options.prompt)
		const enabledMembers = (config.members ?? []).filter((member) => member.enabled !== false)
		const members = await this.resolveMembers(enabledMembers, options.requestedModel)
		const waves = this.createWaves(runId, config, members)

		const run: TeamRun = {
			runId,
			status: "running",
			prompt: options.prompt,
			createdAt: now,
			updatedAt: now,
			waveStrategy: config.waveStrategy,
			handoffFormat: config.handoffFormat,
			currentWaveId: waves[0]?.waveId,
			sourceSessionId: undefined,
			members,
			waves,
			handoffs: [],
			blackboard: [
				toBlackboardEntry({
					runId,
					kind: "note",
					title: "TaskSpec",
					content: summarizePrompt(options.prompt),
					contentJson: {
						prompt: options.prompt,
						mode: options.mode,
						waveStrategy: config.waveStrategy,
						handoffFormat: config.handoffFormat,
					},
					tags: ["task", "spec"],
					now,
				}),
			],
			approvals: [],
			error: undefined,
		}

		this.runPlans.set(runId, { config, options })
		this.setState({ runs: [run, ...this.state.runs.filter((entry) => entry.runId !== runId)], activeRunId: runId })
		this.emitEvent({
			eventId: uniqueId("team-event", now, `${runId}-started`),
			runId,
			kind: "run_started",
			createdAt: now,
			title: "Team run started",
			message: summarizePrompt(options.prompt),
		})

		if (waves.length === 0) {
			await this.completeRun(runId)
			return { run: this.requireRun(runId), state: this.state }
		}

		await this.launchWave(runId, waves[0].waveId)
		return { run: this.requireRun(runId), state: this.state }
	}

	public async handleSessionOutcome(outcome: TeamSessionOutcome): Promise<boolean> {
		const located = this.findMemberBySessionId(outcome.sessionId)
		if (!located) {
			return false
		}

		const run = this.requireRun(located.runId)
		if (run.status !== "running") {
			return false
		}

		const member = run.members.find((entry) => entry.teamMemberId === located.teamMemberId)
		const wave = run.waves.find((entry) => entry.waveId === located.waveId)
		if (!member || !wave) {
			return false
		}

		if (isMemberTerminal(member.status)) {
			return false
		}

		if (outcome.outcome === "completed") {
			await this.completeMember(run, wave, member, outcome)
			return true
		}

		if (outcome.outcome === "failed") {
			await this.failRun(run, wave, member, outcome)
			return true
		}

		await this.cancelRun(run, wave, member, outcome)
		return true
	}

	private async completeMember(
		run: TeamRun,
		wave: TeamWave,
		member: TeamRunMember,
		outcome: TeamSessionOutcome,
	): Promise<void> {
		const completedAt = this.getNow()
		member.status = "done"
		const handoff = this.publishMemberHandoff(run, wave, member, completedAt, outcome)
		const handoffEntry = this.publishHandoffEntry(run, wave, member, handoff, completedAt)
		this.persistRun(run)
		this.emitEvent({
			eventId: uniqueId("team-event", completedAt, `${member.teamMemberId}-completed`),
			runId: run.runId,
			waveId: wave.waveId,
			sessionId: outcome.sessionId,
			teamMemberId: member.teamMemberId,
			kind: "session_completed",
			createdAt: completedAt,
			title: `${member.name} completed`,
			message: handoff.summary,
			handoff,
			blackboardEntry: handoffEntry,
		})

		const waveMembers = this.getWaveMembers(run, wave)
		if (waveMembers.some((entry: TeamRunMember) => !isMemberTerminal(entry.status))) {
			await this.writeRunArtifacts(run)
			return
		}

		wave.status = "completed"
		wave.completedAt = completedAt
		wave.error = undefined
		run.updatedAt = completedAt
		this.persistRun(run)
		await this.writeRunArtifacts(run)

		const nextWave = run.waves.find((entry) => entry.index > wave.index && entry.status === "pending")
		if (nextWave) {
			await this.launchWave(run.runId, nextWave.waveId)
			return
		}

		await this.completeRun(run.runId)
	}

	private async failRun(
		run: TeamRun,
		wave: TeamWave,
		member: TeamRunMember,
		outcome: TeamSessionOutcome,
	): Promise<void> {
		const failedAt = this.getNow()
		const message = outcome.message || `Session failed (${outcome.source})`
		member.status = "error"
		wave.status = "failed"
		wave.completedAt = failedAt
		wave.error = message
		run.status = "failed"
		run.error = message
		run.currentWaveId = undefined
		run.updatedAt = failedAt
		this.persistRun(run)
		await this.writeRunArtifacts(run)
		this.emitEvent({
			eventId: uniqueId("team-event", failedAt, `${run.runId}-failed`),
			runId: run.runId,
			waveId: wave.waveId,
			sessionId: outcome.sessionId,
			teamMemberId: member.teamMemberId,
			kind: "run_failed",
			createdAt: failedAt,
			title: "Team run failed",
			message,
		})
		this.runPlans.delete(run.runId)
	}

	private async cancelRun(
		run: TeamRun,
		wave: TeamWave,
		member: TeamRunMember,
		outcome: TeamSessionOutcome,
	): Promise<void> {
		const cancelledAt = this.getNow()
		const message = outcome.message || `Session cancelled (${outcome.source})`
		for (const runMember of run.members) {
			if (!isMemberTerminal(runMember.status)) {
				runMember.status = "stopped"
			}
		}
		wave.status = "cancelled"
		wave.completedAt = cancelledAt
		wave.error = message
		for (const runWave of run.waves) {
			if (runWave.status !== "completed" && runWave.status !== "failed" && runWave.status !== "cancelled") {
				runWave.status = "cancelled"
				runWave.completedAt = cancelledAt
				runWave.error = message
			}
		}
		run.status = "cancelled"
		run.error = message
		run.currentWaveId = undefined
		run.updatedAt = cancelledAt
		this.persistRun(run)
		await this.writeRunArtifacts(run)
		this.emitEvent({
			eventId: uniqueId("team-event", cancelledAt, `${member.teamMemberId}-cancelled`),
			runId: run.runId,
			waveId: wave.waveId,
			sessionId: outcome.sessionId,
			teamMemberId: member.teamMemberId,
			kind: "member_cancelled",
			createdAt: cancelledAt,
			title: `${member.name} cancelled`,
			message,
		})
		this.emitEvent({
			eventId: uniqueId("team-event", cancelledAt, `${run.runId}-cancelled`),
			runId: run.runId,
			waveId: wave.waveId,
			sessionId: outcome.sessionId,
			teamMemberId: member.teamMemberId,
			kind: "run_cancelled",
			createdAt: cancelledAt,
			title: "Team run cancelled",
			message,
		})
		this.runPlans.delete(run.runId)
	}

	private async completeRun(runId: string): Promise<void> {
		const completedAt = this.getNow()
		const run = this.requireRun(runId)
		if (run.status !== "running") {
			return
		}
		run.status = "completed"
		run.error = undefined
		run.updatedAt = completedAt
		run.currentWaveId = undefined
		this.persistRun(run)
		await this.writeRunArtifacts(run)
		this.emitEvent({
			eventId: uniqueId("team-event", completedAt, `${runId}-completed`),
			runId,
			kind: "run_completed",
			createdAt: completedAt,
			title: "Team run completed",
		})
		this.runPlans.delete(runId)
	}

	/**
	 * Cancel an entire team run from external trigger (e.g. GUI).
	 * Stops all running member sessions and marks the run as cancelled.
	 */
	public async cancelTeamRun(runId: string): Promise<void> {
		const run = this.state.runs.find((entry) => entry.runId === runId)
		if (!run || run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
			return
		}

		const runningMembers = run.members.filter((member) => member.sessionId && member.status === "running")
		for (const member of runningMembers) {
			await this.cancelMemberSession(member, "Team run cancelled by user")
		}

		// If run is still not cancelled (e.g. no running members), force cancel
		// Re-check status as a string because handleSessionOutcome may have mutated it
		const currentStatus = run.status as string
		if (currentStatus !== "cancelled" && currentStatus !== "failed") {
			const currentWave = run.waves.find((w) => w.waveId === run.currentWaveId)
			if (currentWave) {
				// Build a synthetic member+outcome for the private cancelRun
				const anyMember = run.members[0]
				if (anyMember) {
					await this.cancelRun(run, currentWave, anyMember, {
						sessionId: anyMember.sessionId ?? "",
						outcome: "cancelled",
						source: "cancel_session",
						message: "Team run cancelled by user",
					})
				}
			}
		}
	}

	/**
	 * Cancel a single team member from external trigger (e.g. GUI).
	 */
	public async cancelTeamMember(runId: string, teamMemberId: string): Promise<void> {
		const run = this.state.runs.find((entry) => entry.runId === runId)
		if (!run) {
			return
		}

		const member = run.members.find((m) => m.teamMemberId === teamMemberId)
		if (!member || !member.sessionId || member.status !== "running") {
			return
		}

		const runningMembers = run.members.filter((entry) => entry.sessionId && entry.status === "running")
		await this.cancelMemberSession(member, "Team member cancelled by user")

		if ((run.status as string) === "cancelled") {
			for (const runningMember of runningMembers) {
				if (runningMember.teamMemberId !== member.teamMemberId && runningMember.sessionId) {
					await this.cancelMemberSession(runningMember, "Team run cancelled by user")
				}
			}
		}
	}

	private async cancelMemberSession(member: TeamRunMember, message: string): Promise<void> {
		if (!member.sessionId) {
			return
		}

		if (this.deps.cancelSession) {
			await this.deps.cancelSession(member.sessionId)
		}

		if (!isMemberTerminal(member.status)) {
			await this.handleSessionOutcome({
				sessionId: member.sessionId,
				outcome: "cancelled",
				source: "cancel_session",
				message,
			})
		}
	}

	public async resolveApproval(params: {
		runId: string
		approvalId: string
		approved: boolean
		reason?: string
	}): Promise<TeamApprovalRequest | undefined> {
		const run = this.state.runs.find((entry) => entry.runId === params.runId)
		if (!run) {
			return undefined
		}
		const approval = run.approvals.find((entry) => entry.approvalId === params.approvalId)
		if (!approval) {
			return undefined
		}
		if (approval.status !== "pending") {
			return approval
		}

		const resolvedAt = this.getNow()
		const reason = params.reason?.trim()
		approval.status = params.approved ? "approved" : "rejected"
		approval.resolvedAt = resolvedAt
		const approvalEntry = this.updateApprovalEntry(run, approval, resolvedAt, reason)

		if (!params.approved) {
			await this.rejectRunFromApproval(run, approval, resolvedAt, reason, approvalEntry)
			return approval
		}

		this.persistRun(run)
		this.emitEvent({
			eventId: uniqueId("team-event", resolvedAt, `${approval.approvalId}-approved`),
			runId: run.runId,
			waveId: approval.waveId,
			sessionId: approval.sessionId,
			teamMemberId: approval.teamMemberId,
			kind: "blackboard_updated",
			createdAt: resolvedAt,
			title: `Approval approved: ${approval.title}`,
			message: reason || "Execution resumed.",
			approval,
			blackboardEntry: approvalEntry,
		})
		await this.writeRunArtifacts(run)
		if (approval.waveId) {
			await this.launchWave(run.runId, approval.waveId)
		}
		return approval
	}

	private getWaveLaunchApproval(run: TeamRun, waveId: string): TeamApprovalRequest | undefined {
		return run.approvals.find(
			(entry) => entry.waveId === waveId && (entry.metadata?.gate as string | undefined) === "wave_launch",
		)
	}

	private shouldPauseForWaveApproval(
		run: TeamRun,
		wave: TeamWave,
		config: VcpAgentTeamConfig,
		waveMembers: TeamRunMember[],
	): boolean {
		const existingApproval = this.getWaveLaunchApproval(run, wave.waveId)
		if (existingApproval?.status === "approved") {
			return false
		}

		// Condition 1 (existing): No file separation + implement roles = conflict risk
		if (!config.requireFileSeparation) {
			const hasImplementRole = waveMembers.some((m) => m.roleType === "implement")
			if (hasImplementRole) {
				return true
			}
		}

		// Condition 2 (new): Wave with multiple members that have overlapping ownership
		if (waveMembers.length > 1) {
			const hasOverlap = this.detectOwnershipOverlap(waveMembers)
			if (hasOverlap) {
				return true
			}
		}

		return false
	}

	private detectOwnershipOverlap(members: TeamRunMember[]): boolean {
		const allPaths: Array<{ memberId: string; path: string }> = []
		for (const member of members) {
			if (member.ownership?.paths) {
				for (const p of member.ownership.paths) {
					allPaths.push({ memberId: member.teamMemberId, path: p })
				}
			}
		}
		// Check if any two members have paths that are prefixes of each other
		for (let i = 0; i < allPaths.length; i++) {
			for (let j = i + 1; j < allPaths.length; j++) {
				if (allPaths[i].memberId !== allPaths[j].memberId) {
					const a = allPaths[i].path.replace(/\\/g, "/")
					const b = allPaths[j].path.replace(/\\/g, "/")
					if (a.startsWith(b) || b.startsWith(a) || a === b) {
						return true
					}
				}
			}
		}
		return false
	}

	private async requestWaveApproval(
		run: TeamRun,
		wave: TeamWave,
		config: VcpAgentTeamConfig,
		waveMembers: TeamRunMember[],
	): Promise<TeamApprovalRequest> {
		const existingApproval = this.getWaveLaunchApproval(run, wave.waveId)
		if (existingApproval) {
			return existingApproval
		}

		const now = this.getNow()
		const memberNames = waveMembers.map((member) => member.name)
		const memberIds = waveMembers.map((member) => member.teamMemberId)
		const roleTypes = waveMembers.map((member) => member.roleType ?? "general")
		const approval: TeamApprovalRequest = {
			approvalId: uniqueId("approval", now, `${run.runId}-${wave.waveId}`),
			runId: run.runId,
			waveId: wave.waveId,
			status: "pending",
			kind: "external",
			title: `Approve ${wave.label} launch`,
			message: `Wave launch is paused because implement-role members will run without file separation: ${memberNames.join(
				", ",
			)}. Approve to continue.`,
			metadata: {
				gate: "wave_launch",
				strategy: wave.strategy,
				requireFileSeparation: config.requireFileSeparation,
				memberIds,
				memberNames,
				roleTypes,
			},
			createdAt: now,
		}
		const approvalEntry = toBlackboardEntry({
			runId: run.runId,
			waveId: wave.waveId,
			kind: "approval",
			title: approval.title,
			content: approval.message,
			contentJson: {
				approvalId: approval.approvalId,
				status: approval.status,
				...approval.metadata,
			},
			tags: ["approval", "wave_launch", wave.waveId, approval.status],
			now,
		})
		run.currentWaveId = wave.waveId
		run.updatedAt = now
		run.approvals.unshift(approval)
		run.blackboard.unshift(approvalEntry)
		this.persistRun(run)
		this.emitEvent({
			eventId: uniqueId("team-event", now, `${approval.approvalId}-requested`),
			runId: run.runId,
			waveId: wave.waveId,
			kind: "approval_requested",
			createdAt: now,
			title: approval.title,
			message: approval.message,
			approval,
			blackboardEntry: approvalEntry,
		})
		await this.writeRunArtifacts(run)
		return approval
	}

	private updateApprovalEntry(
		run: TeamRun,
		approval: TeamApprovalRequest,
		now: number,
		reason?: string,
	): TeamBlackboardEntry | undefined {
		const approvalEntry = run.blackboard.find((entry: TeamBlackboardEntry) => {
			const contentJson = entry.contentJson as Record<string, unknown> | undefined
			return entry.kind === "approval" && contentJson?.approvalId === approval.approvalId
		})
		if (!approvalEntry) {
			return undefined
		}

		approvalEntry.content = approval.message
		approvalEntry.updatedAt = now
		approvalEntry.consumedAt = now
		approvalEntry.contentJson = {
			...(approvalEntry.contentJson ?? {}),
			approvalId: approval.approvalId,
			status: approval.status,
			resolvedAt: approval.resolvedAt,
			reason: reason || undefined,
		}
		approvalEntry.tags = Array.from(
			new Set([
				...(approvalEntry.tags ?? []).filter(
					(tag: string) => !["pending", "approved", "rejected"].includes(tag),
				),
				approval.status,
			]),
		)
		return approvalEntry
	}

	private async rejectRunFromApproval(
		run: TeamRun,
		approval: TeamApprovalRequest,
		rejectedAt: number,
		reason: string | undefined,
		approvalEntry: TeamBlackboardEntry | undefined,
	): Promise<void> {
		const message = reason ? `Team approval rejected: ${reason}` : `Team approval rejected for ${approval.title}`
		const wave = approval.waveId ? run.waves.find((entry) => entry.waveId === approval.waveId) : undefined
		if (wave && wave.status === "pending") {
			wave.status = "cancelled"
			wave.completedAt = rejectedAt
			wave.error = message
		}
		for (const member of run.members) {
			if (!isMemberTerminal(member.status) && !member.sessionId) {
				member.status = "stopped"
			}
		}
		run.status = "cancelled"
		run.error = message
		run.currentWaveId = undefined
		run.updatedAt = rejectedAt
		this.persistRun(run)
		this.emitEvent({
			eventId: uniqueId("team-event", rejectedAt, `${approval.approvalId}-rejected`),
			runId: run.runId,
			waveId: approval.waveId,
			sessionId: approval.sessionId,
			teamMemberId: approval.teamMemberId,
			kind: "blackboard_updated",
			createdAt: rejectedAt,
			title: `Approval rejected: ${approval.title}`,
			message,
			approval,
			blackboardEntry: approvalEntry,
		})
		this.emitEvent({
			eventId: uniqueId("team-event", rejectedAt, `${run.runId}-approval-cancelled`),
			runId: run.runId,
			waveId: approval.waveId,
			kind: "run_cancelled",
			createdAt: rejectedAt,
			title: "Team run cancelled",
			message,
		})
		await this.writeRunArtifacts(run)
		this.runPlans.delete(run.runId)
	}

	private async resolveMembers(members: VcpAgentTeamMember[], requestedModel?: string): Promise<TeamRunMember[]> {
		const providerState = await this.deps.readProviderState()
		const metaEntries = providerState.listApiConfigMeta ?? []
		const results: TeamRunMember[] = []

		for (const [index, member] of members.entries()) {
			const teamMemberId = member.id || member.name || `member-${index + 1}`
			let providerId = member.providerID
			let modelId = requestedModel || member.modelID

			if (member.apiConfigId) {
				const matchingMeta = metaEntries.find((entry) => entry.id === member.apiConfigId)
				if (matchingMeta?.apiProvider) {
					providerId = matchingMeta.apiProvider
				}
				if (matchingMeta?.modelId) {
					modelId = requestedModel || matchingMeta.modelId
				}
			}

			results.push({
				teamMemberId,
				name: member.name || teamMemberId,
				apiConfigId: member.apiConfigId,
				providerId,
				modelId,
				rolePrompt: member.rolePrompt,
				roleType: member.roleType,
				ownership: normalizeOwnership(member.ownership),
				sessionId: undefined,
				status: "creating",
			})
		}

		return results
	}

	private async resolveApiConfigurationOverride(member: TeamRunMember): Promise<ProviderSettings | undefined> {
		if (!member.apiConfigId) {
			return undefined
		}

		try {
			const profile = await this.deps.resolveProviderProfile({ id: member.apiConfigId })
			const override = { ...profile }
			delete (override as Record<string, unknown>).name
			return override
		} catch (error) {
			this.deps.log?.(
				`[AgentTeamCoordinator] Failed to resolve provider profile '${member.apiConfigId}': ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			return undefined
		}
	}

	private createWaves(runId: string, config: VcpAgentTeamConfig, members: TeamRunMember[]): TeamWave[] {
		const maxParallel = Math.max(1, config.maxParallel || 1)
		const groups: TeamRunMember[][] = []

		if (config.waveStrategy === "parallel") {
			groups.push(members)
		} else if (config.waveStrategy === "adaptive") {
			for (let index = 0; index < members.length; index += maxParallel) {
				groups.push(members.slice(index, index + maxParallel))
			}
		} else {
			for (const member of members) {
				groups.push([member])
			}
		}

		return groups.map((group, index) => ({
			waveId: uniqueId("wave", this.getNow() + index, `${runId}-${index + 1}`),
			runId,
			label: `Wave ${index + 1}`,
			index,
			status: "pending",
			strategy: config.waveStrategy,
			teamMemberIds: group.map((member) => member.teamMemberId),
			sessionIds: [],
			startedAt: undefined,
			completedAt: undefined,
			error: undefined,
		}))
	}

	private async launchWave(runId: string, waveId: string): Promise<void> {
		const plan = this.runPlans.get(runId)
		if (!plan) {
			throw new Error(`Missing run plan for ${runId}`)
		}

		const run = this.requireRun(runId)
		const wave = run.waves.find((entry) => entry.waveId === waveId)
		if (!wave || wave.status !== "pending" || run.status !== "running") {
			return
		}

		const waveMembers = this.getWaveMembers(run, wave)
		if (this.shouldPauseForWaveApproval(run, wave, plan.config, waveMembers)) {
			await this.requestWaveApproval(run, wave, plan.config, waveMembers)
			return
		}

		const startedAt = this.getNow()
		wave.status = "running"
		wave.startedAt = startedAt
		wave.completedAt = undefined
		wave.error = undefined
		run.currentWaveId = wave.waveId
		run.updatedAt = startedAt
		this.persistRun(run)
		this.emitEvent({
			eventId: uniqueId("team-event", startedAt, `${wave.waveId}-started`),
			runId,
			waveId: wave.waveId,
			kind: "wave_started",
			createdAt: startedAt,
			title: `Wave started: ${wave.label}`,
			message: `${wave.teamMemberIds.length} member(s)`,
		})

		const promptContexts = new Map<string, PromptContextSnapshot>()
		for (const teamMemberId of wave.teamMemberIds) {
			const member = run.members.find((entry) => entry.teamMemberId === teamMemberId)
			if (!member) {
				continue
			}
			promptContexts.set(teamMemberId, this.collectPromptContext(run, wave, member))
		}

		// Resolve all member launch contexts upfront (before any concurrent launch)
		const memberLaunchTasks: Array<{
			member: TeamRunMember
			promptContext: PromptContextSnapshot
		}> = []
		for (const teamMemberId of wave.teamMemberIds) {
			const member = run.members.find((entry) => entry.teamMemberId === teamMemberId)
			if (!member || run.status !== "running") {
				continue
			}
			const promptContext = promptContexts.get(teamMemberId) ?? this.collectPromptContext(run, wave, member)
			memberLaunchTasks.push({ member, promptContext })
		}

		const isParallel = wave.strategy === "parallel" || wave.strategy === "adaptive"

		if (isParallel && memberLaunchTasks.length > 1) {
			// Parallel launch: all members in this wave start concurrently
			const results = await Promise.allSettled(
				memberLaunchTasks.map(({ member, promptContext }) =>
					this.launchMember(run, wave, member, plan, promptContext),
				),
			)
			// Check for failures
			const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
			if (failures.length > 0) {
				const firstError = failures[0].reason
				// If any member failed to launch, fail the run
				const failedMember =
					memberLaunchTasks.find(({ member }) => !member.sessionId)?.member ?? memberLaunchTasks[0].member
				await this.failRun(run, wave, failedMember, {
					sessionId: failedMember.sessionId ?? `${runId}:${failedMember.teamMemberId}`,
					outcome: "failed",
					source: "process_exit",
					message: firstError instanceof Error ? firstError.message : String(firstError),
				})
				throw firstError
			}
		} else {
			// Sequential launch: one member at a time
			for (const { member, promptContext } of memberLaunchTasks) {
				try {
					await this.launchMember(run, wave, member, plan, promptContext)
				} catch (error) {
					await this.failRun(run, wave, member, {
						sessionId: member.sessionId ?? `${runId}:${member.teamMemberId}`,
						outcome: "failed",
						source: "process_exit",
						message: error instanceof Error ? error.message : String(error),
					})
					throw error
				}
			}
		}

		await this.writeRunArtifacts(run)
	}

	private async launchMember(
		run: TeamRun,
		wave: TeamWave,
		member: TeamRunMember,
		plan: { config: VcpAgentTeamConfig; options: StartTeamRunOptions },
		promptContext: PromptContextSnapshot,
	): Promise<void> {
		if (run.status !== "running") {
			return
		}

		const launchTime = this.getNow()
		const ownership = normalizeOwnership(
			member.ownership,
			plan.config.requireFileSeparation ? `.snow/agent-team/${run.runId}/${member.teamMemberId}` : undefined,
		)
		const apiConfigurationOverride = await this.resolveApiConfigurationOverride(member)
		const launchPrompt = this.buildMemberPrompt(
			run,
			wave,
			member,
			plan.config,
			plan.options,
			ownership,
			promptContext,
		)

		const launched = await this.deps.launchSession({
			prompt: launchPrompt,
			label: `${member.name} · ${wave.label}`,
			mode: plan.options.mode,
			model: member.modelId,
			apiConfigurationOverride,
			parallelMode: plan.config.requireFileSeparation,
			teamRunId: run.runId,
			teamMemberId: member.teamMemberId,
			waveId: wave.waveId,
			roleType: member.roleType,
			ownership,
		})
		member.sessionId = launched.sessionId
		member.status = "running"
		member.ownership = ownership
		wave.sessionIds.push(launched.sessionId)
		this.consumePromptContext(run, promptContext, {
			now: this.getNow(),
			teamMemberId: member.teamMemberId,
			sessionId: launched.sessionId,
		})
		this.persistRun(run)
		this.emitEvent({
			eventId: uniqueId("team-event", launchTime, `${member.teamMemberId}-launched`),
			runId: run.runId,
			waveId: wave.waveId,
			sessionId: launched.sessionId,
			teamMemberId: member.teamMemberId,
			kind: "member_launched",
			createdAt: launchTime,
			title: `${member.name} launched`,
			message: `${member.providerId ?? "unknown"}/${member.modelId ?? "unknown"}`,
		})
	}

	private buildMemberPrompt(
		run: TeamRun,
		wave: TeamWave,
		member: TeamRunMember,
		config: VcpAgentTeamConfig,
		options: StartTeamRunOptions,
		ownership: AgentTeamOwnership | undefined,
		promptContext: PromptContextSnapshot,
	) {
		let ownershipText: string
		if (ownership) {
			const pathsList = (ownership.paths ?? []).map((p) => `- ${p}`).join("\n")
			ownershipText = [
				"## Ownership Constraints (MANDATORY)",
				"",
				"You are assigned to the following file/path scope. You MUST NOT create, modify, or delete files outside these paths:",
				pathsList || "- (no paths specified)",
				"",
				ownership.summary ? `Scope description: ${ownership.summary}` : "",
				"",
				"If you need to modify files outside your assigned scope, you must clearly state this limitation in your response and suggest the coordinator handle it in a subsequent wave.",
			]
				.filter((line) => line !== undefined)
				.join("\n")
		} else {
			ownershipText = "Ownership:\n- No explicit ownership assigned."
		}

		let fileSeparationText: string | undefined
		if (config.requireFileSeparation) {
			fileSeparationText = [
				"## File Separation Policy (ENFORCED)",
				"",
				"This team run enforces strict file separation between members. Each member works in an isolated workspace (worktree). DO NOT attempt to modify files that belong to other team members' ownership scope.",
			].join("\n")
		}

		return [
			`Team Run ID: ${run.runId}`,
			`Wave: ${wave.label}`,
			`Member: ${member.name}`,
			`Role Type: ${member.roleType ?? "general"}`,
			`Requested Mode: ${options.mode ?? "code"}`,
			`Canonical handoff format: ${config.handoffFormat}`,
			ownershipText,
			member.rolePrompt?.trim() ? `Role instructions:\n${member.rolePrompt.trim()}` : undefined,
			promptContext.sections.length > 0 ? promptContext.sections.join("\n\n") : undefined,
			`Task objective:\n${options.prompt}`,
			fileSeparationText,
		]
			.filter(Boolean)
			.join("\n\n")
	}

	private collectPromptContext(run: TeamRun, wave: TeamWave, member: TeamRunMember): PromptContextSnapshot {
		const handoffs = run.handoffs
			.filter(
				(entry) =>
					entry.status === "published" &&
					!entry.consumedAt &&
					entry.fromTeamMemberId !== member.teamMemberId &&
					entry.waveId !== wave.waveId,
			)
			.slice(0, 5)

		const blackboardEntries = run.blackboard
			.filter(
				(entry) =>
					entry.kind !== "handoff" &&
					entry.title !== "TaskSpec" &&
					!entry.consumedAt &&
					entry.teamMemberId !== member.teamMemberId,
			)
			.slice(0, 5)

		const sections: string[] = []
		if (handoffs.length > 0) {
			sections.push(
				`Unread handoffs:\n${handoffs.map((entry) => `- ${entry.title}: ${entry.summary}`).join("\n")}`,
			)
		}
		if (blackboardEntries.length > 0) {
			sections.push(
				`Shared summaries:\n${blackboardEntries
					.map(
						(entry) =>
							`- ${entry.title}: ${
								entry.content ?? summarizePrompt(JSON.stringify(entry.contentJson ?? {}))
							}`,
					)
					.join("\n")}`,
			)
		}

		return { handoffs, blackboardEntries, sections }
	}

	private consumePromptContext(
		run: TeamRun,
		promptContext: PromptContextSnapshot,
		params: { now: number; teamMemberId: string; sessionId: string },
	) {
		for (const handoff of promptContext.handoffs) {
			const target = run.handoffs.find((entry) => entry.handoffId === handoff.handoffId)
			if (!target || target.consumedAt) {
				continue
			}
			target.status = "consumed"
			target.consumedAt = params.now
			target.toTeamMemberId = target.toTeamMemberId ?? params.teamMemberId
			target.toSessionId = target.toSessionId ?? params.sessionId
		}

		for (const entry of promptContext.blackboardEntries) {
			const target = run.blackboard.find((blackboardEntry) => blackboardEntry.entryId === entry.entryId)
			if (!target || target.consumedAt) {
				continue
			}
			target.consumedAt = params.now
			target.updatedAt = params.now
		}

		for (const handoff of promptContext.handoffs) {
			const linkedEntry = run.blackboard.find((entry) => {
				const contentJson = entry.contentJson as Record<string, unknown> | undefined
				return contentJson?.handoffId === handoff.handoffId
			})
			if (!linkedEntry || linkedEntry.consumedAt) {
				continue
			}
			linkedEntry.consumedAt = params.now
			linkedEntry.updatedAt = params.now
		}
	}

	private publishMemberHandoff(
		run: TeamRun,
		wave: TeamWave,
		member: TeamRunMember,
		now: number,
		outcome: TeamSessionOutcome,
	): TeamHandoff {
		const summary = summarizePrompt(
			outcome.summary || outcome.message || `${member.name} completed ${wave.label} in ${run.waveStrategy} mode.`,
		)
		const handoff: TeamHandoff = {
			handoffId: uniqueId("handoff", now, `${run.runId}-${member.teamMemberId}`),
			runId: run.runId,
			waveId: wave.waveId,
			fromTeamMemberId: member.teamMemberId,
			toTeamMemberId: undefined,
			fromSessionId: member.sessionId,
			toSessionId: undefined,
			status: "published",
			title: `${member.name} handoff`,
			summary,
			canonical: {
				runId: run.runId,
				waveId: wave.waveId,
				memberId: member.teamMemberId,
				sessionId: member.sessionId,
				ownership: member.ownership,
				status: member.status,
				source: outcome.source,
				exitCode: outcome.exitCode,
				summary,
			},
			renderedText: summary,
			createdAt: now,
			consumedAt: undefined,
		}
		run.handoffs.unshift(handoff)
		return handoff
	}

	private publishHandoffEntry(
		run: TeamRun,
		wave: TeamWave,
		member: TeamRunMember,
		handoff: TeamHandoff,
		now: number,
	): TeamBlackboardEntry {
		const handoffEntry = toBlackboardEntry({
			runId: run.runId,
			waveId: wave.waveId,
			teamMemberId: member.teamMemberId,
			sessionId: member.sessionId,
			kind: "handoff",
			title: handoff.title,
			content: handoff.summary,
			contentJson: {
				handoffId: handoff.handoffId,
				...handoff.canonical,
			},
			tags: ["handoff", member.teamMemberId],
			now,
		})
		run.blackboard.unshift(handoffEntry)
		return handoffEntry
	}

	private getWaveMembers(run: TeamRun, wave: TeamWave) {
		return wave.teamMemberIds
			.map((teamMemberId: string) =>
				run.members.find((entry: TeamRunMember) => entry.teamMemberId === teamMemberId),
			)
			.filter((entry): entry is TeamRunMember => Boolean(entry))
	}

	private findMemberBySessionId(sessionId: string) {
		for (const run of this.state.runs) {
			for (const wave of run.waves) {
				const member = run.members.find(
					(entry) => entry.sessionId === sessionId && wave.teamMemberIds.includes(entry.teamMemberId),
				)
				if (member) {
					return { runId: run.runId, waveId: wave.waveId, teamMemberId: member.teamMemberId }
				}
			}
		}
		return undefined
	}

	private requireRun(runId: string): TeamRun {
		const run = this.state.runs.find((entry) => entry.runId === runId)
		if (!run) {
			throw new Error(`Unknown team run: ${runId}`)
		}
		return run
	}

	private persistRun(run: TeamRun) {
		run.updatedAt = this.getNow()
		this.state = {
			...this.state,
			runs: this.state.runs.map((entry) => (entry.runId === run.runId ? { ...run } : entry)),
			activeRunId: run.status === "running" ? run.runId : this.state.activeRunId,
		}
		this.deps.onStateUpdated?.(this.state)
	}

	private setState(state: TeamRunState) {
		this.state = state
		this.deps.onStateUpdated?.(this.state)
	}

	private emitEvent(event: TeamRunEvent) {
		this.deps.onEvent?.(event)
	}

	private async writeRunArtifacts(run: TeamRun) {
		const baseDir = path.join(this.deps.workspacePath, ".snow", "agent-team", run.runId)
		await fs.mkdir(baseDir, { recursive: true })
		await fs.writeFile(path.join(baseDir, "run.json"), JSON.stringify(run, null, 2), "utf8")
		await fs.writeFile(
			path.join(baseDir, "summary.json"),
			JSON.stringify(
				{
					runId: run.runId,
					status: run.status,
					prompt: summarizePrompt(run.prompt),
					currentWaveId: run.currentWaveId,
					members: run.members.map((member) => ({
						teamMemberId: member.teamMemberId,
						name: member.name,
						roleType: member.roleType,
						sessionId: member.sessionId,
						ownership: member.ownership,
						status: member.status,
					})),
				},
				null,
				2,
			),
			"utf8",
		)
	}
}

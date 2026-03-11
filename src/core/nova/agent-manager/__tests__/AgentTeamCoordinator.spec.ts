import { describe, expect, it, vi } from "vitest"
import type { VcpAgentTeamConfig } from "@roo-code/types"
import { AgentTeamCoordinator } from "../AgentTeamCoordinator"

const baseConfig: VcpAgentTeamConfig = {
	enabled: true,
	waveStrategy: "adaptive",
	handoffFormat: "json",
	maxParallel: 1,
	requireFileSeparation: false,
	members: [
		{
			id: "researcher",
			name: "Researcher",
			providerID: "novacode",
			modelID: "model-a",
			rolePrompt: "Research the task and report findings.",
			enabled: true,
			roleType: "research",
			ownership: { paths: ["src/a.ts"], summary: "Research ownership" },
		},
		{
			id: "implementer",
			name: "Implementer",
			providerID: "novacode",
			modelID: "model-b",
			rolePrompt: "Implement the approved plan.",
			enabled: true,
			roleType: "implement",
			ownership: { paths: ["src/b.ts"], summary: "Implement ownership" },
		},
	],
}

describe("AgentTeamCoordinator", () => {
	it("does not mark members done until real session outcome arrives and pauses implement waves behind approval", async () => {
		const events: Array<{ kind?: string; approval?: { approvalId?: string; status?: string } }> = []
		const launchSession = vi
			.fn()
			.mockResolvedValueOnce({ sessionId: "session-research" })
			.mockResolvedValueOnce({ sessionId: "session-implement" })
		const coordinator = new AgentTeamCoordinator({
			workspacePath: "C:/project/vcpcode",
			readProviderState: async () => ({ listApiConfigMeta: [] }),
			resolveProviderProfile: async () => ({ name: "default" }) as any,
			launchSession,
			onEvent: (event) => events.push(event),
		})

		await coordinator.startRun(baseConfig, { prompt: "Ship feature", mode: "agent_team" })
		let run = coordinator.getState().runs[0]
		expect(run.members[0]?.status).toBe("running")
		expect(run.members[1]?.status).toBe("creating")
		expect(run.handoffs).toHaveLength(0)
		expect(launchSession).toHaveBeenCalledTimes(1)

		const firstPrompt = launchSession.mock.calls[0]?.[0]?.prompt as string
		expect(firstPrompt).not.toContain("Unread handoffs")

		await coordinator.handleSessionOutcome({
			sessionId: "session-research",
			outcome: "completed",
			source: "ask_completion_result",
			summary: "Research summary",
		})

		run = coordinator.getState().runs[0]
		expect(run.members[0]?.status).toBe("done")
		expect(run.waves[0]?.status).toBe("completed")
		expect(run.waves[1]?.status).toBe("pending")
		expect(run.members[1]?.status).toBe("creating")
		expect(run.handoffs).toHaveLength(1)
		expect(run.handoffs[0]?.status).toBe("published")
		expect(run.handoffs[0]?.consumedAt).toBeUndefined()
		expect(run.approvals).toHaveLength(1)
		const approval = run.approvals[0]
		expect(approval?.status).toBe("pending")
		expect(approval?.waveId).toBe(run.waves[1]?.waveId)
		const pendingApprovalEntry = run.blackboard.find((entry) => entry.kind === "approval")
		expect((pendingApprovalEntry?.contentJson as Record<string, unknown> | undefined)?.approvalId).toBe(
			approval?.approvalId,
		)
		expect((pendingApprovalEntry?.contentJson as Record<string, unknown> | undefined)?.status).toBe("pending")
		expect(
			events.some(
				(event) => event.kind === "approval_requested" && event.approval?.approvalId === approval?.approvalId,
			),
		).toBe(true)
		expect(launchSession).toHaveBeenCalledTimes(1)

		await coordinator.resolveApproval({
			runId: run.runId,
			approvalId: approval!.approvalId,
			approved: true,
			reason: "Proceed",
		})

		run = coordinator.getState().runs[0]
		expect(run.approvals[0]?.status).toBe("approved")
		expect(run.members[1]?.status).toBe("running")
		expect(run.waves[1]?.status).toBe("running")
		const resolvedApprovalEntry = run.blackboard.find((entry) => entry.kind === "approval")
		expect((resolvedApprovalEntry?.contentJson as Record<string, unknown> | undefined)?.status).toBe("approved")
		expect(resolvedApprovalEntry?.consumedAt).toBeTypeOf("number")
		expect(
			events.some((event) => event.kind === "blackboard_updated" && event.approval?.status === "approved"),
		).toBe(true)

		const secondPrompt = launchSession.mock.calls[1]?.[0]?.prompt as string
		expect(secondPrompt).toContain("Unread handoffs")
		expect(secondPrompt).toContain("Researcher handoff")
		expect(secondPrompt).toContain("Research summary")

		await coordinator.handleSessionOutcome({
			sessionId: "session-implement",
			outcome: "completed",
			source: "complete",
			summary: "Implemented successfully",
		})

		run = coordinator.getState().runs[0]
		expect(run.status).toBe("completed")
		expect(run.currentWaveId).toBeUndefined()
		expect(run.waves.every((wave) => wave.status === "completed")).toBe(true)
	})

	it("captures wave prompt context snapshot before later launches consume it", async () => {
		const parallelConfig: VcpAgentTeamConfig = {
			...baseConfig,
			waveStrategy: "parallel",
			maxParallel: 2,
			requireFileSeparation: true,
		}
		const launchSession = vi
			.fn()
			.mockResolvedValueOnce({ sessionId: "session-research" })
			.mockResolvedValueOnce({ sessionId: "session-implement" })
		const coordinator = new AgentTeamCoordinator({
			workspacePath: "C:/project/vcpcode",
			readProviderState: async () => ({ listApiConfigMeta: [] }),
			resolveProviderProfile: async () => ({ name: "default" }) as any,
			launchSession,
		})

		await coordinator.startRun(parallelConfig, { prompt: "Ship feature", mode: "agent_team" })

		let run = coordinator.getState().runs[0]
		expect(run.waves).toHaveLength(1)
		expect(run.waves[0]?.status).toBe("running")
		expect(run.members[0]?.status).toBe("running")
		expect(run.members[1]?.status).toBe("running")
		expect(run.handoffs).toHaveLength(0)
		expect(launchSession).toHaveBeenCalledTimes(2)

		const firstPrompt = launchSession.mock.calls[0]?.[0]?.prompt as string
		const secondPrompt = launchSession.mock.calls[1]?.[0]?.prompt as string
		expect(firstPrompt).not.toContain("Unread handoffs")
		expect(secondPrompt).not.toContain("Unread handoffs")

		await coordinator.handleSessionOutcome({
			sessionId: "session-research",
			outcome: "completed",
			source: "ask_completion_result",
			summary: "Research summary",
		})

		run = coordinator.getState().runs[0]
		expect(run.waves[0]?.status).toBe("running")
		expect(run.handoffs).toHaveLength(1)
		expect(run.handoffs[0]?.status).toBe("published")
		expect(run.handoffs[0]?.consumedAt).toBeUndefined()

		await coordinator.handleSessionOutcome({
			sessionId: "session-implement",
			outcome: "completed",
			source: "complete",
			summary: "Implemented successfully",
		})

		run = coordinator.getState().runs[0]
		expect(run.status).toBe("completed")
		expect(run.waves[0]?.status).toBe("completed")
	})

	it("enables worktree mode and fallback ownership when requireFileSeparation is enabled", async () => {
		const separatedConfig: VcpAgentTeamConfig = {
			...baseConfig,
			requireFileSeparation: true,
			members: [
				{
					...baseConfig.members[0],
					ownership: undefined,
				},
			],
		}
		const launchSession = vi.fn().mockResolvedValue({ sessionId: "session-separated" })
		const coordinator = new AgentTeamCoordinator({
			workspacePath: "C:/project/vcpcode",
			readProviderState: async () => ({ listApiConfigMeta: [] }),
			resolveProviderProfile: async () => ({ name: "default" }) as any,
			launchSession,
		})

		await coordinator.startRun(separatedConfig, { prompt: "Ship feature", mode: "agent_team" })

		expect(launchSession).toHaveBeenCalledWith(
			expect.objectContaining({
				parallelMode: true,
				ownership: {
					paths: [expect.stringContaining(".snow/agent-team/")],
					summary: undefined,
				},
			}),
		)
	})

	it("cancels a pending run when approval is rejected", async () => {
		const events: Array<{ kind?: string; approval?: { status?: string } }> = []
		const launchSession = vi.fn()
		const coordinator = new AgentTeamCoordinator({
			workspacePath: "C:/project/vcpcode",
			readProviderState: async () => ({ listApiConfigMeta: [] }),
			resolveProviderProfile: async () => ({ name: "default" }) as any,
			launchSession,
			onEvent: (event) => events.push(event),
		})

		await coordinator.startRun(
			{
				...baseConfig,
				members: [baseConfig.members[1]],
			},
			{ prompt: "Ship guarded feature", mode: "agent_team" },
		)

		let run = coordinator.getState().runs[0]
		expect(launchSession).not.toHaveBeenCalled()
		expect(run.status).toBe("running")
		expect(run.waves[0]?.status).toBe("pending")
		expect(run.approvals).toHaveLength(1)

		const approval = run.approvals[0]!
		const resolved = await coordinator.resolveApproval({
			runId: run.runId,
			approvalId: approval.approvalId,
			approved: false,
			reason: "Unsafe overlap",
		})

		expect(resolved?.status).toBe("rejected")
		run = coordinator.getState().runs[0]
		expect(run.status).toBe("cancelled")
		expect(run.error).toContain("Unsafe overlap")
		expect(run.currentWaveId).toBeUndefined()
		expect(run.waves[0]?.status).toBe("cancelled")
		expect(run.members[0]?.status).toBe("stopped")
		const approvalEntry = run.blackboard.find((entry) => entry.kind === "approval")
		expect((approvalEntry?.contentJson as Record<string, unknown> | undefined)?.status).toBe("rejected")
		expect(approvalEntry?.consumedAt).toBeTypeOf("number")
		expect(events.some((event) => event.kind === "approval_requested")).toBe(true)
		expect(
			events.some((event) => event.kind === "blackboard_updated" && event.approval?.status === "rejected"),
		).toBe(true)
		expect(events.some((event) => event.kind === "run_cancelled")).toBe(true)
	})

	it("marks run failed on failed session outcome", async () => {
		const coordinator = new AgentTeamCoordinator({
			workspacePath: "C:/project/vcpcode",
			readProviderState: async () => ({ listApiConfigMeta: [] }),
			resolveProviderProfile: async () => ({ name: "default" }) as any,
			launchSession: async () => ({ sessionId: "session-research" }),
		})

		await coordinator.startRun(
			{
				...baseConfig,
				members: [baseConfig.members[0]],
			},
			{ prompt: "Fail feature", mode: "agent_team" },
		)

		const handled = await coordinator.handleSessionOutcome({
			sessionId: "session-research",
			outcome: "failed",
			source: "error",
			message: "boom",
		})

		expect(handled).toBe(true)
		const run = coordinator.getState().runs[0]
		expect(run.status).toBe("failed")
		expect(run.error).toBe("boom")
		expect(run.waves[0]?.status).toBe("failed")
		expect(run.members[0]?.status).toBe("error")
	})
})

import { beforeEach, describe, expect, it } from "vitest"
import { createStore } from "jotai"

import {
	appendTeamRunEventAtom,
	currentTeamRunAtom,
	normalizeTeamRunState,
	setTeamRunStateAtom,
	teamRunEventsAtom,
} from "../atoms/teamRun"

const createBaseState = () =>
	normalizeTeamRunState({
		activeRunId: "run-1",
		runs: [
			{
				runId: "run-1",
				status: "pending",
				prompt: "Ship feature",
				createdAt: 1,
				updatedAt: 1,
				waveStrategy: "parallel",
				handoffFormat: "markdown",
				members: [],
				waves: [],
				handoffs: [],
				blackboard: [],
				approvals: [],
			},
		],
	})

describe("teamRun atoms", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		store.set(setTeamRunStateAtom, createBaseState())
	})

	it("maps run_failed events to a failed run status", () => {
		store.set(appendTeamRunEventAtom, {
			eventId: "event-failed",
			runId: "run-1",
			kind: "run_failed",
			createdAt: 50,
			title: "Run failed",
			message: "boom",
		})

		expect(store.get(currentTeamRunAtom)?.status).toBe("failed")
		expect(store.get(currentTeamRunAtom)?.updatedAt).toBe(50)
		expect(store.get(teamRunEventsAtom)[0]?.kind).toBe("run_failed")
	})

	it("maps run_cancelled events to a cancelled run status", () => {
		store.set(appendTeamRunEventAtom, {
			eventId: "event-cancelled",
			runId: "run-1",
			kind: "run_cancelled",
			createdAt: 75,
			title: "Run cancelled",
			message: "user stopped the run",
		})

		expect(store.get(currentTeamRunAtom)?.status).toBe("cancelled")
		expect(store.get(currentTeamRunAtom)?.updatedAt).toBe(75)
		expect(store.get(teamRunEventsAtom)[0]?.kind).toBe("run_cancelled")
	})

	it("retains consumedAt for handoffs and blackboard entries during normalization", () => {
		const state = normalizeTeamRunState({
			activeRunId: "run-1",
			runs: [
				{
					runId: "run-1",
					status: "running",
					prompt: "Coordinate handoff",
					createdAt: 10,
					updatedAt: 10,
					waveStrategy: "sequential",
					handoffFormat: "markdown",
					members: [],
					waves: [],
					handoffs: [
						{
							handoffId: "handoff-consumed",
							runId: "run-1",
							fromTeamMemberId: "member-1",
							status: "consumed",
							title: "Research handoff",
							summary: "Use the validated API",
							canonical: {},
							createdAt: 11,
							consumedAt: 21,
						},
						{
							handoffId: "handoff-invalid",
							runId: "run-1",
							fromTeamMemberId: "member-2",
							status: "published",
							title: "Pending handoff",
							summary: "Waiting for pickup",
							canonical: {},
							createdAt: 12,
							consumedAt: "not-a-number",
						},
					],
					blackboard: [
						{
							entryId: "decision-1",
							runId: "run-1",
							kind: "decision",
							title: "Architecture decision",
							content: "Adopt the shared state",
							createdAt: 13,
							updatedAt: 13,
							consumedAt: 34,
						},
						{
							entryId: "decision-2",
							runId: "run-1",
							kind: "decision",
							title: "Unconsumed decision",
							content: "Needs review",
							createdAt: 14,
							updatedAt: 14,
							consumedAt: null,
						},
					],
					approvals: [],
				},
			],
		})

		const run = state.runs[0]
		expect(run?.handoffs[0]?.consumedAt).toBe(21)
		expect(run?.handoffs[1]?.consumedAt).toBeUndefined()
		expect(run?.blackboard[0]?.consumedAt).toBe(34)
		expect(run?.blackboard[1]?.consumedAt).toBeUndefined()
	})

	it("preserves stopped member status during normalization", () => {
		const state = normalizeTeamRunState({
			activeRunId: "run-1",
			runs: [
				{
					runId: "run-1",
					status: "running",
					prompt: "Cancel a member",
					createdAt: 1,
					updatedAt: 1,
					waveStrategy: "parallel",
					handoffFormat: "markdown",
					members: [
						{
							teamMemberId: "member-1",
							name: "Reviewer",
							status: "stopped",
						},
					],
					waves: [],
					handoffs: [],
					blackboard: [],
					approvals: [],
				},
			],
		})

		expect(state.runs[0]?.members[0]?.status).toBe("stopped")
	})
})

import React from "react"
import { describe, expect, it, vi } from "vitest"
import { Provider, createStore } from "jotai"
import { render, screen, within } from "@/utils/test-utils"

import { TeamControlPlane } from "../TeamControlPlane"
import { normalizeTeamRunState, setTeamRunStateAtom } from "../../state/atoms/teamRun"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			switch (key) {
				case "teamControlPlane.title":
					return "Team Control Plane"
				case "teamControlPlane.pendingConsumption":
					return "Pending consumption"
				case "teamControlPlane.consumed":
					return "Consumed"
				default:
					return key
			}
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

const createTeamRunState = () =>
	normalizeTeamRunState({
		activeRunId: "run-1",
		runs: [
			{
				runId: "run-1",
				status: "running",
				prompt: "Coordinate a release handoff",
				createdAt: 1,
				updatedAt: 1,
				waveStrategy: "parallel",
				handoffFormat: "markdown",
				currentWaveId: "wave-1",
				members: [
					{
						teamMemberId: "member-1",
						name: "Researcher",
						roleType: "research",
						status: "running",
						ownership: { paths: ["src/research.ts"] },
						sessionId: "session-1",
					},
				],
				waves: [
					{
						waveId: "wave-1",
						runId: "run-1",
						label: "Wave 1",
						index: 0,
						status: "running",
						strategy: "parallel",
						teamMemberIds: ["member-1"],
						sessionIds: ["session-1"],
						startedAt: 1,
					},
				],
				handoffs: [
					{
						handoffId: "handoff-pending",
						runId: "run-1",
						fromTeamMemberId: "member-1",
						status: "published",
						title: "Pending handoff",
						summary: "Waiting for another agent",
						canonical: {},
						createdAt: 2,
					},
					{
						handoffId: "handoff-consumed-by-status",
						runId: "run-1",
						fromTeamMemberId: "member-1",
						status: "consumed",
						title: "Status-consumed handoff",
						summary: "Picked up without a consumedAt timestamp",
						canonical: {},
						createdAt: 3,
					},
				],
				blackboard: [
					{
						entryId: "decision-consumed",
						runId: "run-1",
						kind: "decision",
						title: "Architecture decision",
						content: "Use the shared transport",
						createdAt: 4,
						updatedAt: 4,
						consumedAt: 40,
					},
					{
						entryId: "decision-unconsumed",
						runId: "run-1",
						kind: "decision",
						title: "Follow-up decision",
						content: "Still pending review",
						createdAt: 5,
						updatedAt: 5,
					},
				],
				approvals: [],
			},
		],
	})

const renderTeamControlPlane = () => {
	const store = createStore()
	store.set(setTeamRunStateAtom, createTeamRunState())

	return render(
		<Provider store={store}>
			<TeamControlPlane />
		</Provider>,
	)
}

describe("TeamControlPlane", () => {
	it("shows a consumed handoff when status is consumed even without consumedAt", () => {
		renderTeamControlPlane()

		const handoffsSection = screen.getByText("teamControlPlane.handoffs").closest("section")
		expect(handoffsSection).not.toBeNull()
		expect(within(handoffsSection as HTMLElement).getByText("Pending handoff")).toBeInTheDocument()
		expect(within(handoffsSection as HTMLElement).getByText("Status-consumed handoff")).toBeInTheDocument()
		expect(within(handoffsSection as HTMLElement).getByText("Pending consumption")).toBeInTheDocument()
		expect(within(handoffsSection as HTMLElement).getByText("Consumed")).toBeInTheDocument()
	})

	it("shows consumed and pending blackboard labels based on consumedAt presence", () => {
		renderTeamControlPlane()

		const decisionsSection = screen.getByText("teamControlPlane.decisions").closest("section")
		expect(decisionsSection).not.toBeNull()
		expect(within(decisionsSection as HTMLElement).getByText("Architecture decision")).toBeInTheDocument()
		expect(within(decisionsSection as HTMLElement).getByText("Follow-up decision")).toBeInTheDocument()
		expect(within(decisionsSection as HTMLElement).getByText("Consumed")).toBeInTheDocument()
		expect(within(decisionsSection as HTMLElement).getByText("Pending consumption")).toBeInTheDocument()
	})
})

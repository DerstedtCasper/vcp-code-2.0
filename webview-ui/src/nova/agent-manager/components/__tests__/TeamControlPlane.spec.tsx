import React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Provider, createStore } from "jotai"
import { fireEvent, render, screen, within } from "@/utils/test-utils"

const { postMessageMock } = vi.hoisted(() => ({
	postMessageMock: vi.fn(),
}))

vi.mock("../../utils/vscode", () => ({
	vscode: {
		postMessage: postMessageMock,
	},
}))

import { TeamControlPlane } from "../TeamControlPlane"
import { normalizeTeamRunState, setTeamRunStateAtom } from "../../state/atoms/teamRun"

const translations: Record<string, string> = {
	"teamControlPlane.title": "Team Control Plane",
	"teamControlPlane.subtitle": "Live Agent Team run state",
	"teamControlPlane.currentWave": "Current wave",
	"teamControlPlane.none": "None",
	"teamControlPlane.members": "Members",
	"teamControlPlane.membersLabel": "members",
	"teamControlPlane.pendingApprovals": "Pending approvals",
	"teamControlPlane.waves": "Waves",
	"teamControlPlane.memberStatus": "Member status",
	"teamControlPlane.role": "Role",
	"teamControlPlane.ownership": "Ownership",
	"teamControlPlane.session": "Session",
	"teamControlPlane.member": "Member",
	"teamControlPlane.wave": "Wave",
	"teamControlPlane.kind": "Kind",
	"teamControlPlane.askType": "Ask type",
	"teamControlPlane.source": "Source",
	"teamControlPlane.target": "Target",
	"teamControlPlane.approvals": "Approvals",
	"teamControlPlane.handoffs": "Handoffs",
	"teamControlPlane.decisions": "Decisions",
	"teamControlPlane.risks": "Risks",
	"teamControlPlane.openQuestions": "Open questions",
	"teamControlPlane.latestEvents": "Latest events",
	"teamControlPlane.pendingConsumption": "Pending consumption",
	"teamControlPlane.consumed": "Consumed",
	"teamControlPlane.statusPending": "Pending",
	"teamControlPlane.statusApproved": "Approved",
	"teamControlPlane.statusRejected": "Rejected",
	"teamControlPlane.statusRunning": "Running",
	"teamControlPlane.statusCancelled": "Cancelled",
	"teamControlPlane.cancelRun": "Cancel Run",
	"teamControlPlane.cancelMember": "Cancel Member",
	"teamControlPlane.viewSession": "View Session",
	"teamControlPlane.collapse": "Collapse Team Control Plane",
	"teamControlPlane.expand": "Expand Team Control Plane",
	"messages.approve": "Approve",
	"messages.deny": "Deny",
}

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => translations[key] ?? key,
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
					{
						teamMemberId: "member-2",
						name: "Implementer",
						roleType: "implement",
						status: "pending",
						ownership: { paths: ["src/implement.ts"] },
						sessionId: "session-2",
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
						teamMemberIds: ["member-1", "member-2"],
						sessionIds: ["session-1", "session-2"],
						startedAt: 1,
					},
				],
				handoffs: [
					{
						handoffId: "handoff-pending",
						runId: "run-1",
						waveId: "wave-1",
						fromTeamMemberId: "member-1",
						status: "published",
						title: "Pending handoff",
						summary: "Waiting for another agent",
						canonical: {
							source: {
								memberId: "member-1",
								sessionId: "session-1",
								waveId: "wave-1",
							},
							target: {
								targetTeamMemberId: "member-2",
								targetSessionId: "session-2",
							},
						},
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
						category: "decision",
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
						category: "decision",
						title: "Follow-up decision",
						content: "Still pending review",
						createdAt: 5,
						updatedAt: 5,
					},
					{
						entryId: "risk-category",
						runId: "run-1",
						waveId: "wave-1",
						kind: "note",
						category: "risk",
						title: "Migration blockage",
						content: "Database migration still needs approval",
						contentJson: {
							source: {
								memberId: "member-2",
								sessionId: "session-2",
							},
						},
						createdAt: 6,
						updatedAt: 6,
					},
					{
						entryId: "open-question-legacy",
						runId: "run-1",
						kind: "note",
						title: "Open issue: API timeout budget",
						content: "Need confirmation from the platform team",
						createdAt: 7,
						updatedAt: 7,
					},
				],
				approvals: [
					{
						approvalId: "approval-pending",
						runId: "run-1",
						waveId: "wave-1",
						sessionId: "session-1",
						teamMemberId: "member-1",
						status: "pending",
						kind: "command",
						askType: "command",
						title: "Run release validation",
						message: "Need approval to run the release verification command",
						createdAt: 8,
					},
					{
						approvalId: "approval-approved",
						runId: "run-1",
						waveId: "wave-1",
						sessionId: "session-2",
						teamMemberId: "member-2",
						status: "approved",
						kind: "tool",
						askType: "tool",
						title: "Fetch dependency graph",
						message: "Already approved earlier",
						createdAt: 9,
					},
				],
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

beforeEach(() => {
	postMessageMock.mockClear()
})

describe("TeamControlPlane", () => {
	it("shows consumed/pending pills and source metadata for handoffs and blackboard entries", () => {
		renderTeamControlPlane()

		const handoffsSection = screen.getByText("Handoffs").closest("section")
		expect(handoffsSection).not.toBeNull()
		expect(within(handoffsSection as HTMLElement).getByText("Pending handoff")).toBeInTheDocument()
		expect(within(handoffsSection as HTMLElement).getByText("Status-consumed handoff")).toBeInTheDocument()
		expect(within(handoffsSection as HTMLElement).getByText("Pending consumption")).toBeInTheDocument()
		expect(within(handoffsSection as HTMLElement).getByText("Consumed")).toBeInTheDocument()
		expect(
			within(handoffsSection as HTMLElement).getByText(
				"Source: Member: member-1 · Wave: wave-1 · Session: session-1",
			),
		).toBeInTheDocument()
		expect(
			within(handoffsSection as HTMLElement).getByText("Target: Member: member-2 · Session: session-2"),
		).toBeInTheDocument()

		const risksSection = screen.getByText("Risks").closest("section")
		expect(risksSection).not.toBeNull()
		expect(within(risksSection as HTMLElement).getByText("Migration blockage")).toBeInTheDocument()
		expect(
			within(risksSection as HTMLElement).getByText(
				"Source: Member: member-2 · Wave: wave-1 · Session: session-2",
			),
		).toBeInTheDocument()

		const decisionsSection = screen.getByText("Decisions").closest("section")
		expect(decisionsSection).not.toBeNull()
		expect(within(decisionsSection as HTMLElement).getByText("Architecture decision")).toBeInTheDocument()
		expect(within(decisionsSection as HTMLElement).getByText("Follow-up decision")).toBeInTheDocument()
		expect(within(decisionsSection as HTMLElement).getByText("Consumed")).toBeInTheDocument()
		expect(within(decisionsSection as HTMLElement).getByText("Pending consumption")).toBeInTheDocument()
	})

	it("groups risk and open question entries with category-first and legacy title fallback", () => {
		renderTeamControlPlane()

		const risksSection = screen.getByText("Risks").closest("section")
		const openQuestionsSection = screen.getByText("Open questions").closest("section")
		expect(risksSection).not.toBeNull()
		expect(openQuestionsSection).not.toBeNull()
		expect(within(risksSection as HTMLElement).getByText("Migration blockage")).toBeInTheDocument()
		expect(
			within(openQuestionsSection as HTMLElement).getByText("Open issue: API timeout budget"),
		).toBeInTheDocument()
		expect(
			within(risksSection as HTMLElement).queryByText("Open issue: API timeout budget"),
		).not.toBeInTheDocument()
	})

	it("renders stopped members with the cancelled label", () => {
		const store = createStore()
		store.set(
			setTeamRunStateAtom,
			normalizeTeamRunState({
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
								roleType: "review",
								status: "stopped",
							},
						],
						waves: [],
						handoffs: [],
						blackboard: [],
						approvals: [],
					},
				],
			}),
		)

		render(
			<Provider store={store}>
				<TeamControlPlane />
			</Provider>,
		)

		expect(screen.getByText("Reviewer")).toBeInTheDocument()
		expect(screen.getByText("Cancelled")).toBeInTheDocument()
	})

	it("renders structured approval metadata and posts approve or deny actions", () => {
		renderTeamControlPlane()

		const approvalsSection = screen.getByText("Approvals").closest("section")
		expect(approvalsSection).not.toBeNull()

		const pendingApprovalCard = screen.getByText("Run release validation").closest(".am-team-approval-item")
		expect(pendingApprovalCard).not.toBeNull()
		expect(within(pendingApprovalCard as HTMLElement).getByText("Kind")).toBeInTheDocument()
		expect(within(pendingApprovalCard as HTMLElement).getByText("Ask type")).toBeInTheDocument()
		expect(within(pendingApprovalCard as HTMLElement).getAllByText("Command")).toHaveLength(2)
		expect(within(pendingApprovalCard as HTMLElement).getByText("Member")).toBeInTheDocument()
		expect(within(pendingApprovalCard as HTMLElement).getByText("member-1")).toBeInTheDocument()
		expect(within(pendingApprovalCard as HTMLElement).getByText("Wave")).toBeInTheDocument()
		expect(within(pendingApprovalCard as HTMLElement).getByText("wave-1")).toBeInTheDocument()
		expect(within(pendingApprovalCard as HTMLElement).getByText("Session")).toBeInTheDocument()
		expect(within(pendingApprovalCard as HTMLElement).getByText("session-1")).toBeInTheDocument()

		fireEvent.click(within(pendingApprovalCard as HTMLElement).getByRole("button", { name: "Approve" }))
		fireEvent.click(within(pendingApprovalCard as HTMLElement).getByRole("button", { name: "Deny" }))

		expect(postMessageMock).toHaveBeenNthCalledWith(1, {
			type: "agentManager.respondToTeamApproval",
			runId: "run-1",
			approvalId: "approval-pending",
			approved: true,
		})
		expect(postMessageMock).toHaveBeenNthCalledWith(2, {
			type: "agentManager.respondToTeamApproval",
			runId: "run-1",
			approvalId: "approval-pending",
			approved: false,
		})

		expect(within(approvalsSection as HTMLElement).queryAllByRole("button", { name: "Approve" })).toHaveLength(1)
	})

	it("posts selectSession, cancelTeamMember, cancelTeamRun and supports collapse toggle", () => {
		renderTeamControlPlane()

		const viewSessionButtons = screen.getAllByRole("button", { name: "View Session" })
		fireEvent.click(viewSessionButtons[0])
		expect(postMessageMock).toHaveBeenCalledWith({
			type: "agentManager.selectSession",
			sessionId: "session-1",
		})

		fireEvent.click(screen.getByRole("button", { name: "Cancel Member" }))
		expect(postMessageMock).toHaveBeenCalledWith({
			type: "agentManager.cancelTeamMember",
			runId: "run-1",
			teamMemberId: "member-1",
		})

		fireEvent.click(screen.getByRole("button", { name: "Cancel Run" }))
		expect(postMessageMock).toHaveBeenCalledWith({
			type: "agentManager.cancelTeamRun",
			runId: "run-1",
		})

		fireEvent.click(screen.getByRole("button", { name: "Collapse Team Control Plane" }))
		expect(screen.queryByText("Latest events")).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Expand Team Control Plane" }))
		expect(screen.getByText("Latest events")).toBeInTheDocument()
	})
})

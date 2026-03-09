import React from "react"
import { useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import {
	currentTeamRunAtom,
	teamRunEventsAtom,
	type TeamApprovalRequest,
	type TeamBlackboardEntry,
	type TeamHandoff,
} from "../state/atoms/teamRun"

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger"

type TeamStatusLabels = {
	pending: string
	creating: string
	running: string
	completed: string
	failed: string
	cancelled: string
}

const titleCase = (value?: string | null) => {
	if (!value) {
		return "—"
	}
	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ")
}

const formatList = (items: string[]) => (items.length > 0 ? items.join(", ") : "—")
const isConsumedState = (status?: string | null, consumedAt?: number) =>
	status === "consumed" || typeof consumedAt === "number"
const formatConsumeStatus = (isConsumed: boolean, pendingLabel?: string, consumedLabel?: string) =>
	isConsumed ? (consumedLabel ?? "Consumed") : (pendingLabel ?? "Pending")

const getExecutionStatusTone = (status?: string | null): StatusTone => {
	switch (status) {
		case "completed":
		case "done":
			return "success"
		case "failed":
		case "error":
			return "danger"
		case "cancelled":
			return "warning"
		case "running":
			return "info"
		case "pending":
		case "creating":
		default:
			return "neutral"
	}
}

const getExecutionStatusLabel = (status: string | undefined, labels: TeamStatusLabels) => {
	switch (status) {
		case "pending":
			return labels.pending
		case "creating":
			return labels.creating
		case "running":
			return labels.running
		case "completed":
		case "done":
			return labels.completed
		case "failed":
		case "error":
			return labels.failed
		case "cancelled":
			return labels.cancelled
		default:
			return titleCase(status)
	}
}

const getStatusCardClassName = (status?: string | null) => {
	const tone = getExecutionStatusTone(status)
	return tone === "danger" || tone === "warning" ? ` am-team-status-card am-team-status-card--${tone}` : ""
}

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
	return <span className={`am-team-inline-pill am-team-inline-pill--${tone}`}>{label}</span>
}

function BlackboardSection({
	title,
	items,
	emptyLabel,
	pendingLabel,
	consumedLabel,
}: {
	title: string
	items: TeamBlackboardEntry[]
	emptyLabel: string
	pendingLabel?: string
	consumedLabel?: string
}) {
	return (
		<section className="am-team-section">
			<div className="am-team-section-title">{title}</div>
			{items.length === 0 ? (
				<div className="am-team-empty-inline">{emptyLabel}</div>
			) : (
				<div className="am-team-blackboard-list">
					{items.map((item) => {
						const isConsumed = isConsumedState(undefined, item.consumedAt)

						return (
							<div key={item.entryId} className="am-team-blackboard-item">
								<div className="am-team-blackboard-header">
									<div className="am-team-blackboard-title">{item.title}</div>
									<StatusPill
										label={formatConsumeStatus(isConsumed, pendingLabel, consumedLabel)}
										tone={isConsumed ? "success" : "warning"}
									/>
								</div>
								{item.content ? <div className="am-team-blackboard-summary">{item.content}</div> : null}
							</div>
						)
					})}
				</div>
			)}
		</section>
	)
}

function HandoffSection({
	title,
	items,
	emptyLabel,
	pendingLabel,
	consumedLabel,
}: {
	title: string
	items: TeamHandoff[]
	emptyLabel: string
	pendingLabel: string
	consumedLabel: string
}) {
	return (
		<section className="am-team-section">
			<div className="am-team-section-title">{title}</div>
			{items.length === 0 ? (
				<div className="am-team-empty-inline">{emptyLabel}</div>
			) : (
				<div className="am-team-blackboard-list">
					{items.map((item) => {
						const isConsumed = isConsumedState(item.status, item.consumedAt)

						return (
							<div key={item.handoffId} className="am-team-blackboard-item">
								<div className="am-team-blackboard-header">
									<div className="am-team-blackboard-title">{item.title}</div>
									<StatusPill
										label={formatConsumeStatus(isConsumed, pendingLabel, consumedLabel)}
										tone={isConsumed ? "success" : "warning"}
									/>
								</div>
								<div className="am-team-blackboard-summary">{item.summary}</div>
							</div>
						)
					})}
				</div>
			)}
		</section>
	)
}

function ApprovalSection({
	title,
	items,
	emptyLabel,
}: {
	title: string
	items: TeamApprovalRequest[]
	emptyLabel: string
}) {
	return (
		<section className="am-team-section">
			<div className="am-team-section-title">{title}</div>
			{items.length === 0 ? (
				<div className="am-team-empty-inline">{emptyLabel}</div>
			) : (
				<div className="am-team-approval-list">
					{items.map((approval) => (
						<div key={approval.approvalId} className="am-team-approval-item">
							<div className="am-team-approval-header">
								<strong>{approval.title}</strong>
								<span>{titleCase(approval.status)}</span>
							</div>
							{approval.message ? (
								<div className="am-team-approval-summary">{approval.message}</div>
							) : null}
						</div>
					))}
				</div>
			)}
		</section>
	)
}

export function TeamControlPlane() {
	const { t } = useTranslation("agentManager")
	const teamRun = useAtomValue(currentTeamRunAtom)
	const events = useAtomValue(teamRunEventsAtom)
	const statusLabels: TeamStatusLabels = {
		pending: t("teamControlPlane.statusPending"),
		creating: t("teamControlPlane.statusCreating"),
		running: t("teamControlPlane.statusRunning"),
		completed: t("teamControlPlane.statusCompleted"),
		failed: t("teamControlPlane.statusFailed"),
		cancelled: t("teamControlPlane.statusCancelled"),
	}

	if (!teamRun) {
		return (
			<aside className="am-team-panel">
				<div className="am-team-panel-header">
					<div>
						<div className="am-team-panel-title">{t("teamControlPlane.title")}</div>
						<div className="am-team-panel-subtitle">{t("teamControlPlane.subtitle")}</div>
					</div>
				</div>
				<div className="am-team-empty-state">{t("teamControlPlane.empty")}</div>
			</aside>
		)
	}

	const pendingApprovals = teamRun.approvals.filter((approval) => approval.status === "pending")
	const currentWave = teamRun.waves.find((wave) => wave.waveId === teamRun.currentWaveId)
	const recentEvents = events.filter((event) => event.runId === teamRun.runId).slice(0, 5)
	const decisionEntries = teamRun.blackboard.filter((entry) => entry.kind === "decision")
	const riskEntries = teamRun.blackboard.filter((entry) => entry.title.toLowerCase().includes("risk"))
	const openQuestionEntries = teamRun.blackboard.filter((entry) => entry.title.toLowerCase().includes("question"))
	const runStatusTone = getExecutionStatusTone(teamRun.status)

	return (
		<aside className="am-team-panel">
			<div className="am-team-panel-header">
				<div>
					<div className="am-team-panel-title">{t("teamControlPlane.title")}</div>
					<div className="am-team-panel-subtitle">{t("teamControlPlane.subtitle")}</div>
				</div>
				<div className={`am-team-status-badge am-team-status-badge--${runStatusTone}`}>
					{getExecutionStatusLabel(teamRun.status, statusLabels)}
				</div>
			</div>

			<section className="am-team-section">
				<div className="am-team-run-title">{teamRun.runId}</div>
				<div className="am-team-run-objective">{teamRun.prompt}</div>
				{teamRun.error ? <div className="am-team-run-summary">{teamRun.error}</div> : null}
				<div className="am-team-metrics">
					<div className="am-team-metric">
						<span>{t("teamControlPlane.currentWave")}</span>
						<strong>{currentWave?.label ?? t("teamControlPlane.none")}</strong>
					</div>
					<div className="am-team-metric">
						<span>{t("teamControlPlane.members")}</span>
						<strong>{teamRun.members.length}</strong>
					</div>
					<div className="am-team-metric">
						<span>{t("teamControlPlane.pendingApprovals")}</span>
						<strong>{pendingApprovals.length}</strong>
					</div>
				</div>
			</section>

			<section className="am-team-section">
				<div className="am-team-section-title">{t("teamControlPlane.waves")}</div>
				<div className="am-team-wave-list">
					{teamRun.waves.length === 0 ? (
						<div className="am-team-empty-inline">{t("teamControlPlane.noWaves")}</div>
					) : (
						teamRun.waves.map((wave) => {
							const waveTone = getExecutionStatusTone(wave.status)

							return (
								<div
									key={wave.waveId}
									className={`am-team-wave-item${getStatusCardClassName(wave.status)}`}>
									<div className="am-team-wave-header">
										<strong>{wave.label}</strong>
										<StatusPill
											label={getExecutionStatusLabel(wave.status, statusLabels)}
											tone={waveTone}
										/>
									</div>
									<div className="am-team-wave-meta">
										<span>#{wave.index + 1}</span>
										<span>
											{wave.teamMemberIds.length} {t("teamControlPlane.membersLabel")}
										</span>
									</div>
									<div className="am-team-wave-summary">{titleCase(wave.strategy)}</div>
									{wave.error ? <div className="am-team-wave-summary">{wave.error}</div> : null}
								</div>
							)
						})
					)}
				</div>
			</section>

			<section className="am-team-section">
				<div className="am-team-section-title">{t("teamControlPlane.memberStatus")}</div>
				<div className="am-team-member-list">
					{teamRun.members.length === 0 ? (
						<div className="am-team-empty-inline">{t("teamControlPlane.noMembers")}</div>
					) : (
						teamRun.members.map((member) => {
							const memberTone = getExecutionStatusTone(member.status)

							return (
								<div
									key={member.teamMemberId}
									className={`am-team-member-item${getStatusCardClassName(member.status)}`}>
									<div className="am-team-member-header">
										<strong>{member.name}</strong>
										<StatusPill
											label={getExecutionStatusLabel(member.status, statusLabels)}
											tone={memberTone}
										/>
									</div>
									<div className="am-team-member-meta">
										<div>
											{t("teamControlPlane.role")}: {member.roleType ?? "—"}
										</div>
										<div>
											{t("teamControlPlane.ownership")}:{" "}
											{formatList(member.ownership?.paths ?? [])}
										</div>
										<div>
											{t("teamControlPlane.session")}: {member.sessionId ?? "—"}
										</div>
									</div>
								</div>
							)
						})
					)}
				</div>
			</section>

			<ApprovalSection
				title={t("teamControlPlane.approvals")}
				items={teamRun.approvals}
				emptyLabel={t("teamControlPlane.noApprovals")}
			/>

			<HandoffSection
				title={t("teamControlPlane.handoffs")}
				items={teamRun.handoffs}
				emptyLabel={t("teamControlPlane.noHandoffs")}
				pendingLabel={t("teamControlPlane.pendingConsumption")}
				consumedLabel={t("teamControlPlane.consumed")}
			/>
			<BlackboardSection
				title={t("teamControlPlane.decisions")}
				items={decisionEntries}
				emptyLabel={t("teamControlPlane.noDecisions")}
				pendingLabel={t("teamControlPlane.pendingConsumption")}
				consumedLabel={t("teamControlPlane.consumed")}
			/>
			<BlackboardSection
				title={t("teamControlPlane.risks")}
				items={riskEntries}
				emptyLabel={t("teamControlPlane.noRisks")}
				pendingLabel={t("teamControlPlane.pendingConsumption")}
				consumedLabel={t("teamControlPlane.consumed")}
			/>
			<BlackboardSection
				title={t("teamControlPlane.openQuestions")}
				items={openQuestionEntries}
				emptyLabel={t("teamControlPlane.noOpenQuestions")}
				pendingLabel={t("teamControlPlane.pendingConsumption")}
				consumedLabel={t("teamControlPlane.consumed")}
			/>

			<section className="am-team-section">
				<div className="am-team-section-title">{t("teamControlPlane.latestEvents")}</div>
				{recentEvents.length === 0 ? (
					<div className="am-team-empty-inline">{t("teamControlPlane.noEvents")}</div>
				) : (
					<div className="am-team-event-list">
						{recentEvents.map((event) => (
							<div key={event.eventId} className="am-team-event-item">
								<div className="am-team-event-title">{event.title ?? titleCase(event.kind)}</div>
								{event.message ? <div className="am-team-event-summary">{event.message}</div> : null}
							</div>
						))}
					</div>
				)}
			</section>
		</aside>
	)
}

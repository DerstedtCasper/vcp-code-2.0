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
import { vscode } from "../utils/vscode"

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger"
type JsonRecord = Record<string, unknown>
type TeamBlackboardBucket = "decision" | "risk" | "open_question" | undefined

type TeamStatusLabels = {
	pending: string
	creating: string
	running: string
	completed: string
	failed: string
	cancelled: string
}

type MetadataField = {
	label: string
	value?: string | null
}

const EMPTY_VALUE = "—"

const titleCase = (value?: string | null) => {
	if (!value) {
		return EMPTY_VALUE
	}

	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ")
}

const formatList = (items: string[]) => (items.length > 0 ? items.join(", ") : EMPTY_VALUE)

const joinClassNames = (...classNames: Array<string | undefined>) => classNames.filter(Boolean).join(" ")

const isRecord = (value: unknown): value is JsonRecord =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value)

const getRecordString = (record: JsonRecord | undefined, keys: string[]) => {
	if (!record) {
		return undefined
	}

	for (const key of keys) {
		const candidate = record[key]
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate.trim()
		}
	}

	return undefined
}

const compactFields = (fields: MetadataField[]) =>
	fields.filter((field): field is MetadataField & { value: string } => Boolean(field.value?.trim()))

const formatFieldsInline = (fields: MetadataField[]) =>
	compactFields(fields)
		.map((field) => `${field.label}: ${field.value}`)
		.join(" · ")

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
		case "stopped":
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

const getApprovalStatusTone = (status?: string | null): StatusTone => {
	switch (status) {
		case "approved":
			return "success"
		case "rejected":
			return "danger"
		case "pending":
		default:
			return "warning"
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
		case "stopped":
		case "cancelled":
			return labels.cancelled
		default:
			return titleCase(status)
	}
}

const getStatusCardClassName = (status?: string | null) => {
	const tone = getExecutionStatusTone(status)
	return tone === "danger" || tone === "warning" ? `am-team-status-card--${tone}` : undefined
}

const getLegacyBlackboardBucket = (entry: TeamBlackboardEntry): TeamBlackboardBucket => {
	if (entry.category === "decision" || entry.category === "risk" || entry.category === "open_question") {
		return entry.category
	}

	if (entry.category != null) {
		return undefined
	}

	if (entry.kind === "decision") {
		return "decision"
	}

	const normalizedTitle = entry.title.toLowerCase()
	if (normalizedTitle.includes("risk")) {
		return "risk"
	}
	if (
		normalizedTitle.includes("question") ||
		normalizedTitle.includes("open issue") ||
		normalizedTitle.includes("issue")
	) {
		return "open_question"
	}

	return undefined
}

const getBlackboardEntries = (entries: TeamBlackboardEntry[], bucket: Exclude<TeamBlackboardBucket, undefined>) =>
	entries.filter((entry) => getLegacyBlackboardBucket(entry) === bucket)

const getBlackboardSourceFields = (
	item: TeamBlackboardEntry,
	memberLabel: string,
	waveLabel: string,
	sessionLabel: string,
) => {
	const contentJson = isRecord(item.contentJson) ? item.contentJson : undefined
	const source = isRecord(contentJson?.source) ? contentJson.source : contentJson

	return compactFields([
		{
			label: memberLabel,
			value: item.teamMemberId ?? getRecordString(source, ["teamMemberId", "memberId", "fromTeamMemberId"]),
		},
		{
			label: waveLabel,
			value: item.waveId ?? getRecordString(source, ["waveId"]),
		},
		{
			label: sessionLabel,
			value: item.sessionId ?? getRecordString(source, ["sessionId", "fromSessionId"]),
		},
	])
}

const getHandoffSourceFields = (item: TeamHandoff, memberLabel: string, waveLabel: string, sessionLabel: string) => {
	const canonical = isRecord(item.canonical) ? item.canonical : undefined
	const source = isRecord(canonical?.source) ? canonical.source : canonical

	return compactFields([
		{
			label: memberLabel,
			value: item.fromTeamMemberId ?? getRecordString(source, ["memberId", "teamMemberId", "fromTeamMemberId"]),
		},
		{
			label: waveLabel,
			value: item.waveId ?? getRecordString(source, ["waveId"]),
		},
		{
			label: sessionLabel,
			value: item.fromSessionId ?? getRecordString(source, ["sessionId", "fromSessionId"]),
		},
	])
}

const getHandoffTargetFields = (item: TeamHandoff, memberLabel: string, sessionLabel: string) => {
	const canonical = isRecord(item.canonical) ? item.canonical : undefined
	const target = isRecord(canonical?.target) ? canonical.target : canonical

	return compactFields([
		{
			label: memberLabel,
			value: item.toTeamMemberId ?? getRecordString(target, ["toTeamMemberId", "targetTeamMemberId"]),
		},
		{
			label: sessionLabel,
			value: item.toSessionId ?? getRecordString(target, ["toSessionId", "targetSessionId"]),
		},
	])
}

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
	return <span className={`am-team-inline-pill am-team-inline-pill--${tone}`}>{label}</span>
}

function MetadataGrid({ fields }: { fields: MetadataField[] }) {
	return (
		<dl className="am-team-meta-grid">
			{fields.map((field) => (
				<React.Fragment key={field.label}>
					<dt className="am-team-meta-key">{field.label}</dt>
					<dd className="am-team-meta-value">{field.value?.trim() || EMPTY_VALUE}</dd>
				</React.Fragment>
			))}
		</dl>
	)
}

function InlineMetadata({ label, fields }: { label: string; fields: MetadataField[] }) {
	const content = formatFieldsInline(fields)
	if (!content) {
		return null
	}

	return <div className="am-team-meta-line">{`${label}: ${content}`}</div>
}

function BlackboardSection({
	title,
	items,
	emptyLabel,
	pendingLabel,
	consumedLabel,
	memberLabel,
	waveLabel,
	sessionLabel,
	sourceLabel,
}: {
	title: string
	items: TeamBlackboardEntry[]
	emptyLabel: string
	pendingLabel?: string
	consumedLabel?: string
	memberLabel: string
	waveLabel: string
	sessionLabel: string
	sourceLabel: string
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
						const sourceFields = getBlackboardSourceFields(item, memberLabel, waveLabel, sessionLabel)

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
								<InlineMetadata label={sourceLabel} fields={sourceFields} />
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
	memberLabel,
	waveLabel,
	sessionLabel,
	sourceLabel,
	targetLabel,
}: {
	title: string
	items: TeamHandoff[]
	emptyLabel: string
	pendingLabel: string
	consumedLabel: string
	memberLabel: string
	waveLabel: string
	sessionLabel: string
	sourceLabel: string
	targetLabel: string
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
						const sourceFields = getHandoffSourceFields(item, memberLabel, waveLabel, sessionLabel)
						const targetFields = getHandoffTargetFields(item, memberLabel, sessionLabel)

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
								<InlineMetadata label={sourceLabel} fields={sourceFields} />
								<InlineMetadata label={targetLabel} fields={targetFields} />
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
	pendingLabel,
	approvedLabel,
	rejectedLabel,
	approveLabel,
	denyLabel,
	kindLabel,
	askTypeLabel,
	memberLabel,
	waveLabel,
	sessionLabel,
}: {
	title: string
	items: TeamApprovalRequest[]
	emptyLabel: string
	pendingLabel: string
	approvedLabel: string
	rejectedLabel: string
	approveLabel: string
	denyLabel: string
	kindLabel: string
	askTypeLabel: string
	memberLabel: string
	waveLabel: string
	sessionLabel: string
}) {
	const getStatusLabel = (status: TeamApprovalRequest["status"]) => {
		switch (status) {
			case "approved":
				return approvedLabel
			case "rejected":
				return rejectedLabel
			case "pending":
			default:
				return pendingLabel
		}
	}

	const resolveApproval = (approval: TeamApprovalRequest, approved: boolean) => {
		vscode.postMessage({
			type: "agentManager.respondToTeamApproval",
			runId: approval.runId,
			approvalId: approval.approvalId,
			approved,
		})
	}

	return (
		<section className="am-team-section">
			<div className="am-team-section-title">{title}</div>
			{items.length === 0 ? (
				<div className="am-team-empty-inline">{emptyLabel}</div>
			) : (
				<div className="am-team-approval-list">
					{items.map((approval) => {
						const tone = getApprovalStatusTone(approval.status)
						const metadataFields: MetadataField[] = [
							{ label: kindLabel, value: titleCase(approval.kind) },
							{
								label: askTypeLabel,
								value: approval.askType ? titleCase(approval.askType) : EMPTY_VALUE,
							},
							{ label: memberLabel, value: approval.teamMemberId ?? EMPTY_VALUE },
							{ label: waveLabel, value: approval.waveId ?? EMPTY_VALUE },
							{ label: sessionLabel, value: approval.sessionId ?? EMPTY_VALUE },
						]

						return (
							<div
								key={approval.approvalId}
								className={joinClassNames(
									"am-team-approval-item",
									getStatusCardClassName(approval.status),
								)}>
								<div className="am-team-approval-header">
									<strong>{approval.title}</strong>
									<StatusPill label={getStatusLabel(approval.status)} tone={tone} />
								</div>
								{approval.message ? (
									<div className="am-team-approval-summary">{approval.message}</div>
								) : null}
								<MetadataGrid fields={metadataFields} />
								{approval.status === "pending" ? (
									<div className="am-team-approval-actions">
										<button
											type="button"
											className="am-team-approval-action am-team-approval-action--approve"
											onClick={() => resolveApproval(approval, true)}>
											{approveLabel}
										</button>
										<button
											type="button"
											className="am-team-approval-action am-team-approval-action--deny"
											onClick={() => resolveApproval(approval, false)}>
											{denyLabel}
										</button>
									</div>
								) : null}
							</div>
						)
					})}
				</div>
			)}
		</section>
	)
}

export function TeamControlPlane() {
	const { t } = useTranslation("agentManager")
	const teamRun = useAtomValue(currentTeamRunAtom)
	const events = useAtomValue(teamRunEventsAtom)
	const [collapsed, setCollapsed] = React.useState(false)
	const statusLabels: TeamStatusLabels = {
		pending: t("teamControlPlane.statusPending"),
		creating: t("teamControlPlane.statusCreating"),
		running: t("teamControlPlane.statusRunning"),
		completed: t("teamControlPlane.statusCompleted"),
		failed: t("teamControlPlane.statusFailed"),
		cancelled: t("teamControlPlane.statusCancelled"),
	}
	const toggleLabel = collapsed ? t("teamControlPlane.expand") : t("teamControlPlane.collapse")

	if (!teamRun) {
		return (
			<aside className={joinClassNames("am-team-panel", collapsed ? "am-team-panel--collapsed" : undefined)}>
				<div
					className={joinClassNames(
						"am-team-panel-header",
						collapsed ? "am-team-panel-header--collapsed" : undefined,
					)}>
					{!collapsed ? (
						<div>
							<div className="am-team-panel-title">{t("teamControlPlane.title")}</div>
							<div className="am-team-panel-subtitle">{t("teamControlPlane.subtitle")}</div>
						</div>
					) : null}
					<button
						type="button"
						className="am-team-panel-toggle"
						onClick={() => setCollapsed((value) => !value)}
						aria-label={toggleLabel}
						title={toggleLabel}>
						{collapsed ? "»" : "«"}
					</button>
				</div>
				{!collapsed ? <div className="am-team-empty-state">{t("teamControlPlane.empty")}</div> : null}
			</aside>
		)
	}

	const pendingApprovals = teamRun.approvals.filter((approval) => approval.status === "pending")
	const currentWave = teamRun.waves.find((wave) => wave.waveId === teamRun.currentWaveId)
	const recentEvents = events.filter((event) => event.runId === teamRun.runId).slice(0, 5)
	const decisionEntries = getBlackboardEntries(teamRun.blackboard, "decision")
	const riskEntries = getBlackboardEntries(teamRun.blackboard, "risk")
	const openQuestionEntries = getBlackboardEntries(teamRun.blackboard, "open_question")
	const runStatusTone = getExecutionStatusTone(teamRun.status)

	if (collapsed) {
		return (
			<aside className="am-team-panel am-team-panel--collapsed">
				<div className="am-team-panel-header am-team-panel-header--collapsed">
					<button
						type="button"
						className="am-team-panel-toggle"
						onClick={() => setCollapsed(false)}
						aria-label={toggleLabel}
						title={toggleLabel}>
						»
					</button>
					<div
						className={`am-team-status-badge am-team-status-badge--${runStatusTone}`}
						title={`${teamRun.runId}: ${getExecutionStatusLabel(teamRun.status, statusLabels)}`}>
						{pendingApprovals.length}
					</div>
				</div>
			</aside>
		)
	}

	return (
		<aside className="am-team-panel">
			<div className="am-team-panel-header">
				<div>
					<div className="am-team-panel-title">{t("teamControlPlane.title")}</div>
					<div className="am-team-panel-subtitle">{t("teamControlPlane.subtitle")}</div>
				</div>
				<div className="am-team-panel-header-actions">
					<div className={`am-team-status-badge am-team-status-badge--${runStatusTone}`}>
						{getExecutionStatusLabel(teamRun.status, statusLabels)}
					</div>
					<button
						type="button"
						className="am-team-panel-toggle"
						onClick={() => setCollapsed(true)}
						aria-label={toggleLabel}
						title={toggleLabel}>
						«
					</button>
				</div>
			</div>

			<section className="am-team-section">
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
					<div className="am-team-run-title">{teamRun.runId}</div>
					{teamRun.status === "running" && (
						<button
							type="button"
							className="am-team-action-btn"
							onClick={() => {
								vscode.postMessage({
									type: "agentManager.cancelTeamRun",
									runId: teamRun.runId,
								})
							}}>
							{t("teamControlPlane.cancelRun")}
						</button>
					)}
				</div>
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
									className={joinClassNames(
										"am-team-wave-item",
										getStatusCardClassName(wave.status),
									)}>
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
									className={joinClassNames(
										"am-team-member-item",
										getStatusCardClassName(member.status),
									)}>
									<div className="am-team-member-header">
										<strong>{member.name}</strong>
										<StatusPill
											label={getExecutionStatusLabel(member.status, statusLabels)}
											tone={memberTone}
										/>
									</div>
									<div className="am-team-member-meta">
										<div>
											{t("teamControlPlane.role")}: {member.roleType ?? EMPTY_VALUE}
										</div>
										<div>
											{t("teamControlPlane.ownership")}:{" "}
											{formatList(member.ownership?.paths ?? [])}
										</div>
										<div>
											{t("teamControlPlane.session")}: {member.sessionId ?? EMPTY_VALUE}
										</div>
										<div className="am-team-member-actions">
											{member.sessionId && (
												<button
													type="button"
													className="am-team-inline-link"
													onClick={() => {
														vscode.postMessage({
															type: "agentManager.selectSession",
															sessionId: member.sessionId,
														})
													}}
													title={t("teamControlPlane.viewSession")}>
													{t("teamControlPlane.viewSession")}
												</button>
											)}
											{member.status === "running" ? (
												<button
													type="button"
													className="am-team-action-btn am-team-action-btn--ghost"
													onClick={() => {
														vscode.postMessage({
															type: "agentManager.cancelTeamMember",
															runId: teamRun.runId,
															teamMemberId: member.teamMemberId,
														})
													}}>
													{t("teamControlPlane.cancelMember")}
												</button>
											) : null}
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
				pendingLabel={t("teamControlPlane.statusPending")}
				approvedLabel={t("teamControlPlane.statusApproved")}
				rejectedLabel={t("teamControlPlane.statusRejected")}
				approveLabel={t("messages.approve")}
				denyLabel={t("messages.deny")}
				kindLabel={t("teamControlPlane.kind")}
				askTypeLabel={t("teamControlPlane.askType")}
				memberLabel={t("teamControlPlane.member")}
				waveLabel={t("teamControlPlane.wave")}
				sessionLabel={t("teamControlPlane.session")}
			/>

			<HandoffSection
				title={t("teamControlPlane.handoffs")}
				items={teamRun.handoffs}
				emptyLabel={t("teamControlPlane.noHandoffs")}
				pendingLabel={t("teamControlPlane.pendingConsumption")}
				consumedLabel={t("teamControlPlane.consumed")}
				memberLabel={t("teamControlPlane.member")}
				waveLabel={t("teamControlPlane.wave")}
				sessionLabel={t("teamControlPlane.session")}
				sourceLabel={t("teamControlPlane.source")}
				targetLabel={t("teamControlPlane.target")}
			/>
			<BlackboardSection
				title={t("teamControlPlane.decisions")}
				items={decisionEntries}
				emptyLabel={t("teamControlPlane.noDecisions")}
				pendingLabel={t("teamControlPlane.pendingConsumption")}
				consumedLabel={t("teamControlPlane.consumed")}
				memberLabel={t("teamControlPlane.member")}
				waveLabel={t("teamControlPlane.wave")}
				sessionLabel={t("teamControlPlane.session")}
				sourceLabel={t("teamControlPlane.source")}
			/>
			<BlackboardSection
				title={t("teamControlPlane.risks")}
				items={riskEntries}
				emptyLabel={t("teamControlPlane.noRisks")}
				pendingLabel={t("teamControlPlane.pendingConsumption")}
				consumedLabel={t("teamControlPlane.consumed")}
				memberLabel={t("teamControlPlane.member")}
				waveLabel={t("teamControlPlane.wave")}
				sessionLabel={t("teamControlPlane.session")}
				sourceLabel={t("teamControlPlane.source")}
			/>
			<BlackboardSection
				title={t("teamControlPlane.openQuestions")}
				items={openQuestionEntries}
				emptyLabel={t("teamControlPlane.noOpenQuestions")}
				pendingLabel={t("teamControlPlane.pendingConsumption")}
				consumedLabel={t("teamControlPlane.consumed")}
				memberLabel={t("teamControlPlane.member")}
				waveLabel={t("teamControlPlane.wave")}
				sessionLabel={t("teamControlPlane.session")}
				sourceLabel={t("teamControlPlane.source")}
			/>

			<section className="am-team-section">
				<div className="am-team-section-title">{t("teamControlPlane.latestEvents")}</div>
				{recentEvents.length === 0 ? (
					<div className="am-team-empty-inline">{t("teamControlPlane.noEvents")}</div>
				) : (
					<div className="am-team-event-list">
						{recentEvents.map((event) => (
							<div key={event.eventId} className="am-team-event-item">
								<div className="am-team-event-title">{event.title || titleCase(event.kind)}</div>
								{event.message ? <div className="am-team-event-summary">{event.message}</div> : null}
							</div>
						))}
					</div>
				)}
			</section>
		</aside>
	)
}

import { useMemo } from "react"
import {
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeTextArea,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { getDefaultVcpConfig, type VcpAgentTeamMember, type VcpConfig } from "@roo-code/types"

import { Button } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends Array<infer U> ? Array<U> : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

type AgentTeamRoleType = "lead" | "research" | "implement" | "review" | "test" | "general"
type VcpRoleType = VcpAgentTeamMember["roleType"]

type ExtendedAgentTeamMember = VcpAgentTeamMember & {
	roleType?: VcpRoleType
}

type AgentTeamSettingsProps = {
	vcpConfig?: VcpConfig
	onUpdateVcpConfig: (patch: DeepPartial<VcpConfig>) => void
}

const ROLE_TYPE_OPTIONS: Array<{ value: VcpRoleType; label: string }> = [
	{ value: "lead", label: "Lead / 协调" },
	{ value: "research", label: "Research / 调研" },
	{ value: "implement", label: "Implement / 实现" },
	{ value: "review", label: "Review / 审查" },
	{ value: "test", label: "Test / 验证" },
	{ value: "general", label: "General / 通用" },
]

const toInt = (value: string, min: number, fallback: number): number => {
	const next = Number(value)
	if (!Number.isFinite(next)) {
		return fallback
	}
	return Math.max(min, Math.floor(next))
}

const normalizeAgentId = (value: string) => value.trim().replace(/\s+/g, "-")
const parseList = (value: string) =>
	value
		.split(/[\n,]+/)
		.map((entry) => entry.trim())
		.filter(Boolean)
const joinList = (value?: string[]) => (value && value.length > 0 ? value.join(", ") : "")

export const AgentTeamSettings = ({ vcpConfig, onUpdateVcpConfig }: AgentTeamSettingsProps) => {
	const defaults = getDefaultVcpConfig()
	const currentVcpConfig: VcpConfig = {
		...defaults,
		...(vcpConfig ?? {}),
		contextFold: { ...defaults.contextFold, ...(vcpConfig?.contextFold ?? {}) },
		vcpInfo: { ...defaults.vcpInfo, ...(vcpConfig?.vcpInfo ?? {}) },
		html: { ...defaults.html, ...(vcpConfig?.html ?? {}) },
		toolRequest: { ...defaults.toolRequest, ...(vcpConfig?.toolRequest ?? {}) },
		agentTeam: { ...defaults.agentTeam, ...(vcpConfig?.agentTeam ?? {}) },
		memory: {
			...defaults.memory,
			...(vcpConfig?.memory ?? {}),
			passive: { ...defaults.memory.passive, ...(vcpConfig?.memory?.passive ?? {}) },
			writer: { ...defaults.memory.writer, ...(vcpConfig?.memory?.writer ?? {}) },
			retrieval: { ...defaults.memory.retrieval, ...(vcpConfig?.memory?.retrieval ?? {}) },
			refresh: { ...defaults.memory.refresh, ...(vcpConfig?.memory?.refresh ?? {}) },
		},
		toolbox: { ...defaults.toolbox, ...(vcpConfig?.toolbox ?? {}) },
		snowCompat: {
			...defaults.snowCompat,
			...(vcpConfig?.snowCompat ?? {}),
			responsesReasoning: {
				...defaults.snowCompat.responsesReasoning,
				...(vcpConfig?.snowCompat?.responsesReasoning ?? {}),
			},
			proxy: {
				...defaults.snowCompat.proxy,
				...(vcpConfig?.snowCompat?.proxy ?? {}),
			},
		},
	}
	const { listApiConfigMeta } = useExtensionState()

	const profileOptions = useMemo(
		() =>
			(listApiConfigMeta ?? [])
				.filter((entry) => entry.apiProvider && entry.modelId)
				.map((entry) => ({
					value: entry.id,
					label: `${entry.name} (${entry.apiProvider}/${entry.modelId})`,
					apiProvider: entry.apiProvider as string,
					modelId: entry.modelId as string,
				})),
		[listApiConfigMeta],
	)

	const members = useMemo(
		() =>
			(currentVcpConfig.agentTeam.members as ExtendedAgentTeamMember[]).map(
				(member): ExtendedAgentTeamMember => ({
					...member,
					enabled: member.enabled ?? true,
					capabilities: member.capabilities ?? [],
					phaseAffinity: member.phaseAffinity ?? [],
					ownership: {
						paths: member.ownership?.paths ?? [],
						summary: member.ownership?.summary ?? undefined,
					},
				}),
			),
		[currentVcpConfig.agentTeam.members],
	)

	const updateMembers = (nextMembers: ExtendedAgentTeamMember[]) => {
		onUpdateVcpConfig({
			agentTeam: {
				members: nextMembers as unknown as VcpAgentTeamMember[],
			},
		})
	}

	const updateMember = (index: number, patch: Partial<ExtendedAgentTeamMember>) => {
		const nextMembers = [...members]
		nextMembers[index] = { ...nextMembers[index], ...patch }
		updateMembers(nextMembers)
	}

	const addMember = () => {
		const defaultProfile = profileOptions[0]
		const nextIndex = members.length + 1
		const id = `agent-${nextIndex}`
		const newMember: ExtendedAgentTeamMember = {
			id,
			name: id,
			providerID: defaultProfile?.apiProvider ?? "anthropic",
			modelID: defaultProfile?.modelId ?? "claude-sonnet-4-5",
			rolePrompt: "",
			apiConfigId: defaultProfile?.value,
			roleType: "general",
			phaseAffinity: [],
			capabilities: [],
			enabled: true,
			ownership: { paths: [], summary: undefined },
		}
		updateMembers([...members, newMember])
	}

	const removeMember = (index: number) => {
		updateMembers(members.filter((_, i) => i !== index))
	}

	const moveMember = (index: number, direction: -1 | 1) => {
		const targetIndex = index + direction
		if (targetIndex < 0 || targetIndex >= members.length) {
			return
		}
		const nextMembers = [...members]
		;[nextMembers[index], nextMembers[targetIndex]] = [nextMembers[targetIndex], nextMembers[index]]
		updateMembers(nextMembers)
	}

	return (
		<div className="space-y-3 p-4">
			<div className="rounded border border-vscode-panel-border bg-[var(--vscode-editorWidget-background)] p-3 text-sm text-vscode-descriptionForeground">
				<div className="font-medium text-vscode-foreground">Agent Team 团队编排</div>
				<div className="mt-1 space-y-1">
					<div>
						在这里配置多代理协作模式。每个成员可单独设置启用状态、API 预设、角色类型、能力标签与阶段偏好。
					</div>
					<div>
						自适应波次 = 运行时在顺序与并行之间按 maxParallel 自动分批；文件分离 =
						尽量将成员限制在各自文件/路径上下文，降低冲突，并非严格沙箱。
					</div>
					<div>handoffFormat 仅作为前端展示偏好；后端 canonical handoff 始终保持 JSON。</div>
				</div>
			</div>

			<VSCodeCheckbox
				checked={currentVcpConfig.agentTeam.enabled}
				onChange={(e: any) => onUpdateVcpConfig({ agentTeam: { enabled: e.target.checked === true } })}
				data-testid="agent-behaviour-vcp-agent-team-enabled-checkbox">
				启用 Agent Team 编排
			</VSCodeCheckbox>

			<div className="flex flex-wrap items-center gap-3">
				<VSCodeTextField
					value={String(currentVcpConfig.agentTeam.maxParallel)}
					onInput={(e: any) =>
						onUpdateVcpConfig({
							agentTeam: {
								maxParallel: toInt(
									String(e.target.value ?? ""),
									1,
									currentVcpConfig.agentTeam.maxParallel,
								),
							},
						})
					}
					data-testid="agent-behaviour-vcp-agent-team-max-parallel-input">
					最大并行 Agent 数
				</VSCodeTextField>

				<VSCodeDropdown
					value={currentVcpConfig.agentTeam.waveStrategy}
					onChange={(e: any) =>
						onUpdateVcpConfig({
							agentTeam: {
								waveStrategy: (e.target as HTMLSelectElement).value as
									| "sequential"
									| "parallel"
									| "adaptive",
							},
						})
					}
					data-testid="agent-behaviour-vcp-agent-team-wave-strategy-dropdown">
					<VSCodeOption value="sequential">顺序波次</VSCodeOption>
					<VSCodeOption value="parallel">并行波次</VSCodeOption>
					<VSCodeOption value="adaptive">自适应波次</VSCodeOption>
				</VSCodeDropdown>

				<VSCodeDropdown
					value={currentVcpConfig.agentTeam.handoffFormat}
					onChange={(e: any) =>
						onUpdateVcpConfig({
							agentTeam: {
								handoffFormat: (e.target as HTMLSelectElement).value as "json" | "markdown",
							},
						})
					}
					data-testid="agent-behaviour-vcp-agent-team-handoff-format-dropdown">
					<VSCodeOption value="markdown">Markdown 交接</VSCodeOption>
					<VSCodeOption value="json">JSON 交接</VSCodeOption>
				</VSCodeDropdown>
			</div>

			<div className="grid grid-cols-1 gap-2 md:grid-cols-3">
				<div className="rounded border border-vscode-panel-border p-3">
					<div className="font-medium text-vscode-foreground">顺序波次</div>
					<div className="mt-1 text-xs text-vscode-descriptionForeground">
						严格按成员顺序执行，适合强依赖串行工作流。
					</div>
				</div>
				<div className="rounded border border-vscode-panel-border p-3">
					<div className="font-medium text-vscode-foreground">并行波次</div>
					<div className="mt-1 text-xs text-vscode-descriptionForeground">
						同一波次并发多个成员，适合独立子任务拆分。
					</div>
				</div>
				<div className="rounded border border-vscode-panel-border p-3">
					<div className="font-medium text-vscode-foreground">自适应波次</div>
					<div className="mt-1 text-xs text-vscode-descriptionForeground">
						根据团队规模、角色与 maxParallel 自动安排分波。
					</div>
				</div>
			</div>

			<VSCodeCheckbox
				checked={currentVcpConfig.agentTeam.requireFileSeparation}
				onChange={(e: any) =>
					onUpdateVcpConfig({ agentTeam: { requireFileSeparation: e.target.checked === true } })
				}
				data-testid="agent-behaviour-vcp-agent-team-file-separation-checkbox">
				要求成员尽量使用分离的文件/路径上下文
			</VSCodeCheckbox>

			<div className="flex items-center justify-between pt-1">
				<div className="text-xs text-vscode-descriptionForeground">团队成员：{members.length}</div>
				<Button onClick={addMember} data-testid="agent-behaviour-vcp-agent-team-add-member-button">
					+ 添加 Agent
				</Button>
			</div>

			<div className="space-y-3">
				{members.map((member, index) => (
					<div
						key={`${member.id ?? member.name}-${index}`}
						className="rounded border border-vscode-panel-border p-3">
						<div className="mb-2 flex items-center justify-between gap-3">
							<VSCodeCheckbox
								checked={member.enabled !== false}
								onChange={(e: any) => updateMember(index, { enabled: e.target.checked === true })}
								data-testid={`agent-behaviour-vcp-agent-team-member-enabled-checkbox-${index}`}>
								启用该成员
							</VSCodeCheckbox>
							<div className="text-xs text-vscode-descriptionForeground">
								禁用后保留配置但不参与 Team Run
							</div>
						</div>

						<div className="grid grid-cols-1 gap-2">
							<div className="flex flex-wrap items-center gap-2">
								<VSCodeTextField
									value={member.id ?? member.name}
									onInput={(e: any) => {
										const id =
											normalizeAgentId(String(e.target.value ?? "")) || `agent-${index + 1}`
										updateMember(index, { id, name: id })
									}}
									data-testid={`agent-behaviour-vcp-agent-team-member-id-input-${index}`}>
									Agent ID
								</VSCodeTextField>

								<VSCodeDropdown
									value={member.roleType ?? "general"}
									onChange={(e: any) =>
										updateMember(index, {
											roleType: (e.target as HTMLSelectElement).value as AgentTeamRoleType,
										})
									}
									data-testid={`agent-behaviour-vcp-agent-team-member-role-type-dropdown-${index}`}>
									{ROLE_TYPE_OPTIONS.map((option) => (
										<VSCodeOption key={option.value} value={option.value}>
											{option.label}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
							</div>

							{profileOptions.length > 0 && (
								<VSCodeDropdown
									value={member.apiConfigId ?? ""}
									onChange={(e: any) => {
										const selectedValue = (e.target as HTMLSelectElement).value
										const selected = profileOptions.find((option) => option.value === selectedValue)
										updateMember(index, {
											apiConfigId: selectedValue || undefined,
											providerID: selected?.apiProvider ?? member.providerID,
											modelID: selected?.modelId ?? member.modelID,
										})
									}}
									data-testid={`agent-behaviour-vcp-agent-team-member-api-config-dropdown-${index}`}>
									<VSCodeOption value="">绑定 API 配置预设（可选）</VSCodeOption>
									{profileOptions.map((option) => (
										<VSCodeOption key={option.value} value={option.value}>
											{option.label}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
							)}

							<div className="flex flex-wrap items-center gap-2">
								<VSCodeTextField
									value={member.providerID}
									onInput={(e: any) =>
										updateMember(index, { providerID: String(e.target.value ?? "").trim() })
									}
									data-testid={`agent-behaviour-vcp-agent-team-member-provider-input-${index}`}>
									Provider ID
								</VSCodeTextField>
								<VSCodeTextField
									value={member.modelID}
									onInput={(e: any) =>
										updateMember(index, { modelID: String(e.target.value ?? "").trim() })
									}
									data-testid={`agent-behaviour-vcp-agent-team-member-model-input-${index}`}>
									Model ID
								</VSCodeTextField>
							</div>

							<VSCodeTextField
								value={joinList(member.capabilities)}
								onInput={(e: any) =>
									updateMember(index, { capabilities: parseList(String(e.target.value ?? "")) })
								}
								data-testid={`agent-behaviour-vcp-agent-team-member-capabilities-input-${index}`}>
								Capabilities（逗号分隔）
							</VSCodeTextField>

							<VSCodeTextField
								value={joinList(member.phaseAffinity)}
								onInput={(e: any) =>
									updateMember(index, { phaseAffinity: parseList(String(e.target.value ?? "")) })
								}
								data-testid={`agent-behaviour-vcp-agent-team-member-phase-affinity-input-${index}`}>
								Phase Affinity（如 plan, implement, verify）
							</VSCodeTextField>

							<VSCodeTextField
								value={joinList(member.ownership?.paths)}
								onInput={(e: any) =>
									updateMember(index, {
										ownership: {
											paths: parseList(String(e.target.value ?? "")),
											summary: member.ownership?.summary ?? undefined,
										},
									})
								}
								data-testid={`agent-behaviour-vcp-agent-team-member-ownership-paths-input-${index}`}>
								Ownership Paths（尽量负责的路径，逗号分隔）
							</VSCodeTextField>

							<VSCodeTextField
								value={member.ownership?.summary ?? ""}
								onInput={(e: any) =>
									updateMember(index, {
										ownership: {
											paths: member.ownership?.paths ?? [],
											summary: String(e.target.value ?? "").trim() || undefined,
										},
									})
								}
								data-testid={`agent-behaviour-vcp-agent-team-member-ownership-summary-input-${index}`}>
								Ownership Summary
							</VSCodeTextField>

							<VSCodeTextArea
								value={member.rolePrompt}
								rows={4}
								onInput={(e: any) => updateMember(index, { rolePrompt: String(e.target.value ?? "") })}
								data-testid={`agent-behaviour-vcp-agent-team-member-prompt-input-${index}`}>
								角色提示词
							</VSCodeTextArea>
						</div>

						<div className="flex flex-wrap justify-end gap-2 pt-2">
							<Button
								variant="secondary"
								onClick={() => moveMember(index, -1)}
								disabled={index === 0}
								data-testid={`agent-behaviour-vcp-agent-team-member-move-up-button-${index}`}>
								上移
							</Button>
							<Button
								variant="secondary"
								onClick={() => moveMember(index, 1)}
								disabled={index === members.length - 1}
								data-testid={`agent-behaviour-vcp-agent-team-member-move-down-button-${index}`}>
								下移
							</Button>
							<Button
								variant="destructive"
								onClick={() => removeMember(index)}
								data-testid={`agent-behaviour-vcp-agent-team-member-remove-button-${index}`}>
								删除
							</Button>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

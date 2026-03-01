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

type AgentTeamSettingsProps = {
	vcpConfig?: VcpConfig
	onUpdateVcpConfig: (patch: DeepPartial<VcpConfig>) => void
}

const toInt = (value: string, min: number, fallback: number): number => {
	const next = Number(value)
	if (!Number.isFinite(next)) {
		return fallback
	}
	return Math.max(min, Math.floor(next))
}

const normalizeAgentId = (value: string) => value.trim().replace(/\s+/g, "-")

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
	const members = currentVcpConfig.agentTeam.members
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

	const updateMembers = (nextMembers: VcpAgentTeamMember[]) => {
		onUpdateVcpConfig({ agentTeam: { members: nextMembers } })
	}

	const updateMember = (index: number, patch: Partial<VcpAgentTeamMember>) => {
		const nextMembers = [...members]
		nextMembers[index] = { ...nextMembers[index], ...patch }
		updateMembers(nextMembers)
	}

	const addMember = () => {
		const defaultProfile = profileOptions[0]
		const nextIndex = members.length + 1
		const id = `agent-${nextIndex}`
		const newMember: VcpAgentTeamMember = {
			id,
			name: id,
			providerID: defaultProfile?.apiProvider ?? "anthropic",
			modelID: defaultProfile?.modelId ?? "claude-sonnet-4-5",
			rolePrompt: "",
		}
		updateMembers([...members, newMember])
	}

	const removeMember = (index: number) => {
		const nextMembers = members.filter((_, i) => i !== index)
		updateMembers(nextMembers)
	}

	return (
		<div className="space-y-3 p-4">
			<div className="text-sm text-vscode-descriptionForeground">
				在代理行为中配置 Agent Team。支持按加号自由添加 agent（ID、提示词、模型）。
			</div>

			<VSCodeCheckbox
				checked={currentVcpConfig.agentTeam.enabled}
				onChange={(e: any) => onUpdateVcpConfig({ agentTeam: { enabled: e.target.checked === true } })}
				data-testid="agent-behaviour-vcp-agent-team-enabled-checkbox">
				Enable agent team orchestration
			</VSCodeCheckbox>

			<div className="flex items-center gap-3">
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
					Max Parallel Agents
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
					<VSCodeOption value="sequential">sequential</VSCodeOption>
					<VSCodeOption value="parallel">parallel</VSCodeOption>
					<VSCodeOption value="adaptive">adaptive</VSCodeOption>
				</VSCodeDropdown>

				<VSCodeDropdown
					value={currentVcpConfig.agentTeam.handoffFormat}
					onChange={(e: any) =>
						onUpdateVcpConfig({
							agentTeam: { handoffFormat: (e.target as HTMLSelectElement).value as "json" | "markdown" },
						})
					}
					data-testid="agent-behaviour-vcp-agent-team-handoff-format-dropdown">
					<VSCodeOption value="markdown">markdown</VSCodeOption>
					<VSCodeOption value="json">json</VSCodeOption>
				</VSCodeDropdown>
			</div>

			<VSCodeCheckbox
				checked={currentVcpConfig.agentTeam.requireFileSeparation}
				onChange={(e: any) =>
					onUpdateVcpConfig({ agentTeam: { requireFileSeparation: e.target.checked === true } })
				}
				data-testid="agent-behaviour-vcp-agent-team-file-separation-checkbox">
				Require file separation per agent
			</VSCodeCheckbox>

			<div className="flex items-center justify-between pt-1">
				<div className="text-xs text-vscode-descriptionForeground">Agents: {members.length}</div>
				<Button onClick={addMember} data-testid="agent-behaviour-vcp-agent-team-add-member-button">
					+ Add Agent
				</Button>
			</div>

			<div className="space-y-3">
				{members.map((member, index) => (
					<div
						key={`${member.id ?? member.name}-${index}`}
						className="rounded border border-vscode-panel-border p-3">
						<div className="grid grid-cols-1 gap-2">
							<div className="flex items-center gap-2">
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

								{profileOptions.length > 0 && (
									<VSCodeDropdown
										value=""
										onChange={(e: any) => {
											const selected = profileOptions.find(
												(option) => option.value === (e.target as HTMLSelectElement).value,
											)
											if (!selected) {
												return
											}
											updateMember(index, {
												providerID: selected.apiProvider,
												modelID: selected.modelId,
											})
										}}
										data-testid={`agent-behaviour-vcp-agent-team-member-profile-select-${index}`}>
										<VSCodeOption value="">Use profile preset...</VSCodeOption>
										{profileOptions.map((option) => (
											<VSCodeOption key={option.value} value={option.value}>
												{option.label}
											</VSCodeOption>
										))}
									</VSCodeDropdown>
								)}
							</div>

							<div className="flex items-center gap-2">
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

							<VSCodeTextArea
								value={member.rolePrompt}
								rows={4}
								onInput={(e: any) => updateMember(index, { rolePrompt: String(e.target.value ?? "") })}
								data-testid={`agent-behaviour-vcp-agent-team-member-prompt-input-${index}`}>
								Role Prompt
							</VSCodeTextArea>
						</div>

						<div className="pt-2 flex justify-end">
							<Button
								variant="destructive"
								onClick={() => removeMember(index)}
								data-testid={`agent-behaviour-vcp-agent-team-member-remove-button-${index}`}>
								Remove
							</Button>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

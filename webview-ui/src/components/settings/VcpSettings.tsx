import { useEffect, useState } from "react"
import {
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeTextArea,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { getDefaultVcpConfig, type VcpAgentTeamMember, type VcpConfig } from "@roo-code/types"

import type { ExtensionStateContextType } from "@/context/ExtensionStateContext"
import { Button } from "@/components/ui"
import { vscode } from "@/utils/vscode"

import { Section } from "./Section"
import { SectionHeader } from "./SectionHeader"
import type { SetCachedStateField } from "./types"

type AutocompleteSettingField = "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete"

type VcpSettingsProps = {
	yoloMode?: boolean
	showAutoApproveMenu?: boolean
	browserToolEnabled?: boolean
	remoteBrowserEnabled?: boolean
	vcpConfig?: ExtensionStateContextType["vcpConfig"]
	vcpBridgeStatus?: ExtensionStateContextType["vcpBridgeStatus"]
	ghostServiceSettings?: ExtensionStateContextType["ghostServiceSettings"]
	setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType>
	setAutocompleteServiceSettingsField: (field: AutocompleteSettingField, value: boolean) => void
}

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends Array<infer U> ? Array<U> : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

const parseList = (value: string): string[] =>
	value
		.split(/[\n,]/g)
		.map((item) => item.trim())
		.filter((item) => item.length > 0)

const toInt = (value: string, min: number, fallback: number): number => {
	const next = Number(value)
	if (!Number.isFinite(next)) {
		return fallback
	}
	return Math.max(min, Math.floor(next))
}

const toFloat = (value: string, min: number, max: number, fallback: number): number => {
	const next = Number(value)
	if (!Number.isFinite(next)) {
		return fallback
	}
	return Math.min(max, Math.max(min, next))
}

const normalizeMember = (item: unknown): VcpAgentTeamMember | null => {
	if (!item || typeof item !== "object") {
		return null
	}
	const row = item as Record<string, unknown>
	const name = String(row.name ?? "").trim()
	const providerID = String(row.providerID ?? "").trim()
	const modelID = String(row.modelID ?? "").trim()
	const rolePrompt = String(row.rolePrompt ?? "").trim()
	if (!name || !providerID || !modelID) {
		return null
	}
	return { name, providerID, modelID, rolePrompt }
}

export const VcpSettings = ({
	yoloMode,
	showAutoApproveMenu,
	browserToolEnabled,
	remoteBrowserEnabled,
	vcpConfig,
	vcpBridgeStatus,
	ghostServiceSettings,
	setCachedStateField,
	setAutocompleteServiceSettingsField,
}: VcpSettingsProps) => {
	const openExternal = (url: string) => vscode.postMessage({ type: "openExternal", url })
	const currentVcpConfig = vcpConfig ?? getDefaultVcpConfig()
	const [membersJson, setMembersJson] = useState<string>(JSON.stringify(currentVcpConfig.agentTeam.members, null, 2))

	useEffect(() => {
		setMembersJson(JSON.stringify(currentVcpConfig.agentTeam.members, null, 2))
	}, [currentVcpConfig.agentTeam.members])

	const updateVcpConfig = (patch: DeepPartial<VcpConfig>) => {
		const next: VcpConfig = {
			...currentVcpConfig,
			...patch,
			contextFold: { ...currentVcpConfig.contextFold, ...(patch.contextFold ?? {}) },
			vcpInfo: { ...currentVcpConfig.vcpInfo, ...(patch.vcpInfo ?? {}) },
			html: { ...currentVcpConfig.html, ...(patch.html ?? {}) },
			toolRequest: { ...currentVcpConfig.toolRequest, ...(patch.toolRequest ?? {}) },
			agentTeam: { ...currentVcpConfig.agentTeam, ...(patch.agentTeam ?? {}) },
			memory: {
				...currentVcpConfig.memory,
				...(patch.memory ?? {}),
				passive: { ...currentVcpConfig.memory.passive, ...(patch.memory?.passive ?? {}) },
				writer: { ...currentVcpConfig.memory.writer, ...(patch.memory?.writer ?? {}) },
				retrieval: { ...currentVcpConfig.memory.retrieval, ...(patch.memory?.retrieval ?? {}) },
				refresh: { ...currentVcpConfig.memory.refresh, ...(patch.memory?.refresh ?? {}) },
			},
			toolbox: { ...currentVcpConfig.toolbox, ...(patch.toolbox ?? {}) },
		}

		setCachedStateField("vcpConfig", next)
	}

	const handleMembersBlur = () => {
		try {
			const parsed = JSON.parse(membersJson)
			if (!Array.isArray(parsed)) {
				return
			}
			const members = parsed
				.map((item) => normalizeMember(item))
				.filter((item): item is VcpAgentTeamMember => item !== null)
			updateVcpConfig({ agentTeam: { members } })
			setMembersJson(JSON.stringify(members, null, 2))
		} catch {
			// Ignore invalid JSON input until the user fixes it.
		}
	}

	return (
		<div>
			<SectionHeader description="Core VCP toggles and quick links.">VCP</SectionHeader>
			<Section>
				<VSCodeCheckbox
					checked={yoloMode ?? false}
					onChange={(e: any) => setCachedStateField("yoloMode", e.target.checked === true)}
					data-testid="vcp-yolo-checkbox">
					Enable YOLO routing
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={showAutoApproveMenu ?? true}
					onChange={(e: any) => setCachedStateField("showAutoApproveMenu", e.target.checked === true)}
					data-testid="vcp-auto-approve-menu-checkbox">
					Show auto-approve quick menu in chat
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={browserToolEnabled ?? true}
					onChange={(e: any) => setCachedStateField("browserToolEnabled", e.target.checked === true)}
					data-testid="vcp-browser-tool-checkbox">
					Enable browser automation tool
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={remoteBrowserEnabled ?? false}
					onChange={(e: any) => setCachedStateField("remoteBrowserEnabled", e.target.checked === true)}
					data-testid="vcp-remote-browser-checkbox">
					Enable remote browser mode
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={ghostServiceSettings?.enableAutoTrigger ?? false}
					onChange={(e: any) =>
						setAutocompleteServiceSettingsField("enableAutoTrigger", e.target.checked === true)
					}
					data-testid="vcp-autocomplete-auto-trigger-checkbox">
					Enable autocomplete auto trigger
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={ghostServiceSettings?.enableSmartInlineTaskKeybinding ?? false}
					onChange={(e: any) =>
						setAutocompleteServiceSettingsField(
							"enableSmartInlineTaskKeybinding",
							e.target.checked === true,
						)
					}
					data-testid="vcp-autocomplete-inline-keybinding-checkbox">
					Enable smart inline task keybinding
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={ghostServiceSettings?.enableChatAutocomplete ?? false}
					onChange={(e: any) =>
						setAutocompleteServiceSettingsField("enableChatAutocomplete", e.target.checked === true)
					}
					data-testid="vcp-chat-autocomplete-checkbox">
					Enable chat autocomplete
				</VSCodeCheckbox>
			</Section>

			<Section>
				<details open>
					<summary className="cursor-pointer font-medium mb-2">VCP 协议配置</summary>
					<div className="space-y-2">
						<VSCodeCheckbox
							checked={currentVcpConfig.enabled}
							onChange={(e: any) => updateVcpConfig({ enabled: e.target.checked === true })}
							data-testid="vcp-enabled-checkbox">
							Enable VCP protocol
						</VSCodeCheckbox>
						<VSCodeCheckbox
							checked={currentVcpConfig.contextFold.enabled}
							onChange={(e: any) =>
								updateVcpConfig({
									contextFold: { enabled: e.target.checked === true },
								})
							}
							data-testid="vcp-context-fold-enabled-checkbox">
							Enable context fold parser
						</VSCodeCheckbox>
						<VSCodeDropdown
							value={currentVcpConfig.contextFold.style}
							onChange={(e: any) =>
								updateVcpConfig({
									contextFold: {
										style: (e.target as HTMLSelectElement).value as "details" | "comment",
									},
								})
							}
							data-testid="vcp-context-fold-style-dropdown">
							<VSCodeOption value="details">details</VSCodeOption>
							<VSCodeOption value="comment">comment</VSCodeOption>
						</VSCodeDropdown>
						<VSCodeTextField
							value={currentVcpConfig.contextFold.startMarker}
							onInput={(e: any) =>
								updateVcpConfig({
									contextFold: { startMarker: String(e.target.value || "") },
								})
							}
							data-testid="vcp-context-fold-start-marker-input">
							Context Fold Start Marker
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.contextFold.endMarker}
							onInput={(e: any) =>
								updateVcpConfig({
									contextFold: { endMarker: String(e.target.value || "") },
								})
							}
							data-testid="vcp-context-fold-end-marker-input">
							Context Fold End Marker
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.vcpInfo.enabled}
							onChange={(e: any) =>
								updateVcpConfig({
									vcpInfo: { enabled: e.target.checked === true },
								})
							}
							data-testid="vcp-vcpinfo-enabled-checkbox">
							Enable VCP info parser
						</VSCodeCheckbox>
						<VSCodeTextField
							value={currentVcpConfig.vcpInfo.startMarker}
							onInput={(e: any) =>
								updateVcpConfig({ vcpInfo: { startMarker: String(e.target.value || "") } })
							}
							data-testid="vcp-vcpinfo-start-marker-input">
							VCPINFO Start Marker
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.vcpInfo.endMarker}
							onInput={(e: any) =>
								updateVcpConfig({ vcpInfo: { endMarker: String(e.target.value || "") } })
							}
							data-testid="vcp-vcpinfo-end-marker-input">
							VCPINFO End Marker
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.html.enabled}
							onChange={(e: any) => updateVcpConfig({ html: { enabled: e.target.checked === true } })}
							data-testid="vcp-html-enabled-checkbox">
							Allow HTML rendering in VCP content
						</VSCodeCheckbox>
					</div>
				</details>
			</Section>

			<Section>
				<details>
					<summary className="cursor-pointer font-medium mb-2">Tool Request 与 Bridge</summary>
					<div className="space-y-2">
						<VSCodeCheckbox
							checked={currentVcpConfig.toolRequest.enabled}
							onChange={(e: any) =>
								updateVcpConfig({
									toolRequest: { enabled: e.target.checked === true },
								})
							}
							data-testid="vcp-tool-request-enabled-checkbox">
							Enable tool request parser
						</VSCodeCheckbox>
						<VSCodeDropdown
							value={currentVcpConfig.toolRequest.bridgeMode}
							onChange={(e: any) =>
								updateVcpConfig({
									toolRequest: {
										bridgeMode: (e.target as HTMLSelectElement).value as "execute" | "event",
									},
								})
							}
							data-testid="vcp-tool-request-bridge-mode-dropdown">
							<VSCodeOption value="execute">execute</VSCodeOption>
							<VSCodeOption value="event">event</VSCodeOption>
						</VSCodeDropdown>
						<VSCodeTextField
							value={String(currentVcpConfig.toolRequest.maxPerMessage)}
							onInput={(e: any) =>
								updateVcpConfig({
									toolRequest: {
										maxPerMessage: toInt(
											String(e.target.value ?? ""),
											1,
											currentVcpConfig.toolRequest.maxPerMessage,
										),
									},
								})
							}
							data-testid="vcp-tool-request-max-per-message-input">
							Max Tool Requests Per Message
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.toolRequest.keepBlockInText}
							onChange={(e: any) =>
								updateVcpConfig({
									toolRequest: { keepBlockInText: e.target.checked === true },
								})
							}
							data-testid="vcp-tool-request-keep-block-checkbox">
							Keep raw tool request blocks in assistant text
						</VSCodeCheckbox>
						<VSCodeTextArea
							value={currentVcpConfig.toolRequest.allowTools.join("\n")}
							onInput={(e: any) =>
								updateVcpConfig({
									toolRequest: { allowTools: parseList(String(e.target.value || "")) },
								})
							}
							rows={4}
							data-testid="vcp-tool-request-allow-tools-input">
							Allow Tools (comma/newline separated)
						</VSCodeTextArea>
						<VSCodeTextArea
							value={currentVcpConfig.toolRequest.denyTools.join("\n")}
							onInput={(e: any) =>
								updateVcpConfig({
									toolRequest: { denyTools: parseList(String(e.target.value || "")) },
								})
							}
							rows={4}
							data-testid="vcp-tool-request-deny-tools-input">
							Deny Tools (comma/newline separated)
						</VSCodeTextArea>
						<VSCodeTextField
							value={currentVcpConfig.toolRequest.startMarker}
							onInput={(e: any) =>
								updateVcpConfig({
									toolRequest: { startMarker: String(e.target.value || "") },
								})
							}
							data-testid="vcp-tool-request-start-marker-input">
							Tool Request Start Marker
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.toolRequest.endMarker}
							onInput={(e: any) =>
								updateVcpConfig({
									toolRequest: { endMarker: String(e.target.value || "") },
								})
							}
							data-testid="vcp-tool-request-end-marker-input">
							Tool Request End Marker
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.toolbox.enabled}
							onChange={(e: any) => updateVcpConfig({ toolbox: { enabled: e.target.checked === true } })}
							data-testid="vcp-toolbox-enabled-checkbox">
							Enable VCPToolBox bridge
						</VSCodeCheckbox>
						<VSCodeTextField
							value={currentVcpConfig.toolbox.url}
							onInput={(e: any) => updateVcpConfig({ toolbox: { url: String(e.target.value || "") } })}
							data-testid="vcp-toolbox-url-input">
							WebSocket URL
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.toolbox.key}
							type="password"
							onInput={(e: any) => updateVcpConfig({ toolbox: { key: String(e.target.value || "") } })}
							data-testid="vcp-toolbox-key-input">
							Bridge Key
						</VSCodeTextField>
						<VSCodeTextField
							value={String(currentVcpConfig.toolbox.reconnectInterval)}
							onInput={(e: any) =>
								updateVcpConfig({
									toolbox: {
										reconnectInterval: toInt(
											String(e.target.value ?? ""),
											250,
											currentVcpConfig.toolbox.reconnectInterval,
										),
									},
								})
							}
							data-testid="vcp-toolbox-reconnect-interval-input">
							Reconnect Interval (ms)
						</VSCodeTextField>
						<div className="text-xs text-vscode-descriptionForeground">
							Bridge: {vcpBridgeStatus?.connected ? "Connected" : "Disconnected"}
						</div>
						<div className="flex flex-wrap gap-2">
							<Button
								onClick={() => {
									vscode.postMessage({
										type: "updateVcpConfig",
										config: { toolbox: currentVcpConfig.toolbox },
									})
									vscode.postMessage({ type: "requestVcpBridgeConnect" })
								}}
								data-testid="vcp-toolbox-connect-button">
								Connect Bridge
							</Button>
							<Button
								onClick={() => vscode.postMessage({ type: "requestVcpBridgeDisconnect" })}
								data-testid="vcp-toolbox-disconnect-button">
								Disconnect Bridge
							</Button>
						</div>
					</div>
				</details>
			</Section>

			<Section>
				<details>
					<summary className="cursor-pointer font-medium mb-2">Agent Team</summary>
					<div className="space-y-2">
						<VSCodeCheckbox
							checked={currentVcpConfig.agentTeam.enabled}
							onChange={(e: any) =>
								updateVcpConfig({ agentTeam: { enabled: e.target.checked === true } })
							}
							data-testid="vcp-agent-team-enabled-checkbox">
							Enable agent team orchestration
						</VSCodeCheckbox>
						<VSCodeTextField
							value={String(currentVcpConfig.agentTeam.maxParallel)}
							onInput={(e: any) =>
								updateVcpConfig({
									agentTeam: {
										maxParallel: toInt(
											String(e.target.value ?? ""),
											1,
											currentVcpConfig.agentTeam.maxParallel,
										),
									},
								})
							}
							data-testid="vcp-agent-team-max-parallel-input">
							Max Parallel Agents
						</VSCodeTextField>
						<VSCodeDropdown
							value={currentVcpConfig.agentTeam.waveStrategy}
							onChange={(e: any) =>
								updateVcpConfig({
									agentTeam: {
										waveStrategy: (e.target as HTMLSelectElement).value as
											| "sequential"
											| "parallel"
											| "adaptive",
									},
								})
							}
							data-testid="vcp-agent-team-wave-strategy-dropdown">
							<VSCodeOption value="sequential">sequential</VSCodeOption>
							<VSCodeOption value="parallel">parallel</VSCodeOption>
							<VSCodeOption value="adaptive">adaptive</VSCodeOption>
						</VSCodeDropdown>
						<VSCodeCheckbox
							checked={currentVcpConfig.agentTeam.requireFileSeparation}
							onChange={(e: any) =>
								updateVcpConfig({
									agentTeam: { requireFileSeparation: e.target.checked === true },
								})
							}
							data-testid="vcp-agent-team-file-separation-checkbox">
							Require file separation per agent
						</VSCodeCheckbox>
						<VSCodeDropdown
							value={currentVcpConfig.agentTeam.handoffFormat}
							onChange={(e: any) =>
								updateVcpConfig({
									agentTeam: {
										handoffFormat: (e.target as HTMLSelectElement).value as "json" | "markdown",
									},
								})
							}
							data-testid="vcp-agent-team-handoff-format-dropdown">
							<VSCodeOption value="markdown">markdown</VSCodeOption>
							<VSCodeOption value="json">json</VSCodeOption>
						</VSCodeDropdown>
						<VSCodeTextArea
							value={membersJson}
							onInput={(e: any) => setMembersJson(String(e.target.value || "[]"))}
							onBlur={handleMembersBlur}
							rows={8}
							data-testid="vcp-agent-team-members-json-input">
							Members JSON (array with name/providerID/modelID/rolePrompt)
						</VSCodeTextArea>
					</div>
				</details>
			</Section>

			<Section>
				<details>
					<summary className="cursor-pointer font-medium mb-2">Memory</summary>
					<div className="space-y-2">
						<VSCodeCheckbox
							checked={currentVcpConfig.memory.passive.enabled}
							onChange={(e: any) =>
								updateVcpConfig({ memory: { passive: { enabled: e.target.checked === true } } })
							}
							data-testid="vcp-memory-passive-enabled-checkbox">
							Enable passive memory
						</VSCodeCheckbox>
						<VSCodeTextField
							value={String(currentVcpConfig.memory.passive.maxItems)}
							onInput={(e: any) =>
								updateVcpConfig({
									memory: {
										passive: {
											maxItems: toInt(
												String(e.target.value ?? ""),
												1,
												currentVcpConfig.memory.passive.maxItems,
											),
										},
									},
								})
							}
							data-testid="vcp-memory-passive-max-items-input">
							Passive Memory Max Items
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.memory.writer.enabled}
							onChange={(e: any) =>
								updateVcpConfig({ memory: { writer: { enabled: e.target.checked === true } } })
							}
							data-testid="vcp-memory-writer-enabled-checkbox">
							Enable memory writer
						</VSCodeCheckbox>
						<VSCodeTextField
							value={String(currentVcpConfig.memory.writer.triggerTokens)}
							onInput={(e: any) =>
								updateVcpConfig({
									memory: {
										writer: {
											triggerTokens: toInt(
												String(e.target.value ?? ""),
												1,
												currentVcpConfig.memory.writer.triggerTokens,
											),
										},
									},
								})
							}
							data-testid="vcp-memory-writer-trigger-tokens-input">
							Writer Trigger Tokens
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.memory.retrieval.enabled}
							onChange={(e: any) =>
								updateVcpConfig({ memory: { retrieval: { enabled: e.target.checked === true } } })
							}
							data-testid="vcp-memory-retrieval-enabled-checkbox">
							Enable retrieval memory
						</VSCodeCheckbox>
						<VSCodeTextField
							value={String(currentVcpConfig.memory.retrieval.topK)}
							onInput={(e: any) =>
								updateVcpConfig({
									memory: {
										retrieval: {
											topK: toInt(
												String(e.target.value ?? ""),
												1,
												currentVcpConfig.memory.retrieval.topK,
											),
										},
									},
								})
							}
							data-testid="vcp-memory-retrieval-topk-input">
							Retrieval TopK
						</VSCodeTextField>
						<VSCodeTextField
							value={String(currentVcpConfig.memory.retrieval.decayFactor)}
							onInput={(e: any) =>
								updateVcpConfig({
									memory: {
										retrieval: {
											decayFactor: toFloat(
												String(e.target.value ?? ""),
												0,
												1,
												currentVcpConfig.memory.retrieval.decayFactor,
											),
										},
									},
								})
							}
							data-testid="vcp-memory-retrieval-decay-factor-input">
							Retrieval Decay Factor (0-1)
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.memory.refresh.enabled}
							onChange={(e: any) =>
								updateVcpConfig({ memory: { refresh: { enabled: e.target.checked === true } } })
							}
							data-testid="vcp-memory-refresh-enabled-checkbox">
							Enable refresh scheduler
						</VSCodeCheckbox>
						<VSCodeTextField
							value={String(currentVcpConfig.memory.refresh.intervalMs)}
							onInput={(e: any) =>
								updateVcpConfig({
									memory: {
										refresh: {
											intervalMs: toInt(
												String(e.target.value ?? ""),
												1000,
												currentVcpConfig.memory.refresh.intervalMs,
											),
										},
									},
								})
							}
							data-testid="vcp-memory-refresh-interval-ms-input">
							Refresh Interval (ms)
						</VSCodeTextField>
					</div>
				</details>
			</Section>

			<Section>
				<div className="text-vscode-descriptionForeground text-sm">
					Project:{" "}
					<VSCodeLink href="https://github.com/DerstedtCasper/vcp-code-2.0">
						github.com/DerstedtCasper/vcp-code-2.0
					</VSCodeLink>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button onClick={() => openExternal("https://github.com/DerstedtCasper/vcp-code-2.0/issues")}>
						Open Issues
					</Button>
					<Button
						variant="destructive"
						onClick={() => vscode.postMessage({ type: "resetState" })}
						data-testid="vcp-reset-state-button">
						Reset Extension State
					</Button>
				</div>
			</Section>
		</div>
	)
}

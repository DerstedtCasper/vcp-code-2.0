import { useEffect, useState } from "react"
import {
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeTextArea,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { getDefaultVcpConfig, type VcpBridgeLogEntry, type VcpBridgeTestResult, type VcpConfig } from "@roo-code/types"

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
	const [bridgeLogs, setBridgeLogs] = useState<VcpBridgeLogEntry[]>([])
	const [bridgeTestResult, setBridgeTestResult] = useState<VcpBridgeTestResult | undefined>(undefined)
	const [isTestingBridge, setIsTestingBridge] = useState(false)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "vcpBridgeLog") {
				const entries = (message.vcpBridgeLogEntries ?? message.entries ?? []) as VcpBridgeLogEntry[]
				if (entries.length > 0) {
					setBridgeLogs((prev) => [...prev, ...entries].slice(-100))
				}
				return
			}
			if (message.type === "vcpBridgeTestResult") {
				setIsTestingBridge(false)
				setBridgeTestResult(message.vcpBridgeTestResult)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

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
			snowCompat: {
				...currentVcpConfig.snowCompat,
				...(patch.snowCompat ?? {}),
				responsesReasoning: {
					...currentVcpConfig.snowCompat.responsesReasoning,
					...(patch.snowCompat?.responsesReasoning ?? {}),
				},
				proxy: {
					...currentVcpConfig.snowCompat.proxy,
					...(patch.snowCompat?.proxy ?? {}),
				},
			},
		}

		setCachedStateField("vcpConfig", next)
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
						<div
							className="rounded-md p-2 text-xs"
							style={{
								background: "var(--vscode-editorWidget-background)",
								border: "1px solid var(--vscode-editorWidget-border)",
							}}>
							<div className="font-medium text-[var(--vscode-foreground)] mb-1">
								Bridge: {vcpBridgeStatus?.connected ? "Connected" : "Disconnected"}
							</div>
							<div className="text-vscode-descriptionForeground">
								Endpoint: {vcpBridgeStatus?.endpoint || currentVcpConfig.toolbox.url || "(unset)"}
							</div>
							<div className="text-vscode-descriptionForeground">
								Last latency: {vcpBridgeStatus?.lastLatencyMs ?? bridgeTestResult?.latencyMs ?? "-"} ms
							</div>
							<div className="text-vscode-descriptionForeground">
								Reconnect attempts: {vcpBridgeStatus?.reconnectAttempts ?? 0}
							</div>
							{vcpBridgeStatus?.lastError && (
								<div className="text-vscode-errorForeground mt-1">
									Last error: {vcpBridgeStatus.lastError}
								</div>
							)}
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
								variant="secondary"
								onClick={() => {
									setBridgeTestResult(undefined)
									setIsTestingBridge(true)
									vscode.postMessage({
										type: "updateVcpConfig",
										config: { toolbox: currentVcpConfig.toolbox },
									})
									vscode.postMessage({ type: "requestVcpBridgeTest", timeout: 5000 })
								}}
								data-testid="vcp-toolbox-test-button">
								{isTestingBridge ? "Testing..." : "Test Bridge"}
							</Button>
							<Button
								onClick={() => vscode.postMessage({ type: "requestVcpBridgeDisconnect" })}
								data-testid="vcp-toolbox-disconnect-button">
								Disconnect Bridge
							</Button>
						</div>
						{bridgeTestResult && (
							<div
								className="rounded-md p-2 text-xs"
								style={{
									background: bridgeTestResult.success
										? "var(--vscode-testing-iconPassed)"
										: "var(--vscode-inputValidation-errorBackground)",
									color: "var(--vscode-editor-foreground)",
									opacity: 0.85,
								}}>
								{bridgeTestResult.success
									? `Bridge test succeeded (${bridgeTestResult.latencyMs ?? 0}ms)`
									: `Bridge test failed: ${bridgeTestResult.error ?? "unknown error"}`}
								{bridgeTestResult.endpoint ? ` | ${bridgeTestResult.endpoint}` : ""}
							</div>
						)}
						{bridgeLogs.length > 0 && (
							<details>
								<summary className="cursor-pointer font-medium text-xs">
									Bridge Logs ({bridgeLogs.length})
								</summary>
								<div
									className="max-h-40 overflow-y-auto text-xs mt-1 rounded p-2"
									style={{
										background: "var(--vscode-textCodeBlock-background)",
										border: "1px solid var(--vscode-editorWidget-border)",
									}}>
									{bridgeLogs
										.slice()
										.reverse()
										.map((entry, index) => (
											<div key={`${entry.timestamp}-${index}`} className="mb-1">
												<span className="opacity-70">
													[{new Date(entry.timestamp).toLocaleTimeString()}]
												</span>{" "}
												<span className="font-medium">{entry.level.toUpperCase()}</span>{" "}
												{entry.message}
											</div>
										))}
								</div>
							</details>
						)}
					</div>
				</details>
			</Section>

			<Section>
				<details>
					<summary className="cursor-pointer font-medium mb-2">Snow Compat</summary>
					<div className="space-y-2">
						<VSCodeCheckbox
							checked={currentVcpConfig.snowCompat.enabled}
							onChange={(e: any) =>
								updateVcpConfig({ snowCompat: { enabled: e.target.checked === true } })
							}
							data-testid="vcp-snow-compat-enabled-checkbox">
							Enable Snow compatibility profile
						</VSCodeCheckbox>
						<VSCodeTextField
							value={currentVcpConfig.snowCompat.basicModel}
							onInput={(e: any) =>
								updateVcpConfig({ snowCompat: { basicModel: String(e.target.value || "") } })
							}
							data-testid="vcp-snow-compat-basic-model-input">
							Basic Model
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.snowCompat.advancedModel}
							onInput={(e: any) =>
								updateVcpConfig({ snowCompat: { advancedModel: String(e.target.value || "") } })
							}
							data-testid="vcp-snow-compat-advanced-model-input">
							Advanced Model
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.snowCompat.baseUrl}
							onInput={(e: any) =>
								updateVcpConfig({ snowCompat: { baseUrl: String(e.target.value || "") } })
							}
							data-testid="vcp-snow-compat-base-url-input">
							Base URL
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.snowCompat.requestMethod}
							onInput={(e: any) =>
								updateVcpConfig({ snowCompat: { requestMethod: String(e.target.value || "") } })
							}
							data-testid="vcp-snow-compat-request-method-input">
							Request Method
						</VSCodeTextField>
						<VSCodeTextField
							value={String(currentVcpConfig.snowCompat.maxContextTokens)}
							onInput={(e: any) =>
								updateVcpConfig({
									snowCompat: {
										maxContextTokens: toInt(
											String(e.target.value ?? ""),
											0,
											currentVcpConfig.snowCompat.maxContextTokens,
										),
									},
								})
							}
							data-testid="vcp-snow-compat-max-context-tokens-input">
							Max Context Tokens
						</VSCodeTextField>
						<VSCodeTextField
							value={String(currentVcpConfig.snowCompat.maxTokens)}
							onInput={(e: any) =>
								updateVcpConfig({
									snowCompat: {
										maxTokens: toInt(
											String(e.target.value ?? ""),
											1,
											currentVcpConfig.snowCompat.maxTokens,
										),
									},
								})
							}
							data-testid="vcp-snow-compat-max-tokens-input">
							Max Output Tokens
						</VSCodeTextField>
						<VSCodeTextField
							value={String(currentVcpConfig.snowCompat.toolResultTokenLimit)}
							onInput={(e: any) =>
								updateVcpConfig({
									snowCompat: {
										toolResultTokenLimit: toInt(
											String(e.target.value ?? ""),
											1,
											currentVcpConfig.snowCompat.toolResultTokenLimit,
										),
									},
								})
							}
							data-testid="vcp-snow-compat-tool-result-token-limit-input">
							Tool Result Token Limit
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.snowCompat.showThinking}
							onChange={(e: any) =>
								updateVcpConfig({ snowCompat: { showThinking: e.target.checked === true } })
							}
							data-testid="vcp-snow-compat-show-thinking-checkbox">
							Show Thinking
						</VSCodeCheckbox>
						<VSCodeCheckbox
							checked={currentVcpConfig.snowCompat.enableAutoCompress}
							onChange={(e: any) =>
								updateVcpConfig({ snowCompat: { enableAutoCompress: e.target.checked === true } })
							}
							data-testid="vcp-snow-compat-auto-compress-checkbox">
							Enable Auto Compress
						</VSCodeCheckbox>
						<VSCodeTextField
							value={String(currentVcpConfig.snowCompat.editSimilarityThreshold)}
							onInput={(e: any) =>
								updateVcpConfig({
									snowCompat: {
										editSimilarityThreshold: toFloat(
											String(e.target.value ?? ""),
											0,
											1,
											currentVcpConfig.snowCompat.editSimilarityThreshold,
										),
									},
								})
							}
							data-testid="vcp-snow-compat-edit-similarity-threshold-input">
							Edit Similarity Threshold (0-1)
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.snowCompat.anthropicBeta}
							onInput={(e: any) =>
								updateVcpConfig({ snowCompat: { anthropicBeta: String(e.target.value || "") } })
							}
							data-testid="vcp-snow-compat-anthropic-beta-input">
							Anthropic Beta
						</VSCodeTextField>
						<VSCodeTextField
							value={currentVcpConfig.snowCompat.anthropicCacheTTL}
							onInput={(e: any) =>
								updateVcpConfig({ snowCompat: { anthropicCacheTTL: String(e.target.value || "") } })
							}
							data-testid="vcp-snow-compat-anthropic-cache-ttl-input">
							Anthropic Cache TTL
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.snowCompat.responsesReasoning.enabled}
							onChange={(e: any) =>
								updateVcpConfig({
									snowCompat: {
										responsesReasoning: { enabled: e.target.checked === true },
									},
								})
							}
							data-testid="vcp-snow-compat-reasoning-enabled-checkbox">
							Responses Reasoning Enabled
						</VSCodeCheckbox>
						<VSCodeTextField
							value={currentVcpConfig.snowCompat.responsesReasoning.effort}
							onInput={(e: any) =>
								updateVcpConfig({
									snowCompat: {
										responsesReasoning: { effort: String(e.target.value || "") },
									},
								})
							}
							data-testid="vcp-snow-compat-reasoning-effort-input">
							Responses Reasoning Effort
						</VSCodeTextField>
						<VSCodeCheckbox
							checked={currentVcpConfig.snowCompat.proxy.enabled}
							onChange={(e: any) =>
								updateVcpConfig({
									snowCompat: { proxy: { enabled: e.target.checked === true } },
								})
							}
							data-testid="vcp-snow-compat-proxy-enabled-checkbox">
							Enable Snow Proxy
						</VSCodeCheckbox>
						<VSCodeTextField
							value={String(currentVcpConfig.snowCompat.proxy.port)}
							onInput={(e: any) =>
								updateVcpConfig({
									snowCompat: {
										proxy: {
											port: toInt(
												String(e.target.value ?? ""),
												1,
												currentVcpConfig.snowCompat.proxy.port,
											),
										},
									},
								})
							}
							data-testid="vcp-snow-compat-proxy-port-input">
							Proxy Port
						</VSCodeTextField>
						<VSCodeTextField
							value={String(currentVcpConfig.snowCompat.proxy.browserDebugPort)}
							onInput={(e: any) =>
								updateVcpConfig({
									snowCompat: {
										proxy: {
											browserDebugPort: toInt(
												String(e.target.value ?? ""),
												1,
												currentVcpConfig.snowCompat.proxy.browserDebugPort,
											),
										},
									},
								})
							}
							data-testid="vcp-snow-compat-proxy-browser-debug-port-input">
							Proxy Browser Debug Port
						</VSCodeTextField>
					</div>
				</details>
			</Section>

			<Section>
				<details>
					<summary className="cursor-pointer font-medium mb-2">Agent Team 与 Memory</summary>
					<div className="text-xs text-vscode-descriptionForeground">
						Agent Team 设置已迁移到「代理行为」页面，Memory 设置已迁移到「上下文管理」页面，便于集中配置。
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

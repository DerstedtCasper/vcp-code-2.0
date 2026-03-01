import { HTMLAttributes } from "react"
import React from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { FoldVertical } from "lucide-react"
import { getDefaultVcpConfig, type VcpConfig } from "@roo-code/types"

import { cn } from "@/lib/utils"
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Button } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { vscode } from "@/utils/vscode"

type ContextManagementSettingsProps = HTMLAttributes<HTMLDivElement> & {
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	listApiConfigMeta: any[]
	maxOpenTabsContext: number
	maxWorkspaceFiles: number
	showRooIgnoredFiles?: boolean
	enableSubfolderRules?: boolean
	maxReadFileLine?: number
	maxImageFileSize?: number
	maxTotalImageSize?: number
	maxConcurrentFileReads?: number
	allowVeryLargeReads?: boolean // novacode_change
	profileThresholds?: Record<string, number>
	includeDiagnosticMessages?: boolean
	maxDiagnosticMessages?: number
	writeDelayMs: number
	includeCurrentTime?: boolean
	includeCurrentCost?: boolean
	maxGitStatusFiles?: number
	vcpConfig?: VcpConfig
	onUpdateVcpConfig?: (patch: DeepPartial<VcpConfig>) => void
	setCachedStateField: SetCachedStateField<
		| "autoCondenseContext"
		| "autoCondenseContextPercent"
		| "maxOpenTabsContext"
		| "maxWorkspaceFiles"
		| "showRooIgnoredFiles"
		| "enableSubfolderRules"
		| "maxReadFileLine"
		| "maxImageFileSize"
		| "maxTotalImageSize"
		| "maxConcurrentFileReads"
		| "allowVeryLargeReads" // novacode_change
		| "profileThresholds"
		| "includeDiagnosticMessages"
		| "maxDiagnosticMessages"
		| "writeDelayMs"
		| "includeCurrentTime"
		| "includeCurrentCost"
		| "maxGitStatusFiles"
	>
}

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends Array<infer U> ? Array<U> : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

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

export const ContextManagementSettings = ({
	autoCondenseContext,
	autoCondenseContextPercent,
	listApiConfigMeta,
	maxOpenTabsContext,
	maxWorkspaceFiles,
	showRooIgnoredFiles,
	enableSubfolderRules,
	setCachedStateField,
	maxReadFileLine,
	maxImageFileSize,
	maxTotalImageSize,
	maxConcurrentFileReads,
	allowVeryLargeReads, // novacode_change
	profileThresholds = {},
	includeDiagnosticMessages,
	maxDiagnosticMessages,
	writeDelayMs,
	includeCurrentTime,
	includeCurrentCost,
	maxGitStatusFiles,
	vcpConfig,
	onUpdateVcpConfig,
	className,
	...props
}: ContextManagementSettingsProps) => {
	const { t } = useAppTranslation()
	const [selectedThresholdProfile, setSelectedThresholdProfile] = React.useState<string>("default")
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

	// Helper function to get the current threshold value based on selected profile
	const getCurrentThresholdValue = () => {
		if (selectedThresholdProfile === "default") {
			return autoCondenseContextPercent
		}
		const profileThreshold = profileThresholds[selectedThresholdProfile]
		if (profileThreshold === undefined || profileThreshold === -1) {
			return autoCondenseContextPercent // Use default if profile not configured or set to -1
		}
		return profileThreshold
	}

	// Helper function to handle threshold changes
	const handleThresholdChange = (value: number) => {
		if (selectedThresholdProfile === "default") {
			setCachedStateField("autoCondenseContextPercent", value)
		} else {
			const newThresholds = {
				...profileThresholds,
				[selectedThresholdProfile]: value,
			}

			setCachedStateField("profileThresholds", newThresholds)
			vscode.postMessage({ type: "updateSettings", updatedSettings: { profileThresholds: newThresholds } })
		}
	}
	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader description={t("settings:contextManagement.description")}>
				{t("settings:sections.contextManagement")}
			</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="context-open-tabs"
					section="contextManagement"
					label={t("settings:contextManagement.openTabs.label")}>
					<span className="block font-medium mb-1">{t("settings:contextManagement.openTabs.label")}</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={500}
							step={1}
							value={[maxOpenTabsContext ?? 20]}
							onValueChange={([value]) => setCachedStateField("maxOpenTabsContext", value)}
							data-testid="open-tabs-limit-slider"
						/>
						<span className="w-10">{maxOpenTabsContext ?? 20}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.openTabs.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-workspace-files"
					section="contextManagement"
					label={t("settings:contextManagement.workspaceFiles.label")}>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.workspaceFiles.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={500}
							step={1}
							value={[maxWorkspaceFiles ?? 200]}
							onValueChange={([value]) => setCachedStateField("maxWorkspaceFiles", value)}
							data-testid="workspace-files-limit-slider"
						/>
						<span className="w-10">{maxWorkspaceFiles ?? 200}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.workspaceFiles.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-max-git-status-files"
					section="contextManagement"
					label={t("settings:contextManagement.maxGitStatusFiles.label")}>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.maxGitStatusFiles.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={50}
							step={1}
							value={[maxGitStatusFiles ?? 0]}
							onValueChange={([value]) => setCachedStateField("maxGitStatusFiles", value)}
							data-testid="max-git-status-files-slider"
						/>
						<span className="w-10">{maxGitStatusFiles ?? 0}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.maxGitStatusFiles.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-max-concurrent-file-reads"
					section="contextManagement"
					label={t("settings:contextManagement.maxConcurrentFileReads.label")}>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.maxConcurrentFileReads.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={1}
							max={100}
							step={1}
							value={[Math.max(1, maxConcurrentFileReads ?? 5)]}
							onValueChange={([value]) => setCachedStateField("maxConcurrentFileReads", value)}
							data-testid="max-concurrent-file-reads-slider"
						/>
						<span className="w-10 text-sm">{Math.max(1, maxConcurrentFileReads ?? 5)}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.maxConcurrentFileReads.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-show-rooignored-files"
					section="contextManagement"
					label={t("settings:contextManagement.rooignore.label")}>
					<VSCodeCheckbox
						checked={showRooIgnoredFiles}
						onChange={(e: any) => setCachedStateField("showRooIgnoredFiles", e.target.checked)}
						data-testid="show-rooignored-files-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:contextManagement.rooignore.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.rooignore.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-enable-subfolder-rules"
					section="contextManagement"
					label={t("settings:contextManagement.enableSubfolderRules.label")}>
					<VSCodeCheckbox
						checked={enableSubfolderRules}
						onChange={(e: any) => setCachedStateField("enableSubfolderRules", e.target.checked)}
						data-testid="enable-subfolder-rules-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:contextManagement.enableSubfolderRules.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.enableSubfolderRules.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-max-read-file"
					section="contextManagement"
					label={t("settings:contextManagement.maxReadFile.label")}>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.maxReadFile.label")}</span>
						<div className="flex items-center gap-4">
							<Input
								type="number"
								pattern="-?[0-9]*"
								className="w-24 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
								value={maxReadFileLine ?? 500 /*novacode_change*/}
								min={-1}
								onChange={(e) => {
									const newValue = parseInt(e.target.value, 10)
									if (!isNaN(newValue) && newValue >= -1) {
										setCachedStateField("maxReadFileLine", newValue)
									}
								}}
								onClick={(e) => e.currentTarget.select()}
								data-testid="max-read-file-line-input"
								disabled={maxReadFileLine === -1}
							/>
							<span>{t("settings:contextManagement.maxReadFile.lines")}</span>
							<VSCodeCheckbox
								checked={maxReadFileLine === -1}
								onChange={(e: any) =>
									setCachedStateField("maxReadFileLine", e.target.checked ? -1 : 500)
								}
								data-testid="max-read-file-always-full-checkbox">
								{t("settings:contextManagement.maxReadFile.always_full_read")}
							</VSCodeCheckbox>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-2">
						{t("settings:contextManagement.maxReadFile.description")}
					</div>
				</SearchableSetting>
				{/*novacode_change start*/}
				<div>
					<VSCodeCheckbox
						checked={allowVeryLargeReads}
						onChange={(e: any) => setCachedStateField("allowVeryLargeReads", e.target.checked)}>
						<label className="block font-medium mb-1">
							{t("novacode:settings.contextManagement.allowVeryLargeReads.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("novacode:settings.contextManagement.allowVeryLargeReads.description")}
					</div>
				</div>
				{/*novacode_change end*/}
				<SearchableSetting
					settingId="context-max-image-file-size"
					section="contextManagement"
					label={t("settings:contextManagement.maxImageFileSize.label")}>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.maxImageFileSize.label")}</span>
						<div className="flex items-center gap-4">
							<Input
								type="number"
								pattern="[0-9]*"
								className="w-24 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								value={maxImageFileSize ?? 5}
								min={1}
								max={100}
								onChange={(e) => {
									const newValue = parseInt(e.target.value, 10)
									if (!isNaN(newValue) && newValue >= 1 && newValue <= 100) {
										setCachedStateField("maxImageFileSize", newValue)
									}
								}}
								onClick={(e) => e.currentTarget.select()}
								data-testid="max-image-file-size-input"
							/>
							<span>{t("settings:contextManagement.maxImageFileSize.mb")}</span>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-2">
						{t("settings:contextManagement.maxImageFileSize.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-max-total-image-size"
					section="contextManagement"
					label={t("settings:contextManagement.maxTotalImageSize.label")}>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.maxTotalImageSize.label")}</span>
						<div className="flex items-center gap-4">
							<Input
								type="number"
								pattern="[0-9]*"
								className="w-24 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								value={maxTotalImageSize ?? 20}
								min={1}
								max={500}
								onChange={(e) => {
									const newValue = parseInt(e.target.value, 10)
									if (!isNaN(newValue) && newValue >= 1 && newValue <= 500) {
										setCachedStateField("maxTotalImageSize", newValue)
									}
								}}
								onClick={(e) => e.currentTarget.select()}
								data-testid="max-total-image-size-input"
							/>
							<span>{t("settings:contextManagement.maxTotalImageSize.mb")}</span>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-2">
						{t("settings:contextManagement.maxTotalImageSize.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-include-diagnostic-messages"
					section="contextManagement"
					label={t("settings:contextManagement.diagnostics.includeMessages.label")}>
					<VSCodeCheckbox
						checked={includeDiagnosticMessages}
						onChange={(e: any) => setCachedStateField("includeDiagnosticMessages", e.target.checked)}
						data-testid="include-diagnostic-messages-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:contextManagement.diagnostics.includeMessages.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.diagnostics.includeMessages.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-max-diagnostic-messages"
					section="contextManagement"
					label={t("settings:contextManagement.diagnostics.maxMessages.label")}>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.diagnostics.maxMessages.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={1}
							max={100}
							step={1}
							value={[
								maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0
									? 100
									: (maxDiagnosticMessages ?? 50),
							]}
							onValueChange={([value]) => {
								// When slider reaches 100, set to -1 (unlimited)
								setCachedStateField("maxDiagnosticMessages", value === 100 ? -1 : value)
							}}
							data-testid="max-diagnostic-messages-slider"
							aria-label={t("settings:contextManagement.diagnostics.maxMessages.label")}
							aria-valuemin={1}
							aria-valuemax={100}
							aria-valuenow={
								maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0
									? 100
									: (maxDiagnosticMessages ?? 50)
							}
							aria-valuetext={
								(maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0) ||
								maxDiagnosticMessages === 100
									? t("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel")
									: `${maxDiagnosticMessages ?? 50} ${t("settings:contextManagement.diagnostics.maxMessages.label")}`
							}
						/>
						<span className="w-20 text-sm font-medium">
							{(maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0) ||
							maxDiagnosticMessages === 100
								? t("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel")
								: (maxDiagnosticMessages ?? 50)}
						</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setCachedStateField("maxDiagnosticMessages", 50)}
							title={t("settings:contextManagement.diagnostics.maxMessages.resetTooltip")}
							className="p-1 h-6 w-6"
							disabled={maxDiagnosticMessages === 50}>
							<span className="codicon codicon-discard" />
						</Button>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.diagnostics.maxMessages.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-write-delay"
					section="contextManagement"
					label={t("settings:contextManagement.diagnostics.delayAfterWrite.label")}>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.diagnostics.delayAfterWrite.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={5000}
							step={100}
							value={[writeDelayMs]}
							onValueChange={([value]) => setCachedStateField("writeDelayMs", value)}
							data-testid="write-delay-slider"
						/>
						<span className="w-20">{writeDelayMs}ms</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.diagnostics.delayAfterWrite.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-include-current-time"
					section="contextManagement"
					label={t("settings:contextManagement.includeCurrentTime.label")}>
					<VSCodeCheckbox
						checked={includeCurrentTime}
						onChange={(e: any) => setCachedStateField("includeCurrentTime", e.target.checked)}
						data-testid="include-current-time-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:contextManagement.includeCurrentTime.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.includeCurrentTime.description")}
					</div>
				</SearchableSetting>
				<SearchableSetting
					settingId="context-include-current-cost"
					section="contextManagement"
					label={t("settings:contextManagement.includeCurrentCost.label")}>
					<VSCodeCheckbox
						checked={includeCurrentCost}
						onChange={(e: any) => setCachedStateField("includeCurrentCost", e.target.checked)}
						data-testid="include-current-cost-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:contextManagement.includeCurrentCost.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.includeCurrentCost.description")}
					</div>
				</SearchableSetting>

				<div className="mt-4 rounded border border-vscode-panel-border p-3">
					<div className="font-medium mb-2">VCP Memory</div>
					<div className="text-vscode-descriptionForeground text-sm mb-3">
						Memory 配置已迁移至上下文管理，支持更细粒度参数。
					</div>

					<div className="grid grid-cols-1 gap-3">
						<VSCodeCheckbox
							checked={currentVcpConfig.memory.passive.enabled}
							onChange={(e: any) =>
								onUpdateVcpConfig?.({ memory: { passive: { enabled: e.target.checked === true } } })
							}
							data-testid="context-vcp-memory-passive-enabled-checkbox">
							Enable passive memory
						</VSCodeCheckbox>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								className="w-32"
								value={String(currentVcpConfig.memory.passive.maxItems)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
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
								data-testid="context-vcp-memory-passive-max-items-input"
							/>
							<span className="text-sm">Passive max items</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								className="w-32"
								value={String(currentVcpConfig.memory.passive.maxCharsPerItem)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
										memory: {
											passive: {
												maxCharsPerItem: toInt(
													String(e.target.value ?? ""),
													1,
													currentVcpConfig.memory.passive.maxCharsPerItem,
												),
											},
										},
									})
								}
								data-testid="context-vcp-memory-passive-max-chars-input"
							/>
							<span className="text-sm">Passive max chars per item</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								step="0.01"
								className="w-32"
								value={String(currentVcpConfig.memory.passive.minImportance)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
										memory: {
											passive: {
												minImportance: toFloat(
													String(e.target.value ?? ""),
													0,
													1,
													currentVcpConfig.memory.passive.minImportance,
												),
											},
										},
									})
								}
								data-testid="context-vcp-memory-passive-min-importance-input"
							/>
							<span className="text-sm">Passive min importance (0-1)</span>
						</div>

						<hr className="border-vscode-panel-border" />

						<VSCodeCheckbox
							checked={currentVcpConfig.memory.writer.enabled}
							onChange={(e: any) =>
								onUpdateVcpConfig?.({ memory: { writer: { enabled: e.target.checked === true } } })
							}
							data-testid="context-vcp-memory-writer-enabled-checkbox">
							Enable memory writer
						</VSCodeCheckbox>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								className="w-32"
								value={String(currentVcpConfig.memory.writer.triggerTokens)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
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
								data-testid="context-vcp-memory-writer-trigger-tokens-input"
							/>
							<span className="text-sm">Writer trigger tokens</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								className="w-32"
								value={String(currentVcpConfig.memory.writer.minChars)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
										memory: {
											writer: {
												minChars: toInt(
													String(e.target.value ?? ""),
													1,
													currentVcpConfig.memory.writer.minChars,
												),
											},
										},
									})
								}
								data-testid="context-vcp-memory-writer-min-chars-input"
							/>
							<span className="text-sm">Writer min chars</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								step="0.01"
								className="w-32"
								value={String(currentVcpConfig.memory.writer.importanceThreshold)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
										memory: {
											writer: {
												importanceThreshold: toFloat(
													String(e.target.value ?? ""),
													0,
													1,
													currentVcpConfig.memory.writer.importanceThreshold,
												),
											},
										},
									})
								}
								data-testid="context-vcp-memory-writer-importance-threshold-input"
							/>
							<span className="text-sm">Writer importance threshold (0-1)</span>
						</div>
						<VSCodeCheckbox
							checked={currentVcpConfig.memory.writer.summarizeLongContent}
							onChange={(e: any) =>
								onUpdateVcpConfig?.({
									memory: { writer: { summarizeLongContent: e.target.checked === true } },
								})
							}
							data-testid="context-vcp-memory-writer-summarize-checkbox">
							Summarize long content before writing
						</VSCodeCheckbox>

						<hr className="border-vscode-panel-border" />

						<VSCodeCheckbox
							checked={currentVcpConfig.memory.retrieval.enabled}
							onChange={(e: any) =>
								onUpdateVcpConfig?.({
									memory: { retrieval: { enabled: e.target.checked === true } },
								})
							}
							data-testid="context-vcp-memory-retrieval-enabled-checkbox">
							Enable retrieval memory
						</VSCodeCheckbox>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								className="w-32"
								value={String(currentVcpConfig.memory.retrieval.topK)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
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
								data-testid="context-vcp-memory-retrieval-topk-input"
							/>
							<span className="text-sm">Retrieval topK</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								step="0.01"
								className="w-32"
								value={String(currentVcpConfig.memory.retrieval.decayFactor)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
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
								data-testid="context-vcp-memory-retrieval-decay-factor-input"
							/>
							<span className="text-sm">Retrieval decay factor (0-1)</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								step="0.01"
								className="w-32"
								value={String(currentVcpConfig.memory.retrieval.minScore)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
										memory: {
											retrieval: {
												minScore: toFloat(
													String(e.target.value ?? ""),
													0,
													1,
													currentVcpConfig.memory.retrieval.minScore,
												),
											},
										},
									})
								}
								data-testid="context-vcp-memory-retrieval-min-score-input"
							/>
							<span className="text-sm">Retrieval min score (0-1)</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								step="0.05"
								className="w-32"
								value={String(currentVcpConfig.memory.retrieval.recencyBias)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
										memory: {
											retrieval: {
												recencyBias: toFloat(
													String(e.target.value ?? ""),
													0,
													2,
													currentVcpConfig.memory.retrieval.recencyBias,
												),
											},
										},
									})
								}
								data-testid="context-vcp-memory-retrieval-recency-bias-input"
							/>
							<span className="text-sm">Retrieval recency bias (0-2)</span>
						</div>

						<hr className="border-vscode-panel-border" />

						<VSCodeCheckbox
							checked={currentVcpConfig.memory.refresh.enabled}
							onChange={(e: any) =>
								onUpdateVcpConfig?.({ memory: { refresh: { enabled: e.target.checked === true } } })
							}
							data-testid="context-vcp-memory-refresh-enabled-checkbox">
							Enable refresh scheduler
						</VSCodeCheckbox>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								className="w-32"
								value={String(currentVcpConfig.memory.refresh.intervalMs)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
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
								data-testid="context-vcp-memory-refresh-interval-ms-input"
							/>
							<span className="text-sm">Refresh interval (ms)</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								className="w-32"
								value={String(currentVcpConfig.memory.refresh.maxItemsPerRun)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
										memory: {
											refresh: {
												maxItemsPerRun: toInt(
													String(e.target.value ?? ""),
													1,
													currentVcpConfig.memory.refresh.maxItemsPerRun,
												),
											},
										},
									})
								}
								data-testid="context-vcp-memory-refresh-max-items-input"
							/>
							<span className="text-sm">Refresh max items per run</span>
						</div>
						<div className="flex items-center gap-2">
							<Input
								type="number"
								className="w-32"
								value={String(currentVcpConfig.memory.refresh.cleanupDays)}
								onChange={(e) =>
									onUpdateVcpConfig?.({
										memory: {
											refresh: {
												cleanupDays: toInt(
													String(e.target.value ?? ""),
													1,
													currentVcpConfig.memory.refresh.cleanupDays,
												),
											},
										},
									})
								}
								data-testid="context-vcp-memory-refresh-cleanup-days-input"
							/>
							<span className="text-sm">Cleanup age (days)</span>
						</div>
					</div>
				</div>
			</Section>
			<Section className="pt-2">
				<SearchableSetting
					settingId="context-auto-condense"
					section="contextManagement"
					label={t("settings:contextManagement.autoCondenseContext.name")}>
					<VSCodeCheckbox
						checked={autoCondenseContext}
						onChange={(e: any) => setCachedStateField("autoCondenseContext", e.target.checked)}
						data-testid="auto-condense-context-checkbox">
						<span className="font-medium">{t("settings:contextManagement.autoCondenseContext.name")}</span>
					</VSCodeCheckbox>
				</SearchableSetting>
				{autoCondenseContext && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<FoldVertical size={16} />
							<div>{t("settings:contextManagement.condensingThreshold.label")}</div>
						</div>
						<div>
							<Select
								value={selectedThresholdProfile || "default"}
								onValueChange={(value) => {
									setSelectedThresholdProfile(value)
								}}
								data-testid="threshold-profile-select">
								<SelectTrigger className="w-full">
									<SelectValue
										placeholder={
											t("settings:contextManagement.condensingThreshold.selectProfile") ||
											"Select profile for threshold"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="default">
										{t("settings:contextManagement.condensingThreshold.defaultProfile") ||
											"Default (applies to all unconfigured profiles)"}
									</SelectItem>
									{(listApiConfigMeta || []).map((config) => {
										const profileThreshold = profileThresholds[config.id]
										const thresholdDisplay =
											profileThreshold !== undefined
												? profileThreshold === -1
													? ` ${t(
															"settings:contextManagement.condensingThreshold.usesGlobal",
															{
																threshold: autoCondenseContextPercent,
															},
														)}`
													: ` (${profileThreshold}%)`
												: ""
										return (
											<SelectItem key={config.id} value={config.id}>
												{config.name}
												{thresholdDisplay}
											</SelectItem>
										)
									})}
								</SelectContent>
							</Select>
						</div>

						{/* Threshold Slider */}
						<div>
							<div className="flex items-center gap-2">
								<Slider
									min={10}
									max={100}
									step={1}
									value={[getCurrentThresholdValue()]}
									onValueChange={([value]) => handleThresholdChange(value)}
									data-testid="condense-threshold-slider"
								/>
								<span className="w-20">{getCurrentThresholdValue()}%</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{selectedThresholdProfile === "default"
									? t("settings:contextManagement.condensingThreshold.defaultDescription", {
											threshold: autoCondenseContextPercent,
										})
									: t("settings:contextManagement.condensingThreshold.profileDescription")}
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}

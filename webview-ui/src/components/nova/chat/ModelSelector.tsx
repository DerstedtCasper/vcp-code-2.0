import { useMemo } from "react"
import { SelectDropdown, DropdownOptionType, type DropdownOption } from "@/components/ui"
import { OPENROUTER_DEFAULT_PROVIDER_NAME, type ProviderSettings } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { prettyModelName } from "../../../utils/prettyModelName"
import { useProviderModels } from "../hooks/useProviderModels"
import { getModelIdKey, getSelectedModelId } from "../hooks/useSelectedModel"
import { useGroupedModelIds } from "@/components/ui/hooks/nova/usePreferredModels"

interface ModelSelectorProps {
	currentApiConfigName?: string
	apiConfiguration: ProviderSettings
	fallbackText: string
	virtualQuotaActiveModel?: { id: string; name: string; activeProfileNumber?: number } // novacode_change: Add virtual quota active model for UI display
}

export const ModelSelector = ({
	currentApiConfigName,
	apiConfiguration,
	fallbackText,
	virtualQuotaActiveModel, //novacode_change
}: ModelSelectorProps) => {
	const { t } = useAppTranslation()
	const { provider, providerModels, providerDefaultModel, isLoading, isError } = useProviderModels(apiConfiguration)
	const safeProviderModels = useMemo(
		() => (providerModels && typeof providerModels === "object" ? providerModels : {}),
		[providerModels],
	)
	const selectedModelId = getSelectedModelId({
		provider,
		apiConfiguration,
		defaultModelId: providerDefaultModel,
	})
	const modelIdKey = getModelIdKey({ provider })
	const isAutocomplete = apiConfiguration.profileType === "autocomplete"
	const selectedModelValue = selectedModelId || providerDefaultModel || ""

	const { preferredModelIds, restModelIds } = useGroupedModelIds(safeProviderModels)
	const options = useMemo(() => {
		const result: DropdownOption[] = []
		const getModelLabel = (modelId?: string) => {
			if (!modelId) {
				return ""
			}
			return safeProviderModels?.[modelId]?.displayName ?? prettyModelName(modelId)
		}

		// Check if selected model is missing from the lists
		const allModelIds = [...preferredModelIds, ...restModelIds]
		const isMissingSelectedModel = !!selectedModelValue && !allModelIds.includes(selectedModelValue)

		// Add "Recommended models" section if there are preferred models
		if (preferredModelIds.length > 0) {
			result.push({
				value: "__label_recommended__",
				label: t("settings:modelPicker.recommendedModels"),
				type: DropdownOptionType.LABEL,
			})

			preferredModelIds.forEach((modelId) => {
				result.push({
					value: modelId,
					label: getModelLabel(modelId),
					type: DropdownOptionType.ITEM,
				})
			})
		}

		// Add "All models" section
		if (restModelIds.length > 0) {
			result.push({
				value: "__label_all__",
				label: t("settings:modelPicker.allModels"),
				type: DropdownOptionType.LABEL,
			})

			// Add missing selected model at the top of "All models" if not in any list
			if (isMissingSelectedModel && selectedModelValue) {
				result.push({
					value: selectedModelValue,
					label: getModelLabel(selectedModelValue),
					type: DropdownOptionType.ITEM,
				})
			}

			restModelIds.forEach((modelId) => {
				result.push({
					value: modelId,
					label: getModelLabel(modelId),
					type: DropdownOptionType.ITEM,
				})
			})
		} else if (isMissingSelectedModel && selectedModelValue) {
			// If there are no rest models but we have a missing selected model, add it
			result.push({
				value: selectedModelValue,
				label: getModelLabel(selectedModelValue),
				type: DropdownOptionType.ITEM,
			})
		}

		return result
	}, [preferredModelIds, restModelIds, safeProviderModels, selectedModelValue, t])

	const disabled = isLoading || isError || isAutocomplete

	const onChange = (value: string) => {
		if (!currentApiConfigName) {
			return
		}
		if (!value) {
			return
		}
		if (apiConfiguration[modelIdKey] === value) {
			// don't reset openRouterSpecificProvider
			return
		}
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				[modelIdKey]: value,
				openRouterSpecificProvider: OPENROUTER_DEFAULT_PROVIDER_NAME,
			},
		})
	}

	if (isLoading) {
		return null
	}

	// novacode_change start: Display active model for virtual quota fallback
	if (provider === "virtual-quota-fallback" && virtualQuotaActiveModel) {
		return (
			<span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">
				{prettyModelName(virtualQuotaActiveModel.id)}
				{virtualQuotaActiveModel.activeProfileNumber !== undefined && (
					<> ({virtualQuotaActiveModel.activeProfileNumber})</>
				)}
			</span>
		)
	}
	// novacode_change end

	if (isError || isAutocomplete || options.length <= 0) {
		return <span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">{fallbackText}</span>
	}

	return (
		<SelectDropdown
			value={selectedModelValue}
			disabled={disabled}
			title={t("chat:selectApiConfig")}
			options={options}
			onChange={onChange}
			contentClassName="max-h-[400px] overflow-y-auto"
			triggerClassName={cn(
				"w-full text-ellipsis overflow-hidden p-0",
				"bg-transparent border-transparent hover:bg-transparent hover:border-transparent",
			)}
			triggerIcon={false}
			itemClassName="group"
		/>
	)
}

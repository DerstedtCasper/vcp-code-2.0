import {
	type ProviderName,
	type ProviderSettings,
	anthropicDefaultModelId,
	anthropicModels,
	basetenModels,
	basetenDefaultModelId,
	corethinkModels,
	corethinkDefaultModelId,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	mistralDefaultModelId,
	mistralModels,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openAiCodexDefaultModelId,
	openAiCodexModels,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
	groqModels,
	groqDefaultModelId,
	chutesDefaultModelId,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	openRouterDefaultModelId,
	requestyDefaultModelId,
	glamaDefaultModelId,
	unboundDefaultModelId,
	litellmDefaultModelId,
	qwenCodeModels,
	qwenCodeDefaultModelId,
	claudeCodeModels,
	claudeCodeDefaultModelId,
	doubaoModels,
	doubaoDefaultModelId,
	fireworksModels,
	fireworksDefaultModelId,
	syntheticDefaultModelId,
	ioIntelligenceDefaultModelId,
	moonshotModels,
	moonshotDefaultModelId,
	sambaNovaModels,
	sambaNovaDefaultModelId,
	featherlessModels,
	featherlessDefaultModelId,
	deepInfraDefaultModelId,
	cerebrasModels,
	cerebrasDefaultModelId,
	nanoGptDefaultModelId, //novacode_change
	poeDefaultModelId, //novacode_change
	apertisDefaultModelId, // novacode_change
	aihubmixDefaultModelId, // novacode_change
	ovhCloudAiEndpointsDefaultModelId,
	inceptionDefaultModelId,
	minimaxModels,
	minimaxDefaultModelId,
	internationalZAiModels,
	internationalZAiDefaultModelId,
	mainlandZAiModels,
	mainlandZAiDefaultModelId,
	zenmuxDefaultModelId,
} from "@roo-code/types"
import type { ModelRecord, RouterModels } from "@roo/api"
import { useRouterModels } from "../../ui/hooks/useRouterModels"
import { useExtensionState } from "@/context/ExtensionStateContext"

const FALLBACK_MODELS = {
	models: anthropicModels,
	defaultModel: anthropicDefaultModelId,
}

const ROUTER_PROVIDERS = [
	"openrouter",
	"requesty",
	"glama",
	"apertis",
	"unbound",
	"litellm",
	"chutes",
	"ollama",
	"lmstudio",
	"novacode",
	"poe",
	"synthetic",
	"ovhcloud",
	"inception",
	"sap-ai-core",
	"io-intelligence",
	"deepinfra",
	"roo",
	"nano-gpt",
	"aihubmix",
	"zenmux",
	"gemini",
	"vercel-ai-gateway",
] as const

type RouterProviderName = (typeof ROUTER_PROVIDERS)[number]

const ROUTER_PROVIDER_SET = new Set<RouterProviderName>(ROUTER_PROVIDERS)

export const getModelsByProvider = ({
	provider,
	routerModels,
	novacodeDefaultModel,
	options = { isChina: false },
}: {
	provider: ProviderName
	routerModels: RouterModels
	novacodeDefaultModel: string
	options: { isChina?: boolean }
}): { models: ModelRecord; defaultModel: string } => {
	switch (provider) {
		case "openrouter": {
			return {
				models: routerModels.openrouter,
				defaultModel: openRouterDefaultModelId,
			}
		}
		case "requesty": {
			return {
				models: routerModels.requesty,
				defaultModel: requestyDefaultModelId,
			}
		}
		case "glama": {
			return {
				models: routerModels.glama,
				defaultModel: glamaDefaultModelId,
			}
		}
		// novacode_change start
		case "apertis": {
			return {
				models: routerModels.apertis,
				defaultModel: apertisDefaultModelId,
			}
		}
		// novacode_change end
		case "unbound": {
			return {
				models: routerModels.unbound,
				defaultModel: unboundDefaultModelId,
			}
		}
		case "litellm": {
			return {
				models: routerModels.litellm,
				defaultModel: litellmDefaultModelId,
			}
		}
		case "xai": {
			return {
				models: xaiModels,
				defaultModel: xaiDefaultModelId,
			}
		}
		case "groq": {
			return {
				models: groqModels,
				defaultModel: groqDefaultModelId,
			}
		}
		case "chutes": {
			return {
				models: routerModels.chutes, // novacode_change
				defaultModel: chutesDefaultModelId,
			}
		}
		case "cerebras": {
			return {
				models: cerebrasModels,
				defaultModel: cerebrasDefaultModelId,
			}
		}
		case "bedrock": {
			return {
				models: bedrockModels,
				defaultModel: bedrockDefaultModelId,
			}
		}
		case "vertex": {
			return {
				models: vertexModels,
				defaultModel: vertexDefaultModelId,
			}
		}
		case "gemini": {
			return {
				models:
					routerModels.gemini && Object.keys(routerModels.gemini).length > 0
						? routerModels.gemini
						: geminiModels,
				defaultModel: geminiDefaultModelId,
			}
		}
		case "deepseek": {
			return {
				models: deepSeekModels,
				defaultModel: deepSeekDefaultModelId,
			}
		}
		case "openai-native": {
			return {
				models: openAiNativeModels,
				defaultModel: openAiNativeDefaultModelId,
			}
		}
		case "openai-codex": {
			return {
				models: openAiCodexModels,
				defaultModel: openAiCodexDefaultModelId,
			}
		}
		case "mistral": {
			return {
				models: mistralModels,
				defaultModel: mistralDefaultModelId,
			}
		}
		case "openai": {
			// TODO(catrielmuller): Support the fetch here
			return {
				models: {},
				defaultModel: "",
			}
		}
		case "ollama": {
			return {
				models: routerModels.ollama,
				defaultModel: "",
			}
		}
		case "lmstudio": {
			return {
				models: routerModels.lmstudio,
				defaultModel: "",
			}
		}
		case "vscode-lm": {
			return {
				models: vscodeLlmModels,
				defaultModel: vscodeLlmDefaultModelId,
			}
		}
		case "novacode": {
			return {
				models: routerModels.novacode,
				defaultModel: novacodeDefaultModel,
			}
		}
		case "claude-code": {
			return {
				models: claudeCodeModels,
				defaultModel: claudeCodeDefaultModelId,
			}
		}
		case "qwen-code": {
			return {
				models: qwenCodeModels,
				defaultModel: qwenCodeDefaultModelId,
			}
		}
		case "anthropic": {
			return {
				models: anthropicModels,
				defaultModel: anthropicDefaultModelId,
			}
		}
		case "doubao": {
			return {
				models: doubaoModels,
				defaultModel: doubaoDefaultModelId,
			}
		}
		case "fireworks": {
			return {
				models: fireworksModels,
				defaultModel: fireworksDefaultModelId,
			}
		}
		// novacode_change start
		case "poe": {
			return {
				models: routerModels.poe,
				defaultModel: poeDefaultModelId,
			}
		}
		case "synthetic": {
			return {
				models: routerModels.synthetic,
				defaultModel: syntheticDefaultModelId,
			}
		}
		case "ovhcloud": {
			return {
				models: routerModels.ovhcloud,
				defaultModel: ovhCloudAiEndpointsDefaultModelId,
			}
		}
		case "inception": {
			return {
				models: routerModels.inception,
				defaultModel: inceptionDefaultModelId,
			}
		}
		case "sap-ai-core": {
			return {
				models: routerModels["sap-ai-core"],
				defaultModel: "",
			}
		}
		// novacode_change end
		case "io-intelligence": {
			return {
				models: routerModels["io-intelligence"],
				defaultModel: ioIntelligenceDefaultModelId,
			}
		}
		case "moonshot": {
			return {
				models: moonshotModels,
				defaultModel: moonshotDefaultModelId,
			}
		}
		case "sambanova": {
			return {
				models: sambaNovaModels,
				defaultModel: sambaNovaDefaultModelId,
			}
		}
		case "featherless": {
			return {
				models: featherlessModels,
				defaultModel: featherlessDefaultModelId,
			}
		}
		case "deepinfra": {
			return {
				models: routerModels.deepinfra,
				defaultModel: deepInfraDefaultModelId,
			}
		}
		//novacode_change start
		case "nano-gpt": {
			return {
				models: routerModels["nano-gpt"],
				defaultModel: nanoGptDefaultModelId,
			}
		}
		case "aihubmix": {
			return {
				models: routerModels.aihubmix,
				defaultModel: aihubmixDefaultModelId,
			}
		}
		//novacode_change end
		case "minimax": {
			return {
				models: minimaxModels,
				defaultModel: minimaxDefaultModelId,
			}
		}
		case "baseten": {
			return {
				models: basetenModels,
				defaultModel: basetenDefaultModelId,
			}
		}
		case "corethink": {
			return {
				models: corethinkModels,
				defaultModel: corethinkDefaultModelId,
			}
		}
		case "zai": {
			if (options.isChina) {
				return {
					models: mainlandZAiModels,
					defaultModel: mainlandZAiDefaultModelId,
				}
			} else {
				return {
					models: internationalZAiModels,
					defaultModel: internationalZAiDefaultModelId,
				}
			}
		}
		case "zenmux": {
			return {
				models: routerModels.zenmux,
				defaultModel: zenmuxDefaultModelId,
			}
		}
		default:
			return {
				models: {},
				defaultModel: "",
			}
	}
}

export const getOptionsForProvider = (provider: ProviderName, apiConfiguration?: ProviderSettings) => {
	switch (provider) {
		case "zai":
			// Determine which Z.AI model set to use based on the API line configuration
			// novacode_change start
			return {
				isChina:
					apiConfiguration?.zaiApiLine === "china_coding" || apiConfiguration?.zaiApiLine === "china_api",
			}
		// novacode_change end
		default:
			return {}
	}
}

export const useProviderModels = (apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider || "anthropic"
	const routerProvider = ROUTER_PROVIDER_SET.has(provider as RouterProviderName)
		? (provider as RouterProviderName)
		: undefined

	const { novacodeDefaultModel } = useExtensionState()

	const routerModels = useRouterModels(
		{
			openRouterBaseUrl: apiConfiguration?.openRouterBaseUrl,
			openRouterApiKey: apiConfiguration?.apiKey,
			novacodeOrganizationId: apiConfiguration?.novacodeOrganizationId ?? "personal",
			chutesApiKey: apiConfiguration?.chutesApiKey,
			geminiApiKey: apiConfiguration?.geminiApiKey,
			googleGeminiBaseUrl: apiConfiguration?.googleGeminiBaseUrl,
			//novacode_change start
			nanoGptApiKey: apiConfiguration?.nanoGptApiKey,
			nanoGptModelList: apiConfiguration?.nanoGptModelList,
			//novacode_change end
			syntheticApiKey: apiConfiguration?.syntheticApiKey, // novacode_change
		},
		{
			provider: routerProvider,
			enabled: routerProvider !== undefined,
		},
	)

	const options = getOptionsForProvider(provider, apiConfiguration)
	const hasRouterData = typeof routerModels.data !== "undefined"
	const canUseStaticCatalogOnly = routerProvider === undefined

	const { models, defaultModel } =
		apiConfiguration && (canUseStaticCatalogOnly || hasRouterData)
			? getModelsByProvider({
					provider,
					routerModels: (routerModels.data ?? ({} as RouterModels)) as RouterModels,
					novacodeDefaultModel,
					options,
				})
			: FALLBACK_MODELS

	return {
		provider,
		providerModels: models as ModelRecord,
		providerDefaultModel: defaultModel,
		isLoading: routerProvider ? routerModels.isLoading : false,
		isError: routerProvider ? routerModels.isError : false,
	}
}

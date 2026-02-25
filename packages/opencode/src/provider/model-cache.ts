// novacode_change new file
import { fetchKiloModels } from "@novacode/nova-gateway"
import { Config } from "../config/config"
import { Auth } from "../auth"
import { Env } from "../env"
import { Log } from "../util/log"

const VCPTOOLBOX_DEFAULT_CONTEXT_LIMIT = 128000
const VCPTOOLBOX_DEFAULT_OUTPUT_LIMIT = 8192
const VCPTOOLBOX_DEFAULT_MODELS_PATH = "/models"

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

function resolveVcpToolBoxModelsURL(options: any): string | undefined {
  const customModelsURL = trimToUndefined(options?.modelsURL)
  if (customModelsURL) return customModelsURL

  const baseURL = trimToUndefined(options?.baseURL)
  if (!baseURL) return undefined

  const modelsPath = trimToUndefined(options?.modelsPath) ?? VCPTOOLBOX_DEFAULT_MODELS_PATH
  const relativePath = modelsPath.startsWith("/") ? modelsPath.slice(1) : modelsPath
  return new URL(relativePath, ensureTrailingSlash(baseURL)).toString()
}

function toReleaseDate(created: unknown): string {
  if (typeof created !== "number" || !Number.isFinite(created) || created <= 0) {
    return "1970-01-01"
  }
  return new Date(created * 1000).toISOString().slice(0, 10)
}

async function fetchVcpToolBoxModels(options: any): Promise<Record<string, any>> {
  const requestURL = resolveVcpToolBoxModelsURL(options)
  if (!requestURL) {
    return {}
  }

  const providerBaseURL = trimToUndefined(options?.baseURL)
  const headers = new Headers({ Accept: "application/json" })
  if (options?.apiKey) {
    headers.set("Authorization", `Bearer ${options.apiKey}`)
  }

  const response = await fetch(requestURL, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`VCPToolBox models request failed: ${response.status} ${response.statusText}`)
  }

  const payload = (await response.json()) as any
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
  const models: Record<string, any> = {}

  for (const entry of data) {
    const modelID = entry?.id
    if (!modelID || typeof modelID !== "string") continue
    models[modelID] = {
      id: modelID,
      name: modelID,
      family: "vcp",
      release_date: toReleaseDate(entry.created),
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      limit: {
        context: VCPTOOLBOX_DEFAULT_CONTEXT_LIMIT,
        output: VCPTOOLBOX_DEFAULT_OUTPUT_LIMIT,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
      options: {},
      provider: providerBaseURL
        ? {
            npm: "@ai-sdk/openai-compatible",
            api: ensureTrailingSlash(providerBaseURL),
          }
        : {
            npm: "@ai-sdk/openai-compatible",
          },
    }
  }

  return models
}

export namespace ModelCache {
  const log = Log.create({ service: "model-cache" })

  // Cache structure
  const cache = new Map<
    string,
    {
      models: Record<string, any>
      timestamp: number
    }
  >()

  const TTL = 5 * 60 * 1000 // 5 minutes
  const inFlightRefresh = new Map<string, Promise<Record<string, any>>>()

  /**
   * Get cached models if available and not expired
   * @param providerID - Provider identifier (e.g., "nova")
   * @returns Cached models or undefined if cache miss or expired
   */
  export function get(providerID: string): Record<string, any> | undefined {
    const cached = cache.get(providerID)

    if (!cached) {
      log.debug("cache miss", { providerID })
      return undefined
    }

    const now = Date.now()
    const age = now - cached.timestamp

    if (age > TTL) {
      log.debug("cache expired", { providerID, age })
      cache.delete(providerID)
      return undefined
    }

    log.debug("cache hit", { providerID, age })
    return cached.models
  }

  /**
   * Fetch models with cache-first approach
   * @param providerID - Provider identifier
   * @param options - Provider options
   * @returns Models from cache or freshly fetched
   */
  export async function fetch(providerID: string, options?: any): Promise<Record<string, any>> {
    // Check cache first
    const cached = get(providerID)
    if (cached) {
      return cached
    }

    // Cache miss - fetch models
    log.info("fetching models", { providerID })

    try {
      const authOptions = await getAuthOptions(providerID)
      const mergedOptions = { ...authOptions, ...options }

      const models = await fetchModels(providerID, mergedOptions)

      // Store in cache
      cache.set(providerID, {
        models,
        timestamp: Date.now(),
      })

      log.info("models fetched and cached", { providerID, count: Object.keys(models).length })
      return models
    } catch (error) {
      log.error("failed to fetch models", { providerID, error })
      return {}
    }
  }

  /**
   * Force refresh models (bypass cache)
   * Uses atomic refresh pattern to prevent race conditions
   * @param providerID - Provider identifier
   * @param options - Provider options
   * @returns Freshly fetched models
   */
  export async function refresh(providerID: string, options?: any): Promise<Record<string, any>> {
    // Check if refresh already in progress
    const existing = inFlightRefresh.get(providerID)
    if (existing) {
      log.debug("refresh already in progress, returning existing promise", { providerID })
      return existing
    }

    // Create new refresh promise
    const refreshPromise = (async () => {
      log.info("refreshing models", { providerID })

      try {
        const authOptions = await getAuthOptions(providerID)
        const mergedOptions = { ...authOptions, ...options }

        const models = await fetchModels(providerID, mergedOptions)

        // Update cache with new models
        cache.set(providerID, {
          models,
          timestamp: Date.now(),
        })

        log.info("models refreshed", { providerID, count: Object.keys(models).length })
        return models
      } catch (error) {
        log.error("failed to refresh models", { providerID, error })

        // Return existing cache or empty object
        const cached = cache.get(providerID)
        if (cached) {
          log.debug("returning stale cache after refresh failure", { providerID })
          return cached.models
        }

        return {}
      }
    })()

    // Track in-flight refresh
    inFlightRefresh.set(providerID, refreshPromise)

    try {
      return await refreshPromise
    } finally {
      // Clean up in-flight tracking
      inFlightRefresh.delete(providerID)
    }
  }

  /**
   * Clear cached models for a provider
   * @param providerID - Provider identifier
   */
  export function clear(providerID: string): void {
    const deleted = cache.delete(providerID)
    if (deleted) {
      log.info("cache cleared", { providerID })
    } else {
      log.debug("no cache to clear", { providerID })
    }
  }

  /**
   * Fetch models based on provider type
   * @param providerID - Provider identifier
   * @param options - Provider options
   * @returns Fetched models
   */
  async function fetchModels(providerID: string, options: any): Promise<Record<string, any>> {
    if (providerID === "kilo") {
      return fetchKiloModels(options)
    }
    if (providerID === "vcptoolbox") {
      return fetchVcpToolBoxModels(options)
    }

    // Other providers not implemented yet
    log.debug("provider not implemented", { providerID })
    return {}
  }

  /**
   * Get authentication options from multiple sources
   * Priority: Config > Auth > Env
   * @param providerID - Provider identifier
   * @returns Options object with authentication credentials
   */
  async function getAuthOptions(providerID: string): Promise<any> {
    const options: any = {}

    if (providerID === "kilo") {
      // Get from Config
      const config = await Config.get()
      const providerConfig = config.provider?.[providerID]
      if (providerConfig?.options?.apiKey) {
        options.novacodeToken = providerConfig.options.apiKey
      }

      // novacode_change start
      if (providerConfig?.options?.novacodeOrganizationId) {
        options.novacodeOrganizationId = providerConfig.options.novacodeOrganizationId
      }
      // novacode_change end

      // Get from Auth
      const auth = await Auth.get(providerID)
      if (auth) {
        if (auth.type === "api") {
          options.novacodeToken = auth.key
        } else if (auth.type === "oauth") {
          options.novacodeToken = auth.access
          // novacode_change start - read org ID from OAuth accountId for enterprise model filtering
          if (auth.accountId) {
            options.novacodeOrganizationId = auth.accountId
          }
          // novacode_change end
        }
      }

      // Get from Env
      const env = Env.all()
      if (env.KILO_API_KEY) {
        options.novacodeToken = env.KILO_API_KEY
      }
      if (env.KILO_ORG_ID) {
        options.novacodeOrganizationId = env.KILO_ORG_ID
      }

      log.debug("auth options resolved", {
        providerID,
        hasToken: !!options.novacodeToken,
        hasOrganizationId: !!options.novacodeOrganizationId,
      })
      return options
    }

    if (providerID === "vcptoolbox") {
      const config = await Config.get()
      const providerConfig = config.provider?.[providerID]
      if (providerConfig?.options?.apiKey) {
        options.apiKey = providerConfig.options.apiKey
      }
      if (providerConfig?.options?.baseURL) {
        options.baseURL = providerConfig.options.baseURL
      }
      if (providerConfig?.options?.modelsPath) {
        options.modelsPath = providerConfig.options.modelsPath
      }
      if (providerConfig?.options?.modelsURL) {
        options.modelsURL = providerConfig.options.modelsURL
      }

      const auth = await Auth.get(providerID)
      if (auth) {
        if (auth.type === "api") {
          options.apiKey = auth.key
        } else if (auth.type === "oauth") {
          options.apiKey = auth.access
        }
      }

      const env = Env.all()
      if (env.VCPTOOLBOX_API_KEY) {
        options.apiKey = env.VCPTOOLBOX_API_KEY
      } else if (env.VCP_API_KEY && !options.apiKey) {
        options.apiKey = env.VCP_API_KEY
      }

      if (env.VCPTOOLBOX_BASE_URL) {
        options.baseURL = env.VCPTOOLBOX_BASE_URL
      } else if (env.VCP_BASE_URL && !options.baseURL) {
        options.baseURL = env.VCP_BASE_URL
      }

      if (env.VCPTOOLBOX_MODELS_PATH) {
        options.modelsPath = env.VCPTOOLBOX_MODELS_PATH
      } else if (env.VCP_MODELS_PATH && !options.modelsPath) {
        options.modelsPath = env.VCP_MODELS_PATH
      }

      if (env.VCPTOOLBOX_MODELS_URL) {
        options.modelsURL = env.VCPTOOLBOX_MODELS_URL
      } else if (env.VCP_MODELS_URL && !options.modelsURL) {
        options.modelsURL = env.VCP_MODELS_URL
      }

      log.debug("auth options resolved", {
        providerID,
        hasToken: !!options.apiKey,
        baseURL: options.baseURL,
        modelsPath: options.modelsPath,
        hasModelsURL: !!options.modelsURL,
      })
    }

    return options
  }
}

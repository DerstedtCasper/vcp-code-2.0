import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Select } from "@novacode/nova-ui/select"
import { Card } from "@novacode/nova-ui/card"
import { Button } from "@novacode/nova-ui/button"
import { TextField } from "@novacode/nova-ui/text-field"
import { Switch } from "@novacode/nova-ui/switch"
import { showToast } from "@novacode/nova-ui/toast"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useLanguage } from "../../context/language"
import { ModelSelectorBase } from "../chat/ModelSelector"
import type { Config, ModelSelection, ProviderConfig } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface SelectOption {
  value: string
  label: string
}

type Dict = Record<string, unknown>

function parseModelConfig(raw: string | undefined): ModelSelection | null {
  if (!raw) return null
  const slash = raw.indexOf("/")
  if (slash <= 0) return null
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

const isRecord = (value: unknown): value is Dict => !!value && typeof value === "object" && !Array.isArray(value)
const toRecord = (value: unknown): Dict => (isRecord(value) ? value : {})

const mergeRecord = (left: Dict, right: Dict): Dict => {
  const next: Dict = { ...left }
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined) continue
    const prev = next[key]
    next[key] = isRecord(prev) && isRecord(value) ? mergeRecord(prev, value) : value
  }
  return next
}

const readPath = (source: unknown, path: string[]): unknown => {
  let current: unknown = source
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

const readBoolean = (source: unknown, path: string[]): boolean | undefined => {
  const value = readPath(source, path)
  return typeof value === "boolean" ? value : undefined
}

const readNumber = (source: unknown, path: string[]): number | undefined => {
  const value = readPath(source, path)
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const parseInteger = (value: string): number | undefined => {
  if (value.trim() === "") return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseFloatNumber = (value: string): number | undefined => {
  if (value.trim() === "") return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const normalizeSlug = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

// novacode_change start — well-known providers with default base URLs
// defaultURL: the root domain WITHOUT any path suffix (user-facing default)
// apiSuffix: the path that leads to /chat/completions (e.g. "/v1")
// modelsSuffix: the path to reach /models endpoint (usually same as apiSuffix + "/models")
const WELL_KNOWN_PROVIDERS: Record<string, {
  label: string
  defaultURL: string
  apiSuffix: string       // appended to defaultURL to form the API base (e.g. "/v1")
  modelsPath: string      // full path relative to base for model listing (e.g. "/v1/models")
}> = {
  openai:      { label: "OpenAI",          defaultURL: "https://api.openai.com",                  apiSuffix: "/v1",     modelsPath: "/v1/models" },
  anthropic:   { label: "Anthropic",       defaultURL: "https://api.anthropic.com",               apiSuffix: "/v1",     modelsPath: "/v1/models" },
  google:      { label: "Google (Gemini)", defaultURL: "https://generativelanguage.googleapis.com", apiSuffix: "/v1beta", modelsPath: "/v1beta/models" },
  "302ai":     { label: "302.AI",          defaultURL: "https://api.302.ai",                      apiSuffix: "/v1",     modelsPath: "/v1/models" },
  openrouter:  { label: "OpenRouter",      defaultURL: "https://openrouter.ai/api",               apiSuffix: "/v1",     modelsPath: "/v1/models" },
  groq:        { label: "Groq",            defaultURL: "https://api.groq.com/openai",             apiSuffix: "/v1",     modelsPath: "/v1/models" },
  deepseek:    { label: "DeepSeek",        defaultURL: "https://api.deepseek.com",                apiSuffix: "/v1",     modelsPath: "/v1/models" },
  mistral:     { label: "Mistral",         defaultURL: "https://api.mistral.ai",                  apiSuffix: "/v1",     modelsPath: "/v1/models" },
  together:    { label: "Together AI",     defaultURL: "https://api.together.xyz",                apiSuffix: "/v1",     modelsPath: "/v1/models" },
  fireworks:   { label: "Fireworks AI",    defaultURL: "https://api.fireworks.ai/inference",      apiSuffix: "/v1",     modelsPath: "/v1/models" },
  xai:         { label: "xAI (Grok)",      defaultURL: "https://api.x.ai",                       apiSuffix: "/v1",     modelsPath: "/v1/models" },
  perplexity:  { label: "Perplexity",      defaultURL: "https://api.perplexity.ai",              apiSuffix: "",        modelsPath: "/models" },
  minimax:     { label: "MiniMax",         defaultURL: "https://api.minimax.chat/v1",            apiSuffix: "",        modelsPath: "/models" },
  azure:       { label: "Azure OpenAI",    defaultURL: "",                                        apiSuffix: "",        modelsPath: "/models" },
  bedrock:     { label: "AWS Bedrock",     defaultURL: "",                                        apiSuffix: "",        modelsPath: "" },
  "vertex-ai": { label: "Vertex AI",      defaultURL: "",                                        apiSuffix: "",        modelsPath: "" },
}

/**
 * Normalize a provider base URL for saving:
 * 1. Strip trailing slashes
 * 2. For well-known providers: ensure the URL ends with the correct API suffix
 * 3. For unknown/custom providers: do NOT blindly append /v1 — the user knows their endpoint
 * 4. Never double-append a suffix
 */
function normalizeProviderUrl(rawUrl: string, providerName: string): string {
  if (!rawUrl) return rawUrl
  let url = rawUrl.trim().replace(/\/+$/, "")
  const wellKnown = WELL_KNOWN_PROVIDERS[providerName]
  if (!wellKnown || !wellKnown.apiSuffix) return url
  // Already has the suffix? do nothing
  if (url.endsWith(wellKnown.apiSuffix)) return url
  // Check if the URL is the defaultURL (without suffix) — then append
  const defaultBase = wellKnown.defaultURL.replace(/\/+$/, "")
  if (defaultBase && url === defaultBase) {
    return url + wellKnown.apiSuffix
  }
  // For custom base URLs with well-known providers: only append if the URL looks like
  // a bare domain/path without any /v* suffix already
  if (!/\/v\d/.test(url)) {
    return url + wellKnown.apiSuffix
  }
  return url
}

/**
 * Build the /models endpoint URL for a given base URL + provider.
 * This is used ONLY for model list fetching, not saved to config.
 */
function buildModelsUrl(baseUrl: string, providerName: string): string {
  let url = baseUrl.trim().replace(/\/+$/, "")
  if (!url) return ""
  // Already ends with /models? use as-is
  if (url.endsWith("/models")) return url
  const wellKnown = WELL_KNOWN_PROVIDERS[providerName]
  if (wellKnown?.modelsPath) {
    // Strip any existing API suffix to avoid double-append, then add modelsPath
    if (wellKnown.apiSuffix && url.endsWith(wellKnown.apiSuffix)) {
      url = url.slice(0, -wellKnown.apiSuffix.length).replace(/\/+$/, "")
    }
    return url + wellKnown.modelsPath
  }
  // Unknown provider: try /v1/models if URL doesn't already have /v1
  if (url.endsWith("/v1")) return url + "/models"
  // Fallback: append /v1/models for OpenAI-compatible convention
  if (!/\/v\d/.test(url)) return url + "/v1/models"
  // URL already has a version path — just append /models
  return url + "/models"
}
// novacode_change end

const ProvidersTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()

  const [draft, setDraft] = createSignal<Partial<Config>>({})
  const [selectedProfileId, setSelectedProfileId] = createSignal("")
  const [selectedModelId, setSelectedModelId] = createSignal("")
  const [newProfileInput, setNewProfileInput] = createSignal("")
  const [newModelInput, setNewModelInput] = createSignal("")
  const [newDisabled, setNewDisabled] = createSignal<SelectOption | undefined>()
  const [newEnabled, setNewEnabled] = createSignal<SelectOption | undefined>()
  const [newHeaderKey, setNewHeaderKey] = createSignal("")
  const [newHeaderValue, setNewHeaderValue] = createSignal("")

  const hasDraft = createMemo(() => Object.keys(draft()).length > 0)
  const mergedConfig = createMemo<Config>(() => mergeRecord(config() as Dict, draft() as Dict) as Config)

  const stage = (partial: Partial<Config>) => {
    setDraft((prev) => mergeRecord(prev as Dict, partial as Dict) as Partial<Config>)
  }

  // novacode_change start — auto-normalize URL on save + validate
  const saveDraft = () => {
    if (!hasDraft()) return
    const patch = draft()
    // Normalize provider URLs before saving
    if (patch.provider) {
      const providers = patch.provider as Record<string, ProviderConfig>
      for (const [_key, profile] of Object.entries(providers)) {
        if (!profile?.base_url) continue
        const providerName = profile.name ?? ""
        const normalizedUrl = normalizeProviderUrl(profile.base_url, providerName)
        profile.base_url = normalizedUrl
        if (profile.options) {
          ;(profile.options as any).baseURL = normalizedUrl
        }
      }
    }
    setDraft({})
    updateConfig(patch)
    showToast({ variant: "success", title: language.t("settings.providers.save.toast.title") })
  }
  // novacode_change end

  const discardDraft = () => {
    if (!hasDraft()) return
    setDraft({})
    showToast({ variant: "success", title: language.t("settings.providers.revert.toast.title") })
  }

  onMount(() => {
    const onSave = (event: Event) => {
      const custom = event as CustomEvent<{ tab?: string }>
      if (custom.detail?.tab !== "providers") return
      saveDraft()
    }
    window.addEventListener("vcp-settings-save", onSave as EventListener)
    onCleanup(() => window.removeEventListener("vcp-settings-save", onSave as EventListener))
  })

  // novacode_change start — merge well-known providers into dropdown
  const providerOptions = createMemo<SelectOption[]>(() => {
    const configured = Object.keys(mergedConfig().provider ?? {})
    const discovered = Object.keys(provider.providers())
    const wellKnown = Object.keys(WELL_KNOWN_PROVIDERS)
    const ids = [...new Set([...wellKnown, ...discovered, ...configured])].sort()
    return ids.map((id) => ({
      value: id,
      label: WELL_KNOWN_PROVIDERS[id]?.label ?? id,
    }))
  })
  // novacode_change end

  const profileIds = createMemo(() => Object.keys(mergedConfig().provider ?? {}).sort())
  const profileOptions = createMemo<SelectOption[]>(() => profileIds().map((id) => ({ value: id, label: id })))

  createEffect(() => {
    const ids = profileIds()
    if (ids.length === 0) return setSelectedProfileId("")
    if (!ids.includes(selectedProfileId())) setSelectedProfileId(ids[0]!)
  })

  const selectedProfile = createMemo<ProviderConfig | null>(() => {
    const id = selectedProfileId()
    if (!id) return null
    return (mergedConfig().provider?.[id] as ProviderConfig | undefined) ?? null
  })
  const selectedProviderName = createMemo(() => selectedProfile()?.name ?? selectedProfileId())
  const selectedOptions = createMemo(() => toRecord(selectedProfile()?.options))

  const catalogModels = createMemo<Record<string, unknown>>(() => {
    const providerID = selectedProviderName()
    if (!providerID) return {}
    return toRecord(provider.providers()[providerID]?.models)
  })
  const overrideModels = createMemo<Record<string, unknown>>(() => toRecord(selectedProfile()?.models))
  const modelOptions = createMemo<SelectOption[]>(() => {
    const ids = [...new Set([...Object.keys(catalogModels()), ...Object.keys(overrideModels())])].sort()
    return ids.map((id) => ({ value: id, label: id }))
  })

  // novacode_change start — declare fetchedModels signal early so allModelOptions can use it
  const [fetchedModels, setFetchedModels] = createSignal<SelectOption[]>([])
  const [isFetchingModels, setIsFetchingModels] = createSignal(false)

  // Merge fetched models into model options
  const allModelOptions = createMemo<SelectOption[]>(() => {
    const catalog = Object.keys(catalogModels())
    const override = Object.keys(overrideModels())
    const fetched = fetchedModels().map((m) => m.value)
    const ids = [...new Set([...catalog, ...override, ...fetched])].sort()
    return ids.map((id) => ({ value: id, label: id }))
  })
  // novacode_change end

  createEffect(() => {
    const ids = allModelOptions().map((item) => item.value)
    if (ids.length === 0) return setSelectedModelId("")
    if (!ids.includes(selectedModelId())) setSelectedModelId(ids[0]!)
  })

  const modelMerged = createMemo(() => mergeRecord(toRecord(catalogModels()[selectedModelId()]), toRecord(overrideModels()[selectedModelId()])))
  const modelOptionsRecord = createMemo(() => toRecord(modelMerged().options))
  const modelHeaders = createMemo(() => {
    const raw = toRecord(modelMerged().headers)
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string") next[key] = value
    return next
  })

  const modelContext = createMemo(() => readNumber(modelMerged(), ["limit", "context"]) ?? 0)
  const modelOutput = createMemo(() => readNumber(modelMerged(), ["limit", "output"]) ?? 0)
  const modelReasoning = createMemo(() => readBoolean(modelMerged(), ["reasoning"]) ?? readBoolean(modelMerged(), ["capabilities", "reasoning"]) ?? false)
  const modelTemperature = createMemo(() => readBoolean(modelMerged(), ["temperature"]) ?? readBoolean(modelMerged(), ["capabilities", "temperature"]) ?? false)
  const modelAttachment = createMemo(() => readBoolean(modelMerged(), ["attachment"]) ?? readBoolean(modelMerged(), ["capabilities", "attachment"]) ?? false)
  const modelToolcall = createMemo(() => readBoolean(modelMerged(), ["tool_call"]) ?? readBoolean(modelMerged(), ["capabilities", "toolcall"]) ?? true)
  const modelInputPrice = createMemo(() => readNumber(modelMerged(), ["cost", "input"]) ?? 0)
  const modelOutputPrice = createMemo(() => readNumber(modelMerged(), ["cost", "output"]) ?? 0)
  const modelCacheRead = createMemo(() => readNumber(modelMerged(), ["cost", "cache_read"]) ?? readNumber(modelMerged(), ["cost", "cache", "read"]) ?? 0)
  const modelCacheWrite = createMemo(() => readNumber(modelMerged(), ["cost", "cache_write"]) ?? readNumber(modelMerged(), ["cost", "cache", "write"]) ?? 0)
  const modelImage = createMemo(() => {
    const modalities = readPath(modelMerged(), ["modalities", "input"])
    if (Array.isArray(modalities)) return modalities.includes("image")
    return readBoolean(modelMerged(), ["capabilities", "input", "image"]) ?? false
  })
  const disabledProviders = createMemo(() => mergedConfig().disabled_providers ?? [])
  const enabledProviders = createMemo(() => mergedConfig().enabled_providers ?? [])

  const upsertProfile = (id: string, partial: Partial<ProviderConfig>) => {
    const providers = (mergedConfig().provider ?? {}) as Record<string, ProviderConfig>
    const current = (providers[id] as ProviderConfig | undefined) ?? {}
    const next: ProviderConfig = { ...current, ...partial }
    if (current.options || partial.options) {
      next.options = mergeRecord(toRecord(current.options), toRecord(partial.options)) as ProviderConfig["options"]
    }
    if (current.models || partial.models) {
      next.models = mergeRecord(toRecord(current.models), toRecord(partial.models))
    }
    stage({ provider: { ...providers, [id]: next } })
  }

  const updateModel = (partial: Dict) => {
    const profileID = selectedProfileId()
    const modelID = selectedModelId()
    if (!profileID || !modelID) return
    const models = { ...overrideModels() }
    models[modelID] = mergeRecord(toRecord(models[modelID]), partial)
    upsertProfile(profileID, { models })
  }

  const createProfile = () => {
    const providers = (mergedConfig().provider ?? {}) as Record<string, ProviderConfig>
    const base = normalizeSlug(newProfileInput()) || "provider"
    let id = base
    let n = 2
    while (providers[id]) {
      id = `${base}-${n}`
      n += 1
    }
    stage({
      provider: {
        ...providers,
        [id]: {
          name: providerOptions()[0]?.value ?? id,
          api_key: "",
          base_url: "",
          options: { apiKey: "", baseURL: "" },
        },
      },
    })
    setSelectedProfileId(id)
    setNewProfileInput("")
  }

  const addModel = () => {
    const profileID = selectedProfileId()
    if (!profileID) return
    const raw = normalizeSlug(newModelInput()) || "custom-model"
    let id = raw
    let suffix = 2
    while (allModelOptions().some((item) => item.value === id)) {
      id = `${raw}-${suffix}`
      suffix += 1
    }
    const models = { ...overrideModels() }
    models[id] = {
      id,
      name: id,
      reasoning: false,
      temperature: true,
      attachment: false,
      tool_call: true,
      limit: { context: 32768, output: 4096 },
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      modalities: { input: ["text"], output: ["text"] },
      options: {},
      headers: {},
    }
    upsertProfile(profileID, { models })
    setSelectedModelId(id)
    setNewModelInput("")
  }

  const addToList = (key: "disabled_providers" | "enabled_providers", value: string) => {
    if (!value) return
    const current = key === "disabled_providers" ? [...disabledProviders()] : [...enabledProviders()]
    if (current.includes(value)) return
    current.push(value)
    stage({ [key]: current })
  }

  const removeFromList = (key: "disabled_providers" | "enabled_providers", index: number) => {
    const current = key === "disabled_providers" ? [...disabledProviders()] : [...enabledProviders()]
    current.splice(index, 1)
    stage({ [key]: current })
  }

  // novacode_change start — auto-fetch models when base_url + api_key are set

  // Compute the backend URL from config context (port lives in the extension message layer)
  const getBackendUrl = () => {
    const port = (window as any).__OPENCODE_PORT__ || 13338
    return `http://localhost:${port}`
  }

  const [fetchError, setFetchError] = createSignal("")

  /** Shared fetch logic — returns { ok, models?, error? } */
  const doFetchModels = async (baseUrl: string, apiKey: string, providerName: string): Promise<{
    ok: boolean
    models?: Array<{ id: string }>
    error?: string
  }> => {
    if (!baseUrl) return { ok: false, error: "base_url is empty" }
    const modelsUrl = buildModelsUrl(baseUrl, providerName)
    if (!modelsUrl) return { ok: false, error: "Cannot determine models endpoint" }
    try {
      const res = await fetch(`${getBackendUrl()}/provider/fetch-models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: modelsUrl, api_key: apiKey }),
      })
      return (await res.json()) as { ok: boolean; models?: Array<{ id: string }>; error?: string }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  createEffect(() => {
    const profile = selectedProfile()
    const baseUrl = profile?.base_url ?? ""
    const apiKey = profile?.api_key ?? ""
    const providerName = profile?.name ?? selectedProfileId()

    if (!baseUrl) {
      setFetchedModels([])
      setFetchError("")
      return
    }
    // Debounce: fetch after 600ms of stability
    const timer = setTimeout(async () => {
      setIsFetchingModels(true)
      setFetchError("")
      const result = await doFetchModels(baseUrl, apiKey, providerName)
      if (result.ok && result.models) {
        setFetchedModels(result.models.map((m) => ({ value: m.id, label: m.id })))
        setFetchError("")
      } else {
        setFetchedModels([])
        setFetchError(result.error ?? language.t("settings.providers.model.fetchFailed"))
      }
      setIsFetchingModels(false)
    }, 600)
    onCleanup(() => clearTimeout(timer))
  })

  /** Manual "Test Connection" action — validates URL + key and shows toast */
  const testConnection = async () => {
    const profile = selectedProfile()
    if (!profile?.base_url) {
      showToast({ variant: "error", title: language.t("settings.providers.testConnection.noUrl") })
      return
    }
    setIsFetchingModels(true)
    setFetchError("")
    const providerName = profile.name ?? selectedProfileId()
    const result = await doFetchModels(profile.base_url, profile.api_key ?? "", providerName)
    if (result.ok && result.models) {
      setFetchedModels(result.models.map((m) => ({ value: m.id, label: m.id })))
      setFetchError("")
      showToast({
        variant: "success",
        title: language.t("settings.providers.testConnection.success", { count: String(result.models.length) }),
      })
    } else {
      setFetchedModels([])
      const errMsg = result.error ?? "Unknown error"
      setFetchError(errMsg)
      showToast({
        variant: "error",
        title: language.t("settings.providers.testConnection.failed"),
        description: errMsg.slice(0, 200),
      })
    }
    setIsFetchingModels(false)
  }

  // When provider is changed in dropdown, auto-fill default URL if base_url is empty or matches a known default
  const onProviderSelect = (providerName: string) => {
    const profileID = selectedProfileId()
    if (!profileID || !providerName) return
    const currentUrl = selectedProfile()?.base_url ?? ""
    const wellKnown = WELL_KNOWN_PROVIDERS[providerName]
    const partial: Partial<ProviderConfig> = { name: providerName }
    if (wellKnown?.defaultURL) {
      // Auto-fill URL if it's empty or was the previous provider's default
      const prevName = selectedProfile()?.name ?? ""
      const prevDefault = WELL_KNOWN_PROVIDERS[prevName]?.defaultURL ?? ""
      if (!currentUrl || currentUrl === prevDefault) {
        partial.base_url = wellKnown.defaultURL
        partial.options = { ...(selectedOptions() as ProviderConfig["options"]), baseURL: wellKnown.defaultURL }
      }
    }
    upsertProfile(profileID, partial)
  }

  // Get placeholder URL for current provider
  const providerPlaceholderUrl = createMemo(() => {
    const name = selectedProviderName()
    return WELL_KNOWN_PROVIDERS[name]?.defaultURL ?? ""
  })
  // novacode_change end

  const effortOptions: SelectOption[] = [
    { value: "minimal", label: language.t("settings.providers.model.reasoningEffort.option.minimal") },
    { value: "low", label: language.t("settings.providers.model.reasoningEffort.option.low") },
    { value: "medium", label: language.t("settings.providers.model.reasoningEffort.option.medium") },
    { value: "high", label: language.t("settings.providers.model.reasoningEffort.option.high") },
  ]

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <Card>
        <SettingsRow title={language.t("settings.providers.defaultModel.title")} description={language.t("settings.providers.defaultModel.description")} isDirty={hasDraft()}>
          <ModelSelectorBase value={parseModelConfig(mergedConfig().model)} onSelect={(p, m) => stage({ model: p && m ? `${p}/${m}` : undefined })} placement="bottom-start" allowClear clearLabel={language.t("settings.providers.notSet")} />
        </SettingsRow>
        <SettingsRow title={language.t("settings.providers.smallModel.title")} description={language.t("settings.providers.smallModel.description")} isDirty={hasDraft()} last>
          <ModelSelectorBase value={parseModelConfig(mergedConfig().small_model)} onSelect={(p, m) => stage({ small_model: p && m ? `${p}/${m}` : undefined })} placement="bottom-start" allowClear clearLabel={language.t("settings.providers.notSet")} />
        </SettingsRow>
      </Card>

      <Card>
        <SettingsRow title={language.t("settings.providers.profiles.select")} description={language.t("settings.providers.profiles.description")} isDirty={hasDraft()}>
          <Select options={profileOptions()} current={profileOptions().find((item) => item.value === selectedProfileId())} value={(item) => item.value} label={(item) => item.label} onSelect={(item) => setSelectedProfileId(item?.value ?? "")} variant="secondary" size="small" triggerVariant="settings" placeholder={language.t("common.choose")} />
        </SettingsRow>
        <SettingsRow title={language.t("settings.providers.profiles.create")} description="" isDirty={hasDraft()} last>
          <div style={{ display: "flex", gap: "8px", width: "100%" }}>
            <div style={{ flex: 1 }}>
              <TextField value={newProfileInput()} placeholder={language.t("settings.providers.profiles.createPlaceholder")} onChange={setNewProfileInput} onKeyDown={(event: KeyboardEvent) => event.key === "Enter" && createProfile()} />
            </div>
            <Button size="small" onClick={createProfile}>{language.t("common.add")}</Button>
          </div>
        </SettingsRow>
      </Card>

      <Show when={selectedProfile()}>
        <Card>
          <SettingsRow title={language.t("settings.providers.apiProvider.title")} description={language.t("settings.providers.apiProvider.description")} isDirty={hasDraft()}>
            <Select options={providerOptions()} current={providerOptions().find((item) => item.value === selectedProviderName())} value={(item) => item.value} label={(item) => item.label} onSelect={(item) => item && onProviderSelect(item.value)} variant="secondary" size="small" triggerVariant="settings" />
          </SettingsRow>
          <SettingsRow title={language.t("settings.providers.baseUrl.title")} description={language.t("settings.providers.baseUrl.description")} isDirty={hasDraft()}>
            <TextField value={selectedProfile()?.base_url ?? ""} placeholder={providerPlaceholderUrl() || "https://api.example.com"} onChange={(value) => upsertProfile(selectedProfileId(), { base_url: value, options: { ...(selectedOptions() as ProviderConfig["options"]), baseURL: value } })} />
          </SettingsRow>
          <SettingsRow title={language.t("settings.providers.apiKey.title")} description={language.t("settings.providers.apiKey.description")} isDirty={hasDraft()}>
            <TextField type="password" value={selectedProfile()?.api_key ?? ""} onChange={(value) => upsertProfile(selectedProfileId(), { api_key: value, options: { ...(selectedOptions() as ProviderConfig["options"]), apiKey: value } })} />
          </SettingsRow>
          <SettingsRow title={language.t("settings.providers.testConnection.title")} description={fetchError() ? fetchError() : language.t("settings.providers.testConnection.description")} isDirty={hasDraft()}>
            <Button size="small" onClick={testConnection} disabled={isFetchingModels() || !selectedProfile()?.base_url}>
              {isFetchingModels() ? language.t("settings.providers.model.loading") : language.t("settings.providers.testConnection.button")}
            </Button>
          </SettingsRow>
          <SettingsRow title={language.t("settings.providers.model.select")} description={isFetchingModels() ? language.t("settings.providers.model.fetchingModels") : fetchError() ? language.t("settings.providers.model.fetchFailedHint") : language.t("settings.providers.model.selectDescription")} isDirty={hasDraft()}>
            <Select options={allModelOptions()} current={allModelOptions().find((item) => item.value === selectedModelId())} value={(item) => item.value} label={(item) => item.label} onSelect={(item) => setSelectedModelId(item?.value ?? "")} variant="secondary" size="small" triggerVariant="settings" placeholder={isFetchingModels() ? language.t("settings.providers.model.loading") : language.t("common.choose")} />
          </SettingsRow>
          <SettingsRow title={language.t("settings.providers.model.add")} description="" isDirty={hasDraft()} last>
            <div style={{ display: "flex", gap: "8px", width: "100%" }}>
              <div style={{ flex: 1 }}>
                <TextField value={newModelInput()} placeholder={language.t("settings.providers.model.addPlaceholder")} onChange={setNewModelInput} onKeyDown={(event: KeyboardEvent) => event.key === "Enter" && addModel()} />
              </div>
              <Button size="small" onClick={addModel}>{language.t("common.add")}</Button>
            </div>
          </SettingsRow>
        </Card>

        <Show when={selectedModelId()}>
          <Card>
            <SettingsRow title={language.t("settings.providers.model.maxOutput.title")} description={language.t("settings.providers.model.maxOutput.description")} isDirty={hasDraft()}>
              <TextField value={String(modelOutput())} onChange={(value) => { const parsed = parseInteger(value); if (parsed !== undefined) updateModel({ limit: { output: parsed } }) }} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.context.title")} description={language.t("settings.providers.model.context.description")} isDirty={hasDraft()}>
              <TextField value={String(modelContext())} onChange={(value) => { const parsed = parseInteger(value); if (parsed !== undefined) updateModel({ limit: { context: parsed } }) }} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.inputPrice.title")} description={language.t("settings.providers.model.inputPrice.description")} isDirty={hasDraft()}>
              <TextField value={String(modelInputPrice())} onChange={(value) => { const parsed = parseFloatNumber(value); if (parsed !== undefined) updateModel({ cost: { input: parsed } }) }} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.outputPrice.title")} description={language.t("settings.providers.model.outputPrice.description")} isDirty={hasDraft()}>
              <TextField value={String(modelOutputPrice())} onChange={(value) => { const parsed = parseFloatNumber(value); if (parsed !== undefined) updateModel({ cost: { output: parsed } }) }} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.cacheReadPrice.title")} description={language.t("settings.providers.model.cacheReadPrice.description")} isDirty={hasDraft()}>
              <TextField value={String(modelCacheRead())} onChange={(value) => { const parsed = parseFloatNumber(value); if (parsed !== undefined) updateModel({ cost: { cache_read: parsed } }) }} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.cacheWritePrice.title")} description={language.t("settings.providers.model.cacheWritePrice.description")} isDirty={hasDraft()}>
              <TextField value={String(modelCacheWrite())} onChange={(value) => { const parsed = parseFloatNumber(value); if (parsed !== undefined) updateModel({ cost: { cache_write: parsed } }) }} />
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.reasoning.title")} description={language.t("settings.providers.model.reasoning.description")} isDirty={hasDraft()}>
              <Switch checked={modelReasoning()} onChange={(checked) => updateModel({ reasoning: checked })} hideLabel>{language.t("settings.providers.model.reasoning.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.temperature.title")} description={language.t("settings.providers.model.temperature.description")} isDirty={hasDraft()}>
              <Switch checked={modelTemperature()} onChange={(checked) => updateModel({ temperature: checked })} hideLabel>{language.t("settings.providers.model.temperature.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.toolCall.title")} description={language.t("settings.providers.model.toolCall.description")} isDirty={hasDraft()}>
              <Switch checked={modelToolcall()} onChange={(checked) => updateModel({ tool_call: checked })} hideLabel>{language.t("settings.providers.model.toolCall.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.image.title")} description={language.t("settings.providers.model.image.description")} isDirty={hasDraft()}>
              <Switch checked={modelImage()} onChange={(checked) => updateModel({ modalities: { input: checked ? ["text", "image"] : ["text"], output: ["text"] } })} hideLabel>{language.t("settings.providers.model.image.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.promptCache.title")} description={language.t("settings.providers.model.promptCache.description")} isDirty={hasDraft()}>
              <Switch checked={Boolean(modelOptionsRecord().setCacheKey ?? selectedOptions().setCacheKey)} onChange={(checked) => updateModel({ options: { ...modelOptionsRecord(), setCacheKey: checked } })} hideLabel>{language.t("settings.providers.model.promptCache.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.r1.title")} description={language.t("settings.providers.model.r1.description")} isDirty={hasDraft()}>
              <Switch checked={Boolean(modelOptionsRecord().enable_thinking)} onChange={(checked) => updateModel({ options: { ...modelOptionsRecord(), enable_thinking: checked } })} hideLabel>{language.t("settings.providers.model.r1.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.stream.title")} description={language.t("settings.providers.model.stream.description")} isDirty={hasDraft()}>
              <Switch checked={Boolean(modelOptionsRecord().stream ?? true)} onChange={(checked) => updateModel({ options: { ...modelOptionsRecord(), stream: checked } })} hideLabel>{language.t("settings.providers.model.stream.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.includeMaxOutput.title")} description={language.t("settings.providers.model.includeMaxOutput.description")} isDirty={hasDraft()}>
              <Switch checked={Boolean(modelOptionsRecord().includeMaxOutputTokens)} onChange={(checked) => updateModel({ options: { ...modelOptionsRecord(), includeMaxOutputTokens: checked } })} hideLabel>{language.t("settings.providers.model.includeMaxOutput.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.azure.title")} description={language.t("settings.providers.model.azure.description")} isDirty={hasDraft()}>
              <Switch checked={Boolean(modelOptionsRecord().useAzure)} onChange={(checked) => updateModel({ options: { ...modelOptionsRecord(), useAzure: checked } })} hideLabel>{language.t("settings.providers.model.azure.title")}</Switch>
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.reasoningEffort.title")} description={language.t("settings.providers.model.reasoningEffort.description")} isDirty={hasDraft()}>
              <Select options={effortOptions} current={effortOptions.find((item) => item.value === String(modelOptionsRecord().reasoningEffort ?? "medium"))} value={(item) => item.value} label={(item) => item.label} onSelect={(item) => item && updateModel({ options: { ...modelOptionsRecord(), reasoningEffort: item.value } })} variant="secondary" size="small" triggerVariant="settings" />
            </SettingsRow>
            <SettingsRow title={language.t("settings.providers.model.customHeaders.title")} description={language.t("settings.providers.model.customHeaders.description")} isDirty={hasDraft()} last>
              <div style={{ width: "100%", display: "grid", gap: "8px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <TextField value={newHeaderKey()} placeholder={language.t("settings.providers.header.keyPlaceholder")} onChange={setNewHeaderKey} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField value={newHeaderValue()} placeholder={language.t("settings.providers.header.valuePlaceholder")} onChange={setNewHeaderValue} />
                  </div>
                  <Button size="small" onClick={() => { if (!newHeaderKey().trim()) return; updateModel({ headers: { ...modelHeaders(), [newHeaderKey().trim()]: newHeaderValue() } }); setNewHeaderKey(""); setNewHeaderValue("") }}>{language.t("common.add")}</Button>
                </div>
                <For each={Object.entries(modelHeaders())}>
                  {([key, value]) => (
                    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                      <div style={{ flex: 1, "font-family": "var(--vscode-editor-font-family, monospace)" }}>{key}</div>
                      <div style={{ flex: 1, "font-family": "var(--vscode-editor-font-family, monospace)" }}>{value}</div>
                      <Button size="small" variant="ghost" onClick={() => { const next = { ...modelHeaders() }; delete next[key]; updateModel({ headers: next }) }}>{language.t("common.delete")}</Button>
                    </div>
                  )}
                </For>
              </div>
            </SettingsRow>
          </Card>
        </Show>
      </Show>

      <Card>
        <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))", "padding-bottom": "8px", "border-bottom": "1px solid var(--border-weak-base)" }}>
          {language.t("settings.providers.disabled.description")}
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0", "border-bottom": disabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none" }}>
          <div style={{ flex: 1 }}>
            <Select options={providerOptions().filter((item) => !disabledProviders().includes(item.value))} current={newDisabled()} value={(item) => item.value} label={(item) => item.label} onSelect={setNewDisabled} variant="secondary" size="small" triggerVariant="settings" placeholder={language.t("common.choose")} />
          </div>
          <Button size="small" onClick={() => { const option = newDisabled(); if (!option) return; addToList("disabled_providers", option.value); setNewDisabled(undefined) }}>{language.t("common.add")}</Button>
        </div>
        <For each={disabledProviders()}>
          {(id, index) => (
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "6px 0", "border-bottom": index() < disabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none" }}>
              <span style={{ "font-size": "12px" }}>{id}</span>
              <Button size="small" variant="ghost" onClick={() => removeFromList("disabled_providers", index())}>{language.t("common.delete")}</Button>
            </div>
          )}
        </For>
      </Card>

      <Card>
        <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))", "padding-bottom": "8px", "border-bottom": "1px solid var(--border-weak-base)" }}>
          {language.t("settings.providers.enabled.description")}
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0", "border-bottom": enabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none" }}>
          <div style={{ flex: 1 }}>
            <Select options={providerOptions().filter((item) => !enabledProviders().includes(item.value))} current={newEnabled()} value={(item) => item.value} label={(item) => item.label} onSelect={setNewEnabled} variant="secondary" size="small" triggerVariant="settings" placeholder={language.t("common.choose")} />
          </div>
          <Button size="small" onClick={() => { const option = newEnabled(); if (!option) return; addToList("enabled_providers", option.value); setNewEnabled(undefined) }}>{language.t("common.add")}</Button>
        </div>
        <For each={enabledProviders()}>
          {(id, index) => (
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "6px 0", "border-bottom": index() < enabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none" }}>
              <span style={{ "font-size": "12px" }}>{id}</span>
              <Button size="small" variant="ghost" onClick={() => removeFromList("enabled_providers", index())}>{language.t("common.delete")}</Button>
            </div>
          )}
        </For>
      </Card>

      <Show when={hasDraft()}>
        <div class="sticky-save-bar">
          <div class="sticky-save-bar-hint">{language.t("settings.providers.unsaved")}</div>
          <div class="sticky-save-bar-actions">
            <Button size="small" variant="ghost" onClick={discardDraft}>{language.t("settings.providers.revert")}</Button>
            <Button size="small" onClick={saveDraft}>{language.t("settings.providers.save")}</Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default ProvidersTab

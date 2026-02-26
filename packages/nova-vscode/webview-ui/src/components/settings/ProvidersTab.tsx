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
import { useVSCode } from "../../context/vscode"
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
  if (value.trim() === "") return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseFloatNumber = (value: string): number | undefined => {
  if (value.trim() === "") return undefined
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

// ── Well-known providers (display only — never mutate user URLs) ────
const WELL_KNOWN_PROVIDERS: Record<string, { label: string; placeholder: string }> = {
  openai:      { label: "OpenAI",          placeholder: "https://api.openai.com/v1" },
  anthropic:   { label: "Anthropic",       placeholder: "https://api.anthropic.com/v1" },
  google:      { label: "Google (Gemini)", placeholder: "https://generativelanguage.googleapis.com/v1beta" },
  "302ai":     { label: "302.AI",          placeholder: "https://api.302.ai/v1" },
  openrouter:  { label: "OpenRouter",      placeholder: "https://openrouter.ai/api/v1" },
  groq:        { label: "Groq",            placeholder: "https://api.groq.com/openai/v1" },
  deepseek:    { label: "DeepSeek",        placeholder: "https://api.deepseek.com/v1" },
  mistral:     { label: "Mistral",         placeholder: "https://api.mistral.ai/v1" },
  together:    { label: "Together AI",     placeholder: "https://api.together.xyz/v1" },
  fireworks:   { label: "Fireworks AI",    placeholder: "https://api.fireworks.ai/inference/v1" },
  xai:         { label: "xAI (Grok)",      placeholder: "https://api.x.ai/v1" },
  perplexity:  { label: "Perplexity",      placeholder: "https://api.perplexity.ai" },
  minimax:     { label: "MiniMax",         placeholder: "https://api.minimax.chat/v1" },
  azure:       { label: "Azure OpenAI",    placeholder: "https://YOUR_RESOURCE.openai.azure.com" },
  bedrock:     { label: "AWS Bedrock",     placeholder: "" },
  "vertex-ai": { label: "Vertex AI",      placeholder: "" },
  ollama:      { label: "Ollama",          placeholder: "http://localhost:11434/v1" },
  lmstudio:    { label: "LM Studio",      placeholder: "http://localhost:1234/v1" },
  custom:      { label: "Custom / Other",  placeholder: "http://127.0.0.1:6005/v1" },
  vcp:         { label: "VCP",             placeholder: "http://127.0.0.1:6005" },
}

/**
 * Build /models URL from user-supplied base URL.
 * Kilo-style: simple and trusting. Just append /models.
 * User provides base URL like http://127.0.0.1:6005/v1
 * We call http://127.0.0.1:6005/v1/models
 */
function buildModelsUrl(baseUrl: string): string {
  if (!baseUrl) return ""
  let url = baseUrl.trim().replace(/\/+$/, "")
  if (url.endsWith("/models")) return url
  return url + "/models"
}

// ── Connection status type ──────────────────────────────────────────
type ConnectionStatus = "idle" | "testing" | "success" | "error"

const ProvidersTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const vscode = useVSCode()

  const [draft, setDraft] = createSignal<Partial<Config>>({})
  const [selectedProfileId, setSelectedProfileId] = createSignal("")
  const [selectedModelId, setSelectedModelId] = createSignal("")
  const [newProfileInput, setNewProfileInput] = createSignal("")
  const [newModelInput, setNewModelInput] = createSignal("")
  const [newDisabled, setNewDisabled] = createSignal<SelectOption | undefined>()
  const [newEnabled, setNewEnabled] = createSignal<SelectOption | undefined>()
  const [newHeaderKey, setNewHeaderKey] = createSignal("")
  const [newHeaderValue, setNewHeaderValue] = createSignal("")

  // Connection & model fetching state
  const [fetchedModels, setFetchedModels] = createSignal<SelectOption[]>([])
  const [isFetchingModels, setIsFetchingModels] = createSignal(false)
  const [fetchError, setFetchError] = createSignal("")
  const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>("idle")
  const [connectionLatency, setConnectionLatency] = createSignal<number | null>(null)

  const hasDraft = createMemo(() => Object.keys(draft()).length > 0)
  const mergedConfig = createMemo<Config>(() => mergeRecord(config() as Dict, draft() as Dict) as Config)

  const stage = (partial: Partial<Config>) => {
    setDraft((prev) => mergeRecord(prev as Dict, partial as Dict) as Partial<Config>)
  }

  // ── Save / Discard ────────────────────────────────────────────────
  const saveDraft = () => {
    if (!hasDraft()) return
    const patch = draft()
    setDraft({})
    updateConfig(patch)
    showToast({ variant: "success", title: language.t("settings.providers.save.toast.title") })
  }

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

  // ── Provider dropdown options ─────────────────────────────────────
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

  // ── Profile management ────────────────────────────────────────────
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

  // ── Model options ─────────────────────────────────────────────────
  const catalogModels = createMemo<Record<string, unknown>>(() => {
    const providerID = selectedProviderName()
    if (!providerID) return {}
    return toRecord(provider.providers()[providerID]?.models)
  })
  const overrideModels = createMemo<Record<string, unknown>>(() => toRecord(selectedProfile()?.models))

  const allModelOptions = createMemo<SelectOption[]>(() => {
    const catalog = Object.keys(catalogModels())
    const override = Object.keys(overrideModels())
    const fetched = fetchedModels().map((m) => m.value)
    const ids = [...new Set([...catalog, ...override, ...fetched])].sort()
    return ids.map((id) => ({ value: id, label: id }))
  })

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

  const modelContext = createMemo(() => readNumber(modelMerged(), ["limit", "context"]))
  const modelOutput = createMemo(() => readNumber(modelMerged(), ["limit", "output"]))
  const modelReasoning = createMemo(() => readBoolean(modelMerged(), ["reasoning"]) ?? readBoolean(modelMerged(), ["capabilities", "reasoning"]) ?? false)
  const modelTemperature = createMemo(() => readBoolean(modelMerged(), ["temperature"]) ?? readBoolean(modelMerged(), ["capabilities", "temperature"]) ?? false)
  const modelToolcall = createMemo(() => readBoolean(modelMerged(), ["tool_call"]) ?? readBoolean(modelMerged(), ["capabilities", "toolcall"]) ?? true)
  const modelInputPrice = createMemo(() => readNumber(modelMerged(), ["cost", "input"]))
  const modelOutputPrice = createMemo(() => readNumber(modelMerged(), ["cost", "output"]))
  const modelCacheRead = createMemo(() => readNumber(modelMerged(), ["cost", "cache_read"]) ?? readNumber(modelMerged(), ["cost", "cache", "read"]))
  const modelCacheWrite = createMemo(() => readNumber(modelMerged(), ["cost", "cache_write"]) ?? readNumber(modelMerged(), ["cost", "cache", "write"]))
  const modelImage = createMemo(() => {
    const modalities = readPath(modelMerged(), ["modalities", "input"])
    if (Array.isArray(modalities)) return modalities.includes("image")
    return readBoolean(modelMerged(), ["capabilities", "input", "image"]) ?? false
  })
  const disabledProviders = createMemo(() => mergedConfig().disabled_providers ?? [])
  const enabledProviders = createMemo(() => mergedConfig().enabled_providers ?? [])

  // ── Profile helpers ───────────────────────────────────────────────
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

  const deleteProfile = (id: string) => {
    const providers = { ...(mergedConfig().provider ?? {}) } as Record<string, ProviderConfig>
    delete providers[id]
    stage({ provider: providers })
    const remaining = Object.keys(providers)
    setSelectedProfileId(remaining[0] ?? "")
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
          name: "custom",
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
    const raw = newModelInput().trim() || "custom-model"
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

  // ── Kilo-style: fetch models via extension host postMessage (no backend proxy) ──
  let modelRequestId = 0
  const requestModels = (baseUrl: string, apiKey: string) => {
    if (!baseUrl) {
      setFetchedModels([])
      setFetchError("")
      setConnectionStatus("idle")
      setConnectionLatency(null)
      return
    }
    modelRequestId++
    const reqId = `models-${modelRequestId}`
    setIsFetchingModels(true)
    setFetchError("")
    setConnectionStatus("testing")
    vscode.postMessage({
      type: "requestOpenAiModels",
      baseUrl,
      apiKey,
      requestId: reqId,
    })
  }

  // ── Listen for openAiModels response from extension host ──
  onMount(() => {
    const unsubscribe = vscode.onMessage((message: any) => {
      if (message.type === "openAiModels") {
        const models: string[] = message.openAiModels ?? []
        const error: string | undefined = message.error
        const latencyMs: number | undefined = message.latencyMs

        if (error) {
          setFetchedModels([])
          setFetchError(error)
          setConnectionStatus("error")
          setConnectionLatency(latencyMs ?? null)
        } else {
          setFetchedModels(models.map((id) => ({ value: id, label: id })))
          setFetchError("")
          setConnectionStatus("success")
          setConnectionLatency(latencyMs ?? null)

          // ── Inject fetched models into global Provider context ──
          // so that ModelSelectorBase (default model / small model) can see them.
          const profileID = selectedProfileId()
          const profileName = selectedProviderName()
          if (profileID && models.length > 0) {
            provider.injectCustomModels(profileID, profileName, models)
          }
        }
        setIsFetchingModels(false)
      }
    })
    onCleanup(unsubscribe)
  })

  // ── Auto-fetch models when base_url changes (debounced) ───────────
  createEffect(() => {
    const profile = selectedProfile()
    const baseUrl = profile?.base_url ?? ""
    const apiKey = profile?.api_key ?? ""

    if (!baseUrl) {
      setFetchedModels([])
      setFetchError("")
      setConnectionStatus("idle")
      setConnectionLatency(null)
      return
    }

    const timer = setTimeout(() => {
      requestModels(baseUrl, apiKey)
    }, 800)
    onCleanup(() => clearTimeout(timer))
  })

  // ── Manual test connection (ping) ─────────────────────────────────
  const testConnection = () => {
    const profile = selectedProfile()
    if (!profile?.base_url) {
      showToast({ variant: "error", title: language.t("settings.providers.testConnection.noUrl") })
      return
    }
    // requestModels already sets isFetchingModels / connectionStatus.
    // The onMount listener handles the result; we add a one-shot toast handler.
    const unsub = vscode.onMessage((msg: any) => {
      if (msg.type !== "openAiModels") return
      unsub()
      if (msg.openAiModels?.length) {
        showToast({
          variant: "success",
          title: language.t("settings.providers.testConnection.success", { count: String(msg.openAiModels.length) }),
        })
      } else {
        showToast({
          variant: "error",
          title: language.t("settings.providers.testConnection.failed"),
          description: (msg.error ?? "Unknown error").slice(0, 200),
        })
      }
    })
    requestModels(profile.base_url, profile.api_key ?? "")
  }

  // ── Provider selection handler ────────────────────────────────────
  const onProviderSelect = (providerName: string) => {
    const profileID = selectedProfileId()
    if (!profileID || !providerName) return
    const partial: Partial<ProviderConfig> = { name: providerName }
    upsertProfile(profileID, partial)
  }

  const providerPlaceholderUrl = createMemo(() => {
    const name = selectedProviderName()
    return WELL_KNOWN_PROVIDERS[name]?.placeholder ?? "http://127.0.0.1:6005/v1"
  })

  // ── Connection status indicator ───────────────────────────────────
  const connectionIndicator = createMemo(() => {
    const status = connectionStatus()
    const latency = connectionLatency()
    switch (status) {
      case "testing": return { icon: "⏳", color: "var(--vscode-charts-yellow, #cca700)", text: "Testing..." }
      case "success": return { icon: "✅", color: "var(--vscode-charts-green, #388a34)", text: latency ? `Connected (${latency}ms)` : "Connected" }
      case "error": return { icon: "❌", color: "var(--vscode-errorForeground, #f14c4c)", text: "Connection failed" }
      default: return { icon: "⚪", color: "var(--vscode-descriptionForeground)", text: "Not tested" }
    }
  })

  const effortOptions: SelectOption[] = [
    { value: "minimal", label: language.t("settings.providers.model.reasoningEffort.option.minimal") },
    { value: "low", label: language.t("settings.providers.model.reasoningEffort.option.low") },
    { value: "medium", label: language.t("settings.providers.model.reasoningEffort.option.medium") },
    { value: "high", label: language.t("settings.providers.model.reasoningEffort.option.high") },
  ]

  // ── Advanced settings open/close ────────────────────────────────
  const [advancedOpen, setAdvancedOpen] = createSignal(false)

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {/* ── Default & Small Model ─────────────────────────────────── */}
      <Card>
        <SettingsRow title={language.t("settings.providers.defaultModel.title")} description={language.t("settings.providers.defaultModel.description")} isDirty={hasDraft()}>
          <ModelSelectorBase value={parseModelConfig(mergedConfig().model)} onSelect={(p, m) => stage({ model: p && m ? `${p}/${m}` : undefined })} placement="bottom-start" allowClear clearLabel={language.t("settings.providers.notSet")} />
        </SettingsRow>
        <SettingsRow title={language.t("settings.providers.smallModel.title")} description={language.t("settings.providers.smallModel.description")} isDirty={hasDraft()} last>
          <ModelSelectorBase value={parseModelConfig(mergedConfig().small_model)} onSelect={(p, m) => stage({ small_model: p && m ? `${p}/${m}` : undefined })} placement="bottom-start" allowClear clearLabel={language.t("settings.providers.notSet")} />
        </SettingsRow>
      </Card>

      {/* ── Profile + Provider Config (Kilo-style: all-in-one) ───── */}
      <Card>
        {/* Profile selector row */}
        <SettingsRow title={language.t("settings.providers.profiles.select")} description={language.t("settings.providers.profiles.description")} isDirty={hasDraft()}>
          <div style={{ display: "flex", gap: "6px", "align-items": "center", width: "100%" }}>
            <div style={{ flex: 1 }}>
              <Select options={profileOptions()} current={profileOptions().find((item) => item.value === selectedProfileId())} value={(item) => item.value} label={(item) => item.label} onSelect={(item) => setSelectedProfileId(item?.value ?? "")} variant="secondary" size="small" triggerVariant="settings" placeholder={language.t("common.choose")} />
            </div>
            <Button size="small" variant="ghost" onClick={createProfile} title={language.t("common.add")}>＋</Button>
            <Show when={selectedProfileId()}>
              <Button size="small" variant="ghost" onClick={() => { if (selectedProfileId()) deleteProfile(selectedProfileId()) }} title={language.t("common.delete")}>🗑</Button>
            </Show>
          </div>
        </SettingsRow>

        {/* Create profile inline */}
        <SettingsRow title={language.t("settings.providers.profiles.create")} description="" isDirty={hasDraft()}>
          <div style={{ display: "flex", gap: "8px", width: "100%" }}>
            <div style={{ flex: 1 }}>
              <TextField value={newProfileInput()} placeholder={language.t("settings.providers.profiles.createPlaceholder")} onChange={setNewProfileInput} onKeyDown={(event: KeyboardEvent) => event.key === "Enter" && createProfile()} />
            </div>
            <Button size="small" onClick={createProfile}>{language.t("common.add")}</Button>
          </div>
        </SettingsRow>

        {/* ── Inline provider config (shown when a profile is selected) ── */}
        <Show when={selectedProfile()}>
          <SettingsRow title={language.t("settings.providers.apiProvider.title")} description={language.t("settings.providers.apiProvider.description")} isDirty={hasDraft()}>
            <Select options={providerOptions()} current={providerOptions().find((item) => item.value === selectedProviderName())} value={(item) => item.value} label={(item) => item.label} onSelect={(item) => item && onProviderSelect(item.value)} variant="secondary" size="small" triggerVariant="settings" />
          </SettingsRow>

          <SettingsRow title={language.t("settings.providers.baseUrl.title")} description={language.t("settings.providers.baseUrl.description")} isDirty={hasDraft()}>
            <TextField value={selectedProfile()?.base_url ?? ""} placeholder={providerPlaceholderUrl()} onChange={(value) => upsertProfile(selectedProfileId(), { base_url: value, options: { ...(selectedOptions() as ProviderConfig["options"]), baseURL: value } })} />
          </SettingsRow>

          <SettingsRow title={language.t("settings.providers.apiKey.title")} description={language.t("settings.providers.apiKey.description")} isDirty={hasDraft()}>
            <TextField type="password" value={selectedProfile()?.api_key ?? ""} onChange={(value) => upsertProfile(selectedProfileId(), { api_key: value, options: { ...(selectedOptions() as ProviderConfig["options"]), apiKey: value } })} />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.providers.model.select")}
            description={isFetchingModels() ? language.t("settings.providers.model.fetchingModels") : fetchError() ? language.t("settings.providers.model.fetchFailedHint") : language.t("settings.providers.model.selectDescription")}
            isDirty={hasDraft()}
          >
            <Select options={allModelOptions()} current={allModelOptions().find((item) => item.value === selectedModelId())} value={(item) => item.value} label={(item) => item.label} onSelect={(item) => setSelectedModelId(item?.value ?? "")} variant="secondary" size="small" triggerVariant="settings" placeholder={isFetchingModels() ? language.t("settings.providers.model.loading") : language.t("common.choose")} />
          </SettingsRow>

          {/* ── Test Connection (always visible on first level) ──── */}
          <SettingsRow
            title={language.t("settings.providers.testConnection.title")}
            description={fetchError() || connectionIndicator().text}
            isDirty={hasDraft()}
          >
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <span style={{ color: connectionIndicator().color, "font-size": "16px" }}>{connectionIndicator().icon}</span>
              <Button size="small" onClick={testConnection} disabled={isFetchingModels() || !selectedProfile()?.base_url}>
                {isFetchingModels() ? language.t("settings.providers.model.loading") : language.t("settings.providers.testConnection.button")}
              </Button>
            </div>
          </SettingsRow>

          {/* ── Model info summary (inline, read-only) ───────────── */}
          <Show when={selectedModelId()}>
            <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))", padding: "6px 0" }}>
              {language.t("settings.providers.model.context.title")}: {(modelContext() ?? 0).toLocaleString()} tokens
              {modelImage() ? " · ✓ " + language.t("settings.providers.model.image.title") : ""}
              {modelReasoning() ? " · ✓ " + language.t("settings.providers.model.reasoning.title") : ""}
              {" · " + language.t("settings.providers.model.inputPrice.title")}: ${modelInputPrice() ?? 0} / 1M
              {" · " + language.t("settings.providers.model.outputPrice.title")}: ${modelOutputPrice() ?? 0} / 1M
            </div>
          </Show>

          {/* ── Advanced Settings (collapsible, no page jump) ────── */}
          <div style={{ "border-top": "1px solid var(--border-weak-base, var(--vscode-panel-border))", "margin-top": "4px", "padding-top": "4px" }}>
            <button
              style={{
                background: "none", border: "none", color: "var(--vscode-textLink-foreground, #3794ff)",
                cursor: "pointer", "font-size": "12px", padding: "4px 0", display: "flex", "align-items": "center", gap: "4px",
              }}
              onClick={() => setAdvancedOpen(!advancedOpen())}
            >
              <span style={{ transition: "transform 0.15s", transform: advancedOpen() ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
              {language.t("settings.providers.advanced.title") || "高级选项"}
            </button>

            <Show when={advancedOpen()}>
              <div style={{ display: "grid", gap: "0px", "padding-top": "8px" }}>
                <SettingsRow title={language.t("settings.providers.model.add")} description="" isDirty={hasDraft()}>
                  <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                    <div style={{ flex: 1 }}>
                      <TextField value={newModelInput()} placeholder={language.t("settings.providers.model.addPlaceholder")} onChange={setNewModelInput} onKeyDown={(event: KeyboardEvent) => event.key === "Enter" && addModel()} />
                    </div>
                    <Button size="small" onClick={addModel}>{language.t("common.add")}</Button>
                  </div>
                </SettingsRow>

                <Show when={selectedModelId()}>
                  <SettingsRow title={language.t("settings.providers.model.maxOutput.title")} description={language.t("settings.providers.model.maxOutput.description")} isDirty={hasDraft()}>
                    <TextField value={modelOutput() != null ? String(modelOutput()) : ""} placeholder="0" onChange={(value) => { const parsed = parseInteger(value); if (parsed !== undefined) updateModel({ limit: { output: parsed } }) }} />
                  </SettingsRow>
                  <SettingsRow title={language.t("settings.providers.model.context.title")} description={language.t("settings.providers.model.context.description")} isDirty={hasDraft()}>
                    <TextField value={modelContext() != null ? String(modelContext()) : ""} placeholder="0" onChange={(value) => { const parsed = parseInteger(value); if (parsed !== undefined) updateModel({ limit: { context: parsed } }) }} />
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
                  <SettingsRow title={language.t("settings.providers.model.reasoning.title")} description={language.t("settings.providers.model.reasoning.description")} isDirty={hasDraft()}>
                    <Switch checked={modelReasoning()} onChange={(checked) => updateModel({ reasoning: checked })} hideLabel>{language.t("settings.providers.model.reasoning.title")}</Switch>
                  </SettingsRow>
                  <SettingsRow title={language.t("settings.providers.model.reasoningEffort.title")} description={language.t("settings.providers.model.reasoningEffort.description")} isDirty={hasDraft()}>
                    <Select options={effortOptions} current={effortOptions.find((item) => item.value === String(modelOptionsRecord().reasoningEffort ?? "medium"))} value={(item) => item.value} label={(item) => item.label} onSelect={(item) => item && updateModel({ options: { ...modelOptionsRecord(), reasoningEffort: item.value } })} variant="secondary" size="small" triggerVariant="settings" />
                  </SettingsRow>
                  <SettingsRow title={language.t("settings.providers.model.temperature.title")} description={language.t("settings.providers.model.temperature.description")} isDirty={hasDraft()}>
                    <Switch checked={modelTemperature()} onChange={(checked) => updateModel({ temperature: checked })} hideLabel>{language.t("settings.providers.model.temperature.title")}</Switch>
                  </SettingsRow>
                  <SettingsRow title={language.t("settings.providers.model.toolCall.title")} description={language.t("settings.providers.model.toolCall.description")} isDirty={hasDraft()}>
                    <Switch checked={modelToolcall()} onChange={(checked) => updateModel({ tool_call: checked })} hideLabel>{language.t("settings.providers.model.toolCall.title")}</Switch>
                  </SettingsRow>
                  <SettingsRow title={language.t("settings.providers.model.inputPrice.title")} description={language.t("settings.providers.model.inputPrice.description")} isDirty={hasDraft()}>
                    <TextField value={modelInputPrice() != null ? String(modelInputPrice()) : ""} placeholder="0" onChange={(value) => { const parsed = parseFloatNumber(value); if (parsed !== undefined) updateModel({ cost: { input: parsed } }) }} />
                  </SettingsRow>
                  <SettingsRow title={language.t("settings.providers.model.outputPrice.title")} description={language.t("settings.providers.model.outputPrice.description")} isDirty={hasDraft()}>
                    <TextField value={modelOutputPrice() != null ? String(modelOutputPrice()) : ""} placeholder="0" onChange={(value) => { const parsed = parseFloatNumber(value); if (parsed !== undefined) updateModel({ cost: { output: parsed } }) }} />
                  </SettingsRow>
                  <SettingsRow title={language.t("settings.providers.model.cacheReadPrice.title")} description={language.t("settings.providers.model.cacheReadPrice.description")} isDirty={hasDraft()}>
                    <TextField value={modelCacheRead() != null ? String(modelCacheRead()) : ""} placeholder="0" onChange={(value) => { const parsed = parseFloatNumber(value); if (parsed !== undefined) updateModel({ cost: { cache_read: parsed } }) }} />
                  </SettingsRow>
                  <SettingsRow title={language.t("settings.providers.model.cacheWritePrice.title")} description={language.t("settings.providers.model.cacheWritePrice.description")} isDirty={hasDraft()}>
                    <TextField value={modelCacheWrite() != null ? String(modelCacheWrite()) : ""} placeholder="0" onChange={(value) => { const parsed = parseFloatNumber(value); if (parsed !== undefined) updateModel({ cost: { cache_write: parsed } }) }} />
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
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </Card>

      {/* ── Disabled Providers ────────────────────────────────────── */}
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

      {/* ── Enabled Providers (Allowlist) ─────────────────────────── */}
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

      {/* ── Sticky Save Bar ──────────────────────────────────────── */}
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

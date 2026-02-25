import { Component, For, Show, Match, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { ModelSelectorBase } from "../chat/ModelSelector"
import type {
  ModelSelection,
  ProviderAuthAuthorization,
  ProviderAuthMethod,
  ProviderActionResultMessage,
  ProviderConfig,
  WebviewMessage,
} from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface ProviderOption {
  value: string
  label: string
}

type ProviderSource = "env" | "config" | "custom" | "other"

interface ProviderCardItem {
  id: string
  name: string
  source: ProviderSource
  noteKey?: string
  disabled: boolean
}

interface ProviderEditorDraft {
  id: string
  name: string
  providerType: string
  baseURL: string
  apiKey: string
  modelID: string
  modelName: string
  modelsPath: string
  modelsURL: string
  stream: boolean
  includeMaxTokens: boolean
  useAzure: boolean
  includeUsage: boolean
  azureApiVersion: string
  reasoningEffort: string
  maxOutputTokens: string
  contextWindow: string
  headers: Array<{ key: string; value: string }>
}

const POPULAR_PROVIDERS = [
  "VCP",
  "opencode",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible"
const PROVIDER_NPM_MAP: Record<string, string> = {
  "openai-compatible": OPENAI_COMPATIBLE_NPM,
  openai: "@ai-sdk/openai",
  anthropic: "@ai-sdk/anthropic",
  google: "@ai-sdk/google",
  openrouter: "@openrouter/ai-sdk-provider",
  azure: "@ai-sdk/azure",
  "github-copilot": "@ai-sdk/github-copilot",
  VCP: "@kilocode/VCP-gateway",
  opencode: "@kilocode/VCP-gateway",
}

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

function providerNoteKey(providerID: string): string | undefined {
  return PROVIDER_NOTES.find((item) => item.match(providerID))?.key
}

function parseModelConfig(raw: string | undefined): ModelSelection | null {
  if (!raw) {
    return null
  }
  const slash = raw.indexOf("/")
  if (slash <= 0) {
    return null
  }
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

type ProviderActionStage = "apiKey" | "oauthAuthorize" | "oauthCallback" | "disconnect"

type ProviderActionRequest =
  | { type: "providerSetApiKey"; providerID: string; apiKey: string }
  | { type: "providerOauthAuthorize"; providerID: string; method: number }
  | { type: "providerOauthCallback"; providerID: string; method: number; code?: string }
  | { type: "providerDisconnect"; providerID: string }

interface ProviderConnectDialogProps {
  providerID: string
  providerName: string
  methods: ProviderAuthMethod[]
  runAction: (request: ProviderActionRequest, stage: ProviderActionStage) => Promise<ProviderActionResultMessage>
  onConnected: () => void
}

const ProviderConnectDialog: Component<ProviderConnectDialogProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()

  const methods = createMemo<ProviderAuthMethod[]>(() => {
    if (props.methods.length > 0) {
      return props.methods
    }
    return [{ type: "api", label: language.t("provider.connect.method.apiKey") }]
  })

  const [methodIndex, setMethodIndex] = createSignal<number | undefined>()
  const [authorization, setAuthorization] = createSignal<ProviderAuthAuthorization | undefined>()
  const [apiKey, setApiKey] = createSignal("")
  const [oauthCode, setOauthCode] = createSignal("")
  const [busyStage, setBusyStage] = createSignal<"authorize" | "submit" | null>(null)
  const [errorText, setErrorText] = createSignal<string | undefined>()
  const [openedAuthUrl, setOpenedAuthUrl] = createSignal(false)

  const selectedMethod = createMemo(() => {
    const index = methodIndex()
    return index === undefined ? undefined : methods()[index]
  })

  const confirmationCode = createMemo(() => {
    const instructions = authorization()?.instructions
    if (!instructions) return ""
    const codeMatch = instructions.match(/code:\s*(\S+)/i)
    if (codeMatch?.[1]) return codeMatch[1]
    return instructions
  })

  const openAuthorizationUrl = () => {
    const url = authorization()?.url
    if (!url) return
    vscode.postMessage({ type: "openExternal", url })
  }

  createEffect(() => {
    if (methods().length === 1 && methodIndex() === undefined) {
      void selectMethod(0)
    }
  })

  createEffect(() => {
    if (!authorization() || openedAuthUrl()) return
    setOpenedAuthUrl(true)
    openAuthorizationUrl()
  })

  const selectMethod = async (index: number) => {
    setMethodIndex(index)
    setAuthorization(undefined)
    setOauthCode("")
    setErrorText(undefined)
    setOpenedAuthUrl(false)

    const method = methods()[index]
    if (method?.type !== "oauth") {
      return
    }

    setBusyStage("authorize")
    const result = await props.runAction(
      { type: "providerOauthAuthorize", providerID: props.providerID, method: index },
      "oauthAuthorize",
    )
    setBusyStage(null)

    if (!result.ok || !result.authorization) {
      setErrorText(result.error ?? language.t("common.requestFailed"))
      return
    }

    setAuthorization(result.authorization)
  }

  const submitApiKey = async () => {
    if (!apiKey().trim()) {
      setErrorText(language.t("provider.connect.apiKey.required"))
      return
    }

    setBusyStage("submit")
    setErrorText(undefined)
    const result = await props.runAction(
      { type: "providerSetApiKey", providerID: props.providerID, apiKey: apiKey().trim() },
      "apiKey",
    )
    setBusyStage(null)

    if (!result.ok) {
      setErrorText(result.error ?? language.t("common.requestFailed"))
      return
    }

    props.onConnected()
    dialog.close()
  }

  const goBack = () => {
    setAuthorization(undefined)
    setOauthCode("")
    setErrorText(undefined)
    setBusyStage(null)
    setOpenedAuthUrl(false)
    if (methods().length === 1) {
      dialog.close()
      return
    }
    setMethodIndex(undefined)
  }

  const submitOauth = async () => {
    const auth = authorization()
    if (!auth) return

    const trimmedCode = oauthCode().trim()
    if (auth.method === "code" && !trimmedCode) {
      setErrorText(language.t("provider.connect.oauth.code.required"))
      return
    }

    setBusyStage("submit")
    setErrorText(undefined)
    const result = await props.runAction(
      {
        type: "providerOauthCallback",
        providerID: props.providerID,
        method: methodIndex() ?? 0,
        code: auth.method === "code" ? trimmedCode : undefined,
      },
      "oauthCallback",
    )
    setBusyStage(null)

    if (!result.ok) {
      setErrorText(result.error ?? language.t("provider.connect.oauth.code.invalid"))
      return
    }

    props.onConnected()
    dialog.close()
  }

  return (
    <Dialog title={language.t("provider.connect.title", { provider: props.providerName })} transition>
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px", padding: "8px 4px 16px 4px" }}>
        <Switch>
          <Match when={methodIndex() === undefined}>
            <div style={{ "font-size": "13px", color: "var(--text-base, var(--vscode-foreground))" }}>
              {language.t("provider.connect.selectMethod", { provider: props.providerName })}
            </div>
            <div style={{ display: "grid", gap: "8px" }}>
              <For each={methods()}>
                {(method, index) => (
                  <Button variant="secondary" size="small" onClick={() => void selectMethod(index())}>
                    {method.label}
                  </Button>
                )}
              </For>
            </div>
          </Match>
          <Match when={selectedMethod()?.type === "api"}>
            <div style={{ "font-size": "13px", color: "var(--text-base, var(--vscode-foreground))" }}>
              {language.t("provider.connect.apiKey.description", { provider: props.providerName })}
            </div>
            <TextField
              type="password"
              value={apiKey()}
              label={language.t("provider.connect.apiKey.label", { provider: props.providerName })}
              placeholder={language.t("provider.connect.apiKey.placeholder")}
              onChange={(value) => {
                setApiKey(value)
                if (errorText()) setErrorText(undefined)
              }}
            />
            <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
              <Button size="small" variant="ghost" onClick={goBack}>
                {language.t("common.goBack")}
              </Button>
              <Button size="small" onClick={() => void submitApiKey()} disabled={busyStage() !== null}>
                {busyStage() === "submit"
                  ? language.t("provider.connect.status.inProgress")
                  : language.t("common.submit")}
              </Button>
            </div>
          </Match>
          <Match when={selectedMethod()?.type === "oauth"}>
            <Show
              when={authorization()}
              fallback={
                <div style={{ "font-size": "13px", color: "var(--text-base, var(--vscode-foreground))" }}>
                  {language.t("provider.connect.status.inProgress")}
                </div>
              }
            >
              {(auth) => (
                <div style={{ display: "grid", gap: "10px" }}>
                  <Switch>
                    <Match when={auth().method === "code"}>
                      <div style={{ "font-size": "13px", color: "var(--text-base, var(--vscode-foreground))" }}>
                        {language.t("provider.connect.oauth.code.visit.prefix")}
                        <a
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            openAuthorizationUrl()
                          }}
                        >
                          {language.t("provider.connect.oauth.code.visit.link")}
                        </a>
                        {language.t("provider.connect.oauth.code.visit.suffix", { provider: props.providerName })}
                      </div>
                    </Match>
                    <Match when={true}>
                      <div style={{ "font-size": "13px", color: "var(--text-base, var(--vscode-foreground))" }}>
                        {language.t("provider.connect.oauth.auto.visit.prefix")}
                        <a
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            openAuthorizationUrl()
                          }}
                        >
                          {language.t("provider.connect.oauth.auto.visit.link")}
                        </a>
                        {language.t("provider.connect.oauth.auto.visit.suffix", { provider: props.providerName })}
                      </div>
                    </Match>
                  </Switch>
                  <Show when={auth().method === "auto"}>
                    <TextField
                      value={confirmationCode()}
                      label={language.t("provider.connect.oauth.auto.confirmationCode")}
                      readOnly
                    />
                  </Show>
                  <Show when={auth().method === "code"}>
                    <TextField
                      value={oauthCode()}
                      label={language.t("provider.connect.oauth.code.label", {
                        method: selectedMethod()?.label ?? "",
                      })}
                      placeholder={language.t("provider.connect.oauth.code.placeholder")}
                      onChange={(value) => {
                        setOauthCode(value)
                        if (errorText()) setErrorText(undefined)
                      }}
                    />
                  </Show>
                  <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
                    <Button size="small" variant="ghost" onClick={goBack}>
                      {language.t("common.goBack")}
                    </Button>
                    <Button size="small" onClick={() => void submitOauth()} disabled={busyStage() !== null}>
                      {busyStage() === "submit"
                        ? language.t("provider.connect.status.waiting")
                        : language.t("common.submit")}
                    </Button>
                  </div>
                </div>
              )}
            </Show>
          </Match>
        </Switch>
        <Show when={errorText()}>
          {(message) => (
            <div style={{ "font-size": "12px", color: "var(--vscode-errorForeground, #f48771)" }}>{message()}</div>
          )}
        </Show>
      </div>
    </Dialog>
  )
}

const ProvidersTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()

  const configuredProviders = createMemo<Record<string, ProviderConfig>>(
    () => (config().provider as Record<string, ProviderConfig>) ?? {},
  )
  const providerCatalog = createMemo(() => provider.providers())
  const connectedSet = createMemo(() => new Set(provider.connected()))
  const disabledSet = createMemo(() => new Set(config().disabled_providers ?? []))

  const providerOptions = createMemo<ProviderOption[]>(() =>
    Object.values(providerCatalog())
      .map((item) => ({ value: item.id, label: item.name || item.id }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  )

  const [newDisabled, setNewDisabled] = createSignal<ProviderOption | undefined>()
  const [newEnabled, setNewEnabled] = createSignal<ProviderOption | undefined>()
  const [editor, setEditor] = createSignal<ProviderEditorDraft | null>(null)
  const [activeProfile, setActiveProfile] = createSignal<string>("")

  const disabledProviders = () => config().disabled_providers ?? []
  const enabledProviders = () => config().enabled_providers ?? []

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

  const isSoftDeleted = (cfg: ProviderConfig | undefined) => cfg?.options?.["__vcpDeleted"] === true

  const visibleConfiguredProviders = createMemo<Record<string, ProviderConfig>>(() => {
    const result: Record<string, ProviderConfig> = {}
    for (const [id, cfg] of Object.entries(configuredProviders())) {
      if (isSoftDeleted(cfg)) continue
      result[id] = cfg
    }
    return result
  })

  const profileOptions = createMemo<ProviderOption[]>(() => {
    const ids = new Set<string>([...Object.keys(visibleConfiguredProviders()), ...provider.connected()])
    const options = Array.from(ids).map((id) => ({
      value: id,
      label: visibleConfiguredProviders()[id]?.name ?? providerCatalog()[id]?.name ?? id,
    }))
    options.sort((a, b) => a.label.localeCompare(b.label))
    return options
  })

  const providerTypeOptions = createMemo<ProviderOption[]>(() => {
    const options: ProviderOption[] = [{ value: "openai-compatible", label: "OpenAI Compatible" }]
    for (const item of Object.values(providerCatalog())) {
      options.push({ value: item.id, label: item.name || item.id })
    }
    options.sort((a, b) => a.label.localeCompare(b.label))
    return options
  })

  const normalizeText = (value: string): string | undefined => {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const parseInteger = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const providerTypeFromConfig = (providerID: string, cfg: ProviderConfig | undefined): string => {
    const npm = cfg?.npm
    if (npm) {
      const match = Object.entries(PROVIDER_NPM_MAP).find(([, value]) => value === npm)
      if (match) return match[0]
    }
    if (providerCatalog()[providerID]) return providerID
    return "openai-compatible"
  }

  const defaultModelForProvider = (providerID: string, cfg: ProviderConfig | undefined) => {
    const configuredModels = cfg?.models
    if (isRecord(configuredModels)) {
      const first = Object.entries(configuredModels)[0]
      if (first) {
        const entry = isRecord(first[1]) ? first[1] : {}
        return {
          id: first[0],
          name: typeof entry.name === "string" ? entry.name : first[0],
        }
      }
    }
    const defaultModel = provider.defaults()[providerID]
    if (defaultModel && providerCatalog()[providerID]?.models?.[defaultModel]) {
      return {
        id: defaultModel,
        name: providerCatalog()[providerID]!.models[defaultModel].name ?? defaultModel,
      }
    }
    const firstCatalog = Object.entries(providerCatalog()[providerID]?.models ?? {})[0]
    if (firstCatalog) {
      return {
        id: firstCatalog[0],
        name: firstCatalog[1].name ?? firstCatalog[0],
      }
    }
    return { id: "gpt-4o-mini", name: "gpt-4o-mini" }
  }

  const updateEditor = <K extends keyof ProviderEditorDraft>(key: K, value: ProviderEditorDraft[K]) => {
    setEditor((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const updateHeaderRow = (index: number, key: "key" | "value", value: string) => {
    setEditor((prev) => {
      if (!prev) return prev
      const headers = prev.headers.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row))
      return { ...prev, headers }
    })
  }

  const addHeaderRow = () => {
    setEditor((prev) => (prev ? { ...prev, headers: [...prev.headers, { key: "", value: "" }] } : prev))
  }

  const removeHeaderRow = (index: number) => {
    setEditor((prev) => {
      if (!prev) return prev
      if (prev.headers.length <= 1) return prev
      return { ...prev, headers: prev.headers.filter((_, rowIndex) => rowIndex !== index) }
    })
  }

  const addToList = (key: "disabled_providers" | "enabled_providers", value: string) => {
    const current = key === "disabled_providers" ? [...disabledProviders()] : [...enabledProviders()]
    if (value && !current.includes(value)) {
      current.push(value)
      updateConfig({ [key]: current })
    }
  }

  const removeFromList = (key: "disabled_providers" | "enabled_providers", index: number) => {
    const current = key === "disabled_providers" ? [...disabledProviders()] : [...enabledProviders()]
    current.splice(index, 1)
    updateConfig({ [key]: current })
  }

  const connectedProviders = createMemo<ProviderCardItem[]>(() => {
    const ids = new Set<string>([...provider.connected(), ...Object.keys(visibleConfiguredProviders())])
    const items = Array.from(ids).map((id) => {
      const fromCatalog = providerCatalog()[id]
      const fromConfig = visibleConfiguredProviders()[id]
      const isCustom = id.startsWith("custom-provider-") || !fromCatalog

      let source: ProviderSource = "other"
      if (fromConfig) {
        source = isCustom ? "custom" : "config"
      } else if (connectedSet().has(id)) {
        source = "env"
      }

      return {
        id,
        name: fromCatalog?.name ?? fromConfig?.name ?? id,
        source,
        noteKey: providerNoteKey(id),
        disabled: disabledSet().has(id),
      }
    })

    items.sort((a, b) => {
      const rankA = POPULAR_PROVIDERS.indexOf(a.id)
      const rankB = POPULAR_PROVIDERS.indexOf(b.id)
      const weightA = rankA === -1 ? 999 : rankA
      const weightB = rankB === -1 ? 999 : rankB
      if (weightA !== weightB) return weightA - weightB
      return a.name.localeCompare(b.name)
    })

    return items
  })

  const popularProviderItems = createMemo(() => {
    const connectedIDs = new Set(connectedProviders().map((item) => item.id))
    return Object.values(providerCatalog())
      .filter((item) => POPULAR_PROVIDERS.includes(item.id) && !connectedIDs.has(item.id))
      .sort((a, b) => POPULAR_PROVIDERS.indexOf(a.id) - POPULAR_PROVIDERS.indexOf(b.id))
      .map((item) => ({
        id: item.id,
        name: item.name || item.id,
        noteKey: providerNoteKey(item.id),
      }))
  })

  const sourceLabel = (source: ProviderSource) => {
    if (source === "env") return language.t("settings.providers.tag.environment")
    if (source === "config") return language.t("settings.providers.tag.config")
    if (source === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const getProviderSource = (providerID: string): ProviderSource => {
    const fromCatalog = providerCatalog()[providerID]
    const fromConfig = visibleConfiguredProviders()[providerID]
    const isCustom = providerID.startsWith("custom-provider-") || !fromCatalog
    if (fromConfig) return isCustom ? "custom" : "config"
    if (connectedSet().has(providerID)) return "env"
    return "other"
  }

  const runProviderAction = (request: ProviderActionRequest, stage: ProviderActionStage) =>
    new Promise<ProviderActionResultMessage>((resolve) => {
      const requestId = `provider-${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      let settled = false
      let unsubscribe = () => {}

      const finish = (result: ProviderActionResultMessage) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        unsubscribe()
        resolve(result)
      }

      const timeout = setTimeout(() => {
        finish({
          type: "providerActionResult",
          requestId,
          providerID: request.providerID,
          stage,
          ok: false,
          error: language.t("common.requestFailed"),
        })
      }, 30000)

      unsubscribe = vscode.onMessage((message) => {
        if (message.type !== "providerActionResult") return
        if (message.requestId !== requestId) return
        finish(message)
      })

      vscode.postMessage({ ...request, requestId } as WebviewMessage)
    })

  const clearDisabledProvider = (providerID: string) => {
    const previousDisabled = config().disabled_providers ?? []
    const nextDisabled = previousDisabled.filter((id) => id !== providerID)
    if (nextDisabled.length !== previousDisabled.length) {
      updateConfig({ disabled_providers: nextDisabled })
    }
  }

  const openEditor = (providerID: string) => {
    const cfg = visibleConfiguredProviders()[providerID] ?? {}
    const catalog = providerCatalog()[providerID]
    const selectedModel = defaultModelForProvider(providerID, cfg)
    const headersRaw = cfg.options?.headers
    const headers = isRecord(headersRaw)
      ? Object.entries(headersRaw).map(([key, value]) => ({
          key,
          value: typeof value === "string" ? value : String(value),
        }))
      : []
    const stream = typeof cfg.options?.stream === "boolean" ? cfg.options.stream : true
    const includeMaxTokens = typeof cfg.options?.includeMaxTokens === "boolean" ? cfg.options.includeMaxTokens : true
    const useAzure = typeof cfg.options?.useAzure === "boolean" ? cfg.options.useAzure : false
    const includeUsage = typeof cfg.options?.includeUsage === "boolean" ? cfg.options.includeUsage : true

    setActiveProfile(providerID)
    setEditor({
      id: providerID,
      name: cfg.name ?? catalog?.name ?? providerID,
      providerType: providerTypeFromConfig(providerID, cfg),
      baseURL: cfg.options?.baseURL ?? cfg.base_url ?? "",
      apiKey: cfg.options?.apiKey ?? cfg.api_key ?? "",
      modelID: selectedModel.id,
      modelName: selectedModel.name,
      modelsPath: cfg.options?.modelsPath ?? "",
      modelsURL: cfg.options?.modelsURL ?? "",
      stream,
      includeMaxTokens,
      useAzure,
      includeUsage,
      azureApiVersion: typeof cfg.options?.azureApiVersion === "string" ? cfg.options.azureApiVersion : "",
      reasoningEffort: typeof cfg.options?.reasoningEffort === "string" ? cfg.options.reasoningEffort : "",
      maxOutputTokens: typeof cfg.options?.maxOutputTokens === "number" ? String(cfg.options.maxOutputTokens) : "",
      contextWindow: typeof cfg.options?.contextWindow === "number" ? String(cfg.options.contextWindow) : "",
      headers: headers.length > 0 ? headers : [{ key: "", value: "" }],
    })
  }

  const connectProvider = (providerID: string) => {
    const providerEntry = providerCatalog()[providerID]
    const providerName = providerEntry?.name ?? providerID
    const methods = provider.providerAuth()[providerID] ?? []

    dialog.show(() => (
      <ProviderConnectDialog
        providerID={providerID}
        providerName={providerName}
        methods={methods}
        runAction={runProviderAction}
        onConnected={() => {
          clearDisabledProvider(providerID)
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("provider.connect.toast.connected.title", { provider: providerName }),
            description: language.t("provider.connect.toast.connected.description", { provider: providerName }),
          })
        }}
      />
    ))
  }

  const disconnectProvider = async (providerID: string, providerName: string) => {
    const result = await runProviderAction({ type: "providerDisconnect", providerID }, "disconnect")
    if (!result.ok) {
      showToast({
        title: language.t("common.requestFailed"),
        description: result.error ?? language.t("common.requestFailed"),
      })
      return
    }

    const current = config().disabled_providers ?? []
    if (!current.includes(providerID)) {
      updateConfig({ disabled_providers: [...current, providerID] })
    }

    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.disconnect.toast.disconnected.title", { provider: providerName }),
      description: language.t("provider.disconnect.toast.disconnected.description", { provider: providerName }),
    })
  }

  const saveEditor = () => {
    const draft = editor()
    if (!draft) return

    const currentProviders = configuredProviders()
    const existing = currentProviders[draft.id] ?? {}
    const nextProviders: Record<string, ProviderConfig> = { ...currentProviders }

    const providerNpm = PROVIDER_NPM_MAP[draft.providerType] ?? existing.npm ?? OPENAI_COMPATIBLE_NPM
    const baseURL = normalizeText(draft.baseURL)
    const apiKey = normalizeText(draft.apiKey)
    const modelID = normalizeText(draft.modelID) ?? "gpt-4o-mini"

    const existingModels = isRecord(existing.models) ? (existing.models as Record<string, unknown>) : {}
    const existingModel = isRecord(existingModels[modelID]) ? (existingModels[modelID] as Record<string, unknown>) : {}
    const existingModelProvider = isRecord(existingModel.provider)
      ? { ...(existingModel.provider as Record<string, unknown>) }
      : {}
    existingModelProvider.npm = providerNpm
    if (baseURL) {
      existingModelProvider.api = baseURL
    }

    const modelEntry: Record<string, unknown> = {
      ...existingModel,
      id: modelID,
      name: normalizeText(draft.modelName) ?? modelID,
      provider: existingModelProvider,
    }

    const headers = Object.fromEntries(
      draft.headers
        .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
        .filter((row) => row.key && row.value)
        .map((row) => [row.key, row.value]),
    )

    const options: Record<string, unknown> = { ...(existing.options ?? {}) }
    if (baseURL) options.baseURL = baseURL
    else delete options.baseURL
    if (apiKey) options.apiKey = apiKey
    else delete options.apiKey
    if (normalizeText(draft.modelsPath)) options.modelsPath = draft.modelsPath.trim()
    else delete options.modelsPath
    if (normalizeText(draft.modelsURL)) options.modelsURL = draft.modelsURL.trim()
    else delete options.modelsURL
    if (normalizeText(draft.azureApiVersion)) options.azureApiVersion = draft.azureApiVersion.trim()
    else delete options.azureApiVersion
    if (normalizeText(draft.reasoningEffort)) options.reasoningEffort = draft.reasoningEffort.trim()
    else delete options.reasoningEffort

    const maxOutputTokens = parseInteger(draft.maxOutputTokens)
    if (typeof maxOutputTokens === "number") options.maxOutputTokens = maxOutputTokens
    else delete options.maxOutputTokens

    const contextWindow = parseInteger(draft.contextWindow)
    if (typeof contextWindow === "number") options.contextWindow = contextWindow
    else delete options.contextWindow

    options.stream = draft.stream
    options.includeMaxTokens = draft.includeMaxTokens
    options.useAzure = draft.useAzure
    options.includeUsage = draft.includeUsage
    options.__vcpDeleted = false

    if (Object.keys(headers).length > 0) options.headers = headers
    else delete options.headers

    nextProviders[draft.id] = {
      ...existing,
      name: normalizeText(draft.name) ?? draft.id,
      npm: providerNpm,
      ...(baseURL ? { api: baseURL } : {}),
      base_url: baseURL,
      api_key: apiKey,
      models: { [modelID]: modelEntry },
      options,
    }

    updateConfig({
      provider: nextProviders,
      disabled_providers: (config().disabled_providers ?? []).filter((id) => id !== draft.id),
    })

    vscode.postMessage({ type: "requestProviders" })
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("common.save"),
      description: `${draft.id} profile updated`,
    })
  }

  const addCustomProvider = () => {
    const existing = new Set([...Object.keys(providerCatalog()), ...Object.keys(configuredProviders())])
    let index = 1
    let candidate = `custom-provider-${index}`
    while (existing.has(candidate)) {
      index += 1
      candidate = `custom-provider-${index}`
    }
    openEditor(candidate)
  }

  const focusDisplayNameField = () => {
    const input = document.getElementById("provider-display-name-input") as HTMLInputElement | null
    input?.focus()
    input?.select()
  }

  const selectedProfileSource = createMemo<ProviderSource>(() => {
    const id = activeProfile()
    if (!id) return "other"
    return getProviderSource(id)
  })

  const selectedProviderModels = createMemo<ProviderOption[]>(() => {
    const draft = editor()
    if (!draft) return []
    const catalogProvider = providerCatalog()[draft.providerType] ?? providerCatalog()[draft.id]
    const models = catalogProvider?.models ?? {}
    return Object.entries(models).map(([id, model]) => ({
      value: id,
      label: model.name ?? id,
    }))
  })

  const selectedModelMetadata = createMemo(() => {
    const draft = editor()
    if (!draft) return undefined
    const catalogProvider = providerCatalog()[draft.providerType] ?? providerCatalog()[draft.id]
    if (!catalogProvider) return undefined
    return catalogProvider.models?.[draft.modelID]
  })

  const removeActiveProfile = () => {
    const draft = editor()
    if (!draft) return
    const currentProviders = configuredProviders()
    const existing = currentProviders[draft.id] ?? {}
    const nextProviders: Record<string, ProviderConfig> = { ...currentProviders }
    nextProviders[draft.id] = {
      ...existing,
      models: {},
      options: {
        ...(existing.options ?? {}),
        __vcpDeleted: true,
      },
    }
    const currentDisabled = config().disabled_providers ?? []
    const nextDisabled = currentDisabled.includes(draft.id) ? currentDisabled : [...currentDisabled, draft.id]
    updateConfig({ provider: nextProviders, disabled_providers: nextDisabled })
    vscode.postMessage({ type: "requestProviders" })
    setEditor(null)
    setActiveProfile("")
  }

  createEffect(() => {
    const profiles = profileOptions()
    const current = activeProfile()
    if (!current && profiles.length > 0) {
      openEditor(profiles[0].value)
      return
    }
    if (current && !profiles.some((item) => item.value === current) && profiles.length > 0) {
      openEditor(profiles[0].value)
    }
  })

  function handleModelSelect(configKey: "model" | "small_model") {
    return (providerID: string, modelID: string) => {
      if (!providerID || !modelID) {
        updateConfig({ [configKey]: undefined })
      } else {
        updateConfig({ [configKey]: `${providerID}/${modelID}` })
      }
    }
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.providers.defaultModel.title")}
          description={language.t("settings.providers.defaultModel.description")}
        >
          <ModelSelectorBase
            value={parseModelConfig(config().model)}
            onSelect={handleModelSelect("model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.providers.smallModel.title")}
          description={language.t("settings.providers.smallModel.description")}
          last
        >
          <ModelSelectorBase
            value={parseModelConfig(config().small_model)}
            onSelect={handleModelSelect("small_model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
          />
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.title")}</h4>
      <Card>
        <SettingsRow title="配置文件" description="保存多组 API 配置便于快速切换。">
          <div style={{ display: "flex", gap: "8px", "align-items": "center", width: "100%" }}>
            <div style={{ flex: 1 }}>
              <Select
                options={profileOptions()}
                current={profileOptions().find((item) => item.value === activeProfile())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && openEditor(item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                placeholder="Select profile..."
              />
            </div>
            <IconButton size="small" variant="secondary" icon="plus" onClick={addCustomProvider} />
            <IconButton size="small" variant="ghost" icon="edit" onClick={focusDisplayNameField} disabled={!editor()} />
            <IconButton size="small" variant="ghost" icon="trash" onClick={removeActiveProfile} disabled={!editor()} />
          </div>
        </SettingsRow>
      </Card>

      <Show
        when={editor()}
        fallback={
          <Card>
            <div
              style={{
                "font-size": "12px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              暂无可编辑配置文件，点击 + 新建。
            </div>
          </Card>
        }
      >
        {(draft) => (
          <>
            <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>提供商配置</h4>
            <Card>
              <SettingsRow title="API 提供商" description="选择适配器类型。">
                <Select
                  options={providerTypeOptions()}
                  current={providerTypeOptions().find((item) => item.value === draft().providerType)}
                  value={(item) => item.value}
                  label={(item) => item.label}
                  onSelect={(item) => item && updateEditor("providerType", item.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>
              <SettingsRow title="显示名称" description="该配置在列表中的名称。">
                <TextField
                  id="provider-display-name-input"
                  value={draft().name}
                  onChange={(value) => updateEditor("name", value)}
                />
              </SettingsRow>
              <SettingsRow title="OpenAI 基础 URL" description="OpenAI 兼容 API 地址。">
                <TextField
                  value={draft().baseURL}
                  placeholder="http://127.0.0.1:6005/v1"
                  onChange={(value) => updateEditor("baseURL", value)}
                />
              </SettingsRow>
              <SettingsRow title="API 密钥" description="用于访问提供商。">
                <TextField
                  type="password"
                  value={draft().apiKey}
                  placeholder="sk-..."
                  onChange={(value) => updateEditor("apiKey", value)}
                />
              </SettingsRow>
              <SettingsRow title="模型" description="优先使用下拉选择，无法枚举时可手动输入。">
                <div style={{ display: "grid", gap: "8px", width: "100%" }}>
                  <Show
                    when={selectedProviderModels().length > 0}
                    fallback={
                      <TextField
                        value={draft().modelID}
                        placeholder="gpt-4o-mini"
                        onChange={(value) => {
                          updateEditor("modelID", value)
                          updateEditor("modelName", value)
                        }}
                      />
                    }
                  >
                    <Select
                      options={selectedProviderModels()}
                      current={selectedProviderModels().find((item) => item.value === draft().modelID)}
                      value={(item) => item.value}
                      label={(item) => item.label}
                      onSelect={(item) => {
                        if (!item) return
                        updateEditor("modelID", item.value)
                        updateEditor("modelName", item.label)
                      }}
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  </Show>
                  <Show when={selectedModelMetadata()}>
                    {(model) => (
                      <div
                        style={{
                          "font-size": "11px",
                          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        }}
                      >
                        上下文窗口: {model().limit?.context ?? "--"} tokens
                      </div>
                    )}
                  </Show>
                </div>
              </SettingsRow>
              <SettingsRow title="模型显示名" description="可自定义展示文案。">
                <TextField value={draft().modelName} onChange={(value) => updateEditor("modelName", value)} />
              </SettingsRow>
              <SettingsRow title="启用流式传输" description="对应 options.stream。">
                <input
                  type="checkbox"
                  checked={draft().stream}
                  onChange={(event) => updateEditor("stream", event.currentTarget.checked)}
                />
              </SettingsRow>
              <SettingsRow title="包含最大输出 Token 数" description="对应 options.includeMaxTokens。">
                <input
                  type="checkbox"
                  checked={draft().includeMaxTokens}
                  onChange={(event) => updateEditor("includeMaxTokens", event.currentTarget.checked)}
                />
              </SettingsRow>
              <SettingsRow title="启用 Azure 服务" description="对应 options.useAzure。">
                <input
                  type="checkbox"
                  checked={draft().useAzure}
                  onChange={(event) => updateEditor("useAzure", event.currentTarget.checked)}
                />
              </SettingsRow>
              <SettingsRow title="Azure API 版本" description="对应 options.azureApiVersion。">
                <TextField
                  value={draft().azureApiVersion}
                  placeholder="2024-10-01-preview"
                  onChange={(value) => updateEditor("azureApiVersion", value)}
                />
              </SettingsRow>
              <SettingsRow title="模型推理强度" description="对应 options.reasoningEffort。">
                <Select
                  options={[
                    { value: "", label: "default" },
                    { value: "low", label: "low" },
                    { value: "medium", label: "medium" },
                    { value: "high", label: "high" },
                  ]}
                  current={
                    [
                      { value: "", label: "default" },
                      { value: "low", label: "low" },
                      { value: "medium", label: "medium" },
                      { value: "high", label: "high" },
                    ].find((item) => item.value === draft().reasoningEffort) ?? { value: "", label: "default" }
                  }
                  value={(item) => item.value}
                  label={(item) => item.label}
                  onSelect={(item) => item && updateEditor("reasoningEffort", item.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </SettingsRow>
              <SettingsRow title="最大输出 Token 数" description="对应 options.maxOutputTokens。">
                <TextField
                  value={draft().maxOutputTokens}
                  placeholder="-1"
                  onChange={(value) => updateEditor("maxOutputTokens", value)}
                />
              </SettingsRow>
              <SettingsRow title="上下文窗口大小" description="对应 options.contextWindow。">
                <TextField
                  value={draft().contextWindow}
                  placeholder="828000"
                  onChange={(value) => updateEditor("contextWindow", value)}
                />
              </SettingsRow>
              <SettingsRow title="自定义标头" description="附加 Header（可选）。" last>
                <div style={{ display: "grid", gap: "8px", width: "100%" }}>
                  <For each={draft().headers}>
                    {(header, index) => (
                      <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                        <div style={{ flex: 1 }}>
                          <TextField
                            value={header.key}
                            placeholder="Header-Key"
                            onChange={(value) => updateHeaderRow(index(), "key", value)}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            value={header.value}
                            placeholder="Header-Value"
                            onChange={(value) => updateHeaderRow(index(), "value", value)}
                          />
                        </div>
                        <IconButton
                          size="small"
                          variant="ghost"
                          icon="close"
                          onClick={() => removeHeaderRow(index())}
                          disabled={draft().headers.length <= 1}
                        />
                      </div>
                    )}
                  </For>
                  <Button size="small" variant="ghost" onClick={addHeaderRow}>
                    {language.t("common.add")}
                  </Button>
                </div>
              </SettingsRow>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  "margin-top": "8px",
                }}
              >
                <span
                  style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}
                >
                  来源: {sourceLabel(selectedProfileSource())}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Show when={!connectedSet().has(draft().id) && !!providerCatalog()[draft().id]}>
                    <Button size="small" variant="secondary" onClick={() => connectProvider(draft().id)}>
                      {language.t("common.connect")}
                    </Button>
                  </Show>
                  <Show when={connectedSet().has(draft().id) && getProviderSource(draft().id) !== "env"}>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => void disconnectProvider(draft().id, draft().name)}
                    >
                      {language.t("common.disconnect")}
                    </Button>
                  </Show>
                  <Button size="small" onClick={saveEditor}>
                    {language.t("common.save")}
                  </Button>
                </div>
              </div>
            </Card>
          </>
        )}
      </Show>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.providers.section.connected")}
      </h4>
      <Card>
        <Show
          when={connectedProviders().length > 0}
          fallback={
            <div
              style={{
                "font-size": "12px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.providers.connected.empty")}
            </div>
          }
        >
          <For each={connectedProviders()}>
            {(item, index) => (
              <div
                style={{
                  padding: "10px 0",
                  "border-bottom":
                    index() < connectedProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <div
                  style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}
                >
                  <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
                    <span style={{ "font-size": "13px", "font-weight": 600, "white-space": "nowrap" }}>
                      {item.name}
                    </span>
                    <span
                      style={{
                        "font-size": "10px",
                        padding: "2px 6px",
                        "border-radius": "999px",
                        background: "var(--surface-base)",
                        border: "1px solid var(--border-weak-base)",
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        "text-transform": "uppercase",
                      }}
                    >
                      {sourceLabel(item.source)}
                    </span>
                    <Show when={item.disabled}>
                      <span
                        style={{
                          "font-size": "10px",
                          padding: "2px 6px",
                          "border-radius": "999px",
                          background: "var(--surface-warning-soft, rgba(255, 196, 0, 0.1))",
                          color: "var(--vscode-descriptionForeground)",
                        }}
                      >
                        {language.t("settings.providers.disabled")}
                      </span>
                    </Show>
                  </div>
                  <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-shrink": 0 }}>
                    <Button size="small" variant="secondary" onClick={() => openEditor(item.id)}>
                      {language.t("common.edit")}
                    </Button>
                    <Show when={item.source !== "env"}>
                      <Button size="small" variant="ghost" onClick={() => void disconnectProvider(item.id, item.name)}>
                        {language.t("common.disconnect")}
                      </Button>
                    </Show>
                  </div>
                </div>
                <Show when={item.noteKey}>
                  {(noteKey) => (
                    <div
                      style={{
                        "margin-top": "4px",
                        "font-size": "11px",
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                      }}
                    >
                      {language.t(noteKey())}
                    </div>
                  )}
                </Show>
              </div>
            )}
          </For>
        </Show>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.providers.section.popular")}
      </h4>
      <Card>
        <For each={popularProviderItems()}>
          {(item, index) => (
            <div
              style={{
                padding: "10px 0",
                "border-bottom":
                  index() < popularProviderItems().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}>
                <div style={{ "min-width": 0 }}>
                  <div style={{ "font-size": "13px", "font-weight": 600 }}>{item.name}</div>
                  <Show when={item.noteKey}>
                    {(noteKey) => (
                      <div
                        style={{
                          "margin-top": "2px",
                          "font-size": "11px",
                          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        }}
                      >
                        {language.t(noteKey())}
                      </div>
                    )}
                  </Show>
                </div>
                <Button size="small" variant="secondary" onClick={() => connectProvider(item.id)}>
                  {language.t("common.connect")}
                </Button>
              </div>
            </div>
          )}
        </For>

        <div style={{ padding: "10px 0" }}>
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}>
            <div style={{ "min-width": 0 }}>
              <div style={{ "font-size": "13px", "font-weight": 600 }}>
                {language.t("settings.providers.tag.custom")}
              </div>
              <div
                style={{
                  "margin-top": "2px",
                  "font-size": "11px",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                OpenAI compatible provider
              </div>
            </div>
            <Button size="small" variant="secondary" onClick={addCustomProvider}>
              {language.t("common.connect")}
            </Button>
          </div>
        </div>
      </Card>

      <details style={{ "margin-top": "16px" }}>
        <summary style={{ cursor: "pointer", "font-size": "13px", "font-weight": 600 }}>高级筛选</summary>
        <div style={{ display: "grid", gap: "12px", "margin-top": "8px" }}>
          <Card>
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "padding-bottom": "8px",
                "border-bottom": "1px solid var(--border-weak-base)",
              }}
            >
              {language.t("settings.providers.disabled.description")}
            </div>
            <div
              style={{
                display: "flex",
                gap: "8px",
                "align-items": "center",
                padding: "8px 0",
                "border-bottom": disabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <div style={{ flex: 1 }}>
                <Select
                  options={providerOptions().filter((o) => !disabledProviders().includes(o.value))}
                  current={newDisabled()}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(o) => setNewDisabled(o)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                  placeholder="Select provider..."
                />
              </div>
              <Button
                size="small"
                onClick={() => {
                  if (newDisabled()) {
                    addToList("disabled_providers", newDisabled()!.value)
                    setNewDisabled(undefined)
                  }
                }}
              >
                {language.t("common.add")}
              </Button>
            </div>
            <For each={disabledProviders()}>
              {(id, index) => (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    padding: "6px 0",
                    "border-bottom":
                      index() < disabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                  }}
                >
                  <span style={{ "font-size": "12px" }}>{id}</span>
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    onClick={() => removeFromList("disabled_providers", index())}
                  />
                </div>
              )}
            </For>
          </Card>

          <Card>
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "padding-bottom": "8px",
                "border-bottom": "1px solid var(--border-weak-base)",
              }}
            >
              {language.t("settings.providers.enabled.description")}
            </div>
            <div
              style={{
                display: "flex",
                gap: "8px",
                "align-items": "center",
                padding: "8px 0",
                "border-bottom": enabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <div style={{ flex: 1 }}>
                <Select
                  options={providerOptions().filter((o) => !enabledProviders().includes(o.value))}
                  current={newEnabled()}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(o) => setNewEnabled(o)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                  placeholder="Select provider..."
                />
              </div>
              <Button
                size="small"
                onClick={() => {
                  if (newEnabled()) {
                    addToList("enabled_providers", newEnabled()!.value)
                    setNewEnabled(undefined)
                  }
                }}
              >
                {language.t("common.add")}
              </Button>
            </div>
            <For each={enabledProviders()}>
              {(id, index) => (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    padding: "6px 0",
                    "border-bottom":
                      index() < enabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                  }}
                >
                  <span style={{ "font-size": "12px" }}>{id}</span>
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    onClick={() => removeFromList("enabled_providers", index())}
                  />
                </div>
              )}
            </For>
          </Card>
        </div>
      </details>
    </div>
  )
}

export default ProvidersTab



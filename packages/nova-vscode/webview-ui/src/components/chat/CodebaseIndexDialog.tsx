import { Component, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@novacode/nova-ui/button"
import { Card } from "@novacode/nova-ui/card"
import { Select } from "@novacode/nova-ui/select"
import { Switch } from "@novacode/nova-ui/switch"
import { TextField } from "@novacode/nova-ui/text-field"
import { showToast } from "@novacode/nova-ui/toast"
import { ConfigScopeProvider, useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"

interface CodebaseIndexDialogProps {
  scopeID: string
}

interface SelectOption {
  value: string
  label: string
}

const EMBEDDING_PROVIDER_OPTIONS: SelectOption[] = [
  { value: "openai_compatible", label: "OpenAI Compatible" },
  { value: "azure_openai", label: "Azure OpenAI" },
  { value: "local", label: "Local" },
]

const VECTOR_PROVIDER_OPTIONS: SelectOption[] = [
  { value: "qdrant", label: "Qdrant" },
  { value: "chroma", label: "Chroma" },
  { value: "faiss", label: "FAISS" },
]

const CodebaseIndexDialogInner: Component<CodebaseIndexDialogProps> = (props) => {
  const configStore = useConfig()
  const language = useLanguage()
  const vscode = useVSCode()

  const [search, setSearch] = createSignal("")
  const [indexStatus, setIndexStatus] = createSignal<"idle" | "indexing" | "error">("idle")
  const [indexedFiles, setIndexedFiles] = createSignal(0)
  const [totalFiles, setTotalFiles] = createSignal(0)
  const [lastUpdated, setLastUpdated] = createSignal<string | undefined>(undefined)
  const [currentFile, setCurrentFile] = createSignal("")

  const scopedConfig = createMemo(() => configStore.config())
  const indexConfig = createMemo(() => scopedConfig().experimental?.codebaseIndex ?? {})
  const isDirty = createMemo(() => configStore.hasScopedDraft(props.scopeID))

  const normalizeInteger = (value: string): number | undefined => {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const normalizeFloat = (value: string): number | undefined => {
    const parsed = Number.parseFloat(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const updateIndexConfig = (partial: Record<string, unknown>) => {
    configStore.updateConfig({
      experimental: {
        ...(scopedConfig().experimental ?? {}),
        codebaseIndex: {
          ...(indexConfig() ?? {}),
          ...partial,
        },
      },
    })
  }

  const requestStatus = () => vscode.postMessage({ type: "requestCodebaseIndexStatus" })
  const startReindex = () => vscode.postMessage({ type: "reindexCodebase" })
  const clearIndex = () => vscode.postMessage({ type: "clearCodebaseIndex" })

  // novacode_change start — URL normalization for embedding endpoint + test connection
  const [embeddingTestStatus, setEmbeddingTestStatus] = createSignal<"idle" | "testing" | "success" | "error">("idle")
  const [embeddingTestError, setEmbeddingTestError] = createSignal("")

  /**
   * Normalize embedding base URL:
   * - Strip trailing slashes
   * - For OpenAI-compatible: ensure it ends with /v1 if it doesn't already have a /v* path
   */
  const normalizeEmbeddingUrl = (url: string): string => {
    if (!url) return url
    let normalized = url.trim().replace(/\/+$/, "")
    // If the URL has no /v* path segment, append /v1 (OpenAI convention)
    if (!/\/v\d/.test(normalized) && !normalized.endsWith("/embeddings")) {
      normalized += "/v1"
    }
    return normalized
  }

  const requestModelsFromExtension = (baseUrl: string, apiKey: string) =>
    new Promise<{ models: string[]; error?: string }>((resolve) => {
      const requestId = `embedding-models-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      let settled = false

      const finish = (result: { models: string[]; error?: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        unsubscribe()
        resolve(result)
      }

      const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
        if (message.type !== "openAiModels") return
        if (message.requestId !== requestId) return
        finish({
          models: Array.isArray(message.openAiModels) ? message.openAiModels : [],
          error: message.error,
        })
      })

      const timeout = setTimeout(() => {
        finish({ models: [], error: "Request timeout (15s)" })
      }, 16000)

      vscode.postMessage({
        type: "requestOpenAiModels",
        baseUrl,
        apiKey,
        requestId,
      })
    })

  /** Test the embedding endpoint by trying to list models */
  const testEmbeddingConnection = async () => {
    const rawUrl = indexConfig().embeddingBaseURL ?? ""
    if (!rawUrl) {
      showToast({ variant: "error", title: language.t("settings.codebaseIndex.embedding.testNoUrl") })
      return
    }
    setEmbeddingTestStatus("testing")
    setEmbeddingTestError("")
    try {
      const normalizedUrl = normalizeEmbeddingUrl(rawUrl)
      const apiKey = indexConfig().embeddingApiKey ?? ""
      const result = await requestModelsFromExtension(normalizedUrl, apiKey)
      const models = result.models
      if (!result.error && models.length > 0) {
        setEmbeddingTestStatus("success")
        setEmbeddingTestError("")
        showToast({
          variant: "success",
          title: language.t("settings.codebaseIndex.embedding.testSuccess", { count: String(models.length) }),
        })
        // Auto-normalize the URL in config if the test succeeds
        if (normalizedUrl !== rawUrl) {
          updateIndexConfig({ embeddingBaseURL: normalizedUrl })
        }
      } else {
        setEmbeddingTestStatus("error")
        const err = result.error ?? "No models returned"
        setEmbeddingTestError(err)
        showToast({ variant: "error", title: language.t("settings.codebaseIndex.embedding.testFailed"), description: err.slice(0, 200) })
      }
    } catch (err: unknown) {
      setEmbeddingTestStatus("error")
      const msg = err instanceof Error ? err.message : String(err)
      setEmbeddingTestError(msg)
      showToast({ variant: "error", title: language.t("settings.codebaseIndex.embedding.testFailed"), description: msg.slice(0, 200) })
    }
  }
  // novacode_change end

  const save = () => {
    if (!isDirty()) return
    // Normalize the embedding URL on save
    const rawUrl = indexConfig().embeddingBaseURL
    if (rawUrl) {
      const normalizedUrl = normalizeEmbeddingUrl(rawUrl)
      if (normalizedUrl !== rawUrl) {
        updateIndexConfig({ embeddingBaseURL: normalizedUrl })
      }
    }
    configStore.saveScopedConfig(props.scopeID)
    showToast({ variant: "success", title: language.t("settings.save.toast.title") })
  }

  const discard = () => {
    if (!isDirty()) return
    configStore.discardScopedConfig(props.scopeID)
    showToast({ variant: "success", title: language.t("settings.providers.revert.toast.title") })
  }

  const shouldShow = (...keywords: string[]) => {
    const query = search().trim().toLowerCase()
    if (!query) return true
    return keywords.some((key) => key.toLowerCase().includes(query))
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "codebaseIndexStatus") {
      setIndexStatus(message.status)
      setIndexedFiles(message.indexedFiles)
      setTotalFiles(message.totalFiles)
      setLastUpdated(message.lastUpdated)
      return
    }
    if (message.type === "codebaseIndexProgress") {
      setIndexStatus(message.status)
      setIndexedFiles(message.indexedFiles)
      setTotalFiles(message.totalFiles)
      setCurrentFile(message.currentFile ?? "")
      if (message.status === "idle") {
        setLastUpdated(new Date().toISOString())
      }
    }
  })

  onMount(() => requestStatus())
  onCleanup(unsubscribe)

  const progressPercent = () => {
    const total = totalFiles()
    if (total <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((indexedFiles() / total) * 100)))
  }

  return (
    <div style={{ display: "grid", gap: "12px", width: "min(720px, 92vw)" }}>
      <div style={{ display: "flex", gap: "8px", "align-items": "center", "justify-content": "space-between" }}>
        <div style={{ flex: 1 }}>
          <TextField
            value={search()}
            placeholder={language.t("common.search.placeholder")}
            onChange={setSearch}
          />
        </div>
        <Button size="small" variant="ghost" onClick={discard} disabled={!isDirty()}>
          {language.t("settings.providers.revert")}
        </Button>
        <Button size="small" onClick={save} disabled={!isDirty()}>
          {language.t("common.save")}
        </Button>
      </div>

      <Card>
        <div style={{ display: "grid", gap: "8px" }}>
          <Switch
            checked={indexConfig().enabled ?? true}
            onChange={(checked) => updateIndexConfig({ enabled: checked })}
            hideLabel
          >
            {language.t("prompt.action.codebaseIndex")}
          </Switch>
          <div style={{ "font-size": "12px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
            {language.t("settings.codebaseIndex.status")}: {indexStatus()} | {indexedFiles()} / {totalFiles()}
          </div>
          <Show when={lastUpdated()}>
            <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
              {language.t("settings.codebaseIndex.lastUpdated")}: {lastUpdated()}
            </div>
          </Show>
          <div style={{ height: "8px", background: "var(--vscode-editorWidget-border, rgba(128,128,128,0.2))", "border-radius": "999px", overflow: "hidden" }}>
            <div
              style={{
                width: `${progressPercent()}%`,
                height: "100%",
                background: indexStatus() === "error" ? "#ef4444" : "#3b82f6",
                transition: "width 150ms ease",
              }}
            />
          </div>
          <Show when={currentFile()}>
            <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
              {currentFile()}
            </div>
          </Show>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button size="small" onClick={startReindex}>
              {language.t("settings.codebaseIndex.start")}
            </Button>
            <Button size="small" variant="ghost" onClick={clearIndex}>
              {language.t("settings.codebaseIndex.clear")}
            </Button>
            <Button size="small" variant="ghost" onClick={requestStatus}>
              {language.t("settings.codebaseIndex.refresh")}
            </Button>
          </div>
        </div>
      </Card>

      <Show when={shouldShow("embedding", "provider", "url", "api", "model", "dimension", "batch")}>
        <Card>
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ "font-weight": 600 }}>{language.t("settings.codebaseIndex.embedding.title")}</div>
            <Select
              options={EMBEDDING_PROVIDER_OPTIONS}
              current={EMBEDDING_PROVIDER_OPTIONS.find((option) => option.value === (indexConfig().embeddingProvider ?? "openai_compatible"))}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && updateIndexConfig({ embeddingProvider: option.value })}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
            <TextField
              value={indexConfig().embeddingBaseURL ?? ""}
              placeholder="https://api.openai.com/v1"
              onChange={(value) => updateIndexConfig({ embeddingBaseURL: value.trim() || undefined })}
            />
            <TextField
              type="password"
              value={indexConfig().embeddingApiKey ?? ""}
              placeholder="API Key"
              onChange={(value) => updateIndexConfig({ embeddingApiKey: value.trim() || undefined })}
            />
            <TextField
              value={indexConfig().embeddingModel ?? ""}
              placeholder="text-embedding-3-small"
              onChange={(value) => updateIndexConfig({ embeddingModel: value.trim() || undefined })}
            />
            <TextField
              value={String(indexConfig().embeddingDimensions ?? 1536)}
              onChange={(value) => updateIndexConfig({ embeddingDimensions: normalizeInteger(value) })}
            />
            <TextField
              value={String(indexConfig().embeddingBatchSize ?? 60)}
              onChange={(value) => updateIndexConfig({ embeddingBatchSize: normalizeInteger(value) })}
            />
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <Button size="small" variant="ghost" onClick={testEmbeddingConnection} disabled={embeddingTestStatus() === "testing" || !indexConfig().embeddingBaseURL}>
                {embeddingTestStatus() === "testing" ? language.t("settings.providers.model.loading") : language.t("settings.codebaseIndex.embedding.testButton")}
              </Button>
              <Show when={embeddingTestStatus() === "success"}>
                <span style={{ "font-size": "11px", color: "#22c55e" }}>✓ {language.t("settings.codebaseIndex.embedding.testOk")}</span>
              </Show>
              <Show when={embeddingTestStatus() === "error"}>
                <span style={{ "font-size": "11px", color: "#ef4444" }}>✗ {embeddingTestError().slice(0, 80)}</span>
              </Show>
            </div>
          </div>
        </Card>
      </Show>

      <Show when={shouldShow("vector", "qdrant", "store", "threshold", "results", "retry")}>
        <Card>
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ "font-weight": 600 }}>{language.t("settings.codebaseIndex.vector.title")}</div>
            <Select
              options={VECTOR_PROVIDER_OPTIONS}
              current={VECTOR_PROVIDER_OPTIONS.find((option) => option.value === (indexConfig().vectorProvider ?? "qdrant"))}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && updateIndexConfig({ vectorProvider: option.value })}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
            <TextField
              value={indexConfig().vectorURL ?? ""}
              placeholder="http://localhost:6333"
              onChange={(value) => updateIndexConfig({ vectorURL: value.trim() || undefined })}
            />
            <TextField
              type="password"
              value={indexConfig().vectorApiKey ?? ""}
              placeholder="Vector API Key"
              onChange={(value) => updateIndexConfig({ vectorApiKey: value.trim() || undefined })}
            />
            <TextField
              value={String(indexConfig().scoreThreshold ?? 0.75)}
              onChange={(value) => updateIndexConfig({ scoreThreshold: normalizeFloat(value) })}
            />
            <TextField
              value={String(indexConfig().maxResults ?? 50)}
              onChange={(value) => updateIndexConfig({ maxResults: normalizeInteger(value) })}
            />
            <TextField
              value={String(indexConfig().maxRetryBatch ?? 3)}
              onChange={(value) => updateIndexConfig({ maxRetryBatch: normalizeInteger(value) })}
            />
          </div>
        </Card>
      </Show>
    </div>
  )
}

export const CodebaseIndexDialog: Component<CodebaseIndexDialogProps> = (props) => {
  return (
    <ConfigScopeProvider scopeID={props.scopeID}>
      <CodebaseIndexDialogInner scopeID={props.scopeID} />
    </ConfigScopeProvider>
  )
}

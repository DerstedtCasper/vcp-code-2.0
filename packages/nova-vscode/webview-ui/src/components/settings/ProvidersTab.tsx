import { Component, For, createSignal, createMemo, Show } from "solid-js"
import { Select } from "@novacode/nova-ui/select"
import { Card } from "@novacode/nova-ui/card"
import { Button } from "@novacode/nova-ui/button"
import { IconButton } from "@novacode/nova-ui/icon-button"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useLanguage } from "../../context/language"
import { ModelSelectorBase } from "../chat/ModelSelector"
import type { ModelSelection, ProviderConfig } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface ProviderOption {
  value: string
  label: string
}

/** Parse a "provider/model" config string into a ModelSelection (or null). */
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

const ProvidersTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()

  const providerOptions = createMemo<ProviderOption[]>(() =>
    Object.keys(provider.providers())
      .sort()
      .map((id) => ({ value: id, label: id })),
  )

  const [newDisabled, setNewDisabled] = createSignal<ProviderOption | undefined>()
  const [newEnabled, setNewEnabled] = createSignal<ProviderOption | undefined>()

  // ── Provider API Configuration ──────────────────────────────────────
  const [selectedProvider, setSelectedProvider] = createSignal<ProviderOption | undefined>()
  const [apiKeyInput, setApiKeyInput] = createSignal("")
  const [baseUrlInput, setBaseUrlInput] = createSignal("")
  const [showApiKey, setShowApiKey] = createSignal(false)

  // When provider selection changes, populate fields from config
  const onProviderSelect = (opt: ProviderOption | undefined) => {
    setSelectedProvider(opt)
    if (opt) {
      const provCfg = config().provider?.[opt.value]
      setApiKeyInput(provCfg?.api_key ?? provCfg?.options?.apiKey ?? "")
      setBaseUrlInput(provCfg?.base_url ?? provCfg?.options?.baseURL ?? "")
    } else {
      setApiKeyInput("")
      setBaseUrlInput("")
    }
    setShowApiKey(false)
  }

  const saveProviderConfig = () => {
    const prov = selectedProvider()
    if (!prov) return
    const patch: ProviderConfig = {}
    const key = apiKeyInput().trim()
    const url = baseUrlInput().trim()
    if (key) patch.api_key = key
    if (url) patch.base_url = url
    updateConfig({ provider: { [prov.value]: patch } })
  }

  // List of providers that already have config
  const configuredProviders = createMemo(() => {
    const provCfg = config().provider ?? {}
    return Object.entries(provCfg)
      .filter(([, v]) => v.api_key || v.base_url || v.options?.apiKey || v.options?.baseURL)
      .map(([id, v]) => ({
        id,
        hasKey: !!(v.api_key || v.options?.apiKey),
        hasUrl: !!(v.base_url || v.options?.baseURL),
      }))
  })

  const disabledProviders = () => config().disabled_providers ?? []
  const enabledProviders = () => config().enabled_providers ?? []

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
      {/* Provider API Configuration */}
      <h4 style={{ "margin-bottom": "8px" }}>提供商 API 配置</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          选择提供商并配置 API Key 和 Base URL，用于连接 AI 模型服务。
        </div>
        <div style={{ padding: "8px 0", display: "grid", gap: "8px" }}>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <div style={{ flex: 1 }}>
              <Select
                options={providerOptions()}
                current={selectedProvider()}
                value={(o) => o.value}
                label={(o) => o.label}
                onSelect={onProviderSelect}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                placeholder="选择提供商…"
              />
            </div>
          </div>
          <Show when={selectedProvider()}>
            <div style={{ display: "grid", gap: "6px" }}>
              <div>
                <label style={{ "font-size": "11px", "font-weight": "500", display: "block", "margin-bottom": "4px" }}>
                  API Key
                </label>
                <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                  <input
                    type={showApiKey() ? "text" : "password"}
                    value={apiKeyInput()}
                    onInput={(e) => setApiKeyInput(e.currentTarget.value)}
                    placeholder="sk-..."
                    style={{
                      flex: "1",
                      padding: "4px 8px",
                      "font-size": "12px",
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                      background: "var(--vscode-input-background)",
                      color: "var(--vscode-input-foreground)",
                      border: "1px solid var(--vscode-input-border, var(--border-base))",
                      "border-radius": "4px",
                      outline: "none",
                    }}
                  />
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon={showApiKey() ? "eye-closed" : "eye"}
                    onClick={() => setShowApiKey(!showApiKey())}
                  />
                </div>
              </div>
              <div>
                <label style={{ "font-size": "11px", "font-weight": "500", display: "block", "margin-bottom": "4px" }}>
                  Base URL <span style={{ "font-weight": "normal", opacity: "0.6" }}>(可选)</span>
                </label>
                <input
                  type="text"
                  value={baseUrlInput()}
                  onInput={(e) => setBaseUrlInput(e.currentTarget.value)}
                  placeholder="https://api.openai.com/v1"
                  style={{
                    width: "100%",
                    padding: "4px 8px",
                    "font-size": "12px",
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    background: "var(--vscode-input-background)",
                    color: "var(--vscode-input-foreground)",
                    border: "1px solid var(--vscode-input-border, var(--border-base))",
                    "border-radius": "4px",
                    outline: "none",
                    "box-sizing": "border-box",
                  }}
                />
              </div>
              <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "4px" }}>
                <Button size="small" onClick={saveProviderConfig}>
                  保存配置
                </Button>
              </div>
            </div>
          </Show>
        </div>

        {/* Already configured providers summary */}
        <Show when={configuredProviders().length > 0}>
          <div
            style={{
              "border-top": "1px solid var(--border-weak-base)",
              "padding-top": "8px",
              "margin-top": "4px",
            }}
          >
            <div style={{ "font-size": "11px", "font-weight": "500", "margin-bottom": "6px" }}>已配置的提供商</div>
            <For each={configuredProviders()}>
              {(item) => (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    padding: "4px 0",
                    "font-size": "12px",
                  }}
                >
                  <span>{item.id}</span>
                  <span style={{ "font-size": "10px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                    {item.hasKey ? "🔑" : ""} {item.hasUrl ? "🔗" : ""}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Card>

      {/* Model selection */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>模型选择</h4>
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

      {/* Disabled providers */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.disabled")}</h4>
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
              placeholder="Select provider…"
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

      {/* Enabled providers (allowlist) */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.enabled")}</h4>
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
              placeholder="Select provider…"
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
                "border-bottom": index() < enabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
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
  )
}

export default ProvidersTab

import { Component, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Switch } from "@novacode/nova-ui/switch"
import { Button } from "@novacode/nova-ui/button"
import { Card } from "@novacode/nova-ui/card"
import { showToast } from "@novacode/nova-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { BrowserSettings } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const BrowserTab: Component = () => {
  const { postMessage, onMessage } = useVSCode()
  const { t } = useLanguage()

  const [settings, setSettings] = createSignal<BrowserSettings>({
    enabled: false,
    useSystemChrome: true,
    headless: false,
  })
  const [saved, setSaved] = createSignal<BrowserSettings>({
    enabled: false,
    useSystemChrome: true,
    headless: false,
  })

  onMount(() => {
    postMessage({ type: "requestBrowserSettings" })
  })

  // Subscribe outside onMount to catch early pushes (per AGENTS.md pattern)
  const unsubscribe = onMessage((msg) => {
    if (msg.type === "browserSettingsLoaded") {
      setSettings(msg.settings)
      setSaved(msg.settings)
    }
  })
  onCleanup(unsubscribe)

  const isDirty = createMemo(() => JSON.stringify(settings()) !== JSON.stringify(saved()))

  const update = (key: keyof BrowserSettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const save = () => {
    if (!isDirty()) return
    const next = settings()
    postMessage({ type: "updateSetting", key: "browserAutomation.enabled", value: next.enabled })
    postMessage({ type: "updateSetting", key: "browserAutomation.useSystemChrome", value: next.useSystemChrome })
    postMessage({ type: "updateSetting", key: "browserAutomation.headless", value: next.headless })
    setSaved(next)
    showToast({ variant: "success", title: t("settings.save.toast.title") })
  }

  const discard = () => setSettings(saved())

  onMount(() => {
    const onSave = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab
      if (tab !== "browser") return
      save()
    }
    window.addEventListener("vcp-settings-save", onSave as EventListener)
    onCleanup(() => window.removeEventListener("vcp-settings-save", onSave as EventListener))
  })

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      {/* Info text */}
      <div
        style={{
          background: "var(--vscode-textBlockQuote-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          padding: "12px 16px",
        }}
      >
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
            "line-height": "1.5",
          }}
        >
          {t("settings.browser.description")}
        </p>
      </div>

      <Card>
        {/* Enable toggle */}
        <SettingsRow title={t("settings.browser.enable.title")} description={t("settings.browser.enable.description")}>
          <Switch checked={settings().enabled} onChange={(checked: boolean) => update("enabled", checked)} hideLabel>
            {t("settings.browser.enable.title")}
          </Switch>
        </SettingsRow>

        {/* Use System Chrome */}
        <SettingsRow
          title={t("settings.browser.systemChrome.title")}
          description={t("settings.browser.systemChrome.description")}
        >
          <Switch
            checked={settings().useSystemChrome}
            onChange={(checked: boolean) => update("useSystemChrome", checked)}
            hideLabel
          >
            {t("settings.browser.systemChrome.title")}
          </Switch>
        </SettingsRow>

        {/* Headless mode */}
        <SettingsRow
          title={t("settings.browser.headless.title")}
          description={t("settings.browser.headless.description")}
          last
        >
          <Switch checked={settings().headless} onChange={(checked: boolean) => update("headless", checked)} hideLabel>
            {t("settings.browser.headless.title")}
          </Switch>
        </SettingsRow>
      </Card>
      <Show when={isDirty()}>
        <div class="sticky-save-bar">
          <div class="sticky-save-bar-hint">{t("settings.providers.unsaved")}</div>
          <div class="sticky-save-bar-actions">
            <Button size="small" variant="ghost" onClick={discard}>
              {t("settings.providers.revert")}
            </Button>
            <Button size="small" onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default BrowserTab

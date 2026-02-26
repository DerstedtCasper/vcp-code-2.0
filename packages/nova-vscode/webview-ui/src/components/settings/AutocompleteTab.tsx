import { Component, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Switch } from "@novacode/nova-ui/switch"
import { Button } from "@novacode/nova-ui/button"
import { Card } from "@novacode/nova-ui/card"
import { showToast } from "@novacode/nova-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const AutocompleteTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [enableAutoTrigger, setEnableAutoTrigger] = createSignal(true)
  const [enableSmartInlineTaskKeybinding, setEnableSmartInlineTaskKeybinding] = createSignal(false)
  const [enableChatAutocomplete, setEnableChatAutocomplete] = createSignal(false)
  const [saved, setSaved] = createSignal({
    enableAutoTrigger: true,
    enableSmartInlineTaskKeybinding: false,
    enableChatAutocomplete: false,
  })

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "autocompleteSettingsLoaded") {
      return
    }
    setEnableAutoTrigger(message.settings.enableAutoTrigger)
    setEnableSmartInlineTaskKeybinding(message.settings.enableSmartInlineTaskKeybinding)
    setEnableChatAutocomplete(message.settings.enableChatAutocomplete)
    setSaved(message.settings)
  })

  onCleanup(unsubscribe)

  vscode.postMessage({ type: "requestAutocompleteSettings" })

  const updateSetting = (
    key: "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete",
    value: boolean,
  ) => {
    if (key === "enableAutoTrigger") setEnableAutoTrigger(value)
    if (key === "enableSmartInlineTaskKeybinding") setEnableSmartInlineTaskKeybinding(value)
    if (key === "enableChatAutocomplete") setEnableChatAutocomplete(value)
  }

  const isDirty = createMemo(() => {
    const prev = saved()
    return (
      prev.enableAutoTrigger !== enableAutoTrigger() ||
      prev.enableSmartInlineTaskKeybinding !== enableSmartInlineTaskKeybinding() ||
      prev.enableChatAutocomplete !== enableChatAutocomplete()
    )
  })

  const save = () => {
    if (!isDirty()) return
    vscode.postMessage({ type: "updateAutocompleteSetting", key: "enableAutoTrigger", value: enableAutoTrigger() })
    vscode.postMessage({
      type: "updateAutocompleteSetting",
      key: "enableSmartInlineTaskKeybinding",
      value: enableSmartInlineTaskKeybinding(),
    })
    vscode.postMessage({
      type: "updateAutocompleteSetting",
      key: "enableChatAutocomplete",
      value: enableChatAutocomplete(),
    })
    setSaved({
      enableAutoTrigger: enableAutoTrigger(),
      enableSmartInlineTaskKeybinding: enableSmartInlineTaskKeybinding(),
      enableChatAutocomplete: enableChatAutocomplete(),
    })
    showToast({ variant: "success", title: language.t("settings.save.toast.title") })
  }

  const discard = () => {
    const prev = saved()
    setEnableAutoTrigger(prev.enableAutoTrigger)
    setEnableSmartInlineTaskKeybinding(prev.enableSmartInlineTaskKeybinding)
    setEnableChatAutocomplete(prev.enableChatAutocomplete)
  }

  onMount(() => {
    const onSave = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab
      if (tab !== "autocomplete") return
      save()
    }
    window.addEventListener("vcp-settings-save", onSave as EventListener)
    onCleanup(() => window.removeEventListener("vcp-settings-save", onSave as EventListener))
  })

  return (
    <div data-component="autocomplete-settings">
      <Card>
        <SettingsRow
          title={language.t("settings.autocomplete.autoTrigger.title")}
          description={language.t("settings.autocomplete.autoTrigger.description")}
        >
          <Switch
            checked={enableAutoTrigger()}
            onChange={(checked) => updateSetting("enableAutoTrigger", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.autoTrigger.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.smartKeybinding.title")}
          description={language.t("settings.autocomplete.smartKeybinding.description")}
        >
          <Switch
            checked={enableSmartInlineTaskKeybinding()}
            onChange={(checked) => updateSetting("enableSmartInlineTaskKeybinding", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.smartKeybinding.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.chatAutocomplete.title")}
          description={language.t("settings.autocomplete.chatAutocomplete.description")}
          last
        >
          <Switch
            checked={enableChatAutocomplete()}
            onChange={(checked) => updateSetting("enableChatAutocomplete", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.chatAutocomplete.title")}
          </Switch>
        </SettingsRow>
      </Card>
      <Show when={isDirty()}>
        <div class="sticky-save-bar">
          <div class="sticky-save-bar-hint">{language.t("settings.providers.unsaved")}</div>
          <div class="sticky-save-bar-actions">
            <Button size="small" variant="ghost" onClick={discard}>
              {language.t("settings.providers.revert")}
            </Button>
            <Button size="small" onClick={save}>
              {language.t("common.save")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default AutocompleteTab

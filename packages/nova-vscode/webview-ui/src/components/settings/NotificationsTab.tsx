import { Component, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Switch } from "@novacode/nova-ui/switch"
import { Select } from "@novacode/nova-ui/select"
import { Button } from "@novacode/nova-ui/button"
import { Card } from "@novacode/nova-ui/card"
import { showToast } from "@novacode/nova-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface SoundOption {
  value: string
  labelKey: string
}

const SOUND_OPTIONS: SoundOption[] = [
  { value: "default", labelKey: "settings.notifications.sound.default" },
  { value: "none", labelKey: "settings.notifications.sound.none" },
]

const NotificationsTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [agentNotify, setAgentNotify] = createSignal(true)
  const [permNotify, setPermNotify] = createSignal(true)
  const [errorNotify, setErrorNotify] = createSignal(true)
  const [agentSound, setAgentSound] = createSignal("default")
  const [permSound, setPermSound] = createSignal("default")
  const [errorSound, setErrorSound] = createSignal("default")
  const [saved, setSaved] = createSignal({
    notifyAgent: true,
    notifyPermissions: true,
    notifyErrors: true,
    soundAgent: "default",
    soundPermissions: "default",
    soundErrors: "default",
  })

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "notificationSettingsLoaded") {
      return
    }
    const s = message.settings
    setAgentNotify(s.notifyAgent)
    setPermNotify(s.notifyPermissions)
    setErrorNotify(s.notifyErrors)
    setAgentSound(s.soundAgent)
    setPermSound(s.soundPermissions)
    setErrorSound(s.soundErrors)
    setSaved(s)
  })

  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestNotificationSettings" })

  const postSetting = (key: string, value: unknown) => {
    vscode.postMessage({ type: "updateSetting", key, value })
  }

  const isDirty = createMemo(() => {
    const prev = saved()
    return (
      prev.notifyAgent !== agentNotify() ||
      prev.notifyPermissions !== permNotify() ||
      prev.notifyErrors !== errorNotify() ||
      prev.soundAgent !== agentSound() ||
      prev.soundPermissions !== permSound() ||
      prev.soundErrors !== errorSound()
    )
  })

  const save = () => {
    if (!isDirty()) return
    postSetting("notifications.agent", agentNotify())
    postSetting("notifications.permissions", permNotify())
    postSetting("notifications.errors", errorNotify())
    postSetting("sounds.agent", agentSound())
    postSetting("sounds.permissions", permSound())
    postSetting("sounds.errors", errorSound())
    setSaved({
      notifyAgent: agentNotify(),
      notifyPermissions: permNotify(),
      notifyErrors: errorNotify(),
      soundAgent: agentSound(),
      soundPermissions: permSound(),
      soundErrors: errorSound(),
    })
    showToast({ variant: "success", title: language.t("settings.save.toast.title") })
  }

  const discard = () => {
    const prev = saved()
    setAgentNotify(prev.notifyAgent)
    setPermNotify(prev.notifyPermissions)
    setErrorNotify(prev.notifyErrors)
    setAgentSound(prev.soundAgent)
    setPermSound(prev.soundPermissions)
    setErrorSound(prev.soundErrors)
  }

  onMount(() => {
    const onSave = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab
      if (tab !== "notifications") return
      save()
    }
    window.addEventListener("vcp-settings-save", onSave as EventListener)
    onCleanup(() => window.removeEventListener("vcp-settings-save", onSave as EventListener))
  })

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.notifications.agent.title")}
          description={language.t("settings.notifications.agent.description")}
        >
          <Switch
            checked={agentNotify()}
            onChange={(checked) => {
              setAgentNotify(checked)
            }}
            hideLabel
          >
            {language.t("settings.notifications.agent.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.notifications.permissions.title")}
          description={language.t("settings.notifications.permissions.description")}
        >
          <Switch
            checked={permNotify()}
            onChange={(checked) => {
              setPermNotify(checked)
            }}
            hideLabel
          >
            {language.t("settings.notifications.permissions.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.notifications.errors.title")}
          description={language.t("settings.notifications.errors.description")}
          last
        >
          <Switch
            checked={errorNotify()}
            onChange={(checked) => {
              setErrorNotify(checked)
            }}
            hideLabel
          >
            {language.t("settings.notifications.errors.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.notifications.sounds")}</h4>
      <Card>
        <SettingsRow
          title={language.t("settings.notifications.agentSound.title")}
          description={language.t("settings.notifications.agentSound.description")}
        >
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === agentSound())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (o) {
                setAgentSound(o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.notifications.permSound.title")}
          description={language.t("settings.notifications.permSound.description")}
        >
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === permSound())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (o) {
                setPermSound(o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.notifications.errorSound.title")}
          description={language.t("settings.notifications.errorSound.description")}
          last
        >
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === errorSound())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (o) {
                setErrorSound(o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
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

export default NotificationsTab

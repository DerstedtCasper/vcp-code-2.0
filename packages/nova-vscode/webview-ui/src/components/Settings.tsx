import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@novacode/nova-ui/button"
import { Icon } from "@novacode/nova-ui/icon"
import { Tabs } from "@novacode/nova-ui/tabs"
import { Tooltip } from "@novacode/nova-ui/tooltip"
import { TextField } from "@novacode/nova-ui/text-field"
import { showToast } from "@novacode/nova-ui/toast"
import { useLanguage } from "../context/language"
import ProvidersTab from "./settings/ProvidersTab"
import AgentBehaviourTab from "./settings/AgentBehaviourTab"
import AutoApproveTab from "./settings/AutoApproveTab"
import BrowserTab from "./settings/BrowserTab"
import CheckpointsTab from "./settings/CheckpointsTab"
import DisplayTab from "./settings/DisplayTab"
import AutocompleteTab from "./settings/AutocompleteTab"
import NotificationsTab from "./settings/NotificationsTab"
import ContextTab from "./settings/ContextTab"
import TerminalTab from "./settings/TerminalTab"
import PromptsTab from "./settings/PromptsTab"
import ExperimentalTab from "./settings/ExperimentalTab"
import LanguageTab from "./settings/LanguageTab"
import AboutVCPCodeTab from "./settings/AboutVCPCodeTab"
import { useServer } from "../context/server"
import { ConfigScopeProvider, useConfig } from "../context/config"

export interface SettingsProps {
  onBack?: () => void
  initialTab?: string
}

interface ScopedSettingsPaneProps {
  tab: string
  scopeID: string
  children: any
}

const ScopedSettingsPaneBody: Component<{ tab: string; scopeID: string; children: any }> = (props) => {
  const language = useLanguage()
  const config = useConfig()

  onMount(() => {
    const onSave = (event: Event) => {
      const custom = event as CustomEvent<{ tab?: string }>
      if (custom.detail?.tab !== props.tab) return
      if (!config.hasScopedDraft(props.scopeID)) return
      config.saveScopedConfig(props.scopeID)
      showToast({ variant: "success", title: language.t("settings.save.toast.title") })
    }
    window.addEventListener("vcp-settings-save", onSave as EventListener)
    onCleanup(() => window.removeEventListener("vcp-settings-save", onSave as EventListener))
  })

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      {props.children}
      <Show when={config.hasScopedDraft(props.scopeID)}>
        <div class="sticky-save-bar">
          <div class="sticky-save-bar-hint">{language.t("settings.providers.unsaved")}</div>
          <div class="sticky-save-bar-actions">
            <Button size="small" variant="ghost" onClick={() => config.discardScopedConfig(props.scopeID)}>
              {language.t("settings.providers.revert")}
            </Button>
            <Button size="small" onClick={() => config.saveScopedConfig(props.scopeID)}>
              {language.t("settings.providers.save")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

const ScopedSettingsPane: Component<ScopedSettingsPaneProps> = (props) => {
  return (
    <ConfigScopeProvider scopeID={props.scopeID}>
      <ScopedSettingsPaneBody tab={props.tab} scopeID={props.scopeID}>
        {props.children}
      </ScopedSettingsPaneBody>
    </ConfigScopeProvider>
  )
}

const Settings: Component<SettingsProps> = (props) => {
  const server = useServer()
  const language = useLanguage()
  const [activeTab, setActiveTab] = createSignal(props.initialTab ?? "providers")
  const [search, setSearch] = createSignal("")

  const tabItems = createMemo(() => [
    { id: "providers", icon: "providers", label: language.t("settings.providers.title") },
    { id: "vcpConfig", icon: "settings-gear", label: language.t("settings.vcp.title") },
    { id: "agentBehaviour", icon: "brain", label: language.t("settings.agentBehaviour.title") },
    { id: "autoApprove", icon: "checklist", label: language.t("settings.autoApprove.title") },
    { id: "browser", icon: "window-cursor", label: language.t("settings.browser.title") },
    { id: "checkpoints", icon: "branch", label: language.t("settings.checkpoints.title") },
    { id: "display", icon: "eye", label: language.t("settings.display.title") },
    { id: "autocomplete", icon: "code-lines", label: language.t("settings.autocomplete.title") },
    { id: "notifications", icon: "circle-check", label: language.t("settings.notifications.title") },
    { id: "context", icon: "server", label: language.t("settings.context.title") },
    { id: "terminal", icon: "console", label: language.t("settings.terminal.title") },
    { id: "prompts", icon: "comment", label: language.t("settings.prompts.title") },
    { id: "experimental", icon: "settings-gear", label: language.t("settings.experimental.title") },
    { id: "language", icon: "speech-bubble", label: language.t("settings.language.title") },
    { id: "aboutVCPCode", icon: "help", label: language.t("settings.aboutVCPCode.title") },
  ])

  const visibleTabs = createMemo(() => {
    const query = search().trim().toLowerCase()
    if (!query) return tabItems()
    return tabItems().filter((tab) => tab.label.toLowerCase().includes(query) || tab.id.toLowerCase().includes(query))
  })

  createEffect(() => {
    if (!props.initialTab) return
    setActiveTab(props.initialTab)
  })

  createEffect(() => {
    const ids = visibleTabs().map((tab) => tab.id)
    if (ids.length === 0) return
    if (!ids.includes(activeTab())) {
      setActiveTab(ids[0]!)
    }
  })

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": "1px solid var(--border-weak-base)",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}
      >
        <Tooltip value={language.t("common.goBack")} placement="bottom">
          <Button variant="ghost" size="small" onClick={() => props.onBack?.()}>
            <Icon name="arrow-left" />
          </Button>
        </Tooltip>
        <h2 style={{ "font-size": "16px", "font-weight": "600", margin: 0 }}>{language.t("sidebar.settings")}</h2>
        <div style={{ flex: 1 }} />
        <div style={{ width: "220px" }}>
          <TextField
            value={search()}
            placeholder={language.t("common.search.placeholder")}
            onChange={setSearch}
          />
        </div>
        <Button
          size="small"
          onClick={() => {
            const tab = activeTab()
            window.dispatchEvent(
              new CustomEvent("vcp-settings-save", {
                detail: { tab },
              }),
            )
          }}
        >
          {language.t("common.save")}
        </Button>
      </div>

      {/* Settings tabs */}
      <Tabs
        orientation="vertical"
        variant="settings"
        value={activeTab()}
        onChange={(value: string) => setActiveTab(value)}
        style={{ flex: 1, overflow: "hidden" }}
      >
        <Tabs.List>
          <For each={visibleTabs()}>
            {(tab) => (
              <Tabs.Trigger value={tab.id}>
                <Icon name={tab.icon} />
                {tab.label}
              </Tabs.Trigger>
            )}
          </For>
        </Tabs.List>

        <Tabs.Content value="providers">
          <h3>{language.t("settings.providers.title")}</h3>
          <ProvidersTab />
        </Tabs.Content>
        <Tabs.Content value="vcpConfig">
          <h3>{language.t("settings.vcp.title")}</h3>
          <AgentBehaviourTab pinnedSubtab="vcp" />
        </Tabs.Content>
        <Tabs.Content value="agentBehaviour">
          <h3>{language.t("settings.agentBehaviour.title")}</h3>
          <AgentBehaviourTab />
        </Tabs.Content>
        <Tabs.Content value="autoApprove">
          <h3>{language.t("settings.autoApprove.title")}</h3>
          <ScopedSettingsPane tab="autoApprove" scopeID="settings.autoApprove">
            <AutoApproveTab />
          </ScopedSettingsPane>
        </Tabs.Content>
        <Tabs.Content value="browser">
          <h3>{language.t("settings.browser.title")}</h3>
          <BrowserTab />
        </Tabs.Content>
        <Tabs.Content value="checkpoints">
          <h3>{language.t("settings.checkpoints.title")}</h3>
          <ScopedSettingsPane tab="checkpoints" scopeID="settings.checkpoints">
            <CheckpointsTab />
          </ScopedSettingsPane>
        </Tabs.Content>
        <Tabs.Content value="display">
          <h3>{language.t("settings.display.title")}</h3>
          <ScopedSettingsPane tab="display" scopeID="settings.display">
            <DisplayTab />
          </ScopedSettingsPane>
        </Tabs.Content>
        <Tabs.Content value="autocomplete">
          <h3>{language.t("settings.autocomplete.title")}</h3>
          <AutocompleteTab />
        </Tabs.Content>
        <Tabs.Content value="notifications">
          <h3>{language.t("settings.notifications.title")}</h3>
          <NotificationsTab />
        </Tabs.Content>
        <Tabs.Content value="context">
          <h3>{language.t("settings.context.title")}</h3>
          <ScopedSettingsPane tab="context" scopeID="settings.context">
            <ContextTab />
          </ScopedSettingsPane>
        </Tabs.Content>
        <Tabs.Content value="terminal">
          <h3>{language.t("settings.terminal.title")}</h3>
          <ScopedSettingsPane tab="terminal" scopeID="settings.terminal">
            <TerminalTab />
          </ScopedSettingsPane>
        </Tabs.Content>
        <Tabs.Content value="prompts">
          <h3>{language.t("settings.prompts.title")}</h3>
          <ScopedSettingsPane tab="prompts" scopeID="settings.prompts">
            <PromptsTab />
          </ScopedSettingsPane>
        </Tabs.Content>
        <Tabs.Content value="experimental">
          <h3>{language.t("settings.experimental.title")}</h3>
          <ScopedSettingsPane tab="experimental" scopeID="settings.experimental">
            <ExperimentalTab />
          </ScopedSettingsPane>
        </Tabs.Content>
        <Tabs.Content value="language">
          <h3>{language.t("settings.language.title")}</h3>
          <LanguageTab />
        </Tabs.Content>
        <Tabs.Content value="aboutVCPCode">
          <h3>{language.t("settings.aboutVCPCode.title")}</h3>
          <AboutVCPCodeTab
            port={server.serverInfo()?.port ?? null}
            connectionState={server.connectionState()}
            extensionVersion={server.extensionVersion()}
          />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

export default Settings

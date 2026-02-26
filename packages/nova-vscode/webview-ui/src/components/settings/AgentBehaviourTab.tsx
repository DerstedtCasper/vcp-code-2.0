import { Component, createSignal, createMemo, createEffect, For, Show, onCleanup, onMount } from "solid-js"
import { Select } from "@novacode/nova-ui/select"
import { TextField } from "@novacode/nova-ui/text-field"
import { Card } from "@novacode/nova-ui/card"
import { Button } from "@novacode/nova-ui/button"
import { IconButton } from "@novacode/nova-ui/icon-button"
import { Switch } from "@novacode/nova-ui/switch"
import { Accordion } from "@novacode/nova-ui/accordion"
import { showToast } from "@novacode/nova-ui/toast"

import { ConfigScopeProvider, useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { AgentConfig, Config, ExtensionMessage, SkillInfo, VcpConfig, ProviderConfig } from "../../types/messages"
import WorkflowsEditor from "./WorkflowsEditor"

type SubtabId = "agents" | "mcpServers" | "vcp" | "rules" | "workflows" | "skills"

interface SubtabConfig {
  id: SubtabId
  labelKey: string
}

interface AgentBehaviourTabProps {
  pinnedSubtab?: SubtabId
}

const subtabs: SubtabConfig[] = [
  { id: "agents", labelKey: "settings.agentBehaviour.subtab.agents" },
  { id: "mcpServers", labelKey: "settings.agentBehaviour.subtab.mcpServers" },
  { id: "vcp", labelKey: "settings.agentBehaviour.subtab.vcp" },
  { id: "rules", labelKey: "settings.agentBehaviour.subtab.rules" },
  { id: "workflows", labelKey: "settings.agentBehaviour.subtab.workflows" },
  { id: "skills", labelKey: "settings.agentBehaviour.subtab.skills" },
]

interface SelectOption {
  value: string
  label: string
}

import SettingsRow from "./SettingsRow"

const AgentBehaviourTab: Component<AgentBehaviourTabProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const configStore = useConfig()
  const session = useSession()
  const [activeSubtab, setActiveSubtab] = createSignal<SubtabId>(props.pinnedSubtab ?? "agents")
  const [subtabSearch, setSubtabSearch] = createSignal("")
  const [selectedAgent, setSelectedAgent] = createSignal<string>("")
  const [newSkillPath, setNewSkillPath] = createSignal("")
  const [newSkillUrl, setNewSkillUrl] = createSignal("")
  const [newInstruction, setNewInstruction] = createSignal("")
  const [loadedSkills, setLoadedSkills] = createSignal<SkillInfo[]>([])
  const [skillsLoading, setSkillsLoading] = createSignal(true)
  const scopeID = createMemo(() => `settings.agentBehaviour.${props.pinnedSubtab ?? activeSubtab()}`)
  const scopedConfig = createMemo(() => configStore.getScopedConfig(scopeID()))
  const stageConfig = (partial: Partial<Config>) => configStore.updateScopedConfig(scopeID(), partial)
  const isDirty = createMemo(() => configStore.hasScopedDraft(scopeID()))

  const saveCurrentScope = () => {
    if (!isDirty()) return
    configStore.saveScopedConfig(scopeID())
    showToast({ variant: "success", title: language.t("settings.save.toast.title") })
  }

  const discardCurrentScope = () => {
    if (!isDirty()) return
    configStore.discardScopedConfig(scopeID())
    showToast({ variant: "success", title: language.t("settings.providers.revert.toast.title") })
  }

  createEffect(() => {
    if (!props.pinnedSubtab) return
    setActiveSubtab(props.pinnedSubtab)
  })

  const visibleSubtabs = createMemo(() => {
    if (props.pinnedSubtab) {
      return subtabs.filter((tab) => tab.id === props.pinnedSubtab)
    }
    const query = subtabSearch().trim().toLowerCase()
    if (!query) return subtabs
    return subtabs.filter(
      (tab) =>
        tab.id.toLowerCase().includes(query) ||
        language.t(tab.labelKey).toLowerCase().includes(query),
    )
  })

  createEffect(() => {
    const ids = visibleSubtabs().map((tab) => tab.id)
    if (ids.length === 0) return
    if (!ids.includes(activeSubtab())) {
      setActiveSubtab(ids[0]!)
    }
  })

  const unsubscribeSkills = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "skillsLoaded") return
    setLoadedSkills(message.skills)
    setSkillsLoading(false)
  })

  onCleanup(unsubscribeSkills)

  onMount(() => {
    let retries = 0
    const maxRetries = 5
    const retryMs = 500

    vscode.postMessage({ type: "requestSkills" })

    const retryTimer = window.setInterval(() => {
      retries++
      if (!skillsLoading() || retries >= maxRetries) {
        window.clearInterval(retryTimer)
        return
      }
      vscode.postMessage({ type: "requestSkills" })
    }, retryMs)

    onCleanup(() => window.clearInterval(retryTimer))

    const onSave = (event: Event) => {
      const custom = event as CustomEvent<{ tab?: string }>
      const targetTab = custom.detail?.tab
      if (!targetTab) return
      const isAgentTab = targetTab === "agentBehaviour" && !props.pinnedSubtab
      const isPinnedVcpTab = targetTab === "vcpConfig" && props.pinnedSubtab === "vcp"
      if (!isAgentTab && !isPinnedVcpTab) return
      saveCurrentScope()
    }
    window.addEventListener("vcp-settings-save", onSave as EventListener)
    onCleanup(() => window.removeEventListener("vcp-settings-save", onSave as EventListener))
  })

  const agentNames = createMemo(() => {
    const names = session.agents().map((a) => a.name)
    // Also include any agents from config that might not be in the agent list
    const configAgents = Object.keys(scopedConfig().agent ?? {})
    for (const name of configAgents) {
      if (!names.includes(name)) {
        names.push(name)
      }
    }
    return names.sort()
  })

  const defaultAgentOptions = createMemo<SelectOption[]>(() => [
    { value: "", label: language.t("common.default") },
    ...agentNames().map((name) => ({ value: name, label: name })),
  ])

  const agentSelectorOptions = createMemo<SelectOption[]>(() => [
    { value: "", label: language.t("settings.agentBehaviour.selectAgent") },
    ...agentNames().map((name) => ({ value: name, label: name })),
  ])

  const currentAgentConfig = createMemo<AgentConfig>(() => {
    const name = selectedAgent()
    if (!name) {
      return {}
    }
    return scopedConfig().agent?.[name] ?? {}
  })

  const updateAgentConfig = (name: string, partial: Partial<AgentConfig>) => {
    const existing = scopedConfig().agent ?? {}
    const current = existing[name] ?? {}
    stageConfig({
      agent: {
        ...existing,
        [name]: { ...current, ...partial },
      },
    })
  }

  const instructions = () => scopedConfig().instructions ?? []

  const addInstruction = () => {
    const value = newInstruction().trim()
    if (!value) {
      return
    }
    const current = [...instructions()]
    if (!current.includes(value)) {
      current.push(value)
      stageConfig({ instructions: current })
    }
    setNewInstruction("")
  }

  const removeInstruction = (index: number) => {
    const current = [...instructions()]
    current.splice(index, 1)
    stageConfig({ instructions: current })
  }

  const skillPaths = () => scopedConfig().skills?.paths ?? []
  const skillUrls = () => scopedConfig().skills?.urls ?? []

  const addSkillPath = () => {
    const value = newSkillPath().trim()
    if (!value) {
      return
    }
    const current = [...skillPaths()]
    if (!current.includes(value)) {
      current.push(value)
      stageConfig({ skills: { ...scopedConfig().skills, paths: current } })
    }
    setNewSkillPath("")
  }

  const removeSkillPath = (index: number) => {
    const current = [...skillPaths()]
    current.splice(index, 1)
    stageConfig({ skills: { ...scopedConfig().skills, paths: current } })
  }

  const addSkillUrl = () => {
    const value = newSkillUrl().trim()
    if (!value) {
      return
    }
    const current = [...skillUrls()]
    if (!current.includes(value)) {
      current.push(value)
      stageConfig({ skills: { ...scopedConfig().skills, urls: current } })
    }
    setNewSkillUrl("")
  }

  const removeSkillUrl = (index: number) => {
    const current = [...skillUrls()]
    current.splice(index, 1)
    stageConfig({ skills: { ...scopedConfig().skills, urls: current } })
  }

  const renderAgentsSubtab = () => (
    <div>
      <Card style={{ "margin-bottom": "12px" }}>
        <SettingsRow
          title={language.t("settings.vcp.agentTeam.title")}
          description={language.t("settings.vcp.agentTeam.description")}
          last
        >
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <Switch
              checked={scopedConfig().vcp?.agentTeam?.enabled ?? false}
              onChange={(checked) =>
                stageConfig({
                  vcp: {
                    ...(scopedConfig().vcp ?? {}),
                    agentTeam: {
                      ...(scopedConfig().vcp?.agentTeam ?? {}),
                      enabled: checked,
                    },
                  },
                })
              }
              hideLabel
            >
              {language.t("settings.vcp.agentTeam.title")}
            </Switch>
            <Button size="small" variant="ghost" onClick={() => setActiveSubtab("vcp")}>
              {language.t("settings.vcp.title")}
            </Button>
          </div>
        </SettingsRow>
      </Card>

      {/* Default agent */}
      <Card style={{ "margin-bottom": "12px" }}>
        <SettingsRow
          title={language.t("settings.agentBehaviour.defaultAgent.title")}
          description={language.t("settings.agentBehaviour.defaultAgent.description")}
          last
        >
          <Select
            options={defaultAgentOptions()}
            current={defaultAgentOptions().find((o) => o.value === (scopedConfig().default_agent ?? ""))}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => o && stageConfig({ default_agent: o.value || undefined })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
      </Card>

      {/* Agent selector */}
      <div style={{ "margin-bottom": "12px" }}>
        <Select
          options={agentSelectorOptions()}
          current={agentSelectorOptions().find((o) => o.value === selectedAgent())}
          value={(o) => o.value}
          label={(o) => o.label}
          onSelect={(o) => o && setSelectedAgent(o.value)}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </div>

      <Show when={selectedAgent()}>
        <Card>
          {/* Model override */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.modelOverride.title")}
            description={language.t("settings.agentBehaviour.modelOverride.description")}
          >
            <TextField
              value={currentAgentConfig().model ?? ""}
              placeholder="e.g. anthropic/claude-sonnet-4-20250514"
              onChange={(val) =>
                updateAgentConfig(selectedAgent(), {
                  model: val.trim() || undefined,
                })
              }
            />
          </SettingsRow>

          {/* System prompt */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.prompt.title")}
            description={language.t("settings.agentBehaviour.prompt.description")}
          >
            <TextField
              value={currentAgentConfig().prompt ?? ""}
              placeholder="Custom instructions…"
              multiline
              onChange={(val) =>
                updateAgentConfig(selectedAgent(), {
                  prompt: val.trim() || undefined,
                })
              }
            />
          </SettingsRow>

          {/* Temperature */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.temperature.title")}
            description={language.t("settings.agentBehaviour.temperature.description")}
          >
            <TextField
              value={currentAgentConfig().temperature?.toString() ?? ""}
              placeholder={language.t("common.default")}
              onChange={(val) => {
                const parsed = parseFloat(val)
                updateAgentConfig(selectedAgent(), { temperature: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingsRow>

          {/* Top-p */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.topP.title")}
            description={language.t("settings.agentBehaviour.topP.description")}
          >
            <TextField
              value={currentAgentConfig().top_p?.toString() ?? ""}
              placeholder={language.t("common.default")}
              onChange={(val) => {
                const parsed = parseFloat(val)
                updateAgentConfig(selectedAgent(), { top_p: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingsRow>

          {/* Max steps */}
          <SettingsRow
            title={language.t("settings.agentBehaviour.maxSteps.title")}
            description={language.t("settings.agentBehaviour.maxSteps.description")}
            last
          >
            <TextField
              value={currentAgentConfig().steps?.toString() ?? ""}
              placeholder={language.t("common.default")}
              onChange={(val) => {
                const parsed = parseInt(val, 10)
                updateAgentConfig(selectedAgent(), { steps: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingsRow>
        </Card>
      </Show>
    </div>
  )

  const renderMcpSubtab = () => {
    const mcpEntries = createMemo(() => Object.entries(scopedConfig().mcp ?? {}))

    return (
      <div>
        <Show
          when={mcpEntries().length > 0}
          fallback={
            <Card>
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                {language.t("settings.agentBehaviour.mcpEmpty")}
              </div>
            </Card>
          }
        >
          <Card>
            <For each={mcpEntries()}>
              {([name, mcp], index) => (
                <div
                  style={{
                    padding: "8px 0",
                    "border-bottom": index() < mcpEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                  }}
                >
                  <div style={{ "font-weight": "500" }}>{name}</div>
                  <div
                    style={{
                      "font-size": "11px",
                      color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                      "margin-top": "4px",
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                    }}
                  >
                    <Show when={mcp.command}>
                      <div>
                        command: {mcp.command} {(mcp.args ?? []).join(" ")}
                      </div>
                    </Show>
                    <Show when={mcp.url}>
                      <div>url: {mcp.url}</div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Card>
        </Show>
      </div>
    )
  }

  const renderVcpSubtab = () => {
    const vcp = createMemo<VcpConfig>(() => scopedConfig().vcp ?? {})
    const contextFold = createMemo(() => vcp().contextFold ?? {})
    const vcpInfo = createMemo(() => vcp().vcpInfo ?? {})
    const html = createMemo(() => vcp().html ?? {})
    const toolRequest = createMemo(() => vcp().toolRequest ?? {})
    const agentTeam = createMemo(() => vcp().agentTeam ?? {})
    const foldStyleOptions: SelectOption[] = [
      { value: "details", label: "details" },
      { value: "plain", label: "plain" },
    ]
    const bridgeModeOptions: SelectOption[] = [
      { value: "execute", label: "execute" },
      { value: "event", label: "event" },
    ]
    const waveStrategyOptions: SelectOption[] = [
      { value: "auto", label: "auto" },
      { value: "conservative", label: "conservative" },
      { value: "aggressive", label: "aggressive" },
    ]
    const handoffFormatOptions: SelectOption[] = [
      { value: "summary", label: "summary" },
      { value: "checklist", label: "checklist" },
    ]

    const updateVcp = (partial: Partial<VcpConfig>) => {
      stageConfig({
        vcp: {
          ...vcp(),
          ...partial,
        },
      })
    }

    const updateContextFold = (partial: Partial<NonNullable<VcpConfig["contextFold"]>>) => {
      updateVcp({
        contextFold: {
          ...contextFold(),
          ...partial,
        },
      })
    }

    const updateVcpInfo = (partial: Partial<NonNullable<VcpConfig["vcpInfo"]>>) => {
      updateVcp({
        vcpInfo: {
          ...vcpInfo(),
          ...partial,
        },
      })
    }

    const updateToolRequest = (partial: Partial<NonNullable<VcpConfig["toolRequest"]>>) => {
      updateVcp({
        toolRequest: {
          ...toolRequest(),
          ...partial,
        },
      })
    }

    const updateAgentTeam = (partial: Partial<NonNullable<VcpConfig["agentTeam"]>>) => {
      updateVcp({
        agentTeam: {
          ...agentTeam(),
          ...partial,
        },
      })
    }

    const normalizeInput = (value: string): string | undefined => {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : undefined
    }

    const normalizeInteger = (value: string): number | undefined => {
      const trimmed = value.trim()
      if (!trimmed) return undefined
      const parsed = Number.parseInt(trimmed, 10)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    }

    const parseCsvList = (value: string): string[] | undefined => {
      const items = value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      return items.length > 0 ? items : undefined
    }

    const showVcpSwitchToast = (keyPrefix: string, enabled: boolean) => {
      showToast({
        variant: "success",
        title: language.t(`${keyPrefix}.toast.${enabled ? "enabled" : "disabled"}`),
      })
    }

    // novacode_change start - VCP Bridge WebSocket config (replaces duplicate provider fields)
    const vcpConfig = createMemo(() => (scopedConfig() as any).vcp ?? {})
    const toolboxConfig = createMemo(() => vcpConfig().toolbox ?? {})
    const updateToolboxConfig = (partial: Record<string, unknown>) => {
      const current = vcpConfig()
      stageConfig({
        vcp: {
          ...current,
          toolbox: {
            ...(current.toolbox ?? {}),
            ...partial,
          },
        },
      } as any)
    }
    // novacode_change end

    return (
      <div>
        <Accordion multiple defaultValue={["vcp-basic", "vcp-memory", "vcp-toolbox"]}>
          <Accordion.Item value="vcp-basic">
            <Accordion.Header>
              <Accordion.Trigger>{language.t("settings.vcp.group.basic")}</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Card style={{ "margin-bottom": "12px" }}>
          <SettingsRow
            title={language.t("settings.vcp.enabled.title")}
            description={language.t("settings.vcp.enabled.description")}
          >
            <Switch
              checked={vcp().enabled ?? false}
              onChange={(checked) => {
                updateVcp({ enabled: checked })
                showVcpSwitchToast("settings.vcp.enabled", checked)
              }}
              hideLabel
            >
              {language.t("settings.vcp.enabled.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.contextFold.title")}
            description={language.t("settings.vcp.contextFold.description")}
          >
            <Switch
              checked={contextFold().enabled ?? true}
              onChange={(checked) => {
                updateContextFold({ enabled: checked })
                showVcpSwitchToast("settings.vcp.contextFold", checked)
              }}
              hideLabel
            >
              {language.t("settings.vcp.contextFold.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.contextFold.style.title")}
            description={language.t("settings.vcp.contextFold.style.description")}
          >
            <Select
              options={foldStyleOptions}
              current={foldStyleOptions.find((o) => o.value === (contextFold().outputStyle ?? "details"))}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => o && updateContextFold({ outputStyle: o.value as "details" | "plain" })}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.contextFold.startMarker.title")}
            description={language.t("settings.vcp.contextFold.startMarker.description")}
          >
            <TextField
              value={contextFold().startMarker ?? ""}
              placeholder="<<<[VCP_DYNAMIC_FOLD]>>>"
              onChange={(value) => updateContextFold({ startMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.contextFold.endMarker.title")}
            description={language.t("settings.vcp.contextFold.endMarker.description")}
          >
            <TextField
              value={contextFold().endMarker ?? ""}
              placeholder="<<<[END_VCP_DYNAMIC_FOLD]>>>"
              onChange={(value) => updateContextFold({ endMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow title={language.t("settings.vcp.vcpInfo.title")} description={language.t("settings.vcp.vcpInfo.description")}>
            <Switch
              checked={vcpInfo().enabled ?? true}
              onChange={(checked) => {
                updateVcpInfo({ enabled: checked })
                showVcpSwitchToast("settings.vcp.vcpInfo", checked)
              }}
              hideLabel
            >
              {language.t("settings.vcp.vcpInfo.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.vcpInfo.startMarker.title")}
            description={language.t("settings.vcp.vcpInfo.startMarker.description")}
          >
            <TextField
              value={vcpInfo().startMarker ?? ""}
              placeholder="<<<[VCPINFO]>>>"
              onChange={(value) => updateVcpInfo({ startMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.vcpInfo.endMarker.title")}
            description={language.t("settings.vcp.vcpInfo.endMarker.description")}
          >
            <TextField
              value={vcpInfo().endMarker ?? ""}
              placeholder="<<<[END_VCPINFO]>>>"
              onChange={(value) => updateVcpInfo({ endMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolRequest.title")}
            description={language.t("settings.vcp.toolRequest.description")}
          >
            <Switch
              checked={toolRequest().enabled ?? true}
              onChange={(checked) => {
                updateToolRequest({ enabled: checked })
                showVcpSwitchToast("settings.vcp.toolRequest", checked)
              }}
              hideLabel
            >
              {language.t("settings.vcp.toolRequest.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolRequest.bridgeMode.title")}
            description={language.t("settings.vcp.toolRequest.bridgeMode.description")}
          >
            <Select
              options={bridgeModeOptions}
              current={bridgeModeOptions.find((o) => o.value === (toolRequest().bridgeMode ?? "execute"))}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => o && updateToolRequest({ bridgeMode: o.value as "event" | "execute" })}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolRequest.maxPerMessage.title")}
            description={language.t("settings.vcp.toolRequest.maxPerMessage.description")}
          >
            <TextField
              value={toolRequest().maxPerMessage?.toString() ?? ""}
              placeholder="e.g. 3"
              onChange={(value) => updateToolRequest({ maxPerMessage: normalizeInteger(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolRequest.allowTools.title")}
            description={language.t("settings.vcp.toolRequest.allowTools.description")}
          >
            <TextField
              value={(toolRequest().allowTools ?? []).join(", ")}
              placeholder="search_memory, read, glob"
              onChange={(value) => updateToolRequest({ allowTools: parseCsvList(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolRequest.denyTools.title")}
            description={language.t("settings.vcp.toolRequest.denyTools.description")}
          >
            <TextField
              value={(toolRequest().denyTools ?? []).join(", ")}
              placeholder="bash"
              onChange={(value) => updateToolRequest({ denyTools: parseCsvList(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolRequest.keepInOutput.title")}
            description={language.t("settings.vcp.toolRequest.keepInOutput.description")}
          >
            <Switch
              checked={toolRequest().keepBlockInText ?? false}
              onChange={(checked) => {
                updateToolRequest({ keepBlockInText: checked })
                showVcpSwitchToast("settings.vcp.toolRequest.keepInOutput", checked)
              }}
              hideLabel
            >
              {language.t("settings.vcp.toolRequest.keepInOutput.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolRequest.startMarker.title")}
            description={language.t("settings.vcp.toolRequest.startMarker.description")}
          >
            <TextField
              value={toolRequest().startMarker ?? ""}
              placeholder="<<<[TOOL_REQUEST]>>>"
              onChange={(value) => updateToolRequest({ startMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolRequest.endMarker.title")}
            description={language.t("settings.vcp.toolRequest.endMarker.description")}
          >
            <TextField
              value={toolRequest().endMarker ?? ""}
              placeholder="<<<[END_TOOL_REQUEST]>>>"
              onChange={(value) => updateToolRequest({ endMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow title={language.t("settings.vcp.html.title")} description={language.t("settings.vcp.html.description")}>
            <Switch
              checked={html().enabled ?? true}
              onChange={(checked) => {
                updateVcp({ html: { ...html(), enabled: checked } })
                showVcpSwitchToast("settings.vcp.html", checked)
              }}
              hideLabel
            >
              {language.t("settings.vcp.html.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow title={language.t("settings.vcp.agentTeam.title")} description={language.t("settings.vcp.agentTeam.description")}>
            <Switch
              checked={agentTeam().enabled ?? false}
              onChange={(checked) => {
                updateAgentTeam({ enabled: checked })
                showVcpSwitchToast("settings.vcp.agentTeam", checked)
              }}
              hideLabel
            >
              {language.t("settings.vcp.agentTeam.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.agentTeam.maxParallel.title")}
            description={language.t("settings.vcp.agentTeam.maxParallel.description")}
          >
            <TextField
              value={agentTeam().maxParallel?.toString() ?? ""}
              placeholder="e.g. 3"
              onChange={(value) => updateAgentTeam({ maxParallel: normalizeInteger(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.agentTeam.waveStrategy.title")}
            description={language.t("settings.vcp.agentTeam.waveStrategy.description")}
          >
            <Select
              options={waveStrategyOptions}
              current={waveStrategyOptions.find((o) => o.value === (agentTeam().waveStrategy ?? "auto"))}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) =>
                o && updateAgentTeam({ waveStrategy: o.value as "auto" | "conservative" | "aggressive" })
              }
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.agentTeam.requireFileSeparation.title")}
            description={language.t("settings.vcp.agentTeam.requireFileSeparation.description")}
          >
            <Switch
              checked={agentTeam().requireFileSeparation ?? true}
              onChange={(checked) => {
                updateAgentTeam({ requireFileSeparation: checked })
                showVcpSwitchToast("settings.vcp.agentTeam.requireFileSeparation", checked)
              }}
              hideLabel
            >
              {language.t("settings.vcp.agentTeam.requireFileSeparation.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.agentTeam.handoffFormat.title")}
            description={language.t("settings.vcp.agentTeam.handoffFormat.description")}
            last
          >
            <Select
              options={handoffFormatOptions}
              current={handoffFormatOptions.find((o) => o.value === (agentTeam().handoffFormat ?? "summary"))}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => o && updateAgentTeam({ handoffFormat: o.value as "summary" | "checklist" })}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
              </Card>
            </Accordion.Content>
          </Accordion.Item>

          <Accordion.Item value="vcp-memory">
            <Accordion.Header>
              <Accordion.Trigger>{language.t("settings.vcp.group.memory")}</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Card style={{ "margin-bottom": "12px" }}>
                <div
                  style={{
                    "font-size": "12px",
                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                    "line-height": "1.5",
                  }}
                >
                  {language.t("settings.vcp.memory.migratedNote")}
                </div>
              </Card>
            </Accordion.Content>
          </Accordion.Item>

          <Accordion.Item value="vcp-toolbox">
            <Accordion.Header>
              <Accordion.Trigger>{language.t("settings.vcp.group.toolbox")}</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Card>
          {/* novacode_change start - WebSocket config only, removed duplicate provider fields */}
          <SettingsRow
            title={language.t("settings.vcp.toolbox.wsEnabled.title")}
            description={language.t("settings.vcp.toolbox.wsEnabled.description")}
          >
            <Switch
              checked={toolboxConfig().enabled ?? false}
              onChange={(checked) => updateToolboxConfig({ enabled: checked })}
              hideLabel
            >
              {language.t("settings.vcp.toolbox.wsEnabled.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolbox.wsUrl.title")}
            description={language.t("settings.vcp.toolbox.wsUrl.description")}
          >
            <TextField
              value={toolboxConfig().url ?? ""}
              placeholder="ws://localhost:5800"
              onChange={(value) => updateToolboxConfig({ url: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolbox.wsKey.title")}
            description={language.t("settings.vcp.toolbox.wsKey.description")}
          >
            <TextField
              type="password"
              value={toolboxConfig().key ?? ""}
              placeholder="VCP_Key"
              onChange={(value) => updateToolboxConfig({ key: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.vcp.toolbox.reconnectInterval.title")}
            description={language.t("settings.vcp.toolbox.reconnectInterval.description")}
            last
          >
            <TextField
              value={String(toolboxConfig().reconnectInterval ?? 5000)}
              placeholder="5000"
              onChange={(value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed >= 1000) {
                  updateToolboxConfig({ reconnectInterval: parsed })
                }
              }}
            />
          </SettingsRow>
          {/* novacode_change end */}
              </Card>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion>
      </div>
    )
  }

  const renderSkillsSubtab = () => (
    <div>
      {/* Loaded skills */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>
        {language.t("settings.agentBehaviour.loadedSkills")}
      </h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <Show
          when={!skillsLoading()}
          fallback={
            <div
              style={{
                "font-size": "12px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.agentBehaviour.skillsLoading")}
            </div>
          }
        >
          <Show
            when={loadedSkills().length > 0}
            fallback={
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                {language.t("settings.agentBehaviour.skillsEmpty")}
              </div>
            }
          >
            <For each={loadedSkills()}>
              {(skill, index) => (
                <div
                  style={{
                    padding: "8px 0",
                    "border-bottom": index() < loadedSkills().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                  }}
                >
                  <div style={{ "font-weight": "500" }}>{skill.name}</div>
                  <div
                    style={{
                      "font-size": "11px",
                      color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                      "margin-top": "2px",
                    }}
                  >
                    {skill.description}
                  </div>
                  <div
                    style={{
                      "font-size": "11px",
                      color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                      "margin-top": "2px",
                    }}
                  >
                    {skill.location}
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </Card>

      {/* Skill paths */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.skillPaths")}</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": skillPaths().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newSkillPath()}
              placeholder="e.g. ./skills"
              onChange={(val) => setNewSkillPath(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addSkillPath()
              }}
            />
          </div>
          <Button size="small" onClick={addSkillPath}>
            {language.t("common.add")}
          </Button>
        </div>
        <For each={skillPaths()}>
          {(path, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < skillPaths().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {path}
              </span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removeSkillPath(index())} />
            </div>
          )}
        </For>
      </Card>

      {/* Skill URLs */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.skillUrls")}</h4>
      <Card>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": skillUrls().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newSkillUrl()}
              placeholder="e.g. https://example.com/skills"
              onChange={(val) => setNewSkillUrl(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addSkillUrl()
              }}
            />
          </div>
          <Button size="small" onClick={addSkillUrl}>
            {language.t("common.add")}
          </Button>
        </div>
        <For each={skillUrls()}>
          {(url, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < skillUrls().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {url}
              </span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removeSkillUrl(index())} />
            </div>
          )}
        </For>
      </Card>
    </div>
  )

  const renderRulesSubtab = () => (
    <div>
      <Card>
        <div
          style={{
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          <div style={{ "font-weight": "500" }}>{language.t("settings.agentBehaviour.instructionFiles")}</div>
          <div
            style={{
              "font-size": "11px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-top": "2px",
            }}
          >
            {language.t("settings.agentBehaviour.instructionFiles.description")}
          </div>
        </div>

        {/* Add new instruction path */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": instructions().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newInstruction()}
              placeholder="e.g. ./INSTRUCTIONS.md"
              onChange={(val) => setNewInstruction(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addInstruction()
              }}
            />
          </div>
          <Button size="small" onClick={addInstruction}>
            {language.t("common.add")}
          </Button>
        </div>

        {/* Instructions list */}
        <For each={instructions()}>
          {(path, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < instructions().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {path}
              </span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removeInstruction(index())} />
            </div>
          )}
        </For>
      </Card>
    </div>
  )

  const renderSubtabContent = () => {
    switch (activeSubtab()) {
      case "agents":
        return renderAgentsSubtab()
      case "mcpServers":
        return renderMcpSubtab()
      case "vcp":
        return renderVcpSubtab()
      case "rules":
        return renderRulesSubtab()
      case "workflows":
        return (
          <ConfigScopeProvider scopeID={scopeID()}>
            <WorkflowsEditor />
          </ConfigScopeProvider>
        )
      case "skills":
        return renderSkillsSubtab()
      default:
        return null
    }
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "8px",
          "align-items": "center",
          "justify-content": "flex-end",
          "margin-bottom": "12px",
        }}
      >
        <Show when={!props.pinnedSubtab}>
          <div style={{ width: "220px" }}>
            <TextField
              value={subtabSearch()}
              placeholder={language.t("common.search.placeholder")}
              onChange={setSubtabSearch}
            />
          </div>
        </Show>
        <Button size="small" variant="ghost" onClick={discardCurrentScope} disabled={!isDirty()}>
          {language.t("settings.providers.revert")}
        </Button>
        <Button size="small" onClick={saveCurrentScope} disabled={!isDirty()}>
          {language.t("common.save")}
        </Button>
      </div>

      {/* Horizontal subtab bar */}
      <Show when={!props.pinnedSubtab}>
        <div
          style={{
            display: "flex",
            gap: "0",
            "border-bottom": "1px solid var(--vscode-panel-border)",
            "margin-bottom": "16px",
          }}
        >
          <For each={visibleSubtabs()}>
            {(subtab) => (
              <button
                onClick={() => setActiveSubtab(subtab.id)}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  background: "transparent",
                  color:
                    activeSubtab() === subtab.id ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                  "font-size": "13px",
                  "font-family": "var(--vscode-font-family)",
                  cursor: "pointer",
                  "border-bottom":
                    activeSubtab() === subtab.id ? "2px solid var(--vscode-foreground)" : "2px solid transparent",
                  "margin-bottom": "-1px",
                }}
                onMouseEnter={(e) => {
                  if (activeSubtab() !== subtab.id) {
                    e.currentTarget.style.color = "var(--vscode-foreground)"
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeSubtab() !== subtab.id) {
                    e.currentTarget.style.color = "var(--vscode-descriptionForeground)"
                  }
                }}
              >
                {language.t(subtab.labelKey)}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Subtab content */}
      {renderSubtabContent()}

      <Show when={isDirty()}>
        <div class="sticky-save-bar">
          <div class="sticky-save-bar-hint">{language.t("settings.providers.unsaved")}</div>
          <div class="sticky-save-bar-actions">
            <Button size="small" variant="ghost" onClick={discardCurrentScope}>
              {language.t("settings.providers.revert")}
            </Button>
            <Button size="small" onClick={saveCurrentScope}>
              {language.t("settings.providers.save")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default AgentBehaviourTab


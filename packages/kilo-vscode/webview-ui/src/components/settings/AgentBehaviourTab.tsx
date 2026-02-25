import { Component, createSignal, createMemo, For, Show, onCleanup, onMount, createEffect } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Switch } from "@kilocode/kilo-ui/switch"

import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { AgentConfig, ExtensionMessage, SkillInfo, VcpConfig, ProviderConfig } from "../../types/messages"
import WorkflowsEditor from "./WorkflowsEditor"

type SubtabId = "agents" | "mcpServers" | "vcp" | "rules" | "workflows" | "skills"

interface SubtabConfig {
  id: SubtabId
  labelKey: string
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

interface AgentBehaviourTabProps {
  initialSubtab?: SubtabId
  lockedSubtab?: SubtabId
}

const AgentBehaviourTab: Component<AgentBehaviourTabProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const { config, updateConfig } = useConfig()
  const session = useSession()
  const [activeSubtab, setActiveSubtab] = createSignal<SubtabId>(props.initialSubtab ?? props.lockedSubtab ?? "agents")
  const [selectedAgent, setSelectedAgent] = createSignal<string>("")
  const [newSkillPath, setNewSkillPath] = createSignal("")
  const [newSkillUrl, setNewSkillUrl] = createSignal("")
  const [newInstruction, setNewInstruction] = createSignal("")
  const [loadedSkills, setLoadedSkills] = createSignal<SkillInfo[]>([])
  const [skillsLoading, setSkillsLoading] = createSignal(true)

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
  })

  createEffect(() => {
    if (props.lockedSubtab) {
      setActiveSubtab(props.lockedSubtab)
      return
    }
    if (props.initialSubtab) {
      setActiveSubtab(props.initialSubtab)
    }
  })

  const agentNames = createMemo(() => {
    const names = session.agents().map((a) => a.name)
    // Also include any agents from config that might not be in the agent list
    const configAgents = Object.keys(config().agent ?? {})
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
    return config().agent?.[name] ?? {}
  })

  const updateAgentConfig = (name: string, partial: Partial<AgentConfig>) => {
    const existing = config().agent ?? {}
    const current = existing[name] ?? {}
    updateConfig({
      agent: {
        ...existing,
        [name]: { ...current, ...partial },
      },
    })
  }

  const instructions = () => config().instructions ?? []

  const addInstruction = () => {
    const value = newInstruction().trim()
    if (!value) {
      return
    }
    const current = [...instructions()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ instructions: current })
    }
    setNewInstruction("")
  }

  const removeInstruction = (index: number) => {
    const current = [...instructions()]
    current.splice(index, 1)
    updateConfig({ instructions: current })
  }

  const skillPaths = () => config().skills?.paths ?? []
  const skillUrls = () => config().skills?.urls ?? []

  const addSkillPath = () => {
    const value = newSkillPath().trim()
    if (!value) {
      return
    }
    const current = [...skillPaths()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ skills: { ...config().skills, paths: current } })
    }
    setNewSkillPath("")
  }

  const removeSkillPath = (index: number) => {
    const current = [...skillPaths()]
    current.splice(index, 1)
    updateConfig({ skills: { ...config().skills, paths: current } })
  }

  const addSkillUrl = () => {
    const value = newSkillUrl().trim()
    if (!value) {
      return
    }
    const current = [...skillUrls()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ skills: { ...config().skills, urls: current } })
    }
    setNewSkillUrl("")
  }

  const removeSkillUrl = (index: number) => {
    const current = [...skillUrls()]
    current.splice(index, 1)
    updateConfig({ skills: { ...config().skills, urls: current } })
  }

  const renderAgentsSubtab = () => (
    <div>
      {/* Default agent */}
      <Card style={{ "margin-bottom": "12px" }}>
        <SettingsRow
          title={language.t("settings.agentBehaviour.defaultAgent.title")}
          description={language.t("settings.agentBehaviour.defaultAgent.description")}
          last
        >
          <Select
            options={defaultAgentOptions()}
            current={defaultAgentOptions().find((o) => o.value === (config().default_agent ?? ""))}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => o && updateConfig({ default_agent: o.value || undefined })}
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
              placeholder={language.t("settings.agentBehaviour.modelOverride.placeholder")}
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
              placeholder={language.t("settings.agentBehaviour.prompt.placeholder")}
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
    const mcpEntries = createMemo(() => Object.entries(config().mcp ?? {}))

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
                        {language.t("settings.agentBehaviour.mcp.command")}: {mcp.command} {(mcp.args ?? []).join(" ")}
                      </div>
                    </Show>
                    <Show when={mcp.url}>
                      <div>{language.t("settings.agentBehaviour.mcp.url")}: {mcp.url}</div>
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
    const vcp = createMemo<VcpConfig>(() => config().vcp ?? {})
    const contextFold = createMemo(() => vcp().contextFold ?? {})
    const vcpInfo = createMemo(() => vcp().vcpInfo ?? {})
    const html = createMemo(() => vcp().html ?? {})
    const toolRequest = createMemo(() => vcp().toolRequest ?? {})
    const agentTeam = createMemo(() => vcp().agentTeam ?? {})
    const foldStyleOptions: SelectOption[] = [
      { value: "details", label: language.t("settings.agentBehaviour.vcp.contextFold.output.details") },
      { value: "plain", label: language.t("settings.agentBehaviour.vcp.contextFold.output.plain") },
    ]
    const bridgeModeOptions: SelectOption[] = [
      { value: "execute", label: language.t("settings.agentBehaviour.vcp.toolRequest.bridgeMode.execute") },
      { value: "event", label: language.t("settings.agentBehaviour.vcp.toolRequest.bridgeMode.event") },
    ]
    const waveStrategyOptions: SelectOption[] = [
      { value: "auto", label: language.t("settings.agentBehaviour.vcp.agentTeam.waveStrategy.auto") },
      { value: "conservative", label: language.t("settings.agentBehaviour.vcp.agentTeam.waveStrategy.conservative") },
      { value: "aggressive", label: language.t("settings.agentBehaviour.vcp.agentTeam.waveStrategy.aggressive") },
    ]
    const handoffFormatOptions: SelectOption[] = [
      { value: "summary", label: language.t("settings.agentBehaviour.vcp.agentTeam.handoffFormat.summary") },
      { value: "checklist", label: language.t("settings.agentBehaviour.vcp.agentTeam.handoffFormat.checklist") },
    ]

    const updateVcp = (partial: Partial<VcpConfig>) => {
      updateConfig({
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

    const vcptoolbox = createMemo<ProviderConfig>(() => (config().provider?.vcptoolbox as ProviderConfig) ?? {})
    const vcptoolboxOptions = createMemo<NonNullable<ProviderConfig["options"]>>(() => vcptoolbox().options ?? {})
    const updateVcptoolboxOptions = (partial: Partial<NonNullable<ProviderConfig["options"]>>) => {
      const providers = config().provider ?? {}
      const current = (providers.vcptoolbox as ProviderConfig) ?? {}
      const mergedProvider: ProviderConfig = {
        ...current,
        options: {
          ...(current.options ?? {}),
          ...partial,
        },
      }
      updateConfig({
        provider: {
          ...providers,
          vcptoolbox: mergedProvider,
        },
      })
    }

    return (
      <div>
        <Card style={{ "margin-bottom": "12px" }}>
          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.compat.title")}
            description={language.t("settings.agentBehaviour.vcp.compat.description")}
          >
            <Switch
              checked={vcp().enabled ?? false}
              onChange={(checked) => updateVcp({ enabled: checked })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.vcp.compat.label")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.contextFold.enabled.title")}
            description={language.t("settings.agentBehaviour.vcp.contextFold.enabled.description")}
          >
            <Switch
              checked={contextFold().enabled ?? true}
              onChange={(checked) => updateContextFold({ enabled: checked })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.vcp.contextFold.enabled.label")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.contextFold.output.title")}
            description={language.t("settings.agentBehaviour.vcp.contextFold.output.description")}
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
            title={language.t("settings.agentBehaviour.vcp.contextFold.startMarker.title")}
            description={language.t("settings.agentBehaviour.vcp.contextFold.startMarker.description")}
          >
            <TextField
              value={contextFold().startMarker ?? ""}
              placeholder="<<<[VCP_DYNAMIC_FOLD]>>>"
              onChange={(value) => updateContextFold({ startMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.contextFold.endMarker.title")}
            description={language.t("settings.agentBehaviour.vcp.contextFold.endMarker.description")}
          >
            <TextField
              value={contextFold().endMarker ?? ""}
              placeholder="<<<[END_VCP_DYNAMIC_FOLD]>>>"
              onChange={(value) => updateContextFold({ endMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.vcpInfo.enabled.title")}
            description={language.t("settings.agentBehaviour.vcp.vcpInfo.enabled.description")}
          >
            <Switch
              checked={vcpInfo().enabled ?? true}
              onChange={(checked) => updateVcpInfo({ enabled: checked })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.vcp.vcpInfo.enabled.label")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.vcpInfo.startMarker.title")}
            description={language.t("settings.agentBehaviour.vcp.vcpInfo.startMarker.description")}
          >
            <TextField
              value={vcpInfo().startMarker ?? ""}
              placeholder="<<<[VCPINFO]>>>"
              onChange={(value) => updateVcpInfo({ startMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.vcpInfo.endMarker.title")}
            description={language.t("settings.agentBehaviour.vcp.vcpInfo.endMarker.description")}
          >
            <TextField
              value={vcpInfo().endMarker ?? ""}
              placeholder="<<<[END_VCPINFO]>>>"
              onChange={(value) => updateVcpInfo({ endMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.toolRequest.enabled.title")}
            description={language.t("settings.agentBehaviour.vcp.toolRequest.enabled.description")}
          >
            <Switch
              checked={toolRequest().enabled ?? true}
              onChange={(checked) => updateToolRequest({ enabled: checked })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.vcp.toolRequest.enabled.label")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.toolRequest.bridgeMode.title")}
            description={language.t("settings.agentBehaviour.vcp.toolRequest.bridgeMode.description")}
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
            title={language.t("settings.agentBehaviour.vcp.toolRequest.maxPerMessage.title")}
            description={language.t("settings.agentBehaviour.vcp.toolRequest.maxPerMessage.description")}
          >
            <TextField
              value={toolRequest().maxPerMessage?.toString() ?? ""}
              placeholder={language.t("settings.agentBehaviour.vcp.toolRequest.maxPerMessage.placeholder")}
              onChange={(value) => updateToolRequest({ maxPerMessage: normalizeInteger(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.toolRequest.allowTools.title")}
            description={language.t("settings.agentBehaviour.vcp.toolRequest.allowTools.description")}
          >
            <TextField
              value={(toolRequest().allowTools ?? []).join(", ")}
              placeholder={language.t("settings.agentBehaviour.vcp.toolRequest.allowTools.placeholder")}
              onChange={(value) => updateToolRequest({ allowTools: parseCsvList(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.toolRequest.denyTools.title")}
            description={language.t("settings.agentBehaviour.vcp.toolRequest.denyTools.description")}
          >
            <TextField
              value={(toolRequest().denyTools ?? []).join(", ")}
              placeholder={language.t("settings.agentBehaviour.vcp.toolRequest.denyTools.placeholder")}
              onChange={(value) => updateToolRequest({ denyTools: parseCsvList(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.toolRequest.keepInOutput.title")}
            description={language.t("settings.agentBehaviour.vcp.toolRequest.keepInOutput.description")}
          >
            <Switch
              checked={toolRequest().keepBlockInText ?? false}
              onChange={(checked) => updateToolRequest({ keepBlockInText: checked })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.vcp.toolRequest.keepInOutput.label")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.toolRequest.startMarker.title")}
            description={language.t("settings.agentBehaviour.vcp.toolRequest.startMarker.description")}
          >
            <TextField
              value={toolRequest().startMarker ?? ""}
              placeholder="<<<[TOOL_REQUEST]>>>"
              onChange={(value) => updateToolRequest({ startMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.toolRequest.endMarker.title")}
            description={language.t("settings.agentBehaviour.vcp.toolRequest.endMarker.description")}
          >
            <TextField
              value={toolRequest().endMarker ?? ""}
              placeholder="<<<[END_TOOL_REQUEST]>>>"
              onChange={(value) => updateToolRequest({ endMarker: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.html.enabled.title")}
            description={language.t("settings.agentBehaviour.vcp.html.enabled.description")}
          >
            <Switch
              checked={html().enabled ?? true}
              onChange={(checked) => updateVcp({ html: { ...html(), enabled: checked } })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.vcp.html.enabled.label")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.agentTeam.enabled.title")}
            description={language.t("settings.agentBehaviour.vcp.agentTeam.enabled.description")}
          >
            <Switch
              checked={agentTeam().enabled ?? false}
              onChange={(checked) => updateAgentTeam({ enabled: checked })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.vcp.agentTeam.enabled.label")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.agentTeam.maxParallel.title")}
            description={language.t("settings.agentBehaviour.vcp.agentTeam.maxParallel.description")}
          >
            <TextField
              value={agentTeam().maxParallel?.toString() ?? ""}
              placeholder={language.t("settings.agentBehaviour.vcp.agentTeam.maxParallel.placeholder")}
              onChange={(value) => updateAgentTeam({ maxParallel: normalizeInteger(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.agentTeam.waveStrategy.title")}
            description={language.t("settings.agentBehaviour.vcp.agentTeam.waveStrategy.description")}
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
            title={language.t("settings.agentBehaviour.vcp.agentTeam.requireFileSeparation.title")}
            description={language.t("settings.agentBehaviour.vcp.agentTeam.requireFileSeparation.description")}
          >
            <Switch
              checked={agentTeam().requireFileSeparation ?? true}
              onChange={(checked) => updateAgentTeam({ requireFileSeparation: checked })}
              hideLabel
            >
              {language.t("settings.agentBehaviour.vcp.agentTeam.requireFileSeparation.label")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.agentTeam.handoffFormat.title")}
            description={language.t("settings.agentBehaviour.vcp.agentTeam.handoffFormat.description")}
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

        <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.vcp.memory.title")}</h4>
        <Card style={{ "margin-bottom": "12px" }}>
          <div
            style={{
              "font-size": "12px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "line-height": "1.5",
            }}
          >
            Memory 配置已迁移到 Settings 的 Context 页签统一管理。此处仅保留只读提示，避免多入口同时写入相同 key。
          </div>
        </Card>

        <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.vcp.vcptoolbox.title")}</h4>
        <Card>
          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.vcptoolbox.baseUrl.title")}
            description={language.t("settings.agentBehaviour.vcp.vcptoolbox.baseUrl.description")}
          >
            <TextField
              value={vcptoolboxOptions().baseURL ?? ""}
              placeholder="https://api.vcptoolbox.com"
              onChange={(value) => updateVcptoolboxOptions({ baseURL: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.vcptoolbox.modelsPath.title")}
            description={language.t("settings.agentBehaviour.vcp.vcptoolbox.modelsPath.description")}
          >
            <TextField
              value={vcptoolboxOptions().modelsPath ?? ""}
              placeholder="/v1/models"
              onChange={(value) => updateVcptoolboxOptions({ modelsPath: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.vcptoolbox.modelsUrl.title")}
            description={language.t("settings.agentBehaviour.vcp.vcptoolbox.modelsUrl.description")}
          >
            <TextField
              value={vcptoolboxOptions().modelsURL ?? ""}
              placeholder="https://api.vcptoolbox.com/v1/models"
              onChange={(value) => updateVcptoolboxOptions({ modelsURL: normalizeInput(value) })}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.agentBehaviour.vcp.vcptoolbox.apiKey.title")}
            description={language.t("settings.agentBehaviour.vcp.vcptoolbox.apiKey.description")}
            last
          >
            <TextField
              value={vcptoolboxOptions().apiKey ?? ""}
              placeholder="sk-..."
              onChange={(value) => updateVcptoolboxOptions({ apiKey: normalizeInput(value) })}
            />
          </SettingsRow>
        </Card>
      </div>
    )
  }

  const renderSkillsSubtab = () => (
    <div>
      {/* Loaded skills */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.loadedSkills")}</h4>
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
                    "border-bottom":
                      index() < loadedSkills().length - 1 ? "1px solid var(--border-weak-base)" : "none",
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
              placeholder={language.t("settings.agentBehaviour.skillPaths.placeholder")}
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
              placeholder={language.t("settings.agentBehaviour.skillUrls.placeholder")}
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
              placeholder={language.t("settings.agentBehaviour.instructionFiles.placeholder")}
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
        return <WorkflowsEditor />
      case "skills":
        return renderSkillsSubtab()
      default:
        return null
    }
  }

  return (
    <div>
      <Show when={!props.lockedSubtab}>
        <div
          style={{
            display: "flex",
            gap: "0",
            "border-bottom": "1px solid var(--vscode-panel-border)",
            "margin-bottom": "16px",
          }}
        >
          <For each={subtabs}>
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

      {renderSubtabContent()}
    </div>
  )
}

export default AgentBehaviourTab

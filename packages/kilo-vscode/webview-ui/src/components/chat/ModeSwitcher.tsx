/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 * Includes Agent Team mapping to vcp.agentTeam.enabled.
 */

import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Button } from "@kilocode/kilo-ui/button"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useSession } from "../../context/session"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { AgentInfo } from "../../types/messages"

const AGENT_TEAM_MODE = "__vcp_agent_team__"

export interface ModeSwitcherBaseProps {
  agents: AgentInfo[]
  value: string
  onSelect: (name: string) => void
  teamModeLabel?: string
}

function formatModeLabel(name: string, teamModeLabel: string): string {
  if (name === AGENT_TEAM_MODE) {
    return teamModeLabel
  }
  if (!name) {
    return "Code"
  }
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export const ModeSwitcherBase: Component<ModeSwitcherBaseProps> = (props) => {
  const [open, setOpen] = createSignal(false)

  const hasAgents = () => props.agents.length > 1

  function pick(name: string) {
    props.onSelect(name)
    setOpen(false)
  }

  const triggerLabel = () => {
    const current = props.agents.find((a) => a.name === props.value)
    const label = current?.name ?? props.value
    return formatModeLabel(label, props.teamModeLabel ?? "Agent Team")
  }

  return (
    <Show when={hasAgents()}>
      <Popover
        placement="top-start"
        open={open()}
        onOpenChange={setOpen}
        triggerAs={Button}
        triggerProps={{ variant: "ghost", size: "small" }}
        trigger={
          <>
            <span class="mode-switcher-trigger-label">{triggerLabel()}</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ "flex-shrink": "0" }}>
              <path d="M8 4l4 5H4l4-5z" />
            </svg>
          </>
        }
      >
        <div class="mode-switcher-list" role="listbox">
          <For each={props.agents}>
            {(agent) => (
              <div
                class={`mode-switcher-item${agent.name === props.value ? " selected" : ""}`}
                role="option"
                aria-selected={agent.name === props.value}
                onClick={() => pick(agent.name)}
              >
                <span class="mode-switcher-item-name">{formatModeLabel(agent.name, props.teamModeLabel ?? "Agent Team")}</span>
                <Show when={agent.description}>
                  <span class="mode-switcher-item-desc">{agent.description}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Popover>
    </Show>
  )
}

export const ModeSwitcher: Component = () => {
  const session = useSession()
  const { config, updateConfig } = useConfig()
  const language = useLanguage()

  const isAgentTeamEnabled = () => config().vcp?.agentTeam?.enabled ?? false

  const fallbackAgent = createMemo<AgentInfo | null>(() => {
    const selected = session.selectedAgent()?.trim()
    if (!selected) return null
    return {
      name: selected,
      description: "",
      mode: "all",
      native: true,
    }
  })

  const modeAgents = createMemo<AgentInfo[]>(() => {
    const team: AgentInfo = {
      name: AGENT_TEAM_MODE,
      description: "Enable multi-agent orchestration for this chat.",
      mode: "all",
      native: true,
    }
    const agents = session.agents()
    if (agents.length > 0) {
      return [team, ...agents]
    }
    const fallback = fallbackAgent()
    return fallback ? [team, fallback] : [team]
  })

  const selectedMode = createMemo(() => (isAgentTeamEnabled() ? AGENT_TEAM_MODE : session.selectedAgent()))

  const selectMode = (name: string) => {
    if (name === AGENT_TEAM_MODE) {
      updateConfig({
        vcp: {
          ...(config().vcp ?? {}),
          agentTeam: {
            ...(config().vcp?.agentTeam ?? {}),
            enabled: true,
          },
        },
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.agentTeam.enabled.title"),
        description: language.t("toast.agentTeam.enabled.description"),
      })
      return
    }

    const wasAgentTeamEnabled = isAgentTeamEnabled()
    if (isAgentTeamEnabled()) {
      updateConfig({
        vcp: {
          ...(config().vcp ?? {}),
          agentTeam: {
            ...(config().vcp?.agentTeam ?? {}),
            enabled: false,
          },
        },
      })
    }

    session.selectAgent(name)
    if (wasAgentTeamEnabled) {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.agentTeam.disabled.title"),
        description: language.t("toast.agentTeam.disabled.description", { mode: formatModeLabel(name, language.t("vcp.view.protocol.agentTeam")) }),
      })
    }
  }

  return (
    <ModeSwitcherBase
      agents={modeAgents()}
      value={selectedMode()}
      onSelect={selectMode}
      teamModeLabel={language.t("vcp.view.protocol.agentTeam")}
    />
  )
}



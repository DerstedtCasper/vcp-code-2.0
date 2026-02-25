/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModeSwitcherBase — reusable core that accepts agents/value/onSelect props.
 * ModeSwitcher     — thin wrapper wired to session context for chat usage.
 */

import { Component, createSignal, For, Show, createEffect } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import type { AgentInfo } from "../../types/messages"

// ---------------------------------------------------------------------------
// Reusable base component
// ---------------------------------------------------------------------------

export interface ModeSwitcherBaseProps {
  /** Available agents to pick from */
  agents: AgentInfo[]
  /** Currently selected agent name */
  value: string
  /** Called when the user picks an agent */
  onSelect: (name: string) => void
}

/** mode 标签映射 */
function modeTag(mode: AgentInfo["mode"]): string {
  switch (mode) {
    case "subagent": return "sub"
    case "primary": return "primary"
    case "all": return "all"
    default: return mode
  }
}

/** 颜色点组件：通过 ref + createEffect 避免 inline style lint */
const ColorDot: Component<{ color: string; class?: string }> = (props) => {
  let ref: HTMLSpanElement | undefined
  createEffect(() => {
    if (ref) ref.style.setProperty("background", props.color)
  })
  return <span ref={ref} class={props.class ?? "mode-switcher-item-dot"} />
}

export const ModeSwitcherBase: Component<ModeSwitcherBaseProps> = (props) => {
  const [open, setOpen] = createSignal(false)

  const hasAgents = () => props.agents.length > 1

  function pick(name: string) {
    props.onSelect(name)
    setOpen(false)
  }

  const triggerLabel = () => {
    const agent = props.agents.find((a) => a.name === props.value)
    if (agent) {
      return agent.name.charAt(0).toUpperCase() + agent.name.slice(1)
    }
    return props.value || "Code"
  }

  const selectedAgent = () => props.agents.find((a) => a.name === props.value)

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
            <Show when={selectedAgent()?.color}>
              <ColorDot color={selectedAgent()!.color!} class="mode-switcher-trigger-dot" />
            </Show>
            <span class="mode-switcher-trigger-label">{triggerLabel()}</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" class="mode-switcher-chevron">
              <path d="M8 4l4 5H4l4-5z" />
            </svg>
          </>
        }
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div class="mode-switcher-list" role="listbox" aria-label="Agent mode list">
          <For each={props.agents}>
            {(agent) => (
              <div
                class={`mode-switcher-item${agent.name === props.value ? " selected" : ""}`}
                role="option"
                aria-selected={agent.name === props.value}
                onClick={() => pick(agent.name)}
              >
                <div class="mode-switcher-item-header">
                  <Show when={agent.color}>
                    <ColorDot color={agent.color!} />
                  </Show>
                  <span class="mode-switcher-item-name">
                    {agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}
                  </span>
                  <Show when={!agent.native}>
                    <span class="mode-switcher-item-tag">{modeTag(agent.mode)}</span>
                  </Show>
                  <Show when={agent.native}>
                    <span class="mode-switcher-item-tag mode-switcher-item-tag--native">built-in</span>
                  </Show>
                </div>
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

// ---------------------------------------------------------------------------
// Chat-specific wrapper (backwards-compatible)
// ---------------------------------------------------------------------------

export const ModeSwitcher: Component = () => {
  const session = useSession()

  return <ModeSwitcherBase agents={session.agents()} value={session.selectedAgent()} onSelect={session.selectAgent} />
}

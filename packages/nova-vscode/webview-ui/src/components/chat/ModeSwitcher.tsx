/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 */

import { Component, createSignal, For, Show, createEffect, createMemo } from "solid-js"
import { Popover } from "@novacode/nova-ui/popover"
import { Button } from "@novacode/nova-ui/button"
import { useSession } from "../../context/session"
import { useConfig } from "../../context/config"
import type { AgentInfo } from "../../types/messages"

export interface ModeSwitcherBaseProps {
  agents: AgentInfo[]
  value: string
  onSelect: (name: string) => void
}

interface CustomModeDraft {
  name: string
  description: string
  prompt: string
}

function modeTag(mode: AgentInfo["mode"]): string {
  switch (mode) {
    case "subagent":
      return "sub"
    case "primary":
      return "primary"
    case "all":
      return "all"
    default:
      return mode
  }
}

const ColorDot: Component<{ color: string; class?: string }> = (props) => {
  let ref: HTMLSpanElement | undefined
  createEffect(() => {
    if (ref) ref.style.setProperty("background", props.color)
  })
  return <span ref={ref} class={props.class ?? "mode-switcher-item-dot"} />
}

function formatApprovalLabel(autoApproval?: AgentInfo["autoApproval"]): string {
  if (!autoApproval) return "read: allow · write: ask · execute: ask"
  const read = autoApproval.read === true ? "allow" : "ask"
  const write = autoApproval.write === true ? "allow" : "ask"
  const execute = autoApproval.execute === true ? "allow" : "ask"
  return `read: ${read} · write: ${write} · execute: ${execute}`
}

export const ModeSwitcherBase: Component<ModeSwitcherBaseProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [showEditor, setShowEditor] = createSignal(false)
  const [customName, setCustomName] = createSignal("")
  const [customDescription, setCustomDescription] = createSignal("")
  const [customPrompt, setCustomPrompt] = createSignal("")

  const hasAgents = () => props.agents.length > 1
  const selectedAgent = createMemo(() => props.agents.find((a) => a.name === props.value))

  const selectedCapabilities = createMemo(() => {
    const agent = selectedAgent()
    const tools = agent?.tools && agent.tools.length > 0 ? agent.tools.join(", ") : "read_file, write_file, execute_command"
    const prompt = agent?.promptSummary || agent?.description || "No prompt summary available."
    const approval = formatApprovalLabel(agent?.autoApproval)
    return { tools, prompt, approval }
  })

  function pick(name: string) {
    props.onSelect(name)
    setOpen(false)
  }

  const triggerLabel = () => {
    const agent = props.agents.find((a) => a.name === props.value)
    if (agent) return agent.name.charAt(0).toUpperCase() + agent.name.slice(1)
    return props.value || "Code"
  }

  function createCustomMode() {
    const draft: CustomModeDraft = {
      name: customName().trim(),
      description: customDescription().trim(),
      prompt: customPrompt().trim(),
    }
    if (!draft.name) return
    window.dispatchEvent(new CustomEvent("modeSwitcher.createCustom", { detail: draft }))
    setShowEditor(false)
    setCustomName("")
    setCustomDescription("")
    setCustomPrompt("")
    setOpen(false)
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
                  <span class="mode-switcher-item-name">{agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}</span>
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

          <div class="mode-switcher-create" onClick={() => setShowEditor((v) => !v)}>
            + Create custom mode...
          </div>

          <Show when={showEditor()}>
            <div class="mode-switcher-editor">
              <input
                class="mode-switcher-editor-input"
                placeholder="Mode name"
                value={customName()}
                onInput={(e) => setCustomName(e.currentTarget.value)}
              />
              <input
                class="mode-switcher-editor-input"
                placeholder="Short description"
                value={customDescription()}
                onInput={(e) => setCustomDescription(e.currentTarget.value)}
              />
              <textarea
                class="mode-switcher-editor-textarea"
                placeholder="System prompt summary"
                value={customPrompt()}
                onInput={(e) => setCustomPrompt(e.currentTarget.value)}
              />
              <div class="mode-switcher-editor-actions">
                <Button size="small" variant="secondary" onClick={createCustomMode} disabled={!customName().trim()}>
                  Save Draft
                </Button>
                <Button size="small" variant="ghost" onClick={() => setShowEditor(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Show>

          <div class="mode-switcher-capabilities">
            <div class="mode-switcher-capabilities-title">Agent capabilities</div>
            <div class="mode-switcher-capabilities-row">
              <span class="mode-switcher-capabilities-key">Tools</span>
              <span class="mode-switcher-capabilities-value">{selectedCapabilities().tools}</span>
            </div>
            <div class="mode-switcher-capabilities-row">
              <span class="mode-switcher-capabilities-key">Prompt</span>
              <span class="mode-switcher-capabilities-value">{selectedCapabilities().prompt}</span>
            </div>
            <div class="mode-switcher-capabilities-row">
              <span class="mode-switcher-capabilities-key">Auto approval</span>
              <span class="mode-switcher-capabilities-value">{selectedCapabilities().approval}</span>
            </div>
          </div>
        </div>
      </Popover>
    </Show>
  )
}

export const ModeSwitcher: Component = () => {
  const session = useSession()
  const { config } = useConfig()

  const visibleAgents = createMemo<AgentInfo[]>(() => {
    const list = [...session.agents()]
    const hasAgentTeam = list.some((agent) => agent.name === "agent_team")
    if ((config().vcp?.agentTeam?.enabled ?? false) && !hasAgentTeam) {
      list.push({
        name: "agent_team",
        description: "Coordinate multi-agent waves with handoff policies.",
        mode: "primary",
        native: true,
        color: "#0ea5e9",
      })
    }
    return list
  })

  return <ModeSwitcherBase agents={visibleAgents()} value={session.selectedAgent()} onSelect={session.selectAgent} />
}

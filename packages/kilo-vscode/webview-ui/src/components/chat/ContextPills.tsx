/**
 * ContextPills — 已选中上下文项的 Pill 显示
 *
 * 在输入框上方显示已通过 @ 提及选中的文件/目录/Agent 等上下文项，
 * 每个 pill 可点击 ✕ 移除。
 */

import { Component, For, Show } from "solid-js"
import { useLanguage } from "../../context/language"

export type ContextItemType = "file" | "directory" | "agent" | "git" | "url" | "clipboard" | "terminal" | "problems"

export interface ContextItem {
  id: string
  type: ContextItemType
  label: string
  /** 仅文件/目录时有值 */
  path?: string
  /** 可选的详细说明（如行范围 "10-30"） */
  detail?: string
}

interface Props {
  items: ContextItem[]
  onRemove: (id: string) => void
}

const TYPE_ICON: Record<ContextItemType, string> = {
  file: "📄",
  directory: "📁",
  agent: "🧠",
  git: "🔀",
  url: "🌐",
  clipboard: "📋",
  terminal: "�",
  problems: "⚠️",
}

export const ContextPills: Component<Props> = (props) => {
  const language = useLanguage()

  return (
    <Show when={props.items.length > 0}>
      <div class="context-pills" aria-label={language.t("prompt.mention.contextItems")}>
        <For each={props.items}>
          {(item) => (
            <div
              class="context-pill"
              classList={{ [`context-pill--${item.type}`]: true }}
              title={item.detail ? `${item.label} (${item.detail})` : (item.path ?? item.label)}
            >
              <span class="context-pill-icon" aria-hidden="true">
                {TYPE_ICON[item.type]}
              </span>
              <span class="context-pill-label">{item.label}</span>
              <Show when={item.detail}>
                <span class="context-pill-detail">:{item.detail}</span>
              </Show>
              <button
                type="button"
                class="context-pill-remove"
                onClick={() => props.onRemove(item.id)}
                aria-label={`Remove ${item.label}`}
              >
                ✕
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

/**
 * SlashCommandPopover — Slash 命令面板
 *
 * 当用户在输入框开头输入 "/" 时弹出，列出可用命令。
 * 支持键盘上下导航 + Enter/Tab 执行。
 */

import { Component, For, Show, createMemo } from "solid-js"
import { FileIcon } from "@novacode/nova-ui/file-icon"
import { useLanguage } from "../../context/language"

export interface SlashCommand {
  id: string
  /** 触发关键字，不含 "/" */
  keyword: string
  /** i18n key 或直接显示的标签 */
  labelKey: string
  /** 命令描述 i18n key */
  descKey: string
  icon: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "new",     keyword: "new",     labelKey: "prompt.slash.new",     descKey: "prompt.slash.new.desc",     icon: "✨" },
  { id: "clear",   keyword: "clear",   labelKey: "prompt.slash.clear",   descKey: "prompt.slash.clear.desc",   icon: "🗑️" },
  { id: "model",   keyword: "model",   labelKey: "prompt.slash.model",   descKey: "prompt.slash.model.desc",   icon: "🤖" },
  { id: "mode",    keyword: "mode",    labelKey: "prompt.slash.mode",    descKey: "prompt.slash.mode.desc",    icon: "🔀" },
  { id: "compact", keyword: "compact", labelKey: "prompt.slash.compact", descKey: "prompt.slash.compact.desc", icon: "📦" },
  { id: "enhance", keyword: "enhance", labelKey: "prompt.slash.enhance", descKey: "prompt.slash.enhance.desc", icon: "⚡" },
]

interface Props {
  query: string
  activeIndex: number
  onSelect: (cmd: SlashCommand) => void
  onHover: (index: number) => void
}

export const SlashCommandPopover: Component<Props> = (props) => {
  const language = useLanguage()

  const filtered = createMemo(() => {
    const q = props.query.toLowerCase()
    if (!q) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(
      (c) => c.keyword.startsWith(q) || c.keyword.includes(q),
    )
  })

  return (
    <Show when={filtered().length > 0}>
      <div class="slash-command-popover" role="listbox" aria-label="Slash commands">
        <div class="slash-command-popover-header">
          {language.t("prompt.slash.header")}
        </div>
        <For each={filtered()}>
          {(cmd, index) => (
            <div
              role="option"
              aria-selected={index() === props.activeIndex ? "true" : "false"}
              class="slash-command-item"
              classList={{ "slash-command-item--active": index() === props.activeIndex }}
              onMouseDown={(e) => {
                e.preventDefault()
                props.onSelect(cmd)
              }}
              onMouseEnter={() => props.onHover(index())}
            >
              <span class="slash-command-item-icon" aria-hidden="true">
                {cmd.icon}
              </span>
              <span class="slash-command-item-keyword">/{cmd.keyword}</span>
              <span class="slash-command-item-desc">
                {language.t(cmd.descKey as any) || cmd.descKey}
              </span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

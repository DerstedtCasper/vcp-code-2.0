/**
 * SlashCommandPopover — Slash 命令面板
 *
 * 当用户在输入框开头输入 "/" 时弹出，列出可用命令。
 * 支持键盘上下导航 + Enter/Tab 执行。
 *
 * 命令来源：
 *   - builtin: 内置命令（new, clear, model, mode, compact, enhance）
 *   - mcp:     从 config.mcp 读取的 MCP 服务器名称
 *   - skill:   从 skillsLoaded 消息获取的已安装 Skill
 *   - command: 从 config.command 读取的自定义命令模板
 */

import { Component, For, Show, createMemo } from "solid-js"
import { useLanguage } from "../../context/language"

export type SlashCommandSource = "builtin" | "mcp" | "skill" | "command"

export interface SlashCommand {
  id: string
  /** 触发关键字，不含 "/" */
  keyword: string
  /** i18n key 或直接显示的标签 */
  labelKey: string
  /** 命令描述 i18n key 或直接文本 */
  descKey: string
  icon: string
  /** 命令来源 */
  source: SlashCommandSource
}

/** 内置命令（始终可用） */
export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { id: "new",     keyword: "new",     labelKey: "prompt.slash.new",     descKey: "prompt.slash.new.desc",     icon: "✨", source: "builtin" },
  { id: "clear",   keyword: "clear",   labelKey: "prompt.slash.clear",   descKey: "prompt.slash.clear.desc",   icon: "🗑️", source: "builtin" },
  { id: "model",   keyword: "model",   labelKey: "prompt.slash.model",   descKey: "prompt.slash.model.desc",   icon: "🤖", source: "builtin" },
  { id: "mode",    keyword: "mode",    labelKey: "prompt.slash.mode",    descKey: "prompt.slash.mode.desc",    icon: "🔀", source: "builtin" },
  { id: "compact", keyword: "compact", labelKey: "prompt.slash.compact", descKey: "prompt.slash.compact.desc", icon: "📦", source: "builtin" },
  { id: "enhance", keyword: "enhance", labelKey: "prompt.slash.enhance", descKey: "prompt.slash.enhance.desc", icon: "⚡", source: "builtin" },
]

/** 向后兼容别名 */
export const SLASH_COMMANDS = BUILTIN_SLASH_COMMANDS

/** Source badge 标签 & 样式 */
const SOURCE_BADGE: Record<SlashCommandSource, { label: string; color: string }> = {
  builtin: { label: "",       color: "" },
  mcp:     { label: "MCP",    color: "var(--vscode-charts-blue, #3794ff)" },
  skill:   { label: "Skill",  color: "var(--vscode-charts-green, #89d185)" },
  command: { label: "Cmd",    color: "var(--vscode-charts-orange, #cca700)" },
}

interface Props {
  query: string
  activeIndex: number
  /** 完整的命令列表（builtin + mcp + skill + command） */
  commands: SlashCommand[]
  onSelect: (cmd: SlashCommand) => void
  onHover: (index: number) => void
}

export const SlashCommandPopover: Component<Props> = (props) => {
  const language = useLanguage()

  const filtered = createMemo(() => {
    const q = props.query.toLowerCase()
    if (!q) return props.commands
    return props.commands.filter(
      (c) => c.keyword.toLowerCase().startsWith(q) || c.keyword.toLowerCase().includes(q),
    )
  })

  return (
    <Show when={filtered().length > 0}>
      <div class="slash-command-popover" role="listbox" aria-label="Slash commands">
        <div class="slash-command-popover-header">
          {language.t("prompt.slash.header")}
        </div>
        <For each={filtered()}>
          {(cmd, index) => {
            const badge = SOURCE_BADGE[cmd.source]
            return (
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
                <Show when={badge.label}>
                  <span
                    class="slash-command-item-badge"
                    style={{
                      background: badge.color,
                      color: "#fff",
                      "font-size": "10px",
                      padding: "1px 5px",
                      "border-radius": "3px",
                      "margin-left": "4px",
                      "font-weight": "600",
                      "line-height": "1.4",
                    }}
                  >
                    {badge.label}
                  </span>
                </Show>
                <span class="slash-command-item-desc">
                  {language.t(cmd.descKey as any) || cmd.descKey}
                </span>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

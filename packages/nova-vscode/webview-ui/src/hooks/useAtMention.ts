/**
 * useAtMention — 多类型 @ 提及钩子
 * 扩展 useFileMention 以支持 file / directory / agent / special 类型。
 *
 * 返回值兼容 useFileMention 接口，并额外提供：
 *   - selectedContextItem: 最近选中的 ContextItem（供 PromptInput 添加到 pills）
 *   - clearSelectedContextItem: 清除 selectedContextItem
 */

import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { FileAttachment, WebviewMessage, ExtensionMessage, AgentInfo } from "../types/messages"
import { AT_PATTERN, syncMentionedPaths as _syncMentionedPaths, buildFileAttachments } from "./file-mention-utils"
import type { ContextItem, ContextItemType } from "../components/chat/ContextPills"

const FILE_SEARCH_DEBOUNCE_MS = 150

// ── 提及结果条目 ────────────────────────────────────────────────────────

export type MentionResultType = "file" | "directory" | "agent" | "special"

export interface MentionResult {
  type: MentionResultType
  /** 显示标签 */
  label: string
  /** 文件/目录路径，或 agent name，或 special id */
  value: string
  /** 可选说明 */
  description?: string
  /** 文件基础路径（当 value 含行范围时使用） */
  path?: string
  /** 文件行范围，例如 10-20 */
  range?: string
}

// ── 特殊项静态列表 ────────────────────────────────────────────────────────

export const SPECIAL_MENTION_ITEMS: MentionResult[] = [
  { type: "special", label: "Clipboard", value: "clipboard", description: "Insert clipboard content" },
  { type: "special", label: "Terminal", value: "terminal", description: "Insert terminal output" },
  { type: "special", label: "Problems", value: "problems", description: "Insert diagnostic problems" },
  { type: "special", label: "Git", value: "git", description: "Insert git context" },
  { type: "special", label: "URL", value: "url", description: "Fetch and insert a URL" },
]

export const GIT_MENTION_ITEMS: MentionResult[] = [
  { type: "special", label: "Git Staged", value: "git:staged", description: "Insert staged changes" },
  { type: "special", label: "Git Unstaged", value: "git:unstaged", description: "Insert unstaged changes" },
  { type: "special", label: "Git Diff", value: "git:diff", description: "Insert diff against HEAD" },
  { type: "special", label: "Git Log", value: "git:log", description: "Insert latest commit logs" },
]

// ── VSCode 上下文接口 ─────────────────────────────────────────────────────

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

// ── 返回接口 ─────────────────────────────────────────────────────────────

export interface AtMention {
  mentionedPaths: Accessor<Set<string>>
  mentionResults: Accessor<MentionResult[]>
  mentionIndex: Accessor<number>
  showMention: Accessor<boolean>
  onInput: (val: string, cursor: number) => void
  onKeyDown: (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => boolean
  selectItem: (
    item: MentionResult,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
  setMentionIndex: (index: number) => void
  closeMention: () => void
  parseFileAttachments: (text: string) => FileAttachment[]
  selectedContextItem: Accessor<ContextItem | null>
  clearSelectedContextItem: () => void
}

// ── 主函数 ────────────────────────────────────────────────────────────────

export function useAtMention(vscode: VSCodeContext, getAgents: () => AgentInfo[]): AtMention {
  const [mentionedPaths, setMentionedPaths] = createSignal<Set<string>>(new Set())
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [mentionResults, setMentionResults] = createSignal<MentionResult[]>([])
  const [mentionIndex, setMentionIndex] = createSignal(0)
  const [selectedContextItem, setSelectedContextItem] = createSignal<ContextItem | null>(null)
  let workspaceDir = ""

  let fileSearchTimer: ReturnType<typeof setTimeout> | undefined
  let fileSearchCounter = 0

  const showMention = () => mentionQuery() !== null

  createEffect(() => {
    if (!showMention()) setMentionIndex(0)
  })

  const buildNonFileResults = (query: string): MentionResult[] => {
    const q = query.toLowerCase()
    const lineRangeMatch = /^(.+):(\d+)(?:-(\d+))?$/.exec(query)

    const lineRangeItem: MentionResult[] =
      lineRangeMatch && lineRangeMatch[1]
        ? [
            {
              type: "file",
              label: `${lineRangeMatch[1]}:${lineRangeMatch[2]}${lineRangeMatch[3] ? `-${lineRangeMatch[3]}` : ""}`,
              value: `${lineRangeMatch[1]}:${lineRangeMatch[2]}${lineRangeMatch[3] ? `-${lineRangeMatch[3]}` : ""}`,
              path: lineRangeMatch[1],
              range: `${lineRangeMatch[2]}${lineRangeMatch[3] ? `-${lineRangeMatch[3]}` : ""}`,
              description: "Attach specific line range",
            },
          ]
        : []

    const agentItems: MentionResult[] = getAgents()
      .filter((a) => !a.hidden && (q === "" || a.name.toLowerCase().includes(q)))
      .map((a) => ({
        type: "agent" as MentionResultType,
        label: a.name,
        value: a.name,
        description: a.description,
      }))

    const gitItems =
      q === "git" || q.startsWith("git:")
        ? GIT_MENTION_ITEMS.filter((s) => s.value.includes(q) || s.label.toLowerCase().includes(q))
        : []

    const specialItems = SPECIAL_MENTION_ITEMS.filter(
      (s) => q === "" || s.label.toLowerCase().includes(q) || s.value.includes(q),
    )

    return [...lineRangeItem, ...agentItems, ...gitItems, ...specialItems]
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "fileSearchResult") return
    const result = message as { type: "fileSearchResult"; paths: string[]; dir: string; requestId: string }
    if (result.requestId === `file-search-${fileSearchCounter}`) {
      workspaceDir = result.dir
      // 将文件/目录分开
      const items: MentionResult[] = result.paths.map((p) => ({
        type: (p.endsWith("/") ? "directory" : "file") as MentionResultType,
        label: p,
        value: p,
      }))
      setMentionResults([...buildNonFileResults(mentionQuery() ?? ""), ...items])
      setMentionIndex(0)
    }
  })

  onCleanup(() => {
    unsubscribe()
    if (fileSearchTimer) clearTimeout(fileSearchTimer)
  })

  const requestFileSearch = (query: string) => {
    if (fileSearchTimer) clearTimeout(fileSearchTimer)
    fileSearchTimer = setTimeout(() => {
      fileSearchCounter++
      vscode.postMessage({ type: "requestFileSearch", query, requestId: `file-search-${fileSearchCounter}` })
    }, FILE_SEARCH_DEBOUNCE_MS)
  }

  const closeMention = () => {
    setMentionQuery(null)
    setMentionResults([])
  }

  const syncMentionedPaths = (text: string) => {
    setMentionedPaths((prev) => _syncMentionedPaths(prev, text))
  }

  /**
   * 构建点击/回车选择后的 ContextItem
   */
  function buildContextItem(item: MentionResult): ContextItem {
    const specialType: ContextItemType = item.value.startsWith("git:")
      ? "git"
      : ((item.value as ContextItemType) ?? "file")

    const typeMap: Record<MentionResultType, ContextItemType> = {
      file: "file",
      directory: "directory",
      agent: "agent",
      special: specialType,
    }

    const detail =
      item.range ??
      (item.value.startsWith("git:") ? item.value.split(":")[1] : item.description)

    return {
      id: `${item.type}:${item.value}:${Date.now()}`,
      type: typeMap[item.type] ?? "file",
      label: item.label,
      path: item.type === "file" || item.type === "directory" ? (item.path ?? item.value) : undefined,
      detail,
    }
  }

  /**
   * 选择一个提及条目：
   * - 对于 file/directory：替换输入框中的 @query 为 @path，并记录路径
   * - 对于 agent/special：仅移除 @query，并将条目添加到 contextItems pill
   */
  const selectItem = (
    item: MentionResult,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const val = textarea.value
    const cursor = textarea.selectionStart ?? val.length
    const before = val.substring(0, cursor)
    const after = val.substring(cursor)

    if (item.type === "file" || item.type === "directory") {
      const mentionToken = item.value
      const replaced = before.replace(AT_PATTERN, (match) => {
        const prefix = match.startsWith(" ") ? " " : ""
        return `${prefix}@${mentionToken}`
      })
      const newText = replaced + after
      textarea.value = newText
      setText(newText)
      const newCursor = replaced.length
      textarea.setSelectionRange(newCursor, newCursor)
      textarea.focus()
      setMentionedPaths((prev) => new Set([...prev, item.path ?? item.value]))
    } else {
      // agent / special: 清除 @query，将条目作为 pill
      const replaced = before.replace(AT_PATTERN, (match) => {
        return match.startsWith(" ") ? " " : ""
      })
      const newText = replaced + after
      textarea.value = newText
      setText(newText)
      const newCursor = replaced.length
      textarea.setSelectionRange(newCursor, newCursor)
      textarea.focus()
    }

    setSelectedContextItem(buildContextItem(item))
    closeMention()
    onSelect?.()
  }

  const onInput = (val: string, cursor: number) => {
    syncMentionedPaths(val)
    const before = val.substring(0, cursor)
    const match = before.match(AT_PATTERN)
    if (match) {
      const query = match[1] ?? ""
      setMentionQuery(query)
      const nonFileItems = buildNonFileResults(query)
      if (nonFileItems.length > 0) {
        setMentionResults(nonFileItems)
        setMentionIndex(0)
      }

      // 总是发起文件搜索（结果回来后会合并/覆盖）
      const rangeMatch = /^(.+):\d+(?:-\d+)?$/.exec(query)
      requestFileSearch(rangeMatch ? (rangeMatch[1] ?? query) : query)
    } else {
      closeMention()
    }
  }

  const onKeyDown = (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ): boolean => {
    if (!showMention()) return false

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setMentionIndex((i) => Math.min(i + 1, mentionResults().length - 1))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setMentionIndex((i) => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const item = mentionResults()[mentionIndex()]
      if (!item) return false
      e.preventDefault()
      if (textarea) selectItem(item, textarea, setText, onSelect)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      closeMention()
      return true
    }

    return false
  }

  const parseFileAttachments = (text: string): FileAttachment[] =>
    buildFileAttachments(text, mentionedPaths(), workspaceDir)

  const clearSelectedContextItem = () => setSelectedContextItem(null)

  return {
    mentionedPaths,
    mentionResults,
    mentionIndex,
    showMention,
    onInput,
    onKeyDown,
    selectItem,
    setMentionIndex,
    closeMention,
    parseFileAttachments,
    selectedContextItem,
    clearSelectedContextItem,
  }
}

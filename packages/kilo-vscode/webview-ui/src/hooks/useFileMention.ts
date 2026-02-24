import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { FileAttachment, WebviewMessage, ExtensionMessage } from "../types/messages"
import { AT_PATTERN, syncMentionedPaths as _syncMentionedPaths, buildFileAttachments } from "./file-mention-utils"

const FILE_SEARCH_DEBOUNCE_MS = 150
export const AGENT_MENTION_PREFIX = "__agent__:"

export function isAgentMentionResult(value: string): boolean {
  return value.startsWith(AGENT_MENTION_PREFIX)
}

export function decodeAgentMentionResult(value: string): string {
  return isAgentMentionResult(value) ? value.slice(AGENT_MENTION_PREFIX.length) : value
}

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface FileMention {
  mentionedPaths: Accessor<Set<string>>
  mentionResults: Accessor<string[]>
  mentionIndex: Accessor<number>
  showMention: Accessor<boolean>
  onInput: (val: string, cursor: number) => void
  onKeyDown: (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => boolean
  selectFile: (
    path: string,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
  setMentionIndex: (index: number) => void
  closeMention: () => void
  parseFileAttachments: (text: string) => FileAttachment[]
}

export function useFileMention(vscode: VSCodeContext, agentNames?: Accessor<string[]>): FileMention {
  const [mentionedPaths, setMentionedPaths] = createSignal<Set<string>>(new Set())
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [fileResults, setFileResults] = createSignal<string[]>([])
  const [agentResults, setAgentResults] = createSignal<string[]>([])
  const mentionResults = createMemo<string[]>(() => [...agentResults(), ...fileResults()])
  const [mentionIndex, setMentionIndex] = createSignal(0)
  let workspaceDir = ""

  let fileSearchTimer: ReturnType<typeof setTimeout> | undefined
  let fileSearchCounter = 0

  const showMention = () => mentionQuery() !== null

  createEffect(() => {
    if (!showMention()) setMentionIndex(0)
  })

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "fileSearchResult") return
    const result = message as { type: "fileSearchResult"; paths: string[]; dir: string; requestId: string }
    if (result.requestId === `file-search-${fileSearchCounter}`) {
      workspaceDir = result.dir
      setFileResults(result.paths)
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
    setFileResults([])
    setAgentResults([])
  }

  const syncMentionedPaths = (text: string) => {
    setMentionedPaths((prev) => _syncMentionedPaths(prev, text))
  }

  const selectMentionFile = (
    path: string,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const val = textarea.value
    const cursor = textarea.selectionStart ?? val.length
    const before = val.substring(0, cursor)
    const after = val.substring(cursor)

    const isAgent = isAgentMentionResult(path)
    const mentionText = decodeAgentMentionResult(path)
    const replaced = before.replace(AT_PATTERN, (match) => {
      const prefix = match.startsWith(" ") ? " " : ""
      return `${prefix}@${mentionText}`
    })
    const newText = replaced + after
    textarea.value = newText
    setText(newText)

    const newCursor = replaced.length
    textarea.setSelectionRange(newCursor, newCursor)
    textarea.focus()

    if (!isAgent) {
      setMentionedPaths((prev) => new Set([...prev, path]))
    }
    closeMention()
    onSelect?.()
  }

  const onInput = (val: string, cursor: number) => {
    syncMentionedPaths(val)
    const before = val.substring(0, cursor)
    const match = before.match(AT_PATTERN)
    if (match) {
      const query = match[1]
      const q = query.toLowerCase()
      setMentionQuery(query)
      const matchedAgents = (agentNames?.() ?? [])
        .filter((name) => name.toLowerCase().includes(q))
        .slice(0, 6)
        .map((name) => `${AGENT_MENTION_PREFIX}${name}`)
      setAgentResults(matchedAgents)
      requestFileSearch(query)
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
    const results = mentionResults()
    const total = results.length

    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (total > 0) {
        setMentionIndex((i) => Math.min(i + 1, total - 1))
      }
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      if (total > 0) {
        setMentionIndex((i) => Math.max(i - 1, 0))
      }
      return true
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      const path = results[mentionIndex()]
      if (!path) {
        closeMention()
        return true
      }
      if (textarea) selectMentionFile(path, textarea, setText, onSelect)
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

  return {
    mentionedPaths,
    mentionResults,
    mentionIndex,
    showMention,
    onInput,
    onKeyDown,
    selectFile: selectMentionFile,
    setMentionIndex,
    closeMention,
    parseFileAttachments,
  }
}

/**
 * PromptInput component
 * Text input with send/abort buttons, ghost-text autocomplete,
 * @ file mention support, slash commands, context pills, and history navigation.
 */

import { Component, createSignal, createEffect, on, For, Index, onCleanup, Show, untrack } from "solid-js"
import { Button } from "@novacode/nova-ui/button"
import { Dialog } from "@novacode/nova-ui/dialog"
import { Tooltip } from "@novacode/nova-ui/tooltip"
import { FileIcon } from "@novacode/nova-ui/file-icon"
import { showToast } from "@novacode/nova-ui/toast"
import { useDialog } from "@novacode/nova-ui/context/dialog"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { ModelSelector } from "./ModelSelector"
import { ModeSwitcher } from "./ModeSwitcher"
import { ThinkingSelector } from "./ThinkingSelector"
import { CodebaseIndexDialog } from "./CodebaseIndexDialog"
import { useAtMention, type MentionResult } from "../../hooks/useAtMention"
import { useImageAttachments, ACCEPTED_IMAGE_TYPES } from "../../hooks/useImageAttachments"
import { useEnhancePrompt } from "../../hooks/useEnhancePrompt"
import { fileName, dirName, buildHighlightSegments } from "./prompt-input-utils"
import { SlashCommandPopover, SLASH_COMMANDS, type SlashCommand } from "./SlashCommandPopover"
import { ContextPills, type ContextItem } from "./ContextPills"
import type { FileAttachment } from "../../types/messages"
import AgentBehaviourTab from "../settings/AgentBehaviourTab"

const AUTOCOMPLETE_DEBOUNCE_MS = 500
const MIN_TEXT_LENGTH = 3
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

// Per-session input text storage (module-level so it survives remounts)
const drafts = new Map<string, string>()

// 每个 session 的历史发送记录（模块级，最多 100 条）
const sendHistory = new Map<string, string[]>()

export const PromptInput: Component = () => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const mention = useAtMention(vscode, session.agents)
  const imageAttach = useImageAttachments()

  // ── Enhance Prompt ────────────────────────────────────────────────────
  const enhance = useEnhancePrompt(vscode, (enhanced: string) => {
    setText(enhanced)
    if (textareaRef) {
      textareaRef.value = enhanced
      adjustHeight()
    }
    showCommandFeedback(`✨ ${language.t("prompt.slash.enhance")}`)
  })

  const sessionKey = () => session.currentSessionID() ?? "__new__"

  const [text, setText] = createSignal("")
  const [ghostText, setGhostText] = createSignal("")
  const [showBusyActions, setShowBusyActions] = createSignal(false)

  // ── Slash 命令面板状态 ──────────────────────────────────────────────
  const [showSlash, setShowSlash] = createSignal(false)
  const [slashQuery, setSlashQuery] = createSignal("")
  const [slashIndex, setSlashIndex] = createSignal(0)
  const [slashFeedback, setSlashFeedback] = createSignal("")
  const [manualAttachments, setManualAttachments] = createSignal<Array<{ id: string; filename: string; mime: string; url: string }>>([])

  // ── 上下文 Pills 状态 ────────────────────────────────────────────────
  const [contextItems, setContextItems] = createSignal<ContextItem[]>([])

  // ── 历史导航状态 ──────────────────────────────────────────────────────
  // historyIndex: -1 表示当前草稿，0 = 最近一条，依此类推
  let historyIndex = -1
  let historyDraftSaved = ""

  // ── 将 @ 选中的 agent/special 条目同步到 contextItems pill ──────────
  createEffect(() => {
    const item = mention.selectedContextItem()
    if (item) {
      setContextItems((prev) => {
        // 避免重复（相同 type+label）
        if (prev.some((p) => p.type === item.type && p.label === item.label)) return prev
        return [...prev, item]
      })
      mention.clearSelectedContextItem()
    }
  })

  let textareaRef: HTMLTextAreaElement | undefined
  let attachInputRef: HTMLInputElement | undefined
  let highlightRef: HTMLDivElement | undefined
  let dropdownRef: HTMLDivElement | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let slashFeedbackTimer: ReturnType<typeof setTimeout> | undefined
  let requestCounter = 0
  // Save/restore input text when switching sessions.
  // Uses `on()` to track only sessionKey — avoids re-running on every keystroke.
  createEffect(
    on(sessionKey, (key, prev) => {
      if (prev !== undefined && prev !== key) {
        drafts.set(prev, untrack(text))
      }
      const draft = drafts.get(key) ?? ""
      setText(draft)
      setGhostText("")
      if (textareaRef) {
        textareaRef.value = draft
        // Reset height then adjust
        textareaRef.style.height = "auto"
        textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
      }
      window.dispatchEvent(new Event("focusPrompt"))
      if (key !== "__new__") session.requestPromptQueue()
    }),
  )

  // Focus textarea when any part of the app requests it
  const onFocusPrompt = () => textareaRef?.focus()
  window.addEventListener("focusPrompt", onFocusPrompt)
  onCleanup(() => window.removeEventListener("focusPrompt", onFocusPrompt))

  const isBusy = () => session.status() === "busy"
  const isDisabled = () => !server.isConnected()
  const canSend = () =>
    (text().trim().length > 0 || imageAttach.images().length > 0 || manualAttachments().length > 0) &&
    !isBusy() &&
    !isDisabled()

  const openCodebaseIndexDialog = () => {
    dialog.show(() => (
      <Dialog title={language.t("prompt.action.codebaseIndex")} fit>
        <div style={{ "max-height": "80vh", overflow: "auto", padding: "4px" }}>
          <CodebaseIndexDialog scopeID="dialog.codebaseIndex" />
        </div>
      </Dialog>
    ))
  }

  const openAgentBehaviourDialog = () => {
    dialog.show(() => (
      <Dialog title={language.t("prompt.action.agentBehaviour")} fit>
        <div style={{ width: "min(980px, 92vw)", "max-height": "80vh", overflow: "auto", padding: "4px" }}>
          <AgentBehaviourTab />
        </div>
      </Dialog>
    ))
  }

  const addAtMention = () => {
    if (!textareaRef || isDisabled()) return
    const current = textareaRef.value
    const start = textareaRef.selectionStart ?? current.length
    const end = textareaRef.selectionEnd ?? start
    const nextText = `${current.slice(0, start)}@${current.slice(end)}`
    const nextPos = start + 1
    textareaRef.value = nextText
    setText(nextText)
    textareaRef.setSelectionRange(nextPos, nextPos)
    textareaRef.focus()
    mention.onInput(nextText, nextPos)
    adjustHeight()
    syncHighlightScroll()
  }

  const addManualAttachment = (filename: string, mime: string, url: string) => {
    setManualAttachments((prev) => {
      if (prev.some((item) => item.filename === filename && item.url === url)) {
        return prev
      }
      return [...prev, { id: crypto.randomUUID(), filename, mime, url }]
    })
  }

  const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(reader.error ?? new Error("failed to read file"))
      reader.readAsDataURL(file)
    })

  const handleFileInput = async (event: Event) => {
    const target = event.currentTarget as HTMLInputElement
    const files = target.files ? Array.from(target.files) : []
    if (files.length === 0) return
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        showToast({
          variant: "error",
          title: language.t("prompt.toast.attachmentTooLarge.title"),
          description: language.t("prompt.toast.attachmentTooLarge.description", {
            file: file.name,
            sizeMb: Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024),
          }),
        })
        continue
      }
      if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        imageAttach.add(file)
        continue
      }
      try {
        const mime = file.type || "application/octet-stream"
        const dataUrl = await readAsDataUrl(file)
        addManualAttachment(file.name || "attachment", mime, dataUrl)
      } catch (error) {
        console.error("[Nova New] Failed to attach file:", error)
      }
    }
    target.value = ""
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "chatCompletionResult") {
      const result = message as { type: "chatCompletionResult"; text: string; requestId: string }
      if (result.requestId === `chat-ac-${requestCounter}` && result.text) {
        setGhostText(result.text)
      }
    }

    if (message.type === "setChatBoxMessage") {
      setText(message.text)
      setGhostText("")
      if (textareaRef) {
        textareaRef.value = message.text
        adjustHeight()
      }
    }

    if (message.type === "triggerTask") {
      if (isBusy() || isDisabled()) return
      const sel = session.selected()
      session.sendMessage(message.text, sel?.providerID, sel?.modelID)
    }

    if (message.type === "action" && message.action === "focusInput") {
      textareaRef?.focus()
    }
  })

  onCleanup(() => {
    // Persist current draft before unmounting
    const current = text()
    if (current) drafts.set(sessionKey(), current)
    unsubscribe()
    if (debounceTimer) clearTimeout(debounceTimer)
    if (slashFeedbackTimer) clearTimeout(slashFeedbackTimer)
  })

  const showCommandFeedback = (label: string) => {
    setSlashFeedback(label)
    if (slashFeedbackTimer) clearTimeout(slashFeedbackTimer)
    slashFeedbackTimer = setTimeout(() => setSlashFeedback(""), 1800)
  }

  const requestAutocomplete = (val: string) => {
    if (val.length < MIN_TEXT_LENGTH || isDisabled()) {
      setGhostText("")
      return
    }
    requestCounter++
    vscode.postMessage({ type: "requestChatCompletion", text: val, requestId: `chat-ac-${requestCounter}` })
  }

  const acceptSuggestion = () => {
    const suggestion = ghostText()
    if (!suggestion) return

    const newText = text() + suggestion
    setText(newText)
    setGhostText("")
    vscode.postMessage({ type: "chatCompletionAccepted", suggestionLength: suggestion.length })

    if (textareaRef) {
      textareaRef.value = newText
      adjustHeight()
    }
  }

  const dismissSuggestion = () => setGhostText("")

  const scrollToActiveItem = () => {
    if (!dropdownRef) return
    const items = dropdownRef.querySelectorAll(".file-mention-item")
    const active = items[mention.mentionIndex()] as HTMLElement | undefined
    if (active) active.scrollIntoView({ block: "nearest" })
  }

  const syncHighlightScroll = () => {
    if (highlightRef && textareaRef) {
      highlightRef.scrollTop = textareaRef.scrollTop
    }
  }

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  const handlePaste = (e: ClipboardEvent) => {
    imageAttach.handlePaste(e)
    // After pasting text, the textarea content changes but the layout may not
    // have reflowed yet, causing the caret position to be visually out of sync.
    // Defer height recalculation to after the browser completes the reflow.
    requestAnimationFrame(() => {
      adjustHeight()
      syncHighlightScroll()
    })
  }

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    const val = target.value
    setText(val)
    adjustHeight()
    setGhostText("")
    syncHighlightScroll()
    // 重置历史导航
    historyIndex = -1

    // ── Slash 命令检测 ────────────────────────────────────────────────
    const cursorPos = target.selectionStart ?? val.length
    const beforeCursor = val.slice(0, cursorPos)
    const slashMatch = /^\/(\w*)$/.exec(beforeCursor)
    if (slashMatch) {
      setSlashQuery(slashMatch[1] ?? "")
      setSlashIndex(0)
      setShowSlash(true)
    } else {
      setShowSlash(false)
    }

    mention.onInput(val, target.selectionStart ?? val.length)

    if (mention.showMention()) {
      setGhostText("")
      if (debounceTimer) clearTimeout(debounceTimer)
      return
    }

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => requestAutocomplete(val), AUTOCOMPLETE_DEBOUNCE_MS)
  }

  /** 执行 slash 命令 */
  const executeSlashCommand = (cmd: SlashCommand) => {
    const currentText = text()
    setShowSlash(false)
    if (cmd.id !== "enhance") {
      setText("")
      if (textareaRef) {
        textareaRef.value = ""
        adjustHeight()
      }
    }
    switch (cmd.id) {
      case "new":
        session.createSession?.()
        showCommandFeedback(`✓ ${language.t(cmd.labelKey as any)}`)
        break
      case "clear":
        session.clearCurrentSession?.()
        showCommandFeedback(`✓ ${language.t(cmd.labelKey as any)}`)
        break
      case "model":
        // 打开模型选择器（通过自定义事件通知 ModelSelector）
        window.dispatchEvent(new CustomEvent("openModelSelector"))
        showCommandFeedback(`✓ ${language.t(cmd.labelKey as any)}`)
        break
      case "mode":
        window.dispatchEvent(new CustomEvent("openModeSwitcher"))
        showCommandFeedback(`✓ ${language.t(cmd.labelKey as any)}`)
        break
      case "compact":
        vscode.postMessage({ type: "compactContext" })
        showCommandFeedback(`✓ ${language.t(cmd.labelKey as any)}`)
        break
      case "enhance":
        enhance.enhance(currentText, contextItems())
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    // ── Slash 命令面板键盘处理 ──────────────────────────────────────
    if (showSlash()) {
      const filtered = SLASH_COMMANDS.filter((c) => {
        const q = slashQuery().toLowerCase()
        return !q || c.keyword.startsWith(q) || c.keyword.includes(q)
      })
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSlashIndex((i) => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSlashIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const cmd = filtered[slashIndex()]
        if (cmd) executeSlashCommand(cmd)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setShowSlash(false)
        return
      }
    }

    if (mention.onKeyDown(e, textareaRef, setText, adjustHeight)) {
      setGhostText("")
      queueMicrotask(scrollToActiveItem)
      return
    }

    if ((e.key === "Tab" || e.key === "ArrowRight") && ghostText()) {
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (e.key === "Escape" && ghostText()) {
      e.preventDefault()
      e.stopPropagation()
      dismissSuggestion()
      return
    }
    if (e.key === "Escape" && isBusy()) {
      e.preventDefault()
      e.stopPropagation()
      session.abort()
      return
    }

    // ── 历史导航 (↑/↓) ────────────────────────────────────────────────
    const history = sendHistory.get(sessionKey()) ?? []
    const curVal = textareaRef?.value ?? ""
    if (e.key === "ArrowUp" && !e.shiftKey && !mention.showMention()) {
      // 仅当光标在第一行时触发历史导航
      const lineStart = curVal.lastIndexOf("\n", (textareaRef?.selectionStart ?? 0) - 1)
      if (lineStart === -1 && history.length > 0) {
        e.preventDefault()
        if (historyIndex === -1) historyDraftSaved = curVal
        historyIndex = Math.min(historyIndex + 1, history.length - 1)
        const histVal = history[historyIndex] ?? ""
        setText(histVal)
        if (textareaRef) {
          textareaRef.value = histVal
          adjustHeight()
          // 将光标移到末尾
          requestAnimationFrame(() => {
            textareaRef!.selectionStart = histVal.length
            textareaRef!.selectionEnd = histVal.length
          })
        }
        return
      }
    }
    if (e.key === "ArrowDown" && !e.shiftKey && historyIndex >= 0) {
      e.preventDefault()
      historyIndex--
      const nextVal = historyIndex >= 0 ? (history[historyIndex] ?? "") : historyDraftSaved
      setText(nextVal)
      if (textareaRef) {
        textareaRef.value = nextVal
        adjustHeight()
      }
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      dismissSuggestion()
      handleSend()
    }
  }

  const buildDraftPayload = () => {
    const message = text().trim()
    const imgs = imageAttach.images()
    if (!message && imgs.length === 0) return
    const mentionFiles = mention.parseFileAttachments(message)
    const extraFiles: FileAttachment[] = manualAttachments().map((item) => ({ mime: item.mime, url: item.url }))
    const imgFiles = imgs.map((img) => ({ mime: img.mime, url: img.dataUrl }))
    const allFiles = [...mentionFiles, ...extraFiles, ...imgFiles]
    const sel = session.selected()
    const attachments = allFiles.length > 0 ? allFiles : undefined
    return {
      message,
      selection: sel,
      attachments,
      agent: session.selectedAgent(),
      variant: session.currentVariant(),
    }
  }

  const resetDraft = () => {
    requestCounter++
    setText("")
    setGhostText("")
    imageAttach.clear()
    setManualAttachments([])
    if (debounceTimer) clearTimeout(debounceTimer)
    mention.closeMention()
    drafts.delete(sessionKey())
    if (attachInputRef) attachInputRef.value = ""
    if (textareaRef) textareaRef.style.height = "auto"
  }

  const handleSend = () => {
    const draft = buildDraftPayload()
    if (!draft || isDisabled()) return
    if (isBusy()) {
      setShowBusyActions(true)
      return
    }
    // 记录发送历史（用于 ↑↓ 历史导航）
    if (draft.message.trim()) {
      const key = sessionKey()
      const hist = sendHistory.get(key) ?? []
      hist.unshift(draft.message.trim())
      if (hist.length > 100) hist.pop()
      sendHistory.set(key, hist)
    }
    historyIndex = -1
    session.sendMessage(draft.message, draft.selection?.providerID, draft.selection?.modelID, draft.attachments)
    resetDraft()
  }

  const handleBusySend = (mode: "guide" | "queue" | "interrupt") => {
    const draft = buildDraftPayload()
    if (!draft || isDisabled()) return
    if (mode === "queue") {
      session.enqueuePrompt({
        text: draft.message,
        files: draft.attachments,
        policy: "queue",
        priority: 0,
        providerID: draft.selection?.providerID,
        modelID: draft.selection?.modelID,
        agent: draft.agent,
        variant: draft.variant,
      })
      resetDraft()
      setShowBusyActions(false)
      return
    }
    session.sendMessage(draft.message, draft.selection?.providerID, draft.selection?.modelID, draft.attachments, mode)
    resetDraft()
    setShowBusyActions(false)
  }

  const reorderQueueItem = (fromIndex: number, toIndex: number) => {
    const queue = session.promptQueue()
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= queue.length || toIndex >= queue.length || fromIndex === toIndex) {
      return
    }
    const ids = queue.map((item) => item.id)
    const [moved] = ids.splice(fromIndex, 1)
    if (!moved) return
    ids.splice(toIndex, 0, moved)
    session.reorderPromptQueue(ids)
  }

  return (
    <div
      class="prompt-input-container"
      classList={{ "prompt-input-container--dragging": imageAttach.dragging() }}
      onDragOver={imageAttach.handleDragOver}
      onDragLeave={imageAttach.handleDragLeave}
      onDrop={imageAttach.handleDrop}
    >
      {/* Slash 命令面板 */}
      <Show when={showSlash()}>
        <SlashCommandPopover
          query={slashQuery()}
          activeIndex={slashIndex()}
          onSelect={executeSlashCommand}
          onHover={setSlashIndex}
        />
      </Show>
      {/* 上下文 Pills */}
      <ContextPills
        items={contextItems()}
        onRemove={(id) => setContextItems((prev) => prev.filter((i) => i.id !== id))}
      />
      <Show when={mention.showMention()}>
        <div class="file-mention-dropdown" ref={dropdownRef}>
          <Show
            when={mention.mentionResults().length > 0}
            fallback={<div class="file-mention-empty">No results found</div>}
          >
            <For each={mention.mentionResults()}>
              {(item, index) => (
                <div
                  class="file-mention-item"
                  classList={{ "file-mention-item--active": index() === mention.mentionIndex() }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (textareaRef) {
                      mention.selectItem(item, textareaRef, setText, adjustHeight)
                    }
                  }}
                  onMouseEnter={() => mention.setMentionIndex(index())}
                >
                  <Show when={item.type === "file"}>
                    <FileIcon node={{ path: item.value, type: "file" }} class="file-mention-icon" />
                    <span class="file-mention-name">{fileName(item.value)}</span>
                    <span class="file-mention-dir">{dirName(item.value)}</span>
                  </Show>
                  <Show when={item.type === "directory"}>
                    <span class="file-mention-type-badge file-mention-type-dir">dir</span>
                    <span class="file-mention-name">{item.label}</span>
                  </Show>
                  <Show when={item.type === "agent"}>
                    <span class="file-mention-type-badge file-mention-type-agent">agent</span>
                    <span class="file-mention-name">{item.label}</span>
                    <Show when={item.description}>
                      <span class="file-mention-dir">{item.description}</span>
                    </Show>
                  </Show>
                  <Show when={item.type === "special"}>
                    <span class="file-mention-type-badge file-mention-type-special">@</span>
                    <span class="file-mention-name">{item.label}</span>
                    <Show when={item.description}>
                      <span class="file-mention-dir">{item.description}</span>
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
      <Show when={imageAttach.images().length > 0}>
        <div class="image-attachments">
          <For each={imageAttach.images()}>
            {(img) => (
              <div class="image-attachment">
                <img src={img.dataUrl} alt={img.filename} title={img.filename} />
                <button
                  type="button"
                  class="image-attachment-remove"
                  onClick={() => imageAttach.remove(img.id)}
                  aria-label="Remove image"
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={manualAttachments().length > 0}>
        <div class="file-attachments">
          <For each={manualAttachments()}>
            {(item) => (
              <div class="file-attachment-pill">
                <span class="file-attachment-pill-name">{item.filename}</span>
                <button
                  type="button"
                  class="file-attachment-pill-remove"
                  onClick={() => setManualAttachments((prev) => prev.filter((entry) => entry.id !== item.id))}
                  aria-label={language.t("prompt.attachment.remove")}
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={slashFeedback()}>
        <div
          style={{
            "margin-top": "6px",
            "margin-bottom": "2px",
            "font-size": "12px",
            color: "var(--vscode-terminal-ansiGreen, #16a34a)",
            "font-weight": "500",
          }}
        >
          {slashFeedback()}
        </div>
      </Show>
      <div class="prompt-input-wrapper">
        <div class="prompt-input-ghost-wrapper">
          <div class="prompt-input-highlight-overlay" ref={highlightRef} aria-hidden="true">
            <Index each={buildHighlightSegments(text(), mention.mentionedPaths())}>
              {(seg) => (
                <Show when={seg().highlight} fallback={<span>{seg().text}</span>}>
                  <span class="prompt-input-file-mention">{seg().text}</span>
                </Show>
              )}
            </Index>
            <Show when={ghostText()}>
              <span class="prompt-input-ghost-text">{ghostText()}</span>
            </Show>
          </div>
          <textarea
            ref={textareaRef}
            class="prompt-input"
            placeholder={
              isDisabled() ? language.t("prompt.placeholder.connecting") : language.t("prompt.placeholder.default")
            }
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onScroll={syncHighlightScroll}
            disabled={isDisabled()}
            rows={1}
          />
        </div>
      </div>
      <Show when={showBusyActions()}>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-top": "8px", "flex-wrap": "wrap" }}>
          <Button size="small" variant="secondary" onClick={() => handleBusySend("guide")}>
            立即插入
          </Button>
          <Button size="small" variant="secondary" onClick={() => handleBusySend("queue")}>
            加入队列
          </Button>
          <Button size="small" variant="ghost" onClick={() => handleBusySend("interrupt")}>
            中断并发送
          </Button>
          <Button size="small" variant="ghost" onClick={() => setShowBusyActions(false)}>
            取消
          </Button>
        </div>
      </Show>
      <Show when={session.promptQueue().length > 0}>
        <div style={{ "margin-top": "8px", display: "grid", gap: "6px" }}>
          <For each={session.promptQueue()}>
            {(item, index) => (
              <div style={{ display: "flex", "justify-content": "space-between", gap: "8px", "align-items": "center" }}>
                <span style={{ "font-size": "11px", opacity: 0.85 }}>{item.text.slice(0, 60)}</span>
                <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                  <Button size="small" variant="ghost" onClick={() => reorderQueueItem(index(), 0)} disabled={index() === 0}>
                    Top
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => reorderQueueItem(index(), index() - 1)}
                    disabled={index() === 0}
                  >
                    Up
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => reorderQueueItem(index(), index() + 1)}
                    disabled={index() >= session.promptQueue().length - 1}
                  >
                    Down
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => session.dequeuePrompt(item.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="prompt-input-hint">
        <div class="prompt-input-hint-selectors">
          <ModeSwitcher />
          <ModelSelector />
          <ThinkingSelector />
        </div>
        <div class="prompt-input-hint-actions">
          <Tooltip value={language.t("prompt.action.codebaseIndex")} placement="top">
            <Button
              variant="ghost"
              size="small"
              onClick={openCodebaseIndexDialog}
              disabled={isDisabled()}
              aria-label={language.t("prompt.action.codebaseIndex")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <ellipse cx="8" cy="3.5" rx="5.5" ry="2.5" />
                <path d="M2.5 3.5V7c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V3.5" fill="none" stroke="currentColor" stroke-width="1.2" />
                <path d="M2.5 7v3.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7" fill="none" stroke="currentColor" stroke-width="1.2" />
              </svg>
            </Button>
          </Tooltip>
          <Tooltip value={language.t("prompt.action.addContext")} placement="top">
            <Button
              variant="ghost"
              size="small"
              onClick={addAtMention}
              disabled={isDisabled()}
              aria-label={language.t("prompt.action.addContext")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 1.5a6.5 6.5 0 1 0 3.56 11.95l-.78-1.02A5.2 5.2 0 1 1 13.2 8v.56c0 .7-.56 1.27-1.25 1.27-.68 0-1.24-.56-1.24-1.24V8A2.7 2.7 0 1 0 8 10.73c.5 0 .96-.14 1.36-.39.5.53 1.22.87 2.03.87 1.5 0 2.73-1.24 2.73-2.77V8A6.5 6.5 0 0 0 8 1.5Zm0 3.44A1.95 1.95 0 1 1 6.06 6.9 1.95 1.95 0 0 1 8 4.94Z" />
              </svg>
            </Button>
          </Tooltip>
          <Tooltip value={language.t("prompt.action.attachFile")} placement="top">
            <Button
              variant="ghost"
              size="small"
              onClick={() => attachInputRef?.click()}
              disabled={isDisabled()}
              aria-label={language.t("prompt.action.attachFile")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M11.5 4.5a3 3 0 0 0-4.24 0L3.68 8.08a2 2 0 1 0 2.83 2.83l3.18-3.18a1 1 0 0 0-1.41-1.41L5.45 9.15a.5.5 0 1 1-.71-.71l2.83-2.83a2 2 0 1 1 2.83 2.83l-3.54 3.54a3.5 3.5 0 0 1-4.95-4.95l3.58-3.58a4 4 0 1 1 5.66 5.66l-3.18 3.18" />
              </svg>
            </Button>
          </Tooltip>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileInput}
          />
          {/* ✨ Enhance 按钮 */}
          <Show when={text().trim().length > 0}>
            <Tooltip value={language.t("prompt.action.enhance")} placement="top">
              <Button
                variant="ghost"
                size="small"
                onClick={() => enhance.enhance(text(), contextItems())}
                disabled={enhance.isEnhancing() || isDisabled()}
                aria-label={language.t("prompt.action.enhance")}
                class={enhance.isEnhancing() ? "prompt-enhance-btn--loading" : ""}
              >
                <Show
                  when={!enhance.isEnhancing()}
                  fallback={
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="prompt-enhance-spin">
                      <path d="M8 1a7 7 0 1 0 7 7A7 7 0 0 0 8 1zm0 12a5 5 0 1 1 5-5 5 5 0 0 1-5 5z" opacity="0.3"/>
                      <path d="M15 8a7 7 0 0 0-7-7V3a5 5 0 0 1 5 5z"/>
                    </svg>
                  }
                >
                  ✨
                </Show>
              </Button>
            </Tooltip>
          </Show>
          <Tooltip value={language.t("prompt.action.send")} placement="top">
            <Button
              variant="primary"
              size="small"
              onClick={handleSend}
              disabled={!canSend()}
              aria-label={language.t("prompt.action.send")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 1.5L14.5 8L1.5 14.5V9L10 8L1.5 7V1.5Z" />
              </svg>
            </Button>
          </Tooltip>
          <Show when={isBusy()}>
            <Tooltip value={language.t("prompt.action.stop")} placement="top">
              <Button
                variant="ghost"
                size="small"
                onClick={() => session.abort()}
                aria-label={language.t("prompt.action.stop")}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="1" />
                </svg>
              </Button>
            </Tooltip>
          </Show>
          <Tooltip value={language.t("prompt.action.agentBehaviour")} placement="top">
            <Button
              variant="ghost"
              size="small"
              onClick={openAgentBehaviourDialog}
              aria-label={language.t("prompt.action.agentBehaviour")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 2a3 3 0 1 0 3 3 3 3 0 0 0-3-3Zm-5 11a5 5 0 1 1 10 0v1H3Z" />
              </svg>
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}


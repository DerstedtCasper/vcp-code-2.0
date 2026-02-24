/**
 * PromptInput component
 * Text input with send/abort buttons, ghost-text autocomplete, and @ file mention support
 */

import { Component, createSignal, createEffect, on, For, Index, onCleanup, Show, untrack, createMemo } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { ModelSelector } from "./ModelSelector"
import { ModeSwitcher } from "./ModeSwitcher"
import { ThinkingSelector } from "./ThinkingSelector"
import { decodeAgentMentionResult, isAgentMentionResult, useFileMention } from "../../hooks/useFileMention"
import { useImageAttachments } from "../../hooks/useImageAttachments"
import { fileName, dirName, buildHighlightSegments } from "./prompt-input-utils"

const AUTOCOMPLETE_DEBOUNCE_MS = 500
const MIN_TEXT_LENGTH = 3

// Per-session input text storage (module-level so it survives remounts)
const drafts = new Map<string, string>()

export const PromptInput: Component = () => {
  const session = useSession()
  const server = useServer()
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const vscode = useVSCode()
  const agentMentionNames = createMemo(() =>
    session
      .agents()
      .map((agent) => agent.name?.trim())
      .filter((name): name is string => Boolean(name)),
  )
  const mention = useFileMention(vscode, agentMentionNames)
  const imageAttach = useImageAttachments()

  const sessionKey = () => session.currentSessionID() ?? "__new__"

  const [text, setText] = createSignal("")
  const [ghostText, setGhostText] = createSignal("")
  const [showBusyActions, setShowBusyActions] = createSignal(false)
  const [showSlash, setShowSlash] = createSignal(false)
  const [slashQuery, setSlashQuery] = createSignal("")
  const [slashIndex, setSlashIndex] = createSignal(0)

  let textareaRef: HTMLTextAreaElement | undefined
  let highlightRef: HTMLDivElement | undefined
  let dropdownRef: HTMLDivElement | undefined
  let slashDropdownRef: HTMLDivElement | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let requestCounter = 0
  // Save/restore input text when switching sessions.
  // Uses `on()` to track only sessionKey 鈥?avoids re-running on every keystroke.
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
  const canSend = () => (text().trim().length > 0 || imageAttach.images().length > 0) && !isBusy() && !isDisabled()

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
  })

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

  type SlashCommandOption = { trigger: string; title: string; description?: string; type: "custom" | "builtin" }
  const AGENT_TEAM_MODE = "__vcp_agent_team__"

  const cycleAgentMode = () => {
    const modes = session
      .agents()
      .map((agent) => agent.name?.trim())
      .filter((name): name is string => Boolean(name))
    const currentAgent = session.selectedAgent()?.trim()
    if (modes.length === 0 && currentAgent) {
      modes.push(currentAgent)
    }
    if (modes.length === 0) return

    const isTeamEnabled = config().vcp?.agentTeam?.enabled ?? false
    const order = [AGENT_TEAM_MODE, ...modes]
    const current = isTeamEnabled ? AGENT_TEAM_MODE : session.selectedAgent()
    const index = order.indexOf(current)
    const next = order[(index + 1 + order.length) % order.length]

    if (next === AGENT_TEAM_MODE) {
      updateConfig({
        vcp: {
          ...(config().vcp ?? {}),
          agentTeam: {
            ...(config().vcp?.agentTeam ?? {}),
            enabled: true,
          },
        },
      })
      return
    }

    if (isTeamEnabled) {
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
    session.selectAgent(next)
  }

  const builtinSlashCommands = createMemo<SlashCommandOption[]>(() => [
    { trigger: "new", title: language.t("command.session.new"), type: "builtin" },
    {
      trigger: "undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      type: "builtin",
    },
    {
      trigger: "redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      type: "builtin",
    },
    {
      trigger: "compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      type: "builtin",
    },
    {
      trigger: "fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      type: "builtin",
    },
    {
      trigger: "share",
      title: language.t("command.session.share"),
      description: language.t("command.session.share.description"),
      type: "builtin",
    },
    {
      trigger: "unshare",
      title: language.t("command.session.unshare"),
      description: language.t("command.session.unshare.description"),
      type: "builtin",
    },
    {
      trigger: "provider",
      title: language.t("command.provider.connect"),
      description: language.t("settings.providers.title"),
      type: "builtin",
    },
    {
      trigger: "vcp",
      title: language.t("vcp.view.title"),
      description: language.t("vcp.view.protocol.title"),
      type: "builtin",
    },
    {
      trigger: "model",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      type: "builtin",
    },
    {
      trigger: "agent",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      type: "builtin",
    },
    { trigger: "settings", title: language.t("command.settings.open"), type: "builtin" },
    { trigger: "project", title: language.t("command.project.open"), type: "builtin" },
    { trigger: "terminal", title: language.t("command.terminal.toggle"), type: "builtin" },
  ])

  const slashCommands = createMemo<SlashCommandOption[]>(() => {
    const custom = Object.entries(config().command ?? {}).map(([name, cmd]) => ({
      trigger: name,
      title: name,
      description: cmd.description,
      type: "custom" as const,
    }))
    const seen = new Set(custom.map((item) => item.trigger.toLowerCase()))
    const builtins = builtinSlashCommands().filter((item) => !seen.has(item.trigger.toLowerCase()))
    return [...custom, ...builtins]
  })

  const filteredSlashCommands = createMemo(() => {
    const query = slashQuery().trim().toLowerCase()
    if (!query) return slashCommands()
    return slashCommands().filter(
      (item) => item.trigger.toLowerCase().includes(query) || item.title.toLowerCase().includes(query),
    )
  })

  const closeSlash = () => {
    setShowSlash(false)
    setSlashQuery("")
    setSlashIndex(0)
  }

  const extractSlashQuery = (value: string, cursor: number) => {
    const beforeCursor = value.slice(0, cursor)
    const lineStart = beforeCursor.lastIndexOf("\n") + 1
    const fragment = beforeCursor.slice(lineStart)
    if (!fragment.startsWith("/")) return
    if (fragment.includes(" ")) return
    return {
      lineStart,
      fragmentEnd: lineStart + fragment.length,
      query: fragment.slice(1),
    }
  }

  const applySlashCommand = (command: SlashCommandOption) => {
    if (command.type === "builtin") {
      switch (command.trigger) {
        case "new":
          session.createSession()
          closeSlash()
          return
        case "undo":
          session.undo()
          closeSlash()
          return
        case "redo":
          session.redo()
          closeSlash()
          return
        case "fork":
          session.fork()
          closeSlash()
          return
        case "compact":
          session.compact()
          closeSlash()
          return
        case "share":
          session.share()
          closeSlash()
          return
        case "unshare":
          session.unshare()
          closeSlash()
          return
        case "provider":
          window.postMessage({ type: "action", action: "providersButtonClicked" }, "*")
          closeSlash()
          return
        case "vcp":
          window.postMessage({ type: "action", action: "vcpButtonClicked" }, "*")
          closeSlash()
          return
        case "settings":
          window.postMessage({ type: "action", action: "settingsButtonClicked" }, "*")
          closeSlash()
          return
        case "model":
          window.postMessage({ type: "action", action: "providersButtonClicked" }, "*")
          closeSlash()
          return
        case "terminal":
          window.postMessage({ type: "action", action: "terminalButtonClicked" }, "*")
          closeSlash()
          return
        case "project":
          window.postMessage({ type: "action", action: "historyButtonClicked" }, "*")
          closeSlash()
          return
        case "agent":
          cycleAgentMode()
          closeSlash()
          return
      }
    }

    if (!textareaRef) return
    const selectionEnd = textareaRef.selectionEnd ?? text().length
    const context = extractSlashQuery(text(), selectionEnd)
    if (!context) return

    const replacement = `/${command.trigger} `
    const nextText = text().slice(0, context.lineStart) + replacement + text().slice(context.fragmentEnd)
    setText(nextText)
    textareaRef.value = nextText
    const nextCursor = context.lineStart + replacement.length
    textareaRef.setSelectionRange(nextCursor, nextCursor)
    adjustHeight()
    syncHighlightScroll()
    closeSlash()
  }

  const scrollToActiveSlash = () => {
    if (!slashDropdownRef) return
    const items = slashDropdownRef.querySelectorAll(".slash-command-item")
    const active = items[slashIndex()] as HTMLElement | undefined
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
    const cursor = target.selectionStart ?? val.length
    setText(val)
    adjustHeight()
    setGhostText("")
    syncHighlightScroll()

    mention.onInput(val, cursor)

    if (mention.showMention()) {
      closeSlash()
      setGhostText("")
      if (debounceTimer) clearTimeout(debounceTimer)
      return
    }

    const slashContext = extractSlashQuery(val, cursor)
    if (slashContext) {
      setSlashQuery(slashContext.query)
      setShowSlash(true)
      setSlashIndex(0)
    } else {
      closeSlash()
    }

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => requestAutocomplete(val), AUTOCOMPLETE_DEBOUNCE_MS)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mention.onKeyDown(e, textareaRef, setText, adjustHeight)) {
      closeSlash()
      setGhostText("")
      queueMicrotask(scrollToActiveItem)
      return
    }

    if (showSlash()) {
      const items = filteredSlashCommands()
      if (e.key === "ArrowDown") {
        e.preventDefault()
        if (items.length > 0) {
          setSlashIndex((idx) => (idx + 1) % items.length)
          queueMicrotask(scrollToActiveSlash)
        }
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        if (items.length > 0) {
          setSlashIndex((idx) => (idx - 1 + items.length) % items.length)
          queueMicrotask(scrollToActiveSlash)
        }
        return
      }
      if (e.key === "Tab" || e.key === "Enter") {
        if (items.length > 0) {
          e.preventDefault()
          applySlashCommand(items[Math.min(slashIndex(), items.length - 1)])
        }
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        closeSlash()
        return
      }
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
    const imgFiles = imgs.map((img) => ({ mime: img.mime, url: img.dataUrl }))
    const allFiles = [...mentionFiles, ...imgFiles]
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
    if (debounceTimer) clearTimeout(debounceTimer)
    mention.closeMention()
    closeSlash()
    drafts.delete(sessionKey())
    if (textareaRef) textareaRef.style.height = "auto"
  }

  const handleSend = () => {
    const draft = buildDraftPayload()
    if (!draft || isDisabled()) return
    if (isBusy()) {
      setShowBusyActions(true)
      return
    }
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
      <Show when={mention.showMention()}>
        <div class="file-mention-dropdown" ref={dropdownRef}>
          <Show
            when={mention.mentionResults().length > 0}
            fallback={<div class="file-mention-empty">{language.t("prompt.popover.emptyResults")}</div>}
          >
            <For each={mention.mentionResults()}>
              {(item, index) => {
                const isAgent = isAgentMentionResult(item)
                const title = isAgent ? `@${decodeAgentMentionResult(item)}` : fileName(item)
                const detail = isAgent ? language.t("settings.agentBehaviour.title") : dirName(item)

                return (
                  <div
                    class="file-mention-item"
                    classList={{ "file-mention-item--active": index() === mention.mentionIndex() }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if (textareaRef) mention.selectFile(item, textareaRef, setText, adjustHeight)
                    }}
                    onMouseEnter={() => mention.setMentionIndex(index())}
                  >
                    <Show
                      when={isAgent}
                      fallback={<FileIcon node={{ path: item, type: "file" }} class="file-mention-icon" />}
                    >
                      <span class="file-mention-icon file-mention-agent-icon">@</span>
                    </Show>
                    <span class="file-mention-name">{title}</span>
                    <span class="file-mention-dir" classList={{ "file-mention-dir--kind": isAgent }}>
                      {detail}
                    </span>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>
      </Show>
      <Show when={showSlash() && !mention.showMention()}>
        <div class="slash-command-dropdown" ref={slashDropdownRef}>
          <Show
            when={filteredSlashCommands().length > 0}
            fallback={<div class="slash-command-empty">{language.t("prompt.popover.emptyCommands")}</div>}
          >
            <For each={filteredSlashCommands()}>
              {(item, index) => (
                <div
                  class="slash-command-item"
                  classList={{ "slash-command-item--active": index() === slashIndex() }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applySlashCommand(item)
                  }}
                  onMouseEnter={() => setSlashIndex(index())}
                >
                  <span class="slash-command-trigger">/{item.trigger}</span>
                  <span class="slash-command-title">{item.title}</span>
                  <Show when={item.description}>
                    <span class="slash-command-description">{item.description}</span>
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
                  x
                </button>
              </div>
            )}
          </For>
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
            Send now
          </Button>
          <Button size="small" variant="secondary" onClick={() => handleBusySend("queue")}>
            Queue
          </Button>
          <Button size="small" variant="ghost" onClick={() => handleBusySend("interrupt")}>
            Interrupt + send
          </Button>
          <Button size="small" variant="ghost" onClick={() => setShowBusyActions(false)}>
            {language.t("common.cancel")}
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
          <Tooltip value={language.t("prompt.action.send")} placement="top">
            <Button
              variant="primary"
              size="small"
              onClick={handleSend}
              disabled={isDisabled() || (text().trim().length === 0 && imageAttach.images().length === 0)}
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
        </div>
      </div>
    </div>
  )
}


import { Component, For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@novacode/nova-ui/button"
import { Card } from "@novacode/nova-ui/card"
import { IconButton } from "@novacode/nova-ui/icon-button"
import { Switch } from "@novacode/nova-ui/switch"
import { TextField } from "@novacode/nova-ui/text-field"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { Config, ExtensionMessage, MemoryAtomicItem, MemoryFolderDoc, MemoryProfile } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const ContextTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const vscode = useVSCode()

  const [newPattern, setNewPattern] = createSignal("")
  const [memoryQuery, setMemoryQuery] = createSignal("")
  const [memoryResults, setMemoryResults] = createSignal<Array<{ item: MemoryAtomicItem; score: number }>>([])
  const [memoryProfile, setMemoryProfile] = createSignal<MemoryProfile | undefined>(undefined)
  const [memoryFolders, setMemoryFolders] = createSignal<MemoryFolderDoc[]>([])
  const [memoryTotal, setMemoryTotal] = createSignal(0)
  const [previewQuery, setPreviewQuery] = createSignal("")
  const [previewText, setPreviewText] = createSignal("")
  const [previewCompressed, setPreviewCompressed] = createSignal(false)
  const [previewPinnedIDs, setPreviewPinnedIDs] = createSignal<string[]>([])
  const [previewRemovedIDs, setPreviewRemovedIDs] = createSignal<string[]>([])
  const [editingID, setEditingID] = createSignal<string | undefined>(undefined)
  const [editingText, setEditingText] = createSignal("")

  const patterns = () => config().watcher?.ignore ?? []
  const vcpMemory = () => config().vcp?.memory ?? {}
  const passive = () => vcpMemory().passive ?? {}
  const writer = () => vcpMemory().writer ?? {}
  const retrieval = () => vcpMemory().retrieval ?? {}
  const refresh = () => vcpMemory().refresh ?? {}

  const nextRequestID = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  const normalizeInteger = (value: string): number | undefined => {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const normalizeFloat = (value: string): number | undefined => {
    const parsed = Number.parseFloat(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const updateMemory = (partial: VcpMemory) => {
    updateConfig({
      vcp: {
        ...(config().vcp ?? {}),
        memory: {
          ...(vcpMemory() ?? {}),
          ...partial,
        },
      },
    })
  }

  const updatePassive = (partial: VcpMemoryPassive) => {
    updateMemory({
      ...(vcpMemory() ?? {}),
      passive: {
        ...(passive() ?? {}),
        ...partial,
      },
    })
  }

  const updateWriter = (partial: VcpMemoryWriter) => {
    updateMemory({
      ...(vcpMemory() ?? {}),
      writer: {
        ...(writer() ?? {}),
        ...partial,
      },
    })
  }

  const updateRetrieval = (partial: VcpMemoryRetrieval) => {
    updateMemory({
      ...(vcpMemory() ?? {}),
      retrieval: {
        ...(retrieval() ?? {}),
        ...partial,
      },
    })
  }

  const updateRefresh = (partial: VcpMemoryRefresh) => {
    updateMemory({
      ...(vcpMemory() ?? {}),
      refresh: {
        ...(refresh() ?? {}),
        ...partial,
      },
    })
  }

  const addPattern = () => {
    const value = newPattern().trim()
    if (!value) return
    const current = [...patterns()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ watcher: { ignore: current } })
    }
    setNewPattern("")
  }

  const removePattern = (index: number) => {
    const current = [...patterns()]
    current.splice(index, 1)
    updateConfig({ watcher: { ignore: current } })
  }

  const requestMemoryOverview = () => {
    const requestID = nextRequestID("memory-overview")
    vscode.postMessage({ type: "requestMemoryOverview", requestID, limit: 30 })
  }

  const searchMemory = () => {
    const query = memoryQuery().trim()
    if (!query) return
    const requestID = nextRequestID("memory-search")
    vscode.postMessage({
      type: "searchMemory",
      requestID,
      query,
      topK: retrieval().defaultTopK ?? 10,
      scope: "both",
    })
  }

  const requestPreview = () => {
    const query = previewQuery().trim()
    if (!query) return
    const requestID = nextRequestID("memory-preview")
    vscode.postMessage({
      type: "previewMemoryContext",
      requestID,
      query,
      topKAtomic: passive().topKAtomic ?? 5,
      maxChars: passive().maxChars ?? 4096,
      pinAtomicIDs: previewPinnedIDs(),
      removeAtomicIDs: previewRemovedIDs(),
      compress: previewCompressed(),
    })
  }

  const togglePinned = (id: string) => {
    setPreviewPinnedIDs((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
    setPreviewRemovedIDs((current) => current.filter((value) => value !== id))
  }

  const toggleRemoved = (id: string) => {
    setPreviewRemovedIDs((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
    setPreviewPinnedIDs((current) => current.filter((value) => value !== id))
  }

  const deleteMemory = (id: string) => {
    const requestID = nextRequestID("memory-delete")
    vscode.postMessage({ type: "deleteMemoryAtomic", requestID, id })
  }

  const saveEditingMemory = () => {
    const id = editingID()
    const text = editingText().trim()
    if (!id || !text) return
    const requestID = nextRequestID("memory-update")
    vscode.postMessage({ type: "updateMemoryAtomic", requestID, id, text })
    setEditingID(undefined)
    setEditingText("")
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "memoryOverview") {
      setMemoryTotal(message.data.atomicTotal)
      setMemoryProfile(message.data.profile)
      setMemoryFolders(message.data.folders)
      if (!memoryQuery().trim()) {
        setMemoryResults(message.data.recentAtomic.map((item) => ({ item, score: 0 })))
      }
      return
    }
    if (message.type === "memorySearchResult") {
      setMemoryResults(message.items)
      return
    }
    if (message.type === "memoryAtomicUpdated") {
      if (message.ok) requestMemoryOverview()
      return
    }
    if (message.type === "memoryAtomicDeleted") {
      if (message.ok) requestMemoryOverview()
      return
    }
    if (message.type === "memoryContextPreview") {
      setPreviewText(message.preview ?? "")
    }
  })

  onMount(() => requestMemoryOverview())
  onCleanup(unsubscribe)

  return (
    <div>
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>1) {language.t("settings.context.title")} / 基础压缩</h4>
      <Card style={{ "margin-bottom": "12px" }}>
        <SettingsRow
          title={language.t("settings.context.autoCompaction.title")}
          description={language.t("settings.context.autoCompaction.description")}
        >
          <Switch
            checked={config().compaction?.auto ?? false}
            onChange={(checked) => updateConfig({ compaction: { ...config().compaction, auto: checked } })}
            hideLabel
          >
            {language.t("settings.context.autoCompaction.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.prune.title")}
          description={language.t("settings.context.prune.description")}
          last
        >
          <Switch
            checked={config().compaction?.prune ?? false}
            onChange={(checked) => updateConfig({ compaction: { ...config().compaction, prune: checked } })}
            hideLabel
          >
            {language.t("settings.context.prune.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <Card style={{ "margin-bottom": "16px" }}>
        <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))", "padding-bottom": "8px" }}>
          {language.t("settings.context.watcherPatterns.description")}
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0" }}>
          <div style={{ flex: 1 }}>
            <TextField
              value={newPattern()}
              placeholder="e.g. **/node_modules/**"
              onChange={(val) => setNewPattern(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addPattern()
              }}
            />
          </div>
          <Button size="small" onClick={addPattern}>
            {language.t("common.add")}
          </Button>
        </div>
        <For each={patterns()}>
          {(pattern, index) => (
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "6px 0" }}>
              <span style={{ "font-family": "var(--vscode-editor-font-family, monospace)", "font-size": "12px" }}>{pattern}</span>
              <IconButton size="small" variant="ghost" icon="close" onClick={() => removePattern(index())} />
            </div>
          )}
        </For>
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>2) 记忆注入（Passive + Retrieval）</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <SettingsRow title="Memory Runtime Enabled" description="Master switch for VCP memory runtime.">
          <Switch checked={vcpMemory().enabled ?? false} onChange={(checked) => updateMemory({ enabled: checked })} hideLabel>
            Memory Runtime Enabled
          </Switch>
        </SettingsRow>
        <SettingsRow title="Passive Enabled" description="Inject memory snippets into system context.">
          <Switch checked={passive().enabled ?? true} onChange={(checked) => updatePassive({ enabled: checked })} hideLabel>
            Passive Enabled
          </Switch>
        </SettingsRow>
        <SettingsRow title="Include Profile" description="Include user profile memory in context injection.">
          <Switch checked={passive().includeProfile ?? true} onChange={(checked) => updatePassive({ includeProfile: checked })} hideLabel>
            Include Profile
          </Switch>
        </SettingsRow>
        <SettingsRow title="Include Folder Doc" description="Include folder-level memory summary in context injection.">
          <Switch checked={passive().includeFolderDoc ?? true} onChange={(checked) => updatePassive({ includeFolderDoc: checked })} hideLabel>
            Include Folder Doc
          </Switch>
        </SettingsRow>
        <SettingsRow title="Include Session Snippets" description="Include relevant snippets from current session messages.">
          <Switch
            checked={passive().includeSessionSnippets ?? true}
            onChange={(checked) => updatePassive({ includeSessionSnippets: checked })}
            hideLabel
          >
            Include Session Snippets
          </Switch>
        </SettingsRow>
        <SettingsRow title="Top K Atomic" description="Top-K atomic memories for passive injection.">
          <TextField value={passive().topKAtomic?.toString() ?? ""} onChange={(val) => updatePassive({ topKAtomic: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow title="Top K Session" description="Top-K session snippets for passive injection.">
          <TextField value={passive().topKSession?.toString() ?? ""} onChange={(val) => updatePassive({ topKSession: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow title="Max Chars" description="Maximum injected memory context size." last>
          <TextField value={passive().maxChars?.toString() ?? ""} onChange={(val) => updatePassive({ maxChars: normalizeInteger(val) })} />
        </SettingsRow>
      </Card>

      <Card style={{ "margin-bottom": "16px" }}>
        <SettingsRow title="Retrieval Enabled" description="Enable retrieval parameter overrides for memory queries.">
          <Switch checked={retrieval().enabled ?? false} onChange={(checked) => updateRetrieval({ enabled: checked })} hideLabel>
            Retrieval Enabled
          </Switch>
        </SettingsRow>
        <SettingsRow title="Semantic Weight" description="Semantic route weight (0~1).">
          <TextField value={retrieval().semanticWeight?.toString() ?? ""} onChange={(val) => updateRetrieval({ semanticWeight: normalizeFloat(val) })} />
        </SettingsRow>
        <SettingsRow title="Time Weight" description="Time route weight (0~1).">
          <TextField value={retrieval().timeWeight?.toString() ?? ""} onChange={(val) => updateRetrieval({ timeWeight: normalizeFloat(val) })} />
        </SettingsRow>
        <SettingsRow title="Default Top K" description="Default memory search top-K." last>
          <TextField value={retrieval().defaultTopK?.toString() ?? ""} onChange={(val) => updateRetrieval({ defaultTopK: normalizeInteger(val) })} />
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>3) 记忆写入（Writer + Refresh）</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <SettingsRow title="Writer Enabled" description="Write memory asynchronously after each user message.">
          <Switch checked={writer().enabled ?? true} onChange={(checked) => updateWriter({ enabled: checked })} hideLabel>
            Writer Enabled
          </Switch>
        </SettingsRow>
        <SettingsRow title="Min Chars" description="Minimum message length to trigger writer.">
          <TextField value={writer().minChars?.toString() ?? ""} onChange={(val) => updateWriter({ minChars: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow title="Max Atomic" description="Maximum retained atomic memories.">
          <TextField value={writer().maxAtomic?.toString() ?? ""} onChange={(val) => updateWriter({ maxAtomic: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow title="Max Per Message" description="Maximum memory writes per user message.">
          <TextField value={writer().maxPerMessage?.toString() ?? ""} onChange={(val) => updateWriter({ maxPerMessage: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow title="Force First Message" description="Always write memory on the first user message in a session.">
          <Switch checked={writer().forceFirstMessage ?? true} onChange={(checked) => updateWriter({ forceFirstMessage: checked })} hideLabel>
            Force First Message
          </Switch>
        </SettingsRow>
        <SettingsRow title="Update Profile" description="Allow writer to update user profile memory.">
          <Switch checked={writer().updateProfile ?? true} onChange={(checked) => updateWriter({ updateProfile: checked })} hideLabel>
            Update Profile
          </Switch>
        </SettingsRow>
        <SettingsRow title="Update Folder Doc" description="Allow writer to update folder document memory." last>
          <Switch checked={writer().updateFolderDoc ?? true} onChange={(checked) => updateWriter({ updateFolderDoc: checked })} hideLabel>
            Update Folder Doc
          </Switch>
        </SettingsRow>
      </Card>

      <Card style={{ "margin-bottom": "16px" }}>
        <SettingsRow title="Refresh Enabled" description="Enable post-tool memory refresh strategy.">
          <Switch checked={refresh().enabled ?? false} onChange={(checked) => updateRefresh({ enabled: checked })} hideLabel>
            Refresh Enabled
          </Switch>
        </SettingsRow>
        <SettingsRow title="After Tool Call" description="Refresh memory after tool execution.">
          <Switch checked={refresh().afterToolCall ?? false} onChange={(checked) => updateRefresh({ afterToolCall: checked })} hideLabel>
            After Tool Call
          </Switch>
        </SettingsRow>
        <SettingsRow title="Profile Weight" description="Refresh weight for profile memory (0~1).">
          <TextField value={refresh().profileWeight?.toString() ?? ""} onChange={(val) => updateRefresh({ profileWeight: normalizeFloat(val) })} />
        </SettingsRow>
        <SettingsRow title="Folder Weight" description="Refresh weight for folder memory (0~1)." last>
          <TextField value={refresh().folderWeight?.toString() ?? ""} onChange={(val) => updateRefresh({ folderWeight: normalizeFloat(val) })} />
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>4) 记忆库管理（Overview / Search / Update / Delete）</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": "8px" }}>
          <Button size="small" onClick={requestMemoryOverview}>
            Refresh
          </Button>
          <span style={{ "font-size": "12px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
            Atomic Total: {memoryTotal()}
          </span>
        </div>

        <Show when={memoryProfile()}>
          <div style={{ "font-size": "12px", "margin-bottom": "8px" }}>
            <div>Profile.preferences: {memoryProfile()?.preferences.join(" | ") || "-"}</div>
            <div>Profile.style: {memoryProfile()?.style.join(" | ") || "-"}</div>
            <div>Profile.facts: {memoryProfile()?.facts.join(" | ") || "-"}</div>
          </div>
        </Show>

        <Show when={memoryFolders().length > 0}>
          <div style={{ "font-size": "12px", "margin-bottom": "8px" }}>
            <For each={memoryFolders()}>
              {(folder) => <div>{folder.folderID}: {folder.summary}</div>}
            </For>
          </div>
        </Show>

        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": "8px" }}>
          <div style={{ flex: 1 }}>
            <TextField
              value={memoryQuery()}
              placeholder="Search memory..."
              onChange={(val) => setMemoryQuery(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") searchMemory()
              }}
            />
          </div>
          <Button size="small" onClick={searchMemory}>
            Search
          </Button>
        </div>

        <For each={memoryResults()}>
          {(hit) => (
            <div style={{ padding: "6px 0", "border-top": "1px solid var(--border-weak-base)" }}>
              <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                {hit.item.scope}/{hit.item.role} score={hit.score.toFixed(3)} id={hit.item.id}
              </div>
              <Show
                when={editingID() === hit.item.id}
                fallback={
                  <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                    <span style={{ "font-size": "12px", flex: 1 }}>{hit.item.text}</span>
                    <Button size="small" variant="ghost" onClick={() => { setEditingID(hit.item.id); setEditingText(hit.item.text) }}>
                      Edit
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => togglePinned(hit.item.id)}>
                      {previewPinnedIDs().includes(hit.item.id) ? "Unpin" : "Pin"}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => toggleRemoved(hit.item.id)}>
                      {previewRemovedIDs().includes(hit.item.id) ? "Include" : "Exclude"}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => deleteMemory(hit.item.id)}>
                      Delete
                    </Button>
                  </div>
                }
              >
                <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                  <div style={{ flex: 1 }}>
                    <TextField value={editingText()} onChange={(val) => setEditingText(val)} />
                  </div>
                  <Button size="small" onClick={saveEditingMemory}>
                    Save
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => { setEditingID(undefined); setEditingText("") }}>
                    Cancel
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>5) 上下文盒规则（Context Box Preview）</h4>
      <Card>
        <div style={{ display: "flex", gap: "12px", "align-items": "center", "margin-bottom": "8px" }}>
          <Switch checked={previewCompressed()} onChange={(checked) => setPreviewCompressed(checked)} hideLabel>
            Compress Preview
          </Switch>
          <span style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
            pin: {previewPinnedIDs().length} | exclude: {previewRemovedIDs().length}
          </span>
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              setPreviewPinnedIDs([])
              setPreviewRemovedIDs([])
            }}
          >
            Clear Overrides
          </Button>
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": "8px" }}>
          <div style={{ flex: 1 }}>
            <TextField
              value={previewQuery()}
              placeholder="Input a query to preview context box..."
              onChange={(val) => setPreviewQuery(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") requestPreview()
              }}
            />
          </div>
          <Button size="small" onClick={requestPreview}>
            Preview
          </Button>
        </div>
        <TextField value={previewText()} multiline placeholder="Context preview will appear here..." onChange={() => undefined} />
      </Card>
    </div>
  )
}

export default ContextTab
  type VcpMemory = NonNullable<NonNullable<Config["vcp"]>["memory"]>
  type VcpMemoryPassive = NonNullable<VcpMemory["passive"]>
  type VcpMemoryWriter = NonNullable<VcpMemory["writer"]>
  type VcpMemoryRetrieval = NonNullable<VcpMemory["retrieval"]>
  type VcpMemoryRefresh = NonNullable<VcpMemory["refresh"]>

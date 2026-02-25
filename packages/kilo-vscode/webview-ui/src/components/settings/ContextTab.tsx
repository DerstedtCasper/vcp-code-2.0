import { Component, For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"

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
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>
        1) {language.t("settings.context.title")} / {language.t("settings.context.section.compaction")}
      </h4>
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
              placeholder={language.t("settings.context.watcherPatterns.placeholder")}
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

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>2) {language.t("settings.context.section.memoryInjection")}</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <SettingsRow
          title={language.t("settings.context.memory.runtime.title")}
          description={language.t("settings.context.memory.runtime.description")}
        >
          <Switch checked={vcpMemory().enabled ?? false} onChange={(checked) => updateMemory({ enabled: checked })} hideLabel>
            {language.t("settings.context.memory.runtime.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.passive.enabled.title")}
          description={language.t("settings.context.memory.passive.enabled.description")}
        >
          <Switch checked={passive().enabled ?? true} onChange={(checked) => updatePassive({ enabled: checked })} hideLabel>
            {language.t("settings.context.memory.passive.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.passive.includeProfile.title")}
          description={language.t("settings.context.memory.passive.includeProfile.description")}
        >
          <Switch checked={passive().includeProfile ?? true} onChange={(checked) => updatePassive({ includeProfile: checked })} hideLabel>
            {language.t("settings.context.memory.passive.includeProfile.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.passive.includeFolderDoc.title")}
          description={language.t("settings.context.memory.passive.includeFolderDoc.description")}
        >
          <Switch checked={passive().includeFolderDoc ?? true} onChange={(checked) => updatePassive({ includeFolderDoc: checked })} hideLabel>
            {language.t("settings.context.memory.passive.includeFolderDoc.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.passive.includeSessionSnippets.title")}
          description={language.t("settings.context.memory.passive.includeSessionSnippets.description")}
        >
          <Switch
            checked={passive().includeSessionSnippets ?? true}
            onChange={(checked) => updatePassive({ includeSessionSnippets: checked })}
            hideLabel
          >
            {language.t("settings.context.memory.passive.includeSessionSnippets.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.passive.topKAtomic.title")}
          description={language.t("settings.context.memory.passive.topKAtomic.description")}
        >
          <TextField value={passive().topKAtomic?.toString() ?? ""} onChange={(val) => updatePassive({ topKAtomic: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.passive.topKSession.title")}
          description={language.t("settings.context.memory.passive.topKSession.description")}
        >
          <TextField value={passive().topKSession?.toString() ?? ""} onChange={(val) => updatePassive({ topKSession: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.passive.maxChars.title")}
          description={language.t("settings.context.memory.passive.maxChars.description")}
          last
        >
          <TextField value={passive().maxChars?.toString() ?? ""} onChange={(val) => updatePassive({ maxChars: normalizeInteger(val) })} />
        </SettingsRow>
      </Card>

      <Card style={{ "margin-bottom": "16px" }}>
        <SettingsRow
          title={language.t("settings.context.memory.retrieval.enabled.title")}
          description={language.t("settings.context.memory.retrieval.enabled.description")}
        >
          <Switch checked={retrieval().enabled ?? false} onChange={(checked) => updateRetrieval({ enabled: checked })} hideLabel>
            {language.t("settings.context.memory.retrieval.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.retrieval.semanticWeight.title")}
          description={language.t("settings.context.memory.retrieval.semanticWeight.description")}
        >
          <TextField value={retrieval().semanticWeight?.toString() ?? ""} onChange={(val) => updateRetrieval({ semanticWeight: normalizeFloat(val) })} />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.retrieval.timeWeight.title")}
          description={language.t("settings.context.memory.retrieval.timeWeight.description")}
        >
          <TextField value={retrieval().timeWeight?.toString() ?? ""} onChange={(val) => updateRetrieval({ timeWeight: normalizeFloat(val) })} />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.retrieval.defaultTopK.title")}
          description={language.t("settings.context.memory.retrieval.defaultTopK.description")}
          last
        >
          <TextField value={retrieval().defaultTopK?.toString() ?? ""} onChange={(val) => updateRetrieval({ defaultTopK: normalizeInteger(val) })} />
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>3) {language.t("settings.context.section.memoryWriter")}</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <SettingsRow
          title={language.t("settings.context.memory.writer.enabled.title")}
          description={language.t("settings.context.memory.writer.enabled.description")}
        >
          <Switch checked={writer().enabled ?? true} onChange={(checked) => updateWriter({ enabled: checked })} hideLabel>
            {language.t("settings.context.memory.writer.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.writer.minChars.title")}
          description={language.t("settings.context.memory.writer.minChars.description")}
        >
          <TextField value={writer().minChars?.toString() ?? ""} onChange={(val) => updateWriter({ minChars: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.writer.maxAtomic.title")}
          description={language.t("settings.context.memory.writer.maxAtomic.description")}
        >
          <TextField value={writer().maxAtomic?.toString() ?? ""} onChange={(val) => updateWriter({ maxAtomic: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.writer.maxPerMessage.title")}
          description={language.t("settings.context.memory.writer.maxPerMessage.description")}
        >
          <TextField value={writer().maxPerMessage?.toString() ?? ""} onChange={(val) => updateWriter({ maxPerMessage: normalizeInteger(val) })} />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.writer.forceFirstMessage.title")}
          description={language.t("settings.context.memory.writer.forceFirstMessage.description")}
        >
          <Switch checked={writer().forceFirstMessage ?? true} onChange={(checked) => updateWriter({ forceFirstMessage: checked })} hideLabel>
            {language.t("settings.context.memory.writer.forceFirstMessage.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.writer.updateProfile.title")}
          description={language.t("settings.context.memory.writer.updateProfile.description")}
        >
          <Switch checked={writer().updateProfile ?? true} onChange={(checked) => updateWriter({ updateProfile: checked })} hideLabel>
            {language.t("settings.context.memory.writer.updateProfile.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.writer.updateFolderDoc.title")}
          description={language.t("settings.context.memory.writer.updateFolderDoc.description")}
          last
        >
          <Switch checked={writer().updateFolderDoc ?? true} onChange={(checked) => updateWriter({ updateFolderDoc: checked })} hideLabel>
            {language.t("settings.context.memory.writer.updateFolderDoc.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <Card style={{ "margin-bottom": "16px" }}>
        <SettingsRow
          title={language.t("settings.context.memory.refresh.enabled.title")}
          description={language.t("settings.context.memory.refresh.enabled.description")}
        >
          <Switch checked={refresh().enabled ?? false} onChange={(checked) => updateRefresh({ enabled: checked })} hideLabel>
            {language.t("settings.context.memory.refresh.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.refresh.afterToolCall.title")}
          description={language.t("settings.context.memory.refresh.afterToolCall.description")}
        >
          <Switch checked={refresh().afterToolCall ?? false} onChange={(checked) => updateRefresh({ afterToolCall: checked })} hideLabel>
            {language.t("settings.context.memory.refresh.afterToolCall.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.refresh.profileWeight.title")}
          description={language.t("settings.context.memory.refresh.profileWeight.description")}
        >
          <TextField value={refresh().profileWeight?.toString() ?? ""} onChange={(val) => updateRefresh({ profileWeight: normalizeFloat(val) })} />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.memory.refresh.folderWeight.title")}
          description={language.t("settings.context.memory.refresh.folderWeight.description")}
          last
        >
          <TextField value={refresh().folderWeight?.toString() ?? ""} onChange={(val) => updateRefresh({ folderWeight: normalizeFloat(val) })} />
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>4) {language.t("settings.context.section.memoryAdmin")}</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": "8px" }}>
          <Button size="small" onClick={requestMemoryOverview}>
            {language.t("common.refresh")}
          </Button>
          <span style={{ "font-size": "12px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
            {language.t("settings.context.memory.admin.atomicTotal", { count: memoryTotal() })}
          </span>
        </div>

        <Show when={memoryProfile()}>
          <div style={{ "font-size": "12px", "margin-bottom": "8px" }}>
            <div>{language.t("settings.context.memory.admin.profile.preferences")}: {memoryProfile()?.preferences.join(" | ") || "-"}</div>
            <div>{language.t("settings.context.memory.admin.profile.style")}: {memoryProfile()?.style.join(" | ") || "-"}</div>
            <div>{language.t("settings.context.memory.admin.profile.facts")}: {memoryProfile()?.facts.join(" | ") || "-"}</div>
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
              placeholder={language.t("settings.context.memory.admin.search.placeholder")}
              onChange={(val) => setMemoryQuery(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") searchMemory()
              }}
            />
          </div>
          <Button size="small" onClick={searchMemory}>
            {language.t("settings.context.memory.admin.search.action")}
          </Button>
        </div>

        <For each={memoryResults()}>
          {(hit) => (
            <div style={{ padding: "6px 0", "border-top": "1px solid var(--border-weak-base)" }}>
              <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                {hit.item.scope}/{hit.item.role} {language.t("settings.context.memory.admin.score")}={hit.score.toFixed(3)}{" "}
                {language.t("settings.context.memory.admin.id")}={hit.item.id}
              </div>
              <Show
                when={editingID() === hit.item.id}
                fallback={
                  <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                    <span style={{ "font-size": "12px", flex: 1 }}>{hit.item.text}</span>
                    <Button size="small" variant="ghost" onClick={() => { setEditingID(hit.item.id); setEditingText(hit.item.text) }}>
                      {language.t("common.edit")}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => togglePinned(hit.item.id)}>
                      {previewPinnedIDs().includes(hit.item.id)
                        ? language.t("settings.context.memory.admin.pin.off")
                        : language.t("settings.context.memory.admin.pin.on")}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => toggleRemoved(hit.item.id)}>
                      {previewRemovedIDs().includes(hit.item.id)
                        ? language.t("settings.context.memory.admin.exclude.off")
                        : language.t("settings.context.memory.admin.exclude.on")}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => deleteMemory(hit.item.id)}>
                      {language.t("common.delete")}
                    </Button>
                  </div>
                }
              >
                <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                  <div style={{ flex: 1 }}>
                    <TextField value={editingText()} onChange={(val) => setEditingText(val)} />
                  </div>
                  <Button size="small" onClick={saveEditingMemory}>
                    {language.t("common.save")}
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => { setEditingID(undefined); setEditingText("") }}>
                    {language.t("common.cancel")}
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>5) {language.t("settings.context.section.preview")}</h4>
      <Card>
        <div style={{ display: "flex", gap: "12px", "align-items": "center", "margin-bottom": "8px" }}>
          <Switch checked={previewCompressed()} onChange={(checked) => setPreviewCompressed(checked)} hideLabel>
            {language.t("settings.context.preview.compress")}
          </Switch>
          <span style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
            {language.t("settings.context.preview.stats", { pinned: previewPinnedIDs().length, excluded: previewRemovedIDs().length })}
          </span>
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              setPreviewPinnedIDs([])
              setPreviewRemovedIDs([])
            }}
          >
            {language.t("settings.context.preview.clear")}
          </Button>
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": "8px" }}>
          <div style={{ flex: 1 }}>
            <TextField
              value={previewQuery()}
              placeholder={language.t("settings.context.preview.query.placeholder")}
              onChange={(val) => setPreviewQuery(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") requestPreview()
              }}
            />
          </div>
          <Button size="small" onClick={requestPreview}>
            {language.t("settings.context.preview.action")}
          </Button>
        </div>
        <TextField
          value={previewText()}
          multiline
          placeholder={language.t("settings.context.preview.result.placeholder")}
          onChange={() => undefined}
        />
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

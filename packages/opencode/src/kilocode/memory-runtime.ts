import { Config } from "@/config/config"
import { Identifier } from "@/id/id"
import type { MessageV2 } from "@/session/message-v2"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import path from "node:path"

export namespace VcpMemoryRuntime {
  const log = Log.create({ service: "vcp.memory" })

  export type MemoryScope = "user" | "folder"
  export type MemoryRole = "user" | "assistant"

  export type AtomicMemoryItem = {
    id: string
    text: string
    tags: string[]
    scope: MemoryScope
    role: MemoryRole
    folderID?: string
    sessionID: string
    messageID: string
    createdAt: number
    updatedAt: number
  }

  export type UserProfileMemory = {
    preferences: string[]
    style: string[]
    facts: string[]
    updatedAt: number
  }

  export type FolderDocMemory = {
    folderID: string
    summary: string
    highlights: string[]
    updatedAt: number
  }

  type MemoryStore = {
    atomic: AtomicMemoryItem[]
    profile: UserProfileMemory
    folders: Record<string, FolderDocMemory>
  }

  type NormalizedMemoryConfig = {
    enabled: boolean
    passive: {
      enabled: boolean
      includeProfile: boolean
      includeFolderDoc: boolean
      includeSessionSnippets: boolean
      topKAtomic: number
      topKSession: number
      maxChars: number
    }
    writer: {
      enabled: boolean
      minChars: number
      maxAtomic: number
      maxPerMessage: number
      forceFirstMessage: boolean
      updateProfile: boolean
      updateFolderDoc: boolean
    }
  }

  const STORE_KEYS = {
    atomic: ["vcp_memory", "atomic"] as string[],
    profile: ["vcp_memory", "profile"] as string[],
    folders: ["vcp_memory", "folders"] as string[],
  }

  function compactText(text: string): string {
    return text.replace(/\s+/g, " ").trim()
  }

  function normalizeToken(token: string): string {
    return token.trim().toLowerCase()
  }

  export function tokenizeForMemory(input: string): string[] {
    return input
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/g)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  }

  function normalizeTag(tag: string): string {
    return normalizeToken(tag).replace(/\s+/g, "-")
  }

  function uniqueAppend(list: string[], value: string, maxSize: number): string[] {
    const cleaned = compactText(value)
    if (!cleaned) return list
    const existing = list.filter((item) => item !== cleaned)
    return [cleaned, ...existing].slice(0, maxSize)
  }

  function scoreText(queryTokens: string[], text: string, timestamp: number, newest: number): number {
    if (queryTokens.length === 0) return 0
    const lower = text.toLowerCase()
    if (!lower) return 0

    let overlap = 0
    for (const token of queryTokens) {
      if (lower.includes(token)) overlap += 1
    }
    if (overlap === 0) return 0

    const lexical = overlap / queryTokens.length
    const recency = newest > 0 ? Math.max(0, 1 - (newest - timestamp) / (1000 * 60 * 60 * 24 * 30)) : 0
    return lexical * 0.85 + recency * 0.15
  }

  export function deriveFolderID(directory: string): string {
    const normalized = directory.trim().replace(/[\\/]+/g, "/").replace(/\/+$/g, "")
    if (!normalized) return "root"
    const base = path.posix.basename(normalized)
    return (base || "root").toLowerCase()
  }

  async function readOrDefault<T>(key: string[], fallback: T): Promise<T> {
    try {
      return await Storage.read<T>(key)
    } catch (error) {
      if (Storage.NotFoundError.isInstance(error)) return fallback
      throw error
    }
  }

  async function loadStore(): Promise<MemoryStore> {
    const [atomic, profile, folders] = await Promise.all([
      readOrDefault<AtomicMemoryItem[]>(STORE_KEYS.atomic, []),
      readOrDefault<UserProfileMemory>(STORE_KEYS.profile, {
        preferences: [],
        style: [],
        facts: [],
        updatedAt: 0,
      }),
      readOrDefault<Record<string, FolderDocMemory>>(STORE_KEYS.folders, {}),
    ])
    return { atomic, profile, folders }
  }

  async function saveStore(store: MemoryStore): Promise<void> {
    await Promise.all([
      Storage.write(STORE_KEYS.atomic, store.atomic),
      Storage.write(STORE_KEYS.profile, store.profile),
      Storage.write(STORE_KEYS.folders, store.folders),
    ])
  }

  function normalizeConfig(config: Awaited<ReturnType<typeof Config.get>>): NormalizedMemoryConfig {
    const base = config.vcp?.memory
    return {
      enabled: base?.enabled ?? false,
      passive: {
        enabled: base?.passive?.enabled ?? true,
        includeProfile: base?.passive?.includeProfile ?? true,
        includeFolderDoc: base?.passive?.includeFolderDoc ?? true,
        includeSessionSnippets: base?.passive?.includeSessionSnippets ?? true,
        topKAtomic: base?.passive?.topKAtomic ?? 5,
        topKSession: base?.passive?.topKSession ?? 3,
        maxChars: base?.passive?.maxChars ?? 4096,
      },
      writer: {
        enabled: base?.writer?.enabled ?? true,
        minChars: base?.writer?.minChars ?? 24,
        maxAtomic: base?.writer?.maxAtomic ?? 1000,
        maxPerMessage: base?.writer?.maxPerMessage ?? 1,
        forceFirstMessage: base?.writer?.forceFirstMessage ?? true,
        updateProfile: base?.writer?.updateProfile ?? true,
        updateFolderDoc: base?.writer?.updateFolderDoc ?? true,
      },
    }
  }

  function extractMessageText(message: MessageV2.WithParts): string {
    const chunks: string[] = []
    for (const part of message.parts) {
      if (part.type === "text" && !part.synthetic && part.text.trim()) chunks.push(part.text.trim())
      if (part.type === "reasoning" && part.text.trim()) chunks.push(part.text.trim())
    }
    return compactText(chunks.join("\n"))
  }

  function inferTags(text: string): string[] {
    const tokens = tokenizeForMemory(text)
    const counts = new Map<string, number>()
    for (const token of tokens) {
      const normalized = normalizeTag(token)
      if (!normalized) continue
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([token]) => token)
  }

  function maybePreference(text: string): string | undefined {
    const patterns = [
      /我(?:更)?喜欢[^。！？\n]{2,80}/i,
      /我偏好[^。！？\n]{2,80}/i,
      /请(?:用|以)[^。！？\n]{2,80}/i,
      /prefer[^.!?\n]{2,80}/i,
      /please (?:use|reply|answer)[^.!?\n]{2,80}/i,
    ]
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match && match[0]) return compactText(match[0])
    }
    return undefined
  }

  function maybeStyle(text: string): string | undefined {
    const patterns = [
      /简洁[^。！？\n]{0,60}/i,
      /详细[^。！？\n]{0,60}/i,
      /中文[^。！？\n]{0,60}/i,
      /英文[^。！？\n]{0,60}/i,
      /concise[^.!?\n]{0,60}/i,
      /detailed[^.!?\n]{0,60}/i,
    ]
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match && match[0]) return compactText(match[0])
    }
    return undefined
  }

  function headline(text: string, maxLen = 180): string {
    const compact = compactText(text)
    if (compact.length <= maxLen) return compact
    return compact.slice(0, maxLen - 3).trimEnd() + "..."
  }

  function parseTime(value: string | number | undefined): number | undefined {
    if (value === undefined) return undefined
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  export async function searchAtomicMemory(input: {
    query: string
    topK?: number
    scope?: "user" | "folder" | "both"
    folderID?: string
    tagsAny?: string[]
    timeFrom?: string | number
    timeTo?: string | number
  }) {
    const store = await loadStore()
    const queryTokens = tokenizeForMemory(input.query)
    if (queryTokens.length === 0) return [] as Array<{ item: AtomicMemoryItem; score: number }>

    const topK = Math.max(1, Math.min(50, Math.floor(input.topK ?? 10)))
    const scope = input.scope ?? "both"
    const folderID = input.folderID ? normalizeTag(input.folderID) : undefined
    const tagsAny = (input.tagsAny ?? []).map(normalizeTag).filter(Boolean)
    const fromRaw = parseTime(input.timeFrom)
    const toRaw = parseTime(input.timeTo)
    const from = fromRaw !== undefined && toRaw !== undefined ? Math.min(fromRaw, toRaw) : fromRaw
    const to = fromRaw !== undefined && toRaw !== undefined ? Math.max(fromRaw, toRaw) : toRaw

    const newest = store.atomic.reduce((max, item) => Math.max(max, item.updatedAt), 0)
    const scored = store.atomic
      .filter((item) => {
        if (scope === "user" && item.scope !== "user") return false
        if (scope === "folder" && item.scope !== "folder") return false
        if (folderID && item.scope === "folder" && normalizeTag(item.folderID ?? "") !== folderID) return false
        if (from !== undefined && item.updatedAt < from) return false
        if (to !== undefined && item.updatedAt > to) return false
        if (tagsAny.length > 0) {
          const set = new Set(item.tags.map(normalizeTag))
          if (!tagsAny.some((tag) => set.has(tag))) return false
        }
        return true
      })
      .map((item) => {
        const combined = `${item.text}\n${item.tags.join(" ")}`
        return {
          item,
          score: scoreText(queryTokens, combined, item.updatedAt, newest),
        }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)

    return scored.slice(0, topK)
  }

  export async function overview(input?: { limit?: number; folderID?: string }) {
    const store = await loadStore()
    const limit = Math.max(1, Math.min(100, Math.floor(input?.limit ?? 20)))
    const folderID = input?.folderID ? normalizeTag(input.folderID) : undefined
    const recentAtomic = store.atomic
      .filter((item) => !folderID || normalizeTag(item.folderID ?? "") === folderID)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
    const folderDocs = Object.values(store.folders)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)

    return {
      atomicTotal: store.atomic.length,
      profile: store.profile,
      folders: folderDocs,
      recentAtomic,
    }
  }

  export async function updateAtomicMemory(input: {
    id: string
    text?: string
    tags?: string[]
    scope?: MemoryScope
    folderID?: string
  }): Promise<AtomicMemoryItem | undefined> {
    const store = await loadStore()
    const target = store.atomic.find((item) => item.id === input.id)
    if (!target) return undefined

    if (typeof input.text === "string") {
      const compact = headline(input.text, 700)
      if (!compact) return undefined
      target.text = compact
    }
    if (Array.isArray(input.tags)) {
      target.tags = Array.from(new Set(input.tags.map(normalizeTag).filter(Boolean))).slice(0, 10)
    }
    if (input.scope) {
      target.scope = input.scope
      if (input.scope === "user") target.folderID = undefined
    }
    if (typeof input.folderID === "string" && target.scope === "folder") {
      target.folderID = normalizeTag(input.folderID)
    }
    target.updatedAt = Date.now()
    await saveStore(store)
    return target
  }

  export async function deleteAtomicMemory(id: string): Promise<boolean> {
    const store = await loadStore()
    const before = store.atomic.length
    store.atomic = store.atomic.filter((item) => item.id !== id)
    if (store.atomic.length === before) return false
    await saveStore(store)
    return true
  }

  export async function previewContextBox(input: {
    query: string
    directory: string
    topKAtomic?: number
    maxChars?: number
    removeAtomicIDs?: string[]
    pinAtomicIDs?: string[]
    compress?: boolean
  }): Promise<string | undefined> {
    const queryText = compactText(input.query)
    if (!queryText) return undefined
    const queryTokens = tokenizeForMemory(queryText)
    if (queryTokens.length === 0) return undefined

    const store = await loadStore()
    const folderID = deriveFolderID(input.directory)
    const lines: string[] = ["<system-reminder>", "[MEMORY_CONTEXT_PREVIEW]"]

    const compress = input.compress ?? false
    const profileBlocks: string[] = []
    if (store.profile.preferences.length > 0) {
      const preferences = compress ? store.profile.preferences.slice(0, 2) : store.profile.preferences
      profileBlocks.push(`- preferences: ${preferences.join(" | ")}`)
    }
    if (store.profile.style.length > 0) {
      const styles = compress ? store.profile.style.slice(0, 2) : store.profile.style
      profileBlocks.push(`- style: ${styles.join(" | ")}`)
    }
    if (store.profile.facts.length > 0) {
      const facts = compress ? store.profile.facts.slice(0, 2) : store.profile.facts
      profileBlocks.push(`- facts: ${facts.join(" | ")}`)
    }
    if (profileBlocks.length > 0) {
      lines.push("User Profile:")
      lines.push(...profileBlocks)
    }

    const folderDoc = store.folders[folderID]
    if (folderDoc) {
      lines.push(`Folder Doc (${folderID}):`)
      lines.push(`- summary: ${folderDoc.summary}`)
      if (folderDoc.highlights.length > 0) lines.push(`- highlights: ${folderDoc.highlights.join(" | ")}`)
    }

    const atomicHits = await searchAtomicMemory({
      query: queryText,
      topK: input.topKAtomic ?? 5,
      scope: "both",
      folderID,
    })
    const excluded = new Set((input.removeAtomicIDs ?? []).filter(Boolean))
    const pinnedIDs = new Set((input.pinAtomicIDs ?? []).filter(Boolean))
    const pinnedEntries = store.atomic
      .filter((item) => pinnedIDs.has(item.id) && !excluded.has(item.id))
      .map((item) => ({ item, score: 1 }))
    const mergedHits = [...pinnedEntries, ...atomicHits]
      .filter((hit) => !excluded.has(hit.item.id))
      .filter((hit, idx, list) => list.findIndex((entry) => entry.item.id === hit.item.id) === idx)
      .slice(0, Math.max(1, Math.min(50, Math.floor(input.topKAtomic ?? 5))))

    if (mergedHits.length > 0) {
      lines.push("Atomic Memories:")
      for (const hit of mergedHits) {
        const pinPrefix = pinnedIDs.has(hit.item.id) ? "[PIN] " : ""
        const text = compress ? headline(hit.item.text, 90) : headline(hit.item.text)
        lines.push(
          compress
            ? `- ${pinPrefix}(${hit.item.scope}/${hit.item.role}) score=${hit.score.toFixed(3)} ${text}`
            : `- ${pinPrefix}(${hit.item.scope}/${hit.item.role}) [${hit.item.sessionID}:${hit.item.messageID}] score=${hit.score.toFixed(3)} ${text}`,
        )
      }
    }

    if (lines.length <= 2) return undefined
    lines.push("[/MEMORY_CONTEXT_PREVIEW]")
    lines.push("</system-reminder>")
    const maxChars = Math.max(256, Math.min(32768, Math.floor(input.maxChars ?? 4096)))
    const text = lines.join("\n")
    return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text
  }

  export async function buildPassiveSystemPrompt(input: {
    config: Awaited<ReturnType<typeof Config.get>>
    sessionID: string
    directory: string
    userMessageID: string
    messages: MessageV2.WithParts[]
  }): Promise<string | undefined> {
    const cfg = normalizeConfig(input.config)
    if (!cfg.enabled || !cfg.passive.enabled) return undefined

    const latestUserMessage = input.messages.find((msg) => msg.info.id === input.userMessageID)
    if (!latestUserMessage || latestUserMessage.info.role !== "user") return undefined
    const queryText = extractMessageText(latestUserMessage)
    const queryTokens = tokenizeForMemory(queryText)
    if (queryTokens.length === 0) return undefined

    const store = await loadStore()
    const folderID = deriveFolderID(input.directory)
    const lines: string[] = ["<system-reminder>", "[MEMORY_CONTEXT]"]

    if (cfg.passive.includeProfile) {
      const profileBlocks: string[] = []
      if (store.profile.preferences.length > 0) profileBlocks.push(`- preferences: ${store.profile.preferences.join(" | ")}`)
      if (store.profile.style.length > 0) profileBlocks.push(`- style: ${store.profile.style.join(" | ")}`)
      if (store.profile.facts.length > 0) profileBlocks.push(`- facts: ${store.profile.facts.join(" | ")}`)
      if (profileBlocks.length > 0) {
        lines.push("User Profile:")
        lines.push(...profileBlocks)
      }
    }

    if (cfg.passive.includeFolderDoc) {
      const folderDoc = store.folders[folderID]
      if (folderDoc) {
        lines.push(`Folder Doc (${folderID}):`)
        lines.push(`- summary: ${folderDoc.summary}`)
        if (folderDoc.highlights.length > 0) lines.push(`- highlights: ${folderDoc.highlights.join(" | ")}`)
      }
    }

    const atomicHits = await searchAtomicMemory({
      query: queryText,
      topK: cfg.passive.topKAtomic,
      scope: "both",
      folderID,
    })
    if (atomicHits.length > 0) {
      lines.push("Atomic Memories:")
      for (const hit of atomicHits) {
        lines.push(
          `- (${hit.item.scope}/${hit.item.role}) [${hit.item.sessionID}:${hit.item.messageID}] score=${hit.score.toFixed(3)} ${headline(hit.item.text)}`,
        )
      }
    }

    if (cfg.passive.includeSessionSnippets) {
      const sessionCandidates = input.messages
        .filter((msg) => msg.info.id !== input.userMessageID)
        .map((msg) => ({
          message: msg,
          text: extractMessageText(msg),
        }))
        .filter((item) => item.text.length > 0)
        .map((item) => ({
          ...item,
          score: scoreText(
            queryTokens,
            item.text,
            item.message.info.time.created,
            latestUserMessage.info.time.created,
          ),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.message.info.time.created - a.message.info.time.created)
        .slice(0, cfg.passive.topKSession)

      if (sessionCandidates.length > 0) {
        lines.push("Session Snippets:")
        for (const hit of sessionCandidates) {
          lines.push(
            `- (${hit.message.info.role}) [${hit.message.info.sessionID}:${hit.message.info.id}] score=${hit.score.toFixed(3)} ${headline(hit.text)}`,
          )
        }
      }
    }

    if (lines.length <= 2) return undefined
    lines.push("Use memory as soft context. If the user gives newer contradictory information, prefer the latest user message.")
    lines.push("[/MEMORY_CONTEXT]")
    lines.push("</system-reminder>")
    const text = lines.join("\n")
    return text.length > cfg.passive.maxChars ? text.slice(0, cfg.passive.maxChars) : text
  }

  const writerQueue = new Map<string, Promise<void>>()

  export function enqueueWriteFromUserMessage(input: {
    sessionID: string
    messageID: string
    directory: string
    role: MemoryRole
    text: string
    isFirstUserMessageInSession: boolean
  }) {
    const previous = writerQueue.get(input.sessionID) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => writeFromUserMessage(input))
      .catch((error) => {
        log.error("async memory writer failed", { sessionID: input.sessionID, messageID: input.messageID, error })
      })
      .finally(() => {
        if (writerQueue.get(input.sessionID) === next) writerQueue.delete(input.sessionID)
      })
    writerQueue.set(input.sessionID, next)
  }

  async function writeFromUserMessage(input: {
    sessionID: string
    messageID: string
    directory: string
    role: MemoryRole
    text: string
    isFirstUserMessageInSession: boolean
  }) {
    const config = await Config.get()
    const cfg = normalizeConfig(config)
    if (!cfg.enabled || !cfg.writer.enabled) return

    const text = compactText(input.text)
    if (!text) return
    const shouldForceFirst = cfg.writer.forceFirstMessage && input.isFirstUserMessageInSession
    if (!shouldForceFirst && text.length < cfg.writer.minChars) return

    const now = Date.now()
    const store = await loadStore()
    const folderID = deriveFolderID(input.directory)
    const tags = inferTags(text)

    if (cfg.writer.updateProfile) {
      const preference = maybePreference(text)
      if (preference) {
        store.profile.preferences = uniqueAppend(store.profile.preferences, preference, 30)
      }
      const style = maybeStyle(text)
      if (style) {
        store.profile.style = uniqueAppend(store.profile.style, style, 20)
      }
      if (input.isFirstUserMessageInSession) {
        store.profile.facts = uniqueAppend(store.profile.facts, headline(text, 140), 30)
      }
      store.profile.updatedAt = now
    }

    if (cfg.writer.updateFolderDoc) {
      const existing = store.folders[folderID] ?? {
        folderID,
        summary: "",
        highlights: [],
        updatedAt: 0,
      }
      const nextHighlight = headline(text, 200)
      const highlights = [nextHighlight, ...existing.highlights.filter((item) => item !== nextHighlight)].slice(0, 20)
      const summarySource = highlights.slice(0, 3).join(" | ")
      store.folders[folderID] = {
        folderID,
        summary: summarySource || existing.summary || nextHighlight,
        highlights,
        updatedAt: now,
      }
    }

    const targetScope: MemoryScope = folderID === "root" ? "user" : "folder"
    const normalizedText = text.toLowerCase()
    const duplicate = store.atomic.find(
      (item) =>
        item.scope === targetScope &&
        (item.folderID ?? "") === (targetScope === "folder" ? folderID : "") &&
        item.text.toLowerCase() === normalizedText,
    )

    if (duplicate) {
      duplicate.updatedAt = now
      duplicate.tags = Array.from(new Set([...duplicate.tags, ...tags])).slice(0, 10)
    } else {
      store.atomic.unshift({
        id: Identifier.ascending("part"),
        text: headline(text, 700),
        tags,
        scope: targetScope,
        role: input.role,
        folderID: targetScope === "folder" ? folderID : undefined,
        sessionID: input.sessionID,
        messageID: input.messageID,
        createdAt: now,
        updatedAt: now,
      })
    }

    if (store.atomic.length > cfg.writer.maxAtomic) {
      store.atomic = store.atomic
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, cfg.writer.maxAtomic)
    }
    if (store.atomic.length > 0 && cfg.writer.maxPerMessage > 0) {
      const latest = store.atomic
        .filter((item) => item.sessionID === input.sessionID && item.messageID === input.messageID)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      if (latest.length > cfg.writer.maxPerMessage) {
        const keep = new Set(latest.slice(0, cfg.writer.maxPerMessage).map((item) => item.id))
        store.atomic = store.atomic.filter(
          (item) => item.sessionID !== input.sessionID || item.messageID !== input.messageID || keep.has(item.id),
        )
      }
    }

    await saveStore(store)
  }
}

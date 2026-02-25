import z from "zod"
import path from "node:path"
import { Tool } from "./tool"
import DESCRIPTION from "./search_memory.txt"
import { Session } from "@/session"
import type { MessageV2 } from "@/session/message-v2"
import { VcpMemoryRuntime } from "@/novacode/memory-runtime"

type MemoryScope = "session" | "project" | "user" | "folder" | "both"
type RoleScope = "user" | "assistant" | "both"

type MemoryCandidate = {
  sessionID: string
  messageID: string
  role: "user" | "assistant"
  createdAt: number
  text: string
}

type MemorySearchHit = {
  source: "message" | "memory_bank"
  sessionID: string
  messageID: string
  role: "user" | "assistant"
  createdAt: number
  text: string
  score: number
  memoryID?: string
  memoryScope?: "user" | "folder"
  tags?: string[]
}

const DEFAULT_TOP_K = 5

const parameters = z.object({
  query: z.string().min(1).describe("What memory to search for."),
  topK: z.coerce.number().int().min(1).max(20).optional().describe("Maximum number of results to return."),
  scope: z
    .enum(["session", "project", "user", "folder", "both"] satisfies MemoryScope[])
    .optional()
    .describe("Search scope. user/folder/both map to project-wide search."),
  role: z
    .enum(["user", "assistant", "both"] satisfies RoleScope[])
    .optional()
    .describe("Filter by speaker role."),
  tagsAny: z
    .array(z.string().min(1))
    .max(10)
    .optional()
    .describe("Optional tag-like keywords to narrow results. Compatible with prompt-tree style usage."),
  folderId: z
    .string()
    .min(1)
    .optional()
    .describe("Reserved for folder scope compatibility. Current implementation keeps lexical matching session/project based."),
  timeFrom: z.union([z.string(), z.number()]).optional().describe("Inclusive lower bound for message creation time."),
  timeTo: z.union([z.string(), z.number()]).optional().describe("Inclusive upper bound for message creation time."),
})

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function parseTime(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const numberValue = Number(trimmed)
  if (Number.isFinite(numberValue)) return numberValue
  const dateValue = Date.parse(trimmed)
  return Number.isFinite(dateValue) ? dateValue : undefined
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function normalizePathKey(input: string): string {
  return input.trim().replace(/[\\/]+/g, "/").replace(/\/+$/g, "").toLowerCase()
}

function isFolderScopedDirectory(directory: string, folderId: string): boolean {
  const dir = normalizePathKey(directory)
  const folder = normalizePathKey(folderId)
  if (!folder) return true
  if (dir === folder) return true
  if (dir.endsWith(`/${folder}`)) return true
  if (dir.includes(`/${folder}/`)) return true
  const folderBase = path.posix.basename(folder)
  const dirBase = path.posix.basename(dir)
  return folderBase.length > 0 && dirBase === folderBase
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-")
}

function extractMessageText(message: MessageV2.WithParts): string {
  const chunks: string[] = []
  for (const part of message.parts) {
    if (part.type === "text" && !part.synthetic) {
      if (part.text.trim()) chunks.push(part.text.trim())
      continue
    }
    if (part.type === "reasoning" && part.text.trim()) {
      chunks.push(part.text.trim())
    }
  }
  return compactText(chunks.join("\n"))
}

function toCandidate(message: MessageV2.WithParts): MemoryCandidate | undefined {
  if (message.info.role !== "user" && message.info.role !== "assistant") return undefined
  const text = extractMessageText(message)
  if (!text) return undefined
  return {
    sessionID: message.info.sessionID,
    messageID: message.info.id,
    role: message.info.role,
    createdAt: message.info.time.created,
    text,
  }
}

function scoreCandidate(
  queryTokens: string[],
  queryText: string,
  candidate: MemoryCandidate,
  newestTimestamp: number,
  from?: number,
  to?: number,
): number {
  if (from !== undefined && candidate.createdAt < from) return 0
  if (to !== undefined && candidate.createdAt > to) return 0

  const haystack = candidate.text.toLowerCase()
  if (!haystack) return 0

  if (queryText.length >= 3 && haystack.includes(queryText)) {
    const recency = newestTimestamp > 0 ? Math.max(0, 1 - (newestTimestamp - candidate.createdAt) / (1000 * 60 * 60 * 24 * 30)) : 0
    return 0.9 + recency * 0.1
  }

  let overlap = 0
  for (const token of queryTokens) {
    if (haystack.includes(token)) overlap += 1
  }
  if (overlap === 0) return 0

  const lexical = overlap / queryTokens.length
  const recency = newestTimestamp > 0 ? Math.max(0, 1 - (newestTimestamp - candidate.createdAt) / (1000 * 60 * 60 * 24 * 30)) : 0
  return lexical * 0.85 + recency * 0.15
}

async function collectProjectCandidates(
  limitSessions: number,
  perSessionLimit: number,
  options?: {
    folderId?: string
  },
): Promise<MemoryCandidate[]> {
  const candidates: MemoryCandidate[] = []
  let sessions = 0
  for await (const session of Session.list({ limit: limitSessions })) {
    if (sessions >= limitSessions) break
    if (options?.folderId && !isFolderScopedDirectory(session.directory, options.folderId)) continue
    sessions += 1
    const messages = await Session.messages({ sessionID: session.id, limit: perSessionLimit })
    for (const message of messages) {
      const candidate = toCandidate(message)
      if (candidate) candidates.push(candidate)
    }
  }
  return candidates
}

export const SearchMemoryTool = Tool.define("search_memory", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const scope = params.scope ?? "session"
    const role = params.role ?? "both"
    await ctx.ask({
      permission: "search_memory",
      metadata: { query: params.query, scope, role },
      patterns: ["*"],
      always: ["*"],
    })

    const topK = params.topK ?? DEFAULT_TOP_K
    const fromRaw = parseTime(params.timeFrom)
    const toRaw = parseTime(params.timeTo)
    const from = fromRaw !== undefined && toRaw !== undefined ? Math.min(fromRaw, toRaw) : fromRaw
    const to = fromRaw !== undefined && toRaw !== undefined ? Math.max(fromRaw, toRaw) : toRaw
    const queryTokens = tokenize(params.query)
    const queryText = params.query.trim().toLowerCase()
    const tagsAny = (params.tagsAny ?? []).map(normalizeTag).filter(Boolean)
    const folderId = params.folderId?.trim() || undefined

    const metadataBase = {
      scope,
      role,
      mode: "hybrid" as const,
      folderId: folderId ?? null,
      tagFilterSize: tagsAny.length,
    }

    if (queryTokens.length === 0) {
      return {
        title: "Memory Search",
        output: "No valid query tokens were found. Try a more specific query.",
        metadata: { ...metadataBase, hits: 0 },
      }
    }

    const sessionCandidates = ctx.messages.map(toCandidate).filter((item) => !!item) as MemoryCandidate[]
    const projectMode = scope === "project" || scope === "user" || scope === "folder" || scope === "both"
    const projectCandidates = projectMode
      ? await collectProjectCandidates(20, 50, {
          folderId: scope === "folder" ? folderId : undefined,
        })
      : []
    const merged = [...sessionCandidates, ...projectCandidates]

    const messageDeduped = new Map<string, MemoryCandidate>()
    for (const candidate of merged) {
      messageDeduped.set(`${candidate.sessionID}:${candidate.messageID}`, candidate)
    }

    const roleFiltered = Array.from(messageDeduped.values())
      .filter((item) => role === "both" || item.role === role)
      .filter((item) => {
        if (tagsAny.length === 0) return true
        const text = item.text.toLowerCase()
        return tagsAny.some((tag) => text.includes(tag))
      })

    const newest = roleFiltered.reduce((max, item) => Math.max(max, item.createdAt), 0)

    const messageHits = roleFiltered
      .map((item) => ({
        ...item,
        score: scoreCandidate(queryTokens, queryText, item, newest, from, to),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
      .slice(0, Math.max(topK * 2, topK))
      .map(
        (item): MemorySearchHit => ({
          source: "message",
          sessionID: item.sessionID,
          messageID: item.messageID,
          role: item.role,
          createdAt: item.createdAt,
          text: item.text,
          score: item.score,
        }),
      )

    const currentSession = await Session.get(ctx.sessionID).catch(() => undefined)
    const currentFolderID = currentSession ? VcpMemoryRuntime.deriveFolderID(currentSession.directory) : undefined
    const effectiveFolderID = folderId ?? (scope === "folder" ? currentFolderID : undefined)

    const memoryScope = scope === "user" ? "user" : scope === "folder" ? "folder" : "both"
    const memoryResults = await VcpMemoryRuntime.searchAtomicMemory({
      query: params.query,
      topK: Math.max(topK * 3, topK),
      scope: memoryScope,
      folderID: effectiveFolderID,
      tagsAny: tagsAny.length > 0 ? tagsAny : undefined,
      timeFrom: params.timeFrom,
      timeTo: params.timeTo,
    }).catch(() => [])

    const memoryHits = memoryResults
      .filter((hit) => role === "both" || hit.item.role === role)
      .filter((hit) => (scope === "session" ? hit.item.sessionID === ctx.sessionID : true))
      .map(
        (hit): MemorySearchHit => ({
          source: "memory_bank",
          sessionID: hit.item.sessionID,
          messageID: hit.item.messageID,
          role: hit.item.role,
          createdAt: hit.item.updatedAt,
          text: hit.item.text,
          score: hit.score,
          memoryID: hit.item.id,
          memoryScope: hit.item.scope,
          tags: hit.item.tags,
        }),
      )

    const combinedDeduped = new Map<string, MemorySearchHit>()
    for (const hit of [...messageHits, ...memoryHits]) {
      const key =
        hit.source === "memory_bank"
          ? `memory:${hit.memoryID ?? hit.sessionID + ":" + hit.messageID}`
          : `message:${hit.sessionID}:${hit.messageID}`
      const existing = combinedDeduped.get(key)
      if (!existing || hit.score > existing.score || (hit.score === existing.score && hit.createdAt > existing.createdAt)) {
        combinedDeduped.set(key, hit)
      }
    }
    const hits = Array.from(combinedDeduped.values())
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
      .slice(0, topK)

    if (hits.length === 0) {
      return {
        title: "Memory Search",
        output: "No matching memory found for this query in the selected scope.",
        metadata: { ...metadataBase, hits: 0 },
      }
    }

    const output = [
      `query: ${params.query}`,
      `scope: ${scope}`,
      `role: ${role}`,
      `mode: hybrid (message + memory_bank)`,
      ...(tagsAny.length ? [`tagsAny: ${tagsAny.join(", ")}`] : []),
      ...(folderId ? [`folderId: ${folderId}`] : []),
      `results: ${hits.length}`,
      "",
      ...hits.map((item, index) =>
        [
          `## Result ${index + 1}`,
          `- source: ${item.source}`,
          `- role: ${item.role}`,
          `- sessionID: ${item.sessionID}`,
          `- messageID: ${item.messageID}`,
          `- reference: ${item.source === "memory_bank" ? `memory:${item.memoryID} -> ${item.sessionID}:${item.messageID}` : `${item.sessionID}:${item.messageID}`}`,
          ...(item.memoryScope ? [`- memoryScope: ${item.memoryScope}`] : []),
          ...(item.tags && item.tags.length > 0 ? [`- tags: ${item.tags.join(", ")}`] : []),
          `- time: ${new Date(item.createdAt).toISOString()}`,
          `- score: ${item.score.toFixed(3)}`,
          `- text: ${item.text}`,
        ].join("\n"),
      ),
    ].join("\n")

    const sourceHits = {
      message: hits.filter((item) => item.source === "message").length,
      memory_bank: hits.filter((item) => item.source === "memory_bank").length,
    }

    return {
      title: "Memory Search",
      output,
      metadata: {
        ...metadataBase,
        hits: hits.length,
        sourceHits,
        results: hits.map((item) => ({
          source: item.source,
          sessionID: item.sessionID,
          messageID: item.messageID,
          role: item.role,
          score: item.score,
          memoryID: item.memoryID,
          memoryScope: item.memoryScope,
        })),
      },
    }
  },
})

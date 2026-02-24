type VcpFoldOptions = {
  enabled?: boolean
  startMarker?: string
  endMarker?: string
  outputStyle?: "details" | "plain"
}

type VcpInfoOptions = {
  enabled?: boolean
  startMarker?: string
  endMarker?: string
}

type VcpHtmlOptions = {
  enabled?: boolean
}

type VcpToolRequestOptions = {
  enabled?: boolean
  startMarker?: string
  endMarker?: string
  keepBlockInText?: boolean
  bridgeMode?: "event" | "execute"
  maxPerMessage?: number
  allowTools?: string[]
  denyTools?: string[]
}

export type VcpCompatibilityOptions = {
  enabled?: boolean
  contextFold?: VcpFoldOptions
  vcpInfo?: VcpInfoOptions
  html?: VcpHtmlOptions
  toolRequest?: VcpToolRequestOptions
}

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike }

export type VcpToolRequest = {
  tool: string
  arguments?: JsonLike
  raw: string
}

export type VcpCompatibilityResult = {
  text: string
  notifications: string[]
  toolRequests: VcpToolRequest[]
}

type FoldBlock = {
  title: string
  content: string
}

const DEFAULT_FOLD_START = "<<<[VCP_DYNAMIC_FOLD]>>>"
const DEFAULT_FOLD_END = "<<<[END_VCP_DYNAMIC_FOLD]>>>"
const DEFAULT_VCPINFO_START = "<<<[VCPINFO]>>>"
const DEFAULT_VCPINFO_END = "<<<[END_VCPINFO]>>>"
const DEFAULT_TOOL_REQUEST_START = "<<<[TOOL_REQUEST]>>>"
const DEFAULT_TOOL_REQUEST_END = "<<<[END_TOOL_REQUEST]>>>"
const ARGUMENTS_WRAP_START = "「始」"
const ARGUMENTS_WRAP_END = "「末」"

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function normalizeMarker(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function replaceDelimitedBlocks(
  input: string,
  startMarker: string,
  endMarker: string,
  transform: (content: string, index: number) => string,
): string {
  let output = ""
  let cursor = 0
  let count = 0

  while (true) {
    const start = input.indexOf(startMarker, cursor)
    if (start === -1) {
      output += input.slice(cursor)
      break
    }

    const contentStart = start + startMarker.length
    const end = input.indexOf(endMarker, contentStart)
    if (end === -1) {
      output += input.slice(cursor)
      break
    }

    output += input.slice(cursor, start)
    const content = input.slice(contentStart, end)
    output += transform(content, count)
    count += 1
    cursor = end + endMarker.length
  }

  return output
}

function cleanJsonBlock(raw: string): string {
  const text = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  return fence?.[1]?.trim() ?? text
}

function tryParseJson(raw: string): JsonLike | undefined {
  const text = raw.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text) as JsonLike
  } catch {
    return undefined
  }
}

function normalizeScalar(text: string): JsonLike {
  const trimmed = text.trim()
  if (!trimmed) return ""
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null

  const parsedNumber = Number(trimmed)
  if (!Number.isNaN(parsedNumber) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return parsedNumber
  }

  const unwrapped = /^(["'])([\s\S]*)\1$/.exec(trimmed)
  return (unwrapped?.[2] ?? trimmed) as JsonLike
}

function extractWrappedSegment(raw: string, startMarker: string, endMarker: string): string | undefined {
  const start = raw.indexOf(startMarker)
  if (start === -1) return undefined
  const contentStart = start + startMarker.length
  const end = raw.indexOf(endMarker, contentStart)
  if (end === -1) return undefined
  return raw.slice(contentStart, end).trim()
}

function normalizeArguments(raw: unknown): JsonLike | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw === "boolean" || typeof raw === "number") return raw
  if (Array.isArray(raw)) return raw as JsonLike
  if (typeof raw === "object") return raw as JsonLike

  const text = String(raw).trim()
  if (!text) return undefined

  const wrapped = extractWrappedSegment(text, ARGUMENTS_WRAP_START, ARGUMENTS_WRAP_END)
  if (wrapped) {
    const wrappedParsed = tryParseJson(cleanJsonBlock(wrapped))
    return wrappedParsed ?? normalizeScalar(wrapped)
  }

  const parsed = tryParseJson(cleanJsonBlock(text))
  return parsed ?? normalizeScalar(text)
}

function parseKeyValueToolRequest(raw: string): VcpToolRequest | undefined {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return undefined

  const record: Record<string, string> = {}
  for (const line of lines) {
    const delimiter = line.includes(":") ? ":" : line.includes("=") ? "=" : undefined
    if (!delimiter) continue
    const index = line.indexOf(delimiter)
    if (index <= 0) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    if (!key || !value) continue
    record[key] = value
  }

  const tool =
    record["tool"] ??
    record["tool_name"] ??
    record["name"] ??
    record["action"] ??
    record["type"] ??
    record["method"]
  if (!tool) return undefined

  const argsRaw = record["arguments"] ?? record["args"] ?? record["params"] ?? record["input"] ?? record["payload"]
  return {
    tool: tool.trim(),
    arguments: normalizeArguments(argsRaw),
    raw: raw.trim(),
  }
}

function parseToolRequest(raw: string): VcpToolRequest | undefined {
  const cleaned = cleanJsonBlock(raw)
  const jsonPayload = tryParseJson(cleaned)
  if (jsonPayload && typeof jsonPayload === "object" && !Array.isArray(jsonPayload)) {
    const payload = jsonPayload as Record<string, unknown>
    const toolRaw =
      payload.tool ??
      payload.tool_name ??
      payload.toolName ??
      payload.name ??
      payload.action ??
      payload.type ??
      payload.method
    const tool = typeof toolRaw === "string" ? toolRaw.trim() : ""
    if (tool) {
      const argsRaw =
        payload.arguments ?? payload.args ?? payload.params ?? payload.input ?? payload.payload ?? payload.data
      return {
        tool,
        arguments: normalizeArguments(argsRaw),
        raw: raw.trim(),
      }
    }
  }

  const kv = parseKeyValueToolRequest(raw)
  if (kv) return kv

  const wrapped = extractWrappedSegment(raw, ARGUMENTS_WRAP_START, ARGUMENTS_WRAP_END)
  if (wrapped) {
    return {
      tool: "tool_request",
      arguments: normalizeArguments(wrapped),
      raw: raw.trim(),
    }
  }

  return undefined
}

function parseFoldBlocks(raw: string): FoldBlock[] {
  const text = cleanJsonBlock(raw)
  const payload = JSON.parse(text) as any
  const blocksSource = Array.isArray(payload?.fold_blocks)
    ? payload.fold_blocks
    : Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object"
        ? [payload]
        : []

  const blocks: FoldBlock[] = []
  for (const [index, item] of blocksSource.entries()) {
    if (!item || typeof item !== "object") continue
    const titleRaw = item.title ?? item.name ?? item.label ?? `Context ${index + 1}`
    const contentRaw = item.content ?? item.text ?? item.body ?? ""
    const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : `Context ${index + 1}`
    const content = typeof contentRaw === "string" ? contentRaw.trim() : String(contentRaw ?? "").trim()
    blocks.push({ title, content })
  }
  return blocks
}

function renderFoldBlocks(blocks: FoldBlock[], style: "details" | "plain"): string {
  if (blocks.length === 0) return ""
  if (style === "plain") {
    return blocks
      .map((block) => `### ${block.title}\n\n${block.content || "_(empty)_"}\n`)
      .join("\n")
      .trim()
  }

  return blocks
    .map(
      (block) =>
        `<details data-vcp-fold=\"true\"><summary>${esc(block.title)}</summary>\n\n${block.content || "_(empty)_"}\n</details>`,
    )
    .join("\n\n")
}

export namespace VcpContentCompatibility {
  export function process(text: string, options: VcpCompatibilityOptions | undefined): VcpCompatibilityResult {
    if (!options?.enabled) {
      return {
        text,
        notifications: [],
        toolRequests: [],
      }
    }

    const notifications: string[] = []
    const toolRequests: VcpToolRequest[] = []
    let next = text

    if (options.contextFold?.enabled !== false) {
      const foldStart = normalizeMarker(options.contextFold?.startMarker, DEFAULT_FOLD_START)
      const foldEnd = normalizeMarker(options.contextFold?.endMarker, DEFAULT_FOLD_END)
      const foldStyle = options.contextFold?.outputStyle === "plain" ? "plain" : "details"
      next = replaceDelimitedBlocks(next, foldStart, foldEnd, (content) => {
        try {
          const blocks = parseFoldBlocks(content)
          if (blocks.length === 0) return content.trim()
          return renderFoldBlocks(blocks, foldStyle)
        } catch {
          return content.trim()
        }
      })
    }

    if (options.vcpInfo?.enabled !== false) {
      const infoStart = normalizeMarker(options.vcpInfo?.startMarker, DEFAULT_VCPINFO_START)
      const infoEnd = normalizeMarker(options.vcpInfo?.endMarker, DEFAULT_VCPINFO_END)
      next = replaceDelimitedBlocks(next, infoStart, infoEnd, (content, index) => {
        const cleaned = content.trim()
        if (cleaned) notifications.push(cleaned)
        return `<details data-vcp-info=\"true\"><summary>VCPInfo ${index + 1}</summary>\n\n${cleaned || "_(empty)_"}\n</details>`
      })
    }

    if (options.toolRequest?.enabled !== false) {
      const requestStart = normalizeMarker(options.toolRequest?.startMarker, DEFAULT_TOOL_REQUEST_START)
      const requestEnd = normalizeMarker(options.toolRequest?.endMarker, DEFAULT_TOOL_REQUEST_END)
      const keepBlock = options.toolRequest?.keepBlockInText === true
      next = replaceDelimitedBlocks(next, requestStart, requestEnd, (content, index) => {
        const request = parseToolRequest(content)
        if (request) {
          toolRequests.push(request)
        }
        if (!keepBlock) {
          return ""
        }
        const body = content.trim() || "_(empty)_"
        return `<details data-vcp-tool-request=\"true\"><summary>Tool Request ${index + 1}</summary>\n\n${body}\n</details>`
      })
    }

    if (options.html?.enabled === false) {
      next = next.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }

    return {
      text: next,
      notifications,
      toolRequests,
    }
  }
}

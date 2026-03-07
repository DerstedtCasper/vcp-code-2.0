// novacode_change - new file
// vcp_change: VCP content protocol parser.

import type { VcpConfig } from "../../../shared/vcp/vcp-types"
import { limitToolRequests } from "./vcp-tool-request"

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike }

type ParsedToolRequest = {
	tool: string
	arguments?: JsonLike
	raw: string
	format: "json" | "kv" | "wrapped"
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

export interface VcpNotification {
	title: string
	body: string
	level: "info" | "warn" | "error"
}

export interface VcpToolRequestBlock {
	toolName: string
	params: Record<string, unknown>
	format: "json" | "kv" | "wrapped"
}

export interface VcpProcessResult {
	text: string
	historyText: string
	notifications: VcpNotification[]
	toolRequests: VcpToolRequestBlock[]
}

function esc(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function restorePlaceholders(text: string, replacements: string[]): string {
	let output = text
	for (const [index, value] of replacements.entries()) {
		const token = `__VCP_PLACEHOLDER_${index}__`
		output = output.split(token).join(value)
	}
	return output
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

function parseKeyValueToolRequest(raw: string): ParsedToolRequest | undefined {
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

	const tool = record.tool ?? record.tool_name ?? record.name ?? record.action ?? record.type ?? record.method
	if (!tool) return undefined

	const argsRaw = record.arguments ?? record.args ?? record.params ?? record.input ?? record.payload
	return {
		tool: tool.trim(),
		arguments: normalizeArguments(argsRaw),
		raw: raw.trim(),
		format: "kv",
	}
}

function parseToolRequest(raw: string): ParsedToolRequest | undefined {
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
				format: "json",
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
			format: "wrapped",
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

function renderFoldBlocks(blocks: FoldBlock[], style: "details" | "comment", escapeContent: boolean): string {
	if (blocks.length === 0) return ""

	if (style === "comment") {
		return blocks
			.map((block) => {
				const content = block.content || "_(empty)_"
				return `<!-- vcp-fold: ${block.title} -->\n${escapeContent ? esc(content) : content}\n<!-- /vcp-fold -->`
			})
			.join("\n\n")
	}

	return blocks
		.map(
			(block) =>
				`<details data-vcp-fold="true"><summary>${esc(block.title)}</summary>\n\n${
					escapeContent ? esc(block.content || "_(empty)_") : block.content || "_(empty)_"
				}\n</details>`,
		)
		.join("\n\n")
}

function parseInfoBlock(content: string, index: number): VcpNotification {
	const cleaned = content.trim()
	const parsed = tryParseJson(cleanJsonBlock(cleaned))

	if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
		const payload = parsed as Record<string, unknown>
		const title =
			typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : `VCPInfo ${index + 1}`
		const body =
			typeof payload.body === "string" && payload.body.trim()
				? payload.body.trim()
				: typeof payload.message === "string"
					? payload.message.trim()
					: cleaned
		const level = payload.level === "warn" || payload.level === "error" ? payload.level : "info"
		return { title, body, level }
	}

	return {
		title: `VCPInfo ${index + 1}`,
		body: cleaned,
		level: "info",
	}
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
}

function stripHtml(text: string): string {
	return decodeHtmlEntities(text).replace(/<[^>]+>/g, " ")
}

function normalizeHistoryWhitespace(text: string): string {
	return text
		.replace(/__VCP_PLACEHOLDER_\d+__/g, " ")
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim()
}

function clampHistoryText(text: string, maxLength = 240): string {
	const normalized = normalizeHistoryWhitespace(stripHtml(text))
	if (normalized.length <= maxLength) {
		return normalized
	}

	return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function renderHistoryFoldSummary(blocks: FoldBlock[]): string {
	if (blocks.length === 0) {
		return ""
	}

	const visibleTitles = blocks
		.map((block) => clampHistoryText(block.title, 48))
		.filter(Boolean)
		.slice(0, 6)
	const extraCount = Math.max(0, blocks.length - visibleTitles.length)
	const suffix = extraCount > 0 ? ` (+${extraCount})` : ""

	return visibleTitles.length > 0 ? `[VCP Fold: ${visibleTitles.join("; ")}${suffix}]` : `[VCP Fold${suffix}]`
}

function renderHistoryInfoSummary(notification: VcpNotification): string {
	const title = clampHistoryText(notification.title, 48) || "VCPInfo"
	const body = clampHistoryText(notification.body, 240)
	return body ? `[VCPInfo: ${title}] ${body}` : `[VCPInfo: ${title}]`
}

export function normalizeVcpHistoryText(text: string): string {
	let next = text

	for (let pass = 0; pass < 4; pass += 1) {
		const previous = next

		next = next
			.replace(
				/<details\s+data-vcp-fold="true">\s*<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/gi,
				(_match, title) => `[VCP Fold: ${clampHistoryText(title, 48) || "Context"}]`,
			)
			.replace(
				/<details\s+data-vcp-info="true">\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
				(_match, title, body) => {
					const rendered = renderHistoryInfoSummary({
						title: clampHistoryText(title, 48) || "VCPInfo",
						body: stripHtml(body),
						level: "info",
					})
					return rendered
				},
			)
			.replace(/<details\s+data-vcp-tool-request="true">[\s\S]*?<\/details>/gi, " ")
			.replace(
				/<!--\s*vcp-fold:\s*([\s\S]*?)\s*-->[\s\S]*?<!--\s*\/vcp-fold\s*-->/gi,
				(_match, title) => `[VCP Fold: ${clampHistoryText(title, 48) || "Context"}]`,
			)
			.replace(/<\/?details[^>]*>/gi, " ")
			.replace(/<\/?summary[^>]*>/gi, " ")

		if (next === previous) {
			break
		}
	}

	return normalizeHistoryWhitespace(next)
}

/**
 * 处理 AI 输出中的 VCP 协议块
 * - <<<[VCP_DYNAMIC_FOLD]>>> ... <<<[END_VCP_DYNAMIC_FOLD]>>> -> 折叠块
 * - <<<[VCPINFO]>>> ... <<<[END_VCPINFO]>>> -> 通知提取
 * - <<<[TOOL_REQUEST]>>> ... <<<[END_TOOL_REQUEST]>>> -> 工具请求解析
 */
export function processVcpContent(text: string, config: VcpConfig): VcpProcessResult {
	if (!config.enabled) {
		return {
			text,
			historyText: normalizeVcpHistoryText(text),
			notifications: [],
			toolRequests: [],
		}
	}

	const notifications: VcpNotification[] = []
	const toolRequests: VcpToolRequestBlock[] = []
	const preservedBlocks: string[] = []
	const shouldEscapeHtml = config.html.enabled === false
	let historyText = text

	const preserveBlock = (value: string): string => {
		if (!shouldEscapeHtml) {
			return value
		}
		const token = `__VCP_PLACEHOLDER_${preservedBlocks.length}__`
		preservedBlocks.push(value)
		return token
	}
	let next = text

	if (config.contextFold.enabled) {
		const foldStart = normalizeMarker(config.contextFold.startMarker, DEFAULT_FOLD_START)
		const foldEnd = normalizeMarker(config.contextFold.endMarker, DEFAULT_FOLD_END)
		next = replaceDelimitedBlocks(next, foldStart, foldEnd, (content) => {
			try {
				const blocks = parseFoldBlocks(content)
				if (blocks.length === 0) return content.trim()
				return preserveBlock(renderFoldBlocks(blocks, config.contextFold.style, shouldEscapeHtml))
			} catch {
				return content.trim()
			}
		})
		historyText = replaceDelimitedBlocks(historyText, foldStart, foldEnd, (content) => {
			try {
				return renderHistoryFoldSummary(parseFoldBlocks(content))
			} catch {
				return "[VCP Fold]"
			}
		})
	}

	if (config.vcpInfo.enabled) {
		const infoStart = normalizeMarker(config.vcpInfo.startMarker, DEFAULT_VCPINFO_START)
		const infoEnd = normalizeMarker(config.vcpInfo.endMarker, DEFAULT_VCPINFO_END)
		next = replaceDelimitedBlocks(next, infoStart, infoEnd, (content, index) => {
			const notification = parseInfoBlock(content, index)
			notifications.push(notification)
			const body = notification.body || "_(empty)_"
			return preserveBlock(
				`<details data-vcp-info="true"><summary>${esc(notification.title)}</summary>\n\n${
					shouldEscapeHtml ? esc(body) : body
				}\n</details>`,
			)
		})
		historyText = replaceDelimitedBlocks(historyText, infoStart, infoEnd, (content, index) =>
			renderHistoryInfoSummary(parseInfoBlock(content, index)),
		)
	}

	if (config.toolRequest.enabled) {
		const requestStart = normalizeMarker(config.toolRequest.startMarker, DEFAULT_TOOL_REQUEST_START)
		const requestEnd = normalizeMarker(config.toolRequest.endMarker, DEFAULT_TOOL_REQUEST_END)
		next = replaceDelimitedBlocks(next, requestStart, requestEnd, (content, index) => {
			const request = parseToolRequest(content)
			if (request) {
				toolRequests.push({
					toolName: request.tool,
					params:
						request.arguments && typeof request.arguments === "object" && !Array.isArray(request.arguments)
							? (request.arguments as Record<string, unknown>)
							: request.arguments !== undefined
								? { value: request.arguments as unknown }
								: {},
					format: request.format,
				})
			}

			if (!config.toolRequest.keepBlockInText) {
				return ""
			}

			const body = content.trim() || "_(empty)_"
			return preserveBlock(
				`<details data-vcp-tool-request="true"><summary>Tool Request ${index + 1}</summary>\n\n${
					shouldEscapeHtml ? esc(body) : body
				}\n</details>`,
			)
		})
		historyText = replaceDelimitedBlocks(historyText, requestStart, requestEnd, () => "")
	}

	if (shouldEscapeHtml) {
		next = esc(next)
		if (preservedBlocks.length > 0) {
			next = restorePlaceholders(next, preservedBlocks)
		}
	}

	return {
		text: next,
		historyText: normalizeVcpHistoryText(historyText),
		notifications,
		toolRequests: limitToolRequests(toolRequests, config.toolRequest.maxPerMessage),
	}
}

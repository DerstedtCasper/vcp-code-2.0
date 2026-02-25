export type VcpToolRequestPolicy = {
  bridgeMode?: "event" | "execute"
  maxPerMessage?: number
  allowTools?: string[]
  denyTools?: string[]
}

const TOOL_PREFIX = /^(tool_request|toolrequest|tool|request|vcp)[\s:._-]*/i

function compactUnderscores(value: string): string {
  return value.replace(/_+/g, "_").replace(/^_+|_+$/g, "")
}

export function normalizeToolName(value: string): string {
  let stripped = value.trim()
  while (true) {
    const next = stripped.replace(TOOL_PREFIX, "")
    if (next === stripped) break
    stripped = next
  }
  const normalized = stripped
    .toLowerCase()
    .replace(/[./\\\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
  return compactUnderscores(normalized)
}

export function buildToolCandidates(value: string): string[] {
  const raw = value.trim()
  if (!raw) return []

  const normalized = normalizeToolName(raw)
  const variants = new Set<string>()

  variants.add(raw)
  if (normalized) {
    variants.add(normalized)
    variants.add(normalized.replace(/_/g, "-"))
    variants.add(normalized.replace(/_/g, ""))
  }

  const dotted = raw.split(".").at(-1)?.trim()
  if (dotted && dotted !== raw) {
    const dottedNormalized = normalizeToolName(dotted)
    if (dottedNormalized) variants.add(dottedNormalized)
  }

  return Array.from(variants).filter(Boolean)
}

export function resolveBridgeMode(policy?: Pick<VcpToolRequestPolicy, "bridgeMode">): "event" | "execute" {
  return policy?.bridgeMode === "event" ? "event" : "execute"
}

export function limitToolRequests<T>(requests: T[], maxPerMessage?: number): T[] {
  if (!Array.isArray(requests) || requests.length === 0) return []
  const max = Number.isFinite(maxPerMessage) && (maxPerMessage ?? 0) > 0 ? Math.floor(maxPerMessage!) : requests.length
  return requests.slice(0, max)
}

function normalizeSet(value?: string[]): Set<string> {
  const entries = new Set<string>()
  for (const item of value ?? []) {
    const normalized = normalizeToolName(item)
    if (normalized) entries.add(normalized)
  }
  return entries
}

export function isToolAllowed(
  toolName: string,
  policy?: Pick<VcpToolRequestPolicy, "allowTools" | "denyTools">,
): { allowed: true } | { allowed: false; reason: string } {
  const normalized = normalizeToolName(toolName)
  if (!normalized) {
    return { allowed: false, reason: "empty tool name" }
  }

  const deny = normalizeSet(policy?.denyTools)
  if (deny.has(normalized)) {
    return { allowed: false, reason: `tool blocked by deny list: ${normalized}` }
  }

  const allow = normalizeSet(policy?.allowTools)
  if (allow.size > 0 && !allow.has(normalized)) {
    return { allowed: false, reason: `tool not present in allow list: ${normalized}` }
  }

  return { allowed: true }
}

export function deriveSkillDispatchName(rawToolName: string): string | undefined {
  const value = rawToolName.trim()
  if (!value) return undefined

  const match = value.match(/^skill[:._-](.+)$/i)
  if (!match) return undefined

  const name = match[1]?.trim()
  return name ? name : undefined
}

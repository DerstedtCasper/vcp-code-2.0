import { createHash } from "crypto"

export function stableConfigString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableConfigString(item)).join(",")}]`
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableConfigString(v)}`).join(",")}}`
  }
  const json = JSON.stringify(value)
  return json === undefined ? "null" : json
}

export function computeConfigHash(config: Record<string, unknown>): string {
  return createHash("sha256").update(stableConfigString(config)).digest("hex")
}

export function deepMergeConfigRecords(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...left }
  for (const [key, value] of Object.entries(right)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMergeConfigRecords(result[key] as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

export function mergeConfigMigrationSources(input: {
  legacy: Record<string, unknown>
  workspace: Record<string, unknown> | null
  backup: Record<string, unknown> | null
  current: Record<string, unknown>
}): Record<string, unknown> {
  let merged: Record<string, unknown> = {}
  if (Object.keys(input.legacy).length > 0) merged = deepMergeConfigRecords(merged, input.legacy)
  if (input.workspace) merged = deepMergeConfigRecords(merged, input.workspace)
  if (input.backup) merged = deepMergeConfigRecords(merged, input.backup)
  merged = deepMergeConfigRecords(merged, input.current)
  return merged
}

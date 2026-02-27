import { describe, it, expect } from "bun:test"
import {
  computeConfigHash,
  deepMergeConfigRecords,
  mergeConfigMigrationSources,
  stableConfigString,
} from "../../src/services/config-ssot-utils"

describe("config-ssot-utils.stableConfigString", () => {
  it("serializes object keys deterministically", () => {
    const a = { b: 2, a: 1 }
    const b = { a: 1, b: 2 }
    expect(stableConfigString(a)).toBe(stableConfigString(b))
  })
})

describe("config-ssot-utils.computeConfigHash", () => {
  it("returns same hash for equivalent objects with different key order", () => {
    const left = { provider: { openai: { models: { gpt5: { id: "gpt5" } } } }, model: "openai/gpt5" }
    const right = { model: "openai/gpt5", provider: { openai: { models: { gpt5: { id: "gpt5" } } } } }
    expect(computeConfigHash(left)).toBe(computeConfigHash(right))
  })
})

describe("config-ssot-utils.deepMergeConfigRecords", () => {
  it("deep merges nested records without dropping existing fields", () => {
    const merged = deepMergeConfigRecords(
      { provider: { openai: { models: { gpt4: { id: "gpt4" } } } } },
      { provider: { openai: { models: { gpt5: { id: "gpt5" } } } } },
    )
    expect(merged.provider).toEqual({
      openai: {
        models: {
          gpt4: { id: "gpt4" },
          gpt5: { id: "gpt5" },
        },
      },
    })
  })
})

describe("config-ssot-utils.mergeConfigMigrationSources", () => {
  it("merges legacy/workspace/backup and keeps current config precedence", () => {
    const merged = mergeConfigMigrationSources({
      legacy: { model: "legacy/a", default_agent: "legacy-agent" },
      workspace: { model: "workspace/b", permission: { read: "allow" } },
      backup: { model: "backup/c", provider: { kilo: { models: { auto: {} } } } },
      current: { model: "current/d", share: "manual" },
    })
    expect(merged.model).toBe("current/d")
    expect(merged.default_agent).toBe("legacy-agent")
    expect(merged.permission).toEqual({ read: "allow" })
    expect(merged.provider).toEqual({ kilo: { models: { auto: {} } } })
    expect(merged.share).toBe("manual")
  })
})

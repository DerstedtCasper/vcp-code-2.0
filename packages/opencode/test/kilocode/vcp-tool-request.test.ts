import { expect, test } from "bun:test"
import {
  buildToolCandidates,
  deriveSkillDispatchName,
  isToolAllowed,
  limitToolRequests,
  normalizeToolName,
  resolveBridgeMode,
} from "../../src/novacode/vcp-tool-request"

test("normalizeToolName handles prefixes and separators", () => {
  expect(normalizeToolName("TOOL: Search-Memory")).toBe("search_memory")
  expect(normalizeToolName("vcp.tool_request.read")).toBe("read")
  expect(normalizeToolName("  Bash  ")).toBe("bash")
})

test("buildToolCandidates includes normalized aliases", () => {
  const candidates = buildToolCandidates("tool.search-memory")
  expect(candidates).toContain("tool.search-memory")
  expect(candidates).toContain("search_memory")
  expect(candidates).toContain("search-memory")
  expect(candidates).toContain("searchmemory")
})

test("resolveBridgeMode defaults to execute", () => {
  expect(resolveBridgeMode(undefined)).toBe("execute")
  expect(resolveBridgeMode({ bridgeMode: "event" })).toBe("event")
  expect(resolveBridgeMode({ bridgeMode: "execute" })).toBe("execute")
})

test("limitToolRequests applies configured cap", () => {
  const values = [1, 2, 3, 4]
  expect(limitToolRequests(values, 2)).toEqual([1, 2])
  expect(limitToolRequests(values, 0)).toEqual(values)
  expect(limitToolRequests(values, undefined)).toEqual(values)
})

test("isToolAllowed honors deny and allow lists", () => {
  expect(isToolAllowed("bash", { denyTools: ["bash"] })).toEqual({
    allowed: false,
    reason: "tool blocked by deny list: bash",
  })
  expect(isToolAllowed("grep", { allowTools: ["read", "glob"] })).toEqual({
    allowed: false,
    reason: "tool not present in allow list: grep",
  })
  expect(isToolAllowed("search_memory", { allowTools: ["search_memory"] })).toEqual({ allowed: true })
})

test("deriveSkillDispatchName extracts skill names from prefixed tool names", () => {
  expect(deriveSkillDispatchName("skill:find-skills")).toBe("find-skills")
  expect(deriveSkillDispatchName("skill.install")).toBe("install")
  expect(deriveSkillDispatchName("skill_custom-workflow")).toBe("custom-workflow")
  expect(deriveSkillDispatchName("search_memory")).toBeUndefined()
})

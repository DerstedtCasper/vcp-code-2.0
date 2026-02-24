import { beforeEach, expect, test } from "bun:test"
import { Storage } from "../../src/storage/storage"
import { VcpMemoryRuntime } from "../../src/kilocode/memory-runtime"

const MEMORY_ATOMIC_KEY = ["vcp_memory", "atomic"] as string[]
const MEMORY_PROFILE_KEY = ["vcp_memory", "profile"] as string[]
const MEMORY_FOLDERS_KEY = ["vcp_memory", "folders"] as string[]

beforeEach(async () => {
  await Storage.write(MEMORY_ATOMIC_KEY, [
    {
      id: "a-1",
      text: "Use markdown table output for release notes.",
      tags: ["release", "markdown"],
      scope: "user",
      role: "user",
      sessionID: "s-1",
      messageID: "m-1",
      createdAt: 1000,
      updatedAt: 2000,
    },
    {
      id: "a-2",
      text: "Folder deploy runbook lives in docs/deploy.md.",
      tags: ["deploy", "runbook"],
      scope: "folder",
      role: "assistant",
      folderID: "repo",
      sessionID: "s-2",
      messageID: "m-2",
      createdAt: 3000,
      updatedAt: 4000,
    },
  ])
  await Storage.write(MEMORY_PROFILE_KEY, {
    preferences: ["Keep responses concise", "Prefer checklist output"],
    style: ["Use Chinese first", "No emojis"],
    facts: ["Repo is monorepo", "Uses Bun"],
    updatedAt: 5000,
  })
  await Storage.write(MEMORY_FOLDERS_KEY, {
    repo: {
      folderID: "repo",
      summary: "Deployment notes and build scripts.",
      highlights: ["bun turbo typecheck", "staging deploy first"],
      updatedAt: 6000,
    },
  })
})

test("preview applies pin/remove overrides for atomic memory hits", async () => {
  const preview = await VcpMemoryRuntime.previewContextBox({
    query: "release notes output",
    directory: "D:/repo",
    topKAtomic: 5,
    removeAtomicIDs: ["a-1"],
    pinAtomicIDs: ["a-2"],
  })

  expect(preview).toBeDefined()
  expect(preview).toContain("[PIN]")
  expect(preview).toContain("docs/deploy.md")
  expect(preview).not.toContain("release notes")
})

test("preview compress mode emits compact atomic entries", async () => {
  const preview = await VcpMemoryRuntime.previewContextBox({
    query: "deploy runbook",
    directory: "D:/repo",
    topKAtomic: 5,
    compress: true,
  })

  expect(preview).toBeDefined()
  expect(preview).toContain("score=")
  expect(preview).not.toContain("[s-2:m-2]")
})


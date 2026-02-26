/**
 * Integration test: /provider/fetch-models backend proxy
 *
 * Tests that the backend can correctly proxy model list requests
 * to an OpenAI-compatible API endpoint.
 *
 * Target: http://127.0.0.1:6005/v1  (OpenAI-compatible, key=sk-890iopKL@)
 */
import { test, expect, describe } from "bun:test"

const TARGET_BASE_URL = "http://127.0.0.1:6005/v1"
const TARGET_API_KEY = "sk-890iopKL@"

// Helper: check if target is reachable before running tests
async function isTargetReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${TARGET_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${TARGET_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

describe("fetch-models backend proxy integration", () => {
  // ── Direct API test (bypasses backend, validates target is alive) ──
  test("direct: GET /v1/models returns model list", async () => {
    const reachable = await isTargetReachable()
    if (!reachable) {
      console.warn("⚠️  Target API not reachable, skipping direct test")
      return
    }
    const res = await fetch(`${TARGET_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${TARGET_API_KEY}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    })
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { data?: unknown[]; object?: string }
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data!.length).toBeGreaterThan(0)
    // Each model should have an id
    const first = body.data![0] as { id?: string }
    expect(typeof first.id).toBe("string")
    console.log(`✅ Direct: ${body.data!.length} models fetched from ${TARGET_BASE_URL}/models`)
  })

  // ── Test buildModelsUrl logic (unit-level) ─────────────────────────
  test("buildModelsUrl: appends /models correctly", () => {
    function buildModelsUrl(baseUrl: string): string {
      if (!baseUrl) return ""
      let url = baseUrl.trim().replace(/\/+$/, "")
      if (url.endsWith("/models")) return url
      return url + "/models"
    }

    // Standard case
    expect(buildModelsUrl("http://127.0.0.1:6005/v1")).toBe("http://127.0.0.1:6005/v1/models")
    // Already has /models
    expect(buildModelsUrl("http://127.0.0.1:6005/v1/models")).toBe("http://127.0.0.1:6005/v1/models")
    // Trailing slash
    expect(buildModelsUrl("http://127.0.0.1:6005/v1/")).toBe("http://127.0.0.1:6005/v1/models")
    // No /v1 suffix
    expect(buildModelsUrl("http://127.0.0.1:6005")).toBe("http://127.0.0.1:6005/models")
    // OpenAI
    expect(buildModelsUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/models")
    // OpenRouter
    expect(buildModelsUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1/models")
    // Empty
    expect(buildModelsUrl("")).toBe("")
  })

  // ── Test backend proxy response format (simulated) ─────────────────
  test("backend proxy: response parsing handles both data and models format", () => {
    // OpenAI format: { data: [...] }
    const openaiBody = {
      data: [
        { id: "gpt-4", object: "model" },
        { id: "gpt-3.5-turbo", object: "model" },
      ],
      object: "list",
    }
    const rawModels1 = openaiBody.data ?? (openaiBody as any).models ?? []
    const models1 = rawModels1.map((m: any) => ({ id: m.id ?? m.name ?? "" })).filter((m: any) => m.id)
    expect(models1.length).toBe(2)
    expect(models1[0].id).toBe("gpt-4")

    // Alternative format: { models: [...] }
    const altBody = {
      models: [
        { id: "model-a", name: "Model A" },
        { id: "model-b", name: "Model B" },
        { id: "model-c", name: "Model C" },
      ],
    }
    const rawModels2 = (altBody as any).data ?? altBody.models ?? []
    const models2 = rawModels2.map((m: any) => ({ id: m.id ?? m.name ?? "" })).filter((m: any) => m.id)
    expect(models2.length).toBe(3)

    // Name-only format
    const nameBody = {
      data: [{ name: "named-model" }],
    }
    const rawModels3 = nameBody.data ?? (nameBody as any).models ?? []
    const models3 = rawModels3.map((m: any) => ({ id: m.id ?? m.name ?? "" })).filter((m: any) => m.id)
    expect(models3.length).toBe(1)
    expect(models3[0].id).toBe("named-model")
  })

  // ── Full round-trip test via backend proxy ─────────────────────────
  // This test requires the VCP-Code backend server to be running.
  // It will be skipped if the backend is not available.
  test("backend proxy: POST /provider/fetch-models returns models", async () => {
    const reachable = await isTargetReachable()
    if (!reachable) {
      console.warn("⚠️  Target API not reachable, skipping backend proxy test")
      return
    }

    // Try to find a running backend instance
    const ports = [13338, 13339, 13340, 13341, 13342]
    let backendPort: number | null = null
    for (const port of ports) {
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          backendPort = port
          break
        }
      } catch {}
    }

    if (!backendPort) {
      console.warn("⚠️  No VCP-Code backend found on ports 13338-13342, skipping backend proxy test")
      return
    }

    console.log(`🔗 Found backend at port ${backendPort}`)

    const res = await fetch(`http://localhost:${backendPort}/provider/fetch-models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_url: `${TARGET_BASE_URL}/models`,
        api_key: TARGET_API_KEY,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    expect(res.ok).toBe(true)
    const body = (await res.json()) as { ok: boolean; models?: Array<{ id: string }>; error?: string }
    expect(body.ok).toBe(true)
    expect(body.models).toBeDefined()
    expect(Array.isArray(body.models)).toBe(true)
    expect(body.models!.length).toBeGreaterThan(0)

    console.log(`✅ Backend proxy: ${body.models!.length} models fetched via /provider/fetch-models`)
    // Verify some expected models exist
    const ids = body.models!.map((m) => m.id)
    const hasAnyKnown = ids.some(
      (id) =>
        id.includes("claude") ||
        id.includes("gemini") ||
        id.includes("deepseek") ||
        id.includes("gpt") ||
        id.includes("glm"),
    )
    expect(hasAnyKnown).toBe(true)
  })

  // ── Error handling: invalid URL ────────────────────────────────────
  test("backend proxy: returns error for unreachable URL", async () => {
    const ports = [13338, 13339, 13340, 13341, 13342]
    let backendPort: number | null = null
    for (const port of ports) {
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          backendPort = port
          break
        }
      } catch {}
    }

    if (!backendPort) {
      console.warn("⚠️  No VCP-Code backend, skipping error handling test")
      return
    }

    const res = await fetch(`http://localhost:${backendPort}/provider/fetch-models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_url: "http://127.0.0.1:59999/v1/models",
        api_key: "fake-key",
      }),
      signal: AbortSignal.timeout(20_000),
    })

    expect(res.ok).toBe(true) // HTTP 200 with error payload
    const body = (await res.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBeDefined()
    console.log(`✅ Error handling: got expected error — ${body.error}`)
  })
})

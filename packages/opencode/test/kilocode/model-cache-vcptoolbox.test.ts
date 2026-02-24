import { test, expect, mock } from "bun:test"
import path from "path"

// Mock BunProc and default plugins to prevent actual installations during tests
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string) => {
      const lastAtIndex = pkg.lastIndexOf("@")
      return lastAtIndex > 0 ? pkg.substring(0, lastAtIndex) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ModelCache } from "../../src/provider/model-cache"

test("vcptoolbox provider uses configurable baseURL + modelsPath", async () => {
  const originalFetch = globalThis.fetch
  const fetchCalls: { url: string; auth: string | null }[] = []

  globalThis.fetch = (async (input: any, init?: any) => {
    const requestURL = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)
    fetchCalls.push({
      url: requestURL,
      auth: headers.get("Authorization"),
    })
    return new Response(
      JSON.stringify({
        data: [{ id: "vcp/model-alpha", created: 1735689600 }],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )
  }) as any

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://app.kilo.ai/config.json",
            provider: {
              vcptoolbox: {
                options: {
                  baseURL: "http://127.0.0.1:6005/v1",
                  modelsPath: "/models",
                  apiKey: "cfg-vcp-key",
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ModelCache.clear("vcptoolbox")
        const models = await ModelCache.fetch("vcptoolbox")
        expect(Object.keys(models)).toContain("vcp/model-alpha")
      },
    })

    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0].url).toBe("http://127.0.0.1:6005/v1/models")
    expect(fetchCalls[0].auth).toBe("Bearer cfg-vcp-key")
  } finally {
    globalThis.fetch = originalFetch
    ModelCache.clear("vcptoolbox")
  }
})

test("vcptoolbox provider allows overriding models endpoint via modelsURL", async () => {
  const originalFetch = globalThis.fetch
  const fetchCalls: string[] = []

  globalThis.fetch = (async (input: any) => {
    const requestURL = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    fetchCalls.push(requestURL)
    return new Response(
      JSON.stringify({
        data: [{ id: "vcp/model-beta" }],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )
  }) as any

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://app.kilo.ai/config.json",
            provider: {
              vcptoolbox: {
                options: {
                  baseURL: "http://127.0.0.1:6005/v1",
                  modelsPath: "/models",
                  modelsURL: "http://127.0.0.1:7001/custom-models",
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ModelCache.clear("vcptoolbox")
        const models = await ModelCache.fetch("vcptoolbox")
        expect(Object.keys(models)).toContain("vcp/model-beta")
      },
    })

    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0]).toBe("http://127.0.0.1:7001/custom-models")
  } finally {
    globalThis.fetch = originalFetch
    ModelCache.clear("vcptoolbox")
  }
})

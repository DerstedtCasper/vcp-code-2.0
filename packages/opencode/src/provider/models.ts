import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Config } from "../config/config" // novacode_change
import { ModelCache } from "./model-cache" // novacode_change
import { Auth } from "../auth" // novacode_change
import { KILO_OPENROUTER_BASE } from "@novacode/nova-gateway" // novacode_change

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

// novacode_change start
const normalizeKiloBaseURL = (baseURL: string | undefined, orgId: string | undefined): string | undefined => {
  if (!baseURL) return undefined
  const trimmed = baseURL.replace(/\/+$/, "")
  if (orgId) {
    if (trimmed.includes("/api/organizations/")) return trimmed
    if (trimmed.endsWith("/api")) return `${trimmed}/organizations/${orgId}`
    return `${trimmed}/api/organizations/${orgId}`
  }
  if (trimmed.includes("/openrouter")) return trimmed
  if (trimmed.endsWith("/api")) return `${trimmed}/openrouter`
  return `${trimmed}/api/openrouter`
} // novacode_change end

const normalizeOptionalBaseURL = (baseURL: string | undefined): string | undefined => {
  const raw = baseURL?.trim()
  if (!raw) return undefined
  return raw.replace(/\/+$/, "")
}

const ensureTrailingSlash = (value: string): string => (value.endsWith("/") ? value : `${value}/`)

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    recommended: z.boolean().optional(), // novacode_change
    recommendedIndex: z.number().optional(), // novacode_change
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  function url() {
    return Flag.KILO_MODELS_URL || "https://models.dev"
  }

  export const Data = lazy(async () => {
    const file = Bun.file(Flag.KILO_MODELS_PATH ?? filepath)
    const result = await file.json().catch(() => {})
    if (result) return result
    // @ts-ignore
    const snapshot = await import("./models-snapshot")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return snapshot
    if (Flag.KILO_DISABLE_MODELS_FETCH) return {}
    const json = await fetch(`${url()}/api.json`).then((x) => x.text())
    return JSON.parse(json)
  })

  export async function get() {
    const result = await Data()
    // novacode_change start
    const providers = result as Record<string, Provider>
    const config = await Config.get()

    if (providers["kilo"]) {
      delete providers["kilo"]
    }

    // Inject kilo provider with dynamic model fetching
    if (!providers["kilo"]) {
      const kiloOptions = config.provider?.kilo?.options
      // novacode_change start - resolve org ID from auth (OAuth accountId) not just config
      const kiloAuth = await Auth.get("kilo")
      const kiloOrgId =
        kiloOptions?.novacodeOrganizationId ?? (kiloAuth?.type === "oauth" ? kiloAuth.accountId : undefined)
      // novacode_change end
      const normalizedBaseURL = normalizeKiloBaseURL(kiloOptions?.baseURL, kiloOrgId)
      const kiloFetchOptions = {
        ...(normalizedBaseURL ? { baseURL: normalizedBaseURL } : {}),
        ...(kiloOrgId ? { novacodeOrganizationId: kiloOrgId } : {}),
      }
      const defaultBaseURL = kiloOrgId
        ? `https://api.kilo.ai/api/organizations/${kiloOrgId}`
        : "https://api.kilo.ai/api/openrouter"
      const kiloModels = await ModelCache.fetch("kilo", kiloFetchOptions).catch(() => ({}))
      providers["kilo"] = {
        id: "kilo",
        name: "Nova Gateway",
        env: ["KILO_API_KEY"],
        api: ensureTrailingSlash(normalizedBaseURL ?? defaultBaseURL ?? KILO_OPENROUTER_BASE),
        npm: "@novacode/nova-gateway",
        models: kiloModels,
      }
      if (Object.keys(kiloModels).length === 0) {
        ModelCache.refresh("kilo", kiloFetchOptions).catch(() => {})
      }
    }

    if (!providers["vcptoolbox"]) {
      const vcptoolboxOptions = config.provider?.vcptoolbox?.options
      const vcptoolboxBaseURL = normalizeOptionalBaseURL(
        vcptoolboxOptions?.baseURL ?? process.env.VCPTOOLBOX_BASE_URL ?? process.env.VCP_BASE_URL,
      )
      const vcptoolboxModelsPath =
        vcptoolboxOptions?.modelsPath ?? process.env.VCPTOOLBOX_MODELS_PATH ?? process.env.VCP_MODELS_PATH
      const vcptoolboxModelsURL =
        vcptoolboxOptions?.modelsURL ?? process.env.VCPTOOLBOX_MODELS_URL ?? process.env.VCP_MODELS_URL

      const vcptoolboxFetchOptions = {
        ...(vcptoolboxBaseURL ? { baseURL: vcptoolboxBaseURL } : {}),
        ...(vcptoolboxModelsPath ? { modelsPath: vcptoolboxModelsPath } : {}),
        ...(vcptoolboxModelsURL ? { modelsURL: vcptoolboxModelsURL } : {}),
      }
      const vcptoolboxModels = await ModelCache.fetch("vcptoolbox", vcptoolboxFetchOptions).catch(() => ({}))

      providers["vcptoolbox"] = {
        id: "vcptoolbox",
        name: "VCPToolBox",
        env: ["VCPTOOLBOX_API_KEY", "VCP_API_KEY"],
        api: vcptoolboxBaseURL ? ensureTrailingSlash(vcptoolboxBaseURL) : undefined,
        npm: "@ai-sdk/openai-compatible",
        models: vcptoolboxModels,
      }

      if (Object.keys(vcptoolboxModels).length === 0) {
        ModelCache.refresh("vcptoolbox", vcptoolboxFetchOptions).catch(() => {})
      }
    }

    return providers
    // novacode_change end
  }

  export async function refresh() {
    const file = Bun.file(filepath)
    const result = await fetch(`${url()}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) {
      await Bun.write(file, await result.text())
      ModelsDev.Data.reset()
    }
  }
}

if (!Flag.KILO_DISABLE_MODELS_FETCH) {
  ModelsDev.refresh()
  setInterval(
    async () => {
      await ModelsDev.refresh()
    },
    60 * 1000 * 60,
  ).unref()
}

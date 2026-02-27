import z from "zod"
import { Wildcard } from "../util/wildcard"

export namespace YoloRouter {
  export const Route = z.enum(["approve", "escalate_to_human", "deny"])
  export type Route = z.infer<typeof Route>

  export const Config = z
    .object({
      enabled: z.boolean().optional().default(false),
      use_small_model: z.boolean().optional().default(false),
      confidence_threshold: z.number().min(0).max(1).optional().default(0.82),
      auto_approve_readonly: z.boolean().optional().default(true),
      force_human: z.array(z.string()).optional().default([]),
    })
    .strict()

  export type Config = z.infer<typeof Config>

  export interface Decision {
    route: Route
    confidence: number
    reason: string
    source: "heuristic" | "small_model"
  }

  export interface Input {
    permission: string
    pattern?: string | string[]
    message?: string
    metadata?: Record<string, unknown>
  }

  const READ_ONLY = new Set(["read", "glob", "grep", "webfetch", "websearch", "codesearch", "todoread", "list"])
  const HIGH_RISK = new Set(["edit", "write", "patch", "multiedit", "bash", "task", "external_directory"])
  const DENY_PATTERN = /\b(rm\s+-rf|truncate\s+table|drop\s+table|del\s+\/f|format\s+c:|shutdown|reboot)\b/i

  function toPatterns(input: Input): string[] {
    if (!input.pattern) return []
    return Array.isArray(input.pattern) ? input.pattern : [input.pattern]
  }

  function combinedText(input: Input): string {
    const patternText = toPatterns(input).join(" ")
    const metadataText = JSON.stringify(input.metadata ?? {})
    return `${input.message ?? ""} ${patternText} ${metadataText}`.trim()
  }

  function matchForceHuman(patterns: string[], forceHuman: string[]): boolean {
    if (forceHuman.length === 0 || patterns.length === 0) return false
    return patterns.some((pattern) => forceHuman.some((rule) => Wildcard.match(pattern, rule)))
  }

  function heuristicDecision(input: Input, config: Config): Decision {
    const permission = input.permission.toLowerCase()
    const patterns = toPatterns(input)
    const text = combinedText(input)

    if (!config.enabled) {
      return {
        route: "escalate_to_human",
        confidence: 0.5,
        reason: "yolo disabled",
        source: "heuristic",
      }
    }

    if (DENY_PATTERN.test(text)) {
      return {
        route: "deny",
        confidence: 0.99,
        reason: "dangerous pattern detected",
        source: "heuristic",
      }
    }

    if (matchForceHuman(patterns, config.force_human)) {
      return {
        route: "escalate_to_human",
        confidence: 0.98,
        reason: "force_human rule matched",
        source: "heuristic",
      }
    }

    if (HIGH_RISK.has(permission)) {
      return {
        route: "escalate_to_human",
        confidence: Math.max(config.confidence_threshold, 0.92),
        reason: "high-risk permission",
        source: "heuristic",
      }
    }

    if (config.auto_approve_readonly && READ_ONLY.has(permission)) {
      return {
        route: "approve",
        confidence: 0.9,
        reason: "read-only permission",
        source: "heuristic",
      }
    }

    return {
      route: "escalate_to_human",
      confidence: Math.max(config.confidence_threshold, 0.7),
      reason: "not in auto-approve scope",
      source: "heuristic",
    }
  }

  export function decide(input: Input, cfg: Partial<Config> | undefined): Decision {
    const config = Config.parse(cfg ?? {})
    return heuristicDecision(input, config)
  }

  function stripMarkdownCodeFence(text: string): string {
    const trimmed = text.trim()
    if (!trimmed.startsWith("```")) return trimmed
    const firstNewline = trimmed.indexOf("\n")
    if (firstNewline < 0) return trimmed.replace(/```/g, "").trim()
    const withoutStart = trimmed.slice(firstNewline + 1)
    if (!withoutStart.endsWith("```")) return withoutStart.trim()
    return withoutStart.slice(0, -3).trim()
  }

  const ModelOutput = z
    .object({
      route: Route,
      confidence: z.number().min(0).max(1),
      reason: z.string().min(1),
    })
    .strict()

  async function smallModelDecision(input: Input, config: Config): Promise<Decision | undefined> {
    if (!config.use_small_model) return undefined

    const [{ Provider }, { LLM }] = await Promise.all([import("@/provider/provider"), import("@/session/llm")])
    const defaultModel = await Provider.defaultModel()
    const model =
      (await Provider.getSmallModel(defaultModel.providerID)) ??
      (await Provider.getModel(defaultModel.providerID, defaultModel.modelID))

    const stream = await LLM.stream({
      agent: {
        name: "permission-yolo-router",
        mode: "primary",
        hidden: true,
        options: {},
        permission: [],
        prompt: [
          "You are a strict permission routing model.",
          "Return JSON only with keys: route, confidence, reason.",
          "Allowed routes: approve, escalate_to_human, deny.",
          "Set confidence between 0 and 1.",
          "Never approve destructive actions.",
        ].join(" "),
        temperature: 0,
      },
      user: {
        id: "permission-yolo-router",
        sessionID: "permission-yolo-router",
        role: "user",
        model: {
          providerID: model.providerID,
          modelID: model.id,
        },
        time: {
          created: Date.now(),
          completed: Date.now(),
        },
      } as any,
      tools: {},
      model,
      small: true,
      messages: [
        {
          role: "user" as const,
          content: JSON.stringify({
            permission: input.permission,
            pattern: input.pattern ?? [],
            message: input.message ?? "",
            metadata: input.metadata ?? {},
            threshold: config.confidence_threshold,
          }),
        },
      ],
      abort: new AbortController().signal,
      sessionID: "permission-yolo-router",
      system: [],
      retries: 1,
    })

    const raw = stripMarkdownCodeFence(await stream.text)
    const parsed = ModelOutput.safeParse(JSON.parse(raw))
    if (!parsed.success) return undefined

    const route = parsed.data.route === "approve" && parsed.data.confidence < config.confidence_threshold
      ? "escalate_to_human"
      : parsed.data.route

    return {
      route,
      confidence: parsed.data.confidence,
      reason: parsed.data.reason,
      source: "small_model",
    }
  }

  export async function route(input: Input, cfg: Partial<Config> | undefined): Promise<Decision> {
    const config = Config.parse(cfg ?? {})
    const heuristic = heuristicDecision(input, config)
    if (!config.enabled) return heuristic
    if (heuristic.route === "deny") return heuristic
    try {
      const fromModel = await smallModelDecision(input, config)
      return fromModel ?? heuristic
    } catch {
      return heuristic
    }
  }
}

import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { proxy } from "hono/proxy"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { LSP } from "../lsp"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill/skill"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { TelemetryRoutes } from "./routes/telemetry" // novacode_change
import { ProviderRoutes } from "./routes/provider"
import { createKiloRoutes } from "@novacode/nova-gateway" // novacode_change
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { NotFoundError } from "../storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { CommitMessageRoutes } from "./routes/commit-message"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { VCPBridge } from "../vcp-bridge" // novacode_change - VCP Bridge
import { Marketplace } from "../marketplace" // novacode_change - Marketplace
import { CodeIndex } from "../code-index" // novacode_change - Code Index T-1.9

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []

  function isVSCodeWebviewOrigin(input: string | undefined): boolean {
    if (!input) return false
    const origin = input.toLowerCase()
    return origin.startsWith("vscode-webview://") || origin.startsWith("vscode-file://")
  }

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  const app = new Hono()
  export const App: () => Hono = lazy(
    () =>
      // TODO: Break server.ts into smaller route files to fix type inference
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          if (err instanceof HTTPException) return err.getResponse()
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .use((c, next) => {
          // Allow CORS preflight requests to succeed without auth.
          // Browser clients sending Authorization headers will preflight with OPTIONS.
          if (c.req.method === "OPTIONS") return next()
          if (isVSCodeWebviewOrigin(c.req.header("origin"))) return next()
          const password = Flag.KILO_SERVER_PASSWORD
          if (!password) return next()
          const username = Flag.KILO_SERVER_USERNAME ?? "kilo" // novacode_change
          return basicAuth({ username, password })(c, next)
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log"
          if (!skipLogging) {
            log.info("request", {
              method: c.req.method,
              path: c.req.path,
            })
          }
          const timer = log.time("request", {
            method: c.req.method,
            path: c.req.path,
          })
          await next()
          if (!skipLogging) {
            timer.stop()
          }
        })
        .use(
          cors({
            origin(input) {
              if (!input) return
              if (isVSCodeWebviewOrigin(input)) return input

              if (input.startsWith("http://localhost:")) return input
              if (input.startsWith("http://127.0.0.1:")) return input
              if (
                input === "tauri://localhost" ||
                input === "http://tauri.localhost" ||
                input === "https://tauri.localhost"
              )
                return input

              // *.opencode.ai (https only, adjust if needed)
              if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) {
                return input
              }
              if (_corsWhitelist.includes(input)) {
                return input
              }

              return
            },
          }),
        )
        .route("/global", GlobalRoutes())
        .put(
          "/auth/:providerID",
          describeRoute({
            summary: "Set auth credentials",
            description: "Set authentication credentials",
            operationId: "auth.set",
            responses: {
              200: {
                description: "Successfully set authentication credentials",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          validator("json", Auth.Info),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            const info = c.req.valid("json")
            await Auth.set(providerID, info)
            return c.json(true)
          },
        )
        .delete(
          "/auth/:providerID",
          describeRoute({
            summary: "Remove auth credentials",
            description: "Remove authentication credentials",
            operationId: "auth.remove",
            responses: {
              200: {
                description: "Successfully removed authentication credentials",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            await Auth.remove(providerID)
            return c.json(true)
          },
        )
        .use(async (c, next) => {
          if (c.req.path === "/log") return next()
          const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
          const directory = (() => {
            try {
              return decodeURIComponent(raw)
            } catch {
              return raw
            }
          })()
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              return next()
            },
          })
        })
        .get(
          "/doc",
          openAPIRouteHandler(app, {
            documentation: {
              info: {
                title: "opencode",
                version: "0.0.3",
                description: "opencode api",
              },
              openapi: "3.1.1",
            },
          }),
        )
        .use(validator("query", z.object({ directory: z.string().optional() })))
        .route("/project", ProjectRoutes())
        .route("/pty", PtyRoutes())
        .route("/config", ConfigRoutes())
        .route("/experimental", ExperimentalRoutes())
        .route("/session", SessionRoutes())
        .route("/permission", PermissionRoutes())
        .route("/question", QuestionRoutes())
        .route("/provider", ProviderRoutes())
        .route("/telemetry", TelemetryRoutes()) // novacode_change
        .route("/commit-message", CommitMessageRoutes()) // novacode_change
        // novacode_change start - Nova Gateway routes
        .route(
          "/kilo",
          createKiloRoutes({
            Hono,
            describeRoute,
            validator,
            resolver,
            errors,
            Auth,
            z,
          }),
        )
        // novacode_change end
        .route("/", FileRoutes())
        .route("/mcp", McpRoutes())
        .route("/tui", TuiRoutes())
        // novacode_change start - VCP Bridge REST endpoints
        .get(
          "/vcp/bridge/status",
          describeRoute({
            summary: "Get VCP Bridge status",
            description: "Get the current connection status of the VCP Bridge to VCPToolBox.",
            operationId: "vcp.bridge.status",
            responses: {
              200: {
                description: "VCP Bridge status",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(VCPBridge.getStatus())
          },
        )
        .get(
          "/vcp/bridge/stats",
          describeRoute({
            summary: "Get VCP runtime stats",
            description: "Get aggregated runtime statistics from VCPToolBox including plugin status, resource usage, and recent logs.",
            operationId: "vcp.bridge.stats",
            responses: {
              200: {
                description: "VCP runtime stats",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(VCPBridge.getStats())
          },
        )
        .get(
          "/vcp/bridge/commands",
          describeRoute({
            summary: "Get VCP plugin commands",
            description: "Get slash commands registered by VCPToolBox plugins.",
            operationId: "vcp.bridge.commands",
            responses: {
              200: {
                description: "List of VCP plugin commands",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const commands = await VCPBridge.getPluginCommands()
            return c.json(commands)
          },
        )
        .get(
          "/vcp/bridge/events",
          describeRoute({
            summary: "Subscribe to VCP Bridge events",
            description: "Server-Sent Events stream for real-time VCPToolBox updates.",
            operationId: "vcp.bridge.events",
            responses: {
              200: {
                description: "VCP event stream",
                content: {
                  "text/event-stream": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return streamSSE(c, async (stream) => {
              // Send initial stats
              stream.writeSSE({
                event: "stats",
                data: JSON.stringify(VCPBridge.getStats()),
              })

              // Subscribe to stats updates
              const unsub = VCPBridge.onStatsUpdate((stats) => {
                stream.writeSSE({
                  event: "stats",
                  data: JSON.stringify(stats),
                })
              })

              // Heartbeat
              const heartbeat = setInterval(() => {
                stream.writeSSE({
                  event: "heartbeat",
                  data: JSON.stringify({ time: Date.now() }),
                })
              }, 30000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                })
              })
            })
          },
        )
        // novacode_change end
        // novacode_change start - Marketplace REST API
        .get(
          "/marketplace/catalog",
          describeRoute({
            summary: "Get marketplace catalog",
            description: "Fetch all marketplace items (skills, modes, MCPs) from configured upstream sources.",
            operationId: "marketplace.catalog",
            responses: {
              200: {
                description: "Marketplace catalogs array",
                content: {
                  "application/json": {
                    schema: resolver(z.array(z.any())),
                  },
                },
              },
            },
          }),
          async (c) => {
            const catalogs = await Marketplace.getCatalogs()
            return c.json(catalogs)
          },
        )
        .post(
          "/marketplace/refresh",
          describeRoute({
            summary: "Refresh marketplace catalog",
            description: "Force refetch marketplace data from all upstream sources.",
            operationId: "marketplace.refresh",
            responses: {
              200: {
                description: "Refreshed catalogs",
                content: {
                  "application/json": {
                    schema: resolver(z.array(z.any())),
                  },
                },
              },
            },
          }),
          async (c) => {
            Marketplace.invalidateCache()
            const catalogs = await Marketplace.refresh()
            return c.json(catalogs)
          },
        )
        .get(
          "/marketplace/skills",
          describeRoute({
            summary: "List marketplace skills",
            description: "List available skills from the marketplace, optionally filtered by query.",
            operationId: "marketplace.skills",
            responses: {
              200: {
                description: "Skills list",
                content: {
                  "application/json": {
                    schema: resolver(z.array(z.any())),
                  },
                },
              },
            },
          }),
          async (c) => {
            const query = c.req.query("q")
            const skills = await Marketplace.listSkills(query)
            return c.json(skills)
          },
        )
        .get(
          "/marketplace/modes",
          describeRoute({
            summary: "List marketplace modes",
            description: "List available modes from the marketplace, optionally filtered by query.",
            operationId: "marketplace.modes",
            responses: {
              200: {
                description: "Modes list",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const query = c.req.query("q")
            const modes = await Marketplace.listModes(query)
            return c.json(modes)
          },
        )
        .get(
          "/marketplace/mcps",
          describeRoute({
            summary: "List marketplace MCPs",
            description: "List available MCP servers from the marketplace, optionally filtered by query.",
            operationId: "marketplace.mcps",
            responses: {
              200: {
                description: "MCPs list",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const query = c.req.query("q")
            const mcps = await Marketplace.listMCPs(query)
            return c.json(mcps)
          },
        )
        .get(
          "/marketplace/search",
          describeRoute({
            summary: "Search marketplace",
            description: "Search across all marketplace items (skills, modes, MCPs).",
            operationId: "marketplace.search",
            responses: {
              200: {
                description: "Search results",
                content: {
                  "application/json": {
                    schema: resolver(z.array(z.any())),
                  },
                },
              },
            },
          }),
          async (c) => {
            const query = c.req.query("q") ?? ""
            const type = c.req.query("type") as "skill" | "mode" | "mcp" | undefined
            const results = await Marketplace.search(query, type)
            return c.json(results)
          },
        )
        .post(
          "/marketplace/install",
          describeRoute({
            summary: "Install marketplace item",
            description: "Install a skill, mode, or MCP server from the marketplace into local configuration.",
            operationId: "marketplace.install",
            responses: {
              200: {
                description: "Installation result",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        success: z.boolean(),
                        message: z.string(),
                        installedPath: z.string().optional(),
                      }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            const body = await c.req.json()
            const result = await Marketplace.install(body)
            return c.json(result)
          },
        )
        .get(
          "/marketplace/installed",
          describeRoute({
            summary: "List installed marketplace items",
            description: "List MCPs and modes currently installed in the configuration.",
            operationId: "marketplace.installed",
            responses: {
              200: {
                description: "Installed items",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const installed = await Marketplace.getInstalledList()
            return c.json(installed)
          },
        )
        .post(
          "/provider/fetch-models",
          describeRoute({
            summary: "Fetch models from provider",
            description:
              "Proxy endpoint to fetch the model list from a remote OpenAI-compatible provider. " +
              "Avoids CORS issues when calling from the webview.",
            operationId: "provider.fetchModels",
            responses: {
              200: {
                description: "Model list from provider",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        ok: z.boolean(),
                        models: z.array(z.object({ id: z.string() })).optional(),
                        error: z.string().optional(),
                      }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            try {
              const { base_url, api_key } = await c.req.json<{
                base_url: string
                api_key: string
              }>()
              if (!base_url) return c.json({ ok: false, error: "base_url is required" })
              // The frontend now sends a fully resolved models URL (e.g. https://api.openai.com/v1/models).
              // As a safety net, if the URL doesn't end with /models, try appending it.
              let url = base_url.replace(/\/+$/, "")
              if (!url.endsWith("/models")) {
                // Try the URL as-is first (some providers use non-standard paths)
                // but the primary strategy is: the frontend resolves the correct URL.
                if (!url.match(/\/v\d+/)) url += "/v1"
                url += "/models"
              }
              const headers: Record<string, string> = {
                Accept: "application/json",
              }
              if (api_key) headers.Authorization = `Bearer ${api_key}`
              const res = await fetch(url, {
                method: "GET",
                headers,
                signal: AbortSignal.timeout(15_000),
              })
              if (!res.ok) {
                const body = await res.text().catch(() => "")
                return c.json({
                  ok: false,
                  error: `Provider returned HTTP ${res.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
                })
              }
              const body = (await res.json()) as {
                data?: Array<{ id?: string; name?: string }>
                models?: Array<{ id?: string; name?: string }>
              }
              // OpenAI-compatible: { data: [...] }. Some providers return { models: [...] }.
              const rawModels = body.data ?? body.models ?? []
              const models = rawModels
                .map((m) => ({ id: m.id ?? m.name ?? "" }))
                .filter((m) => m.id)
              if (models.length === 0) {
                return c.json({
                  ok: false,
                  error: "Provider responded but returned 0 models. Check URL and API key.",
                })
              }
              return c.json({ ok: true, models })
            } catch (err: any) {
              const msg = String(err?.message ?? err)
              // Provide user-friendly hints for common errors
              if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
                return c.json({ ok: false, error: `Cannot reach provider: ${msg}` })
              }
              if (msg.includes("timeout") || msg.includes("AbortError")) {
                return c.json({ ok: false, error: "Request timed out (15s). Check the URL and network." })
              }
              return c.json({ ok: false, error: msg })
            }
          },
        )
        // novacode_change end
        // novacode_change start - Code Index management endpoints (T-1.9)
        .get(
          "/code-index/status",
          describeRoute({
            summary: "Get code index status",
            description: "Get the current status of the codebase semantic index (idle, indexing, error, disabled).",
            operationId: "codeIndex.status",
            responses: {
              200: {
                description: "Index status",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json({
              status: CodeIndex.status(),
              enabled: CodeIndex.isEnabled(),
              progress: CodeIndex.progress(),
            })
          },
        )
        .get(
          "/code-index/stats",
          describeRoute({
            summary: "Get code index statistics",
            description: "Get statistics about the code index (chunk count, file count, last indexed time).",
            operationId: "codeIndex.stats",
            responses: {
              200: {
                description: "Index statistics",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(CodeIndex.stats())
          },
        )
        .post(
          "/code-index/rebuild",
          describeRoute({
            summary: "Rebuild code index",
            description: "Trigger a full rebuild of the codebase semantic index. This will re-scan, re-parse, and re-embed all files.",
            operationId: "codeIndex.rebuild",
            responses: {
              200: {
                description: "Rebuild started",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        success: z.boolean(),
                        message: z.string(),
                      }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            if (!CodeIndex.isEnabled()) {
              return c.json({ success: false, message: "Code index is disabled. Enable it in settings first." })
            }
            // Run rebuild in background
            CodeIndex.rebuild().catch((err) => {
              log.error("code index rebuild failed", { err })
            })
            return c.json({ success: true, message: "Rebuild started" })
          },
        )
        .post(
          "/code-index/clear",
          describeRoute({
            summary: "Clear code index",
            description: "Clear all indexed data from the vector store.",
            operationId: "codeIndex.clear",
            responses: {
              200: {
                description: "Index cleared",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        success: z.boolean(),
                        message: z.string(),
                      }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            try {
              await CodeIndex.clear()
              return c.json({ success: true, message: "Index cleared" })
            } catch (err: any) {
              return c.json({ success: false, message: String(err?.message ?? err) })
            }
          },
        )
        .get(
          "/code-index/events",
          describeRoute({
            summary: "Subscribe to code index events",
            description: "Server-Sent Events stream for real-time code index progress updates.",
            operationId: "codeIndex.events",
            responses: {
              200: {
                description: "Index event stream",
                content: {
                  "text/event-stream": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return streamSSE(c, async (stream) => {
              // Send initial progress
              stream.writeSSE({
                event: "progress",
                data: JSON.stringify(CodeIndex.progress()),
              })

              // Subscribe to progress updates
              const unsub = CodeIndex.onProgress((progress) => {
                stream.writeSSE({
                  event: "progress",
                  data: JSON.stringify(progress),
                })
              })

              // Heartbeat
              const heartbeat = setInterval(() => {
                stream.writeSSE({
                  event: "heartbeat",
                  data: JSON.stringify({ time: Date.now() }),
                })
              }, 30000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                })
              })
            })
          },
        )
        // novacode_change end
        .post(
          "/instance/dispose",
          describeRoute({
            summary: "Dispose instance",
            description: "Clean up and dispose the current OpenCode instance, releasing all resources.",
            operationId: "instance.dispose",
            responses: {
              200: {
                description: "Instance disposed",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Instance.dispose()
            return c.json(true)
          },
        )
        .get(
          "/path",
          describeRoute({
            summary: "Get paths",
            description:
              "Retrieve the current working directory and related path information for the OpenCode instance.",
            operationId: "path.get",
            responses: {
              200: {
                description: "Path",
                content: {
                  "application/json": {
                    schema: resolver(
                      z
                        .object({
                          home: z.string(),
                          state: z.string(),
                          config: z.string(),
                          worktree: z.string(),
                          directory: z.string(),
                        })
                        .meta({
                          ref: "Path",
                        }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json({
              home: Global.Path.home,
              state: Global.Path.state,
              config: Global.Path.config,
              worktree: Instance.worktree,
              directory: Instance.directory,
            })
          },
        )
        .get(
          "/vcs",
          describeRoute({
            summary: "Get VCS info",
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
            operationId: "vcs.get",
            responses: {
              200: {
                description: "VCS info",
                content: {
                  "application/json": {
                    schema: resolver(Vcs.Info),
                  },
                },
              },
            },
          }),
          async (c) => {
            const branch = await Vcs.branch()
            return c.json({
              branch,
            })
          },
        )
        .get(
          "/command",
          describeRoute({
            summary: "List commands",
            description: "Get a list of all available commands in the OpenCode system.",
            operationId: "command.list",
            responses: {
              200: {
                description: "List of commands",
                content: {
                  "application/json": {
                    schema: resolver(Command.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const commands = await Command.list()
            return c.json(commands)
          },
        )
        .post(
          "/log",
          describeRoute({
            summary: "Write log",
            description: "Write a log entry to the server logs with specified level and metadata.",
            operationId: "app.log",
            responses: {
              200: {
                description: "Log entry written successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              service: z.string().meta({ description: "Service name for the log entry" }),
              level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
              message: z.string().meta({ description: "Log message" }),
              extra: z
                .record(z.string(), z.any())
                .optional()
                .meta({ description: "Additional metadata for the log entry" }),
            }),
          ),
          async (c) => {
            const { service, level, message, extra } = c.req.valid("json")
            const logger = Log.create({ service })

            switch (level) {
              case "debug":
                logger.debug(message, extra)
                break
              case "info":
                logger.info(message, extra)
                break
              case "error":
                logger.error(message, extra)
                break
              case "warn":
                logger.warn(message, extra)
                break
            }

            return c.json(true)
          },
        )
        .get(
          "/agent",
          describeRoute({
            summary: "List agents",
            description: "Get a list of all available AI agents in the OpenCode system.",
            operationId: "app.agents",
            responses: {
              200: {
                description: "List of agents",
                content: {
                  "application/json": {
                    schema: resolver(Agent.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const modes = await Agent.list()
            return c.json(modes)
          },
        )
        .get(
          "/skill",
          describeRoute({
            summary: "List skills",
            description: "Get a list of all available skills in the OpenCode system.",
            operationId: "app.skills",
            responses: {
              200: {
                description: "List of skills",
                content: {
                  "application/json": {
                    schema: resolver(Skill.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const skills = await Skill.all()
            return c.json(skills)
          },
        )
        .get(
          "/lsp",
          describeRoute({
            summary: "Get LSP status",
            description: "Get LSP server status",
            operationId: "lsp.status",
            responses: {
              200: {
                description: "LSP server status",
                content: {
                  "application/json": {
                    schema: resolver(LSP.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await LSP.status())
          },
        )
        .get(
          "/formatter",
          describeRoute({
            summary: "Get formatter status",
            description: "Get formatter status",
            operationId: "formatter.status",
            responses: {
              200: {
                description: "Formatter status",
                content: {
                  "application/json": {
                    schema: resolver(Format.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await Format.status())
          },
        )
        .get(
          "/event",
          describeRoute({
            summary: "Subscribe to events",
            description: "Get events",
            operationId: "event.subscribe",
            responses: {
              200: {
                description: "Event stream",
                content: {
                  "text/event-stream": {
                    schema: resolver(BusEvent.payloads()),
                  },
                },
              },
            },
          }),
          async (c) => {
            log.info("event connected")
            return streamSSE(c, async (stream) => {
              stream.writeSSE({
                data: JSON.stringify({
                  type: "server.connected",
                  properties: {},
                }),
              })
              const unsub = Bus.subscribeAll(async (event) => {
                await stream.writeSSE({
                  data: JSON.stringify(event),
                })
                if (event.type === Bus.InstanceDisposed.type) {
                  stream.close()
                }
              })

              // Send heartbeat every 30s to prevent WKWebView timeout (60s default)
              const heartbeat = setInterval(() => {
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "server.heartbeat",
                    properties: {},
                  }),
                })
              }, 30000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                  log.info("event disconnected")
                })
              })
            })
          },
        )
        .all("/*", async (c) => {
          const path = c.req.path

          const response = await proxy(`https://app.opencode.ai${path}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.opencode.ai",
            },
          })
          response.headers.set(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:",
          )
          return response
        }) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
      documentation: {
        info: {
          title: "opencode",
          version: "1.0.0",
          description: "opencode api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}

import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ToolRegistry } from "../../tool/registry"
import { Worktree } from "../../worktree"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { VcpPromptQueue } from "../../kilocode/prompt-queue"
import { VcpMemoryRuntime } from "../../kilocode/memory-runtime"
import { SessionStatus } from "../../session/status"

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .get(
      "/vcp/config/revision",
      describeRoute({
        summary: "Get global config revision",
        description: "Retrieve the current global config revision used for optimistic concurrency control.",
        operationId: "experimental.vcp.config.revision",
        responses: {
          200: {
            description: "Global config revision",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    revision: z.number().int().nonnegative(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const snapshot = await Config.getGlobalWithRevision()
        return c.json({ revision: snapshot.revision })
      },
    )
    .get(
      "/vcp/agent-team/status",
      describeRoute({
        summary: "Get VCP agent_team runtime status",
        description: "Returns agent_team configuration and session runtime status counters.",
        operationId: "experimental.vcp.agentTeam.status",
        responses: {
          200: {
            description: "Agent team runtime status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    enabled: z.boolean(),
                    config: z
                      .object({
                        enabled: z.boolean().optional(),
                        maxParallel: z.number().optional(),
                        waveStrategy: z.enum(["auto", "conservative", "aggressive"]).optional(),
                        requireFileSeparation: z.boolean().optional(),
                        handoffFormat: z.enum(["summary", "checklist"]).optional(),
                      })
                      .default({}),
                    sessionStatus: z.object({
                      busy: z.number().int().nonnegative(),
                      idle: z.number().int().nonnegative(),
                      retry: z.number().int().nonnegative(),
                      total: z.number().int().nonnegative(),
                    }),
                    updatedAt: z.number().int().nonnegative(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const statusMap = SessionStatus.list()
        let busy = 0
        let idle = 0
        let retry = 0
        for (const status of Object.values(statusMap)) {
          if (status.type === "busy") busy += 1
          else if (status.type === "idle") idle += 1
          else retry += 1
        }
        return c.json({
          enabled: config.vcp?.agentTeam?.enabled ?? false,
          config: config.vcp?.agentTeam ?? {},
          sessionStatus: {
            busy,
            idle,
            retry,
            total: busy + idle + retry,
          },
          updatedAt: Date.now(),
        })
      },
    )
    .get(
      "/vcp/queue/:sessionID",
      describeRoute({
        summary: "Get VCP prompt queue",
        description: "Get queued prompts for a session.",
        operationId: "experimental.vcp.queue.list",
        responses: {
          200: {
            description: "Session prompt queue",
            content: {
              "application/json": {
                schema: resolver(z.array(VcpPromptQueue.Item)),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        return c.json(VcpPromptQueue.list(sessionID))
      },
    )
    .post(
      "/vcp/queue/:sessionID",
      describeRoute({
        summary: "Enqueue VCP prompt",
        description: "Add a prompt to a session queue.",
        operationId: "experimental.vcp.queue.enqueue",
        responses: {
          200: {
            description: "Updated prompt queue",
            content: {
              "application/json": {
                schema: resolver(z.array(VcpPromptQueue.Item)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator(
        "json",
        z.object({
          text: z.string(),
          files: VcpPromptQueue.Item.shape.files,
          policy: VcpPromptQueue.Item.shape.policy,
          priority: z.number().int().default(0),
          providerID: z.string().optional(),
          modelID: z.string().optional(),
          agent: z.string().optional(),
          variant: z.string().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(VcpPromptQueue.enqueue(sessionID, body))
      },
    )
    .delete(
      "/vcp/queue/:sessionID/:itemID",
      describeRoute({
        summary: "Remove queued prompt",
        description: "Remove a queued prompt from a session by id.",
        operationId: "experimental.vcp.queue.dequeue",
        responses: {
          200: {
            description: "Updated prompt queue",
            content: {
              "application/json": {
                schema: resolver(z.array(VcpPromptQueue.Item)),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), itemID: z.string() })),
      async (c) => {
        const { sessionID, itemID } = c.req.valid("param")
        return c.json(VcpPromptQueue.dequeue(sessionID, itemID))
      },
    )
    .patch(
      "/vcp/queue/:sessionID/reorder",
      describeRoute({
        summary: "Reorder queued prompts",
        description: "Reorder queue items by explicit id order.",
        operationId: "experimental.vcp.queue.reorder",
        responses: {
          200: {
            description: "Updated prompt queue",
            content: {
              "application/json": {
                schema: resolver(z.array(VcpPromptQueue.Item)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator(
        "json",
        z.object({
          itemIDs: z.array(z.string()),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const { itemIDs } = c.req.valid("json")
        return c.json(VcpPromptQueue.reorder(sessionID, itemIDs))
      },
    )
    .get(
      "/vcp/memory/overview",
      describeRoute({
        summary: "Get VCP memory overview",
        description: "Get memory overview including profile, folder docs and recent atomic memories.",
        operationId: "experimental.vcp.memory.overview",
        responses: {
          200: {
            description: "Memory overview",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    atomicTotal: z.number().int().nonnegative(),
                    profile: z.object({
                      preferences: z.array(z.string()),
                      style: z.array(z.string()),
                      facts: z.array(z.string()),
                      updatedAt: z.number(),
                    }),
                    folders: z.array(
                      z.object({
                        folderID: z.string(),
                        summary: z.string(),
                        highlights: z.array(z.string()),
                        updatedAt: z.number(),
                      }),
                    ),
                    recentAtomic: z.array(
                      z.object({
                        id: z.string(),
                        text: z.string(),
                        tags: z.array(z.string()),
                        scope: z.enum(["user", "folder"]),
                        role: z.enum(["user", "assistant"]),
                        folderID: z.string().optional(),
                        sessionID: z.string(),
                        messageID: z.string(),
                        createdAt: z.number(),
                        updatedAt: z.number(),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().int().min(1).max(100).optional(),
          folderID: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await VcpMemoryRuntime.overview(query))
      },
    )
    .post(
      "/vcp/memory/search",
      describeRoute({
        summary: "Search VCP atomic memory",
        description: "Search atomic memory items by lexical and recency mixed ranking.",
        operationId: "experimental.vcp.memory.search",
        responses: {
          200: {
            description: "Memory search results",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      score: z.number(),
                      item: z.object({
                        id: z.string(),
                        text: z.string(),
                        tags: z.array(z.string()),
                        scope: z.enum(["user", "folder"]),
                        role: z.enum(["user", "assistant"]),
                        folderID: z.string().optional(),
                        sessionID: z.string(),
                        messageID: z.string(),
                        createdAt: z.number(),
                        updatedAt: z.number(),
                      }),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          query: z.string().min(1),
          topK: z.number().int().min(1).max(50).optional(),
          scope: z.enum(["user", "folder", "both"]).optional(),
          folderID: z.string().optional(),
          tagsAny: z.array(z.string()).optional(),
          timeFrom: z.union([z.string(), z.number()]).optional(),
          timeTo: z.union([z.string(), z.number()]).optional(),
        }),
      ),
      async (c) => {
        return c.json(await VcpMemoryRuntime.searchAtomicMemory(c.req.valid("json")))
      },
    )
    .patch(
      "/vcp/memory/atomic/:id",
      describeRoute({
        summary: "Update VCP atomic memory",
        description: "Update one atomic memory item by id.",
        operationId: "experimental.vcp.memory.atomic.update",
        responses: {
          200: {
            description: "Updated memory item or null when not found",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    item: z
                      .object({
                        id: z.string(),
                        text: z.string(),
                        tags: z.array(z.string()),
                        scope: z.enum(["user", "folder"]),
                        role: z.enum(["user", "assistant"]),
                        folderID: z.string().optional(),
                        sessionID: z.string(),
                        messageID: z.string(),
                        createdAt: z.number(),
                        updatedAt: z.number(),
                      })
                      .optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator(
        "json",
        z.object({
          text: z.string().optional(),
          tags: z.array(z.string()).optional(),
          scope: z.enum(["user", "folder"]).optional(),
          folderID: z.string().optional(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const item = await VcpMemoryRuntime.updateAtomicMemory({ id, ...c.req.valid("json") })
        return c.json({ ok: !!item, item })
      },
    )
    .delete(
      "/vcp/memory/atomic/:id",
      describeRoute({
        summary: "Delete VCP atomic memory",
        description: "Delete one atomic memory item by id.",
        operationId: "experimental.vcp.memory.atomic.delete",
        responses: {
          200: {
            description: "Delete result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        return c.json({ ok: await VcpMemoryRuntime.deleteAtomicMemory(id) })
      },
    )
    .post(
      "/vcp/memory/preview",
      describeRoute({
        summary: "Preview VCP context memory box",
        description: "Build a preview of memory context block using current query and directory.",
        operationId: "experimental.vcp.memory.preview",
        responses: {
          200: {
            description: "Preview result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    preview: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          query: z.string().min(1),
          directory: z.string(),
          topKAtomic: z.number().int().min(1).max(50).optional(),
          maxChars: z.number().int().min(256).max(32768).optional(),
          removeAtomicIDs: z.array(z.string()).optional(),
          pinAtomicIDs: z.array(z.string()).optional(),
          compress: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const preview = await VcpMemoryRuntime.previewContextBox(c.req.valid("json"))
        return c.json({ preview })
      },
    )
    .get(
      "/tool/ids",
      describeRoute({
        summary: "List tool IDs",
        description:
          "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
        operationId: "tool.ids",
        responses: {
          200: {
            description: "Tool IDs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return c.json(await ToolRegistry.ids())
      },
    )
    .get(
      "/tool",
      describeRoute({
        summary: "List tools",
        description:
          "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
        operationId: "tool.list",
        responses: {
          200: {
            description: "Tools",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          description: z.string(),
                          parameters: z.any(),
                        })
                        .meta({ ref: "ToolListItem" }),
                    )
                    .meta({ ref: "ToolList" }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        const tools = await ToolRegistry.tools({ providerID: provider, modelID: model })
        return c.json(
          tools.map((t) => ({
            id: t.id,
            description: t.description,
            // Handle both Zod schemas and plain JSON schemas
            parameters: (t.parameters as any)?._def ? zodToJsonSchema(t.parameters as any) : t.parameters,
          })),
        )
      },
    )
    .post(
      "/worktree",
      describeRoute({
        summary: "Create worktree",
        description: "Create a new git worktree for the current project and run any configured startup scripts.",
        operationId: "worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: {
              "application/json": {
                schema: resolver(Worktree.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.create.schema),
      async (c) => {
        const body = c.req.valid("json")
        const worktree = await Worktree.create(body)
        return c.json(worktree)
      },
    )
    .get(
      "/worktree",
      describeRoute({
        summary: "List worktrees",
        description: "List all sandbox worktrees for the current project.",
        operationId: "worktree.list",
        responses: {
          200: {
            description: "List of worktree directories",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        const sandboxes = await Project.sandboxes(Instance.project.id)
        return c.json(sandboxes)
      },
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove worktree",
        description: "Remove a git worktree and delete its branch.",
        operationId: "worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.remove.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.remove(body)
        await Project.removeSandbox(Instance.project.id, body.directory)
        return c.json(true)
      },
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset worktree",
        description: "Reset a worktree branch to the primary default branch.",
        operationId: "worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.reset.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.reset(body)
        return c.json(true)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP resources",
        description: "Get all available MCP resources from connected servers. Optionally filter by name.",
        operationId: "experimental.resource.list",
        responses: {
          200: {
            description: "MCP resources",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Resource)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.resources())
      },
    ),
)

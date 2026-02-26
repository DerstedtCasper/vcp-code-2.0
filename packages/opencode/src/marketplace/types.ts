import z from "zod"

/**
 * Marketplace type definitions aligned with Kilo Marketplace YAML format.
 *
 * Three resource types:
 * - Skills: Modular workflows and domain expertise
 * - Modes: Custom agent personalities and behaviors
 * - MCPs: Standardized MCP server integrations
 */

// ─── Skills ──────────────────────────────────────────────────────────

export const SkillItem = z.object({
  id: z.string(),
  description: z.string(),
  category: z.string().optional(),
  githubUrl: z.string().optional(),
  rawUrl: z.string().optional(),
  content: z.string(),  // tar.gz download URL
})
export type SkillItem = z.infer<typeof SkillItem>

// ─── Modes ───────────────────────────────────────────────────────────

export const ModeItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  content: z.string(), // YAML blob (slug, roleDefinition, groups, customInstructions)
})
export type ModeItem = z.infer<typeof ModeItem>

// ─── MCPs ────────────────────────────────────────────────────────────

export const MCPParameter = z.object({
  name: z.string(),
  key: z.string(),
  placeholder: z.string(),
  optional: z.boolean().optional(),
})
export type MCPParameter = z.infer<typeof MCPParameter>

export const MCPContent = z.object({
  name: z.string(),            // Installation method name (NPX, Docker, UVX, etc.)
  prerequisites: z.array(z.string()).optional(),
  content: z.string(),         // JSON command block with {{PLACEHOLDER}} params
  parameters: z.array(MCPParameter).optional(),
})
export type MCPContent = z.infer<typeof MCPContent>

export const MCPItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  author: z.string().optional(),
  url: z.string().optional(),
  tags: z.array(z.string()).optional(),
  prerequisites: z.array(z.string()).optional(),
  content: z.union([
    z.array(MCPContent),  // Multiple installation methods
    MCPContent,           // Single installation method
    z.string(),           // Inline JSON command block
  ]),
  parameters: z.array(MCPParameter).optional(),
})
export type MCPItem = z.infer<typeof MCPItem>

// ─── Marketplace Source ──────────────────────────────────────────────

export const MarketplaceSource = z.object({
  name: z.string(),
  baseUrl: z.string(),
  type: z.enum(["kilo", "custom"]).default("kilo"),
})
export type MarketplaceSource = z.infer<typeof MarketplaceSource>

// ─── Install Request/Response ────────────────────────────────────────

export const InstallRequest = z.object({
  type: z.enum(["skill", "mode", "mcp"]),
  id: z.string(),
  // For MCPs: which installation method to use
  selectedContentIndex: z.number().optional(),
  // For MCPs: filled-in parameter values
  params: z.record(z.string(), z.string()).optional(),
})
export type InstallRequest = z.infer<typeof InstallRequest>

export const InstallResult = z.object({
  success: z.boolean(),
  message: z.string(),
  installedPath: z.string().optional(),
})
export type InstallResult = z.infer<typeof InstallResult>

// ─── Marketplace Catalog (full list) ─────────────────────────────────

export const MarketplaceCatalog = z.object({
  skills: z.array(SkillItem),
  modes: z.array(ModeItem),
  mcps: z.array(MCPItem),
  lastFetched: z.number(),
  source: z.string(),
})
export type MarketplaceCatalog = z.infer<typeof MarketplaceCatalog>

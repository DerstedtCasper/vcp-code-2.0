import { Config } from "../config/config"
import { Log } from "../util/log"
import { MarketplaceClient } from "./client"
import { MarketplaceInstaller } from "./installer"
import type {
  MarketplaceCatalog,
  SkillItem,
  ModeItem,
  MCPItem,
  InstallRequest,
  InstallResult,
} from "./types"

export type { MarketplaceCatalog, SkillItem, ModeItem, MCPItem, InstallRequest, InstallResult }

/**
 * Marketplace namespace – public API for marketplace operations.
 *
 * Lifecycle:
 *   1. Marketplace.refresh() – fetches all configured upstream sources
 *   2. Marketplace.list(type?, query?) – returns items from cache
 *   3. Marketplace.install(request) – installs a skill/mode/MCP into local config
 */
export namespace Marketplace {
  const log = Log.create({ service: "marketplace" })

  let catalogs: MarketplaceCatalog[] = []
  let initialized = false

  // ── Init / Refresh ───────────────────────────────────────────────

  // Default marketplace source – used when config.vcp or config.vcp.marketplace is absent
  const DEFAULT_SOURCES = [
    {
      name: "Kilo Marketplace",
      baseUrl: "https://raw.githubusercontent.com/Kilo-Org/kilo-marketplace/main",
      type: "kilo" as const,
    },
  ]

  export async function refresh(): Promise<MarketplaceCatalog[]> {
    const config = await Config.get()
    const mpConfig = config.vcp?.marketplace

    // Explicitly disabled check – only skip if user set enabled = false
    if (mpConfig?.enabled === false) {
      log.info("marketplace explicitly disabled")
      catalogs = []
      return catalogs
    }

    const sources = mpConfig?.sources?.length ? mpConfig.sources : DEFAULT_SOURCES
    const cacheTTL = mpConfig?.cacheTTL ?? 3600

    catalogs = await Promise.all(
      sources.map((source) =>
        MarketplaceClient.getCatalog(source, cacheTTL).catch((err) => {
          log.error("failed to load marketplace source", { source: source.name, err })
          return {
            skills: [],
            modes: [],
            mcps: [],
            lastFetched: Date.now(),
            source: source.name,
          } as MarketplaceCatalog
        }),
      ),
    )

    initialized = true
    return catalogs
  }

  /**
   * Get all catalogs. If not yet loaded, triggers a refresh.
   */
  export async function getCatalogs(): Promise<MarketplaceCatalog[]> {
    if (!initialized) {
      await refresh()
    }
    return catalogs
  }

  // ── List & Search ────────────────────────────────────────────────

  export async function listSkills(query?: string): Promise<SkillItem[]> {
    const cats = await getCatalogs()
    const all = cats.flatMap((c) => c.skills)
    if (!query) return all
    const q = query.toLowerCase()
    return all.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q),
    )
  }

  export async function listModes(query?: string): Promise<ModeItem[]> {
    const cats = await getCatalogs()
    const all = cats.flatMap((c) => c.modes)
    if (!query) return all
    const q = query.toLowerCase()
    return all.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q),
    )
  }

  export async function listMCPs(query?: string): Promise<MCPItem[]> {
    const cats = await getCatalogs()
    const all = cats.flatMap((c) => c.mcps)
    if (!query) return all
    const q = query.toLowerCase()
    return all.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.tags?.some((t) => t.toLowerCase().includes(q)),
    )
  }

  export async function search(
    query: string,
    type?: "skill" | "mode" | "mcp",
  ) {
    const cats = await getCatalogs()
    return MarketplaceClient.search(cats, query, type)
  }

  // ── Find by ID ───────────────────────────────────────────────────

  export async function findSkill(id: string): Promise<SkillItem | undefined> {
    const cats = await getCatalogs()
    for (const cat of cats) {
      const found = cat.skills.find((s) => s.id === id)
      if (found) return found
    }
  }

  export async function findMode(id: string): Promise<ModeItem | undefined> {
    const cats = await getCatalogs()
    for (const cat of cats) {
      const found = cat.modes.find((m) => m.id === id)
      if (found) return found
    }
  }

  export async function findMCP(id: string): Promise<MCPItem | undefined> {
    const cats = await getCatalogs()
    for (const cat of cats) {
      const found = cat.mcps.find((m) => m.id === id)
      if (found) return found
    }
  }

  // ── Install ──────────────────────────────────────────────────────

  export async function install(request: InstallRequest): Promise<InstallResult> {
    let item: SkillItem | ModeItem | MCPItem | undefined

    switch (request.type) {
      case "skill":
        item = await findSkill(request.id)
        break
      case "mode":
        item = await findMode(request.id)
        break
      case "mcp":
        item = await findMCP(request.id)
        break
    }

    if (!item) {
      return { success: false, message: `Item not found: ${request.type}/${request.id}` }
    }

    return MarketplaceInstaller.install(request, item)
  }

  // ── Uninstall ────────────────────────────────────────────────────

  export async function uninstallMCP(serverName: string): Promise<InstallResult> {
    return MarketplaceInstaller.uninstallMCP(serverName)
  }

  // ── Status ───────────────────────────────────────────────────────

  export async function getInstalledList() {
    return MarketplaceInstaller.listInstalled()
  }

  export function isInitialized(): boolean {
    return initialized
  }

  /**
   * Invalidate cached marketplace data, forcing a refetch on next access.
   */
  export function invalidateCache(baseUrl?: string) {
    MarketplaceClient.invalidate(baseUrl)
    initialized = false
  }
}

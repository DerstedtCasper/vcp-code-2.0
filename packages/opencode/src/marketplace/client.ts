import path from "path"
import { mkdir } from "fs/promises"
import { parse as parseYAML } from "yaml"
import { Log } from "../util/log"
import { Global } from "../global"
import type { SkillItem, ModeItem, MCPItem, MarketplaceCatalog } from "./types"

/**
 * Marketplace client – fetches YAML manifests from upstream sources
 * (Kilo Marketplace format) and provides in-memory cache.
 *
 * YAML files:
 *   - {baseUrl}/skills/marketplace.yaml → SkillItem[]
 *   - {baseUrl}/modes/marketplace.yaml → ModeItem[]
 *   - {baseUrl}/mcps/marketplace.yaml  → MCPItem[]
 */
export namespace MarketplaceClient {
  const log = Log.create({ service: "marketplace-client" })

  // ── In-memory cache ──────────────────────────────────────────────
  interface CacheEntry {
    catalog: MarketplaceCatalog
    expiresAt: number // epoch ms
  }
  const cache = new Map<string, CacheEntry>()

  const CACHE_DIR = path.join(Global.Path.cache, "marketplace")

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Fetch or return cached catalog for a given marketplace source.
   */
  export async function getCatalog(
    source: { name: string; baseUrl: string; type: string },
    cacheTTL: number = 3600,
  ): Promise<MarketplaceCatalog> {
    const key = source.baseUrl
    const now = Date.now()

    // Return in-memory cache if not expired
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.catalog
    }

    // Try disk cache
    const diskCatalog = await readDiskCache(key, cacheTTL)
    if (diskCatalog) {
      cache.set(key, { catalog: diskCatalog, expiresAt: now + cacheTTL * 1000 })
      return diskCatalog
    }

    // Fetch fresh
    log.info("fetching marketplace catalog", { source: source.name, baseUrl: source.baseUrl })
    const [skills, modes, mcps] = await Promise.all([
      fetchYAML<SkillItem[]>(`${source.baseUrl}/skills/marketplace.yaml`, "skills"),
      fetchYAML<ModeItem[]>(`${source.baseUrl}/modes/marketplace.yaml`, "modes"),
      fetchYAML<MCPItem[]>(`${source.baseUrl}/mcps/marketplace.yaml`, "mcps"),
    ])

    const catalog: MarketplaceCatalog = {
      skills: skills ?? [],
      modes: modes ?? [],
      mcps: mcps ?? [],
      lastFetched: now,
      source: source.name,
    }

    cache.set(key, { catalog, expiresAt: now + cacheTTL * 1000 })
    await writeDiskCache(key, catalog)

    log.info("marketplace catalog loaded", {
      source: source.name,
      skills: catalog.skills.length,
      modes: catalog.modes.length,
      mcps: catalog.mcps.length,
    })

    return catalog
  }

  /**
   * Invalidate cache for a given source URL (or all if no key provided).
   */
  export function invalidate(baseUrl?: string) {
    if (baseUrl) {
      cache.delete(baseUrl)
    } else {
      cache.clear()
    }
  }

  /**
   * Search across all loaded catalogs.
   */
  export function search(
    catalogs: MarketplaceCatalog[],
    query: string,
    type?: "skill" | "mode" | "mcp",
  ): Array<{ type: "skill" | "mode" | "mcp"; item: SkillItem | ModeItem | MCPItem; source: string }> {
    const q = query.toLowerCase()
    const results: Array<{ type: "skill" | "mode" | "mcp"; item: SkillItem | ModeItem | MCPItem; source: string }> = []

    for (const catalog of catalogs) {
      if (!type || type === "skill") {
        for (const item of catalog.skills) {
          if (matchItem(item, q)) {
            results.push({ type: "skill", item, source: catalog.source })
          }
        }
      }
      if (!type || type === "mode") {
        for (const item of catalog.modes) {
          if (matchItem(item, q)) {
            results.push({ type: "mode", item, source: catalog.source })
          }
        }
      }
      if (!type || type === "mcp") {
        for (const item of catalog.mcps) {
          if (matchItem(item, q)) {
            results.push({ type: "mcp", item, source: catalog.source })
          }
        }
      }
    }

    return results
  }

  // ── Internal helpers ─────────────────────────────────────────────

  async function fetchYAML<T>(url: string, label: string): Promise<T | undefined> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        log.warn("failed to fetch marketplace YAML", { url, status: response.status })
        return undefined
      }
      const text = await response.text()
      const parsed = parseYAML(text)
      // Kilo Marketplace YAML format wraps data in { items: [...] }
      if (parsed && typeof parsed === "object" && "items" in parsed && Array.isArray((parsed as any).items)) {
        return (parsed as any).items as T
      }
      return parsed as T
    } catch (err) {
      log.error("failed to parse marketplace YAML", { url, label, err })
      return undefined
    }
  }

  function matchItem(item: { id: string; description?: string; name?: string; tags?: string[] }, query: string): boolean {
    const fields = [item.id, item.name, item.description, ...(item.tags ?? [])]
    return fields.some((f) => f && f.toLowerCase().includes(query))
  }

  // ── Disk cache (JSON) ────────────────────────────────────────────

  function cacheFilePath(baseUrl: string): string {
    const safe = baseUrl.replace(/[^a-zA-Z0-9]/g, "_")
    return path.join(CACHE_DIR, `${safe}.json`)
  }

  async function readDiskCache(baseUrl: string, cacheTTL: number): Promise<MarketplaceCatalog | undefined> {
    try {
      const file = Bun.file(cacheFilePath(baseUrl))
      if (!(await file.exists())) return undefined
      const data = await file.json()
      if (typeof data.lastFetched !== "number") return undefined
      // Check TTL
      if (Date.now() - data.lastFetched > cacheTTL * 1000) return undefined
      return data as MarketplaceCatalog
    } catch {
      return undefined
    }
  }

  async function writeDiskCache(baseUrl: string, catalog: MarketplaceCatalog): Promise<void> {
    try {
      await mkdir(CACHE_DIR, { recursive: true })
      await Bun.write(cacheFilePath(baseUrl), JSON.stringify(catalog, null, 2))
    } catch (err) {
      log.warn("failed to write marketplace disk cache", { err })
    }
  }
}

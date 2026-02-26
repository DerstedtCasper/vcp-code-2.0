/**
 * code-index/vector-store.ts — VectorStore abstraction (Qdrant REST / hnswlib-node).
 *
 * novacode_change - T-1.2
 */

import { Log } from "../util/log"

const log = Log.create({ service: "code-index.vector-store" })

// ─── Types ─────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  score: number
  metadata: Record<string, any>
}

export interface VectorStoreConfig {
  type: "qdrant" | "hnswlib"
  /** Qdrant server URL */
  qdrantUrl?: string
  /** Qdrant API key */
  qdrantApiKey?: string
  /** Collection / index name */
  collectionName?: string
  /** Local path for hnswlib storage */
  localPath?: string
  /** Vector dimensions */
  dimensions: number
}

export interface VectorStore {
  /** Insert or update a vector with its metadata. */
  upsert(id: string, vector: number[], metadata: Record<string, any>): Promise<void>
  /** Batch upsert for performance. */
  batchUpsert(
    items: Array<{ id: string; vector: number[]; metadata: Record<string, any> }>,
  ): Promise<void>
  /** Search for similar vectors. */
  search(query: number[], limit: number, threshold: number): Promise<SearchResult[]>
  /** Delete vectors by IDs. */
  delete(ids: string[]): Promise<void>
  /** Total vectors in the store. */
  count(): Promise<number>
  /** Initialize / ensure collection exists. */
  init(): Promise<void>
  /** Destroy / drop collection. */
  clear(): Promise<void>
}

// ─── Qdrant REST Implementation ────────────────────────────────────

class QdrantStore implements VectorStore {
  private baseUrl: string
  private apiKey?: string
  private collection: string
  private dimensions: number

  constructor(config: VectorStoreConfig) {
    this.baseUrl = (config.qdrantUrl ?? "http://localhost:6333").replace(/\/+$/, "")
    this.apiKey = config.qdrantApiKey
    this.collection = config.collectionName ?? "vcp-code-index"
    this.dimensions = config.dimensions
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" }
    if (this.apiKey) h["api-key"] = this.apiKey
    return h
  }

  async init(): Promise<void> {
    // Check if collection exists, if not create it
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: "GET",
      headers: this.headers(),
    })
    if (res.status === 404) {
      const createRes = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({
          vectors: { size: this.dimensions, distance: "Cosine" },
        }),
      })
      if (!createRes.ok) {
        const text = await createRes.text()
        throw new Error(`Qdrant collection creation failed (${createRes.status}): ${text}`)
      }
      log.info("created Qdrant collection", { collection: this.collection })
    } else if (!res.ok) {
      const text = await res.text()
      throw new Error(`Qdrant collection check failed (${res.status}): ${text}`)
    }
  }

  async upsert(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    await this.batchUpsert([{ id, vector, metadata }])
  }

  async batchUpsert(
    items: Array<{ id: string; vector: number[]; metadata: Record<string, any> }>,
  ): Promise<void> {
    if (items.length === 0) return
    // Qdrant uses integer IDs internally — we store our string ID in payload
    const points = items.map((item, idx) => ({
      id: hashStringToInt(item.id),
      vector: item.vector,
      payload: { ...item.metadata, _id: item.id },
    }))

    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ points }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Qdrant upsert failed (${res.status}): ${text}`)
    }
  }

  async search(query: number[], limit: number, threshold: number): Promise<SearchResult[]> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        vector: query,
        limit,
        score_threshold: threshold,
        with_payload: true,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Qdrant search failed (${res.status}): ${text}`)
    }
    const json = (await res.json()) as {
      result: Array<{ id: number; score: number; payload: Record<string, any> }>
    }
    return json.result.map((r) => ({
      id: (r.payload._id as string) ?? String(r.id),
      score: r.score,
      metadata: r.payload,
    }))
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const numericIds = ids.map(hashStringToInt)
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/delete`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ points: numericIds }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Qdrant delete failed (${res.status}): ${text}`)
    }
  }

  async count(): Promise<number> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: "GET",
      headers: this.headers(),
    })
    if (!res.ok) return 0
    const json = (await res.json()) as { result: { points_count: number } }
    return json.result?.points_count ?? 0
  }

  async clear(): Promise<void> {
    await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: "DELETE",
      headers: this.headers(),
    })
    log.info("cleared Qdrant collection", { collection: this.collection })
  }
}

// ─── In-Memory Vector Store (Simple hnswlib-like) ──────────────────
// Pure TypeScript implementation — no native deps.
// Uses brute-force cosine search, suitable for small-to-medium codebases (< 50k chunks).

class InMemoryVectorStore implements VectorStore {
  private vectors: Map<string, { vector: number[]; metadata: Record<string, any> }> = new Map()
  private _localPath?: string
  private _dimensions: number

  constructor(config: VectorStoreConfig) {
    this._localPath = config.localPath
    this._dimensions = config.dimensions
  }

  async init(): Promise<void> {
    // Try to load from disk if localPath is set
    if (this._localPath) {
      try {
        const fs = await import("node:fs")
        const path = await import("node:path")
        const filePath = path.join(this._localPath, "index.json")
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, "utf-8")
          const data = JSON.parse(raw) as Array<[string, { vector: number[]; metadata: Record<string, any> }]>
          this.vectors = new Map(data)
          log.info("loaded vector index from disk", { count: this.vectors.size })
        }
      } catch (err) {
        log.warn("failed to load vector index from disk", { err })
      }
    }
  }

  async upsert(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    this.vectors.set(id, { vector, metadata })
  }

  async batchUpsert(
    items: Array<{ id: string; vector: number[]; metadata: Record<string, any> }>,
  ): Promise<void> {
    for (const item of items) {
      this.vectors.set(item.id, { vector: item.vector, metadata: item.metadata })
    }
    await this.persist()
  }

  async search(query: number[], limit: number, threshold: number): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    for (const [id, entry] of this.vectors) {
      const score = cosineSimilarity(query, entry.vector)
      if (score >= threshold) {
        results.push({ id, score, metadata: entry.metadata })
      }
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.vectors.delete(id)
    }
    await this.persist()
  }

  async count(): Promise<number> {
    return this.vectors.size
  }

  async clear(): Promise<void> {
    this.vectors.clear()
    if (this._localPath) {
      try {
        const fs = await import("node:fs")
        const path = await import("node:path")
        const filePath = path.join(this._localPath, "index.json")
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      } catch (_) {}
    }
    log.info("cleared in-memory vector store")
  }

  private async persist(): Promise<void> {
    if (!this._localPath) return
    try {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const dir = this._localPath
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const filePath = path.join(dir, "index.json")
      const data = Array.from(this.vectors.entries())
      fs.writeFileSync(filePath, JSON.stringify(data))
    } catch (err) {
      log.warn("failed to persist vector index", { err })
    }
  }
}

// ─── Utility Functions ─────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** Simple hash: string → positive 32-bit integer (for Qdrant point IDs). */
function hashStringToInt(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

// ─── Factory ───────────────────────────────────────────────────────

export function createVectorStore(config: VectorStoreConfig): VectorStore {
  switch (config.type) {
    case "qdrant":
      return new QdrantStore(config)
    case "hnswlib":
    default:
      return new InMemoryVectorStore(config)
  }
}

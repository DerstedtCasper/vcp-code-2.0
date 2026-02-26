/**
 * code-index/embedding.ts — Embedding provider abstraction + multi-backend implementations.
 *
 * Supports: OpenAI, Gemini, Ollama, Custom (any OpenAI-compatible endpoint).
 *
 * novacode_change - T-1.1
 */

import { Log } from "../util/log"

const log = Log.create({ service: "code-index.embedding" })

// ─── Types ─────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  /** Embed a batch of text chunks into vectors. */
  embed(texts: string[]): Promise<number[][]>
  /** Dimensionality of the vectors produced. */
  readonly dimensions: number
  /** Provider name for logging. */
  readonly name: string
}

export interface EmbeddingConfig {
  provider: "openai" | "gemini" | "ollama" | "custom"
  baseUrl?: string
  apiKey?: string
  model?: string
  dimensions?: number
  batchSize?: number
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
}

interface GeminiEmbeddingResponse {
  embeddings: Array<{ values: number[] }>
}

// ─── Utility ───────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

// ─── OpenAI-Compatible Embedding ───────────────────────────────────

class OpenAIEmbedding implements EmbeddingProvider {
  readonly name = "openai"
  readonly dimensions: number
  private baseUrl: string
  private apiKey: string
  private model: string
  private batchSize: number

  constructor(config: EmbeddingConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")
    this.apiKey = config.apiKey ?? ""
    this.model = config.model ?? "text-embedding-3-small"
    this.dimensions = config.dimensions ?? 1536
    this.batchSize = config.batchSize ?? 100
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const batches = chunkArray(texts, this.batchSize)
    const allEmbeddings: number[][] = []

    for (const batch of batches) {
      const url = `${this.baseUrl}/embeddings`
      const body: Record<string, any> = {
        model: this.model,
        input: batch,
      }
      // Only include dimensions for models that support it (OpenAI v3)
      if (this.model.includes("embedding-3")) {
        body.dimensions = this.dimensions
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`OpenAI embedding error (${res.status}): ${text}`)
      }

      const json = (await res.json()) as OpenAIEmbeddingResponse
      // Sort by index to preserve order
      const sorted = json.data.sort((a, b) => a.index - b.index)
      for (const item of sorted) {
        allEmbeddings.push(item.embedding)
      }

      log.info("embedded batch", { count: batch.length, model: this.model })
    }

    return allEmbeddings
  }
}

// ─── Gemini Embedding ──────────────────────────────────────────────

class GeminiEmbedding implements EmbeddingProvider {
  readonly name = "gemini"
  readonly dimensions: number
  private apiKey: string
  private model: string
  private batchSize: number
  private baseUrl: string

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey ?? ""
    this.model = config.model ?? "text-embedding-004"
    this.dimensions = config.dimensions ?? 768
    this.batchSize = config.batchSize ?? 100
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "")
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const batches = chunkArray(texts, this.batchSize)
    const allEmbeddings: number[][] = []

    for (const batch of batches) {
      const url = `${this.baseUrl}/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`
      const requests = batch.map((text) => ({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: this.dimensions,
      }))

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Gemini embedding error (${res.status}): ${text}`)
      }

      const json = (await res.json()) as GeminiEmbeddingResponse
      for (const emb of json.embeddings) {
        allEmbeddings.push(emb.values)
      }

      log.info("embedded batch (gemini)", { count: batch.length, model: this.model })
    }

    return allEmbeddings
  }
}

// ─── Ollama Embedding ──────────────────────────────────────────────

class OllamaEmbedding implements EmbeddingProvider {
  readonly name = "ollama"
  readonly dimensions: number
  private baseUrl: string
  private model: string
  private batchSize: number

  constructor(config: EmbeddingConfig) {
    this.baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "")
    this.model = config.model ?? "nomic-embed-text"
    this.dimensions = config.dimensions ?? 768
    this.batchSize = config.batchSize ?? 50
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const batches = chunkArray(texts, this.batchSize)
    const allEmbeddings: number[][] = []

    for (const batch of batches) {
      // Ollama supports batch embedding via POST /api/embed (v0.4+)
      const url = `${this.baseUrl}/api/embed`
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: batch }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Ollama embedding error (${res.status}): ${text}`)
      }

      const json = (await res.json()) as { embeddings: number[][] }
      for (const emb of json.embeddings) {
        allEmbeddings.push(emb)
      }

      log.info("embedded batch (ollama)", { count: batch.length, model: this.model })
    }

    return allEmbeddings
  }
}

// ─── Factory ───────────────────────────────────────────────────────

/**
 * Create an EmbeddingProvider from the given config.
 * "custom" is treated as OpenAI-compatible.
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case "gemini":
      return new GeminiEmbedding(config)
    case "ollama":
      return new OllamaEmbedding(config)
    case "openai":
    case "custom":
    default:
      return new OpenAIEmbedding(config)
  }
}

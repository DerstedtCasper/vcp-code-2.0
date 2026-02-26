/**
 * code-index/search.ts — Semantic search entry point.
 *
 * Provides a high-level `search()` function that:
 * 1. Embeds the query
 * 2. Searches the vector store
 * 3. Returns formatted code snippets with metadata
 *
 * novacode_change - T-1.5
 */

import * as fs from "node:fs"
import { Log } from "../util/log"
import type { EmbeddingProvider } from "./embedding"
import type { VectorStore, SearchResult } from "./vector-store"

const log = Log.create({ service: "code-index.search" })

// ─── Types ─────────────────────────────────────────────────────────

export interface SearchConfig {
  scoreThreshold?: number
  maxResults?: number
}

export interface CodeSearchResult {
  /** File path relative to workspace root. */
  filePath: string
  /** Starting line number (1-based). */
  startLine: number
  /** Ending line number (1-based). */
  endLine: number
  /** The code snippet. */
  content: string
  /** Detected language. */
  language: string
  /** Optional symbol name. */
  symbol?: string
  /** Similarity score (0-1). */
  score: number
}

// ─── Search Function ───────────────────────────────────────────────

export async function semanticSearch(
  query: string,
  embeddingProvider: EmbeddingProvider,
  vectorStore: VectorStore,
  config?: SearchConfig,
  workspaceRoot?: string,
): Promise<CodeSearchResult[]> {
  const threshold = config?.scoreThreshold ?? 0.7
  const maxResults = config?.maxResults ?? 10

  // 1. Embed the query
  const [queryVector] = await embeddingProvider.embed([query])
  if (!queryVector || queryVector.length === 0) {
    log.warn("empty query embedding returned")
    return []
  }

  // 2. Search vector store
  const rawResults: SearchResult[] = await vectorStore.search(queryVector, maxResults, threshold)

  // 3. Transform to CodeSearchResult
  const results: CodeSearchResult[] = []
  for (const r of rawResults) {
    const meta = r.metadata
    const filePath = (meta.filePath as string) ?? ""
    const startLine = (meta.startLine as number) ?? 0
    const endLine = (meta.endLine as number) ?? 0
    const language = (meta.language as string) ?? "text"
    const symbol = meta.symbol as string | undefined

    // Try to read the actual file content for freshest version
    let content = (meta.content as string) ?? ""
    if (workspaceRoot && filePath) {
      try {
        const fullPath = require("node:path").join(workspaceRoot, filePath)
        if (fs.existsSync(fullPath)) {
          const fileContent = fs.readFileSync(fullPath, "utf-8")
          const lines = fileContent.split("\n")
          content = lines.slice(Math.max(0, startLine - 1), endLine).join("\n")
        }
      } catch {
        // Use stored content
      }
    }

    results.push({
      filePath,
      startLine,
      endLine,
      content,
      language,
      symbol,
      score: r.score,
    })
  }

  log.info("semantic search complete", { query: query.slice(0, 50), resultCount: results.length })
  return results
}

/**
 * Format search results for LLM tool output.
 */
export function formatSearchResults(results: CodeSearchResult[]): string {
  if (results.length === 0) {
    return "No matching code found in the indexed codebase."
  }

  const formatted = results.map((r, i) => {
    const header = `## Result ${i + 1} — ${r.filePath}:${r.startLine}-${r.endLine} (score: ${r.score.toFixed(3)})`
    const symbolLine = r.symbol ? `Symbol: ${r.symbol}` : ""
    const langTag = r.language ? `\`\`\`${r.language}` : "```"
    return [header, symbolLine, langTag, r.content, "```", ""].filter(Boolean).join("\n")
  })

  return formatted.join("\n")
}

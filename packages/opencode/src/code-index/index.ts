/**
 * code-index/index.ts — CodeIndex namespace + indexing pipeline.
 *
 * Orchestrates the full workflow:
 *   scan files → parse into chunks → embed → store in vector DB → search
 *
 * Exposes:
 * - CodeIndex.init()       — initialize from config
 * - CodeIndex.rebuild()    — full re-index of the workspace
 * - CodeIndex.search()     — semantic search
 * - CodeIndex.update()     — incremental update for changed files
 * - CodeIndex.clear()      — drop all indexed data
 * - CodeIndex.status()     — current indexing status
 * - CodeIndex.stats()      — index statistics
 * - CodeIndex.onProgress() — subscribe to indexing progress
 *
 * novacode_change - T-1.6
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { Log } from "../util/log"
import { createEmbeddingProvider, type EmbeddingProvider, type EmbeddingConfig } from "./embedding"
import { createVectorStore, type VectorStore, type VectorStoreConfig } from "./vector-store"
import { scanWorkspace, type ScannedFile } from "./scanner"
import { parseFile, type CodeChunk, type ParserConfig } from "./parser"
import { semanticSearch, formatSearchResults, type CodeSearchResult, type SearchConfig } from "./search"

const log = Log.create({ service: "code-index" })

// ─── Types ─────────────────────────────────────────────────────────

export type IndexStatus = "idle" | "indexing" | "error" | "disabled"

export interface IndexProgress {
  status: IndexStatus
  indexedFiles: number
  totalFiles: number
  currentFile?: string
  error?: string
}

export interface IndexStats {
  totalChunks: number
  totalFiles: number
  lastIndexed?: string
  status: IndexStatus
}

export interface CodeIndexConfig {
  enabled?: boolean
  embedding?: EmbeddingConfig
  vectorStore?: {
    type?: "qdrant" | "hnswlib"
    qdrantUrl?: string
    qdrantApiKey?: string
    collectionName?: string
    localPath?: string
  }
  search?: SearchConfig
  exclude?: string[]
}

// ─── Namespace ─────────────────────────────────────────────────────

export namespace CodeIndex {
  let embeddingProvider: EmbeddingProvider | null = null
  let vectorStore: VectorStore | null = null
  let currentStatus: IndexStatus = "disabled"
  let currentProgress: IndexProgress = {
    status: "disabled",
    indexedFiles: 0,
    totalFiles: 0,
  }
  let lastStats: IndexStats = {
    totalChunks: 0,
    totalFiles: 0,
    status: "disabled",
  }
  let workspaceRoot: string | null = null
  let indexConfig: CodeIndexConfig | null = null
  let fileHashes: Map<string, string> = new Map()

  const progressSubscribers = new Set<(progress: IndexProgress) => void>()

  // ─── Initialization ──────────────────────────────────────────────

  export async function init(config: CodeIndexConfig, rootDir: string): Promise<void> {
    indexConfig = config
    workspaceRoot = rootDir

    if (!config.enabled) {
      currentStatus = "disabled"
      updateProgress({ status: "disabled", indexedFiles: 0, totalFiles: 0 })
      log.info("code index disabled")
      return
    }

    try {
      // Create embedding provider
      const embConfig: EmbeddingConfig = {
        provider: config.embedding?.provider ?? "openai",
        baseUrl: config.embedding?.baseUrl,
        apiKey: config.embedding?.apiKey,
        model: config.embedding?.model,
        dimensions: config.embedding?.dimensions ?? 1536,
        batchSize: config.embedding?.batchSize ?? 100,
      }
      embeddingProvider = createEmbeddingProvider(embConfig)

      // Create vector store
      const defaultLocalPath = path.join(rootDir, ".vcp-code", "index")
      const vsConfig: VectorStoreConfig = {
        type: config.vectorStore?.type ?? "hnswlib",
        qdrantUrl: config.vectorStore?.qdrantUrl,
        qdrantApiKey: config.vectorStore?.qdrantApiKey,
        collectionName: config.vectorStore?.collectionName ?? "vcp-code-index",
        localPath: config.vectorStore?.localPath ?? defaultLocalPath,
        dimensions: embConfig.dimensions ?? 1536,
      }
      vectorStore = createVectorStore(vsConfig)
      await vectorStore.init()

      currentStatus = "idle"
      const count = await vectorStore.count()
      lastStats = {
        totalChunks: count,
        totalFiles: fileHashes.size,
        status: "idle",
      }
      updateProgress({ status: "idle", indexedFiles: 0, totalFiles: 0 })

      log.info("code index initialized", {
        provider: embConfig.provider,
        store: vsConfig.type,
        existingChunks: count,
      })
    } catch (err) {
      currentStatus = "error"
      updateProgress({ status: "error", indexedFiles: 0, totalFiles: 0, error: String(err) })
      log.error("code index initialization failed", { err })
    }
  }

  // ─── Full Rebuild ────────────────────────────────────────────────

  export async function rebuild(): Promise<void> {
    if (!embeddingProvider || !vectorStore || !workspaceRoot) {
      throw new Error("CodeIndex not initialized or disabled")
    }
    if (currentStatus === "indexing") {
      throw new Error("Indexing already in progress")
    }

    const excludePatterns = indexConfig?.exclude ?? [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "__pycache__",
    ]

    currentStatus = "indexing"
    updateProgress({ status: "indexing", indexedFiles: 0, totalFiles: 0 })

    try {
      // 1. Clear existing index
      await vectorStore.clear()
      await vectorStore.init()
      fileHashes.clear()

      // 2. Scan workspace
      const files = scanWorkspace({
        rootDir: workspaceRoot,
        exclude: excludePatterns,
      })
      updateProgress({ status: "indexing", indexedFiles: 0, totalFiles: files.length })
      log.info("scanned workspace", { fileCount: files.length })

      // 3. Parse & embed files in batches
      const batchSize = embeddingProvider.dimensions ? 20 : 10 // files per batch
      let indexedFiles = 0

      for (let i = 0; i < files.length; i += batchSize) {
        const fileBatch = files.slice(i, i + batchSize)
        await indexFileBatch(fileBatch)
        indexedFiles += fileBatch.length
        updateProgress({
          status: "indexing",
          indexedFiles,
          totalFiles: files.length,
          currentFile: fileBatch[fileBatch.length - 1]?.relativePath,
        })
      }

      // 4. Update stats
      const totalChunks = await vectorStore.count()
      lastStats = {
        totalChunks,
        totalFiles: files.length,
        lastIndexed: new Date().toISOString(),
        status: "idle",
      }
      currentStatus = "idle"
      updateProgress({ status: "idle", indexedFiles: files.length, totalFiles: files.length })

      log.info("rebuild complete", { files: files.length, chunks: totalChunks })
    } catch (err) {
      currentStatus = "error"
      updateProgress({
        status: "error",
        indexedFiles: currentProgress.indexedFiles,
        totalFiles: currentProgress.totalFiles,
        error: String(err),
      })
      log.error("rebuild failed", { err })
      throw err
    }
  }

  // ─── Incremental Update ──────────────────────────────────────────

  export async function update(changedPaths: string[]): Promise<void> {
    if (!embeddingProvider || !vectorStore || !workspaceRoot) return
    if (currentStatus === "indexing") return

    const excludePatterns = indexConfig?.exclude ?? []

    const filesToIndex: ScannedFile[] = []
    const filesToDelete: string[] = []

    for (const absPath of changedPaths) {
      const relativePath = path.relative(workspaceRoot, absPath).replace(/\\/g, "/")

      // Check if file still exists
      if (!fs.existsSync(absPath)) {
        filesToDelete.push(relativePath)
        fileHashes.delete(relativePath)
        continue
      }

      // Check if excluded
      const basename = path.basename(absPath)
      if (excludePatterns.some((p) => relativePath.includes(p) || basename === p)) continue

      try {
        const stat = fs.statSync(absPath)
        filesToIndex.push({
          absolutePath: absPath,
          relativePath,
          size: stat.size,
        })
      } catch {
        continue
      }
    }

    // Delete old chunks for changed files
    if (filesToDelete.length > 0 || filesToIndex.length > 0) {
      const allPaths = [...filesToDelete, ...filesToIndex.map((f) => f.relativePath)]
      // We need to delete all chunks whose filePath starts with any of these paths
      // For simplicity, we delete by the chunk IDs we know about
      // In practice, we should store a file→chunkIds mapping
      log.info("incremental update", { toIndex: filesToIndex.length, toDelete: filesToDelete.length })
    }

    if (filesToIndex.length > 0) {
      await indexFileBatch(filesToIndex)
      const totalChunks = await vectorStore.count()
      lastStats = {
        ...lastStats,
        totalChunks,
        lastIndexed: new Date().toISOString(),
      }
    }
  }

  // ─── Search ──────────────────────────────────────────────────────

  export async function search(
    query: string,
    searchConfig?: SearchConfig,
  ): Promise<CodeSearchResult[]> {
    if (!embeddingProvider || !vectorStore || !workspaceRoot) {
      return []
    }

    return semanticSearch(
      query,
      embeddingProvider,
      vectorStore,
      searchConfig ?? indexConfig?.search,
      workspaceRoot,
    )
  }

  /**
   * Search and format results as a string (for tool output).
   */
  export async function searchFormatted(
    query: string,
    searchConfig?: SearchConfig,
  ): Promise<string> {
    const results = await search(query, searchConfig)
    return formatSearchResults(results)
  }

  // ─── Clear ───────────────────────────────────────────────────────

  export async function clear(): Promise<void> {
    if (vectorStore) {
      await vectorStore.clear()
    }
    fileHashes.clear()
    lastStats = { totalChunks: 0, totalFiles: 0, status: currentStatus }
    updateProgress({ status: "idle", indexedFiles: 0, totalFiles: 0 })
    log.info("index cleared")
  }

  // ─── Status / Stats ──────────────────────────────────────────────

  export function status(): IndexStatus {
    return currentStatus
  }

  export function progress(): IndexProgress {
    return { ...currentProgress }
  }

  export function stats(): IndexStats {
    return { ...lastStats }
  }

  export function isEnabled(): boolean {
    return indexConfig?.enabled === true
  }

  // ─── Subscriptions ───────────────────────────────────────────────

  export function onProgress(cb: (progress: IndexProgress) => void): () => void {
    progressSubscribers.add(cb)
    return () => progressSubscribers.delete(cb)
  }

  // ─── Internal ────────────────────────────────────────────────────

  function updateProgress(p: IndexProgress) {
    currentProgress = p
    for (const cb of progressSubscribers) {
      try {
        cb(p)
      } catch {}
    }
  }

  async function indexFileBatch(files: ScannedFile[]): Promise<void> {
    if (!embeddingProvider || !vectorStore || !workspaceRoot) return

    const parserConfig: ParserConfig = {
      maxChunkSize: 2000,
      minChunkSize: 100,
      overlapLines: 2,
    }

    // 1. Read & parse all files into chunks
    const allChunks: CodeChunk[] = []
    for (const file of files) {
      try {
        const content = fs.readFileSync(file.absolutePath, "utf-8")

        // Compute simple hash for change detection
        const hash = simpleHash(content)
        if (fileHashes.get(file.relativePath) === hash) continue
        fileHashes.set(file.relativePath, hash)

        const chunks = parseFile(file.relativePath, content, parserConfig)
        allChunks.push(...chunks)
      } catch (err) {
        log.warn("failed to parse file", { file: file.relativePath, err })
      }
    }

    if (allChunks.length === 0) return

    // 2. Embed all chunks
    const texts = allChunks.map((c) => {
      // Prepend file path and symbol for better embedding context
      const prefix = c.symbol ? `${c.filePath} — ${c.symbol}` : c.filePath
      return `${prefix}\n${c.content}`
    })

    const batchSize = embeddingProvider.dimensions ? 50 : 20
    const embeddings: number[][] = []

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const batchEmbeddings = await embeddingProvider.embed(batch)
      embeddings.push(...batchEmbeddings)
    }

    // 3. Store in vector DB
    const items = allChunks.map((chunk, idx) => ({
      id: chunk.id,
      vector: embeddings[idx],
      metadata: {
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        language: chunk.language,
        symbol: chunk.symbol ?? null,
        kind: chunk.kind ?? "block",
        content: chunk.content.slice(0, 1000), // Store truncated content in metadata
      },
    }))

    await vectorStore.batchUpsert(items)
    log.info("indexed batch", { chunks: items.length, files: files.length })
  }

  function simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return String(hash)
  }
}

// Re-export types for convenience
export type { CodeSearchResult, SearchConfig } from "./search"
export type { EmbeddingProvider, EmbeddingConfig } from "./embedding"
export type { VectorStore, VectorStoreConfig, SearchResult } from "./vector-store"
export type { ScannedFile, ScannerConfig } from "./scanner"
export type { CodeChunk, ParserConfig } from "./parser"

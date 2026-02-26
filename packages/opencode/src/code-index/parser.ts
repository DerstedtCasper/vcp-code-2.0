/**
 * code-index/parser.ts — Code chunking via simple AST-aware splitting.
 *
 * Splits source files into semantically meaningful chunks (functions, classes,
 * methods, blocks) using a lightweight regex/heuristic approach.
 * Falls back to line-based splitting for unsupported languages.
 *
 * Note: For full Tree-sitter support, `web-tree-sitter` can be integrated later.
 * This initial implementation uses heuristic splitting that works for most languages.
 *
 * novacode_change - T-1.4
 */

import * as path from "node:path"
import { Log } from "../util/log"

const log = Log.create({ service: "code-index.parser" })

// ─── Types ─────────────────────────────────────────────────────────

export interface CodeChunk {
  /** Unique ID: `filePath:startLine-endLine` */
  id: string
  /** File path relative to workspace root. */
  filePath: string
  /** Starting line number (1-based). */
  startLine: number
  /** Ending line number (1-based). */
  endLine: number
  /** The actual code text. */
  content: string
  /** Detected language. */
  language: string
  /** Optional symbol name (function, class, etc). */
  symbol?: string
  /** Symbol kind. */
  kind?: "function" | "class" | "method" | "module" | "block"
}

export interface ParserConfig {
  /** Maximum chunk size in characters. Default: 2000 */
  maxChunkSize?: number
  /** Minimum chunk size in characters. Default: 100 */
  minChunkSize?: number
  /** Overlap between consecutive chunks (in lines). Default: 2 */
  overlapLines?: number
}

// ─── Language Detection ────────────────────────────────────────────

const EXTENSION_LANG_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".lua": "lua",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ps1": "powershell",
  ".sql": "sql",
  ".proto": "protobuf",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".json": "json",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".svelte": "svelte",
  ".vue": "vue",
  ".astro": "astro",
  ".md": "markdown",
  ".mdx": "markdown",
  ".lean": "lean",
  ".zig": "zig",
  ".dart": "dart",
  ".r": "r",
  ".R": "r",
  ".ex": "elixir",
  ".exs": "elixir",
  ".hs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".clj": "clojure",
  ".el": "emacs-lisp",
  ".nim": "nim",
  ".erl": "erlang",
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath)
  return EXTENSION_LANG_MAP[ext] ?? "text"
}

// ─── Heuristic Function/Class Boundary Detection ───────────────────

/**
 * Regex patterns for detecting top-level declarations per language family.
 * These are intentionally broad — we just need good boundaries, not a full parser.
 */
const BOUNDARY_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /^(?:export\s+)?(?:async\s+)?function\s+\w/m,
    /^(?:export\s+)?(?:abstract\s+)?class\s+\w/m,
    /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/m,
    /^(?:export\s+)?(?:interface|type|enum|namespace)\s+\w/m,
  ],
  javascript: [
    /^(?:export\s+)?(?:async\s+)?function\s+\w/m,
    /^(?:export\s+)?class\s+\w/m,
    /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/m,
    /^module\.exports\s*=/m,
  ],
  python: [
    /^(?:async\s+)?def\s+\w/m,
    /^class\s+\w/m,
    /^@\w+/m, // decorators often start a new logical block
  ],
  rust: [
    /^(?:pub\s+)?(?:async\s+)?fn\s+\w/m,
    /^(?:pub\s+)?struct\s+\w/m,
    /^(?:pub\s+)?enum\s+\w/m,
    /^(?:pub\s+)?trait\s+\w/m,
    /^(?:pub\s+)?impl\s+/m,
    /^(?:pub\s+)?mod\s+\w/m,
  ],
  go: [
    /^func\s+/m,
    /^type\s+\w+\s+struct/m,
    /^type\s+\w+\s+interface/m,
  ],
  java: [
    /^(?:public|private|protected|static|\s)*(?:class|interface|enum)\s+\w/m,
    /^(?:public|private|protected|static|\s)*(?:[\w<>\[\]]+\s+)+\w+\s*\(/m,
  ],
  csharp: [
    /^(?:public|private|protected|internal|static|\s)*(?:class|interface|struct|enum|record)\s+\w/m,
    /^(?:public|private|protected|internal|static|async|\s)*(?:[\w<>\[\]]+\s+)+\w+\s*\(/m,
  ],
  ruby: [
    /^(?:def\s+\w|class\s+\w|module\s+\w)/m,
  ],
  php: [
    /^(?:public|private|protected|static|\s)*function\s+\w/m,
    /^class\s+\w/m,
    /^interface\s+\w/m,
  ],
}

function getBoundaryPatterns(language: string): RegExp[] {
  return BOUNDARY_PATTERNS[language] ?? BOUNDARY_PATTERNS.typescript ?? []
}

// ─── Chunking ──────────────────────────────────────────────────────

/**
 * Parse a file into semantic code chunks.
 */
export function parseFile(
  filePath: string,
  content: string,
  config?: ParserConfig,
): CodeChunk[] {
  const maxChunkSize = config?.maxChunkSize ?? 2000
  const minChunkSize = config?.minChunkSize ?? 100
  const overlapLines = config?.overlapLines ?? 2
  const language = detectLanguage(filePath)
  const lines = content.split("\n")

  if (lines.length === 0) return []

  // For structured languages, try boundary-based splitting
  const patterns = getBoundaryPatterns(language)
  if (patterns.length > 0) {
    const chunks = boundaryBasedSplit(filePath, lines, language, patterns, maxChunkSize, minChunkSize)
    if (chunks.length > 0) return chunks
  }

  // Fallback: fixed-size line-based splitting
  return fixedSizeSplit(filePath, lines, language, maxChunkSize, minChunkSize, overlapLines)
}

function boundaryBasedSplit(
  filePath: string,
  lines: string[],
  language: string,
  patterns: RegExp[],
  maxChunkSize: number,
  minChunkSize: number,
): CodeChunk[] {
  // Find boundary line indices
  const boundaries: number[] = [0]
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    // Check if this line starts a new declaration at column 0 or with minimal indent
    const indent = line.length - trimmed.length
    if (indent <= 2 && trimmed.length > 0) {
      for (const pattern of patterns) {
        if (pattern.test(trimmed)) {
          boundaries.push(i)
          break
        }
      }
    }
  }
  boundaries.push(lines.length)

  // Build chunks from boundaries
  const chunks: CodeChunk[] = []
  for (let b = 0; b < boundaries.length - 1; b++) {
    const startLine = boundaries[b]
    const endLine = boundaries[b + 1]
    const chunkLines = lines.slice(startLine, endLine)
    const content = chunkLines.join("\n")

    if (content.trim().length < minChunkSize) continue

    // If chunk is too large, sub-split it
    if (content.length > maxChunkSize * 1.5) {
      const subChunks = fixedSizeSplit(filePath, chunkLines, language, maxChunkSize, minChunkSize, 2, startLine)
      chunks.push(...subChunks)
    } else {
      // Try to extract symbol name from first non-empty line
      const firstLine = chunkLines.find((l) => l.trim().length > 0)?.trim() ?? ""
      const symbol = extractSymbolName(firstLine, language)

      chunks.push({
        id: `${filePath}:${startLine + 1}-${endLine}`,
        filePath,
        startLine: startLine + 1,
        endLine,
        content,
        language,
        symbol: symbol ?? undefined,
        kind: detectKind(firstLine, language),
      })
    }
  }

  return chunks
}

function fixedSizeSplit(
  filePath: string,
  lines: string[],
  language: string,
  maxChunkSize: number,
  minChunkSize: number,
  overlapLines: number,
  lineOffset = 0,
): CodeChunk[] {
  const chunks: CodeChunk[] = []
  let i = 0

  while (i < lines.length) {
    let chunkContent = ""
    const startLine = i

    while (i < lines.length && chunkContent.length < maxChunkSize) {
      chunkContent += lines[i] + "\n"
      i++
    }

    if (chunkContent.trim().length >= minChunkSize) {
      chunks.push({
        id: `${filePath}:${lineOffset + startLine + 1}-${lineOffset + i}`,
        filePath,
        startLine: lineOffset + startLine + 1,
        endLine: lineOffset + i,
        content: chunkContent.trimEnd(),
        language,
        kind: "block",
      })
    }

    // Apply overlap
    if (overlapLines > 0 && i < lines.length) {
      i = Math.max(startLine + 1, i - overlapLines)
    }
  }

  return chunks
}

function extractSymbolName(line: string, _language: string): string | null {
  // Try to extract function/class name from common patterns
  const funcMatch = line.match(/(?:function|def|fn|func)\s+(\w+)/)
  if (funcMatch) return funcMatch[1]

  const classMatch = line.match(/(?:class|struct|enum|interface|trait|type|impl)\s+(\w+)/)
  if (classMatch) return classMatch[1]

  const constMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=/)
  if (constMatch) return constMatch[1]

  const moduleMatch = line.match(/(?:module|namespace|mod|package)\s+(\w+)/)
  if (moduleMatch) return moduleMatch[1]

  return null
}

function detectKind(line: string, _language: string): CodeChunk["kind"] {
  if (/(?:function|def|fn|func)\s+\w/.test(line)) return "function"
  if (/(?:class|struct|enum|interface|trait|impl)\s+\w/.test(line)) return "class"
  if (/(?:module|namespace|mod|package)\s+\w/.test(line)) return "module"
  if (/(?:const|let|var)\s+\w/.test(line)) return "function" // arrow functions, etc.
  return "block"
}

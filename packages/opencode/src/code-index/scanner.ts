/**
 * code-index/scanner.ts — File scanner for codebase indexing.
 *
 * Respects .gitignore + user-configurable exclude patterns.
 * Returns a list of file paths relative to the workspace root.
 *
 * novacode_change - T-1.3
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { Log } from "../util/log"

const log = Log.create({ service: "code-index.scanner" })

// ─── Types ─────────────────────────────────────────────────────────

export interface ScannerConfig {
  /** Workspace root directory (absolute path). */
  rootDir: string
  /** Glob-like directory/file name patterns to exclude. */
  exclude: string[]
  /** Maximum file size in bytes (skip larger files). Default: 512 KB. */
  maxFileSize?: number
}

export interface ScannedFile {
  /** Absolute file path. */
  absolutePath: string
  /** Path relative to workspace root. */
  relativePath: string
  /** File size in bytes. */
  size: number
}

// ─── Default Code Extensions ───────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".lua",
  ".vim",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".yaml",
  ".yml",
  ".toml",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".svelte",
  ".vue",
  ".astro",
  ".md",
  ".mdx",
  ".rst",
  ".tex",
  ".lean",
  ".zig",
  ".nim",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".hs",
  ".ml",
  ".mli",
  ".clj",
  ".cljs",
  ".el",
  ".r",
  ".R",
  ".dart",
  ".dockerfile",
  "Dockerfile",
  "Makefile",
  "CMakeLists.txt",
])

// ─── Gitignore Parser (Simplified) ────────────────────────────────

function parseGitignore(rootDir: string): ((relativePath: string) => boolean) {
  const gitignorePath = path.join(rootDir, ".gitignore")
  const patterns: string[] = []

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith("#")) {
        patterns.push(trimmed)
      }
    }
  }

  return (relativePath: string): boolean => {
    const normalized = relativePath.replace(/\\/g, "/")
    for (const pattern of patterns) {
      const clean = pattern.replace(/\/$/, "")
      // Simple match: check if any path component matches the pattern
      if (normalized.includes(clean) || normalized.startsWith(clean)) {
        return true
      }
      // Check just the file/dir name
      const basename = path.basename(normalized)
      if (basename === clean) {
        return true
      }
    }
    return false
  }
}

// ─── Scanner ───────────────────────────────────────────────────────

export function scanWorkspace(config: ScannerConfig): ScannedFile[] {
  const maxSize = config.maxFileSize ?? 512 * 1024 // 512 KB
  const excludeSet = new Set(config.exclude)
  const isGitignored = parseGitignore(config.rootDir)
  const results: ScannedFile[] = []

  function walk(dir: string) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(config.rootDir, fullPath)

      // Skip excluded directories/files
      if (excludeSet.has(entry.name)) continue
      if (isGitignored(relativePath)) continue

      if (entry.isDirectory()) {
        // Skip hidden directories (starting with .)
        if (entry.name.startsWith(".")) continue
        walk(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name)
        const basename = path.basename(entry.name)
        // Only index known code file extensions
        if (!CODE_EXTENSIONS.has(ext) && !CODE_EXTENSIONS.has(basename)) continue

        try {
          const stat = fs.statSync(fullPath)
          if (stat.size > maxSize) continue
          if (stat.size === 0) continue

          results.push({
            absolutePath: fullPath,
            relativePath: relativePath.replace(/\\/g, "/"),
            size: stat.size,
          })
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(config.rootDir)
  log.info("scan complete", { rootDir: config.rootDir, filesFound: results.length })
  return results
}

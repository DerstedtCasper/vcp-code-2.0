/**
 * brand-rename.mjs
 * Kilo → Nova 全量品牌替换脚本（包括运行时字符串值）
 *
 * 运行: node script/brand-rename.mjs
 *      node script/brand-rename.mjs --dry-run   (仅预览，不写文件)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs"
import { join, extname } from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const DRY_RUN = process.argv.includes("--dry-run")

// ─── 替换规则（顺序敏感：先替换长字符串，避免部分匹配） ─────────────────────

const REPLACEMENTS = [
  // ── npm 包名 / import 路径（最长优先）──────────────────────────────────
  ["@kilocode/kilo-ui",         "@novacode/nova-ui"],
  ["@kilocode/kilo-i18n",       "@novacode/nova-i18n"],
  ["@kilocode/kilo-telemetry",  "@novacode/nova-telemetry"],
  ["@kilocode/kilo-gateway",    "@novacode/nova-gateway"],
  ["@kilocode/kilo-docs",       "@novacode/nova-docs"],
  ["@kilocode/kilo",            "@novacode/nova"],
  ["@kilocode/plugin",          "@novacode/plugin"],
  ["@kilocode/sdk",             "@novacode/sdk"],

  // ── 目录/路径字符串 ─────────────────────────────────────────────────────
  ["packages/kilo-docs",        "packages/nova-docs"],
  ["packages/kilo-gateway",     "packages/nova-gateway"],
  ["packages/kilo-i18n",        "packages/nova-i18n"],
  ["packages/kilo-telemetry",   "packages/nova-telemetry"],
  ["packages/kilo-ui",          "packages/nova-ui"],
  ["packages/kilo-vscode",      "packages/nova-vscode"],
  ["kilo-vscode",               "nova-vscode"],
  ["kilo-ui",                   "nova-ui"],
  ["kilo-i18n",                 "nova-i18n"],
  ["kilo-telemetry",            "nova-telemetry"],
  ["kilo-gateway",              "nova-gateway"],
  ["kilo-docs",                 "nova-docs"],
  ["kilo-sessions",             "nova-sessions"],

  // ── 代码标识符（类名 / 常量名 / 变量名）────────────────────────────────
  ["KiloProvider",              "NovaProvider"],
  ["KiloNotifications",         "NovaNotifications"],
  ["KiloCodeIcon",              "NovaCodeIcon"],
  ["KILO_GATEWAY_ID",           "NOVA_GATEWAY_ID"],
  ["KILO_AUTO",                 "NOVA_AUTO"],
  ["kiloEn",                    "novaEn"],
  ["kiloZh",                    "novaZh"],
  ["kiloJa",                    "novaJa"],
  ["kiloKo",                    "novaKo"],
  ["kiloDe",                    "novaDe"],
  ["kiloFr",                    "novaFr"],
  ["kiloEs",                    "novaEs"],
  ["kiloIt",                    "novaIt"],
  ["kiloPt",                    "novaPt"],
  ["kiloRu",                    "novaRu"],
  ["kiloAr",                    "novaAr"],
  ["kiloTr",                    "novaTr"],
  ["kiloPl",                    "novaPl"],
  ["kiloNl",                    "novaNl"],
  ["kiloHu",                    "novaHu"],
  ["kiloSv",                    "novaSv"],
  ["kilo-provider-utils",       "nova-provider-utils"],

  // ── CSS 类名 ────────────────────────────────────────────────────────────
  ["kilo-notifications",        "nova-notifications"],
  ["kilo-logo",                 "nova-logo"],

  // ── 字符串值（运行时 provider/model ID 等）─────────────────────────────
  ['"kilo/auto"',               '"nova/auto"'],
  ["'kilo/auto'",               "'nova/auto'"],
  ["`kilo/auto`",               "`nova/auto`"],
  ['"kilo-auto"',               '"nova-auto"'],
  ["'kilo-auto'",               "'nova-auto'"],

  // providerID: "kilo"
  ['providerID: "kilo"',        'providerID: "nova"'],
  ["providerID: 'kilo'",        "providerID: 'nova'"],
  ['providerID:"kilo"',         'providerID:"nova"'],
  ['"providerID":"kilo"',       '"providerID":"nova"'],

  // globalState keys
  ['"kilo.dismissedNotificationIds"', '"nova.dismissedNotificationIds"'],
  ["'kilo.dismissedNotificationIds'", "'nova.dismissedNotificationIds'"],

  // oauth calls with "kilo" string arg
  ['oauthAuthorize("kilo"',     'oauthAuthorize("nova"'],
  ['oauthCallback("kilo"',      'oauthCallback("nova"'],
  ['removeAuth("kilo"',         'removeAuth("nova"'],

  // modelID: "kilo"
  ['modelID: "kilo"',           'modelID: "nova"'],
  ["modelID: 'kilo'",           "modelID: 'nova'"],

  // config default value ", \"kilo\")"
  [', "kilo")',                  ', "nova")'],

  // ── 文件名引用字符串 ─────────────────────────────────────────────────────
  ['"kilo-dark.svg"',           '"nova-dark.svg"'],
  ['"kilo-light.svg"',          '"nova-light.svg"'],
  ['"kilo-vscode.json"',        '"nova-vscode.json"'],
  ['"kilo.json"',               '"nova.json"'],

  // ── 扩展 ID / display name 字符串 ───────────────────────────────────────
  ['"kilo-code"',               '"nova-code"'],
  ["'kilo-code'",               "'nova-code'"],
  ['"Kilo Code"',               '"Nova Code"'],
  ["'Kilo Code'",               "'Nova Code'"],
  ['"KiloCode"',                '"NovaCode"'],
  ["'KiloCode'",                "'NovaCode'"],

  // ── 注释/文档字符串中的品牌名 ────────────────────────────────────────────
  ["Kilo Code",                 "Nova Code"],
  ["KiloCode",                  "NovaCode"],
  ["kilo code",                 "nova code"],
  ["Kilo Gateway",              "Nova Gateway"],
  ["kilocode.ai",               "novacode.ai"],

  // ── 剩余的 kilocode → novacode（最后处理）─────────────────────────────
  ["kilocode",                  "novacode"],
  ["Kilocode",                  "Novacode"],
]

// ─── 要处理的文件类型 ──────────────────────────────────────────────────────

const EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc",
  ".css", ".scss",
  ".md", ".mdx",
  ".toml", ".yaml", ".yml",
  ".html",
  ".sh", ".bat",
  ".rs",
  ".nix",
  "",  // 无扩展名文件如 install、Dockerfile 等通过文件名过滤
])

// ─── 要跳过的目录 ──────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "out", ".turbo",
  ".next", "build", "coverage", ".cache",
])

// ─── 要跳过的特定文件（避免误改 lock 文件等）──────────────────────────────

const SKIP_FILES = new Set([
  "brand-rename.mjs",
  "bun.lock",
  "package-lock.json",
  "yarn.lock",
  "Cargo.lock",
])

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    if (SKIP_FILES.has(entry)) continue
    const full = join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full, files)
      } else if (EXTENSIONS.has(extname(entry))) {
        files.push(full)
      }
    } catch {
      // 跳过无法访问的文件
    }
  }
  return files
}

function applyReplacements(content) {
  let result = content
  let changed = false
  for (const [from, to] of REPLACEMENTS) {
    if (result.includes(from)) {
      // 全局替换所有出现
      result = result.split(from).join(to)
      changed = true
    }
  }
  return { result, changed }
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────

console.log(`\n🔍 Brand rename: Kilo → Nova`)
console.log(`   Root: ${ROOT}`)
console.log(`   Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`)

const allFiles = walk(ROOT)
console.log(`   Files scanned: ${allFiles.length}`)

let changed = 0
let skipped = 0
const changedFiles = []

for (const file of allFiles) {
  let content
  try {
    content = readFileSync(file, "utf-8")
  } catch {
    skipped++
    continue
  }

  const { result, changed: wasChanged } = applyReplacements(content)

  if (wasChanged) {
    changedFiles.push(file.replace(ROOT + "\\", "").replace(ROOT + "/", ""))
    if (!DRY_RUN) {
      writeFileSync(file, result, "utf-8")
    }
    changed++
  }
}

console.log(`\n✅ Files modified: ${changed}`)
if (skipped > 0) console.log(`⚠️  Files skipped (read error): ${skipped}`)

if (DRY_RUN || changedFiles.length <= 50) {
  console.log("\nChanged files:")
  for (const f of changedFiles) {
    console.log(`  - ${f}`)
  }
} else {
  console.log(`\nFirst 50 changed files:`)
  for (const f of changedFiles.slice(0, 50)) {
    console.log(`  - ${f}`)
  }
  console.log(`  ... and ${changedFiles.length - 50} more`)
}

if (DRY_RUN) {
  console.log("\n[DRY RUN] No files were written. Remove --dry-run to apply.")
}

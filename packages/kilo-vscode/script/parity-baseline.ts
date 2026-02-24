import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const extensionPath = join(repoRoot, "packages", "kilo-vscode", "src", "extension.ts")
const appPath = join(repoRoot, "packages", "kilo-vscode", "webview-ui", "src", "App.tsx")
const reportPath = join(repoRoot, "packages", "opencode", "src", "kilocode", "docs", "parity-e2e-baseline.md")

function matchAll(source: string, pattern: RegExp): string[] {
  const result: string[] = []
  for (const match of source.matchAll(pattern)) {
    const value = match[1]
    if (value) result.push(value)
  }
  return result
}

const extension = readFileSync(extensionPath, "utf8")
const app = readFileSync(appPath, "utf8")

const emittedActions = Array.from(new Set(matchAll(extension, /action:\s*"([a-zA-Z]+ButtonClicked)"/g))).sort()
const handledActions = new Set(matchAll(app, /case\s+"([a-zA-Z]+ButtonClicked)"/g))

const handled = emittedActions.filter((action) => handledActions.has(action))
const missing = emittedActions.filter((action) => !handledActions.has(action))
const coverage = emittedActions.length === 0 ? 100 : (handled.length / emittedActions.length) * 100

const directCommands = ["helpButtonClicked", "popoutButtonClicked", "openInNewTab", "importConfig", "exportConfig"]
const directCommandCoverage = directCommands.filter((keyword) => extension.includes(keyword))

const lines = [
  "# Parity E2E Baseline Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Action Coverage",
  `- Emitted actions: ${emittedActions.length}`,
  `- Handled actions: ${handled.length}`,
  `- Coverage: ${coverage.toFixed(2)}%`,
  "",
  "### Emitted",
  ...emittedActions.map((item) => `- ${item}`),
  "",
  "### Missing",
  ...(missing.length > 0 ? missing.map((item) => `- ${item}`) : ["- (none)"]),
  "",
  "## Direct Commands (Extension-side handling)",
  ...directCommands.map((item) => `- ${item}: ${directCommandCoverage.includes(item) ? "present" : "missing"}`),
  "",
  "## Verdict",
  coverage >= 95 ? "- PASS (>=95%)" : "- FAIL (<95%)",
]

mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8")

console.log(`parity-baseline coverage=${coverage.toFixed(2)}%, report=${reportPath}`)


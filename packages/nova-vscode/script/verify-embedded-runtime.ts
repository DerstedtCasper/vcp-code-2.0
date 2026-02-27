import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`[verify-embedded-runtime] ${message}`)
  }
}

function mustExist(path: string): void {
  assert(existsSync(path), `missing file: ${path}`)
}

function readUtf8(path: string): string {
  return readFileSync(path, "utf8")
}

const requiredSourceFiles = [
  resolve(root, "src/services/runtime/runtime-client.ts"),
  resolve(root, "src/services/runtime/runtime-client-factory.ts"),
  resolve(root, "src/services/runtime/http-runtime-client.ts"),
  resolve(root, "src/services/embedded-runtime/embedded-runtime-client.ts"),
  resolve(root, "src/extension.ts"),
]

for (const file of requiredSourceFiles) {
  mustExist(file)
}

const extensionSource = readUtf8(resolve(root, "src/extension.ts"))
assert(
  extensionSource.includes("RuntimeClientFactory"),
  "extension.ts does not wire RuntimeClientFactory (embedded runtime injection missing)",
)

const packageJsonPath = resolve(root, "package.json")
mustExist(packageJsonPath)
const packageJson = JSON.parse(readUtf8(packageJsonPath)) as {
  contributes?: { configuration?: { properties?: Record<string, { default?: unknown }> } }
}

const runtimeModeDefault =
  packageJson.contributes?.configuration?.properties?.["vcp-code.new.runtime.mode"]?.default
assert(runtimeModeDefault === "embedded", `expected vcp-code.new.runtime.mode default=embedded, got ${String(runtimeModeDefault)}`)

const distExtension = resolve(root, "dist/extension.js")
const distWebview = resolve(root, "dist/webview.js")
mustExist(distExtension)
mustExist(distWebview)
assert(statSync(distExtension).size > 0, "dist/extension.js is empty")
assert(statSync(distWebview).size > 0, "dist/webview.js is empty")

console.log("[verify-embedded-runtime] OK")

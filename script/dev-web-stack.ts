// novacode_change - new file
import { setTimeout as wait } from "node:timers/promises"

const repo = process.cwd()
const host = process.env.KILO_DEV_SERVER_HOST ?? "127.0.0.1"
const sport = Number.parseInt(process.env.KILO_DEV_SERVER_PORT ?? "4096", 10)
const wport = Number.parseInt(process.env.KILO_DEV_WEB_PORT ?? "4444", 10)
const timeout = Number.parseInt(process.env.KILO_DEV_HEALTH_TIMEOUT_MS ?? "60000", 10)
const cliEmbedded = process.argv.includes("--embedded")
const cliLegacy = process.argv.includes("--legacy")
const runtimeModeRaw = (cliEmbedded ? "embedded" : cliLegacy ? "legacy" : process.env.KILO_DEV_RUNTIME_MODE ?? "legacy")
  .trim()
  .toLowerCase()
const runtimeMode = runtimeModeRaw === "embedded" ? "embedded" : "legacy"
const useEmbeddedRuntime = runtimeMode === "embedded"

if (!Number.isFinite(sport) || sport <= 0) {
  throw new Error(`Invalid KILO_DEV_SERVER_PORT: ${process.env.KILO_DEV_SERVER_PORT}`)
}
if (!Number.isFinite(wport) || wport <= 0) {
  throw new Error(`Invalid KILO_DEV_WEB_PORT: ${process.env.KILO_DEV_WEB_PORT}`)
}
if (!Number.isFinite(timeout) || timeout <= 0) {
  throw new Error(`Invalid KILO_DEV_HEALTH_TIMEOUT_MS: ${process.env.KILO_DEV_HEALTH_TIMEOUT_MS}`)
}

const surl = `http://${host}:${sport}`
const wurl = `http://127.0.0.1:${wport}`
const heal = `${surl}/global/health`

const waitForHealth = async (url: string, limit: number) => {
  const end = Date.now() + limit
  let last = "unknown"
  while (Date.now() < end) {
    try {
      const res = await fetch(url)
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await wait(250)
  }
  throw new Error(`Timed out waiting for backend health at ${url}. Last error: ${last}`)
}

const startBackend = () =>
  Bun.spawn(
    [
      "bun",
      "run",
      "--cwd",
      "packages/opencode",
      "--conditions=browser",
      "./src/index.ts",
      "serve",
      "--port",
      String(sport),
      "--hostname",
      host,
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        KILO_CLIENT: process.env.KILO_CLIENT ?? "app",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  )

let web: ReturnType<typeof Bun.spawn> | undefined
let serve: ReturnType<typeof Bun.spawn> | undefined
let done = false

const stop = async (proc: ReturnType<typeof Bun.spawn> | undefined) => {
  if (!proc || proc.exitCode !== null) return
  proc.kill("SIGTERM")
  await proc.exited
}

const close = async (code: number) => {
  if (done) return
  done = true
  await Promise.allSettled([stop(web), stop(serve)])
  process.exit(code)
}

process.once("SIGINT", () => void close(130))
process.once("SIGTERM", () => void close(143))
process.once("SIGHUP", () => void close(129))

try {
  if (useEmbeddedRuntime) {
    console.log("[dev:web] runtime mode: embedded (skip local backend process)")
  } else {
    serve = startBackend()
    console.log(`[dev:web] runtime mode: legacy`)
    console.log(`[dev:web] starting backend on ${surl}`)
    await Promise.race([
      waitForHealth(heal, timeout),
      serve.exited.then((code) => {
        throw new Error(`Backend exited before healthy, code: ${code ?? "unknown"}`)
      }),
    ])
    console.log(`[dev:web] backend healthy: ${heal}`)
  }
  console.log(`[dev:web] starting frontend on ${wurl}`)

  web = Bun.spawn(["bun", "run", "--cwd", "packages/app", "dev", "--", "--port", String(wport)], {
    cwd: repo,
    env: {
      ...process.env,
      VITE_KILO_SERVER_HOST: host,
      VITE_KILO_SERVER_PORT: String(sport),
      VITE_KILO_RUNTIME_MODE: runtimeMode,
    },
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitSignals: Array<Promise<{ who: "backend" | "frontend"; code: number | null }>> = [
    web.exited.then((code) => ({ who: "frontend", code })),
  ]
  if (serve) {
    exitSignals.push(serve.exited.then((code) => ({ who: "backend", code })))
  }

  const first = await Promise.race(exitSignals)
  const code = first.code ?? 1
  console.error(`[dev:web] ${first.who} exited with code ${code}, shutting down...`)
  await close(code)
} catch (error) {
  console.error("[dev:web] failed to start full web stack")
  console.error(error)
  await close(1)
}

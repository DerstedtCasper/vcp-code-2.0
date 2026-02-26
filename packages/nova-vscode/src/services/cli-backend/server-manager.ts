import { spawn, ChildProcess } from "child_process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { parseServerPort } from "./server-utils"

export interface ServerInstance {
  port: number
  password: string
  process: ChildProcess
}

export class ServerManager {
  private instance: ServerInstance | null = null
  private startupPromise: Promise<ServerInstance> | null = null

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    console.log("[Nova New] ServerManager: 🔍 getServer called")

    // If we have an existing instance, verify the process is still alive
    if (this.instance) {
      if (this.instance.process.killed || this.instance.process.exitCode !== null) {
        console.warn("[Nova New] ServerManager: ⚠️ Existing process is dead, clearing instance")
        this.instance = null
      } else {
        console.log("[Nova New] ServerManager: ♻️ Returning existing instance:", { port: this.instance.port })
        return this.instance
      }
    }

    if (this.startupPromise) {
      console.log("[Nova New] ServerManager:  - Startup already in progress, waiting...")
      return this.startupPromise
    }

    console.log("[Nova New] ServerManager: 🚀 Starting new server instance...")
    this.startupPromise = this.startServer()
    try {
      this.instance = await this.startupPromise
      console.log("[Nova New] ServerManager:  - Server started successfully:", { port: this.instance.port })
      return this.instance
    } finally {
      this.startupPromise = null
    }
  }

  /**
   * Invalidate the current server instance so the next getServer() call will start a new one.
   * Called by ConnectionService when reconnecting after the server process died.
   */
  invalidate(): void {
    console.log("[Nova New] ServerManager: 🔄 Invalidating current instance")
    if (this.instance) {
      try {
        this.instance.process.kill("SIGTERM")
      } catch {
        // Process may already be dead
      }
      this.instance = null
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex")
    const cliPath = this.getCliPath()
    console.log("[Nova New] ServerManager: 📍 CLI path:", cliPath)
    console.log("[Nova New] ServerManager: 🔐 Generated password (length):", password.length)

    // Verify the CLI binary exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `CLI binary not found at expected path: ${cliPath}. Please ensure the CLI is built and bundled with the extension.`,
      )
    }

    const stat = fs.statSync(cliPath)
    console.log("[Nova New] ServerManager: 📄 CLI isFile:", stat.isFile())
    console.log("[Nova New] ServerManager: 📄 CLI mode (octal):", (stat.mode & 0o777).toString(8))

    return new Promise((resolve, reject) => {
      console.log("[Nova New] ServerManager: 🎬 Spawning CLI process:", cliPath, ["serve", "--port", "0"])
      const serverProcess = spawn(cliPath, ["serve", "--port", "0"], {
        env: {
          ...process.env,
          KILO_SERVER_PASSWORD: password,
          KILO_CLIENT: "vscode",
          KILOCODE_FEATURE: "vscode-extension", // novacode_change - feature tracking
          KILO_TELEMETRY_LEVEL: vscode.env.isTelemetryEnabled ? "all" : "off",
          KILO_APP_NAME: "vcp-code",
          KILO_EDITOR_NAME: vscode.env.appName,
          KILO_PLATFORM: "vscode",
          KILO_MACHINE_ID: vscode.env.machineId,
          KILO_APP_VERSION: this.context.extension.packageJSON.version,
          KILO_VSCODE_VERSION: vscode.version,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      console.log("[Nova New] ServerManager: 📦 Process spawned with PID:", serverProcess.pid)

      let resolved = false

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        console.log("[Nova New] ServerManager: 📥 CLI Server stdout:", output)

        const port = parseServerPort(output)
        if (port !== null && !resolved) {
          resolved = true
          console.log("[Nova New] ServerManager: 🎯 Port detected:", port)
          resolve({ port, password, process: serverProcess })
        }
      })

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString()
        console.error("[Nova New] ServerManager: ⚠️ CLI Server stderr:", errorOutput)
      })

      serverProcess.on("error", (error) => {
        console.error("[Nova New] ServerManager:  - Process error:", error)
        if (!resolved) {
          reject(error)
        }
      })

      serverProcess.on("exit", (code) => {
        console.log("[Nova New] ServerManager: 🛑 Process exited with code:", code)
        if (this.instance?.process === serverProcess) {
          this.instance = null
        }
        if (!resolved) {
          reject(new Error(`CLI process exited with code ${code} before server started`))
        }
      })

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          console.error("[Nova New] ServerManager:  - Server startup timeout (30s)")
          serverProcess.kill()
          reject(new Error("Server startup timeout"))
        }
      }, 30000)
    })
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const binName = process.platform === "win32" ? "kilo.exe" : "kilo" // novacode_change
    const cliPath = path.join(this.context.extensionPath, "bin", binName)
    console.log("[Nova New] ServerManager: 📦 Using CLI path:", cliPath)
    return cliPath
  }

  dispose(): void {
    if (this.instance) {
      this.instance.process.kill("SIGTERM")
      this.instance = null
    }
  }
}

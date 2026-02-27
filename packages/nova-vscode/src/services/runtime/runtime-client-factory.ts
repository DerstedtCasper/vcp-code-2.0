import * as vscode from "vscode"
import type { NovaConnectionService } from "../cli-backend"
import { EmbeddedRuntimeClient } from "../embedded-runtime/embedded-runtime-client"
import { HttpRuntimeClient } from "./http-runtime-client"
import type { RuntimeClient } from "./runtime-client"
import type { RuntimeMode } from "./runtime-events"

export interface RuntimeClientFactoryRequest {
  reason: string
  workspaceDir: string
  mode?: RuntimeMode
}

export class RuntimeClientFactory {
  constructor(private readonly connectionService: NovaConnectionService) {}

  getRuntimeMode(): RuntimeMode {
    const mode = vscode.workspace.getConfiguration("vcp-code.new.runtime").get<string>("mode", "embedded")
    return mode === "legacy" ? "legacy" : "embedded"
  }

  async getRuntimeClient(request: RuntimeClientFactoryRequest): Promise<RuntimeClient | null> {
    const mode = request.mode ?? this.getRuntimeMode()

    if (mode === "embedded") {
      return new EmbeddedRuntimeClient(this.connectionService, request.workspaceDir)
    }

    try {
      const client = this.connectionService.getHttpClient()
      return new HttpRuntimeClient(client)
    } catch {
      console.warn("[Nova New] RuntimeClientFactory: legacy runtime not ready, trying fallback connection")
      try {
        await this.connectionService.connectWithLegacyFallback(request.workspaceDir, request.reason)
        const client = this.connectionService.getHttpClient()
        return new HttpRuntimeClient(client)
      } catch (error) {
        console.error("[Nova New] RuntimeClientFactory: legacy runtime fallback failed:", error)
        return null
      }
    }
  }
}

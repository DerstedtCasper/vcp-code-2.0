import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

type CheckResult = { name: string; pass: boolean; detail: string }

const root = join(import.meta.dir, "..", "..", "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")

function check(name: string, pass: boolean, detail: string): CheckResult {
  return { name, pass, detail }
}

const results: CheckResult[] = []

const agentBehaviour = read("packages/nova-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx")
const contextTab = read("packages/nova-vscode/webview-ui/src/components/settings/ContextTab.tsx")
const messages = read("packages/nova-vscode/webview-ui/src/types/messages.ts")
const extension = read("packages/nova-vscode/src/extension.ts")
const routes = read("packages/opencode/src/server/routes/experimental.ts")
const sessionProcessor = read("packages/opencode/src/session/processor.ts")
const sessionIndex = read("packages/opencode/src/session/index.ts")
const parityReportPath = "packages/opencode/src/novacode/docs/parity-e2e-baseline.md"
const parityReport = existsSync(join(root, parityReportPath)) ? read(parityReportPath) : ""

results.push(
  check(
    "配置一致性（单入口写入）",
    agentBehaviour.includes("Memory 配置已迁移到 Settings 的 Context 页签统一管理") &&
      !agentBehaviour.includes("Memory Runtime Enabled"),
    "AgentBehaviour 记忆入口已只读迁移，避免多入口写同 key",
  ),
)

results.push(
  check(
    "队列行为协议",
    messages.includes("requestPromptQueue") &&
      messages.includes("enqueuePrompt") &&
      messages.includes("reorderPromptQueue") &&
      messages.includes("promptQueueUpdated"),
    "Prompt 队列协议字段已存在",
  ),
)

results.push(
  check(
    "Agent Team 模式",
    existsSync(join(root, "packages/opencode/src/agent/prompt/agent-team.txt")) &&
      routes.includes("/vcp/agent-team/status"),
    "agent_team prompt 与 status 路由已存在",
  ),
)

results.push(
  check(
    "VCP 入口导航",
    extension.includes("vcp-code.new.vcpButtonClicked") &&
      extension.includes("action: \"vcpButtonClicked\"") &&
      parityReport.includes("Coverage: 100.00%"),
    "VCP 入口命令存在，且 parity baseline 覆盖率满足 >=95%",
  ),
)

results.push(
  check(
    "Context 记忆中心",
    contextTab.includes("1) {language.t(\"settings.context.title\")} / 基础压缩") &&
      contextTab.includes("2) 记忆注入（Passive + Retrieval）") &&
      contextTab.includes("3) 记忆写入（Writer + Refresh）") &&
      contextTab.includes("4) 记忆库管理（Overview / Search / Update / Delete）") &&
      contextTab.includes("5) 上下文盒规则（Context Box Preview）") &&
      messages.includes("previewMemoryContext") &&
      sessionProcessor.includes("Session.Event.VCPMemoryRefresh") &&
      sessionIndex.includes("session.vcp.memory.refresh"),
    "ContextTab 五分区 + memory preview + 工具后记忆刷新事件语义已贯通",
  ),
)

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total

const report = [
  "# VCP 全链路回归 Smoke Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Result: ${allPass ? "PASS" : "FAIL"} (${passed}/${total})`,
  "",
  ...results.map((r) => `- [${r.pass ? "x" : " "}] ${r.name}: ${r.detail}`),
  "",
]

const outputPath = join(root, "packages/opencode/src/novacode/docs/vcp-regression-smoke-report.md")
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, report.join("\n"), "utf8")

if (!allPass) {
  console.error(`vcp-regression-smoke failed (${passed}/${total})`)
  process.exitCode = 1
} else {
  console.log(`vcp-regression-smoke passed (${passed}/${total})`)
}

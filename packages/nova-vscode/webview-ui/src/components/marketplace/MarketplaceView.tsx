import {
  Component,
  For,
  Show,
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  Switch,
  Match,
} from "solid-js"
import { Button } from "@novacode/nova-ui/button"
import { TextField } from "@novacode/nova-ui/text-field"
import { showToast } from "@novacode/nova-ui/toast"
import { useLanguage } from "../../context/language"

// ─── Types ───────────────────────────────────────────────────────────

interface SkillItem {
  id: string
  description: string
  category?: string
  githubUrl?: string
  rawUrl?: string
  content: string
}

interface ModeItem {
  id: string
  name: string
  description: string
  author?: string
  tags?: string[]
  content: string
}

interface MCPParameter {
  name: string
  key: string
  placeholder: string
  optional?: boolean
}

interface MCPContent {
  name: string
  prerequisites?: string[]
  content: string
  parameters?: MCPParameter[]
}

interface MCPItem {
  id: string
  name: string
  description: string
  author?: string
  url?: string
  tags?: string[]
  prerequisites?: string[]
  content: MCPContent[] | MCPContent | string
  parameters?: MCPParameter[]
}

interface InstalledItems {
  mcps: string[]
  modes: string[]
  skills: string[]
}

type TabType = "skills" | "modes" | "mcps"

// ─── Helper: get port ────────────────────────────────────────────────

function getBaseUrl(): string {
  const port = (window as any).__OPENCODE_PORT__ || 13338
  return `http://localhost:${port}`
}

// ─── Install Dialog ──────────────────────────────────────────────────

const MCPInstallDialog: Component<{
  item: MCPItem
  onClose: () => void
  onInstalled: () => void
}> = (props) => {
  const language = useLanguage()
  const [selectedMethodIndex, setSelectedMethodIndex] = createSignal(0)
  const [params, setParams] = createSignal<Record<string, string>>({})
  const [installing, setInstalling] = createSignal(false)

  const contentMethods = createMemo((): MCPContent[] => {
    const raw = props.item.content
    if (Array.isArray(raw)) return raw
    if (typeof raw === "object" && raw !== null && "content" in raw) return [raw as MCPContent]
    // String content: wrap as single method
    return [{ name: "Default", content: raw as string, parameters: props.item.parameters }]
  })

  const currentMethod = createMemo(() => contentMethods()[selectedMethodIndex()])

  const allParams = createMemo((): MCPParameter[] => {
    const m = currentMethod()
    const local = m?.parameters ?? []
    const global = props.item.parameters ?? []
    // Merge: local overrides global by key
    const map = new Map<string, MCPParameter>()
    for (const p of global) map.set(p.key, p)
    for (const p of local) map.set(p.key, p)
    return [...map.values()]
  })

  const canInstall = createMemo(() => {
    for (const p of allParams()) {
      if (p.optional) continue
      if (!params()[p.key]?.trim()) return false
    }
    return true
  })

  async function doInstall() {
    setInstalling(true)
    try {
      const res = await fetch(`${getBaseUrl()}/marketplace/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "mcp",
          id: props.item.id,
          selectedContentIndex: selectedMethodIndex(),
          params: params(),
        }),
      })
      const result = await res.json()
      if (result.success) {
        showToast({ variant: "success", title: language.t("marketplace.install.success") })
        props.onInstalled()
        props.onClose()
      } else {
        showToast({ variant: "error", title: result.message || language.t("marketplace.install.failed") })
      }
    } catch (e: any) {
      showToast({ variant: "error", title: e.message || language.t("marketplace.install.failed") })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div class="mp-dialog-overlay" onClick={() => props.onClose()}>
      <div class="mp-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="mp-dialog-header">
          <h3>{language.t("marketplace.install.title")}: {props.item.name}</h3>
          <button class="mp-dialog-close" onClick={() => props.onClose()}>✕</button>
        </div>

        <div class="mp-dialog-body">
          {/* Description */}
          <p class="mp-dialog-desc">{props.item.description}</p>

          {/* Method selector (if multiple) */}
          <Show when={contentMethods().length > 1}>
            <div class="mp-dialog-section">
              <label class="mp-dialog-label">{language.t("marketplace.install.method")}</label>
              <div class="mp-method-tabs">
                <For each={contentMethods()}>
                  {(method, idx) => (
                    <button
                      class={`mp-method-tab ${idx() === selectedMethodIndex() ? "mp-method-tab--active" : ""}`}
                      onClick={() => setSelectedMethodIndex(idx())}
                    >
                      {method.name}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Prerequisites */}
          <Show when={currentMethod()?.prerequisites?.length}>
            <div class="mp-dialog-section">
              <label class="mp-dialog-label">{language.t("marketplace.install.prerequisites")}</label>
              <div class="mp-prereqs">
                <For each={currentMethod()?.prerequisites}>
                  {(prereq) => <span class="mp-prereq-badge">{prereq}</span>}
                </For>
              </div>
            </div>
          </Show>

          {/* Parameters */}
          <Show when={allParams().length > 0}>
            <div class="mp-dialog-section">
              <label class="mp-dialog-label">{language.t("marketplace.install.parameters")}</label>
              <For each={allParams()}>
                {(param) => (
                  <div class="mp-param-row">
                    <label class="mp-param-label">
                      {param.name}
                      <Show when={param.optional}>
                        <span class="mp-param-optional"> ({language.t("marketplace.install.optional")})</span>
                      </Show>
                    </label>
                    <TextField
                      placeholder={param.placeholder}
                      value={params()[param.key] ?? ""}
                      onChange={(val: string) => {
                        setParams((prev) => ({ ...prev, [param.key]: val }))
                      }}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="mp-dialog-footer">
          <Button variant="ghost" onClick={() => props.onClose()}>
            {language.t("marketplace.install.cancel")}
          </Button>
          <Button
            disabled={!canInstall() || installing()}
            onClick={doInstall}
          >
            {installing() ? language.t("marketplace.install.installing") : language.t("marketplace.install.confirm")}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Skill Card ──────────────────────────────────────────────────────

const SkillCard: Component<{ item: SkillItem; installed: boolean }> = (props) => {
  const language = useLanguage()
  const [installing, setInstalling] = createSignal(false)

  async function install() {
    setInstalling(true)
    try {
      const res = await fetch(`${getBaseUrl()}/marketplace/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "skill", id: props.item.id }),
      })
      const result = await res.json()
      if (result.success) {
        showToast({ variant: "success", title: language.t("marketplace.install.success") })
      } else {
        showToast({ variant: "error", title: result.message || language.t("marketplace.install.failed") })
      }
    } catch (e: any) {
      showToast({ variant: "error", title: e.message })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div class="mp-card">
      <div class="mp-card-header">
        <span class="mp-card-icon">📦</span>
        <span class="mp-card-title">{props.item.id}</span>
        <Show when={props.item.category}>
          <span class="mp-card-badge">{props.item.category}</span>
        </Show>
      </div>
      <p class="mp-card-desc">{props.item.description}</p>
      <div class="mp-card-footer">
        <Show when={props.installed}>
          <span class="mp-installed-badge">✓ {language.t("marketplace.installed")}</span>
        </Show>
        <Show when={!props.installed}>
          <Button size="small" disabled={installing()} onClick={install}>
            {installing() ? language.t("marketplace.install.installing") : language.t("marketplace.install.confirm")}
          </Button>
        </Show>
        <Show when={props.item.githubUrl}>
          <a class="mp-card-link" href={props.item.githubUrl} target="_blank" rel="noopener">
            GitHub ↗
          </a>
        </Show>
      </div>
    </div>
  )
}

// ─── Mode Card ───────────────────────────────────────────────────────

const ModeCard: Component<{ item: ModeItem; installed: boolean }> = (props) => {
  const language = useLanguage()
  const [installing, setInstalling] = createSignal(false)

  async function install() {
    setInstalling(true)
    try {
      const res = await fetch(`${getBaseUrl()}/marketplace/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "mode", id: props.item.id }),
      })
      const result = await res.json()
      if (result.success) {
        showToast({ variant: "success", title: language.t("marketplace.install.success") })
      } else {
        showToast({ variant: "error", title: result.message || language.t("marketplace.install.failed") })
      }
    } catch (e: any) {
      showToast({ variant: "error", title: e.message })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div class="mp-card">
      <div class="mp-card-header">
        <span class="mp-card-icon">🎭</span>
        <span class="mp-card-title">{props.item.name}</span>
        <Show when={props.item.author}>
          <span class="mp-card-author">{props.item.author}</span>
        </Show>
      </div>
      <p class="mp-card-desc">{props.item.description}</p>
      <Show when={props.item.tags?.length}>
        <div class="mp-card-tags">
          <For each={props.item.tags}>{(tag) => <span class="mp-tag">{tag}</span>}</For>
        </div>
      </Show>
      <div class="mp-card-footer">
        <Show when={props.installed}>
          <span class="mp-installed-badge">✓ {language.t("marketplace.installed")}</span>
        </Show>
        <Show when={!props.installed}>
          <Button size="small" disabled={installing()} onClick={install}>
            {installing() ? language.t("marketplace.install.installing") : language.t("marketplace.install.confirm")}
          </Button>
        </Show>
      </div>
    </div>
  )
}

// ─── MCP Card ────────────────────────────────────────────────────────

const MCPCard: Component<{
  item: MCPItem
  installed: boolean
  onInstallClick: (item: MCPItem) => void
}> = (props) => {
  const language = useLanguage()

  return (
    <div class="mp-card">
      <div class="mp-card-header">
        <span class="mp-card-icon">🔌</span>
        <span class="mp-card-title">{props.item.name}</span>
        <Show when={props.item.author}>
          <span class="mp-card-author">{props.item.author}</span>
        </Show>
      </div>
      <p class="mp-card-desc">{props.item.description}</p>
      <Show when={props.item.tags?.length}>
        <div class="mp-card-tags">
          <For each={props.item.tags}>{(tag) => <span class="mp-tag">{tag}</span>}</For>
        </div>
      </Show>
      <div class="mp-card-footer">
        <Show when={props.installed}>
          <span class="mp-installed-badge">✓ {language.t("marketplace.installed")}</span>
        </Show>
        <Show when={!props.installed}>
          <Button size="small" onClick={() => props.onInstallClick(props.item)}>
            {language.t("marketplace.install.confirm")}
          </Button>
        </Show>
        <Show when={props.item.url}>
          <a class="mp-card-link" href={props.item.url} target="_blank" rel="noopener">
            GitHub ↗
          </a>
        </Show>
      </div>
    </div>
  )
}

// ─── Main MarketplaceView ────────────────────────────────────────────

export const MarketplaceView: Component = () => {
  const language = useLanguage()
  const [tab, setTab] = createSignal<TabType>("skills")
  const [query, setQuery] = createSignal("")
  const [skills, setSkills] = createSignal<SkillItem[]>([])
  const [modes, setModes] = createSignal<ModeItem[]>([])
  const [mcps, setMCPs] = createSignal<MCPItem[]>([])
  const [installed, setInstalled] = createSignal<InstalledItems>({ mcps: [], modes: [], skills: [] })
  const [loading, setLoading] = createSignal(false)
  const [mcpInstallTarget, setMcpInstallTarget] = createSignal<MCPItem | null>(null)

  let searchTimer: ReturnType<typeof setTimeout> | undefined

  // ─── Data Fetching ─────────────────────────────────────────────────

  async function fetchTab(t: TabType, q?: string) {
    setLoading(true)
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : ""
      const url = `${getBaseUrl()}/marketplace/${t}${qs}`
      console.log("[Marketplace] fetching", url)
      const res = await fetch(url)
      if (!res.ok) {
        console.warn("[Marketplace] fetch failed", res.status, res.statusText)
        return
      }
      const data = await res.json()
      console.log("[Marketplace]", t, "received", Array.isArray(data) ? data.length : typeof data, "items")
      const items = Array.isArray(data) ? data : []
      if (t === "skills") setSkills(items)
      else if (t === "modes") setModes(items)
      else if (t === "mcps") setMCPs(items)
    } catch (err) {
      console.error("[Marketplace] fetchTab error:", err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchInstalled() {
    try {
      const res = await fetch(`${getBaseUrl()}/marketplace/installed`)
      const data = await res.json()
      setInstalled(data)
    } catch {
      // ignore
    }
  }

  async function doRefresh() {
    setLoading(true)
    try {
      await fetch(`${getBaseUrl()}/marketplace/refresh`, { method: "POST" })
      await Promise.all([fetchTab(tab(), query()), fetchInstalled()])
      showToast({ variant: "success", title: language.t("marketplace.refresh.success") })
    } catch {
      showToast({ variant: "error", title: language.t("marketplace.refresh.failed") })
    } finally {
      setLoading(false)
    }
  }

  // ─── Effects ───────────────────────────────────────────────────────

  onMount(() => {
    fetchTab("skills")
    fetchInstalled()
  })

  createEffect(() => {
    const currentTab = tab()
    // Reset query when switching tabs
    fetchTab(currentTab, query())
  })

  function handleSearch(val: string) {
    setQuery(val)
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      fetchTab(tab(), val)
    }, 350)
  }

  onCleanup(() => clearTimeout(searchTimer))

  // ─── Filtered lists (with installed markers) ───────────────────────

  const filteredSkills = createMemo(() => skills())
  const filteredModes = createMemo(() => modes())
  const filteredMCPs = createMemo(() => mcps())

  const isSkillInstalled = (id: string) => installed().skills?.includes(id) ?? false
  const isModeInstalled = (id: string) => installed().modes?.includes(id) ?? false
  const isMCPInstalled = (id: string) => installed().mcps?.includes(id) ?? false

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div class="mp-container">
      {/* Header */}
      <div class="mp-header">
        <h2 class="mp-title">{language.t("view.marketplace.title")}</h2>
        <Button size="small" variant="ghost" onClick={doRefresh} disabled={loading()}>
          {loading() ? "⏳" : "🔄"} {language.t("marketplace.refresh")}
        </Button>
      </div>

      {/* Tabs */}
      <div class="mp-tabs">
        <button
          class={`mp-tab ${tab() === "skills" ? "mp-tab--active" : ""}`}
          onClick={() => setTab("skills")}
        >
          📦 {language.t("marketplace.tab.skills")}
          <Show when={skills().length > 0}>
            <span class="mp-tab-count">{skills().length}</span>
          </Show>
        </button>
        <button
          class={`mp-tab ${tab() === "modes" ? "mp-tab--active" : ""}`}
          onClick={() => setTab("modes")}
        >
          🎭 {language.t("marketplace.tab.modes")}
          <Show when={modes().length > 0}>
            <span class="mp-tab-count">{modes().length}</span>
          </Show>
        </button>
        <button
          class={`mp-tab ${tab() === "mcps" ? "mp-tab--active" : ""}`}
          onClick={() => setTab("mcps")}
        >
          🔌 {language.t("marketplace.tab.mcps")}
          <Show when={mcps().length > 0}>
            <span class="mp-tab-count">{mcps().length}</span>
          </Show>
        </button>
      </div>

      {/* Search bar */}
      <div class="mp-search">
        <TextField
          placeholder={language.t("marketplace.search.placeholder")}
          value={query()}
          onChange={handleSearch}
        />
      </div>

      {/* Content */}
      <div class="mp-content">
        <Show when={loading()}>
          <div class="mp-loading">{language.t("marketplace.loading")}</div>
        </Show>

        <Show when={!loading()}>
          <Switch>
            <Match when={tab() === "skills"}>
              <Show when={filteredSkills().length === 0}>
                <div class="mp-empty">{language.t("marketplace.empty")}</div>
              </Show>
              <div class="mp-grid">
                <For each={filteredSkills()}>
                  {(item) => <SkillCard item={item} installed={isSkillInstalled(item.id)} />}
                </For>
              </div>
            </Match>

            <Match when={tab() === "modes"}>
              <Show when={filteredModes().length === 0}>
                <div class="mp-empty">{language.t("marketplace.empty")}</div>
              </Show>
              <div class="mp-grid">
                <For each={filteredModes()}>
                  {(item) => <ModeCard item={item} installed={isModeInstalled(item.id)} />}
                </For>
              </div>
            </Match>

            <Match when={tab() === "mcps"}>
              <Show when={filteredMCPs().length === 0}>
                <div class="mp-empty">{language.t("marketplace.empty")}</div>
              </Show>
              <div class="mp-grid">
                <For each={filteredMCPs()}>
                  {(item) => (
                    <MCPCard
                      item={item}
                      installed={isMCPInstalled(item.id)}
                      onInstallClick={(it) => setMcpInstallTarget(it)}
                    />
                  )}
                </For>
              </div>
            </Match>
          </Switch>
        </Show>
      </div>

      {/* MCP Install Dialog */}
      <Show when={mcpInstallTarget()}>
        <MCPInstallDialog
          item={mcpInstallTarget()!}
          onClose={() => setMcpInstallTarget(null)}
          onInstalled={() => fetchInstalled()}
        />
      </Show>
    </div>
  )
}

export default MarketplaceView

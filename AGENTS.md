# AGENTS.md

Kilo CLI is an open source AI coding agent that generates code from natural language, automates tasks, and supports 500+ AI models.

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- You may be running in a git worktree. All changes must be made in your current working directory — never modify files in the main repo checkout.

## Build and Dev

- **Dev**: `bun run dev` (runs from root) or `bun run --cwd packages/opencode --conditions=browser src/index.ts`
- **Typecheck**: `bun turbo typecheck` (uses `tsgo`, not `tsc`)
- **Test**: `bun test` from `packages/opencode/` (NOT from root -- root blocks tests)
- **Single test**: `bun test test/tool/tool.test.ts` from `packages/opencode/`
- **SDK regen**: After changing server endpoints in `packages/opencode/src/server/`, run `./script/generate.ts` from root to regenerate `packages/sdk/js/`

## Products

All products are clients of the **CLI** (`packages/opencode/`), which contains the AI agent runtime, HTTP server, and session management. Each client spawns or connects to a `kilo serve` process and communicates via HTTP + SSE using `@novacode/sdk`.

| Product                | Package                 | Description                                                                                                                                                                          |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kilo CLI               | `packages/opencode/`    | Core engine. TUI, `kilo run`, `kilo serve`, `kilo web`. Fork of upstream OpenCode.                                                                                                   |
| Kilo VS Code Extension | `packages/nova-vscode/` | VS Code extension. Bundles the CLI binary, spawns `kilo serve` as a child process. Includes the **Agent Manager** — a multi-session orchestration panel with git worktree isolation. |
| OpenCode Desktop       | `packages/desktop/`     | Standalone Tauri native app. Bundles CLI as sidecar. Single-session UI. Unrelated to the VS Code extension. Not actively maintained — synced from upstream fork.                     |
| OpenCode Web           | `packages/app/`         | Shared SolidJS frontend used by both the desktop app and `kilo web` CLI command. Not actively maintained — synced from upstream fork.                                                |

**Agent Manager** refers to a feature inside `packages/nova-vscode/` (extension code in `src/agent-manager/`, webview in `webview-ui/agent-manager/`). It is not a standalone product. See the extension's `AGENTS.md` for details.

## Monorepo Structure

Turborepo + Bun workspaces. The packages you'll work with most:

| Package                    | Name                       | Purpose                                                                                    |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/opencode/`       | `@novacode/cli`            | Core CLI -- agents, tools, sessions, server, TUI. This is where most work happens.         |
| `packages/sdk/js/`         | `@novacode/sdk`            | Auto-generated TypeScript SDK (client for the server API). Do not edit `src/gen/` by hand. |
| `packages/nova-vscode/`    | `kilo-code`                | VS Code extension with sidebar chat + Agent Manager. See its own `AGENTS.md` for details.  |
| `packages/nova-gateway/`   | `@novacode/nova-gateway`   | Kilo auth, provider routing, API integration                                               |
| `packages/nova-telemetry/` | `@novacode/nova-telemetry` | PostHog analytics + OpenTelemetry                                                          |
| `packages/nova-i18n/`      | `@novacode/nova-i18n`      | Internationalization / translations                                                        |
| `packages/nova-ui/`        | `@novacode/nova-ui`        | SolidJS component library shared by the extension webview and `packages/app/`              |
| `packages/app/`            | `@opencode-ai/app`         | Shared SolidJS web UI for desktop app and `kilo web`                                       |
| `packages/desktop/`        | `@opencode-ai/desktop`     | Tauri desktop app shell                                                                    |
| `packages/util/`           | `@opencode-ai/util`        | Shared utilities (error, path, retry, slug, etc.)                                          |
| `packages/plugin/`         | `@novacode/plugin`         | Plugin/tool interface definitions                                                          |

## Style Guide

- Keep things in one function unless composable or reusable
- Avoid unnecessary destructuring. Instead of `const { a, b } = obj`, use `obj.a` and `obj.b` to preserve context
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity

### Avoid let statements

We don't like `let` statements, especially combined with if/else statements.
Prefer `const`.

Good:

```ts
const foo = condition ? 1 : 2
```

Bad:

```ts
let foo

if (condition) foo = 1
else foo = 2
```

### Avoid else statements

Prefer early returns or using an `iife` to avoid else statements.

Good:

```ts
function foo() {
  if (condition) return 1
  return 2
}
```

Bad:

```ts
function foo() {
  if (condition) return 1
  else return 2
}
```

### No empty catch blocks

Never leave a `catch` block empty. An empty `catch` silently swallows errors and hides bugs. If you're tempted to write one, ask yourself:

1. Is the `try`/`catch` even needed? (prefer removing it)
2. Should the error be handled explicitly? (recover, retry, rethrow)
3. At minimum, log it so failures are visible

Good:

```ts
try {
  await save(data)
} catch (err) {
  log.error("save failed", { err })
}
```

Bad:

```ts
try {
  await save(data)
} catch {}
```

### Prefer single word naming

Try your best to find a single word name for your variables, functions, etc.
Only use multiple words if you cannot.

Good:

```ts
const foo = 1
const bar = 2
const baz = 3
```

Bad:

```ts
const fooBar = 1
const barBaz = 2
const bazFoo = 3
```

## Testing

You MUST avoid using `mocks` as much as possible.
Tests MUST test actual implementation, do not duplicate logic into a test.

## Fork Merge Process

Kilo CLI is a fork of [opencode](https://github.com/anomalyco/opencode).

### Minimizing Merge Conflicts

We regularly merge upstream changes from opencode. To minimize merge conflicts and keep the sync process smooth:

1. **Prefer `novacode` directories** - Place Kilo-specific code in dedicated directories whenever possible:
   - `packages/opencode/src/novacode/` - Kilo-specific source code
   - `packages/opencode/test/novacode/` - Kilo-specific tests
   - `packages/nova-gateway/` - The Nova Gateway package

2. **Minimize changes to shared files** - When you must modify files that exist in upstream opencode, keep changes as small and isolated as possible.

3. **Use `novacode_change` markers** - When modifying shared code, mark your changes with `novacode_change` comments so they can be easily identified during merges.
   Do not use these markers in files within directories with kilo in the name

4. **Avoid restructuring upstream code** - Don't refactor or reorganize code that comes from opencode unless absolutely necessary.

The goal is to keep our diff from upstream as small as possible, making regular merges straightforward and reducing the risk of conflicts.

### Novacode Change Markers

To minimize merge conflicts when syncing with upstream, mark Nova Code-specific changes in shared code with `novacode_change` comments.

**Single line:**

```typescript
const value = 42 // novacode_change
```

**Multi-line:**

```typescript
// novacode_change start
const foo = 1
const bar = 2
// novacode_change end
```

**New files:**

```typescript
// novacode_change - new file
```

#### When markers are NOT needed

Code in these paths is Nova Code-specific and does NOT need `novacode_change` markers:

- `packages/opencode/src/novacode/` - All files in this directory
- `packages/opencode/test/novacode/` - All test files for novacode
- Any other path containing `novacode` in filename or directory name

These paths are entirely Nova Code additions and won't conflict with upstream.

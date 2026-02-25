# Dedicated Output Channel

**Priority:** P2
**Status:** ❌ Not started
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## Description

All extension logging uses `console.log("[VCP New] ...")` which goes to the Extension Host output channel mixed with all other extensions. A dedicated "VCP Code" output channel would make logs easier to find and filter.

## Requirements

- Create a `vscode.window.createOutputChannel("VCP Code")` during activation
- Route all `[VCP New]` log messages to this channel
- Keep console.log as a secondary target for debugging
- Optionally support log levels (debug, info, warn, error)
- Dispose the channel on deactivation

## Current State

All debug output uses `console.log("[VCP New] ...")` per the [AGENTS.md](../../AGENTS.md) convention. Users must find extension logs in the "Extension Host" output channel and manually filter for `[VCP New]`.

## Gaps

- No dedicated output channel
- No centralized logging utility
- No log level control
- Hard to filter VCP logs from other extension noise

## Implementation Notes

```typescript
// In extension.ts activate():
const output = vscode.window.createOutputChannel("VCP Code")
context.subscriptions.push(output)

// Utility function:
function log(level: string, message: string): void {
  const timestamp = new Date().toISOString()
  const formatted = `[${timestamp}] [${level}] ${message}`
  output.appendLine(formatted)
  console.log(`[VCP New] ${formatted}`)
}
```

Files to change:

- [`src/extension.ts`](../../src/extension.ts) — create output channel
- New file `src/utils/logger.ts` — centralized logging utility
- All files currently using `console.log("[VCP New] ...")` — optionally migrate


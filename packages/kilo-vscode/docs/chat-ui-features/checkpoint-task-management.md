# Checkpoint & Task Management

Checkpoint restore/navigation and task-level UX actions.

## Location

- Various checkpoint components

## Interactions

- Checkpoint restore dialogs
- Checkpoint navigation menu
- "See New Changes" buttons to view git diffs for completed tasks

## Suggested migration

**Reimplement?** Partial.

- If “checkpoints” are implemented as VCP-side git snapshots, they can remain a VS Code integration owned by the extension host (still valid under the new architecture).
- If you want to align with VCP CLI-native session operations (undo/redo/fork/diff), implement adapter support that maps those VCP CLI session controls into existing VCP UI affordances (or add new controls).
- VCP CLI references: session-level undo/redo/fork appear as first-class concepts in the app UI (see command labels in [`packages/app/src/i18n/en.ts`](https://github.com/DerstedtCasper/vcp-code-2.0/blob/main/packages/app/src/i18n/en.ts:1)) and diff rendering in [`packages/ui/src/components/session-turn.tsx`](https://github.com/DerstedtCasper/vcp-code-2.0/blob/main/packages/ui/src/components/session-turn.tsx:1).


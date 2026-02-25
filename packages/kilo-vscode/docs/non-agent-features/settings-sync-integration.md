# Settings Sync integration

- **What it is**: Registers an allowlist of extension state/settings for VS Code settings sync.

## Suggested migration

- **VCP CLI availability**: Not present.
- **Migration recommendation**:
  - Keep Settings Sync integration in the VS Code extension host (VS Code Settings Sync APIs).
  - Optionally mirror a subset of settings into VCP CLI config, but do not require server support.
- **Reimplementation required?**: Yes.

## Primary implementation anchors

- [`src/services/settings-sync/`](../../src/services/settings-sync/)


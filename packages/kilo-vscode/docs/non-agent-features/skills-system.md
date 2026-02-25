# Skills system

- **What it is**: Discovery and management of local skills (instruction packs) with override and hot reload behavior.

## Suggested migration

- **VCP CLI availability**: Already.
- **Migration recommendation**:
  - Prefer VCP CLI skills as the execution/runtime mechanism.
  - Keep packaging/shipping of VCP-specific skills and any VS Code UI around them in the extension host.
- **Reimplementation required?**: Partial.

## Primary implementation anchors

- [`src/services/skills/`](../../src/services/skills/)


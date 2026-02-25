# Marketplace (installable Modes, MCP servers, Skills)

- **What it is**: A catalog-driven install system for extending VCP Code via remote configs.

## Installs

- Modes (behavior packages).
- MCP servers (tool servers).
- Skills (reusable instruction packs).

## Suggested migration

- **VCP CLI availability**: Not present.
- **Migration recommendation**:
  - Keep the Marketplace feature in the VS Code extension host (install/update UX and IDE integration).
  - Reimplement server-side support only if VCP CLI introduces a marketplace concept later.
- **Reimplementation required?**: Yes.

## Primary implementation anchors

No marketplace service directory exists in the new extension. The marketplace feature needs to be built from scratch.


# Novacode Rules Migration

This document explains how Novacode rules are automatically migrated to Opencode's `instructions` config array.

## Overview

Novacode stores rules in various file locations. When Opencode starts, it reads these files and injects their paths into the `instructions` config array, which Opencode then loads as part of the system prompt.

## Key Guarantees

### 1. Read-Only Migration

The migration **never modifies project files**. We only:

- Read existing rule files from disk
- Inject file paths into the config's `instructions` array
- Never write to the project or modify any files

### 2. Combines with Existing Config (Never Overwrites)

If you have existing opencode config with `instructions`, the Novacode rules are **combined**, not replaced:

```typescript
// Example: User has opencode.json with:
{ "instructions": ["AGENTS.md", "custom-rules.md"] }

// Novacode rules add:
{ "instructions": [".novacoderules", ".novacode/rules/coding.md"] }

// Result (combined, deduplicated):
{ "instructions": ["AGENTS.md", "custom-rules.md", ".novacoderules", ".novacode/rules/coding.md"] }
```

### 3. Restart to Pick Up Changes

If you change your Novacode configuration (e.g., edit `.novacoderules`), simply restart kilo-cli to pick up the new config. No manual migration or conversion needed.

## Source Locations

The migrator reads rules from these locations:

### Project Rules

| Location                      | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| `.novacoderules`              | Legacy single-file rules in project root                 |
| `.novacode/rules/*.md`        | Directory-based rules (multiple markdown files)          |
| `.novacoderules-{mode}`       | Mode-specific legacy rules (e.g., `.novacoderules-code`) |
| `.novacode/rules-{mode}/*.md` | Mode-specific rule directories                           |

### Global Rules

| Location                 | Description            |
| ------------------------ | ---------------------- |
| `~/.novacode/rules/*.md` | Global rules directory |

## File Mapping

| Novacode Location             | Opencode Equivalent                                     |
| ----------------------------- | ------------------------------------------------------- |
| `.novacoderules`              | `instructions: [".novacoderules"]`                      |
| `.novacoderules-{mode}`       | `instructions: [".novacoderules-{mode}"]`               |
| `.novacode/rules/*.md`        | `instructions: [".novacode/rules/file.md", ...]`        |
| `.novacode/rules-{mode}/*.md` | `instructions: [".novacode/rules-{mode}/file.md", ...]` |
| `~/.novacode/rules/*.md`      | `instructions: ["~/.novacode/rules/file.md", ...]`      |

## AGENTS.md Compatibility

`AGENTS.md` is loaded **natively** by Opencode - no migration needed. Opencode automatically loads:

- `AGENTS.md` in project root
- `CLAUDE.md` in project root
- `~/.opencode/AGENTS.md` (global)

## Not Migrated

The following are **not** migrated:

- `.roorules` - Roo-specific rules
- `.clinerules` - Cline-specific rules

Only Novacode-specific files (`.novacoderules`, `.novacode/rules/`) are migrated.

## Mode-Specific Rules

Mode-specific rules (e.g., `.novacoderules-code`, `.novacode/rules-architect/`) are included by default. All mode-specific rules are loaded regardless of the current mode.

## Warnings

The migrator generates warnings for:

- **Legacy files**: When `.novacoderules` is found, a warning suggests migrating to `.novacode/rules/` directory structure

## Example

### Before (Novacode)

```
project/
├── .novacoderules           # Legacy rules
├── .novacoderules-code      # Code-mode specific
└── .novacode/
    └── rules/
        ├── coding.md        # Coding standards
        └── testing.md       # Testing guidelines
```

### After (Opencode Config)

```json
{
  "instructions": [
    "/path/to/project/.novacode/rules/coding.md",
    "/path/to/project/.novacode/rules/testing.md",
    "/path/to/project/.novacoderules",
    "/path/to/project/.novacoderules-code"
  ]
}
```

## Troubleshooting

### Rules not appearing

1. Check the file exists at the expected location
2. Ensure markdown files have `.md` extension
3. Restart kilo-cli to pick up changes

### Duplicate rules

The `mergeConfigConcatArrays` function automatically deduplicates the `instructions` array using `Array.from(new Set([...]))`.

## Related Files

- [`rules-migrator.ts`](../rules-migrator.ts) - Core migration logic
- [`config-injector.ts`](../config-injector.ts) - Config building and injection
- [`modes-migration.md`](./modes-migration.md) - Modes migration documentation

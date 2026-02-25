---
title: "Migrating from Cursor/Windsurf"
description: "Guide for migrating to VCP Code from other AI coding tools"
---

# Migrating from Cursor or Windsurf

Quickly migrate your custom rules from Cursor or Windsurf to VCP Code. The process typically takes just a few minutes per project.

{% callout type="info" title="Two Workflow Approaches"%}

VCP Code supports **two complementary workflows**—choose the one that fits your style, or use both:

1. **Autocomplete (Ghost)**: Tab-to-accept inline suggestions as you type, similar to Cursor and Windsurf. Enable via Settings → Ghost.
2. **Chat-driven**: Describe what you want in the chat panel and the AI generates complete implementations.

Many developers combine both approaches: autocomplete for quick completions while typing, and chat for larger refactors or multi-file changes. See [Choosing Your Workflow](#choosing-your-workflow) for details.

{% /callout %}

## Why VCP Code's Rules System?

VCP Code simplifies AI configuration while adding powerful new capabilities:

- **Simple format**: Plain Markdown files—no YAML frontmatter or GUI configuration required
- **Mode-specific rules**: Different rules for different workflows (Code, Debug, Ask, custom modes)
- **Better version control**: All configuration lives in your repository as readable Markdown
- **More control**: Custom modes let you define specialized workflows with their own rules and permissions

## Quick Migration Guide

Choose your current tool:

- [Migrating from Cursor](#migrating-from-cursor) → Skip to Cursor migration
- [Migrating from Windsurf](#migrating-from-windsurf) → Skip to Windsurf migration

## Migrating from Cursor

### What's Different in VCP Code

| Cursor                                      | VCP Code                                 | Key Difference                              |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| `.cursor/rules/*.mdc` with YAML frontmatter | `.VCPcode/rules/*.md` plain Markdown     | No YAML metadata required                   |
| `alwaysApply: true/false` metadata          | File location determines scope            | Scope controlled by directory structure     |
| `globs: ["*.ts"]` for file patterns         | Mode-specific directories or custom modes | File patterns handled via custom modes      |
| `description` for AI activation             | Clear file names and organization         | Relies on explicit file organization        |
| Global rules in UI settings                 | `~/.VCPcode/rules/*.md` files            | Global rules stored as files in home folder |

### Migration Steps

**1. Identify your rules:**

```bash
ls -la .cursor/rules/        # Project rules
ls -la .cursorrules          # Legacy file (if present)
```

**2. Create VCP Code directory:**

```bash
mkdir -p .VCPcode/rules
```

**3. Convert `.mdc` files to `.md`:**

For each file in `.cursor/rules/`, remove the YAML frontmatter and keep just the Markdown content.

**Cursor format:**

```mdc
---
description: TypeScript coding standards
globs: ["*.ts", "*.tsx"]
alwaysApply: false
---

# TypeScript Standards
- Always use TypeScript for new files
- Prefer functional components in React
```

**VCP Code format:**

```markdown
# TypeScript Standards

- Always use TypeScript for new files
- Prefer functional components in React
```

**4. Migrate in one command:**

```bash
# Copy all files
for file in .cursor/rules/*.mdc; do
  basename="${file##*/}"
  cp "$file" ".VCPcode/rules/${basename%.mdc}.md"
done

# Then manually edit each file to remove YAML frontmatter (the --- section at the top)
```

**5. Migrate global rules:**

- Open `Cursor Settings → General → Rules for AI`
- Copy the text content
- Save to `~/.VCPcode/rules/cursor-global.md`

**6. Handle legacy `.cursorrules`:**

```bash
cp .cursorrules .VCPcode/rules/legacy-rules.md
```

### Converting Cursor's `globs` Patterns

Cursor's `globs` field specifies which files a rule applies to. VCP Code handles this through **mode-specific directories** instead.

**Cursor approach:**

```mdc
---
globs: ["*.ts", "*.tsx"]
---
Rules for TypeScript files...
```

**VCP Code approach (Option 1 - Mode-specific directory):**

```bash
mkdir -p .VCPcode/rules-code
# Save TypeScript-specific rules here
```

**VCP Code approach (Option 2 - Custom mode):**

```yaml
# .VCPcodemodes (at project root)
- slug: typescript
  name: TypeScript
  roleDefinition: You work on TypeScript files
  groups:
    - read
    - [edit, { fileRegex: '\\.tsx?$' }]
    - ask
```

Then place rules in `.VCPcode/rules-typescript/`

### Flattening Nested Cursor Rules

Cursor supports nested `.cursor/rules/` directories. VCP Code uses flat structure with descriptive names:

```bash
# Cursor: .cursor/rules/backend/server/api-rules.mdc
# VCP Code: .VCPcode/rules/backend-server-api-rules.md
```

## Migrating from Windsurf

### What's Different in VCP Code

| Windsurf                                                       | VCP Code                      | Key Difference                              |
| -------------------------------------------------------------- | ------------------------------ | ------------------------------------------- |
| `.windsurf/rules/*.md`                                         | `.VCPcode/rules/*.md`         | Same Markdown format                        |
| GUI configuration for activation modes                         | File location determines scope | Scope controlled by directory structure     |
| "Always On" mode (GUI)                                         | Place in `.VCPcode/rules/`    | Rules stored as files, not GUI settings     |
| "Glob" mode (GUI)                                              | Mode-specific directories      | File patterns handled via mode directories  |
| 12,000 character limit per rule                                | No hard limit                  | No character limit on rule files            |
| Global rules in `~/.codeium/windsurf/memories/global_rules.md` | `~/.VCPcode/rules/*.md`       | Global rules in home folder, multiple files |

### Migration Steps

**1. Identify your rules:**

```bash
ls -la .windsurf/rules/      # Project rules
ls -la .windsurfrules        # Legacy file (if present)
```

**2. Create VCP Code directory:**

```bash
mkdir -p .VCPcode/rules
```

**3. Copy files directly** (already Markdown):

```bash
cp .windsurf/rules/*.md .VCPcode/rules/
```

**4. Migrate global rules:**

```bash
cp ~/.codeium/windsurf/memories/global_rules.md ~/.VCPcode/rules/global-rules.md
```

**5. Handle legacy `.windsurfrules`:**

```bash
cp .windsurfrules .VCPcode/rules/legacy-rules.md
```

**6. Split large rules if needed:**

If you had rules approaching the 12,000 character limit, split them:

```bash
# Instead of one large file:
# .windsurf/rules/all-conventions.md (11,500 chars)

# Split into focused files:
# .VCPcode/rules/api-conventions.md
# .VCPcode/rules/testing-standards.md
# .VCPcode/rules/code-style.md
```

### Converting Windsurf's Activation Modes

Windsurf configures activation through the GUI. In VCP Code, file organization replaces GUI configuration:

| Windsurf GUI Mode        | VCP Code Equivalent                                        |
| ------------------------ | ----------------------------------------------------------- |
| **Always On**            | Place in `.VCPcode/rules/` (default)                       |
| **Glob** (file patterns) | Mode-specific directory or custom mode                      |
| **Model Decision**       | Clear file names by concern (e.g., `testing-guidelines.md`) |
| **Manual**               | Organize with descriptive names                             |

**Example - Converting a Glob rule:**

If you had a rule in Windsurf with Glob mode set to `*.test.ts`, create a custom test mode:

```yaml
# .VCPcodemodes (at project root)
- slug: test
  name: Testing
  roleDefinition: You write and maintain tests
  groups:
    - read
    - [edit, { fileRegex: '\\.(test|spec)\\.(ts|js)$' }]
    - ask
```

Then place the rule in `.VCPcode/rules-test/`

## AGENTS.md Support

All three tools support the `AGENTS.md` standard. If you have one, it works in VCP Code automatically:

```bash
# Verify it exists
ls -la AGENTS.md

# That's it - VCP Code loads it automatically (enabled by default)
```

**Important:** Use uppercase `AGENTS.md` (not `agents.md`). VCP Code also accepts `AGENT.md` (singular) as a fallback.

**Note:** Both `AGENTS.md` and `AGENT.md` are write-protected files in VCP Code and require user approval to modify.

## Understanding Mode-Specific Rules

This is VCP Code's unique feature that replaces both Cursor's `globs` and Windsurf's activation modes.

### Directory Structure

```bash
.VCPcode/rules/              # Apply to ALL modes
.VCPcode/rules-code/         # Only in Code mode
.VCPcode/rules-debug/        # Only in Debug mode
.VCPcode/rules-ask/          # Only in Ask mode
.VCPcode/rules-{custom}/     # Only in your custom mode
```

### Real-World Example

**From Cursor:**

```mdc
---
description: Testing best practices
globs: ["**/*.test.ts", "**/*.spec.ts"]
---
# Testing Rules
- Write tests for all features
- Maintain >80% coverage
```

**To VCP Code:**

```bash
# 1. Create test mode directory
mkdir -p .VCPcode/rules-test

# 2. Save rule as plain Markdown
cat > .VCPcode/rules-test/testing-standards.md << 'EOF'
# Testing Rules
- Write tests for all features
- Maintain >80% coverage
EOF

# 3. Define the mode (optional - creates a custom mode)
# Add to .VCPcode/config.yaml:
# modes:
#   - slug: test
#     name: Test Mode
#     groups: [read, edit, ask]
```

## Post-Migration Checklist

After migration:

- [ ] **Verify rules loaded:** Click law icon (⚖️) in VCP Code panel
- [ ] **Test rule application:** Ask VCP Code to perform tasks following your rules
- [ ] **Organize rules:** Split large files, use clear names
- [ ] **Set up mode-specific rules:** Create directories for specialized workflows
- [ ] **Update team docs:** Document new `.VCPcode/rules/` location
- [ ] **Commit to version control:** `git add .VCPcode/`
- [ ] **Remove old directories:** Delete `.cursor/` or `.windsurf/` folders once verified
- [ ] **Set up autocomplete:** If you used Cursor/Windsurf autocomplete, enable Ghost (Settings → Ghost) for the same Tab-to-accept experience

## Troubleshooting

### Rules Not Appearing

**Check file location:**

```bash
ls -la .VCPcode/rules/      # Project rules
ls -la ~/.VCPcode/rules/    # Global rules
```

**Verify file format:**

- Can be any text file extension (`.md`, `.txt`, etc.) - binary files are automatically filtered out
- Remove all YAML frontmatter from Cursor files
- Ensure files are not cache/temp files (`.cache`, `.tmp`, `.log`, `.bak`, etc.)

**Reload VS Code:**

- `Cmd+R` (Mac) or `Ctrl+R` (Windows/Linux)
- Or: Command Palette → "Developer: Reload Window"

### Cursor Metadata Lost

Cursor's `globs`, `alwaysApply`, and `description` don't transfer automatically. Solutions:

- **For file patterns:** Use mode-specific directories or custom modes
- **For always-on rules:** Place in `.VCPcode/rules/`
- **For context-specific rules:** Use clear file names and organization

### Windsurf Activation Modes Lost

Windsurf's GUI activation modes (Always On/Glob/Model Decision/Manual) aren't stored in files. Solutions:

- **Before migrating:** Document each rule's activation mode
- **After migrating:** Organize files accordingly in VCP Code

### Nested Rules Flattened

Cursor's nested directories don't map to VCP Code. Flatten with descriptive names:

```bash
# Bad: .cursor/rules/backend/api/rules.mdc
# Good: .VCPcode/rules/backend-api-rules.md
```

### AGENTS.md Not Loading

- **Verify filename:** Must be `AGENTS.md` or `AGENT.md` (uppercase)
- **Check location:** Must be at project root
- **Check setting:** Verify "Use Agent Rules" is enabled in VCP Code settings (enabled by default)
- **Reload:** Restart VS Code if needed

### Choosing Your Workflow

VCP Code supports **both autocomplete and chat-driven workflows**. Choose the approach that fits your coding style, or combine them:

**Autocomplete (Ghost) — Tab-to-accept inline suggestions:**

1. Open Settings → Ghost
2. Enable Ghost autocomplete
3. Configure your preferred model for completions
4. Start typing and press Tab to accept suggestions

This works the same way as Cursor and Windsurf's autocomplete. Ghost provides context-aware suggestions as you type.

**Chat-driven — describe what you want:**

- Open the chat panel and describe your intent: "Add error handling to this function" or "Create a React component for user profiles"
- The AI generates complete implementations, refactors, or fixes
- Review and approve changes before they're applied

**Combining both workflows:**

Many developers use both approaches together:

- **Autocomplete** for quick completions while writing new code
- **Chat** for larger refactors, bug fixes, or multi-file changes

There's no "right" workflow—use whatever helps you code faster

## Advanced: Creating Custom Modes

For complex workflows, define custom modes with their own rules and permissions:

```yaml
# .VCPcodemodes (at project root)
- slug: review
  name: Code Review
  roleDefinition: You review code and suggest improvements
  groups:
    - read
    - ask
    # Note: No edit permission - review mode is read-only

- slug: docs
  name: Documentation
  roleDefinition: You write and maintain documentation
  groups:
    - read
    - [edit, { fileRegex: '\\.md$', description: "Markdown files only" }]
    - ask
```

Then create corresponding rule directories:

```bash
mkdir -p .VCPcode/rules-review
mkdir -p .VCPcode/rules-docs
```

**Note:** `.VCPcodemodes` can be in YAML (preferred) or JSON format. For global modes, edit the `custom_modes.yaml` file via Settings > Edit Global Modes.

## Next Steps

- [Learn about Custom Rules](/docs/customize/custom-rules)
- [Explore Custom Modes](/docs/customize/custom-modes)
- [Set up Custom Instructions](/docs/customize/custom-instructions)
- [Join our Discord](https://github.com/DerstedtCasper/vcp-code-2.0/discussions) for migration support

## Additional Resources

### Community Examples

**Cursor users:**

- [awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) - 700+ examples you can adapt

**Windsurf users:**

- [Official Rules Directory](https://windsurf.com/editor/directory)
- [windsurfrules](https://github.com/kinopeee/windsurfrules)

**Cross-tool:**

- [AGENTS.md Specification](https://agents.md)
- [dotagent](https://github.com/johnlindquist/dotagent) - Universal converter tool



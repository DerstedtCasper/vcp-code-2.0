---
title: ".novacodeignore"
description: "Control which files Nova Code can access"
---

# .novacodeignore

## Overview

`.novacodeignore` is a root-level file that tells Nova Code which files and folders it should not access. It uses standard `.gitignore` pattern syntax, but it only affects Nova Code's file access, not Git.

If no `.novacodeignore` file exists, Nova Code can access all files in the workspace.

## Quick Start

1. Create a `.novacodeignore` file at the root of your project.
2. Add patterns for files or folders you want Nova Code to avoid.
3. Save the file. Nova Code will pick up the changes automatically.

Example:

```txt
# Secrets
.env
secrets/
**/*.pem
**/*.key

# Build output
dist/
coverage/

# Allow a specific file inside a blocked folder
!secrets/README.md
```

## Pattern Rules

`.novacodeignore` follows the same rules as `.gitignore`:

- `#` starts a comment
- `*` and `**` match wildcards
- Trailing `/` matches directories only
- `!` negates a previous rule

Patterns are evaluated relative to the workspace root.

## What It Affects

Nova Code checks `.novacodeignore` before accessing files in tools like:

- [`read_file`](/docs/automate/tools/read-file)
- [`write_to_file`](/docs/automate/tools/write-to-file)
- [`apply_diff`](/docs/automate/tools/apply-diff)
- [`delete_file`](/docs/automate/tools/delete-file)
- [`execute_command`](/docs/automate/tools/execute-command)
- [`list_files`](/docs/automate/tools/list-files)

If a file is blocked, Nova Code will return an "access denied" message and suggest updating your `.novacodeignore` rules.

## Visibility in Lists

By default, ignored files are hidden from file lists. You can show them with a lock icon by enabling:

Settings -> Context -> **Show .novacodeignore'd files in lists and searches**

## Checkpoints vs .novacodeignore

Checkpoint tracking is separate from file access rules. Files blocked by `.novacodeignore` can still be checkpointed if they are not excluded by `.gitignore`. See the [Checkpoints](/docs/code-with-ai/features/checkpoints) documentation for details.

## Troubleshooting

- **Kilo can't access a file you want:** Remove or narrow the matching rule in `.novacodeignore`.
- **A file still appears in lists:** Check the setting that shows ignored files in lists and searches.

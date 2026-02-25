---
title: ".VCPcodeignore"
description: "Control which files VCP Code can access"
---

# .VCPcodeignore

## Overview

`.VCPcodeignore` is a root-level file that tells VCP Code which files and folders it should not access. It uses standard `.gitignore` pattern syntax, but it only affects VCP Code's file access, not Git.

If no `.VCPcodeignore` file exists, VCP Code can access all files in the workspace.

## Quick Start

1. Create a `.VCPcodeignore` file at the root of your project.
2. Add patterns for files or folders you want VCP Code to avoid.
3. Save the file. VCP Code will pick up the changes automatically.

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

`.VCPcodeignore` follows the same rules as `.gitignore`:

- `#` starts a comment
- `*` and `**` match wildcards
- Trailing `/` matches directories only
- `!` negates a previous rule

Patterns are evaluated relative to the workspace root.

## What It Affects

VCP Code checks `.VCPcodeignore` before accessing files in tools like:

- [`read_file`](/docs/automate/tools/read-file)
- [`write_to_file`](/docs/automate/tools/write-to-file)
- [`apply_diff`](/docs/automate/tools/apply-diff)
- [`delete_file`](/docs/automate/tools/delete-file)
- [`execute_command`](/docs/automate/tools/execute-command)
- [`list_files`](/docs/automate/tools/list-files)

If a file is blocked, VCP Code will return an "access denied" message and suggest updating your `.VCPcodeignore` rules.

## Visibility in Lists

By default, ignored files are hidden from file lists. You can show them with a lock icon by enabling:

Settings -> Context -> **Show .VCPcodeignore'd files in lists and searches**

## Checkpoints vs .VCPcodeignore

Checkpoint tracking is separate from file access rules. Files blocked by `.VCPcodeignore` can still be checkpointed if they are not excluded by `.gitignore`. See the [Checkpoints](/docs/code-with-ai/features/checkpoints) documentation for details.

## Troubleshooting

- **VCP can't access a file you want:** Remove or narrow the matching rule in `.VCPcodeignore`.
- **A file still appears in lists:** Check the setting that shows ignored files in lists and searches.



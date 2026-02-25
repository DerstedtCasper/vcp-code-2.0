---
title: "GitHub Code Reviews"
description: "Set up automated AI code reviews on GitHub pull requests"
---

# GitHub Code Reviews

VCP's Code Reviews integrate with GitHub via a **GitHub App** to automatically review pull requests with AI. When a PR is opened, updated, or marked ready for review, the Review Agent analyzes the changes and posts feedback directly on the pull request.

## Prerequisites

- A VCP Code account at [app.VCP.ai](https://github.com/DerstedtCasper/vcp-code-2.0)
- A GitHub account with access to the repositories you want to review
- VCP Code credits for AI model usage

## Setup

### Step 1: Install the GitHub App

1. Go to the **Integrations** page:
   - **Personal**: [app.VCP.ai/integrations/github](https://github.com/DerstedtCasper/vcp-code-2.0/integrations/github)
   - **Organization**: Your organization → Integrations → GitHub
2. Click **Install GitHub App**
3. Choose which GitHub account or organization to install the app on
4. Select repository access:
   - **All repositories** — the app can access all current and future repos
   - **Only select repositories** — choose specific repos
5. Click **Install**

The GitHub App requests the following permissions:

| Permission          | Access       | Purpose                          |
| ------------------- | ------------ | -------------------------------- |
| Pull requests       | Read & Write | Post review comments             |
| Repository contents | Read         | Analyze code                     |
| Issues              | Read & Write | Post summary comments, reactions |
| Metadata            | Read         | List repositories                |

### Step 2: Configure the Review Agent

1. Go to **Code Reviews**:
   - **Personal**: [app.VCP.ai/code-reviews](https://github.com/DerstedtCasper/vcp-code-2.0/code-reviews)
   - **Organization**: Your organization → Code Reviews
2. Toggle **Enable AI Code Review** to on
3. Configure your preferences:
   - **AI Model** — Select from available models (default: Claude Sonnet 4.5)
   - **Review Style** — Strict, Balanced, or Lenient
   - **Repository Selection** — All repositories or select specific ones
   - **Focus Areas** — Security, performance, bugs, style, testing, documentation
   - **Max Review Time** — 5 to 30 minutes
   - **Custom Instructions** — Add team-specific review guidelines
4. Click **Save Configuration**

### Step 3: Open a Pull Request

Once configured, the Review Agent automatically runs when:

| PR Event                 | Triggers Review |
| ------------------------ | --------------- |
| PR opened                | ✅ Yes          |
| New commits pushed to PR | ✅ Yes          |
| PR reopened              | ✅ Yes          |
| Draft PR marked ready    | ✅ Yes          |
| Draft PR opened          | ❌ Skipped      |
| PR closed                | ❌ No           |

## What to Expect

When a review triggers:

1. A 👀 reaction appears on the PR — this means VCP is reviewing
2. The AI model analyzes the diff and changed files
3. The agent posts:
   - A **summary comment** with overall findings
   - **Inline comments** on specific lines with issues and suggestions
   - Severity tags (critical, warning, info)

### When You Push New Commits

- The previous review is **automatically cancelled** (no stale feedback)
- A new review starts for the latest commit
- If a previous summary comment exists, it is **updated in place**

## Repository Selection

- **All repositories** — Every repo accessible to the GitHub App triggers reviews
- **Selected repositories** — Only repos you choose in the configuration

The repository list is synced from GitHub and can be refreshed from the configuration page.

## Troubleshooting

### Reviews are not triggering

1. Verify the GitHub App is installed and has access to the repository
2. Check that the Review Agent is **enabled** in the Code Reviews configuration
3. Ensure the repository is in the allowed list (if using "Selected repositories" mode)
4. Confirm the PR is not a draft

### Reviews are failing

- Check the Code Reviews page for error details on specific reviews
- Ensure you have sufficient VCP Code credits
- Very large PRs may time out — try increasing the max review time

### The GitHub App is missing permissions

1. Go to your GitHub Settings → Applications → VCPConnect → Configure
2. Verify the app has the required permissions listed above
3. If permissions were changed, you may need to re-authorize

### Duplicate comments

The system automatically deduplicates reviews for the same PR and commit SHA. If you see duplicate comments, this may be from a previous version — push a new commit to trigger a fresh review.



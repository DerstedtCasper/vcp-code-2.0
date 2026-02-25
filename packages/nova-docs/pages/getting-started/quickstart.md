---
title: "Quickstart"
description: "Get up and running with Nova Code in minutes"
---

# Quickstart

## Video Tour

{% youtube url="https://www.youtube.com/watch?v=pO7zRLQS-p0" caption="This quick tour shows how Nova Code handles a simple request from start to finish" /%}

After you [set up Nova Code](/docs/getting-started/setup-authentication), follow these steps:

## Step by Step Guide

### Step 1: Open Nova Code

Click the Nova Code icon ({% kiloCodeIcon /%}) in the VS Code Primary Side Bar (vertical bar on the side of the window) to open the chat interface. If you don't see the icon, verify the extension is [installed](/docs/getting-started/installing) and enabled.

{% image src="/docs/img/your-first-task/your-first-task.png" alt="Nova Code icon in VS Code Primary Side Bar" width="800" caption="The Nova Code icon in the Primary Side Bar opens the chat interface." /%}

### Step 2: Type Your Task

Type a clear, concise description of what you want Nova Code to do in the chat box at the bottom of the panel. Examples of effective tasks:

- "Create a file named `hello.txt` containing 'Hello, world!'."
- "Write a Python function that adds two numbers."
- "Create an HTML file for a simple website with the title 'Kilo test'"

No special commands or syntax needed—just use plain English.

{% callout type="tip" title="Optional: Try Autocomplete" collapsed=true %}
While chat is great for complex tasks, Nova Code also offers **inline autocomplete** for quick code suggestions. Open any code file, start typing, and watch for ghost text suggestions. Press `Tab` to accept. [Learn more about Autocomplete →](/docs/code-with-ai/features/autocomplete)
{% /callout %}

{% image src="/docs/img/your-first-task/your-first-task-6.png" alt="Typing a task in the Nova Code chat interface" width="500" caption="Enter your task in natural language - no special syntax required." /%}

### Step 3: Send Your Task

Press Enter or click the Send icon ({% codicon name="send" /%}) to the right of the input box.

### Step 4: Review & Approve Actions

Nova Code analyzes your request and proposes specific actions. These may include:

- **Reading files:** Shows file contents it needs to access
- **Writing to files:** Displays a diff with proposed changes (added lines in green, removed in red)
- **Executing commands:** Shows the exact command to run in your terminal
- **Using the Browser:** Outlines browser actions (click, type, etc.)
- **Asking questions:** Requests clarification when needed to proceed

{% image src="/docs/img/your-first-task/your-first-task-7.png" alt="Reviewing a proposed file creation action" width="400" caption="Nova Code shows exactly what action it wants to perform and waits for your approval." /%}

- In **Code** mode, writing capabilities are on by default.
- In **Architect** and **Ask** modes, Nova Code won't write code.

{% callout type="tip" %}
The level of autonomy is configurable, allowing you to make the agent more or less autonomous.

You can learn more about [using modes](/docs/code-with-ai/agents/using-modes) and [auto-approving actions](/docs/getting-started/settings/auto-approving-actions).
{% /callout %}

### Step 5: Iterate

Nova Code works iteratively. After each action, it waits for your feedback before proposing the next step. Continue this review-approve cycle until your task is complete.

{% image src="/docs/img/your-first-task/your-first-task-8.png" alt="Final result of a completed task showing the iteration process" width="500" caption="After completing the task, Nova Code shows the final result and awaits your next instruction." /%}

## Conclusion

You've completed your first task. Along the way you learned:

- How to interact with Nova Code using natural language
- Why approval keeps you in control
- How iteration lets the AI refine its work

Ready for more? Here are some next steps:

- **[Autocomplete](/docs/code-with-ai/features/autocomplete)** — Get inline code suggestions as you type
- **[Modes](/docs/code-with-ai/agents/using-modes)** — Explore different modes for different tasks
- **[Git commit generation](/docs/code-with-ai/features/git-commit-generation)** — Automatically generate commit messages

{% callout type="tip" %}
**Accelerate development:** Check out multiple copies of your repository and run Nova Code on all of them in parallel (using git to resolve any conflicts, same as with human devs). This can dramatically speed up development on large projects.
{% /callout %}

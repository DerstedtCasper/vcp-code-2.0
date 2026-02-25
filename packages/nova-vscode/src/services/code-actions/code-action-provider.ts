import * as vscode from "vscode"

export class NovaCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (range.isEmpty) return []

    const actions: vscode.CodeAction[] = []

    const add = new vscode.CodeAction("Add to VCP Code 2.0", vscode.CodeActionKind.RefactorRewrite)
    add.command = { command: "vcp-code.new.addToContext", title: "Add to VCP Code 2.0" }
    actions.push(add)

    const hasDiagnostics = context.diagnostics.length > 0

    if (hasDiagnostics) {
      const fix = new vscode.CodeAction("Fix with VCP Code 2.0", vscode.CodeActionKind.QuickFix)
      fix.command = { command: "vcp-code.new.fixCode", title: "Fix with VCP Code 2.0" }
      fix.isPreferred = true
      actions.push(fix)
    }

    if (!hasDiagnostics) {
      const explain = new vscode.CodeAction("Explain with VCP Code 2.0", vscode.CodeActionKind.RefactorRewrite)
      explain.command = { command: "vcp-code.new.explainCode", title: "Explain with VCP Code 2.0" }
      actions.push(explain)

      const improve = new vscode.CodeAction("Improve with VCP Code 2.0", vscode.CodeActionKind.RefactorRewrite)
      improve.command = { command: "vcp-code.new.improveCode", title: "Improve with VCP Code 2.0" }
      actions.push(improve)
    }

    return actions
  }
}

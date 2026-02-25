import { describe, it, expect, mock } from "bun:test"

const makeAction = (title: string, kind: string) => ({ title, kind })
const makeKind = (value: string) => ({
  value,
  append: (v: string) => makeKind(`${value}.${v}`),
})

const QuickFix = makeKind("quickfix")
const RefactorRewrite = makeKind("refactor.rewrite")

const mockVscode = {
  CodeAction: class {
    command?: { command: string; title: string }
    isPreferred?: boolean
    constructor(
      public title: string,
      public kind: { value: string },
    ) {}
  },
  CodeActionKind: {
    QuickFix,
    RefactorRewrite,
  },
}

mock.module("vscode", () => mockVscode)

const { NovaCodeActionProvider } = await import("../../src/services/code-actions/code-action-provider")

const provider = new NovaCodeActionProvider()

function makeRange(isEmpty: boolean) {
  return { isEmpty }
}

function makeContext(diagnosticCount: number) {
  return { diagnostics: Array.from({ length: diagnosticCount }) }
}

describe("NovaCodeActionProvider", () => {
  describe("provideCodeActions", () => {
    it("returns empty array when range is empty", () => {
      const result = provider.provideCodeActions({} as never, makeRange(true) as never, makeContext(0) as never)
      expect(result).toEqual([])
    })

    it("returns empty array when range is empty even with diagnostics", () => {
      const result = provider.provideCodeActions({} as never, makeRange(true) as never, makeContext(3) as never)
      expect(result).toEqual([])
    })

    describe("non-empty range, no diagnostics", () => {
      it("returns Add, Explain, Improve actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        const titles = result.map((a) => a.title)
        expect(titles).toContain("Add to VCP Code 2.0")
        expect(titles).toContain("Explain with VCP Code 2.0")
        expect(titles).toContain("Improve with VCP Code 2.0")
      })

      it("does not include Fix action", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        expect(result.map((a) => a.title)).not.toContain("Fix with VCP Code 2.0")
      })

      it("returns exactly 3 actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        expect(result).toHaveLength(3)
      })

      it("uses correct command IDs", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        const commands = result.map((a) => a.command?.command)
        expect(commands).toContain("vcp-code.new.addToContext")
        expect(commands).toContain("vcp-code.new.explainCode")
        expect(commands).toContain("vcp-code.new.improveCode")
      })

      it("no action is preferred", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        expect(result.every((a) => !a.isPreferred)).toBe(true)
      })
    })

    describe("non-empty range, with diagnostics", () => {
      it("returns Add and Fix actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(2) as never)
        const titles = result.map((a) => a.title)
        expect(titles).toContain("Add to VCP Code 2.0")
        expect(titles).toContain("Fix with VCP Code 2.0")
      })

      it("does not include Explain or Improve actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        const titles = result.map((a) => a.title)
        expect(titles).not.toContain("Explain with VCP Code 2.0")
        expect(titles).not.toContain("Improve with VCP Code 2.0")
      })

      it("returns exactly 2 actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        expect(result).toHaveLength(2)
      })

      it("Fix action is preferred", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        const fix = result.find((a) => a.title === "Fix with VCP Code 2.0")
        expect(fix?.isPreferred).toBe(true)
      })

      it("Fix action uses QuickFix kind", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        const fix = result.find((a) => a.title === "Fix with VCP Code 2.0")
        expect(fix?.kind.value).toBe("quickfix")
      })

      it("uses correct Fix command ID", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        const fix = result.find((a) => a.title === "Fix with VCP Code 2.0")
        expect(fix?.command?.command).toBe("vcp-code.new.fixCode")
      })
    })
  })
})

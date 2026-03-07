import React, { memo, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import styled from "styled-components"
import { visit } from "unist-util-visit"
import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkMath from "remark-math"
import remarkGfm from "remark-gfm"

import { vscode } from "@src/utils/vscode"

import CodeBlock from "../nova/common/CodeBlock" // novacode_change
import MermaidBlock from "./MermaidBlock"
import RichContentBlock from "./RichContentBlock"

interface MarkdownBlockProps {
	markdown?: string
	htmlEnabled?: boolean
}

type RichContentLanguage = "html" | "javascript" | "css" | "python"

const MARKDOWN_FENCE_LANGUAGES = new Set(["markdown", "md", "mdx"])
const LATEX_FENCE_LANGUAGES = new Set(["latex", "tex", "math", "katex"])

const STANDALONE_RICH_BLOCK_PATTERN =
	/^\s*(?:<!doctype html\b|<html\b|<body\b|<head\b|<div\b|<section\b|<article\b|<main\b|<style\b|<script\b|<canvas\b|<svg\b)/i

const looksLikeStandaloneRichBlock = (markdown: string, htmlEnabled: boolean) =>
	htmlEnabled && !markdown.includes("```") && STANDALONE_RICH_BLOCK_PATTERN.test(markdown.trim())

const looksLikeRichJavaScript = (source: string) =>
	/\b(?:THREE|anime|requestAnimationFrame|document|window|HTMLElement|customElements|canvas)\b/.test(source) ||
	/\bvcp-root\b/.test(source)

const getRichContentLanguage = (language: string, source: string): RichContentLanguage | undefined => {
	switch (language) {
		case "html":
		case "htm":
			return "html"
		case "css":
			return "css"
		case "python":
		case "py":
			return "python"
		case "javascript":
		case "js":
		case "jsx":
		case "typescript":
		case "ts":
		case "tsx":
		case "threejs":
			return looksLikeRichJavaScript(source) ? "javascript" : undefined
		default:
			return language === "text" && STANDALONE_RICH_BLOCK_PATTERN.test(source.trim()) ? "html" : undefined
	}
}

const formatMathSnippet = (source: string) => {
	const trimmed = source.trim()
	if (!trimmed) {
		return "$$\\text{ }$$"
	}

	if (/^\$\$[\s\S]*\$\$$/.test(trimmed) || /^\\\[[\s\S]*\\\]$/.test(trimmed)) {
		return trimmed
	}

	return `$$\n${trimmed}\n$$`
}

const VCP_HTML_SCHEMA = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary", "div", "span", "img", "section", "article"],
	attributes: {
		...(defaultSchema.attributes ?? {}),
		div: [...(defaultSchema.attributes?.div ?? []), "className", "style"],
		span: [...(defaultSchema.attributes?.span ?? []), "className", "style"],
		img: [...(defaultSchema.attributes?.img ?? []), "style", "loading"],
		details: [...(defaultSchema.attributes?.details ?? []), "open"],
		summary: [...(defaultSchema.attributes?.summary ?? []), "style"],
		section: [...(defaultSchema.attributes?.section ?? []), "style"],
		article: [...(defaultSchema.attributes?.article ?? []), "style"],
		"*": [...(defaultSchema.attributes?.["*"] ?? []), "style", "className"],
	},
} as const

const StyledMarkdown = styled.div`
	* {
		font-weight: 400;
	}

	strong {
		font-weight: 600;
	}

	code:not(pre > code) {
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 0.85em;
		filter: saturation(110%) brightness(95%);
		color: var(--vscode-textPreformat-foreground) !important;
		background-color: var(--vscode-textPreformat-background) !important;
		padding: 1px 2px;
		white-space: pre-line;
		word-break: break-word;
		overflow-wrap: anywhere;
	}

	/* Target only high-contrast theme(s) using the data attribute VS Code adds to the body */
	body[data-vscode-theme-kind*="high-contrast"] & code:not(pre > code) {
		color: var(
			--vscode-editorInlayHint-foreground,
			var(--vscode-symbolIcon-stringForeground, var(--vscode-charts-orange, #e9a700))
		);
	}

	/* KaTeX styling */
	.katex {
		font-size: 1.1em;
		color: var(--vscode-editor-foreground);
		font-family: KaTeX_Main, "Times New Roman", serif;
		line-height: 1.2;
		white-space: normal;
		text-indent: 0;
	}

	.katex-display {
		display: block;
		margin: 1em 0;
		text-align: center;
		padding: 0.5em;
		overflow-x: auto;
		overflow-y: hidden;
		background-color: var(--vscode-textCodeBlock-background);
		border-radius: 3px;
	}

	.katex-error {
		color: var(--vscode-errorForeground);
	}

	font-family:
		var(--vscode-font-family),
		system-ui,
		-apple-system,
		BlinkMacSystemFont,
		"Segoe UI",
		Roboto,
		Oxygen,
		Ubuntu,
		Cantarell,
		"Open Sans",
		"Helvetica Neue",
		sans-serif;

	font-size: var(--vscode-font-size, 13px);

	p,
	li,
	ol,
	ul {
		line-height: 1.35em;
	}

	li {
		margin: 0.5em 0;
	}

	ol,
	ul {
		padding-left: 2em;
		margin-left: 0;
	}

	ol {
		list-style-type: decimal;
	}

	ul {
		list-style-type: disc;
	}

	ol ol {
		list-style-type: lower-alpha;
	}

	ol ol ol {
		list-style-type: lower-roman;
	}

	p {
		white-space: pre-wrap;
		margin: 1em 0 0.25em;
	}

	/* Prevent layout shifts during streaming */
	pre {
		min-height: 3em;
		transition: height 0.2s ease-out;
	}

	/* Code block container styling */
	div:has(> pre) {
		position: relative;
		contain: layout style;
		padding: 0.5em 1em;
	}

	a {
		color: var(--vscode-textLink-foreground);
		text-decoration: none;
		text-decoration-color: var(--vscode-textLink-foreground);
		&:hover {
			color: var(--vscode-textLink-activeForeground);
			text-decoration: underline;
		}
	}

	h1 {
		font-size: 1.65em;
		font-weight: 700;
		margin: 1.35em 0 0.5em;
	}

	h2 {
		font-size: 1.35em;
		font-weight: 500;
		margin: 1.35em 0 0.5em;
	}

	h3 {
		font-size: 1.2em;
		font-weight: 500;
	}

	/* Table styles for remark-gfm */
	table {
		border-collapse: collapse;
		margin: 1em 0;
		width: auto;
		min-width: 50%;
		max-width: 100%;
		table-layout: fixed;
	}

	/* Table wrapper for horizontal scrolling */
	.table-wrapper {
		overflow-x: auto;
		margin: 1em 0;
	}

	th,
	td {
		border: 1px solid var(--vscode-panel-border);
		padding: 8px 12px;
		text-align: left;
		word-wrap: break-word;
		overflow-wrap: break-word;
	}

	th {
		background-color: var(--vscode-editor-background);
		font-weight: 600;
		color: var(--vscode-foreground);
	}

	tr:nth-child(even) {
		background-color: var(--vscode-editor-inactiveSelectionBackground);
	}

	tr:hover {
		background-color: var(--vscode-list-hoverBackground);
	}
`

const MarkdownBlock = memo(({ markdown, htmlEnabled = false }: MarkdownBlockProps) => {
	const standaloneRichBlock = markdown ? looksLikeStandaloneRichBlock(markdown, htmlEnabled) : false

	const components = useMemo(
		() => ({
			table: ({ children, ...props }: any) => {
				return (
					<div className="table-wrapper">
						<table {...props}>{children}</table>
					</div>
				)
			},
			a: ({ href, children, ...props }: any) => {
				const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
					// Only process file:// protocol or local file paths
					const isLocalPath = href?.startsWith("file://") || href?.startsWith("/") || !href?.includes("://")

					if (!isLocalPath) {
						return
					}

					e.preventDefault()

					// Handle absolute vs project-relative paths
					let filePath = href.replace("file://", "")

					// Extract line number if present
					const match = filePath.match(/(.*):(\d+)(-\d+)?$/)
					let values = undefined
					if (match) {
						filePath = match[1]
						values = { line: parseInt(match[2]) }
					}

					// Add ./ prefix if needed
					if (!filePath.startsWith("/") && !filePath.startsWith("./")) {
						filePath = "./" + filePath
					}

					vscode.postMessage({
						type: "openFile",
						text: filePath,
						values,
					})
				}

				return (
					<a {...props} href={href} onClick={handleClick}>
						{children}
					</a>
				)
			},
			pre: ({ children, ..._props }: any) => {
				// The structure from react-markdown v9 is: pre > code > text
				const codeEl = children as React.ReactElement

				if (!codeEl || !codeEl.props) {
					return <pre>{children}</pre>
				}

				const { className = "", children: codeChildren } = codeEl.props

				// Get the actual code text
				let codeString = ""
				if (typeof codeChildren === "string") {
					codeString = codeChildren
				} else if (Array.isArray(codeChildren)) {
					codeString = codeChildren.filter((child) => typeof child === "string").join("")
				}

				// Handle mermaid diagrams
				if (className.includes("language-mermaid")) {
					return (
						<div style={{ margin: "1em 0" }}>
							<MermaidBlock code={codeString} />
						</div>
					)
				}

				// Extract language from className
				const match = /language-(\w+)/.exec(className)
				const language = (match ? match[1] : "text").toLowerCase()
				const richLanguage = htmlEnabled ? getRichContentLanguage(language, codeString) : undefined

				if (richLanguage) {
					return <RichContentBlock source={codeString} language={richLanguage} />
				}

				if (MARKDOWN_FENCE_LANGUAGES.has(language)) {
					return (
						<div style={{ margin: "1em 0" }} data-testid="rendered-markdown-snippet">
							<MarkdownBlock markdown={codeString} htmlEnabled={htmlEnabled} />
						</div>
					)
				}

				if (LATEX_FENCE_LANGUAGES.has(language)) {
					return (
						<div
							style={{
								margin: "1em 0",
								padding: "0.75em 1em",
								borderRadius: "8px",
								background: "var(--vscode-textCodeBlock-background)",
								overflowX: "auto",
							}}
							data-testid="rendered-latex-snippet">
							<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex as any]}>
								{formatMathSnippet(codeString)}
							</ReactMarkdown>
						</div>
					)
				}

				// Wrap CodeBlock in a div to ensure proper separation
				return (
					<div style={{ margin: "1em 0" }}>
						<CodeBlock source={codeString} language={language} />
					</div>
				)
			},
			code: ({ children, className, ...props }: any) => {
				// This handles inline code
				return (
					<code className={className} {...props}>
						{children}
					</code>
				)
			},
		}),
		[htmlEnabled],
	)

	if (markdown && standaloneRichBlock) {
		return (
			<StyledMarkdown>
				<RichContentBlock source={markdown} language="html" standalone />
			</StyledMarkdown>
		)
	}

	return (
		<StyledMarkdown>
			<ReactMarkdown
				remarkPlugins={[
					remarkGfm,
					remarkMath,
					() => {
						return (tree: any) => {
							visit(tree, "code", (node: any) => {
								if (!node.lang) {
									node.lang = "text"
								} else if (node.lang.includes(".")) {
									node.lang = node.lang.split(".").slice(-1)[0]
								}
							})
						}
					},
				]}
				rehypePlugins={
					htmlEnabled
						? [rehypeKatex as any, rehypeRaw as any, [rehypeSanitize, VCP_HTML_SCHEMA] as any]
						: [rehypeKatex as any]
				}
				components={components}>
				{markdown || ""}
			</ReactMarkdown>
		</StyledMarkdown>
	)
})

export default MarkdownBlock

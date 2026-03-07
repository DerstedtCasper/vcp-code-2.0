import { memo, useEffect, useMemo, useState } from "react"
import styled from "styled-components"

import CodeBlock from "../nova/common/CodeBlock"

type RichContentLanguage = "html" | "javascript" | "css" | "python"

interface RichContentBlockProps {
	source: string
	language: RichContentLanguage
	standalone?: boolean
}

const PreviewWrapper = styled.div`
	margin: 1em 0;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 8px;
	overflow: hidden;
	background: var(--vscode-editor-background);
`

const PreviewHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--vscode-panel-border);
	background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-focusBorder) 18%);
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
`

const PreviewFrame = styled.iframe<{ $height: number }>`
	width: 100%;
	height: ${({ $height }) => `${$height}px`};
	border: none;
	background: white;
`

const SourceToggle = styled.details`
	border-top: 1px solid var(--vscode-panel-border);
	background: var(--vscode-editor-background);

	summary {
		cursor: pointer;
		list-style: none;
		padding: 10px 12px;
		font-size: 12px;
		color: var(--vscode-descriptionForeground);
		user-select: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}
`

const DEFAULT_SAMPLE_HTML = `
<div id="vcp-root">
	<section class="vcp-preview-shell">
		<h1>VCP Rich Preview</h1>
		<p>This content is running through the rich rendering channel.</p>
		<button type="button">Action</button>
	</section>
</div>
`

const ANIME_JS_CDN = "https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js"
const THREE_JS_CDN = "https://unpkg.com/three@0.160.0/build/three.min.js"
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/"
const PYODIDE_MODULE_URL = `${PYODIDE_INDEX_URL}pyodide.mjs`

const isFullHtmlDocument = (source: string) => /^\s*(<!doctype html\b|<html\b)/i.test(source)

const buildCspMeta = () =>
	`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; media-src https: http: data: blob:; style-src 'unsafe-inline' https: http: data: blob:; font-src https: http: data: blob:; script-src 'unsafe-inline' 'unsafe-eval' https: http: data: blob:; connect-src https: http: ws: wss: data: blob:;">`

const injectHead = (html: string, headContent: string) => {
	if (/<head[\s>]/i.test(html)) {
		return html.replace(/<head([^>]*)>/i, `<head$1>${headContent}`)
	}

	if (/<html[\s>]/i.test(html)) {
		return html.replace(/<html([^>]*)>/i, `<html$1><head>${headContent}</head>`)
	}

	return `<!DOCTYPE html><html><head>${headContent}</head><body>${html}</body></html>`
}

const getThemeValues = () => {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return {
			background: "#1e1e1e",
			foreground: "#d4d4d4",
			border: "#3c3c3c",
			button: "#0e639c",
			buttonText: "#ffffff",
		}
	}

	const styles = getComputedStyle(document.body)

	return {
		background: styles.getPropertyValue("--vscode-editor-background").trim() || "#1e1e1e",
		foreground: styles.getPropertyValue("--vscode-editor-foreground").trim() || "#d4d4d4",
		border: styles.getPropertyValue("--vscode-panel-border").trim() || "#3c3c3c",
		button: styles.getPropertyValue("--vscode-button-background").trim() || "#0e639c",
		buttonText: styles.getPropertyValue("--vscode-button-foreground").trim() || "#ffffff",
	}
}

const buildBaseHead = (theme: ReturnType<typeof getThemeValues>) => `
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	${buildCspMeta()}
	<style>
		:root {
			color-scheme: light dark;
			font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		}
		html, body {
			margin: 0;
			padding: 0;
			min-height: 100%;
			background: ${theme.background};
			color: ${theme.foreground};
		}
		body {
			padding: 16px;
			box-sizing: border-box;
		}
		#vcp-root {
			min-height: 180px;
		}
		.vcp-preview-shell {
			display: grid;
			gap: 12px;
			padding: 20px;
			border: 1px solid ${theme.border};
			border-radius: 16px;
			background: color-mix(in srgb, ${theme.background} 86%, white 14%);
		}
		.vcp-preview-shell h1,
		.vcp-preview-shell p {
			margin: 0;
		}
		.vcp-preview-shell button {
			width: fit-content;
			padding: 8px 14px;
			border: none;
			border-radius: 999px;
			background: ${theme.button};
			color: ${theme.buttonText};
			cursor: pointer;
		}
		pre#py-output {
			margin: 0;
			padding: 16px;
			border-radius: 12px;
			border: 1px solid ${theme.border};
			background: color-mix(in srgb, ${theme.background} 92%, black 8%);
			white-space: pre-wrap;
			word-break: break-word;
			font-family: var(--vscode-editor-font-family, "Cascadia Code", Consolas, monospace);
			font-size: 13px;
			line-height: 1.5;
		}
	</style>
	<script src="${ANIME_JS_CDN}"></script>
	<script src="${THREE_JS_CDN}"></script>
	<script>
		window.addEventListener("error", (event) => {
			const output = document.getElementById("py-output")
			if (output) {
				output.textContent = String(event.error?.stack || event.message || event.error || "Unknown render error")
			}
		})
		window.addEventListener("unhandledrejection", (event) => {
			const output = document.getElementById("py-output")
			if (output) {
				output.textContent = String(
					event.reason?.stack || event.reason?.message || event.reason || "Unhandled promise rejection",
				)
			}
		})
	</script>
`

const buildPreviewDocument = (source: string, language: RichContentLanguage) => {
	const theme = getThemeValues()
	const head = buildBaseHead(theme)

	if (language === "python") {
		return `<!DOCTYPE html>
<html>
	<head>${head}</head>
	<body>
		<div id="vcp-root">
			<pre id="py-output">Loading Pyodide...</pre>
		</div>
		<script type="module">
			const output = document.getElementById("py-output")
			const append = (chunk) => {
				output.textContent = output.textContent === "Loading Pyodide..." ? chunk : output.textContent + chunk
			}
			try {
				const { loadPyodide } = await import(${JSON.stringify(PYODIDE_MODULE_URL)})
				const pyodide = await loadPyodide({ indexURL: ${JSON.stringify(PYODIDE_INDEX_URL)} })
				output.textContent = ""
				pyodide.setStdout({ batched: (value) => append(value + "\\n") })
				pyodide.setStderr({ batched: (value) => append(value + "\\n") })
				await pyodide.runPythonAsync(${JSON.stringify(source)})
				if (!output.textContent.trim()) {
					output.textContent = "[python] finished without stdout"
				}
			} catch (error) {
				output.textContent = String(error?.stack || error?.message || error || "Python execution failed")
			}
		</script>
	</body>
</html>`
	}

	if (language === "css") {
		return `<!DOCTYPE html>
<html>
	<head>${head}<style>${source}</style></head>
	<body>${DEFAULT_SAMPLE_HTML}</body>
</html>`
	}

	if (language === "javascript") {
		return `<!DOCTYPE html>
<html>
	<head>${head}</head>
	<body>
		${DEFAULT_SAMPLE_HTML}
		<script type="module">
${source}
		</script>
	</body>
</html>`
	}

	if (isFullHtmlDocument(source)) {
		return injectHead(source, head)
	}

	return `<!DOCTYPE html>
<html>
	<head>${head}</head>
	<body>${source}</body>
</html>`
}

const getPreviewHeight = (source: string, language: RichContentLanguage, standalone: boolean) => {
	if (language === "python") {
		return 280
	}

	if (language === "css") {
		return 240
	}

	if (source.includes("THREE.") || source.includes("<canvas")) {
		return 420
	}

	if (standalone) {
		return 360
	}

	return 320
}

const RichContentBlock = memo(({ source, language, standalone = false }: RichContentBlockProps) => {
	const previewHtml = useMemo(() => buildPreviewDocument(source, language), [language, source])
	const previewHeight = useMemo(() => getPreviewHeight(source, language, standalone), [language, source, standalone])
	const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined)

	useEffect(() => {
		if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
			setPreviewUrl(undefined)
			return
		}

		const blob = new Blob([previewHtml], { type: "text/html" })
		const objectUrl = URL.createObjectURL(blob)
		setPreviewUrl(objectUrl)

		return () => {
			URL.revokeObjectURL(objectUrl)
		}
	}, [previewHtml])

	return (
		<PreviewWrapper>
			<PreviewHeader>
				<span>{standalone ? "VCP rich bubble" : `VCP ${language} preview`}</span>
				<span>{previewUrl ? "sandbox: blob" : "sandbox: srcdoc"}</span>
			</PreviewHeader>
			<PreviewFrame
				data-testid="rich-content-preview"
				title={`vcp-rich-preview-${language}`}
				$height={previewHeight}
				sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
				referrerPolicy="no-referrer"
				loading="lazy"
				src={previewUrl}
				srcDoc={previewUrl ? undefined : previewHtml}
			/>
			{!standalone && (
				<SourceToggle>
					<summary>Show source</summary>
					<div style={{ padding: "0 12px 12px" }}>
						<CodeBlock source={source} language={language === "javascript" ? "javascript" : language} />
					</div>
				</SourceToggle>
			)}
		</PreviewWrapper>
	)
})

export default RichContentBlock

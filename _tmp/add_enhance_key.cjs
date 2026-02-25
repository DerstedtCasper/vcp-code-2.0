const fs = require("fs")
const path = require("path")

const dir = "packages/kilo-vscode/webview-ui/src/i18n"
const locales = ["ar", "br", "bs", "da", "de", "es", "fr", "ja", "ko", "no", "pl", "ru", "th", "zht"]
const newKey = `  "prompt.action.enhance": "Enhance prompt with AI",`

for (const loc of locales) {
  const f = path.join(dir, loc + ".ts")
  let c = fs.readFileSync(f, "utf8")
  if (!c.includes("prompt.action.enhance")) {
    c = c.replace(/("prompt\.action\.stop"[^\n]*\n)/, `$1${newKey}\n`)
    fs.writeFileSync(f, c, "utf8")
    console.log("Updated", loc)
  } else {
    console.log("Skip", loc)
  }
}

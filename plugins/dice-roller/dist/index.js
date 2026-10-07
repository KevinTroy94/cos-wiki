// Adds the client-side dice roller (client.js) to every page.
// It only acts on [!sheet] character sheets; see client.js for what rolls.
import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "client.js"), "utf8")

function DiceRoller() {
  return {
    name: "DiceRoller",
    // Quartz skips transformers without these; this plugin doesn't touch the AST
    markdownPlugins() {
      return []
    },
    htmlPlugins() {
      return []
    },
    externalResources() {
      return {
        js: [{ script, loadTime: "afterDOMReady", contentType: "inline" }],
      }
    },
  }
}

export default DiceRoller

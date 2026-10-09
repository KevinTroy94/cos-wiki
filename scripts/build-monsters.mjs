#!/usr/bin/env node
// Collects every `> [!statblock]` callout in the content folder into a JSON
// library for the DM dashboard (quartz/static/dm/). Runs before the Quartz
// build (see .github/workflows/deploy.yml).
// usage: node scripts/build-monsters.mjs <contentDir> <outFile>
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, relative, dirname, basename } from "path"

const [contentDir = "content", outFile = "quartz/static/dm/monsters.json"] = process.argv.slice(2)

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith(".md")) out.push(p)
  }
  return out
}

const num = (s) => parseInt(String(s).replace(/\u2212/g, "-"), 10)

function parseBlock(lines) {
  const md = lines.join("\n")
  const text = md.replace(/\*/g, "")
  const name = (md.match(/^\*\*(.+?)\*\*\s*$/m) || [])[1]
  if (!name) return null
  const ac = text.match(/\b(?:AC|Armor Class)\s+(\d+)/)
  const hp = text.match(/\b(?:HP|Hit Points)\s+(\d+)(?:\s*\(([^)]+)\))?/)
  const cr = text.match(/\b(?:CR|Challenge)\s+([\d/]+)(?:\s*\(([^)]*)\))?/)
  let init = text.match(/\bInitiative\s+([+\u2212-]\d+)/)
  init = init ? num(init[1]) : null
  if (init === null) {
    // 2014 layout: DEX modifier from the ability table ("| 13 (+1) | 6 (−2) |")
    const row = lines.find((l) => /^\|\s*\d+\s*\(/.test(l))
    if (row) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean)
      const m = cells[1] && cells[1].match(/\(([+\u2212-]\d+)\)/)
      if (m) init = num(m[1])
    } else {
      // 2024 layout without an Initiative line: "| Mod | +1 | +3 | ..."
      const mod = lines.find((l) => /^\|\s*Mod\s*\|/i.test(l))
      if (mod) init = num(mod.split("|").map((c) => c.trim()).filter(Boolean)[2])
    }
  }
  return {
    name,
    ac: ac ? +ac[1] : null,
    hp: hp ? +hp[1] : null,
    hpDice: hp && hp[2] && /\d+d\d+/.test(hp[2]) ? hp[2].trim() : null,
    init: init ?? 0,
    cr: cr ? cr[1] : null,
    md,
  }
}

const monsters = []
for (const file of walk(contentDir)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/^>\s*\[!statblock\]/i.test(lines[i])) continue
    const block = []
    for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) block.push(lines[j].replace(/^>\s?/, ""))
    const m = parseBlock(block)
    if (!m) continue
    const rel = relative(contentDir, file).split("\\").join("/")
    m.source = rel.replace(/\.md$/, "")
    m.folder = rel.split("/").slice(0, -1).join("/")
    monsters.push(m)
  }
}
monsters.sort((a, b) => a.name.localeCompare(b.name))
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify({ built: new Date().toISOString(), monsters }))
console.log(`build-monsters: ${monsters.length} stat blocks -> ${outFile}`)

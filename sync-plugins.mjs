#!/usr/bin/env node
// sync-plugins.mjs — copies local plugins into .quartz/plugins/ before each build.
// Needed on Windows where symlinks require elevated permissions.
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const root = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(root, "plugins")
const dest = path.join(root, ".quartz", "plugins")

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

for (const name of fs.readdirSync(src)) {
  const srcPlugin = path.join(src, name)
  if (!fs.statSync(srcPlugin).isDirectory()) continue
  const destPlugin = path.join(dest, name)
  copyDir(srcPlugin, destPlugin)
  console.log(`synced plugin: ${name}`)
}

#!/usr/bin/env node
// publish.mjs: sync vault → content/, copy only the images public pages use, commit, push.
// Usage: node publish.mjs            (sync, commit, push)
//        node publish.mjs --no-push  (sync only, for testing a local build)
import { execSync } from "child_process";
import { readdirSync, readFileSync, copyFileSync, mkdirSync, rmSync } from "fs";
import { join, dirname, basename } from "path";

const VAULT = "c:\\Users\\kevin\\Documents\\Curse of Strahd\\Curse of Strahd";
const VAULT_ROOT = "c:\\Users\\kevin\\Documents\\Curse of Strahd";
const REPO = "c:\\Users\\kevin\\Documents\\cos-wiki";
const CONTENT = join(REPO, "content");
const NO_PUSH = process.argv.includes("--no-push");

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
// Folders Quartz never renders (keep in step with ignorePatterns in quartz.config.yaml).
// Their notes are still copied (the DM dashboard reads stat blocks from them), but their images aren't.
const HIDDEN = /^(Book\/Monsters and NPCs|DM Story Notes|Undiscovered Places)(\/|$)/;

// Walk a folder, returning paths relative to it (forward slashes), skipping dot-folders
function walk(root, rel = "") {
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out;
}

// Remove [!dmspoiler] callouts (the remove-dm-spoilers plugin strips these from the build).
// A blockquote runs until the first blank line.
function stripSpoilers(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*>\s*\[!dmspoiler\]/i.test(lines[i])) {
      while (i + 1 < lines.length && lines[i + 1].trim() !== "") i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

const isUnpublished = text => {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!fm && /^publish:\s*["']?false["']?\s*$/m.test(fm[1]);
};

// Every file name that a public page links to or embeds, lower-cased
function usedNames(pages) {
  const used = new Set();
  for (const { text } of pages) {
    const s = stripSpoilers(text);
    for (const m of s.matchAll(/\[\[([^\]|#]+)/g)) used.add(basename(m[1].trim()).toLowerCase());
    for (const m of s.matchAll(/\]\(([^)\s]+)/g)) {
      try { used.add(basename(decodeURIComponent(m[1])).toLowerCase()); } catch { used.add(basename(m[1]).toLowerCase()); }
    }
    for (const m of s.matchAll(/<img[^>]+src=["']([^"']+)/gi)) used.add(basename(m[1]).toLowerCase());
  }
  return used;
}

// 1. Wipe content/ (keeping index.md, which lives only in the repo)
console.log("Clearing content/...");
for (const e of readdirSync(CONTENT, { withFileTypes: true })) {
  if (e.name.startsWith(".") || e.name === "index.md") continue;
  rmSync(join(CONTENT, e.name), { recursive: true, force: true });
}

// 2. Copy every non-image file from the vault
console.log("Syncing vault notes...");
const vaultFiles = walk(VAULT);
for (const f of vaultFiles.filter(f => !IMAGE.test(f))) {
  mkdirSync(dirname(join(CONTENT, f)), { recursive: true });
  copyFileSync(join(VAULT, f), join(CONTENT, f));
}

// 3. Work out which images public pages actually show
const publicPages = vaultFiles
  .filter(f => f.endsWith(".md") && !HIDDEN.test(f))
  .map(f => ({ f, text: readFileSync(join(VAULT, f), "utf8") }))
  .filter(p => !isUnpublished(p.text));
publicPages.push({ f: "index.md", text: readFileSync(join(CONTENT, "index.md"), "utf8") });
const used = usedNames(publicPages);

// 4. Copy only those images (from the notes folder, and loose ones in the vault root)
console.log("Copying images used by public pages...");
let copied = 0, skipped = 0;
for (const f of vaultFiles.filter(f => IMAGE.test(f))) {
  if (used.has(basename(f).toLowerCase())) {
    mkdirSync(dirname(join(CONTENT, f)), { recursive: true });
    copyFileSync(join(VAULT, f), join(CONTENT, f));
    copied++;
  } else skipped++;
}
for (const f of readdirSync(VAULT_ROOT)) {
  if (!IMAGE.test(f)) continue;
  if (used.has(f.toLowerCase())) { copyFileSync(join(VAULT_ROOT, f), join(CONTENT, f)); copied++; }
  else skipped++;
}
console.log(`  ${copied} image(s) copied, ${skipped} left out (hidden, spoiler-only or unused).`);

if (NO_PUSH) { console.log("\n--no-push: content/ synced, nothing committed."); process.exit(0); }

// 5. Commit and push
console.log("Committing and pushing...");
const date = new Date().toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
execSync(`git add -A content`, { cwd: REPO, stdio: "inherit" });
execSync(`git commit -m "Vault sync ${date}" --allow-empty`, { cwd: REPO, stdio: "inherit" });
execSync(`git push`, { cwd: REPO, stdio: "inherit" });

console.log("\nDone! Site will update in ~1 minute.");

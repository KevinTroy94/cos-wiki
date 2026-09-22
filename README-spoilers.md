# Spoiler Syntax Guide

Two ways to keep DM content out of the player wiki. Both are stripped at build time — the content never reaches the browser.

---

## 1. Exclude an entire note

Add `publish: false` to the frontmatter:

```markdown
---
publish: false
---

# Strahd's True Weakness

This note will not appear in the wiki at all — no page, no search result, no graph node.
```

The note is invisible to players. Any wikilinks *to* this note from published notes will not create a backlink on this page (because the page doesn't exist in the build).

> **Sessions/ folder** — all notes under `Sessions/` are excluded automatically. You don't need `publish: false` on session recap notes. If you ever want a session note to go public, add `publish: true` to its frontmatter.

---

## 2. Hide a block within a published note

Wrap DM-only content in a `[!dmspoiler]` callout:

```markdown
# Ireena Kolyana

Ireena is the adopted daughter of the late Burgomaster. She has been bitten by Strahd twice.

> [!dmspoiler] DM Only
> Ireena is the reincarnation of Tatyana, Strahd's lost love. This is why he is obsessed with her.
> See [[Strahd's Obsession]] for the full backstory.

Players can escort Ireena to Vallaki for safety.
```

Everything inside the `> [!dmspoiler]` block is removed from the HTML before the page is built. The public page shows only the paragraphs outside the block.

**Rules for spoiler blocks:**
- Use `![[wikilink]]` syntax for images inside spoiler blocks, not `![](path)` — only wikilink-style embeds are guaranteed not to be copied to the public build.
- Wikilinks inside a spoiler block do not create backlinks on the linked note's public page.
- The callout title after `[!dmspoiler]` is optional and also stripped.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Hide an entire note | Add `publish: false` to frontmatter |
| Hide a section of a note | Wrap in `> [!dmspoiler]` |
| Keep a session note public | Add `publish: true` to its frontmatter |
| Hide an image | Only reference it inside a `> [!dmspoiler]` block using `![[image.png]]` |

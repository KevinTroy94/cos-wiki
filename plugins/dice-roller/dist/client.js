// Dice roller for [!sheet] character sheets. Runs in the browser.
// Reads bonuses and damage dice straight from the rendered sheet:
//   - Ability cards (STR, DEX...)        -> that ability's saving throw
//   - Initiative card (combat table)     -> d20 + bonus
//   - Saving Throws / Skills lists       -> d20 + bonus
//   - Any table with Hit + Damage columns -> to-hit and damage (crit doubles dice)
// Banner toggles: Normal / Adv / Dis for every d20, and 3D on/off.
// 3D dice use @3d-dice/dice-box (MIT), vendored in quartz/static/dice-box and
// loaded on the first roll. The landed dice ARE the result; if 3D can't load
// (no WebGL, old phone) it falls back to an instant random roll.
(function () {
  var MINUS = "−"
  var mode = "normal"
  var busy = false

  // Initiative rolls are also sent to the DM's tracker (static/dm/initiative.html)
  // through ntfy.sh. Must match TOPIC in the tracker page.
  var DM_TOPIC = "cos-7j76gfs57pvvzfnipjai"

  function sendToDM(payload) {
    return fetch("https://ntfy.sh/" + DM_TOPIC, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) throw new Error("ntfy " + res.status)
    })
  }

  function characterName() {
    var h = document.querySelector("h1.article-title")
    return (h ? h.textContent : document.title).trim()
  }

  // Where the site's static folder lives (this script is served from it)
  var STATIC = (function () {
    var src = (document.currentScript && document.currentScript.src) || ""
    if (!src) {
      var s = document.querySelector('script[src*="static/resource-"]')
      src = s ? s.src : location.origin + "/static/x.js"
    }
    return src.replace(/[^/]*$/, "")
  })()

  var use3d = true
  try {
    use3d = localStorage.getItem("dice-3d") !== "off"
  } catch (e) {}

  function num(s) {
    return parseInt(String(s).replace(/−/g, "-"), 10)
  }
  function fmtMod(n) {
    return n >= 0 ? "+ " + n : MINUS + " " + Math.abs(n)
  }
  function die(n) {
    return 1 + Math.floor(Math.random() * n)
  }
  function bonusOf(text) {
    var m = String(text).match(/([+−-]\d+)\s*$/)
    return m ? num(m[1]) : null
  }

  // ── 3D dice ──────────────────────────────────────────────────────────────
  var tray = null
  var boxPromise = null
  var clearTimer = null

  function ensureTray() {
    if (!tray) {
      tray = document.createElement("div")
      tray.id = "dice-tray"
    }
    // Quartz's page navigation can remove foreign nodes; put it back
    if (!document.body.contains(tray)) document.body.appendChild(tray)
    return tray
  }

  function getBox() {
    if (!use3d) return Promise.resolve(null)
    if (boxPromise) return boxPromise
    ensureTray()
    var base = new URL(STATIC + "dice-box/")
    boxPromise = import(base.href + "dice-box.es.min.js")
      .then(function (mod) {
        var DiceBox = mod.default
        var box = new DiceBox({
          container: "#dice-tray",
          assetPath: base.pathname + "assets/",
          origin: base.origin,
          theme: "default",
          themeColor: "#9b2335",
          scale: 6,
          gravity: 1.5,
          enableShadows: true,
        })
        return box.init().then(function () {
          return box
        })
      })
      .catch(function (err) {
        console.warn("3D dice unavailable, using instant rolls:", err)
        return null
      })
    return boxPromise
  }

  // Roll groups like [{n:2, sides:20}, {n:4, sides:6}] -> [[..], [..]]
  function rollGroups(groups) {
    var wanted = groups.filter(function (g) {
      return g.n > 0
    })
    var instant = function () {
      return groups.map(function (g) {
        var out = []
        for (var i = 0; i < g.n; i++) out.push(die(g.sides))
        return out
      })
    }
    if (!wanted.length) return Promise.resolve(instant())
    return getBox().then(function (box) {
      if (!box) return instant()
      ensureTray().classList.add("show")
      clearTimeout(clearTimer)
      return box
        .roll(
          wanted.map(function (g) {
            return g.n + "d" + g.sides
          }),
        )
        .then(function (res) {
          var ids = []
          res.forEach(function (r) {
            if (ids.indexOf(r.groupId) < 0) ids.push(r.groupId)
          })
          ids.sort(function (a, b) {
            return a - b
          })
          var k = 0
          var out = groups.map(function (g) {
            if (!g.n) return []
            var id = ids[k++]
            return res
              .filter(function (r) {
                return r.groupId === id
              })
              .map(function (r) {
                return r.value
              })
          })
          clearTimer = setTimeout(function () {
            tray.classList.remove("show")
            setTimeout(function () {
              box.clear()
            }, 400)
          }, 2500)
          return out
        })
    })
  }

  function d20Count() {
    return mode === "normal" ? 1 : 2
  }
  function pickD20(values) {
    var kept =
      values.length === 1 ? values[0] : mode === "adv" ? Math.max(values[0], values[1]) : Math.min(values[0], values[1])
    return { kept: kept, all: values }
  }
  function d20Html(r) {
    if (r.all.length === 1) return "d20 " + r.kept
    var used = false
    return (
      "d20 " +
      r.all
        .map(function (x) {
          if (!used && x === r.kept) {
            used = true
            return "<b>" + x + "</b>"
          }
          return "<s>" + x + "</s>"
        })
        .join(" / ")
    )
  }
  function mark(el, r) {
    el.classList.remove("rolled", "nat20", "nat1", "rolling")
    void el.offsetWidth // restart the pop animation
    el.classList.add("rolled")
    if (r && r.kept === 20) el.classList.add("nat20")
    if (r && r.kept === 1) el.classList.add("nat1")
  }

  // One d20 check (+ optional damage dice), then render.
  // followUp(r) may return another dice group to roll afterwards (crits).
  function check(els, dmgDie, render, followUp) {
    if (busy) return
    busy = true
    els.forEach(function (e) {
      e.classList.add("rolling")
    })
    var groups = [{ n: d20Count(), sides: 20 }]
    if (dmgDie) groups.push(dmgDie)
    rollGroups(groups)
      .then(function (out) {
        var r = pickD20(out[0])
        var more = followUp && followUp(r)
        if (!more) return [r, out[1] || []]
        return rollGroups([more]).then(function (extra) {
          return [r, (out[1] || []).concat(extra[0])]
        })
      })
      .then(function (res) {
        var r = res[0]
        render(r, res[1])
        els.forEach(function (e) {
          mark(e, r)
        })
      })
      .catch(function (err) {
        console.warn(err)
      })
      .then(function () {
        busy = false
        els.forEach(function (e) {
          e.classList.remove("rolling")
        })
      })
  }

  function clickable(el, title, handler) {
    el.classList.add("roll-target")
    el.setAttribute("role", "button")
    el.setAttribute("tabindex", "0")
    el.title = title
    el.addEventListener("click", function (e) {
      if (e.target.closest("a, button")) return
      handler()
    })
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        handler()
      }
    })
  }

  // ── Banner: Normal / Adv / Dis, and 3D on/off ────────────────────────────
  function setupMode(content) {
    var banner = content.querySelector(":scope > p:first-child")
    if (!banner || banner.querySelector(".roll-mode")) return
    var wrap = document.createElement("span")
    wrap.className = "roll-mode"
    ;[
      ["normal", "Normal", "Roll one d20"],
      ["adv", "Adv", "Advantage: roll two d20s, keep the higher"],
      ["dis", "Dis", "Disadvantage: roll two d20s, keep the lower"],
    ].forEach(function (opt) {
      var b = document.createElement("button")
      b.type = "button"
      b.textContent = opt[1]
      b.title = opt[2]
      b.dataset.mode = opt[0]
      b.addEventListener("click", function () {
        mode = opt[0]
        sync()
      })
      wrap.appendChild(b)
    })
    var t = document.createElement("button")
    t.type = "button"
    t.className = "toggle-3d"
    t.textContent = "3D"
    t.title = "Show 3D dice when rolling"
    t.addEventListener("click", function () {
      use3d = !use3d
      try {
        localStorage.setItem("dice-3d", use3d ? "on" : "off")
      } catch (e) {}
      sync()
    })
    wrap.appendChild(t)
    banner.appendChild(wrap)
    function sync() {
      wrap.querySelectorAll("button[data-mode]").forEach(function (b) {
        b.classList.toggle("active", b.dataset.mode === mode)
      })
      t.classList.toggle("active", use3d)
    }
    sync()
  }

  // ── Ability cards (STR, DEX...) roll that ability's saving throw ─────────
  var ABILITY = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" }

  function saveBonuses(content) {
    var out = {}
    Array.prototype.forEach.call(content.children, function (el) {
      if (el.tagName !== "P" || el.textContent.trim().toLowerCase() !== "saving throws") return
      var list = el.nextElementSibling
      if (!list || list.tagName !== "UL") return
      Array.prototype.forEach.call(list.children, function (li) {
        var text = li.textContent.replace(/^[●○\s]+/, "")
        var m = text.match(/^([A-Za-z]+)\s+([+−-]\d+)/)
        if (m) out[m[1].toLowerCase()] = num(m[2])
      })
    })
    return out
  }

  function setupAbilities(content) {
    var table = content.querySelector(":scope > .table-container:nth-of-type(1) table")
    if (!table || table.dataset.roller) return
    table.dataset.roller = "1"
    var saves = saveBonuses(content)
    var heads = table.querySelectorAll("thead th")
    var rows = table.querySelectorAll("tbody tr")
    var modRow = rows[rows.length - 1]
    Array.prototype.forEach.call(heads, function (th, i) {
      var key = ABILITY[th.textContent.trim().toLowerCase()]
      if (!key || !modRow || !modRow.children[i]) return
      var modCell = modRow.children[i]
      var bonus = key in saves ? saves[key] : bonusOf(modCell.textContent)
      if (bonus === null) return
      var out = document.createElement("span")
      out.className = "save-out"
      out.setAttribute("aria-live", "polite")
      modCell.appendChild(out)
      var cells = [th].concat(
        Array.prototype.map.call(rows, function (r) {
          return r.children[i]
        }),
      )
      var label = key.charAt(0).toUpperCase() + key.slice(1)
      function roll() {
        check(cells, null, function (r) {
          out.innerHTML =
            "<strong>" + (r.kept + bonus) + "</strong><em>save</em><small>" + d20Html(r) + " " + fmtMod(bonus) + "</small>"
        })
      }
      cells.forEach(function (c) {
        clickable(c, "Roll " + label + " saving throw (" + fmtMod(bonus).replace(" ", "") + ")", roll)
        c.classList.add("ability-roll")
        c.addEventListener("mouseenter", function () {
          cells.forEach(function (x) {
            x.classList.add("hover")
          })
        })
        c.addEventListener("mouseleave", function () {
          cells.forEach(function (x) {
            x.classList.remove("hover")
          })
        })
      })
    })
  }

  // ── Initiative card ──────────────────────────────────────────────────────
  function setupInitiative(content) {
    var table = content.querySelector(":scope > .table-container:nth-of-type(2) table")
    if (!table) return
    var headers = Array.prototype.slice.call(table.querySelectorAll("th"))
    var idx = headers.findIndex(function (th) {
      return th.textContent.trim().toLowerCase() === "initiative"
    })
    var row = table.querySelector("tbody tr")
    var cell = idx >= 0 && row && row.children[idx]
    if (!cell || cell.dataset.roller) return
    var bonus = bonusOf(cell.textContent) || 0
    cell.dataset.roller = "1"
    cell.classList.add("dice-roll")
    headers[idx].classList.add("dice-roll-head")
    cell.innerHTML =
      '<span class="dice-bonus">' +
      cell.textContent.trim() +
      '</span><span class="dice-result" aria-live="polite">tap to roll</span>'
    clickable(cell, "Roll initiative (sent to the DM)", function () {
      check([cell], null, function (r) {
        var total = r.kept + bonus
        var res = cell.querySelector(".dice-result")
        res.innerHTML =
          "<strong>" + total + "</strong><small>" + d20Html(r) + " " + fmtMod(bonus) + "</small>" +
          '<span class="dm-sent">sending to DM…</span>'
        var status = res.querySelector(".dm-sent")
        // AC and max HP from the same combat table, so the tracker can fill them in
        var stat = function (re) {
          var i = headers.findIndex(function (th) {
            return re.test(th.textContent.trim())
          })
          var v = i >= 0 && row.children[i] ? parseInt(row.children[i].textContent, 10) : NaN
          return isNaN(v) ? null : v
        }
        sendToDM({
          type: "init",
          who: characterName(),
          ac: stat(/^AC\b/i),
          hp: stat(/^HP$/i),
          total: total,
          d20: r.all,
          kept: r.kept,
          bonus: bonus,
          mode: mode,
          t: Date.now(),
        })
          .then(function () {
            status.textContent = "sent to DM ✓"
            status.classList.add("ok")
          })
          .catch(function () {
            status.textContent = "not sent, tell the DM"
            status.classList.add("fail")
          })
      })
    })
  }

  // ── Saving throws and skills ─────────────────────────────────────────────
  function setupLists(content) {
    Array.prototype.forEach.call(content.children, function (el) {
      if (el.tagName !== "P") return
      var label = el.textContent.trim().toLowerCase()
      if (label !== "saving throws" && label !== "skills") return
      var list = el.nextElementSibling
      if (!list || list.tagName !== "UL") return
      Array.prototype.forEach.call(list.children, function (li) {
        if (li.dataset.roller) return
        var bonus = bonusOf(li.textContent)
        if (bonus === null) return
        li.dataset.roller = "1"
        var out = document.createElement("span")
        out.className = "roll-out"
        out.setAttribute("aria-live", "polite")
        li.appendChild(out)
        var name = li.textContent.replace(/^[●○\s]+/, "").replace(/([+−-]\d+)\s*$/, "").trim()
        clickable(li, "Roll " + name, function () {
          check([li], null, function (r) {
            out.innerHTML =
              "<strong>" + (r.kept + bonus) + "</strong><small>" + d20Html(r) + " " + fmtMod(bonus) + "</small>"
          })
        })
      })
    })
  }

  // ── Attacks (any table with a Hit/Attack column and a Damage column) ─────
  function parseDamage(text) {
    var t = String(text).replace(/−/g, "-")
    var m = t.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/)
    if (m) {
      var rest = t.slice(m.index + m[0].length).match(/[A-Za-z]+/)
      return { n: +m[1], sides: +m[2], mod: m[3] ? (m[3] === "-" ? -1 : 1) * +m[4] : 0, type: rest ? rest[0] : "" }
    }
    var f = t.match(/^\s*(\d+)\s*([A-Za-z]*)/)
    return f ? { n: 0, sides: 0, mod: +f[1], type: f[2] } : null
  }

  // Damage-only row: throws just the damage dice. Toggle chips:
  //   - any "+XdY vs something" found in the row (e.g. "+1d8 vs undead or fiend")
  //   - Crit: doubles every damage die
  function setupDamageRow(tr, dmgCell) {
    if (tr.dataset.roller || !dmgCell) return
    var dmg = parseDamage(dmgCell.textContent)
    if (!dmg || !dmg.n) return
    tr.dataset.roller = "1"
    var nameCell = tr.children[0]
    var name = nameCell.textContent.trim()

    var opts = []
    var re = /\+\s*(\d+)d(\d+)\s+vs\.?\s+([^;|,.]+)/gi
    var m
    while ((m = re.exec(tr.textContent))) {
      opts.push({ n: +m[1], sides: +m[2], label: "vs " + m[3].trim(), on: false })
    }
    var crit = { label: "Crit", on: false }

    var chips = document.createElement("span")
    chips.className = "roll-opts"
    opts.concat([crit]).forEach(function (o) {
      var b = document.createElement("button")
      b.type = "button"
      b.className = "roll-opt"
      b.textContent = o === crit ? "Crit ×2" : o.label + " +" + o.n + "d" + o.sides
      b.setAttribute("aria-pressed", "false")
      b.addEventListener("click", function () {
        o.on = !o.on
        b.classList.toggle("active", o.on)
        b.setAttribute("aria-pressed", String(o.on))
      })
      chips.appendChild(b)
    })
    nameCell.appendChild(chips)

    var out = document.createElement("span")
    out.className = "roll-out attack-out"
    out.setAttribute("aria-live", "polite")
    nameCell.appendChild(out)

    clickable(tr, "Roll " + name + " damage", function () {
      if (busy) return
      busy = true
      tr.classList.add("rolling")
      var mult = crit.on ? 2 : 1
      var parts = [{ n: dmg.n * mult, sides: dmg.sides, label: dmg.n * mult + "d" + dmg.sides }]
      opts.forEach(function (o) {
        if (o.on) parts.push({ n: o.n * mult, sides: o.sides, label: o.n * mult + "d" + o.sides + " " + o.label })
      })
      rollGroups(parts)
        .then(function (res) {
          var total = dmg.mod
          var detail = parts.map(function (p, i) {
            total += res[i].reduce(function (a, b) {
              return a + b
            }, 0)
            return p.label + " [" + res[i].join(", ") + "]"
          })
          out.innerHTML =
            '<span class="dmg"><strong>' + Math.max(0, total) + "</strong> " + dmg.type +
            (crit.on ? ' <em class="tag">Crit</em>' : "") + "</span>" +
            "<small>" + detail.join(" + ") + (dmg.mod ? " " + fmtMod(dmg.mod) : "") + "</small>"
          mark(tr, null)
        })
        .catch(function (err) {
          console.warn(err)
        })
        .then(function () {
          busy = false
          tr.classList.remove("rolling")
        })
    })
  }

  function setupAttacks(content) {
    content.querySelectorAll(":scope > .table-container table").forEach(function (table) {
      var heads = Array.prototype.map.call(table.querySelectorAll("thead th"), function (th) {
        return th.textContent.trim().toLowerCase()
      })
      var hitIdx = heads.findIndex(function (h, i) {
        return i > 0 && /^(hit|to hit|attack)$/.test(h)
      })
      var dmgIdx = heads.indexOf("damage")
      if (dmgIdx < 0) return
      if (hitIdx < 0) {
        // No attack roll column: damage-only rows (e.g. Divine Smite)
        table.querySelectorAll("tbody tr").forEach(function (tr) {
          setupDamageRow(tr, tr.children[dmgIdx])
        })
        return
      }
      table.classList.add("attack-table")
      table.querySelectorAll("tbody tr").forEach(function (tr) {
        if (tr.dataset.roller) return
        var cells = tr.children
        var bonus = bonusOf(cells[hitIdx] && cells[hitIdx].textContent)
        var dmg = parseDamage(cells[dmgIdx] && cells[dmgIdx].textContent)
        if (bonus === null || !dmg) return
        tr.dataset.roller = "1"
        var nameCell = cells[0]
        var name = nameCell.textContent.trim()
        var out = document.createElement("span")
        out.className = "roll-out attack-out"
        out.setAttribute("aria-live", "polite")
        nameCell.appendChild(out)
        clickable(tr, "Roll " + name + " (to hit and damage)", function () {
          // On a natural 20, a second throw adds the extra crit damage dice
          var dmgDie = dmg.n ? { n: dmg.n, sides: dmg.sides } : null
          check([tr], dmgDie, function (r, rolls) {
            var crit = r.kept === 20
            var miss = r.kept === 1
            var total = Math.max(
              0,
              rolls.reduce(function (a, b) {
                return a + b
              }, 0) + dmg.mod,
            )
            var dmgDetail = rolls.length
              ? rolls.length + "d" + dmg.sides + " [" + rolls.join(", ") + "]" + (dmg.mod ? " " + fmtMod(dmg.mod) : "")
              : "flat"
            out.innerHTML =
              '<span class="hit"><strong>' + (r.kept + bonus) + "</strong> to hit" +
              (crit ? ' <em class="tag">Crit!</em>' : miss ? ' <em class="tag">Nat 1</em>' : "") +
              '</span><span class="dmg"><strong>' + total + "</strong> " + dmg.type + "</span>" +
              "<small>" + d20Html(r) + " " + fmtMod(bonus) + " · " + dmgDetail + "</small>"
          }, function (r) {
            return r.kept === 20 && dmg.n ? { n: dmg.n, sides: dmg.sides } : null
          })
        })
      })
    })
  }

  // ── Monster stat blocks ([!statblock]) ───────────────────────────────────
  // Attack actions ("*Melee Attack Roll:* +6 ... *Hit:* 8 (2d4 + 3) Slashing
  // damage plus 10 (3d6) Necrotic damage") roll to-hit and every damage part;
  // saving-throw actions ("*Constitution Saving Throw:* DC 14 ... *Failure:*
  // 5 (1d4 + 3) ...") roll the damage only.
  function multiRoll(els, withD20, comps, render) {
    if (busy) return
    busy = true
    els.forEach(function (e) {
      e.classList.add("rolling")
    })
    var dice = comps.map(function (c) {
      return { n: c.n, sides: c.sides }
    })
    rollGroups((withD20 ? [{ n: d20Count(), sides: 20 }] : []).concat(dice))
      .then(function (out) {
        var r = withD20 ? pickD20(out[0]) : null
        var dmg = withD20 ? out.slice(1) : out
        if (r && r.kept === 20) {
          // Crit: throw the damage dice again and add them
          return rollGroups(dice).then(function (extra) {
            return [
              r,
              dmg.map(function (a, i) {
                return a.concat(extra[i])
              }),
            ]
          })
        }
        return [r, dmg]
      })
      .then(function (res) {
        render(res[0], res[1])
        els.forEach(function (e) {
          mark(e, res[0])
        })
      })
      .catch(function (err) {
        console.warn(err)
      })
      .then(function () {
        busy = false
        els.forEach(function (e) {
          e.classList.remove("rolling")
        })
      })
  }

  function setupStatblock(content) {
    setupMode(content)
    content.querySelectorAll(":scope > p").forEach(function (p) {
      if (p.dataset.roller) return
      var text = p.textContent.replace(/−/g, "-")
      var hit = text.match(/(?:Attack Roll|Weapon Attack|Spell Attack)[^:]*:\s*([+-]\d+)/i)
      var save = text.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC\s*(\d+)/i)
      var seg
      if (hit) {
        var hi = text.indexOf("Hit:")
        if (hi < 0) return
        seg = text.slice(hi + 4)
      } else if (save) {
        var fi = text.indexOf("Failure:")
        if (fi < 0) return
        seg = text.slice(fi + 8)
      } else return
      // First sentence only, and only the first of "X damage, or Y damage"
      seg = seg.split(/\.\s/)[0].split(/,?\s+or\s+/)[0]
      var comps = []
      var re = /\d+\s*\((\d+)d(\d+)(?:\s*([+-])\s*(\d+))?\)\s*([A-Za-z]+)/g
      var m
      while ((m = re.exec(seg))) {
        comps.push({
          n: +m[1],
          sides: +m[2],
          mod: m[3] ? (m[3] === "-" ? -1 : 1) * +m[4] : 0,
          type: m[5].toLowerCase(),
        })
      }
      if (!comps.length) return
      p.dataset.roller = "1"
      var nameEl = p.querySelector("strong")
      var name = nameEl ? nameEl.textContent.replace(/\.\s*$/, "").trim() : "Attack"
      var bonus = hit ? num(hit[1]) : 0
      var out = document.createElement("span")
      out.className = "roll-out attack-out"
      out.setAttribute("aria-live", "polite")
      p.appendChild(out)
      clickable(p, "Roll " + name, function () {
        multiRoll([p], !!hit, comps, function (r, dmg) {
          var total = 0
          var parts = []
          var detail = []
          comps.forEach(function (c, i) {
            var sum = Math.max(
              0,
              dmg[i].reduce(function (a, b) {
                return a + b
              }, 0) + c.mod,
            )
            total += sum
            parts.push("<strong>" + sum + "</strong> " + c.type)
            detail.push(dmg[i].length + "d" + c.sides + " [" + dmg[i].join(", ") + "]" + (c.mod ? " " + fmtMod(c.mod) : ""))
          })
          var head = hit
            ? '<span class="hit"><strong>' + (r.kept + bonus) + "</strong> to hit" +
              (r.kept === 20 ? ' <em class="tag">Crit!</em>' : r.kept === 1 ? ' <em class="tag">Nat 1</em>' : "") +
              "</span>"
            : '<span class="hit">DC ' + save[2] + " " + save[1].slice(0, 3) + " save · on a failure</span>"
          out.innerHTML =
            head +
            '<span class="dmg">' + parts.join(" + ") + (parts.length > 1 ? " = <strong>" + total + "</strong>" : "") + "</span>" +
            "<small>" + (hit ? d20Html(r) + " " + fmtMod(bonus) + " · " : "") + detail.join(" · ") + "</small>"
        })
      })
    })
  }

  // ── DM calls for initiative ──────────────────────────────────────────────
  // On pages with a character sheet, listen on the DM channel; when the DM
  // dashboard sends {type:"request", what:"initiative"}, show a prompt.
  var dmListener = null
  function listenForDM() {
    if (dmListener || !document.querySelector('.callout[data-callout="sheet"]')) return
    dmListener = new EventSource("https://ntfy.sh/" + DM_TOPIC + "/sse")
    dmListener.onmessage = function (ev) {
      var m, msg
      try {
        m = JSON.parse(ev.data)
        msg = JSON.parse(m.message)
      } catch (e) {
        return
      }
      if (m.event !== "message" || msg.type !== "request") return
      if (Date.now() / 1000 - m.time > 120) return // ignore stale calls
      showCall(msg)
    }
  }

  function showCall(msg) {
    var cell = document.querySelector("td.dice-roll")
    if (!cell) return
    var old = document.getElementById("dm-call")
    if (old) old.remove()
    var box = document.createElement("div")
    box.id = "dm-call"
    box.innerHTML =
      '<div class="dm-call-title">⚔ The DM calls for initiative!</div>' +
      (msg.note ? '<div class="dm-call-note"></div>' : "") +
      '<div class="dm-call-btns"><button type="button" class="go">Roll initiative</button><button type="button" class="later">Dismiss</button></div>'
    if (msg.note) box.querySelector(".dm-call-note").textContent = msg.note
    document.body.appendChild(box)
    box.querySelector(".go").addEventListener("click", function () {
      box.remove()
      var sheet = cell.closest(".callout")
      if (sheet && sheet.classList.contains("is-collapsed")) {
        var title = sheet.querySelector(".callout-title")
        if (title) title.click()
      }
      cell.scrollIntoView({ block: "center", behavior: "smooth" })
      cell.click()
    })
    box.querySelector(".later").addEventListener("click", function () {
      box.remove()
    })
  }

  // Shared with the DM dashboard (static/dm/), which loads this same file
  window.CosDice = {
    rollGroups: rollGroups,
    get3d: function () {
      return use3d
    },
    set3d: function (v) {
      use3d = !!v
      try {
        localStorage.setItem("dice-3d", use3d ? "on" : "off")
      } catch (e) {}
    },
    topic: DM_TOPIC,
  }

  function setup() {
    if (tray && !document.body.contains(tray)) document.body.appendChild(tray)
    listenForDM()
    document.querySelectorAll('.callout[data-callout="sheet"] .callout-content').forEach(function (content) {
      setupMode(content)
      setupAbilities(content)
      setupInitiative(content)
      setupLists(content)
      setupAttacks(content)
    })
    document.querySelectorAll('.callout[data-callout="statblock"] .callout-content').forEach(setupStatblock)
  }

  document.addEventListener("nav", setup)
  if (document.readyState !== "loading") setup()
})()

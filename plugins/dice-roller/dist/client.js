// Dice roller for [!sheet] character sheets. Runs in the browser.
// Reads bonuses and damage dice straight from the rendered sheet:
//   - Initiative card (combat table)     -> d20 + bonus
//   - Saving Throws / Skills lists       -> d20 + bonus
//   - Any table with Hit + Damage columns -> to-hit and damage (crit doubles dice)
// A Normal / Adv / Dis toggle in the sheet banner applies to every d20 roll.
(function () {
  var MINUS = "−"
  var mode = "normal"

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

  function rollD20() {
    var a = die(20)
    if (mode === "normal") return { kept: a, all: [a] }
    var b = die(20)
    return { kept: mode === "adv" ? Math.max(a, b) : Math.min(a, b), all: [a, b] }
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
    el.classList.remove("rolled", "nat20", "nat1")
    void el.offsetWidth // restart the pop animation
    el.classList.add("rolled")
    if (r && r.kept === 20) el.classList.add("nat20")
    if (r && r.kept === 1) el.classList.add("nat1")
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

  // ── Normal / Advantage / Disadvantage toggle, inside the banner ──────────
  function setupMode(content) {
    var banner = content.querySelector(":scope > p:first-child")
    if (!banner || banner.querySelector(".roll-mode")) return
    var wrap = document.createElement("span")
    wrap.className = "roll-mode"
    ;[
      ["normal", "Normal"],
      ["adv", "Adv"],
      ["dis", "Dis"],
    ].forEach(function (opt) {
      var b = document.createElement("button")
      b.type = "button"
      b.textContent = opt[1]
      b.dataset.mode = opt[0]
      b.title =
        opt[0] === "normal"
          ? "Roll one d20"
          : opt[0] === "adv"
            ? "Advantage: roll two d20s, keep the higher"
            : "Disadvantage: roll two d20s, keep the lower"
      b.addEventListener("click", function () {
        mode = opt[0]
        sync()
      })
      wrap.appendChild(b)
    })
    banner.appendChild(wrap)
    function sync() {
      wrap.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.mode === mode)
      })
    }
    sync()
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
    clickable(cell, "Roll initiative", function () {
      var r = rollD20()
      cell.querySelector(".dice-result").innerHTML =
        "<strong>" + (r.kept + bonus) + "</strong><small>" + d20Html(r) + " " + fmtMod(bonus) + "</small>"
      mark(cell, r)
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
          var r = rollD20()
          out.innerHTML =
            "<strong>" + (r.kept + bonus) + "</strong><small>" + d20Html(r) + " " + fmtMod(bonus) + "</small>"
          mark(li, r)
        })
      })
    })
  }

  // ── Attacks (any table with a Hit/Attack column and a Damage column) ─────
  function parseDamage(text) {
    var t = String(text).replace(/−/g, "-")
    var m = t.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/)
    var type
    if (m) {
      var rest = t.slice(m.index + m[0].length).match(/[A-Za-z]+/)
      type = rest ? rest[0] : ""
      return { n: +m[1], sides: +m[2], mod: m[3] ? (m[3] === "-" ? -1 : 1) * +m[4] : 0, type: type }
    }
    var f = t.match(/^\s*(\d+)\s*([A-Za-z]*)/)
    return f ? { n: 0, sides: 0, mod: +f[1], type: f[2] } : null
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
      if (hitIdx < 0 || dmgIdx < 0) return
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
          var r = rollD20()
          var crit = r.kept === 20
          var miss = r.kept === 1
          var count = crit ? dmg.n * 2 : dmg.n
          var rolls = []
          for (var i = 0; i < count; i++) rolls.push(die(dmg.sides))
          var total = rolls.reduce(function (a, b) { return a + b }, 0) + dmg.mod
          if (total < 0) total = 0
          var dmgDetail = count
            ? count + "d" + dmg.sides + " [" + rolls.join(", ") + "]" + (dmg.mod ? " " + fmtMod(dmg.mod) : "")
            : "flat"
          out.innerHTML =
            '<span class="hit"><strong>' + (r.kept + bonus) + "</strong> to hit" +
            (crit ? ' <em class="tag">Crit!</em>' : miss ? ' <em class="tag">Nat 1</em>' : "") +
            '</span><span class="dmg"><strong>' + total + "</strong> " + dmg.type + "</span>" +
            "<small>" + d20Html(r) + " " + fmtMod(bonus) + " · " + dmgDetail + "</small>"
          mark(tr, r)
        })
      })
    })
  }

  function setup() {
    document.querySelectorAll('.callout[data-callout="sheet"] .callout-content').forEach(function (content) {
      setupMode(content)
      setupInitiative(content)
      setupLists(content)
      setupAttacks(content)
    })
  }

  document.addEventListener("nav", setup)
  if (document.readyState !== "loading") setup()
})()

/* NFO data-provenance banner — self-injecting, framework-agnostic.
 *
 * Every primary operator page (/console, /exec, /ui/*.html) loads this. It
 * polls GET /nephes/provenance and renders a persistent, non-dismissible strip
 * across the top of the page that says:
 *   - where the numbers come from: a real plant gateway, the replay SIMULATOR,
 *     a gateway FALLBACK to the simulator, demo mode, seeded demo records;
 *   - how failure scores are produced right now: the deviation-from-nominal
 *     heuristic (trained models shadow-only, the default) or trained models.
 *
 * When everything shown is real plant data the strip is slim and neutral.
 * When anything is simulated / demo / unverifiable it turns amber or red and
 * leads with "NOT PLANT DATA". It cannot be dismissed on purpose: an operator
 * who hid it yesterday must not be misled by a fallback today. The close
 * button removes it from the page, but only for this browser tab and only for
 * the same notices: any new or changed notice brings it back. While it is
 * closed the header's status capsule still says "not plant data", and clicking
 * that capsule (NFOProvenance.reopen) shows the banner again.
 *
 * Pages can add client-side conditions the server cannot see (e.g. the
 * console's placeholder floor painted before the first snapshot, or the
 * /ui client's built-in mock payloads when the backend is unreachable):
 *   window.NFOProvenance.setLocal("key", {level:"warn"|"crit", text:"..."});
 *   window.NFOProvenance.setLocal("key", null);   // clear
 *
 * Mount point: an element with id="nfoProvenance" if the page provides one
 * (the console puts it inside its 100vh flex shell), else prepended to <body>.
 * Fires `nfo:provenance` on document with the latest server payload.
 */
(function () {
  "use strict";
  if (window.NFOProvenance) return;

  var POLL_MS = 30000;
  var server = null;        // last /nephes/provenance payload
  var serverError = null;   // string when the endpoint could not be read
  var local = {};           // key -> {level, text}
  var root = null;

  var CSS =
    // The root stays in normal flow as a spacer (its height is synced to the
    // bar's) and the bar itself is position:fixed, so it is visible however
    // the page scrolls -- position:sticky silently fails under some page
    // layouts (it does on the /ui pages).
    "#nfoProvenance{position:relative;flex-shrink:0;" +
    "font:12px/1.35 'Inter','Segoe UI',system-ui,sans-serif;}" +
    "#nfoProvenance .nfo-prov{position:fixed;top:0;left:0;right:0;z-index:9000;" +
    "box-sizing:border-box;max-height:40vh;overflow:auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;" +
    "padding:5px 16px;border-bottom:1px solid rgba(255,255,255,.08);background:#16161a;color:#b9b6ad;}" +
    "#nfoProvenance .nfo-prov.warn{background:#5a3f00;color:#fff3cf;border-bottom:2px solid #f0b429;padding:8px 16px;}" +
    "#nfoProvenance .nfo-prov.crit{background:#6b1414;color:#ffe3e3;border-bottom:2px solid #ff5a5a;padding:8px 16px;}" +
    "#nfoProvenance .nfo-prov-head{font-weight:800;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;}" +
    "#nfoProvenance .nfo-prov.warn .nfo-prov-head{color:#ffd166;}" +
    "#nfoProvenance .nfo-prov.crit .nfo-prov-head{color:#ff9b9b;}" +
    "#nfoProvenance .nfo-prov-items{display:flex;flex-direction:column;gap:2px;flex:1 1 320px;min-width:0;}" +
    "#nfoProvenance .nfo-prov-serving{margin-left:auto;white-space:nowrap;padding:2px 8px;border-radius:4px;" +
    "border:1px solid currentColor;font-weight:600;opacity:.95;}" +
    "#nfoProvenance .nfo-prov-serving.trained{color:#8fd694;}" +
    "#nfoProvenance .nfo-prov-ok{color:#8fd694;font-weight:700;}" +
    "#nfoProvenance .nfo-prov-n{opacity:.85;white-space:nowrap;}" +
    // !important: the banner looks the same on every page, whatever that page does to its own buttons
    "#nfoProvenance .nfo-prov-x{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:6px;box-sizing:border-box!important;height:24px!important;min-height:0!important;padding:0 9px!important;" +
    "border:1px solid currentColor!important;border-radius:6px!important;background:transparent!important;color:inherit!important;font:600 11.5px/1 'Inter','Segoe UI',system-ui,sans-serif!important;letter-spacing:normal!important;text-transform:none!important;box-shadow:none!important;cursor:pointer;opacity:.9;}" +
    "#nfoProvenance .nfo-prov-x:hover{opacity:1;background:rgba(255,255,255,.08);}" +
    "#nfoProvenance .nfo-prov-x:focus-visible{outline:2px solid #fff3cf;outline-offset:2px;}" +
    "#nfoProvenance .nfo-prov-serving+.nfo-prov-x{margin-left:0;}";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ensureRoot() {
    if (root && document.contains(root)) return root;
    if (!document.getElementById("nfoProvenanceCss")) {
      var st = el("style");
      st.id = "nfoProvenanceCss";
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    root = document.getElementById("nfoProvenance");
    if (!root) {
      root = el("div");
      root.id = "nfoProvenance";
      document.body.insertBefore(root, document.body.firstChild);
    }
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    return root;
  }

  function rank(level) { return level === "crit" ? 2 : level === "warn" ? 1 : 0; }

  function notices() {
    var out = [];
    if (serverError) {
      out.push({ level: "crit", text: "Data source could not be verified (" + serverError + ")." });
    }
    ((server && server.notices) || []).forEach(function (n) { out.push(n); });
    Object.keys(local).forEach(function (k) { if (local[k]) out.push(local[k]); });
    out.sort(function (a, b) { return rank(b.level) - rank(a.level); });
    return out;
  }

  function servingChip() {
    var s = server && server.serving;
    if (!s) return null;
    var trained = s.mode === "trained";
    var txt = s.mode === "none"
      ? "Scoring: NONE · no detectors loaded"
      : trained
      ? "Scoring: trained models live"
      : "Scoring: heuristic" + (s.serve_trained_models ? "" : " · trained models shadow-only");
    var chip = el("span", "nfo-prov-serving" + (trained ? " trained" : ""), txt);
    chip.title = s.detail || "";
    return chip;
  }

  // closed for this browser tab, for these exact notices only (sessionStorage, so it is not remembered tomorrow)
  var MIN_KEY = "nfo.provenance.collapsed";
  function sigOf(level, list) { return level + "|" + list.map(function (n) { return n.level + ":" + n.text; }).join("|"); }
  function isCollapsed(sig) { try { return window.sessionStorage.getItem(MIN_KEY) === sig; } catch (e) { return false; } }
  function setCollapsed(sig) { try { if (sig) window.sessionStorage.setItem(MIN_KEY, sig); else window.sessionStorage.removeItem(MIN_KEY); } catch (e) {} }

  function render() {
    if (!document.body) return;
    var r = ensureRoot();
    var list = notices();
    var level = list.length ? (rank(list[0].level) === 2 ? "crit" : "warn") : "ok";
    var bar = el("div", "nfo-prov " + (level === "ok" ? "" : level));
    bar.setAttribute("data-level", level);

    if (level === "ok" && !server) {
      // nothing heard from the server yet: say so, never "plant data" before it is known
      bar.appendChild(el("span", "nfo-prov-head", "Checking where the readings come from…"));
    } else if (level === "ok") {
      var gw = server && server.gateway;
      bar.appendChild(el("span", "nfo-prov-ok", "PLANT DATA"));
      bar.appendChild(el("span", null,
        "Gateway " + ((gw && (gw.protocol || gw.id)) || "unknown") + " · no simulated or demo data in view"));
    } else {
      // Two kinds of notice: where the data comes from, and whether faults
      // can be detected at all (scope "detection"). Only the first kind makes
      // it "not plant data"; a detector outage on real plant data is its own,
      // louder headline -- never a quiet "all normal".
      var data = list.filter(function (n) { return n.scope !== "detection"; });
      var det = list.filter(function (n) { return n.scope === "detection"; });
      var heads = [];
      if (det.some(function (n) { return n.level === "crit"; })) heads.push("Fault detection offline");
      else if (det.length) heads.push("Fault detection reduced");
      if (data.length) {
        heads.push(data.some(function (n) { return n.level === "crit"; })
          ? "Not plant data — source unverified" : "Not plant data");
      }
      bar.appendChild(el("span", "nfo-prov-head", "⚠ " + heads.join(" · ")));
      var sig = sigOf(level, list);
      if (isCollapsed(sig)) { r.textContent = ""; syncOffset(); return; }   // closed for this tab and these exact notices
      var items = el("div", "nfo-prov-items");
      list.forEach(function (n) { items.appendChild(el("span", null, n.text)); });
      bar.appendChild(items);
    }
    var chip = servingChip();
    if (chip) bar.appendChild(chip);
    if (level !== "ok") {
      // the close button removes the strip for this tab and these notices (see the note at the top)
      var x = el("button", "nfo-prov-x", "✕ Close");
      x.type = "button";
      x.title = "Close for this tab. It comes back by itself if anything changes; the header still says not plant data, and clicking it shows this again.";
      x.addEventListener("click", function () { setCollapsed(sig); render(); });
      bar.appendChild(x);
    }

    r.textContent = "";
    r.appendChild(bar);
    syncOffset();
  }

  // Pages with their own sticky top bar (frontend/assets/nephes.css .topbar)
  // offset it by the banner height so the two never overlap.
  function syncOffset() {
    if (!root) return;
    try {
      var bar = root.firstChild;
      var h = bar ? bar.offsetHeight : 0;
      root.style.height = h + "px";
      document.documentElement.style.setProperty("--nfo-prov-h", h + "px");
    } catch (e) {}
  }
  window.addEventListener("resize", syncOffset);

  function poll() {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : null;
    fetch("/nephes/provenance", { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        server = data;
        serverError = null;
        try { window.sessionStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (e) {}
        try { document.dispatchEvent(new CustomEvent("nfo:provenance", { detail: data })); } catch (e) {}
      })
      .catch(function (e) {
        serverError = "/nephes/provenance " + ((e && e.name === "AbortError") ? "timed out" : (e && e.message) || "unreachable");
      })
      .then(function () { if (t) clearTimeout(t); render(); });
  }

  window.NFOProvenance = {
    setLocal: function (key, notice) {
      if (notice) local[key] = notice; else delete local[key];
      render();
    },
    reopen: function () { setCollapsed(null); render(); },
    get current() { return server; },
    refresh: poll,
  };

  // The /ui client (frontend/assets/api.js) falls back to built-in MOCK
  // payloads when the backend is unreachable and announces it with this event.
  document.addEventListener("nephes:conn", function (e) {
    var live = e && e.detail && e.detail.live;
    window.NFOProvenance.setLocal("client_mock", live ? null : {
      level: "crit",
      text: "Backend unreachable - this page is showing built-in MOCK sample data, not plant data.",
    });
  });

  // Moving between pages in the same tab: start from what this tab heard from the server seconds ago (under a minute),
  // so the banner and the header sit where they were and the tab slide doesn't jump; the poll right after replaces it.
  var LAST_KEY = "nfo.provenance.last";
  function lastKnown() {
    try { var c = JSON.parse(window.sessionStorage.getItem(LAST_KEY) || "null"); return c && c.data && Date.now() - c.at < 60000 ? c.data : null; } catch (e) { return null; }
  }
  function start() {
    server = lastKnown(); render();
    if (server) setTimeout(function () { try { document.dispatchEvent(new CustomEvent("nfo:provenance", { detail: server })); } catch (e) {} }, 0);
    // a hidden tab (a wall TV switched to another input, a background tab) stops asking; it asks again as soon as it is shown
    poll(); setInterval(function () { if (!document.hidden) poll(); }, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

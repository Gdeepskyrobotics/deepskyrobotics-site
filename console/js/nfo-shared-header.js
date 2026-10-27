/* NEPHES shared header: Live Operations and Replay get the same header as the Signal Console.
 *
 *   <link rel="stylesheet" href="/static/css/nfo-shared-header.css">
 *   <div id="nfoSharedHdr" data-page="live|replay"></div>
 *   <script src="/static/js/nfo-shared-header.js"></script>
 *
 * Brand, views (Live Operations · Signal Console · Replay), plant health from the live readings
 * (/dashboard, read-only), the data-status chip, the clock and the same screen settings as the
 * Signal Console (saved in this browser under the same key, so a filter set on one page applies on all).
 * Warn opens the Signal Console on its first "Now" item. It reads only; nothing here writes to the plant.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NfoSharedHeader = api;
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    var go = function () { var el = document.getElementById("nfoSharedHdr"); if (el && !el.getAttribute("data-mounted")) api.mount(document, { page: el.getAttribute("data-page") }); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VIEWS = [["live", "/console", "Live"], ["signal", "/console/signal", "Feed"], ["replay", "/console/plant", "View"]];   // tab labels: Live (Live Operations), Feed (Signal Console), View (the demo plant first; Replay is one click inside it)
  /* TT3: each view's small line icon in the tab capsule: a screen for Live, a list for Feed, play for View */
  var TAB_ICONS = { live: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 14h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>', signal: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2 4h12M2 8h9M2 12h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', replay: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.6 5.4v5.2L10.8 8z" fill="currentColor"/></svg>' };
  var FILTER_KEY = "nfo.signal.filters";
  var PRESETS = {
    none: "", night: "grayscale(1) sepia(1) saturate(5) hue-rotate(-38deg) brightness(0.8)", gray: "grayscale(1)",
    amber: "sepia(0.75) saturate(1.3) hue-rotate(-12deg)", deut: "url(#nfoHdrDeut)", prot: "url(#nfoHdrProt)"
  };

  function esc(s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(x) { var n = Number(x); return x === null || x === undefined || x === "" || !isFinite(n) ? null : n; }
  function statusOf(s) {
    s = String(s || "").toLowerCase();
    if (s === "critical" || s === "alarm" || s === "fault") return "critical";   // same words as the Signal Console
    if (s === "warning" || s === "abnormal" || s === "warn") return "warning";
    return "normal";
  }
  /* same counts as the Signal Console: every reading by status, and machines with a reading out of range */
  function healthCounts(assets) {
    var ok = 0, warn = 0, crit = 0, out = 0;
    Object.keys(assets || {}).forEach(function (aid) {
      var ss = (assets[aid] && assets[aid].sensors) || {}, any = false;
      Object.keys(ss).forEach(function (t) { var st = statusOf(ss[t].status); if (st === "critical") { crit++; any = true; } else if (st === "warning") { warn++; any = true; } else ok++; });
      if (any) out++;
    });
    var tot = ok + warn + crit;
    return { ok: ok, warn: warn, crit: crit, total: tot, machinesOut: out, pct: tot ? Math.round(ok / tot * 100) : null };
  }

  /* P4-a1: the header says how many machines need checking (never their names, so it stays one line however many there are);
     the bell beside LIVE opens the list. A machine needs checking when any of its readings is outside its normal range. */
  var HH_TRI = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><path d="M8 1.8 15 14H1z" fill="currentColor"/><path d="M8 6v3.6" stroke="#1b1b1a" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.7" r=".95" fill="#1b1b1a"/></svg>';
  var HH_OK = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m5.2 8.2 1.9 1.9 3.7-3.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var HH_WAIT = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.6V8.4l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var HH_BELL = '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" focusable="false"><path d="M10 2.5c-2.9 0-5 2.2-5 5.1v3.1L3.6 13.4c-.3.5 0 1.1.6 1.1h11.6c.6 0 .9-.6.6-1.1L15 10.7V7.6c0-2.9-2.1-5.1-5-5.1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 16.2a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  function healthSummary(assets) {
    var rows = [], machines = 0, ok = 0, tot = 0;
    Object.keys(assets || {}).sort().forEach(function (aid) {
      var ss = (assets[aid] && assets[aid].sensors) || {}, tags = Object.keys(ss).sort(), out = [];
      if (!tags.length) return;
      machines++;
      tags.forEach(function (t) { var st = statusOf(ss[t] && ss[t].status); tot++; if (st === "normal") ok++; else out.push({ tag: t, status: st }); });
      if (!out.length) return;
      out.sort(function (a, b) { return (b.status === "critical") - (a.status === "critical") || (a.tag < b.tag ? -1 : 1); });
      rows.push({ asset: aid, worst: out[0].status, tag: out[0].tag, n: out.length });
    });
    rows.sort(function (a, b) { return (b.worst === "critical") - (a.worst === "critical") || (a.asset < b.asset ? -1 : 1); });
    return { machines: machines, out: rows, crit: rows.filter(function (r) { return r.worst === "critical"; }).length,
      normal: machines - rows.length, readingsOk: ok, readingsTotal: tot };
  }
  function hhState(h) { return !h.machines ? "none" : !h.out.length ? "ok" : h.crit ? "crit" : "warn"; }
  function hhPillInner(h) {
    var n = h.out.length;
    if (!h.machines) return '<span class="hh-ic">' + HH_WAIT + "</span>Waiting for readings";
    if (!n) return '<span class="hh-ic">' + HH_OK + "</span><b>All " + h.machines + "</b> machines normal";
    return '<span class="hh-ic">' + HH_TRI + "</span><b>" + n + "</b> " + (n === 1 ? "machine needs" : "machines need") + " checking" +
      '<span class="hh-pd"> · ' + (h.crit ? h.crit + " critical" : "warnings only") + "</span>";
  }
  function hhSmall(h) {
    if (!h.machines) return "";
    return (h.out.length ? "<b>" + h.normal + "</b> machine" + (h.normal === 1 ? "" : "s") + " normal · " : "") +
      "<b>" + h.readingsOk + " of " + h.readingsTotal + "</b> readings in range";
  }
  function hhBadge(h) { return h.out.length > 99 ? "99+" : String(h.out.length); }
  /* the list under the bell: every machine that needs checking, worst first; item(row) gives each row's link or button */
  function hhPanelHTML(h, item, foot) {
    var n = h.out.length;
    return "<h3>Needs checking now<span>" + (h.machines ? n + " of " + h.machines + " machines" : "no readings yet") + "</span></h3>" +
      '<div class="sub">Machines with a reading outside its normal range, worst first. NFO lists them here; it doesn\'t page anyone or write to the plant.</div>' +
      (n ? "<ul>" + h.out.map(function (r) {
        return "<li>" + item(r, '<span class="ic ' + esc(r.worst) + '">' + HH_TRI + "</span><span><b>" + esc(r.asset) + "</b> " + esc(r.tag) + " " +
          '<span class="w ' + esc(r.worst) + '">' + (r.worst === "critical" ? "critical" : "warning") + "</span></span>" +
          '<span class="more">' + (r.n > 1 ? "+" + (r.n - 1) + " more" : "") + "</span>") + "</li>";
      }).join("") + "</ul>" : '<div class="empty">' + (h.machines ? "Nothing outside its normal range." : "Waiting for readings.") + "</div>") +
      (foot ? '<div class="ft">' + foot + "</div>" : "");
  }

  /* The active H5 tab is joined to the page, so it takes the page's own background (colour and gradient), and with a screen
     filter on, the page background behind the content is filtered too (a fixed layer under body), not left as it was. */
  function pageBgCss(win, doc) {
    try {
      var b = win.getComputedStyle(doc.body), c = b.backgroundColor, im = b.backgroundImage;
      if (!c || /^(transparent|rgba\(0, 0, 0, 0\))$/.test(c)) { var h = win.getComputedStyle(doc.documentElement); c = h.backgroundColor; im = h.backgroundImage; }
      if (!c || /^(transparent|rgba\(0, 0, 0, 0\))$/.test(c)) return "";
      return "background-color: " + c + "; background-image: " + (im && im !== "none" ? im : "none") + "; background-repeat: no-repeat; background-attachment: fixed;";
    } catch (e) { return ""; }
  }
  function tabFilterCss(bg, css, tabSel) {
    if (!bg) return "";
    var t = tabSel ? tabSel + " { " + bg.replace(/;/g, " !important;") + " }" : "";   // no selector: the tabs no longer take the page background (TT3)
    if (css && css !== "none") t += " html body { background: transparent !important; } body::before { content: \"\"; position: fixed; inset: 0; z-index: -1; pointer-events: none; " + bg + " filter: " + css + "; }";
    return t;
  }

  function filterCss(f) {
    f = f || {}; var p = [];
    if (f.warm) p.push("sepia(0.28) saturate(1.1) hue-rotate(-8deg)");
    if (f.comfort) p.push("contrast(0.9) saturate(0.85)");
    if (f.contrast) p.push("contrast(1.25) brightness(1.05)");
    if (PRESETS[f.preset]) p.push(PRESETS[f.preset]);
    if (num(f.dim) !== null && f.dim < 100) p.push("brightness(" + f.dim / 100 + ")");
    return p.join(" ") || "none";
  }

  function markup(page) {
    return '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
      '<filter id="nfoHdrDeut" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="0.367 0.861 -0.228 0 0  0.280 0.673 0.047 0 0  -0.012 0.043 0.969 0 0  0 0 0 1 0"/></filter>' +
      '<filter id="nfoHdrProt" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="0.152 1.053 -0.205 0 0  0.115 0.786 0.099 0 0  -0.004 -0.048 1.052 0 0  0 0 0 1 0"/></filter></svg>' +
      '<header class="hdr h5">' +
      '<div class="h5-top">' +
      '<a class="hdr-brand" href="/console"><span class="hdr-mark"><img class="hdr-logo" src="dsr-logo.png" alt="" onerror="this.style.display=\'none\'"></span><span class="hdr-title">NEPHES Factory Observer<small>Manufacturing intelligence</small></span></a>' +
      '<div class="hdr-health h5-health" aria-label="Plant health">' +
      '<a class="hh-pill none" data-h="pill" href="/console/signal#now" title="Open the Feed on the first item that needs checking now"><span class="hh-ic">' + HH_WAIT + '</span>Waiting for readings</a>' +
      '<span class="hh-sm" data-h="sm"></span></div>' +
      '<div class="h5-right">' +
      '<span class="hdr-cap" data-h="cap" tabindex="0" title="Where the readings come from, and the time on this screen. Click to show the data-source banner if it was closed.">' +
      '<span class="hdr-chip" data-h="status" role="status"><span class="hdr-led"></span>connecting</span>' +
      '<span class="hdr-clock mono" data-h="clock" aria-label="Local time">--:--:--</span></span>' +
      '<div class="bell-wrap"><button type="button" class="hh-bell quiet" data-h="bell" aria-expanded="false" aria-label="What needs checking" title="What needs checking">' + HH_BELL + '<i class="bn" data-h="bn" hidden></i></button>' +
      '<div class="hh-panel" data-h="panel" role="dialog" aria-label="What needs checking now" hidden></div></div>' +
      '<div class="gear-wrap"><button type="button" class="gear" data-h="gear" aria-expanded="false" title="Screen settings">⚙</button>' +
      '<div class="settings" data-h="settings" role="dialog" aria-label="Screen settings" hidden></div></div></div></div>' +
      '<nav class="h5-tabs" aria-label="Views"><span class="h5-seg">' + VIEWS.map(function (v) {
        return '<a href="' + v[1] + '"' + (v[0] === page ? ' class="on" aria-current="page"' : "") + '><span class="tb-ic">' + (TAB_ICONS[v[0]] || "") + "</span>" + v[2] +
          (v[0] === "signal" ? '<span class="tabn" data-h="tabn" title="Machines with a reading out of range" hidden></span>' : "") + "</a>";
      }).join("") + "</span></nav>" +
      "</header>";
  }

  function settingsHTML(f, where) {
    var tog = function (k, label, hint) {
      return '<div class="srow"><span>' + label + "<small>" + hint + '</small></span><button type="button" class="tgl' + (f[k] ? " on" : "") + '" data-flt="' + k + '" aria-pressed="' + (f[k] ? "true" : "false") + '"><span></span></button></div>';
    };
    var pre = [["none", "None", "as designed"], ["night", "Night red", "keeps night vision"], ["gray", "Grayscale", "check without colour"], ["amber", "Amber", "low glare, warm"],
      ["deut", "Red-green preview", "deuteranopia sim"], ["prot", "Red-weak preview", "protanopia sim"]];
    return '<div class="stitle">Display</div>' + tog("warm", "Blue light filter", "warms the screen colours") + tog("comfort", "Eye comfort mode", "softer contrast") +
      tog("contrast", "High contrast", "for bright floors and glare") +
      '<div class="stitle">Screen filter</div><div class="sgrid">' + pre.map(function (p) {
        return '<button type="button" class="sopt' + (f.preset === p[0] ? " on" : "") + '" data-preset="' + p[0] + '" aria-pressed="' + (f.preset === p[0] ? "true" : "false") + '">' + p[1] + "<small>" + p[2] + "</small></button>";
      }).join("") + '</div><div class="stitle">Brightness</div><div class="sseg">' + [100, 85, 70, 55].map(function (d) {
        return '<button type="button" class="' + (Number(f.dim || 100) === d ? "on" : "") + '" data-dim="' + d + '">' + d + "%</button>";
      }).join("") + '</div><button type="button" class="hdr-btn ghost wide" data-h="reset">Reset to default</button>' +
      '<a class="hdr-btn ghost wide" href="/handbook">Handbook</a>' +
      '<p class="shint">The same settings as the Feed, on every page. They change only how the screen looks; readings, limits and alerts are unchanged. Alert motion is set on the Feed. ' + (where && where.where === "server" ? "Saved to " + esc(where.user) + "'s account." : "Saved in this browser.") + "</p>";
  }

  function mount(doc, env) {
    env = env || {};
    var win = env.window || doc.defaultView || {};
    var host = doc.getElementById("nfoSharedHdr"); if (!host) return null;
    host.setAttribute("data-mounted", "1");
    host.classList.add("nfo-hdr-root");
    host.innerHTML = markup(env.page || host.getAttribute("data-page"));
    var q = function (k) { return host.querySelector('[data-h="' + k + '"]'); };
    var fetchImpl = env.fetch || function (u, o) { return win.fetch(u, o); };
    var nowFn = env.now || function () { return Date.now(); };
    var S = { live: false, lastOk: 0, notPlant: false, assets: {}, filters: load(), timers: [] };

    function load() { try { var v = JSON.parse(win.localStorage.getItem(FILTER_KEY) || "null"); return v && typeof v === "object" ? v : { preset: "none", dim: 100 }; } catch (e) { return { preset: "none", dim: 100 }; } }
    function mutedKeys() { try { var m = JSON.parse(win.localStorage.getItem("nfo.signal.muted") || "{}"); return Object.keys(m || {}).filter(function (k) { return m[k]; }).sort(); } catch (e) { return []; } }   // kept as the Signal Console set them
    function motion() { try { var m = JSON.parse(win.localStorage.getItem("nfo.signal.motion") || "null"); return (m && m.v) || "auto"; } catch (e) { return "auto"; } }
    /* saved in this browser; signed in, also to the person's account (/nephes/console/prefs), shared with the Signal Console */
    var P = { where: "browser", user: null, token: null, timer: null };
    function save() {
      try { win.localStorage.setItem(FILTER_KEY, JSON.stringify(S.filters)); } catch (e) { /* private window: this visit only */ }
      if (P.where !== "server") return;
      win.clearTimeout(P.timer);
      P.timer = win.setTimeout(function () {
        fetchImpl("/nephes/console/prefs", { method: "PUT", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + P.token },
          body: JSON.stringify({ prefs: { filters: S.filters, motion: motion(), muted: mutedKeys() } }) }).catch(function () {});
      }, 400);
    }
    function loadAccount() {
      return fetchImpl("/nephes/preview/session", {}).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (j) {
        if (!(j && j.enabled && j.token)) return null;
        return fetchImpl("/nephes/console/prefs", { headers: { "Authorization": "Bearer " + j.token } }).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (d) {
          if (!d) return;
          P = { where: "server", user: d.user, token: j.token, timer: null };
          if (d.prefs && d.prefs.filters) {
            S.filters = d.prefs.filters;
            try { win.localStorage.setItem(FILTER_KEY, JSON.stringify(S.filters)); win.localStorage.setItem("nfo.signal.motion", JSON.stringify({ v: d.prefs.motion || "auto" }));
              var mm = {}; (d.prefs.muted || []).forEach(function (k) { mm[k] = 1; }); win.localStorage.setItem("nfo.signal.muted", JSON.stringify(mm)); } catch (e) { /* this visit only */ }
            applyFilter(); applyMotion(); paintSettings();
          }
        });
      }).catch(function () {});
    }

    /* the filter goes on the page content, not on the provenance banner (where the numbers come from stays readable) */
    var style = doc.createElement("style"); style.setAttribute("data-nfo-hdr", "filter"); (doc.head || doc.documentElement).appendChild(style);
    var pageBg = null;
    function applyFilter() {
      var css = filterCss(S.filters);
      if (pageBg === null) pageBg = pageBgCss(win, doc);       // read once, before the filter layer makes body transparent
      style.textContent = (css === "none" ? "" : "body > :not(#nfoProvenance):not(script):not(style) { filter: " + css + "; } ") + tabFilterCss(pageBg, css, null);
    }
    /* the same motion setting as the Signal Console: Off (or Comfort, or the system's reduce-motion) keeps the logo still */
    function applyMotion() { var m = motion(); host.classList.toggle("motion-off", m === "off" || (m !== "on" && !!(S.filters && S.filters.comfort))); if (doc.documentElement && doc.documentElement.classList) doc.documentElement.classList.toggle("nfo-motion-on", m === "on"); if (doc.documentElement && doc.documentElement.classList) doc.documentElement.classList.toggle("nfo-motion-off", m === "off"); }

    function panelItem(r, inner) { return '<a href="/console/signal#asset=' + encodeURIComponent(r.asset) + '">' + inner + "</a>"; }
    function paintPanel() { var p = q("panel"); if (!p.hidden) p.innerHTML = hhPanelHTML(S.hsum || healthSummary({}), panelItem, '<a href="/console/signal#now">Open the Feed</a>'); }
    function paint() {
      var hc = healthCounts(S.assets), h = healthSummary(S.assets), st = hhState(h); S.hsum = h;
      var pill = q("pill"), inner = hhPillInner(h);
      pill.className = "hh-pill " + st + (S.ringUntil > nowFn() ? " hh-new" : ""); if (pill.innerHTML !== inner) pill.innerHTML = inner;
      // a machine that newly turned critical rings the pill (three pulses); not on the first paint of the page
      var crits = h.out.filter(function (r) { return r.worst === "critical"; }).map(function (r) { return r.asset; });
      if (S.critPrev && crits.some(function (a) { return S.critPrev.indexOf(a) < 0; })) {
        S.ringUntil = nowFn() + 4300; pill.classList.remove("hh-new"); void pill.offsetWidth; pill.classList.add("hh-new");
      }
      if (h.machines) S.critPrev = crits;
      q("sm").innerHTML = hhSmall(h);
      var bell = q("bell"), bn = q("bn"), n = h.out.length;
      bell.classList.toggle("quiet", !n); bn.hidden = !n; bn.textContent = hhBadge(h); bn.className = "bn" + (h.crit ? "" : " warn");
      bell.setAttribute("aria-label", "What needs checking: " + (n ? n + (n === 1 ? " machine" : " machines") : "nothing"));
      var tn = q("tabn"); if (tn) { tn.hidden = !hc.machinesOut; tn.textContent = hc.machinesOut + " now"; }
      paintPanel();
    }
    function setStatus() {
      var chip = q("status"), stale = S.live && nowFn() - S.lastOk > 10000;
      chip.className = "hdr-chip " + (!S.live ? "" : stale ? "off" : S.notPlant ? "mock" : "live");
      chip.innerHTML = '<span class="hdr-led"></span>' + esc(!S.live ? "connecting" : stale ? "offline" : S.notPlant ? "not plant data" : "live");
    }
    function takeDashboard(d) {
      var a = (d && d.live_sensors && d.live_sensors.assets) || {};
      if (Object.keys(a).length) { S.assets = a; S.live = true; }
      S.lastOk = nowFn(); paint(); setStatus();
    }
    // on Live the page already has this data (pushed once a second); it hands it over, so the header doesn't fetch it again
    doc.addEventListener("nfo:dashboard", function (ev) { if (ev && ev.detail) { S.pageFed = nowFn(); takeDashboard(ev.detail); } });
    function poll() {
      if (nowFn() - (S.pageFed || 0) < 3500) return Promise.resolve();
      return fetchImpl("/dashboard?events_limit=1&findings_limit=1", {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (d) {
        takeDashboard(d);
      }).catch(function () { setStatus(); });
    }
    /* TR1: the clock shares the status capsule; offline, it shows when the last reading arrived, so a stale screen can't look live */
    function clockText() { var stale = S.live && nowFn() - S.lastOk > 10000; return stale ? "last " + new Date(S.lastOk).toTimeString().slice(0, 8) : new Date(nowFn()).toTimeString().slice(0, 8); }
    function tick() { q("clock").textContent = clockText(); setStatus(); }

    function paintSettings() { var box = q("settings"); if (!box.hidden) box.innerHTML = settingsHTML(S.filters, P); }
    host.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null; if (!t) return;
      var v;
      if (t === q("bell")) { var bp = q("panel"); bp.hidden = !bp.hidden; t.setAttribute("aria-expanded", String(!bp.hidden)); paintPanel(); return; }
      if (t === q("gear")) { var p = q("settings"); p.hidden = !p.hidden; t.setAttribute("aria-expanded", String(!p.hidden)); paintSettings(); return; }
      if ((v = t.getAttribute("data-flt"))) { S.filters[v] = !S.filters[v]; }
      else if ((v = t.getAttribute("data-preset"))) { S.filters.preset = v; }
      else if ((v = t.getAttribute("data-dim"))) { S.filters.dim = Number(v); }
      else if (t === q("reset")) { S.filters = { preset: "none", dim: 100 }; }
      else return;
      save(); applyFilter(); applyMotion(); paintSettings();
    });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && !q("settings").hidden) { q("settings").hidden = true; q("gear").setAttribute("aria-expanded", "false"); } });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && !q("panel").hidden) { q("panel").hidden = true; q("bell").setAttribute("aria-expanded", "false"); } });
    doc.addEventListener("click", function (e) { var bp = q("panel"); if (bp.hidden || !doc.documentElement.contains(e.target)) return;
      if (!host.querySelector(".bell-wrap").contains(e.target)) { bp.hidden = true; q("bell").setAttribute("aria-expanded", "false"); } });
    doc.addEventListener("click", function (e) { var box = q("settings"); if (!doc.documentElement.contains(e.target)) return;   // a button the panel just re-drew
      if (!box.hidden && !host.querySelector(".gear-wrap").contains(e.target)) { box.hidden = true; q("gear").setAttribute("aria-expanded", "false"); } });
    doc.addEventListener("nfo:provenance", function (ev) {
      var list = (ev && ev.detail && ev.detail.notices) || [];
      S.notPlant = list.some(function (n) { return n && n.scope !== "detection" && (n.level === "warn" || n.level === "crit"); });
      setStatus();
    });
    // the same filter, set on another page or tab, applies here too
    if (win.addEventListener) win.addEventListener("storage", function (e) { if (e.key === FILTER_KEY) { S.filters = load(); applyFilter(); applyMotion(); paintSettings(); } });

    /* load a tab's page when the pointer rests on it or it takes focus, so the switch is quick */
    var prefetched = {};
    function prefetchTab(e) { var a = e.target && e.target.closest ? e.target.closest(".h5-tabs a[href]") : null; if (!a || a.classList.contains("on")) return;
      var u = a.getAttribute("href"); if (prefetched[u]) return; prefetched[u] = true;
      var l = doc.createElement("link"); l.rel = "prefetch"; l.href = u; (doc.head || doc.documentElement).appendChild(l); }
    host.addEventListener("pointerover", prefetchTab); host.addEventListener("focusin", prefetchTab);

    // the status capsule brings back the data-source banner if it was closed in this tab
    function reopenBanner(e) { if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return; if (win.NFOProvenance && win.NFOProvenance.reopen) win.NFOProvenance.reopen(); }
    q("cap").addEventListener("click", reopenBanner); q("cap").addEventListener("keydown", reopenBanner);

    applyFilter(); applyMotion(); paint(); tick();
    function startTimers() { if (S.timers.length || !win.setInterval) return; S.timers.push(win.setInterval(poll, 3000), win.setInterval(tick, 1000)); poll(); tick(); }
    function stopTimers() { S.timers.forEach(function (t) { win.clearInterval(t); }); S.timers = []; }
    if (env.autostart !== false && win.setInterval) {
      startTimers(); loadAccount();
      // a browser tab nobody is looking at doesn't keep asking the server; it catches up the moment it is shown again
      doc.addEventListener("visibilitychange", function () { if (doc.hidden) stopTimers(); else startTimers(); });
    }
    return { state: S, poll: poll, paint: paint, stop: function () { S.timers.forEach(function (t) { win.clearInterval(t); }); S.timers = []; } };
  }

  return { mount: mount, healthCounts: healthCounts, healthSummary: healthSummary, hhPillInner: hhPillInner, hhSmall: hhSmall, hhPanelHTML: hhPanelHTML, hhState: hhState, filterCss: filterCss, pageBgCss: pageBgCss, tabFilterCss: tabFilterCss, markup: markup, VIEWS: VIEWS, FILTER_KEY: FILTER_KEY };
});

/* NEPHES console v4 (Operator view) on the NEPHES design system.
 *
 * Same data as the v3.1 console: GET /dashboard (or the /nephes/ws push), GET /nephes/ai_analysis,
 * GET /nephes/mitigation/status, GET /nephes/mitigation, POST /nephes/mitigation/start|complete and the
 * demo-only POST /nephes/inject_fault. Read-only intelligence: nothing here actuates the plant.
 *
 * Honesty rules kept from v3.1: no confidence percentages on analysis cards (the evidence count is shown),
 * and no placeholder floor: until a real snapshot arrives the wall says it is waiting. The provenance strip
 * (/static/js/provenance_banner.js) says where the numbers come from; the status chip follows it.
 *
 * Pure helpers are exported for node tests (tests/console_v4.test.js); mount(document) wires the page.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NephesConsoleV4 = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
/* colours follow the shared console palette (ui/static/css/nfo-console-palette.css) when it is loaded */
function nfoColor(name, fallback) { try { var v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fallback; } catch (e) { return fallback; } }

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function num(v) { var n = typeof v === "number" ? v : (v === null || v === undefined || v === "" ? NaN : Number(v)); return isFinite(n) ? n : null; }
  function fmtVal(v) {
    var n = num(v); if (n === null) return v === null || v === undefined || v === "" ? "—" : String(v);
    var a = Math.abs(n);
    if (a >= 1000) return Math.round(n).toLocaleString("en-US");
    if (a >= 10) return n.toFixed(1);
    if (a >= 1) return n.toFixed(2);
    return n.toFixed(3);
  }
  function fmtPct(v) { var n = num(v); return n === null ? "—" : n.toFixed(1) + "%"; }

  /* ── status words: the design system's lowercase states ── */
  function statusOf(s) {
    var v = String(s || "").toLowerCase();
    if (v === "critical" || v === "crit" || v === "alarm") return "critical";
    if (v === "warning" || v === "warn" || v === "abnormal" || v === "degrading") return "warning";
    return "normal";
  }
  function sevWord(n) { n = num(n) || 0; return n >= 3 ? "critical" : n >= 2 ? "warning" : "info"; }
  var BAR = { normal: "var(--good)", warning: "var(--warn)", critical: "var(--crit)" };

  /* ── floor summary: counts for the health bar and the status chip ── */
  function floorSummary(assets) {
    var out = { assets: 0, sensors: 0, alerts: 0, critical: 0, healthy: 0, atRisk: 0, noData: 0 };
    Object.keys(assets || {}).forEach(function (aid) {
      var a = assets[aid] || {}, sensors = a.sensors || {}, keys = Object.keys(sensors);
      out.assets++; out.sensors += keys.length;
      var worst = statusOf(a.overall_status);
      keys.forEach(function (t) {
        var st = statusOf(sensors[t] && sensors[t].status);
        if (st !== "normal") out.alerts++;
        if (st === "critical") worst = "critical"; else if (st === "warning" && worst !== "critical") worst = "warning";
      });
      if (!keys.length) out.noData++;
      else if (worst === "normal") out.healthy++;
      else { out.atRisk++; if (worst === "critical") out.critical++; }
    });
    return out;
  }

  /* ── session trend for a KPI: never a forecast, only the change seen in this tab ── */
  function trend(hist, higherIsBetter, unit) {
    var h = (hist || []).filter(function (v) { return num(v) !== null; }).map(Number);
    if (h.length < 4) return { text: "", cls: "" };
    var d = h[h.length - 1] - h[0];
    if (Math.abs(d) < 1e-9) return { text: "→ steady this session", cls: "" };
    var good = higherIsBetter ? d > 0 : d < 0;
    var mag = Math.abs(d) >= 10 || Number.isInteger(d) ? String(Math.round(Math.abs(d) * 10) / 10) : Math.abs(d).toFixed(1);
    return { text: (d > 0 ? "↑ " : "↓ ") + mag + (unit ? " " + unit : "") + " this session", cls: good ? "up" : "down" };
  }
  // a null in a history is a gap (no reading arrived for a while): the line stops there and starts again after it, never bridging it
  function sparkPath(hist, W, H, minSpan) {
    var all = hist || [], h = all.filter(function (v) { return num(v) !== null; }).map(Number);
    if (h.length < 2) return "";
    var lo = Math.min.apply(null, h), hi = Math.max.apply(null, h), d = "", pen = false;
    // a minimum span (a quarter of the normal band on the wall) keeps a 1 rpm wobble from being drawn as a cliff
    if (minSpan > 0 && hi - lo < minSpan) { var mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    var r = hi - lo || 1;
    for (var i = 0; i < all.length; i++) {
      if (num(all[i]) === null) { pen = false; continue; }
      d += (d ? (pen ? " L" : " M") : "M") + (i / (all.length - 1) * W).toFixed(1) + " " + (H - 1 - (Number(all[i]) - lo) / r * (H - 2)).toFixed(1);
      pen = true;
    }
    return d;
  }
  function hasGap(hist) { return (hist || []).some(function (v, i, a) { return v === null && i > 0 && i < a.length - 1; }); }

  /* ── the stream ── */
  /* A snapshot is applied only if the server built it after the last one applied, so a slow poll that lands
     after a newer push can't put older numbers back on screen, and the same snapshot is never applied twice. */
  function snapNewer(lastTime, time) {
    var a = Date.parse(lastTime), b = Date.parse(time);
    return !isFinite(b) || !isFinite(a) || b > a;
  }
  /* History holds readings, not refreshes: a point is added only when the sensor's own timestamp moved on.
     When readings stopped for longer than gapS (a dropped connection, a hidden tab, a stalled source), a null
     is kept in its place so the line shows the hole instead of joining across it. Returns true if a point was added. */
  function addReading(h, v, ts, lastTs, n, gapS) {
    if (num(v) === null) return false;
    var t = num(ts), l = num(lastTs);
    if (t !== null && l !== null && t <= l) return false;
    if (t !== null && l !== null && t - l > gapS && h.length && h[h.length - 1] !== null) h.push(null);
    h.push(Number(v));
    while (h.length > n) h.shift();
    while (h.length && h[0] === null) h.shift();
    return true;
  }
  /* How old the newest reading was when the server built the snapshot, in seconds (null if it can't be told).
     Measured on the server's clock, so a browser clock that is off doesn't change it. */
  function readingAge(d) {
    var built = Date.parse(d && d.time), newest = null, a = ((d && d.live_sensors) || {}).assets || {};
    Object.keys(a).forEach(function (aid) { var s = (a[aid] && a[aid].sensors) || {}; Object.keys(s).forEach(function (t) { var x = num(s[t] && s[t].timestamp); if (x !== null && (newest === null || x > newest)) newest = x; }); });
    return isFinite(built) && newest !== null ? Math.max(0, built / 1000 - newest) : null;
  }

  /* ── sensor wall ── */
  /* Importance: what NEPHES would have someone look at first. Critical, then warning, then the rest by how close
     they read to a limit, how low their health is, and whether the analysis names their asset. Every reason is
     shown on the tile, so the order can be checked, not trusted. */
  var SEV_W = { critical: 2, warning: 1 };
  function importance(a, aid, s, ctx) {
    var st = statusOf(s.status), why = [], score = 0;
    if (st === "critical") { score += 300; why.push("critical"); }
    else if (st === "warning") { score += 200; why.push("warning"); }
    var h = num(s.health);
    if (h !== null && h < 95) { score += (100 - h); if (st === "normal") why.push("low health"); }   // the tile shows the %
    var v = num(s.value), lo = num(s.threshold_min), hi = num(s.threshold_warning);
    if (v !== null && lo !== null && hi !== null && hi > lo) {
      var frac = (v - lo) / (hi - lo);                          // 0 at the bottom of the band, 1 at the warning limit
      var near = Math.max(frac, 1 - frac);
      if (near >= 0.85) { score += Math.round(60 * Math.min(1.5, near)); why.push(frac >= 0.5 ? "near its upper limit" : "near its lower limit"); }
    }
    var rec = ctx && ctx.recs && ctx.recs[aid];
    if (rec) { score += 40 * (SEV_W[rec] || 0.5); why.push("asset in the analysis"); }
    return { score: score, why: why };
  }

  function tiles(assets, filter, ctx) {
    filter = filter || {}; ctx = ctx || {};
    var pins = ctx.pins || {};
    var q = String(filter.search || "").trim().toLowerCase(), show = filter.status || "all", by = filter.group || "priority";
    var groups = {}, order = [], all = [];
    Object.keys(assets || {}).sort().forEach(function (aid) {
      var a = assets[aid] || {}, sensors = a.sensors || {};
      Object.keys(sensors).sort().forEach(function (tag) {
        var s = sensors[tag] || {}, st = statusOf(s.status);
        if (show !== "all" && st !== show) return;
        var name = a.asset_name || aid;
        if (q && (aid + " " + name + " " + tag + " " + (a.location || "")).toLowerCase().indexOf(q) < 0) return;
        var key = aid + "|" + tag, imp = importance(a, aid, s, ctx);
        var t = { key: key, aid: aid, tag: tag, status: st, value: s.value, unit: s.unit || "", health: num(s.health),
                  pinned: !!pins[key], score: imp.score, why: imp.why };
        all.push(t);
        if (by === "priority") return;
        var g = by === "location" ? (a.location || "No location") : by === "status" ? st : (name !== aid ? name + " · " + aid : aid);
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(t);
      });
    });
    if (by === "priority") {
      var pinned = all.filter(function (t) { return t.pinned; }), rest = all.filter(function (t) { return !t.pinned; });
      rest.sort(function (x, y) { return y.score - x.score || (x.key < y.key ? -1 : 1); });
      pinned.sort(function (x, y) { return y.score - x.score || (x.key < y.key ? -1 : 1); });
      var out = [];
      if (pinned.length) out.push({ group: "Pinned", tiles: pinned });
      var attn = rest.filter(function (t) { return t.status !== "normal"; });
      var watch = rest.filter(function (t) { return t.status === "normal" && t.score > 0; });
      var calm = rest.filter(function (t) { return t.status === "normal" && t.score === 0; });
      if (attn.length) out.push({ group: "Needs attention", tiles: attn });
      if (watch.length) out.push({ group: "Worth watching", tiles: watch });
      if (calm.length) out.push({ group: "Normal", tiles: calm });
      return out;
    }
    if (by === "status") {
      var rank = { critical: 0, warning: 1, normal: 2 };
      order.sort(function (x, y) { return rank[x] - rank[y]; });
    }
    // pinned sensors lead inside every group too
    return order.map(function (g) {
      return { group: g, tiles: groups[g].slice().sort(function (x, y) { return (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0); }) };
    });
  }
  var PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg>';
  function tileInner(t, byAsset) {
    var h = t.health === null ? null : Math.max(0, Math.min(100, t.health));
    // grouped by asset, the group heading already names it: lead with the tag
    var head = byAsset ? '<span class="asset mono">' + esc(t.tag) + "</span>" : '<span class="asset">' + esc(t.aid) + '</span><br><span class="tagname">' + esc(t.tag) + "</span>";
    return '<span class="top"><span>' + head + "</span>" +
      '<span class="pill ' + t.status + '">' + t.status + "</span></span>" +
      '<span class="reading" data-f="v">' + esc(fmtVal(t.value)) + '<span class="unit">' + esc(t.unit) + "</span></span>" +
      '<span class="healthbar" aria-hidden="true"><i data-f="bar" style="width:' + (h === null ? 0 : h) + "%;background:" + BAR[t.status] + '"></i></span>' +
      '<span class="tagname" data-f="h">' + (h === null ? "health —" : "health " + Math.round(h) + "%") + "</span>" +
      (t.why && t.why.length && !(t.why.length === 1 && t.why[0] === t.status) ? '<span class="why" data-f="why">' + esc(t.why.filter(function (w) { return w !== t.status; }).join(" · ")) + "</span>" : "");
  }

  /* ── LW1: Live as the wall display ──────────────────────────────────────────────────────────────────────────────
     Big tiles NEPHES picks, worst first: every reading out of range (critical, then warning), then one tile per machine
     NEPHES predicts a fault on while its readings are in range, then the readings it is watching (near a limit, low on
     health, pinned). Three things per tile: machine and reading, the number, a status word with the limit it crossed. */
  // the same plain names as the Feed (temp_c → temperature, vib_rms_g → vibration)
  function plainTag(tag) {
    var t = String(tag || "").toLowerCase().replace(/_(c|f|a|g|v|pct|rpm|psi|bar|kpa|hz|kw|lpm|scfm|cfm)$/, "");
    t = t.replace(/_/g, " ").replace(/\bvib rms\b|\bvib\b/, "vibration").replace(/\btemp\b/, "temperature").trim();
    return t || String(tag || "");
  }
  function limitWord(s, st) {
    var v = num(s.value), f = function (x) { return fmtVal(x) + (s.unit ? " " + s.unit : ""); };
    if (v === null) return st;
    if (st === "critical") {
      if (num(s.threshold_critical) !== null && v > num(s.threshold_critical)) return "critical · above " + f(s.threshold_critical);
      if (num(s.threshold_critical_low) !== null && v < num(s.threshold_critical_low)) return "critical · below " + f(s.threshold_critical_low);
      return "critical";
    }
    if (st === "warning") {
      if (num(s.threshold_warning) !== null && v > num(s.threshold_warning)) return "warning · above " + f(s.threshold_warning);
      if (num(s.threshold_min) !== null && v < num(s.threshold_min)) return "warning · below " + f(s.threshold_min);
      return "warning";
    }
    return "normal";
  }
  function wallTiles(assets, ctx, n) {
    ctx = ctx || {}; n = n || 8;
    var recs = ctx.recs || {}, pins = ctx.pins || {}, all = [];
    Object.keys(assets || {}).sort().forEach(function (aid) {
      var ss = (assets[aid] && assets[aid].sensors) || {};
      Object.keys(ss).sort().forEach(function (tag) {
        var s = ss[tag] || {}, st = statusOf(s.status), imp = importance(assets[aid], aid, s, ctx);
        all.push({ key: aid + "|" + tag, aid: aid, tag: tag, status: st, s: s, score: imp.score, why: imp.why, pinned: !!pins[aid + "|" + tag] });
      });
    });
    var by = function (x, y) { return y.score - x.score || (x.key < y.key ? -1 : 1); };
    var out = all.filter(function (t) { return t.status !== "normal"; }).sort(by).map(function (t) { t.kind = t.status === "critical" ? "crit" : "warn"; return t; });
    var outAssets = {}; out.forEach(function (t) { outAssets[t.aid] = 1; });
    var predSeen = {}, pred = [];
    all.filter(function (t) { return t.status === "normal" && recs[t.aid] && !outAssets[t.aid]; }).sort(by).forEach(function (t) {
      if (predSeen[t.aid]) return; predSeen[t.aid] = 1; t.kind = "pred"; pred.push(t);
    });
    var used = {}; out.concat(pred).forEach(function (t) { used[t.key] = 1; });
    // watching: a reading near a limit or low on health, or one someone pinned (being on a predicted machine alone isn't enough)
    var real = function (w) { return w === "low health" || /near its/.test(w); };
    var watch = all.filter(function (t) { return !used[t.key] && t.status === "normal" && (t.pinned || (t.why || []).some(real)); }).sort(by).map(function (t) { t.kind = "watch"; return t; });
    return out.concat(pred, watch).slice(0, n).map(function (t) {
      var s = t.s, lo = num(s.threshold_min), hi = num(s.threshold_warning);
      return { key: t.key, aid: t.aid, tag: t.tag, kind: t.kind, value: s.value, unit: s.unit || "",
        word: t.kind === "pred" ? "in range · NEPHES predicts a developing fault" : t.kind === "watch" ? "normal" + ((t.why || []).filter(real)[0] ? " · " + t.why.filter(real)[0] : t.pinned ? " · pinned" : "") : limitWord(s, t.status),
        band: lo !== null && hi !== null && hi > lo ? [lo, hi] : null };
    });
  }
  var WALL_LABEL = { crit: "Out of range", warn: "Out of range", pred: "Predicted", watch: "Watching" };
  function wallTileHTML(t, isNew, hist) {
    var pos = "";
    if (t.band && num(t.value) !== null) {
      var lo = t.band[0], hi = t.band[1], span = hi - lo, x = (num(t.value) - (lo - span * 0.5)) / (span * 2);
      pos = '<span class="lw-band" aria-hidden="true"><i class="lw-norm"></i><b style="left:' + (Math.max(0, Math.min(1, x)) * 100).toFixed(1) + '%"></b></span>';
    }
    return '<div class="lw-tile ' + t.kind + (isNew ? " lw-new" : "") + '" data-k="' + esc(t.key) + '">' +
      '<span class="lw-m">' + esc(t.aid) + '</span><span class="lw-t">' + esc(plainTag(t.tag)) + "</span>" +
      '<span class="lw-k">' + WALL_LABEL[t.kind] + "</span>" +
      '<span class="lw-v">' + esc(fmtVal(t.value)) + '<small>' + esc(t.unit) + "</small></span>" +
      '<span class="lw-st" title="' + esc(t.word) + '"><i></i>' + esc(t.word) + "</span>" + pos +
      (hist && hist.length > 1 ? '<svg class="lw-sp" viewBox="0 0 220 30" preserveAspectRatio="none" aria-hidden="true"><path d="' + sparkPath(hist, 220, 30, spanOf(t)) + '"/></svg>' +
        '<span class="lw-rng">' + esc(trendKey(hist, t.unit, !!t.compact)) + "</span>" : "") + "</div>";
  }
  /* the key under a trend line: what time it covers and the range it is scaled to (each line fills its own height) */
  function spanOf(t) { return t && t.band && num(t.band[0]) !== null && num(t.band[1]) !== null ? Math.abs(t.band[1] - t.band[0]) * 0.25 : 0; }
  function trendKey(hist, unit, short) {
    var h = (hist || []).filter(function (v) { return num(v) !== null; }).map(Number);
    if (h.length < 2) return "";
    var lo = Math.min.apply(null, h), hi = Math.max.apply(null, h);
    return (short ? "" : "last " + h.length + " readings" + (hasGap(hist) ? " with a gap" : "") + " · ") + (lo === hi ? "flat at " + fmtVal(lo) : fmtVal(lo) + " to " + fmtVal(hi)) + (unit ? " " + unit : "");
  }
  /* the cards across the top: OEE and downtime always, then up to three NEPHES flags as needing focus (worst first) */
  function focusCards(k, drm, plant) {
    k = k || {}; var counts = (drm && drm.counts) || {}, cards = [];
    var oee = num(k.oee);
    cards.push({ id: "oee", label: "OEE", value: oee === null ? "—" : fmtVal(oee), unit: oee === null ? "" : "%", level: "none",
      sub: ["A " + fmtPct(k.availability), "P " + fmtPct(k.performance), "Q " + fmtPct(k.quality)].join(" · ") });
    if (plant && num(plant.downtime_h_12mo) !== null) {
      cards.push({ id: "down", label: "Downtime", value: fmtVal(plant.downtime_h_12mo), unit: "h", level: "none", example: !!plant.example,
        sub: plant.failures_12mo + (plant.failures_12mo === 1 ? " breakdown" : " breakdowns") + " · last 12 months, from work orders" });
    } else cards.push({ id: "down", label: "Downtime", value: "—", unit: "", level: "none", sub: plant && plant.error ? "work orders unavailable" : "loading work orders…" });
    var picks = [];
    var crit24 = num(k.findings_critical_24h);
    if (crit24) picks.push({ id: "crit24", label: "Critical findings", value: String(crit24), unit: "", level: "crit", sub: "last 24 h · from NEPHES" });
    if (plant && plant.pm_overdue) picks.push({ id: "pm", label: "PM overdue", value: String(plant.pm_overdue), unit: "", level: "warn", example: !!plant.example,
      sub: (plant.pm_due ? plant.pm_due + " more due within 7 days · " : "") + "from work orders" });
    if (plant && plant.repeat_machines && plant.repeat_machines.length) picks.push({ id: "rep", label: "Repeat problems", value: String(plant.repeat_machines.length), unit: "", level: "warn", example: !!plant.example,
      sub: (plant.repeat_machines.length === 1 ? "machine" : "machines") + " with the same fault twice in 90 days" });
    if (k.mtbf_available && num(k.mtbf_hours) !== null) picks.push({ id: "mtbf", label: "MTBF", value: fmtVal(k.mtbf_hours), unit: "h", level: "none", sub: "mean time between failures" });
    if (num(counts.open_episodes)) picks.push({ id: "eps", label: "Open episodes", value: String(counts.open_episodes), unit: "", level: "none", sub: "episodes NEPHES is still following" });
    var rank = { crit: 0, warn: 1, none: 2 };
    picks.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
    return cards.concat(picks.slice(0, 3));
  }
  function focusHTML(cards) {
    return cards.map(function (c) {
      return '<div class="lw-card ' + c.level + '" data-card="' + c.id + '"><span class="lw-cl">' + esc(c.label) + (c.example ? ' <span class="lw-ex">example</span>' : "") + "</span>" +
        '<span class="lw-cv">' + esc(c.value) + "<small>" + esc(c.unit) + "</small></span>" + '<span class="lw-cs" title="' + esc(c.sub) + '">' + esc(c.sub) + "</span></div>";
    }).join("");
  }

  /* LL3: the wall's tiles in three lanes, so how bad things are reads from across the room by which lane is full */
  function wallLanes(list) {
    return { out: list.filter(function (t) { return t.kind === "crit" || t.kind === "warn"; }),
             pred: list.filter(function (t) { return t.kind === "pred"; }), watch: list.filter(function (t) { return t.kind === "watch"; }) };
  }
  /* every tile keeps one column's width (no tile, and no trend line, stretched across columns). Empty cells in the last
     row of big tiles take the next watched readings, and the watch rows use the column count that leaves none empty;
     a watched reading that doesn't fit is counted as "+N more on the Feed", never dropped silently. */
  function packWall(L, cols, rowsB, rowsW, cmax) {
    var big = L.out.concat(L.pred).slice(0, rowsB * cols), rest = L.watch.slice();
    var gap = big.length % cols ? cols - big.length % cols : 0;
    if (big.length && gap) big = big.concat(rest.splice(0, gap));
    var best = cmax, bestEmpty = 1e9, shownBest = 0;
    [cmax, cmax - 1, cmax + 1].filter(function (c) { return c >= 2; }).forEach(function (c) {
      var shown = Math.min(rest.length, rowsW * c);
      if (rowsW < 99 && shown > c && shown % c) shown -= shown % c;       // a partial last row is moved to the Feed count instead
      var empty = shown ? (shown < c ? (shown >= 3 ? 0 : c - shown) : 0) : 0;
      if (empty < bestEmpty || (empty === bestEmpty && shown > shownBest)) { best = c; bestEmpty = empty; shownBest = shown; }
    });
    var watch = rest.slice(0, shownBest);
    if (watch.length && watch.length < best && watch.length >= 3) best = watch.length;   // one short row: equal columns, none empty
    return { big: big, watch: watch, ccols: best };
  }
  function laneHTML(title, tiles, cls, cols, hist, ring, now, headHTML) {
    if (!tiles.length) return "";
    // tiles flow in rows of `cols`; the last row's tiles widen to fill it, so a lane never leaves empty cells
    return '<div class="lw-lane ' + cls + '"><div class="lw-lh">' + (headHTML || esc(title) + " <b>" + tiles.length + "</b>") + "</div>" +
      '<div class="lw-lg" style="--c:' + cols + '">' +
      tiles.map(function (t) { return wallTileHTML(t, ring && ring[t.key] > now, hist && hist[t.key]); }).join("") + "</div></div>";
  }
  /* every machine at a glance, worst first: its health and status in a word (for monitoring the whole plant) */
  function machinesHTML(assets) {
    var rows = Object.keys(assets || {}).map(function (aid) {
      var a = assets[aid] || {}, ss = a.sensors || {}, tags = Object.keys(ss), out = 0, crit = 0;
      tags.forEach(function (t) { var st = statusOf(ss[t].status); if (st !== "normal") out++; if (st === "critical") crit++; });
      var st = crit ? "critical" : out ? "warning" : "normal", h = num(a.health);
      return { aid: aid, st: st, h: h, n: tags.length, out: out };
    }).filter(function (r) { return r.n; });
    var rank = { critical: 0, warning: 1, normal: 2 };
    rows.sort(function (x, y) { return rank[x.st] - rank[y.st] || ((x.h === null ? 101 : x.h) - (y.h === null ? 101 : y.h)) || (x.aid < y.aid ? -1 : 1); });
    return '<div class="lw-mg" tabindex="0" role="region" aria-label="Machines, worst first">' + rows.map(function (r) {
      return '<div class="lw-mr ' + r.st + '"><i></i><span class="lw-mn">' + esc(r.aid) + '</span><span class="lw-mw">' + (r.st === "normal" ? "normal" : r.st + " · " + r.out + " of " + r.n) + "</span>" +
        '<span class="lw-mh">' + (r.h === null ? "—" : Math.round(r.h) + "%") + "</span></div>";
    }).join("") + "</div>";
  }
  /* ── machine grid (F14): every machine at once, worst first ──
     A reading's state comes only from its limits (the ones alerts use), its own timestamp and nothing else: no colour
     guesses and no health score. A reading with no limits is "no limits set", never "in limits"; an old one is "stale",
     whatever it read. NEPHES findings ride on the tile as advice and never change a colour. */
  var ST_ORDER = { alert: 0, watch: 1, stale: 2, nodata: 3, unchecked: 4, ok: 5 };
  var ST_WORD = { alert: "alert", watch: "watch", stale: "stale", nodata: "no data", unchecked: "no limits set", ok: "in limits" };
  function hasLimits(s) { return !!s && [s.threshold_min, s.threshold_warning, s.threshold_critical, s.threshold_critical_low].some(function (v) { return num(v) !== null; }); }
  function sensorState(s, nowSec, staleS) {
    if (!s || num(s.value) === null) return "nodata";
    var ts = num(s.timestamp), now = num(nowSec);
    if (ts !== null && now !== null && now - ts > staleS) return "stale";
    if (!hasLimits(s)) return "unchecked";
    var st = statusOf(s.status);
    return st === "critical" ? "alert" : st === "warning" ? "watch" : "ok";
  }
  function machineGrid(assets, opts) {
    opts = opts || {};
    var now = num(opts.nowSec), staleS = opts.staleS || 10, recs = opts.recs || {};
    var counts = { ok: 0, watch: 0, alert: 0, stale: 0, nodata: 0, unchecked: 0, silent: 0, readings: 0 };
    var machines = Object.keys(assets || {}).map(function (aid) {
      var a = assets[aid] || {}, ss = a.sensors || {};
      var rows = Object.keys(ss).map(function (tag) {
        var s = ss[tag] || {}, st = sensorState(s, now, staleS), ts = num(s.timestamp);
        counts[st]++; counts.readings++;
        return { key: aid + "|" + tag, tag: tag, label: s.label && s.label !== tag ? String(s.label) : plainTag(tag), value: num(s.value), unit: s.unit || "",
          state: st, was: statusOf(s.status), age: ts !== null && now !== null ? Math.max(0, now - ts) : null,
          lo: num(s.threshold_min), hi: num(s.threshold_warning), clo: num(s.threshold_critical_low), chi: num(s.threshold_critical), src: s.limit_source || null };
      }).sort(function (x, y) { return ST_ORDER[x.state] - ST_ORDER[y.state] || (x.tag < y.tag ? -1 : 1); });
      if (!rows.length) counts.silent++;
      return { aid: aid, shown: a.display_id && a.display_id !== aid ? String(a.display_id) : aid, name: a.asset_name && a.asset_name !== aid ? String(a.asset_name) : "",
        state: rows.length ? rows[0].state : "nodata", rows: rows, rec: recs[aid] || null };
    }).sort(function (x, y) { return ST_ORDER[x.state] - ST_ORDER[y.state] || (x.aid < y.aid ? -1 : 1); });
    return { machines: machines, counts: counts };
  }
  function ageWord(s) { s = Math.round(s); return s < 90 ? s + " s" : s < 5400 ? Math.round(s / 60) + " min" : Math.round(s / 3600) + " h"; }
  /* the strip over the grid: how many readings are in each state, said in words; zero counts stay so the line reads the same every time */
  function countsHTML(g, opts) {
    opts = opts || {};
    var c = g.counts, part = function (k, n) { return '<span class="mg-c st-' + k + '"><i aria-hidden="true"></i><b>' + n + "</b> " + ST_WORD[k] + "</span>"; };
    var items = ["ok", "watch", "alert", "stale", "nodata"].map(function (k) { return part(k, c[k]); });
    if (c.unchecked) items.push(part("unchecked", c.unchecked));
    if (c.silent) items.push('<span class="mg-c st-nodata"><i aria-hidden="true"></i><b>' + c.silent + "</b> machine" + (c.silent === 1 ? "" : "s") + " sending nothing</span>");
    return '<div class="mg-strip" role="status" aria-label="Readings by state">' + items.join('<span class="mg-dot" aria-hidden="true">·</span>') +
      '<span class="mg-of">' + c.readings + " readings on " + g.machines.length + " machine" + (g.machines.length === 1 ? "" : "s") +
      (opts.sim ? ' <span class="lw-ex">simulated</span>' : "") + (opts.asOf ? " · as of " + esc(opts.asOf) : "") + "</span></div>";
  }
  function rangeWord(r) {
    var u = r.unit ? " " + r.unit : "", f = function (v) { return esc(fmtVal(v)); };
    var band = r.lo !== null && r.hi !== null ? f(r.lo) + " – " + f(r.hi) + esc(u) : r.hi !== null ? "up to " + f(r.hi) + esc(u) : r.lo !== null ? "from " + f(r.lo) + esc(u) : "";
    var crit = [r.clo !== null ? "below " + f(r.clo) : "", r.chi !== null ? "above " + f(r.chi) : ""].filter(Boolean).join(" or ");
    return band ? "Limits " + band + (r.src ? " (" + esc(LIMIT_WORD[r.src] || r.src) + ")" : "") + (crit ? " · alert " + crit + esc(u) : "") : "No limits set for this reading, so NFO doesn't judge it.";
  }
  function rowHTML(r, id, open, hist) {
    var word = r.state === "stale" && r.age !== null ? "stale · " + ageWord(r.age) : ST_WORD[r.state];
    var sp = hist && hist.length > 1 ? sparkPath(hist, 60, 16) : "";
    var html = '<li class="mg-r st-' + r.state + (open ? " open" : "") + '" data-k="' + esc(r.key) + '">' +
      '<button type="button" class="mg-rb" aria-expanded="' + (open ? "true" : "false") + '" aria-controls="' + id + '" aria-label="' + esc(r.label + ", " + word + (open ? ", hide details" : ", show details")) + '">' +
      '<i aria-hidden="true"></i><span class="mg-t" title="' + esc(r.label) + '">' + esc(r.label) + "</span>" +
      '<span class="mg-v">' + (r.value === null ? "—" : esc(fmtVal(r.value))) + "<small>" + esc(r.unit) + "</small></span>" +
      '<svg class="mg-sp" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><path d="' + sp + '"/></svg>' +
      '<span class="mg-w">' + esc(word) + "</span></button>";
    if (open) html += '<div class="mg-x" id="' + id + '">' + rowDetail(r, hist) + "</div>";
    return html + "</li>";
  }
  function rowDetail(r, hist) {
    var read = r.age === null ? "" : r.state === "stale" ? "Last reading " + ageWord(r.age) + " old; it was " + esc(r.was === "normal" ? "in limits" : r.was) + " then. Not judged since."
      : "Read " + ageWord(r.age) + " before this update.";
    var line = trendKey(hist, r.unit);
    return "<p>" + rangeWord(r) + "</p>" + (read ? "<p>" + read + "</p>" : "") + (line ? '<p class="mg-k">Line: ' + esc(line) + "</p>" : "") +
      '<button type="button" class="btn mg-open" data-open="' + esc(r.key) + '">Open in Details</button>';
  }
  function machineTileHTML(m, opts) {
    opts = opts || {};
    var hist = opts.hist || {};
    // NEPHES advice is a small marker beside the name, never a colour: the readings keep their own states
    var rec = m.rec ? '<span class="mg-adv" title="' + esc("NEPHES flags this machine (" + m.rec + "). Advice, not a reading.") + '"><i aria-hidden="true"></i>NEPHES ' + esc(m.rec) + "</span>" : "";
    return '<section class="mg-tile' + (opts.ring ? " lw-new" : "") + '" data-m="' + esc(m.aid) + '" aria-label="' + esc(m.shown + ": " + ST_WORD[m.state]) + '">' +
      '<header class="mg-h"><span class="mg-n" title="' + esc(m.name ? m.shown + " · " + m.name : m.shown) + '">' + esc(m.shown) + "</span>" +
      (opts.sim ? '<span class="lw-ex" title="Readings come from the simulator, not plant equipment">simulated</span>' : "") + rec +
      '<span class="mg-s st-' + m.state + '"><i aria-hidden="true"></i>' + esc(ST_WORD[m.state]) + "</span></header>" +
      (m.rows.length ? '<ul class="mg-rows">' + m.rows.map(function (r, i) { return rowHTML(r, "mgx-" + (opts.idx || 0) + "-" + i, opts.open === r.key, hist[r.key]); }).join("") + "</ul>"
        : '<p class="mg-none">No readings from this machine.</p>') + "</section>";
  }

  /* ── NEPHES insights, the first thing on the wall ──
     Bigger, not bolder: each insight keeps its evidence, says that its cause is inferred from a pattern of findings
     (correlation, not a confirmed cause), gives the data window it rests on, and lists the steps with lockout/tagout.
     No confidence figure (RecommendationCity's is a fixed per-severity prior) and no forecast wording. */
  var INS_WORD = { critical: "critical", warning: "warning", watch: "watch", info: "info" };
  function hhmm(iso) { var t = Date.parse(iso); return isFinite(t) ? new Date(t).toTimeString().slice(0, 5) : ""; }
  function windowWord(w) {
    if (!w || !num(w.findings)) return "not recorded for this insight.";
    var a = hhmm(w.first), b = hhmm(w.last), n = num(w.findings);
    return n + " finding" + (n === 1 ? "" : "s") + (a && b ? (a === b ? " at " + a : " from " + a + " to " + b) : "") + (w.scope ? " · " + w.scope : "");
  }
  function insightHTML(r, opts) {
    opts = opts || {};
    var sev = String(r.severity || "info").toLowerCase(), word = INS_WORD[sev] || esc(sev), aid = r.asset_id || "unknown";
    var ev = (r.reasons || []).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (r.source_cities && r.source_cities.length) ev.push("Sources: " + r.source_cities.join(", "));
    // what the advice rests on, with its caveats; a signal-quality caveat is to be checked before any hands-on step
    var cav = "";
    (r.evidence_basis || []).forEach(function (x) {
      if (!x || ev.indexOf(x) !== -1 || /source city layer/i.test(x)) return;
      if (/signal.quality|validate sensor/i.test(x)) cav += '<li class="ni-cav"><b>Check first</b> ' + esc(x) + "</li>";
      else ev.push(x);
    });
    var rec = r.evidence_record && r.evidence_record.line ? '<li class="ni-er">Evidence check: ' + esc(r.evidence_record.line) + "</li>" : "";
    var steps = (r.actions || []).map(function (a) {
      var safe = /lockout|tagout|\bLOTO\b/i.test(a);
      return "<li" + (safe ? ' class="ni-safe"><b>Safety</b> ' : ">") + esc(a) + "</li>";
    }).join("");
    return '<article class="ni st-' + esc(sev) + '" data-a="' + esc(aid) + '">' +
      '<header class="ni-h"><span class="ni-m">' + esc(opts.shown || aid) + "</span>" + (opts.sim ? '<span class="lw-ex">simulated readings</span>' : "") +
      '<span class="ni-s"><i aria-hidden="true"></i>' + word + '</span><span class="ni-t">' + esc(hhmm(r.timestamp)) + "</span></header>" +
      '<p class="ni-c">' + esc(r.likely_cause || "No cause named") + ' <span class="ni-corr">suspected cause · correlation in findings, not a confirmed cause</span></p>' +
      (r.maintenance_window ? '<p class="ni-w">When: ' + esc(r.maintenance_window) + "</p>" : "") +
      '<div class="ni-b"><div class="ni-ev"><h4>Evidence</h4><ul>' + ev.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + cav + rec + "</ul>" +
      '<p class="ni-dw"><b>Data</b> ' + esc(windowWord(r.data_window)) + "</p></div>" +
      (steps ? '<div class="ni-st"><h4>Steps</h4><ol>' + steps + "</ol></div>" : "") + "</div></article>";
  }
  function insightsHTML(ai, opts) {
    opts = opts || {};
    if (!ai) return '<p class="note">Loading NEPHES insights…</p>';
    if (ai.error) return '<p class="note">NEPHES insights are unavailable right now (' + esc(ai.error) + "). The machine grid still shows every reading.</p>";
    var recs = sortRecs(ai.recommendations || []).filter(function (r) { return statusOf(r.severity) !== "normal"; });
    if (!recs.length) return '<p class="note">NEPHES has no open advice. Every machine is listed beside this.</p>';
    return recs.map(function (r) { return insightHTML(r, { sim: opts.sim, shown: opts.names && opts.names[r.asset_id] }); }).join("");
  }

  function money(v) { var n = num(v); return n === null ? "—" : "$" + Math.round(n).toLocaleString("en-US"); }
  /* NEPHES Insights for the owner: what NEPHES's recommendations are worth, confirmed apart from estimated */
  function valueHTML(v) {
    if (!v) return '<p class="note">Loading…</p>';
    if (v.error) return '<p class="note">Recommendation records unavailable.</p>';
    var d = v.demo || {}, allDemo = d.n && d.confirmed_savings === v.confirmed.savings && d.estimated_savings === v.estimated.savings;
    // the example note comes first, so it can never be cut off below the figures
    return '<div class="lw-val">' + (d.n ? '<div class="lw-vd"><span class="lw-ex">example</span> ' + (allDemo ? "All from " + d.n + " simulated demo recommendations" :
        d.n + " of " + v.total + " are simulated demo records (" + money(d.confirmed_savings + d.estimated_savings) + ")") + "</div>" : "") +
      '<div class="lw-vr"><span class="lw-vl">Confirmed savings</span><span class="lw-vv ok">' + money(v.confirmed.savings) + '</span>' +
      '<span class="lw-vs">' + v.confirmed.n + " validated by maintenance · " + fmtVal(v.confirmed.downtime_h) + " h downtime avoided</span></div>" +
      '<div class="lw-vr"><span class="lw-vl">Estimated, not yet confirmed</span><span class="lw-vv">' + money(v.estimated.savings) + '</span>' +
      '<span class="lw-vs">NEPHES estimate · ' + v.estimated.n + " open · " + fmtVal(v.estimated.downtime_h) + " h downtime at stake</span></div>" +
      '<div class="lw-vs lw-va">Acted on ' + v.acted + " of " + v.total + (v.rejected ? " · " + v.rejected + " rejected" : "") + "</div></div>";
  }
  function renderWall(groups, selected, byAsset) {
    if (!groups.length) return '<p class="note">No sensors match.</p>';
    return groups.map(function (g) {
      return '<h4 class="wall-group">' + esc(g.group) + " · " + g.tiles.length + "</h4>" + g.tiles.map(function (t) {
        var label = t.aid + " " + t.tag;
        return '<div class="sensor' + (t.pinned ? " pinned" : "") + '" data-k="' + esc(t.key) + '">' +
          '<button type="button" class="sensor-open" aria-pressed="' + (t.key === selected) + '" aria-label="' + esc(label + ", " + t.status + ". Show detail") + '">' +
          tileInner(t, byAsset) + "</button>" +
          '<button type="button" class="pin" data-pin="' + esc(t.key) + '" aria-pressed="' + !!t.pinned + '" aria-label="' + (t.pinned ? "Unpin " : "Pin ") + esc(label) + '" title="' +
          (t.pinned ? "Unpin" : "Pin to the top of the wall") + '">' + PIN_SVG + "</button></div>";
      }).join("");
    }).join("");
  }
  function wallSig(groups) { return groups.map(function (g) { return g.group + ":" + g.tiles.map(function (t) { return t.key + "=" + t.status + (t.pinned ? "p" : "") + "/" + (t.why || []).join(","); }).join(","); }).join(";"); }

  /* ── needs attention (AI analysis) ── */
  function sortRecs(recs) {
    var ord = { critical: 0, warning: 1 };
    return (recs || []).slice().sort(function (a, b) {
      var sa = ord[statusOf(a.severity)] !== undefined ? ord[statusOf(a.severity)] : 2;
      var sb = ord[statusOf(b.severity)] !== undefined ? ord[statusOf(b.severity)] : 2;
      return sa !== sb ? sa - sb : (b.source_count || 0) - (a.source_count || 0);
    });
  }
  function renderAttention(d, mitActive, limit) {
    if (!d) return '<p class="note">Loading analysis…</p>';
    if (d.error) return '<p class="note">Analysis unavailable (' + esc(d.error) + "). The last good list is kept when there is one.</p>";
    var html = "", a = d.assessment;
    if (a && a.available && a.summary) {   // the summary usually starts with the asset name already: don't say it twice
      var said = a.asset_id && String(a.summary).indexOf(a.asset_id) === 0;
      html += '<p class="note" style="margin:0 0 6px">' + (a.asset_id && !said ? '<span class="mono">' + esc(a.asset_id) + "</span> · " : "") + esc(a.summary) + "</p>";
    }
    var recs = sortRecs(d.recommendations).slice(0, limit || 6);
    if (!recs.length) return html + '<p class="note">No active recommendations. All assets read within their nominal bands.</p>';
    return html + recs.map(function (r) {
      var st = statusOf(r.severity), word = st === "normal" ? "info" : st;
      var msg = r.operator_summary || r.message || r.title || "";
      var n = num(r.source_count);
      var ev = n === null ? "" : n + " finding" + (n === 1 ? "" : "s") + " reviewed";
      var act = "";
      // read-only for now: no Start mitigation (NFO_READ_ONLY); an asset still under an older mitigation says so
      if (st !== "normal" && r.asset_id && mitActive && mitActive[r.asset_id]) act = '<span class="pill">mitigation recorded</span>';
      return '<div class="attn"><span class="pill ' + word + '">' + word + "</span>" +
        '<div class="what"><span class="mono">' + esc(r.asset_id || "plant") + "</span>" + (r.title && r.title !== msg && !/^recommended action on /i.test(r.title) ? " · " + esc(r.title) : "") + "</div>" +
        "<div>" + act + "</div>" +
        '<div class="why">' + esc(msg) + "</div>" + (ev ? '<div class="ev" title="Severity is rule-based; no calibrated confidence is computed for analysis cards.">' + esc(ev) + "</div>" : "") +
        "</div>";
    }).join("");
  }

  /* ── events ── */
  function renderEvents(events, filter) {
    var rows = (events || []).filter(function (e) {
      var w = sevWord(e.severity);
      return !filter || filter === "all" || w === filter;
    });
    if (!rows.length) return '<p class="note">' + (events && events.length ? "No events at this level." : "No events yet.") + "</p>";
    return rows.map(function (e) {
      var w = sevWord(e.severity);
      return '<div class="evrow"><time>' + esc(String(e.timestamp || "").slice(11, 19)) + '</time><div class="msg"><span class="pill ' + w + '">' + w + "</span> " +
        (e.asset_id ? '<span class="mono">' + esc(e.asset_id) + "</span> " : "") + esc(e.message || e.event_type || "") + "</div></div>";
    }).join("");
  }
  function critCount(events) { return (events || []).filter(function (e) { return sevWord(e.severity) === "critical"; }).length; }

  /* ── sensor detail ── */
  function renderDetail(a, aid, tag, hist) {
    var s = a && a.sensors && a.sensors[tag];
    if (!s) return '<p class="note">Select a sensor on the wall to see its recent readings against its limit.</p>';
    var unit = s.unit ? " " + s.unit : "", st = statusOf(s.status);
    var h = (hist || []).filter(function (v) { return num(v) !== null; }).map(Number);
    var lo = s.threshold_min, warn = s.threshold_warning;
    var html = '<p class="note" style="margin:0 0 10px">' + esc((a.asset_name || aid) + (a.location ? " · " + a.location : "")) +
      " · nominal " + esc(lo !== undefined && lo !== null ? lo : "?") + " – " + esc(warn !== undefined && warn !== null ? warn : "?") + esc(unit) + "</p>" +
      '<div class="stat3"><div><div class="l">Value</div><div class="v">' + esc(fmtVal(s.value)) + esc(unit) + "</div></div>" +
      '<div><div class="l">Health</div><div class="v">' + (num(s.health) === null ? "—" : Math.round(num(s.health)) + "%") + "</div></div>" +
      '<div><div class="l">Status</div><div class="v"><span class="pill ' + st + '">' + st + "</span></div></div></div>";
    if (h.length >= 2) {
      var W = 300, H = 64, mn = Math.min.apply(null, h), mx = Math.max.apply(null, h);
      var top = num(warn) !== null ? Math.max(mx, num(warn)) : mx, bot = num(warn) !== null ? Math.min(mn, num(warn)) : mn, r = top - bot || 1;
      var y = function (v) { return (H - 2 - (v - bot) / r * (H - 4)).toFixed(1); };
      var all = hist || [], pen = false, d = "";
      all.forEach(function (v, i) { if (num(v) === null) { pen = false; return; } d += (d ? (pen ? " L" : " M") : "M") + (i / (all.length - 1) * W).toFixed(1) + " " + y(Number(v)); pen = true; });
      var avg = h.reduce(function (p, q) { return p + q; }, 0) / h.length;
      html += '<svg viewBox="0 0 300 64" preserveAspectRatio="none" style="width:100%;height:64px;margin:12px 0 4px" role="img" aria-label="Last ' + h.length + ' readings' + (hasGap(hist) ? ", with a gap where no readings arrived" : "") + (num(warn) !== null ? ", warning limit " + esc(warn) + esc(unit) : "") + '">' +
        (num(warn) !== null ? '<line x1="0" x2="300" y1="' + y(num(warn)) + '" y2="' + y(num(warn)) + '" stroke="' + nfoColor("--pill-warn", "#dcae4f") + '" stroke-dasharray="4 3" stroke-width="1"></line>' : "") +
        '<path d="' + d + '" fill="none" stroke="' + (st === "critical" ? nfoColor("--crit", "#c27a72") : st === "warning" ? nfoColor("--warn", "#dcae4f") : nfoColor("--good", "#6f9e80")) + '" stroke-width="2" vector-effect="non-scaling-stroke"></path></svg>' +
        '<div class="row" style="justify-content:space-between"><span class="mono note">min ' + esc(fmtVal(mn)) + " · avg " + esc(fmtVal(avg)) + " · max " + esc(fmtVal(mx)) + "</span>" +
        (num(warn) !== null ? '<span class="mono note" style="color:var(--pill-warn)">limit ' + esc(warn) + "</span>" : "") + "</div>";
    } else {
      html += '<p class="note" style="margin-top:10px">Collecting readings for the trend…</p>';
    }
    return html;
  }

  /* ── alert limits (nephes/sensor_limits.py): yours win, then learned, then the default ── */
  var LIMIT_WORD = { user: "set by you", learned_accepted: "learned band, pinned", learned: "learned", default: "default" };
  function renderLimits(info, unit, opts) {
    opts = opts || {};
    if (!info) return '<p class="note">' + esc(opts.msg || "Loading alert limits…") + "</p>";
    var e = info.effective, L = info.learned, cur = info.current, u = unit ? " " + esc(unit) : "";
    var f = function (v) { return v === null || v === undefined ? "—" : esc(fmtVal(v)); };
    var html = '<div class="lim-now">' + (e
      ? '<span class="mono">' + f(e.low) + " – " + f(e.high) + u + '</span> <span class="tag">' + esc(LIMIT_WORD[e.source] || e.source) + "</span>" +
        '<div class="note">critical below ' + f(e.crit_low) + " or above " + f(e.crit_high) + u + "</div>"
      : '<span class="note">No limits known for this sensor: it is never flagged. Set some below.</span>') + "</div>";
    if (cur && cur.mode !== "auto") html += '<div class="note">Rev ' + esc(cur.revision) + " by " + esc(cur.by || "?") + " · " + esc(cur.at || "") + (cur.note ? " · " + esc(cur.note) : "") + "</div>";
    if (L) {
      html += '<div class="note lim-learn">Learned from ' + esc(L.n) + " readings over " + esc(L.hours) + " h" + (L.source ? " (" + esc(L.source) + ")" : "") +
        ": average " + f(L.mean) + u + ", ±3σ " + f(L.low) + " – " + f(L.high) + u +
        (L.skipped ? " · " + esc(L.skipped) + " critical readings not learned from" : "") +
        (L.ready ? "" : " · needs " + esc(L.needs.samples) + " more readings and " + esc(L.needs.hours) + " h before it's used") + "</div>";
      if (L.source && /replay|sim/i.test(L.source)) html += '<div class="note" style="color:var(--pill-warn)">Learned from simulated data, not the plant.</div>';
    } else {
      html += '<div class="note lim-learn">Nothing learned yet: NEPHES learns this sensor\'s typical readings while it runs.</div>';
    }
    if (!info.can_edit) return html + '<p class="note">' + esc(opts.why || "Changing limits needs an admin or operator sign-in.") + "</p>";
    var v = function (k) { var x = cur && cur.mode === "user" ? cur[k] : e ? e[k] : ""; return x === null || x === undefined ? "" : esc(Number(x.toPrecision ? x.toPrecision(6) : x)); };
    html += '<form class="lim-form" id="v4LimForm"><div class="grid cols-2" style="gap:8px">' +
      '<label class="label">Warning low<input class="field" type="number" step="any" name="low" value="' + v("low") + '" required></label>' +
      '<label class="label">Warning high<input class="field" type="number" step="any" name="high" value="' + v("high") + '" required></label>' +
      '<label class="label">Critical low<input class="field" type="number" step="any" name="crit_low" value="' + (cur && cur.mode === "user" ? v("crit_low") : "") + '" placeholder="auto"></label>' +
      '<label class="label">Critical high<input class="field" type="number" step="any" name="crit_high" value="' + (cur && cur.mode === "user" ? v("crit_high") : "") + '" placeholder="auto"></label></div>' +
      '<label class="label">Note<input class="field" name="note" maxlength="200" placeholder="why (optional)"></label>' +
      '<div class="row" style="margin-top:8px"><button class="btn primary sm" type="submit">Save limits</button>' +
      '<button class="btn sm" type="button" data-lim="learned"' + (L && L.n >= 2 ? "" : " disabled") + ">Use learned band</button>" +
      '<button class="btn sm ghost" type="button" data-lim="auto"' + (cur && cur.mode !== "auto" ? "" : " disabled") + ">Back to automatic</button></div>" +
      '<p class="note" id="v4LimMsg" role="status" style="margin:6px 0 0">' + esc(opts.msg || "") + "</p></form>";
    return html;
  }

  /* ── mitigation ── */
  function mitEntries(status) {
    return Object.keys(status || {}).filter(function (k) { return status[k] && status[k].active; })
      .map(function (k) { return [k, status[k]]; })
      .sort(function (a, b) { return (b[1].started_at || 0) - (a[1].started_at || 0); });
  }
  function renderMitRows(entries) {
    if (!entries.length) return '<tr><td colspan="5" class="dim">No active mitigations.</td></tr>';
    return entries.map(function (e) {
      var m = e[1], t = m.started_at ? new Date(m.started_at * 1000).toTimeString().slice(0, 8) : "—";
      var g = num(m.expected_gain);
      return '<tr><td class="mono" style="color:var(--text)">' + esc(e[0]) + "</td><td>" + esc(m.recommendation || "(no plan text)") + "</td>" +
        '<td class="mono">' + esc(t) + (m.auto ? " · auto" : "") + '</td><td class="right">' + (g ? "+" + g.toFixed(1) + " pp" : "—") + "</td>" +
        '<td><button class="btn sm" type="button" data-act="complete" data-asset="' + esc(e[0]) + '">Complete</button></td></tr>';
    }).join("");
  }

  /* ── network devices (same endpoints as v3: /network/scan, /network/devices) ── */
  function isController(d) { var p = String((d && d.protocol) || ""); return !!p && p !== "UNKNOWN" && p !== "—"; }
  function renderScanRows(devices, selected) {
    if (!devices) return '<tr><td colspan="7" class="dim">No scan yet. Press Scan network.</td></tr>';
    if (!devices.length) return '<tr><td colspan="7" class="dim">No devices found on this computer\'s local network.</td></tr>';
    return devices.slice().sort(function (a, b) { return (isController(b) ? 1 : 0) - (isController(a) ? 1 : 0); }).map(function (d) {
      var ip = String(d.ip || ""), on = !!(selected && selected[ip]), ctrl = isController(d);
      return "<tr><td><input type=\"checkbox\" data-net-pick=\"" + esc(ip) + "\" aria-label=\"Select " + esc(ip) + "\"" + (on ? " checked" : "") + "></td>" +
        '<td class="mono" style="color:var(--text)">' + esc(ip) + "</td><td>" + esc(d.hostname || "—") + '</td><td class="mono">' + esc(d.mac || "—") + "</td>" +
        "<td>" + (ctrl ? '<span class="pill ok">' + esc(d.protocol) + "</span>" : '<span class="dim">' + esc(d.protocol || "—") + "</span>") + "</td>" +
        "<td>" + esc(d.location || "—") + "</td><td>" + esc(d.asset_name || "—") + "</td></tr>";
    }).join("");
  }
  function renderConfigured(devs, confirming) {
    if (!devs || !devs.length) return '<p class="note">No devices added yet.</p>';
    var byLoc = {};
    devs.forEach(function (d) { var l = d.location || "Unassigned"; (byLoc[l] = byLoc[l] || []).push(d); });
    return Object.keys(byLoc).sort().map(function (l) {
      return '<h4 class="wall-group">' + esc(l) + " · " + byLoc[l].length + "</h4>" + byLoc[l].map(function (d) {
        var ip = String(d.ip || ""), c = confirming === ip;
        return '<div class="evrow" style="grid-template-columns: 130px minmax(0,1fr) auto auto; align-items: center">' +
          '<span class="mono" style="color:var(--text)">' + esc(ip) + "</span><span>" + esc(d.asset_name || d.hostname || "—") + "</span>" +
          (isController(d) ? '<span class="pill ok">' + esc(d.protocol) + "</span>" : '<span class="dim">no protocol</span>') +
          '<button class="btn sm' + (c ? " danger" : " ghost") + '" type="button" data-net-remove="' + esc(ip) + '">' + (c ? "Confirm remove" : "Remove") + "</button></div>";
      }).join("");
    }).join("");
  }

  /* Pinned sensors: kept in this browser (per viewer, per computer). */
  var PIN_KEY = "nephes.console.v4.pins";
  function loadPins() {
    try { var v = JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(PIN_KEY)) || "{}"); return v && typeof v === "object" ? v : {}; }
    catch (e) { return {}; }
  }
  function savePins(p) { try { localStorage.setItem(PIN_KEY, JSON.stringify(p)); } catch (e) { /* private window: pins last this visit */ } }

  /* ════════ page wiring ════════ */
  function mount(doc, env) {
    env = env || {};
    var win = env.window || doc.defaultView || {};
    var $ = function (id) { return doc.getElementById(id); };
    var fetchImpl = env.fetch || function (u, o) { return win.fetch(u, o); };
    var S = {
      assets: {}, live: false, hist: {}, kpi: { oee: [], mtbf: [], eps: [], findings: [] }, selected: null,
      lastOk: 0, events: [], evFilter: "all", ai: null, mit: {}, filter: { group: "priority", status: "all", search: "" }, pins: loadPins(),
      sig: "", critSeen: {}, first: true, notPlant: false, mode: "live", ws: null, wsLast: 0, wsTries: 0, timers: [],
      snapTime: null, histTs: {}, age: null, frame: null, data: null
    };

    function setStatus() {
      var chip = $("v4Status"); if (!chip) return;
      // stale is judged on the readings, not on messages arriving: a backend still answering with old readings isn't live
      var fs = floorSummary(S.assets), quiet = S.live && Date.now() - S.lastOk > 10000, old = S.live && !quiet && S.age !== null && S.age > 10;
      var cls = !S.live ? "" : quiet || old ? "off" : S.notPlant ? "mock" : "live";
      var text = !S.live ? "connecting" : quiet ? "offline · last data " + new Date(S.lastOk).toTimeString().slice(0, 8)
        : old ? "no new readings for " + Math.round(S.age) + " s"
        : (S.notPlant ? "not plant data · " : "live · ") + fs.sensors + " sensors";
      var html = '<span class="led"></span>' + esc(text);
      if (chip.className !== "status-chip " + cls) chip.className = "status-chip " + cls;
      if (chip.innerHTML !== html) chip.innerHTML = html;
      var b = $("v4Banner");
      if (b) { var was = b.hidden, msg = quiet ? "No data from the backend for over 10 s. Showing the last good snapshot."
          : old ? "The backend is answering, but its newest reading is " + Math.round(S.age) + " s old. Showing those readings." : "";
        b.hidden = !msg; if (b.textContent !== msg) b.textContent = msg;
        if (was !== b.hidden) renderBigWall(true); }   // the notice moves the wall down: fit it again even though no data is arriving
    }

    function push(arr, v, n) { if (num(v) === null) return; arr.push(Number(v)); if (arr.length > n) arr.shift(); }

    function renderKpis(k, drm) {
      k = k || {};
      var counts = (drm && drm.counts) || {};
      push(S.kpi.oee, k.oee, 12); push(S.kpi.mtbf, k.mtbf_hours, 12); push(S.kpi.eps, counts.open_episodes, 12); push(S.kpi.findings, counts.findings, 12);
      var defs = [["oee", fmtPct(k.oee), true, "pp"], ["mtbf", num(k.mtbf_hours) === null ? "—" : fmtVal(k.mtbf_hours) + " h", true, "h"],
        ["eps", num(counts.open_episodes) === null ? "—" : String(counts.open_episodes), false, ""], ["findings", num(counts.findings) === null ? "—" : Number(counts.findings).toLocaleString("en-US"), false, ""]];
      defs.forEach(function (d) {
        var v = $("v4k_" + d[0]); if (v && v.textContent !== d[1]) v.textContent = d[1];
        var t = trend(S.kpi[d[0]], d[2], d[3]), te = $("v4t_" + d[0]);
        if (d[0] === "mtbf" && d[1] === "—") t = { text: k.mtbf_available === false ? "not enough failures logged yet" : "no failure record", cls: "" };   // say why, not just a dash
        if (te) { te.textContent = t.text; te.className = "trend " + t.cls; }
        var p = $("v4s_" + d[0]); if (p) p.setAttribute("d", sparkPath(S.kpi[d[0]], 84, 22));
      });
      [["avail", k.availability], ["perf", k.performance], ["qual", k.quality]].forEach(function (d) {
        var n = num(d[1]), f = $("v4b_" + d[0]), t = $("v4n_" + d[0]);
        if (f) f.style.width = (n === null ? 0 : Math.max(0, Math.min(100, n))) + "%";
        if (t) t.textContent = fmtPct(d[1]);
      });
    }

    function renderHealth(sh, fallback) {
      var pct = sh && num(sh.overall_health) !== null ? num(sh.overall_health) : num(fallback);
      var fs = floorSummary(S.assets);
      if ($("v4HealthVal")) $("v4HealthVal").textContent = pct === null ? "—" : Math.round(pct) + "/100";
      if ($("v4HealthLab")) $("v4HealthLab").textContent = (sh && sh.status ? String(sh.status).toLowerCase() + " · " : "") +
        fs.atRisk + " of " + fs.assets + " assets at risk" + (fs.critical ? " · " + fs.critical + " critical" : "");
      if ($("v4HealthRec")) $("v4HealthRec").textContent = (sh && sh.recommendation) || "";
      var tot = fs.assets || 1, g = fs.healthy / tot * 100, y = fs.atRisk / tot * 100;
      setHTML($("v4Bar"), '<div class="nhb-green" style="width:' + g.toFixed(1) + '%"></div><div class="nhb-yellow" style="width:' + y.toFixed(1) + '%">' +
        (fs.atRisk && y >= 12 ? '<span class="nhb-label">' + fs.atRisk + " asset" + (fs.atRisk === 1 ? "" : "s") + "</span>" : "") + '</div><div class="nhb-gray"></div>');
      setHTML($("v4Legend"), '<span><span class="dot green"></span>healthy ' + fs.healthy + "</span><span><span class=\"dot yellow\"></span>at risk " + fs.atRisk +
        '</span><span><span class="dot gray"></span>no data ' + fs.noData + "</span>");
    }
    // rebuild a block only when its markup changed, so an unchanged block isn't torn down and re-created every update
    function setHTML(el, html) { if (!el || el._nfoHtml === html) return; el._nfoHtml = html; el.innerHTML = html; }

    function wallCtx() {
      var recs = {};
      ((S.ai && S.ai.recommendations) || []).forEach(function (r) {
        var st = statusOf(r.severity);
        if (r.asset_id && st !== "normal" && (!recs[r.asset_id] || st === "critical")) recs[r.asset_id] = st;
      });
      return { pins: S.pins, recs: recs };
    }
    function renderWallNow(force) {
      var wall = $("v4Wall"); if (!wall) return;
      if (!S.live) { wall.innerHTML = '<p class="note">Waiting for the first sensor snapshot from the backend…</p>'; return; }
      var groups = tiles(S.assets, S.filter, wallCtx()), sig = wallSig(groups) + "|" + S.selected;
      if (force || sig !== S.sig) {
        // keep keyboard focus on the same tile or pin across a rebuild
        var fa = doc.activeElement, fk = null, fc = null;
        if (fa && wall.contains(fa)) { var host = fa.closest("[data-k]"); if (host) { fk = host.getAttribute("data-k"); fc = fa.classList.contains("pin") ? "pin" : "sensor-open"; } }
        S.sig = sig; wall.innerHTML = renderWall(groups, S.selected, S.filter.group === "asset");
        if (fk) { var again = Array.prototype.find.call(wall.querySelectorAll("[data-k]"), function (e) { return e.getAttribute("data-k") === fk; }); if (again) { var b = again.querySelector("." + fc); if (b) b.focus(); } }
      }
      else {
        groups.forEach(function (g) { g.tiles.forEach(function (t) {
          var el = wall.querySelector('[data-k="' + (win.CSS && win.CSS.escape ? win.CSS.escape(t.key) : t.key.replace(/"/g, '\\"')) + '"]');
          if (!el) return;
          var v = el.querySelector('[data-f="v"]'), want = esc(fmtVal(t.value)) + '<span class="unit">' + esc(t.unit) + "</span>";
          if (v && v.innerHTML !== want) v.innerHTML = want;
          var h = t.health === null ? null : Math.max(0, Math.min(100, t.health));
          var bar = el.querySelector('[data-f="bar"]'); if (bar) bar.style.width = (h === null ? 0 : h) + "%";
          var ht = el.querySelector('[data-f="h"]'); if (ht) ht.textContent = h === null ? "health —" : "health " + Math.round(h) + "%";
        }); });
      }
      var fs = floorSummary(S.assets);
      if ($("v4WallTag")) $("v4WallTag").textContent = fs.sensors + " sensors · " + fs.alerts + " alert" + (fs.alerts === 1 ? "" : "s");
    }

    function renderDetailNow() {
      var box = $("v4Detail"); if (!box) return;
      var parts = S.selected ? S.selected.split("|") : [];
      setHTML(box, renderDetail(S.assets[parts[0]], parts[0], parts[1], S.hist[S.selected]));
      if ($("v4DetailTag")) $("v4DetailTag").textContent = S.selected ? parts[0] + " · " + parts[1] : "none selected";
      if (S.limKey !== S.selected) loadLimits();
    }

    /* the limits block is redrawn only when the selection changes or after a change, never while typing */
    S.limKey = null; S.limInfo = null;
    function limToken() { return S.pinStore && S.pinStore.where === "server" ? S.pinStore.token : null; }
    function paintLimits(msg) {
      var box = $("v4Limits"), card = $("v4LimCard"); if (!box) return;
      if (card) card.hidden = !S.selected;
      if (!S.selected) { box.innerHTML = ""; return; }
      var parts = S.selected.split("|"), a = S.assets[parts[0]], sen = a && a.sensors && a.sensors[parts[1]];
      box.innerHTML = renderLimits(S.limInfo, sen && sen.unit, { msg: msg, why: limToken() ? null : "Changing limits needs a signed-in admin or operator (this computer's preview sign-in, or Replay's)." });
    }
    function loadLimits() {
      S.limKey = S.selected; S.limInfo = null; paintLimits();
      if (!S.selected) return;
      var key = S.selected, parts = key.split("|"), tok = limToken();
      if (!tok) { S.limInfo = { effective: null, learned: null, current: null, can_edit: false, unknown: true }; paintLimits("Sign in to see the learned band and change limits."); return; }
      fetchImpl("/nephes/limits/" + encodeURIComponent(parts[0]) + "/" + encodeURIComponent(parts[1]), { headers: { "Authorization": "Bearer " + tok } })
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (S.limKey === key) { S.limInfo = j; paintLimits(j ? "" : "Couldn't load the limits."); } })
        .catch(function () { if (S.limKey === key) paintLimits("Couldn't load the limits."); });
    }
    function limitAction(path, method, body) {
      var key = S.selected, parts = key.split("|"), tok = limToken();
      return fetchImpl("/nephes/limits/" + encodeURIComponent(parts[0]) + "/" + encodeURIComponent(parts[1]) + path,
        { method: method, headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (S.limKey !== key) return;
          if (!res.ok) { paintLimits("Not saved: " + (res.j.detail || "error")); return; }
          S.limInfo = res.j; paintLimits("Saved. Alerts use these limits from the next reading.");
        }).catch(function () { paintLimits("Not saved: the server didn't answer."); });
    }

    function renderEventsNow() {
      setHTML($("v4Events"), renderEvents(S.events, S.evFilter));
      var c = critCount(S.events);
      if ($("v4EvTag")) $("v4EvTag").textContent = c ? c + " critical" : S.events.length + " recent";
      markTabs();
    }

    /* The push and the poll can both deliver: data is taken in as it arrives (in order, readings only), and the
       page is drawn at most once per frame from the newest snapshot, so a burst of messages is one redraw. */
    function ingest(d) {
      if (!d || !snapNewer(S.snapTime, d.time)) return false;
      S.snapTime = d.time || S.snapTime;
      // hand the same data to the shared header, so it doesn't fetch /dashboard again on this page
      try { doc.dispatchEvent(new win.CustomEvent("nfo:dashboard", { detail: d })); } catch (e) {}
      var ls = d.live_sensors || {}, incoming = ls.assets || {};
      if (Object.keys(incoming).length) { S.assets = incoming; S.live = true; }
      S.lastOk = Date.now(); S.age = readingAge(d); S.builtSec = isFinite(Date.parse(d.time)) ? Date.parse(d.time) / 1000 : null;
      var tick = num(d.drm_status && d.drm_status.tick_rate_s), gapS = Math.max(10, 5 * (tick || 1)); S.staleS = gapS;
      Object.keys(S.assets).forEach(function (aid) {
        var ss = (S.assets[aid] && S.assets[aid].sensors) || {};
        Object.keys(ss).forEach(function (tag) {
          var k = aid + "|" + tag, s = ss[tag] || {};
          if (addReading(S.hist[k] = S.hist[k] || [], s.value, s.timestamp, S.histTs[k], 30, gapS) && num(s.timestamp) !== null) S.histTs[k] = num(s.timestamp);
        });
      });
      var ev = d.events || [];
      ev.forEach(function (e) {
        if (sevWord(e.severity) !== "critical") return;
        var id = (e.timestamp || "") + "|" + (e.asset_id || "") + "|" + (e.message || "");
        if (!S.critSeen[id]) S.critSeen[id] = 1;   // no pop-up toasts: the header pill and the bell already say what needs checking
      });
      S.events = ev;
      S.kpis = d.kpis || null; S.drm = d.drm_status || null;
      S.data = d;
      scheduleDraw();
      return true;
    }
    function draw() {
      S.frame = null;
      var d = S.data; if (!d) return;
      S.data = null; S.draws = (S.draws || 0) + 1;
      renderHealth(d.system_health || null, (d.live_sensors || {}).system_health);
      renderKpis(d.kpis || null, d.drm_status || null);
      // on the Wall only the wall is drawn; Details catches up when it is opened
      if (S.mode === "wall") { renderBigWall(); loadPlant(); } else { renderWallNow(false); renderEventsNow(); renderDetailNow(); }
      refreshAssetOptions(); setStatus();
      S.first = false;
    }
    // the next frame, or 250 ms if frames aren't being drawn (a background window), so the numbers still move
    function scheduleDraw() {
      if (S.frame) return;
      var done = false, run = function () { if (!done) { done = true; draw(); } };
      S.frame = { raf: win.requestAnimationFrame ? win.requestAnimationFrame(run) : null, to: win.setTimeout ? win.setTimeout(run, 250) : null };
      if (!win.requestAnimationFrame && !win.setTimeout) run();
    }

    var assetSig = "";
    function refreshAssetOptions() {
      var ids = S.live ? Object.keys(S.assets).sort() : [], sig = ids.join("|");
      if (sig === assetSig) return; assetSig = sig;
      var sel = $("v4FaultTarget");
      if (sel) {
        var keep = sel.value, g = sel.querySelector("optgroup"); if (g) sel.removeChild(g);
        if (ids.length) {
          g = doc.createElement("optgroup"); g.label = "Specific asset";
          ids.forEach(function (id) { var o = doc.createElement("option"); o.value = "asset:" + id; o.textContent = id; g.appendChild(o); });
          sel.appendChild(g);
        }
        sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === keep; }) ? keep : "";
      }
      var dl = $("v4AssetList");
      if (dl) dl.innerHTML = ids.map(function (id) { return '<option value="' + esc(id) + '"></option>'; }).join("");
    }

    function getJSON(url) {
      return fetchImpl(url, {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    }
    function postJSON(url, body) {
      return fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) {
          if (!r.ok) { var det = d && (d.error || d.detail); throw new Error(det ? (typeof det === "string" ? det : JSON.stringify(det)) : "HTTP " + r.status); }
          return d || {};
        });
      });
    }

    function pollDashboard() {
      if (Date.now() - S.wsLast < 3500) return Promise.resolve();
      return getJSON("/dashboard?events_limit=20&findings_limit=1").then(ingest).catch(function () { setStatus(); });
    }
    function renderAINow() { if ($("v4Attn")) $("v4Attn").innerHTML = renderAttention(S.ai, S.mit); renderWallNow(false); renderInsightsNow(); markTabs(); }
    function renderInsightsNow() {
      if (S.mode !== "wall") return;
      var names = {}; Object.keys(S.assets || {}).forEach(function (aid) { var a = S.assets[aid]; if (a && a.display_id) names[aid] = String(a.display_id); });
      setHTML($("v4Insights"), insightsHTML(S.ai, { sim: !!(S.prov && S.prov.gateway && S.prov.gateway.simulated), names: names }));
      var n = S.ai && S.ai.recommendations ? S.ai.recommendations.filter(function (r) { return statusOf(r.severity) !== "normal"; }).length : 0;
      var nt = $("v4InsN"); if (nt && nt.textContent !== String(n || "")) nt.textContent = n ? String(n) : "";
    }
    function pollAI() {
      return getJSON("/nephes/ai_analysis?limit=8").then(function (d) { S.ai = d; }).catch(function (e) { if (!S.ai || S.ai.error) S.ai = { error: e.message }; })
        .then(function () { renderAINow(); return loadMit(); });
    }
    function loadMit() {
      return getJSON("/nephes/mitigation/status").then(function (st) {
        S.mit = {}; mitEntries(st).forEach(function (e) { S.mit[e[0]] = e[1]; });
        var entries = mitEntries(st), gain = entries.reduce(function (s, e) { return s + (num(e[1].expected_gain) || 0); }, 0);
        if ($("v4MitRows")) $("v4MitRows").innerHTML = renderMitRows(entries);
        if ($("v4MitCount")) $("v4MitCount").textContent = String(entries.length);
        if ($("v4MitGain")) $("v4MitGain").textContent = entries.length ? "+" + gain.toFixed(1) + " pp" : "—";
        if ($("v4MitTag")) $("v4MitTag").textContent = String(entries.length);
        renderAINow();
      }).catch(function () { /* keep last good */ }).then(function () {
        if (S.mode !== "mitigation") return;
        return getJSON("/nephes/mitigation").then(function (g) {
          if ($("v4MitMode")) $("v4MitMode").textContent = g && g.active ? "auto on" + (g.ecu_map ? " · " + g.ecu_map : "") : "manual";
        }).catch(function () {});
      });
    }

    function connectWS() {
      if (S.ws || doc.hidden || !win.WebSocket) return;
      var s;
      try { s = new win.WebSocket((win.location.protocol === "https:" ? "wss://" : "ws://") + win.location.host + "/nephes/ws"); } catch (e) { return; }
      S.ws = s;
      s.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && m.type === "dashboard" && m.data) { S.wsLast = Date.now(); S.wsTries = 0; ingest(m.data); }
      };
      // a dropped push hands over to the 1 s poll at once instead of after 3.5 s, and retries spread out (with jitter)
      s.onclose = function () {
        if (S.ws !== s) return; S.ws = null; S.wsLast = 0; S.wsTries++; pollDashboard();
        win.setTimeout(connectWS, Math.min(30000, 1000 * Math.pow(2, S.wsTries)) * (0.75 + Math.random() * 0.5));
      };
      s.onerror = function () { try { s.close(); } catch (e) {} };
    }

    function setMode(m) {
      // the Wall is the default (a TV on the floor); Details is the desk page that was here; Devices adds data sources
      S.mode = m === "devices" ? "devices" : (m === "live" || m === "details") ? "live" : "wall";
      if ($("v4Wall2")) $("v4Wall2").hidden = S.mode !== "wall";
      if ($("v4Live")) $("v4Live").hidden = S.mode !== "live";
      if ($("v4Mit")) $("v4Mit").hidden = S.mode !== "mitigation";
      if ($("v4Dev")) $("v4Dev").hidden = S.mode !== "devices";
      if (doc.body) doc.body.classList.toggle("lw", S.mode === "wall");
      var hc = $("v4HealthCard"), home = $("v4LiveSide");
      // the Wall shows states, not a single health score (F14): the health card stays on Details
      if (hc && home && hc.parentNode !== home) home.insertBefore(hc, home.firstChild);
      Array.prototype.forEach.call(doc.querySelectorAll("[data-mode]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === S.mode)); });
      var T = { wall: ["Live", "The floor at a glance: what NEPHES says needs eyes on it, worst first."],
                live: ["Live · details", "What needs attention on the floor right now, and why NEPHES thinks so."],
                mitigation: ["Mitigation", "Plans people have started against open findings, and what each is expected to return."],
                devices: ["Network Devices", "Find controllers on this computer's local network and add them as data sources. Read-only: adding a device doesn't write to it."] };
      if ($("v4Title")) $("v4Title").textContent = T[S.mode][0];
      if ($("v4Lede")) $("v4Lede").textContent = T[S.mode][1];
      if (S.mode === "mitigation") loadMit();
      if (S.mode === "devices") loadConfigured();
      if (S.mode === "wall") { renderBigWall(true); loadPlant(); }
      if (S.mode === "live" && S.live) { renderWallNow(true); renderEventsNow(); renderDetailNow(); }
      if (typeof markTabs === "function") markTabs();
    }

    /* the Wall (F14): a counts strip, then every machine as a neutral tile, worst first, each reading a compact row
       that opens in place. When updates stop, readings age into "stale" on the page's own clock instead of staying green. */
    function renderBigWall(force) {
      var box = $("v4BigTiles"); if (!box || S.mode !== "wall") return;
      var cbox = $("v4Counts");
      if (!S.live) { setHTML(box, '<p class="note">Waiting for the first sensor snapshot from the backend…</p>'); setHTML(cbox, ""); return; }
      // the insights and the machine column share one screen on a desk; each scrolls inside itself
      var w = win.innerWidth || 1600, h = win.innerHeight || 1000, lm = box.parentNode && box.parentNode.parentNode;
      var top = lm && lm.getBoundingClientRect ? lm.getBoundingClientRect().top + (win.scrollY || 0) : 120;
      if (lm && lm.style) lm.style.height = w >= 1100 ? Math.max(360, Math.round(h - top - 16)) + "px" : "";
      renderInsightsNow();
      var nowSec = S.builtSec === null || S.builtSec === undefined ? null : S.builtSec + Math.max(0, Date.now() - S.lastOk) / 1000;
      var g = machineGrid(S.assets, { nowSec: nowSec, staleS: S.staleS || 10, recs: wallCtx().recs });
      var sim = !!(S.prov && S.prov.gateway && S.prov.gateway.simulated);
      var asOf = S.snapTime && isFinite(Date.parse(S.snapTime)) ? new Date(Date.parse(S.snapTime)).toTimeString().slice(0, 8) : "";
      setHTML(cbox, countsHTML(g, { sim: sim, asOf: asOf }));
      var now = Date.now(); S.wallRing = S.wallRing || {};
      var alerts = g.machines.filter(function (m) { return m.state === "alert"; }).map(function (m) { return m.aid; });
      if (S.wallCrit) alerts.forEach(function (k) { if (S.wallCrit.indexOf(k) < 0) S.wallRing[k] = now + 4300; });   // a machine newly in alert rings 3×
      S.wallCrit = alerts;
      var sig = g.machines.map(function (m) {
        return m.aid + "=" + m.state + "/" + (m.rec || "") + "/" + (S.wallRing[m.aid] > now ? 1 : 0) + ":" +
          m.rows.map(function (r) { return r.key + "~" + r.state + (S.expanded === r.key ? "x" : "") + ((S.hist[r.key] || []).length > 1 ? "h" : ""); }).join(",");
      }).join(";") + "|" + sim;
      if (force || sig !== S.bigSig) {
        S.bigSig = sig;
        var fa = doc.activeElement, fk = null, fc = null;
        if (fa && box.contains(fa)) { var host = fa.closest("[data-k]"); if (host) { fk = host.getAttribute("data-k"); fc = fa.classList.contains("mg-open") ? "mg-open" : "mg-rb"; } }
        box._nfoHtml = null;
        box.innerHTML = g.machines.length ? '<div class="mg-grid">' + g.machines.map(function (m, i) {
          return machineTileHTML(m, { sim: sim, open: S.expanded, hist: S.hist, ring: S.wallRing[m.aid] > now, idx: i });
        }).join("") + "</div>" : '<p class="note">The backend sent no machines.</p>';
        if (fk) { var again = Array.prototype.find.call(box.querySelectorAll("[data-k]"), function (e) { return e.getAttribute("data-k") === fk; }); if (again) { var fb = again.querySelector("." + fc); if (fb) fb.focus(); } }
      } else g.machines.forEach(function (m) { m.rows.forEach(function (r) {     // same rows in the same states: only the numbers, lines and ages move
        var el = Array.prototype.find.call(box.querySelectorAll(".mg-r"), function (e) { return e.getAttribute("data-k") === r.key; }); if (!el) return;
        var v = el.querySelector(".mg-v"), vt = r.value === null ? "—" : fmtVal(r.value); if (v && v.firstChild && v.firstChild.nodeValue !== vt) v.firstChild.nodeValue = vt;
        var sp = el.querySelector(".mg-sp path"), hh = S.hist[r.key]; if (sp && hh && hh.length > 1) { var d = sparkPath(hh, 60, 16); if (sp.getAttribute("d") !== d) sp.setAttribute("d", d); }
        var wd = el.querySelector(".mg-w"), wt = r.state === "stale" && r.age !== null ? "stale · " + ageWord(r.age) : ST_WORD[r.state]; if (wd && wd.textContent !== wt) wd.textContent = wt;
        var x = el.querySelector(".mg-x"); if (x) setHTML(x, rowDetail(r, hh));
      }); });
      var fc2 = $("v4Focus"); if (fc2) { var fh = focusHTML(focusCards(S.kpis, S.drm, S.plant)); if (fc2.innerHTML !== fh) fc2.innerHTML = fh; }
      var vv = $("v4Value"); if (vv) { var vh = valueHTML(S.value); if (vv.innerHTML !== vh) vv.innerHTML = vh; }
    }
    function loadPlant() {
      if (S.plantAt && Date.now() - S.plantAt < 60000) return;
      S.plantAt = Date.now();
      getJSON("/nephes/maintenance/plant_summary").then(function (d) { S.plant = d; renderBigWall(); }).catch(function () { S.plant = { error: true }; renderBigWall(); });
      getJSON("/nephes/value_summary").then(function (d) { S.value = d; renderBigWall(); }).catch(function () { S.value = { error: true }; renderBigWall(); });
    }
    if (win.addEventListener) win.addEventListener("resize", function () { if (S.mode === "wall") renderBigWall(true); });

    function segPick(container, attr, value) {
      Array.prototype.forEach.call(container.querySelectorAll("[" + attr + "]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value)); });
    }

    doc.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("button, a[data-mode]") : null;
      if (!t) return;
      if (t.hasAttribute("data-mode")) { e.preventDefault(); var md = t.getAttribute("data-mode"); win.location.hash = md === "wall" ? "" : md === "live" ? "details" : md; setMode(md); return; }
      if (t.hasAttribute("data-tab-go")) { goTab(t.getAttribute("data-tab-go")); return; }
      if (t.hasAttribute("data-lim")) { var w = t.getAttribute("data-lim"); limitAction(w === "learned" ? "/accept-learned" : "/auto", "POST"); return; }
      if (t.id === "v4NetScan") { scanNetwork(); return; }
      if (t.id === "v4NetAdd") { addDevices(); return; }
      if (t.id === "v4NetCancel") { S.net.selected = {}; renderScan(); return; }
      if (t.hasAttribute("data-net-remove")) { removeDevice(t.getAttribute("data-net-remove")); return; }
      if (t.hasAttribute("data-pin")) {
        var pk = t.getAttribute("data-pin");
        if (S.pins[pk]) delete S.pins[pk]; else S.pins[pk] = 1;
        savePins(S.pins); renderWallNow(true); syncPins(); return;
      }
      if (t.classList.contains("mg-rb")) { var rk = t.closest("[data-k]").getAttribute("data-k"); S.expanded = S.expanded === rk ? null : rk; renderBigWall(true); return; }
      if (t.hasAttribute("data-open")) { S.selected = t.getAttribute("data-open"); S.expanded = null; win.location.hash = "details"; setMode("live"); return; }
      if (t.classList.contains("sensor-open")) { var k = t.closest("[data-k]").getAttribute("data-k"); S.selected = S.selected === k ? null : k; renderWallNow(true); renderDetailNow(); return; }
      if (t.hasAttribute("data-group")) { S.filter.group = t.getAttribute("data-group"); segPick(t.parentNode, "data-group", S.filter.group); renderWallNow(true); return; }
      if (t.hasAttribute("data-show")) { S.filter.status = t.getAttribute("data-show"); segPick(t.parentNode, "data-show", S.filter.status); renderWallNow(true); return; }
      if (t.hasAttribute("data-ev")) { S.evFilter = t.getAttribute("data-ev"); segPick(t.parentNode, "data-ev", S.evFilter); renderEventsNow(); return; }
      var act = t.getAttribute("data-act");
      if (act === "inject" || act === "clear") {
        var st = $("v4FaultStatus"), btns = doc.querySelectorAll('[data-act="inject"],[data-act="clear"]');
        Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
        var body;
        if (act === "clear") body = { clear: true };
        else {
          var tgt = $("v4FaultTarget").value;
          body = { severity: $("v4FaultSev").value, duration_s: parseInt($("v4FaultDur").value, 10) || 120 };
          if (tgt.indexOf("pct") === 0) body.percent = parseInt(tgt.slice(3), 10); else if (tgt.indexOf("asset:") === 0) body.asset_id = tgt.slice(6);
        }
        st.textContent = act === "clear" ? "Clearing injected faults…" : "Injecting fault…";
        postJSON("/nephes/inject_fault", body).then(function (d) {
          if (act === "clear") { st.textContent = "All injected faults cleared."; return; }
          var hit = d.assets || (d.asset_id ? [d.asset_id] : []);
          st.textContent = "Injected a " + (d.severity || body.severity) + " fault on " + hit.length + " asset" + (hit.length === 1 ? "" : "s") + ": " +
            hit.slice(0, 4).join(", ") + (hit.length > 4 ? " +" + (hit.length - 4) + " more" : "") + " · expires in " + Math.round(d.duration_s || body.duration_s) + " s.";
        }).catch(function (err) { st.textContent = (act === "clear" ? "Clear" : "Inject") + " failed: " + err.message; })
          .then(function () { Array.prototype.forEach.call(btns, function (b) { b.disabled = false; }); });
      }
    });

    var search = $("v4Search");
    if (search) search.addEventListener("input", function () { S.filter.search = search.value; renderWallNow(true); });

    doc.addEventListener("nfo:provenance", function (ev) {
      var p = ev && ev.detail, list = (p && p.notices) || [];
      S.prov = p || null; if (S.mode === "wall") renderBigWall();   // the simulated label follows the gateway
      S.notPlant = list.some(function (n) { return n && n.scope !== "detection" && (n.level === "warn" || n.level === "crit"); });
      setStatus();
    });

    // the clock tick also re-fits the wall when something above it moved (a banner shown or closed) while no data arrives;
    // renderBigWall only redraws when the space it has changed
    function tick() { var c = $("v4Clock"); if (c) c.textContent = new Date().toTimeString().slice(0, 8); setStatus(); if (S.mode === "wall" && Date.now() - S.lastOk > 3000) renderBigWall(); }

    function start() {
      if (S.timers.length) return;
      S.timers.push(win.setInterval(pollDashboard, 1000), win.setInterval(pollAI, 8000), win.setInterval(tick, 1000));
      connectWS(); pollDashboard(); pollAI(); tick();
    }
    function stop() {
      S.timers.forEach(function (t) { win.clearInterval(t); }); S.timers = [];
      var s = S.ws; S.ws = null; if (s) { s.onclose = null; try { s.close(); } catch (e) {} }
    }
    doc.addEventListener("visibilitychange", function () { if (doc.hidden) stop(); else { S.wsTries = 0; start(); } });

    /* Tablet tabs (shown up to 1100 px wide): one section at a time */
    function goTab(tab) {
      { if (S.mode !== "live") { win.location.hash = "details"; setMode("live"); } doc.body.setAttribute("data-tab", tab); win.scrollTo(0, 0); }
      markTabs();
    }
    function markTabs() {
      var cur = S.mode === "mitigation" ? "mitigation" : S.mode === "live" ? doc.body.getAttribute("data-tab") : "";
      Array.prototype.forEach.call(doc.querySelectorAll("[data-tab-go]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-tab-go") === cur)); });
      var n = S.ai && S.ai.recommendations ? sortRecs(S.ai.recommendations).filter(function (r) { return statusOf(r.severity) !== "normal"; }).length : 0;
      if ($("v4TabAttn")) $("v4TabAttn").textContent = n ? String(n) : "";
      var c = critCount(S.events);
      if ($("v4TabEv")) $("v4TabEv").textContent = c ? String(c) : "";
    }

    /* Network devices */
    S.net = { devices: null, selected: {}, configured: [], confirming: null };
    function renderScan() {
      if ($("v4NetRows")) $("v4NetRows").innerHTML = renderScanRows(S.net.devices, S.net.selected);
      var n = Object.keys(S.net.selected).length;
      if ($("v4NetAssign")) $("v4NetAssign").hidden = n === 0;
      if ($("v4NetPicked")) $("v4NetPicked").textContent = n + " selected";
    }
    function renderCfg() {
      if ($("v4NetCfg")) $("v4NetCfg").innerHTML = renderConfigured(S.net.configured, S.net.confirming);
      if ($("v4NetCfgTag")) $("v4NetCfgTag").textContent = String(S.net.configured.length);
    }
    function loadConfigured() {
      return getJSON("/network/devices").then(function (d) { S.net.configured = d.devices || []; renderCfg(); })
        .catch(function (e) { if ($("v4NetCfg")) $("v4NetCfg").innerHTML = '<p class="note">Couldn\'t load the device list (' + esc(e.message) + ").</p>"; });
    }
    function scanNetwork() {
      var b = $("v4NetScan"), st = $("v4NetStatus");
      b.disabled = true; st.textContent = "Scanning this computer's local network…"; S.net.selected = {};
      postJSON("/network/scan", {}).then(function (d) {   // a sweep is a POST, so no link or image can start one
        S.net.devices = d.devices || [];
        var c = S.net.devices.filter(isController).length;
        st.textContent = S.net.devices.length + " device" + (S.net.devices.length === 1 ? "" : "s") + " found, " + c + " controller" + (c === 1 ? "" : "s") + ".";
      }).catch(function (e) { st.textContent = "Scan failed: " + e.message; }).then(function () { b.disabled = false; renderScan(); });
    }
    function addDevices() {
      var ips = Object.keys(S.net.selected), loc = $("v4NetLoc").value.trim(), asset = $("v4NetAsset").value.trim(), st = $("v4NetStatus");
      if (!ips.length) return;
      var errs = [], chain = Promise.resolve();
      ips.forEach(function (ip) {
        var d = S.net.selected[ip];
        chain = chain.then(function () {
          return postJSON("/network/devices", { ip: d.ip, mac: d.mac || "", hostname: d.hostname || "", protocol: d.protocol || null,
            location: loc, asset_name: asset || d.hostname || d.ip }).catch(function (e) { errs.push(ip + ": " + e.message); });
        });
      });
      chain.then(function () {
        st.textContent = "Added " + (ips.length - errs.length) + " device" + (ips.length - errs.length === 1 ? "" : "s") + (errs.length ? ". Not added: " + errs.join("; ") : ".");
        S.net.selected = {}; $("v4NetLoc").value = ""; $("v4NetAsset").value = ""; renderScan(); return loadConfigured();
      });
    }
    function removeDevice(ip) {
      if (S.net.confirming !== ip) { S.net.confirming = ip; renderCfg(); return; }   // second press confirms (no pop-up dialog)
      S.net.confirming = null;
      fetchImpl("/network/devices/" + encodeURIComponent(ip), { method: "DELETE" }).catch(function () {}).then(loadConfigured);
    }
    doc.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.hasAttribute && t.hasAttribute("data-net-pick")) {
        var ip = t.getAttribute("data-net-pick"), d = (S.net.devices || []).find(function (x) { return String(x.ip) === ip; });
        if (t.checked && d) S.net.selected[ip] = d; else delete S.net.selected[ip];
        renderScan();
      }
    });

    /* Pins on the server, per user, when this computer is signed in (preview sign-in); otherwise this browser. */
    S.pinStore = { where: "browser", user: null, token: null, timer: null };
    function pinNote() {
      var el = $("v4PinNote"); if (!el) return;
      el.textContent = S.pinStore.where === "server" ? "Pins are saved to " + S.pinStore.user + "'s account."
        : "Pins are saved in this browser.";
    }
    function pinKeys() { return Object.keys(S.pins).filter(function (k) { return S.pins[k]; }).sort(); }
    function syncPins() {
      if (S.pinStore.where !== "server") return;
      win.clearTimeout(S.pinStore.timer);
      S.pinStore.timer = win.setTimeout(function () {
        fetchImpl("/nephes/console/pins", { method: "PUT", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + S.pinStore.token },
          body: JSON.stringify({ pins: pinKeys() }) }).catch(function () { /* the browser copy stays */ });
      }, 400);
    }
    function loadServerPins() {
      return Promise.resolve().then(function () { return fetchImpl("/nephes/preview/session", {}); }).then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (j) {
          if (!(j && j.enabled && j.token)) return null;
          return fetchImpl("/nephes/console/pins", { headers: { "Authorization": "Bearer " + j.token } }).then(function (r) {
            if (!r || !r.ok) return null;
            return r.json().then(function (d) {
              S.pinStore = { where: "server", user: d.user, token: j.token, timer: null };
              if (d.pins && d.pins.length) { S.pins = {}; d.pins.forEach(function (k) { S.pins[k] = 1; }); savePins(S.pins); }
              else if (pinKeys().length) syncPins();               // first time: move this browser's pins to the account
              return true;
            });
          });
        }).catch(function () { return null; }).then(function () { pinNote(); renderWallNow(true); });
    }
    pinNote();
    doc.addEventListener("submit", function (e) {
      if (!e.target || e.target.id !== "v4LimForm") return;
      e.preventDefault();
      var f = e.target, val = function (n) { return f.elements[n].value; };
      var body = { low: Number(val("low")), high: Number(val("high")) };
      if (val("crit_low") !== "") body.crit_low = Number(val("crit_low"));
      if (val("crit_high") !== "") body.crit_high = Number(val("crit_high"));
      if (val("note")) body.note = val("note");
      limitAction("", "PUT", body);
    });
    if (!env.noStart) loadServerPins().then(function () { if (S.selected) loadLimits(); });

    setMode(String(win.location && win.location.hash || "").replace("#", ""));
    renderWallNow(true); renderDetailNow(); renderEventsNow(); renderAINow(); setStatus();
    if (!env.noStart) start();
    return { state: S, ingest: ingest, flush: function () { if (S.frame) { if (S.frame.to && win.clearTimeout) win.clearTimeout(S.frame.to); draw(); } }, setMode: setMode, stop: stop };
  }

  return {
    esc: esc, fmtVal: fmtVal, statusOf: statusOf, sevWord: sevWord, floorSummary: floorSummary, trend: trend, sparkPath: sparkPath,
    tiles: tiles, importance: importance, renderWall: renderWall, wallTiles: wallTiles, wallTileHTML: wallTileHTML, trendKey: trendKey, packWall: packWall, wallLanes: wallLanes, machinesHTML: machinesHTML, valueHTML: valueHTML, focusCards: focusCards, focusHTML: focusHTML, limitWord: limitWord, sortRecs: sortRecs, renderAttention: renderAttention, renderEvents: renderEvents,
    snapNewer: snapNewer, addReading: addReading, readingAge: readingAge, hasGap: hasGap,
    sensorState: sensorState, machineGrid: machineGrid, countsHTML: countsHTML, machineTileHTML: machineTileHTML,
    insightHTML: insightHTML, insightsHTML: insightsHTML,
    renderDetail: renderDetail, renderLimits: renderLimits, mitEntries: mitEntries, renderMitRows: renderMitRows, renderScanRows: renderScanRows, renderConfigured: renderConfigured, mount: mount
  };
});

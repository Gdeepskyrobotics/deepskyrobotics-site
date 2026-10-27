/* demo-feed.js: the website's stand-in for an NFO server, so the Live page runs on GitHub Pages with no backend.
 *
 * NFO's own page code (console-v4.js, nfo-shared-header.js, provenance_banner.js) is unchanged. It asks for its data
 * with fetch(); this file answers those requests in the browser:
 *   GET /dashboard            readings from a small simulator seeded with demo-snapshot.js (a recorded simulated run)
 *   GET /nephes/ai_analysis   the NEPHES advice as recorded, times moved to now; nothing is analysed here
 *   GET /nephes/provenance    says, on the page's own banner, that everything is simulated in this browser
 *   anything else             404; every POST, PUT or DELETE gets 405: the demo is read-only, like NFO
 * There is no WebSocket: the page falls back to its 1 s poll.
 *
 * What the simulator does, so the page has something to show: each reading wanders inside its learned band;
 * pump_01's vibration drifts up past its warning limit and back (a 150 s cycle); valve_01's actuator temperature stops
 * updating after 6 s, so it ages into "stale". All of it is made up here and labelled simulated on screen.
 */
(function () {
  "use strict";
  var SNAP = window.NFO_DEMO_SNAPSHOT;
  if (!SNAP) return;

  var DRIFT = { asset: "pump_01", tag: "vib_rms_g" };
  var STALE = { asset: "valve_01", tag: "actuator_temp_c", after: 6 };

  // a fixed seed, so two runs of the page (and the CI recording) move the same way
  var seed = 20261027;
  function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }

  var assets = JSON.parse(JSON.stringify(SNAP.assets));
  var base = {};
  Object.keys(assets).forEach(function (aid) {
    var ss = assets[aid].sensors || {};
    Object.keys(ss).forEach(function (tag) { base[aid + "|" + tag] = ss[tag].value; });
  });
  var t0 = Date.now() / 1000, steps = 0;

  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function stateOf(s) {
    var v = s.value, w = num(s.threshold_warning), c = num(s.threshold_critical), lo = num(s.threshold_min), clo = num(s.threshold_critical_low);
    if ((c !== null && v >= c) || (clo !== null && v <= clo)) return "critical";
    if ((w !== null && v >= w) || (lo !== null && v <= lo)) return "warning";
    return "normal";
  }
  var SEV = { normal: "info", warning: "warning", critical: "critical" }, RANK = { normal: 0, warning: 1, critical: 2 };

  // pump_01 vibration: level for 5 s, up to just past the warning limit by 30 s, held to 60 s, back down by 90 s
  function driftLevel(t, s, b) {
    var w = num(s.threshold_warning), c = num(s.threshold_critical); if (w === null) return b;
    var top = c !== null ? w + (c - w) * 0.35 : w * 1.05, p = t % 150;
    var f = p < 5 ? 0 : p < 30 ? (p - 5) / 25 : p < 60 ? 1 : p < 90 ? 1 - (p - 60) / 30 : 0;
    return b + (top - b) * (f * f * (3 - 2 * f));
  }

  function step(sec) {
    Object.keys(assets).forEach(function (aid) {
      var a = assets[aid], ss = a.sensors || {}, worst = "normal";
      Object.keys(ss).forEach(function (tag) {
        var s = ss[tag], k = aid + "|" + tag, b = base[k];
        var stale = aid === STALE.asset && tag === STALE.tag && sec - t0 > STALE.after;
        if (!stale) {
          var lo = num(s.threshold_min), hi = num(s.threshold_warning), span = lo !== null && hi !== null ? hi - lo : Math.abs(b) * 0.1;
          var target = aid === DRIFT.asset && tag === DRIFT.tag ? driftLevel(sec - t0, s, b) : b;
          s.value = +(s.value + (target - s.value) * 0.35 + (rnd() - 0.5) * span * 0.03).toFixed(4);
          s.timestamp = Math.floor(sec);
        }
        s.status = stateOf(s); s.severity = SEV[s.status];
        if (RANK[s.status] > RANK[worst]) worst = s.status;
      });
      a.overall_status = worst;
    });
  }

  function dashboard() {
    var now = Date.now() / 1000;
    for (var target = Math.floor(now - t0); steps <= target; steps++) step(t0 + steps);
    var sum = { normal: 0, warning: 0, critical: 0 };
    Object.keys(assets).forEach(function (aid) { sum[assets[aid].overall_status]++; });
    return { live_sensors: { assets: JSON.parse(JSON.stringify(assets)), summary: sum },
      drm_status: { running: true, tick_rate_s: 1 }, events: [], findings: [], time: new Date(now * 1000).toISOString() };
  }

  // the advice as recorded, moved to the present so its times read as minutes ago rather than a date
  function aiAnalysis() {
    var shift = Date.now() - Date.parse(SNAP.recorded_at), move = function (iso) { var t = Date.parse(iso); return isFinite(t) ? new Date(t + shift).toISOString() : iso; };
    var ai = JSON.parse(JSON.stringify(SNAP.ai));
    (ai.recommendations || []).forEach(function (r) {
      r.timestamp = move(r.timestamp);
      if (r.data_window) { r.data_window.first = move(r.data_window.first); r.data_window.last = move(r.data_window.last); }
    });
    return ai;
  }

  function provenance() {
    return { generated_at: new Date().toISOString(), real_plant_data: false, demo_mode: true,
      gateway: { id: "website-demo", configured: "website-demo", known: true, simulated: true, health: "ok", protocol: "Website demo (simulated in this browser)" },
      notices: [
        { level: "warn", code: "gateway_simulated", text: "Website demo: every reading is made up in this browser by a small simulator. Nothing here reads from or writes to plant equipment." },
        { level: "warn", code: "recorded_advice", text: "NEPHES insights are recorded from a simulated NFO run; nothing is analysed on this page. One pump drifts past a limit and one reading stops updating, so those states can be seen." }
      ] };
  }

  function reply(status, body) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } }));
  }
  window.fetch = function (input, init) {
    var url = String(input && input.url ? input.url : input), method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0];
    if (method !== "GET") return reply(405, { error: "This website demo is read-only." });
    if (path === "/dashboard") return reply(200, dashboard());
    if (path === "/nephes/ai_analysis") return reply(200, aiAnalysis());
    if (path === "/nephes/provenance") return reply(200, provenance());
    return reply(404, { error: "Not part of this website demo." });
  };
  // no push channel: console-v4.js then polls /dashboard once a second
  try { window.WebSocket = undefined; } catch (e) {}
})();

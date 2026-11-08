// scene.js: harness for the preview's rendered scenes. Deterministic: no clocks, no randomness, no network.
// A scene calls defineScene({ seconds, fps, posterT, render(t, ctx, w, h) }); render.mjs calls __frame(t).
(function () {
  var q = new URLSearchParams(location.search);
  var w = parseInt(q.get('w') || '1920', 10), h = parseInt(q.get('h') || '1080', 10);
  document.documentElement.style.background = '#060608';
  document.body.style.margin = '0';
  var cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.style.cssText = 'position:fixed;left:0;top:0;width:' + w + 'px;height:' + h + 'px';
  document.body.appendChild(cv);
  var ctx = cv.getContext('2d');

  window.PALETTE = { bg: '#060608', indigo: '#818cf8', indigoDeep: '#4f46e5', cyan: '#22d3ee', emerald: '#34d399', text: '#f8f9ff', mute: '#c7d2fe' };
  window.mulberry32 = function (seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };
  window.ease = {
    inOut: function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
    out: function (x) { return 1 - Math.pow(1 - x, 3); },
  };
  window.clamp01 = function (x) { return Math.max(0, Math.min(1, x)); };
  window.span = function (t, a, b) { return clamp01((t - a) / (b - a)); };

  // The signal field shared by S1 (runs, one trace drifts, slows to a stop) and S2 (starts frozen).
  function geometry() {
    var portrait = h > w, lines = portrait ? 22 : 30, top = h * 0.12, bottom = h * 0.88;
    return { portrait: portrait, lines: lines, top: top, gap: (bottom - top) / (lines - 1), drifter: Math.floor(lines * 0.62), steps: portrait ? 90 : 160 };
  }
  function traces(g) {
    var rnd = mulberry32(7), out = [];
    for (var i = 0; i < g.lines; i++) {
      out.push({ y0: g.top + i * g.gap, amp: g.gap * (0.18 + rnd() * 0.22), freq: 2 + rnd() * 3, speed: 0.6 + rnd() * 0.8, phase0: rnd() * Math.PI * 2, drifter: i === g.drifter });
    }
    return out;
  }
  function traceY(tr, g, u, s) {
    var y = tr.y0 + tr.amp * Math.sin(tr.phase0 + u * tr.freq * Math.PI * 2 - s.phaseT * tr.speed * 12);
    if (tr.drifter) y -= s.drift * g.gap * 2.4 * u * u;
    return y;
  }
  window.FIELD = {
    END: { phaseT: 0.79, drift: 1, freeze: 1 }, // S1 at t = 1
    draw: function (c, W, H, s, alpha) {
      var g = geometry(), a = alpha == null ? 1 : alpha;
      traces(g).forEach(function (tr) {
        c.beginPath();
        for (var k = 0; k <= g.steps; k++) {
          var u = k / g.steps, y = traceY(tr, g, u, s);
          if (k === 0) c.moveTo(0, y); else c.lineTo(u * W, y);
        }
        c.strokeStyle = tr.drifter ? PALETTE.cyan : PALETTE.indigo;
        c.globalAlpha = a * (tr.drifter ? 0.35 + 0.65 * s.drift : 0.28 * (1 - 0.55 * s.freeze));
        c.lineWidth = tr.drifter ? (g.portrait ? 3 : 2.5) : 1.25;
        c.stroke();
      });
      c.globalAlpha = 1;
    },
    drifterEnd: function (W, H, s) {
      var g = geometry(), tr = traces(g)[g.drifter];
      return { x: W, y: traceY(tr, g, 1, s) };
    },
  };

  window.defineScene = function (def) {
    window.__scene = { seconds: def.seconds, fps: def.fps, posterT: def.posterT, w: w, h: h };
    window.__frame = function (t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, w, h);
      def.render(t, ctx, w, h);
      return true;
    };
    window.__frame(def.posterT);
  };
})();

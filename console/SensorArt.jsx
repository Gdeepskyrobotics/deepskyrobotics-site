/* ──────────────────────────────────────────────────────────────────────────
   SensorArt.jsx — generative-art gallery for the Factory Observer Sensor Wall.

   Renders the live ~2,000-point sensor grid as art, in several switchable forms,
   all driven by the live OK (green) / WARN (amber) / CRIT (red) sensor state —
   so every form tracks the plant's mood (calm green when healthy, red + agitated
   as faults hit). Pure <canvas>, no deps beyond React + `statusOf` (IndustrialKit),
   fully offline. Wired in as the third Sensor-Wall view: Tiles / Grid / Art.

   Forms:
     • flow     — particle flow field
     • mosaic   — sensor tiles compose a picture (Mona Lisa / DSR logo / gear /
                  factory / NEPHES wordmark), tinted by plant health
     • kaleido  — sensor field mirrored into a living mandala
     • spiral   — phyllotaxis (golden-angle) spiral of tiles
     • voronoi  — drifting stained-glass cells
   ────────────────────────────────────────────────────────────────────────── */
function SensorArt({ points }) {
  const canvasRef = React.useRef(null);
  const ptsRef = React.useRef(points || []);
  ptsRef.current = points || [];

  const [form, setForm] = React.useState('flow');
  const [img, setImg] = React.useState('mona');
  const formRef = React.useRef(form); formRef.current = form;
  const imgRef = React.useRef(img); imgRef.current = img;

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: false });
    const host = cv.parentElement;

    // ── theme palette ──────────────────────────────────────────────────────
    const cs = getComputedStyle(document.documentElement);
    const cssVar = (n, fb) => { const x = cs.getPropertyValue(n).trim(); return x || fb; };
    const COL = { ok: cssVar('--ok', '#5fa377'), warn: cssVar('--warn', '#f5b841'), crit: cssVar('--crit', '#e0564f'), accent: cssVar('--accent', '#e4bc49') };
    const BG = cssVar('--bg-deep', '') || cssVar('--bg-body', '') || '#0c0c0a';

    // offscreen util canvas (colour parsing + lum maps)
    const oc = document.createElement('canvas');
    const octx = oc.getContext('2d', { willReadFrequently: true });
    const toRGB = (col) => { oc.width = oc.height = 1; octx.fillStyle = col; octx.fillRect(0, 0, 1, 1); const d = octx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
    const RGB = { ok: toRGB(COL.ok), warn: toRGB(COL.warn), crit: toRGB(COL.crit), accent: toRGB(COL.accent) };
    const colName = (st) => st === 'crit' ? COL.crit : st === 'warn' ? COL.warn : COL.ok;
    const rgbName = (st) => st === 'crit' ? RGB.crit : st === 'warn' ? RGB.warn : RGB.ok;

    // ── canvas sizing ──────────────────────────────────────────────────────
    let W = 0, H = 0;
    function fit() {
      const r = host.getBoundingClientRect();
      W = Math.max(280, Math.round(r.width));
      H = Math.max(220, Math.round(r.height));
      cv.width = W; cv.height = H;
      ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      lastForm = '';            // force per-form reinit
      lum = null; vorOff = null; motes = null;
    }

    // ── live sensor state (cached) ─────────────────────────────────────────
    let statusArr = [], FCOLS = 1, FROWS = 1, FIELD = [];
    function refresh() {
      const pts = ptsRef.current, n = pts.length || 1;
      statusArr = new Array(n);
      FCOLS = Math.max(8, Math.round(Math.sqrt(n * (W / Math.max(1, H)))));
      FROWS = Math.max(6, Math.ceil(n / FCOLS));
      const cells = new Array(FCOLS * FROWS);
      for (let i = 0; i < cells.length; i++) cells[i] = { ok: 0, warn: 0, crit: 0 };
      for (let i = 0; i < n; i++) {
        const st = (typeof statusOf === 'function') ? statusOf(pts[i]) : ((pts[i] && pts[i].status) || 'ok');
        statusArr[i] = st;
        const c = cells[i] || cells[i % cells.length];
        c[st === 'crit' ? 'crit' : st === 'warn' ? 'warn' : 'ok']++;
      }
      FIELD = cells;
    }
    const statusAtFrac = (f) => { const n = statusArr.length || 1; let i = (f * n) | 0; if (i < 0) i = 0; if (i >= n) i = n - 1; return statusArr[i] || 'ok'; };
    function cellAt(x, y) {
      const cx = Math.min(FCOLS - 1, Math.max(0, (x / W * FCOLS) | 0));
      const cy = Math.min(FROWS - 1, Math.max(0, (y / H * FROWS) | 0));
      return FIELD[cy * FCOLS + cx] || { ok: 1, warn: 0, crit: 0 };
    }

    // ── images for mosaic ──────────────────────────────────────────────────
    const imgs = {};
    [['mona', 'mona.png'], ['dsr', 'dsr-logo.png']].forEach(([k, src]) => { const im = new Image(); im.src = src; imgs[k] = im; });

    function drawShape(kind, c, GW, GH) {
      c.fillStyle = '#fff';
      if (kind === 'gear') {
        c.save(); c.translate(GW / 2, GH / 2);
        const R = Math.min(GW, GH) * 0.46, teeth = 12;
        c.beginPath();
        for (let i = 0; i < teeth * 2; i++) { const a = i / (teeth * 2) * Math.PI * 2; const rr = (i % 2) ? R * 0.8 : R; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        c.closePath(); c.fill();
        c.beginPath(); c.arc(0, 0, R * 0.5, 0, Math.PI * 2); c.fill();
        c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(0, 0, R * 0.22, 0, Math.PI * 2); c.fill();
        c.globalCompositeOperation = 'source-over'; c.restore();
      } else if (kind === 'factory') {
        const base = GH * 0.86, u = GW * 0.13;
        c.fillRect(GW * 0.10, base - GH * 0.34, u * 2.4, GH * 0.34);   // main block
        // sawtooth roof
        c.beginPath(); const ry = base - GH * 0.34, rx0 = GW * 0.10, rw = u * 2.4 / 4;
        for (let i = 0; i < 4; i++) { c.moveTo(rx0 + i * rw, ry); c.lineTo(rx0 + i * rw + rw, ry); c.lineTo(rx0 + i * rw + rw, ry - GH * 0.07); c.closePath(); }
        c.fill();
        c.fillRect(GW * 0.46, base - GH * 0.5, u * 1.7, GH * 0.5);     // taller block
        c.fillRect(GW * 0.70, base - GH * 0.62, u * 0.5, GH * 0.62);   // smokestack 1
        c.fillRect(GW * 0.80, base - GH * 0.7, u * 0.45, GH * 0.7);    // smokestack 2
        c.fillRect(0, base, GW, GH - base);                            // ground
      } else { // nephes wordmark
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '900 10px Arial, sans-serif';
        const w10 = c.measureText('NEPHES').width || 1;
        const fs = Math.min(GH * 0.7, (GW * 0.92) / w10 * 10);
        c.font = '900 ' + fs + 'px Arial, sans-serif';
        c.fillText('NEPHES', GW / 2, GH * 0.5);
      }
    }

    let lum = null, lumKey = '', GWm = 0, GHm = 0;
    function ensureLum() {
      const kind = imgRef.current;
      const TILE = Math.max(7, Math.round(Math.min(W, H) / 64));
      GWm = Math.max(16, Math.round(W / TILE)); GHm = Math.max(16, Math.round(H / TILE));
      const key = kind + '@' + GWm + 'x' + GHm;
      if (lum && key === lumKey) return true;
      oc.width = GWm; oc.height = GHm;
      // keep the offscreen TRANSPARENT (no black fill) so the logo's alpha mask
      // survives and lum×alpha still zeroes the empty areas for mona/shapes.
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, GWm, GHm);
      if (kind === 'mona' || kind === 'dsr') {
        const im = imgs[kind];
        if (!im || !im.complete || !im.naturalWidth) return false;   // not loaded yet
        const s = Math.min(GWm / im.naturalWidth, GHm / im.naturalHeight);
        const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
        octx.imageSmoothingEnabled = true;
        octx.drawImage(im, (GWm - dw) / 2, (GHm - dh) / 2, dw, dh);
      } else { drawShape(kind, octx, GWm, GHm); }
      const d = octx.getImageData(0, 0, GWm, GHm).data, out = new Float32Array(GWm * GHm);
      const isLogo = kind === 'dsr';
      for (let i = 0, p = 0; i < out.length; i++, p += 4) {
        const a = d[p + 3] / 255;
        out[i] = isLogo ? a : ((d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 255) * a;
      }
      lum = out; lumKey = key; return true;
    }

    // ── per-form state ─────────────────────────────────────────────────────
    let flowP = null;
    function initFlow() {
      const N = Math.min(1500, Math.max(500, Math.round((W * H) / 650)));
      flowP = new Array(N);
      for (let i = 0; i < N; i++) flowP[i] = { x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0 };
    }
    let motes = null;
    function initKaleido() {
      const M = 150;
      motes = new Array(M);
      for (let i = 0; i < M; i++) motes[i] = { r: Math.pow(Math.random(), 0.7), a: Math.random(), pi: (Math.random() * 1e6) | 0, sz: 1.5 + Math.random() * 4 };
    }
    let vorSeeds = null, vorOff = null, voctx = null, vorLast = -1, LW = 0, LH = 0;
    function initVoronoi() {
      const K = 64;
      vorSeeds = new Array(K);
      for (let i = 0; i < K; i++) vorSeeds[i] = { bx: Math.random(), by: Math.random(), px: Math.random() * 0.9 + 0.05, py: Math.random() * 0.9 + 0.05, ph: Math.random() * 6.28, pi: (Math.random() * 1e6) | 0, sp: 0.4 + Math.random() * 0.7 };
      LW = 132; LH = Math.max(40, Math.round(LW * H / W));
      vorOff = document.createElement('canvas'); vorOff.width = LW; vorOff.height = LH;
      voctx = vorOff.getContext('2d'); vorLast = -1;
    }

    // ── form renderers ─────────────────────────────────────────────────────
    function drawFlow() {
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.04; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55;
      for (let i = 0; i < flowP.length; i++) {
        const p = flowP[i], cell = cellAt(p.x, p.y), tot = cell.ok + cell.warn + cell.crit || 1;
        const critF = cell.crit / tot, warnF = cell.warn / tot;
        const base = Math.cos(p.x * 0.0042 + t * 1.7) + Math.sin(p.y * 0.0052 - t * 1.3) + Math.sin((p.x + p.y) * 0.0026 + t);
        const ang = base * 1.7 + critF * Math.sin(p.x * 0.05 + p.y * 0.05 + t * 9) * 3.2;
        const speed = 0.8 + warnF * 0.9 + critF * 2.6;
        p.vx = p.vx * 0.86 + Math.cos(ang) * speed * 0.5; p.vy = p.vy * 0.86 + Math.sin(ang) * speed * 0.5;
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x += W; else if (p.x >= W) p.x -= W;
        if (p.y < 0) p.y += H; else if (p.y >= H) p.y -= H;
        ctx.fillStyle = critF > 0.22 ? COL.crit : warnF > 0.28 ? COL.warn : (critF + warnF > 0.04 ? COL.accent : COL.ok);
        const sz = 1.5 + critF * 3 + warnF * 1.1; ctx.fillRect(p.x, p.y, sz, sz);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }

    function drawMosaic() {
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#141412'; ctx.fillRect(0, 0, W, H);              // grout
      if (!ensureLum()) { return; }
      const cw = W / GWm, ch = H / GHm, gap = Math.max(0.5, cw * 0.12);
      const total = GWm * GHm;
      for (let ty = 0; ty < GHm; ty++) {
        for (let tx = 0; tx < GWm; tx++) {
          const idx = ty * GWm + tx, l = lum[idx];
          const st = statusAtFrac(idx / total), rgb = rgbName(st);
          const tw = 0.93 + 0.07 * Math.sin(t * 3 + idx * 0.7);        // gentle twinkle
          const a = (0.1 + 0.9 * l) * tw;
          ctx.fillStyle = 'rgb(' + ((rgb[0] * a) | 0) + ',' + ((rgb[1] * a) | 0) + ',' + ((rgb[2] * a) | 0) + ')';
          ctx.fillRect(tx * cw, ty * ch, cw - gap, ch - gap);
        }
      }
    }

    function drawKaleido() {
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.10; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      const SEG = 10, wedge = Math.PI * 2 / SEG, Rmax = Math.min(W, H) * 0.5, n = statusArr.length || 1;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(t * 0.3);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
      for (let s = 0; s < SEG; s++) {
        ctx.save(); ctx.rotate(s * wedge); if (s % 2) ctx.scale(1, -1);
        for (let i = 0; i < motes.length; i++) {
          const m = motes[i], a = m.a * wedge, r = m.r * Rmax;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          ctx.fillStyle = colName(statusArr[m.pi % n] || 'ok');
          ctx.beginPath(); ctx.arc(x, y, m.sz, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }

    function drawSpiral() {
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.12; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      const n = statusArr.length || 1, M = Math.min(n, 1400), Rmax = Math.min(W, H) * 0.46;
      const spacing = Rmax / Math.sqrt(M), cx = W / 2, cy = H / 2, rot = t * 0.25, GA = 2.39996323;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85;
      for (let i = 0; i < M; i++) {
        const a = i * GA + rot, r = spacing * Math.sqrt(i);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        ctx.fillStyle = colName(statusArr[i] || 'ok');
        const sz = 1.1 + (r / Rmax) * 3.2;
        ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }

    function drawVoronoi() {
      const n = statusArr.length || 1, now = t;
      // recompute the cell map ~7x/sec (seeds drift slowly)
      if (now - vorLast > 0.05) {
        vorLast = now;
        const sx = new Float32Array(vorSeeds.length), sy = new Float32Array(vorSeeds.length);
        const sc = new Array(vorSeeds.length);
        for (let k = 0; k < vorSeeds.length; k++) {
          const s = vorSeeds[k];
          sx[k] = (s.px + Math.sin(now * s.sp + s.ph) * 0.06) * LW;
          sy[k] = (s.py + Math.cos(now * s.sp * 0.8 + s.ph) * 0.06) * LH;
          sc[k] = rgbName(statusArr[s.pi % n] || 'ok');
        }
        const id = voctx.createImageData(LW, LH), d = id.data, owner = new Int16Array(LW * LH);
        for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
          let best = 1e9, bk = 0;
          for (let k = 0; k < sx.length; k++) { const dx = x - sx[k], dy = y - sy[k], dd = dx * dx + dy * dy; if (dd < best) { best = dd; bk = k; } }
          const i = y * LW + x, p = i * 4, c = sc[bk]; owner[i] = bk;
          d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
        }
        // leading: darken region borders
        for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
          const i = y * LW + x;
          if ((x && owner[i] !== owner[i - 1]) || (y && owner[i] !== owner[i - LW])) { const p = i * 4; d[p] *= 0.25; d[p + 1] *= 0.25; d[p + 2] *= 0.25; }
        }
        voctx.putImageData(id, 0, 0);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false; ctx.drawImage(vorOff, 0, 0, LW, LH, 0, 0, W, H);
    }

    // ── main loop ──────────────────────────────────────────────────────────
    fit();
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(host);
    refresh(); const statusTimer = setInterval(refresh, 260);

    let t = 0, raf = 0, alive = true, lastForm = '', reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    function frame() {
      if (!alive) return;
      t += reduce ? 0.0012 : 0.0035;
      const f = formRef.current;
      if (f !== lastForm) {
        ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); lastForm = f;
        if (f === 'flow') initFlow();
        else if (f === 'kaleido') initKaleido();
        else if (f === 'voronoi') initVoronoi();
      }
      if (f === 'flow') drawFlow();
      else if (f === 'mosaic') drawMosaic();
      else if (f === 'kaleido') drawKaleido();
      else if (f === 'spiral') drawSpiral();
      else if (f === 'voronoi') drawVoronoi();
      raf = requestAnimationFrame(frame);
    }
    initFlow();
    raf = requestAnimationFrame(frame);

    return () => { alive = false; cancelAnimationFrame(raf); clearInterval(statusTimer); if (ro) ro.disconnect(); };
  }, []);

  // ── selector UI ────────────────────────────────────────────────────────
  const FORMS = [{ id: 'flow', label: 'Flow' }, { id: 'mosaic', label: 'Mosaic' }, { id: 'kaleido', label: 'Kaleido' }, { id: 'spiral', label: 'Spiral' }, { id: 'voronoi', label: 'Voronoi' }];
  const IMAGES = [{ id: 'mona', label: 'Mona Lisa' }, { id: 'dsr', label: 'DSR' }, { id: 'gear', label: 'Gear' }, { id: 'factory', label: 'Factory' }, { id: 'nephes', label: 'NEPHES' }];
  const pill = (active, small) => ({
    padding: small ? '2px 8px' : '3px 10px', fontSize: small ? 8.5 : 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
    fontFamily: 'inherit', cursor: 'pointer', borderRadius: 6, lineHeight: 1.5,
    background: active ? 'var(--accent)' : 'rgba(0,0,0,.5)', color: active ? '#000' : 'var(--text-2, #cfc8b6)',
    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--card-border, rgba(255,255,255,.12))'),
    backdropFilter: 'blur(3px)',
  });
  const legend = {
    flow: 'Flow field — colour & turbulence track live OK / WARN / CRIT state',
    mosaic: 'Mosaic — ' + (IMAGES.find((i) => i.id === img) || {}).label + ' rendered from the sensor tiles, tinted by plant health',
    kaleido: 'Kaleidoscope — the sensor field mirrored into a living mandala',
    spiral: 'Phyllotaxis — sensors placed on a golden-angle spiral',
    voronoi: 'Voronoi — sensors as drifting stained-glass cells',
  }[form];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', borderRadius: 'var(--r-md, 8px)' }} />
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 'calc(100% - 16px)' }}>
        {FORMS.map((f) => <button key={f.id} onClick={() => setForm(f.id)} style={pill(form === f.id)}>{f.label}</button>)}
      </div>
      {form === 'mosaic' &&
        <div style={{ position: 'absolute', top: 36, left: 8, display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 'calc(100% - 16px)' }}>
          {IMAGES.map((im) => <button key={im.id} onClick={() => setImg(im.id)} style={pill(img === im.id, true)}>{im.label}</button>)}
        </div>}
      <div style={{ position: 'absolute', left: 12, bottom: 9, font: '700 9px/1.4 var(--mono, monospace)', letterSpacing: '.13em', color: 'var(--text-3, #8a8576)', textTransform: 'uppercase', pointerEvents: 'none', textShadow: '0 1px 5px rgba(0,0,0,.8)', maxWidth: 'calc(100% - 24px)' }}>
        {legend}
      </div>
    </div>
  );
}

Object.assign(window, { SensorArt });

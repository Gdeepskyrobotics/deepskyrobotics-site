// IndustrialKit.jsx — NEPHES Factory Observer
// Live-data engine + presentational primitives, styled to the real NFO console
// (classes defined in Factory Observer.html). Exports to window.

// ── helpers ────────────────────────────────────────────────────────────────────
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const clk = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

function statusOf(a) {
  const v = a.val;
  if ((a.critHi != null && v >= a.critHi) || (a.critLo != null && v <= a.critLo)) return 'crit';
  if ((a.warnHi != null && v >= a.warnHi) || (a.warnLo != null && v <= a.warnLo)) return 'warn';
  return 'ok';
}
// a value comfortably inside the OK band (used by auto-mitigation to actually clear faults)
function safeTarget(a) {
  if (a.warnHi != null) return a.min + (a.warnHi - a.min) * 0.6;
  if (a.warnLo != null) return a.warnLo + (a.max - a.warnLo) * 0.4;
  return a.base;
}
// a value past the warn/crit limit (used by the fault simulator to push a device into alarm)
function faultTarget(a, sev) {
  if (a.warnHi != null || a.critHi != null) {
    const wh = a.warnHi != null ? a.warnHi : a.critHi;
    const ch = a.critHi != null ? a.critHi : a.warnHi;
    return sev === 'crit' ? ch + (a.max - ch) * 0.55 : wh + (ch != null ? (ch - wh) * 0.45 : (a.max - wh) * 0.3);
  }
  const wl = a.warnLo != null ? a.warnLo : a.critLo;
  const cl = a.critLo != null ? a.critLo : a.warnLo;
  return sev === 'crit' ? cl - (cl - a.min) * 0.55 : wl - (cl != null ? (wl - cl) * 0.45 : (wl - a.min) * 0.3);
}
function rw(v, vol, min, max) {  let n = v + (Math.random() - 0.5) * vol;
  if (n < min) n = min + Math.random() * vol;
  if (n > max) n = max - Math.random() * vol;
  return n;
}
const SEV_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)' };

// ── Sparkline (SVG path) ────────────────────────────────────────────────────────
function Spark({ series, w = 56, h = 18, color, min, max, strokeW = 1.4, dot = true }) {
  if (!series || series.length < 2) return <svg width={w} height={h} className="t-spark" />;
  const mn = min != null ? min : Math.min(...series);
  const mx = max != null ? max : Math.max(...series);
  const range = (mx - mn) || 1;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((Math.max(mn, Math.min(mx, v)) - mn) / range) * (h - 3) - 1.5;
    return [x, y];
  });
  const d = 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  const last = pts[pts.length - 1];
  const c = color || 'var(--accent)';
  return (
    <svg width={w} height={h} className="t-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke={c} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
      {dot && <circle cx={last[0]} cy={last[1]} r={1.7} fill={c} />}
    </svg>
  );
}

// ── Sensor tile ──────────────────────────────────────────────────────────────────
function SensorTile({ a, selected, onSelect }) {
  const st = statusOf(a);
  const c = SEV_COLOR[st];
  const span = (a.max - a.min) || 1;
  const fillPct = Math.max(2, Math.min(100, ((a.val - a.min) / span) * 100));
  return (
    <button className={`tile ${st === 'ok' ? '' : st} ${selected ? 'sel' : ''}`} onClick={onSelect}>
      <div className="t-row1">
        <span className="t-name">{a.label}</span>
        <span className={`t-badge ${st === 'ok' ? '' : st}`}>{st === 'ok' ? 'OK' : st}</span>
      </div>
      <div className="t-asset">{a.name}</div>
      <div className="t-row2">
        <div><span className="t-val" style={st !== 'ok' ? { color: c } : null}>{a.val.toFixed(a.dec != null ? a.dec : 1)}</span><span className="t-unit">{a.unit}</span></div>
        <Spark series={a.series} w={54} h={20} color={c} />
      </div>
      <div className="t-bar"><div className="t-fill" style={{ transform: `scaleX(${fillPct / 100})`, background: c }} /></div>
      <div className="t-row3"><span>{a.min}{a.unit}</span><span>lim {a.critHi != null ? a.critHi : (a.warnHi != null ? a.warnHi : a.max)}{a.unit}</span></div>
    </button>
  );
}

// ── Heatmap cell (memoized — only changed cells re-render at 10k scale) ─────────────
const HeatCell = React.memo(function HeatCell({ a, selected, onSelect }) {
  const st = statusOf(a);
  return <div className={`hm-cell ${st === 'warn' ? 'hm-warn' : st === 'crit' ? 'hm-crit' : ''} ${selected ? 'hm-sel' : ''}`} title={`${a.name} · ${a.label} ${a.val.toFixed(a.dec || 1)}${a.unit}`} onClick={() => onSelect(a.id)} />;
});

// ── KPI card ──────────────────────────────────────────────────────────────────────
function KpiCard({ label, value, unit, series, trend }) {
  const tr = trend || { dir: 'flat', txt: '' };
  const arrow = tr.dir === 'up' ? '▲' : tr.dir === 'down' ? '▼' : '→';
  const sparkColor = 'var(--text-4)';
  return (
    <div className="kpi">
      <div className="k-label">{label}</div>
      <span className="k-value">{value}</span>{unit && <span className="k-unit">{unit}</span>}
      <div className="k-bottom">
        <Spark series={series} w={42} h={10} color={sparkColor} strokeW={1.3} dot={false} />
        <span className={`k-trend ${tr.dir}`}>{arrow} {tr.txt}</span>
      </div>
    </div>
  );
}

// ── Recommendation card ─────────────────────────────────────────────────────────
function RecCard({ asset, sev, conf, msg, action, onAct, auto, mitigating, onMitigate }) {
  const cls = sev === 'crit' || sev === 'critical' ? 'crit' : sev === 'warn' || sev === 'warning' ? 'warn' : '';
  const busy = auto || mitigating;
  return (
    <div className={`rec ${onAct ? 'rec-click' : ''}`} onClick={onAct} title={onAct ? 'Open sensor detail' : undefined}>
      <div className="r-top">
        <span className="r-asset">{asset}</span>
        <span className={`r-sev ${cls}`}>{sev}</span>
        <span className="r-conf">{Math.round(conf * 100)}%</span>
      </div>
      <div className="conf-bar-wrap"><div className={`conf-bar ${cls}`} style={{ width: `${Math.round(conf * 100)}%` }} /></div>
      <div className="r-msg">{msg}</div>
      {busy ?
        <button className="r-act auto" disabled onClick={(e) => e.stopPropagation()}>◉ {auto ? 'Auto-mitigating' : 'Mitigating'}…</button> :
        action && <button className="r-act" onClick={(e) => { e.stopPropagation(); (onMitigate || onAct) && (onMitigate || onAct)(); }}>{action}</button>}
    </div>
  );
}

// ── Event row ──────────────────────────────────────────────────────────────────
function EventRow({ ev }) {
  return (
    <div className={`ev sev-${ev.sev}`}>
      <span className="e-ts">{ev.ts}</span>
      <span className="e-asset">{ev.asset}</span>
      <span className="e-msg">{ev.msg}</span>
    </div>
  );
}

// ── Health ring ──────────────────────────────────────────────────────────────────
function HealthRing({ pct }) {
  const r = 23, circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const color = pct >= 85 ? 'var(--ok)' : pct >= 65 ? 'var(--accent)' : 'var(--crit)';
  return (
    <div className="ring-box">
      <svg width="54" height="54" viewBox="0 0 54 54">
        <circle className="ring-bg" cx="27" cy="27" r={r} />
        <circle className="ring-val" cx="27" cy="27" r={r} stroke={color} strokeDasharray={circ.toFixed(2)} strokeDashoffset={off.toFixed(2)} />
      </svg>
      <div className="ring-num" style={{ color }}>{Math.round(pct)}</div>
    </div>
  );
}

// ── Live engines ─────────────────────────────────────────────────────────────────
function useAssets(seed, { live = true, speed = 1, volatility = 1, autoMit = false, faultsRef, mitRef } = {}) {
  const WIN = 30;
  const [assets, setAssets] = React.useState(() => seed.map(s => ({
    ...s, val: s.base, ts: clk(),
    series: Array.from({ length: WIN }, () => s.base + (Math.random() - 0.5) * s.vol * 3),
  })));
  React.useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => {
      const faults = faultsRef && faultsRef.current ? faultsRef.current : {};
      const mit = mitRef && mitRef.current ? mitRef.current : {};
      setAssets(prev => prev.map(a => {
        let nv;
        const faultSev = faults[a.group];
        const wantFaulted = faultSev === 'crit' ? statusOf(a) === 'crit' : statusOf(a) !== 'ok';
        if (faultSev && !mit[a.id] && !wantFaulted) {
          // fault injection: push toward the alarm band
          const tgt = faultTarget(a, faultSev);
          nv = a.val + (tgt - a.val) * 0.4 + (Math.random() - 0.5) * a.vol;
        } else if (mit[a.id] && statusOf(a) !== 'ok') {
          // per-device manual mitigation
          nv = a.val + (safeTarget(a) - a.val) * 0.5 + (Math.random() - 0.5) * a.vol * 0.4;
        } else if (autoMit && !faultSev) {
          if (statusOf(a) !== 'ok') nv = a.val + (safeTarget(a) - a.val) * 0.42 + (Math.random() - 0.5) * a.vol * 0.4;
          else nv = rw(a.val, a.vol * 0.3, a.min, a.max);
        } else {
          nv = rw(a.val, a.vol * volatility, a.min, a.max);
        }
        nv = Math.max(a.min, Math.min(a.max, nv));
        return { ...a, val: nv, series: [...a.series.slice(1), nv], ts: clk() };
      }));
    }, 950 / speed);
    return () => clearInterval(iv);
  }, [live, speed, volatility, autoMit]);
  return assets;
}

function useFactoryStream({ live = true, speed = 1, volatility = 1 } = {}) {
  const WIN = 42;
  const cfg = {
    oee:    { base: 84.2, vol: 0.5, min: 78, max: 91 },
    avail:  { base: 92.1, vol: 0.4, min: 86, max: 97 },
    perf:   { base: 88.7, vol: 0.6, min: 80, max: 95 },
    quality:{ base: 99.1, vol: 0.15, min: 97, max: 99.9 },
    mtbf:   { base: 312, vol: 4, min: 260, max: 360 },
    throughput: { base: 1240, vol: 22, min: 1100, max: 1380 },
    energy: { base: 412, vol: 9, min: 360, max: 470 },
    ingest: { base: 18400, vol: 420, min: 16000, max: 21000 },
    latency:{ base: 12.4, vol: 1.6, min: 7, max: 28 },
    queue:  { base: 240, vol: 35, min: 60, max: 620 },
  };
  const seedS = (c) => Array.from({ length: WIN }, () => c.base + (Math.random() - 0.5) * c.vol * 4);
  const [series, setSeries] = React.useState(() => { const o = {}; for (const k in cfg) o[k] = seedS(cfg[k]); return o; });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => {
      setSeries(prev => {
        const next = {};
        for (const k in cfg) { const arr = prev[k]; next[k] = [...arr.slice(1), rw(arr[arr.length - 1], cfg[k].vol * volatility, cfg[k].min, cfg[k].max)]; }
        return next;
      });
      setTick(t => t + 1);
    }, 950 / speed);
    return () => clearInterval(iv);
  }, [live, speed, volatility]);
  const last = {}; for (const k in series) last[k] = series[k][series[k].length - 1];
  return { series, last, tick, live, speed, volatility };
}

function trendOf(series, unit) {
  if (!series || series.length < 6) return { dir: 'flat', txt: '' };
  const a = series[series.length - 6], b = series[series.length - 1];
  const d = b - a;
  const dir = Math.abs(d) < (Math.abs(b) * 0.003 + 0.05) ? 'flat' : d > 0 ? 'up' : 'down';
  const txt = dir === 'flat' ? '0.0' : (d > 0 ? '+' : '') + d.toFixed(unit === '%' ? 1 : 0);
  return { dir, txt };
}

Object.assign(window, { fmt, clk, statusOf, rw, safeTarget, faultTarget, SEV_COLOR, Spark, SensorTile, HeatCell, KpiCard, RecCard, EventRow, HealthRing, useAssets, useFactoryStream, trendOf });

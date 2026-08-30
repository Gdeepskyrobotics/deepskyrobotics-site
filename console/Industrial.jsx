// Industrial.jsx — NEPHES Factory Observer console (public demo build)
// Layout: header (brand + health ring + profile pills) · 7-KPI strip ·
// main grid = Sensor Wall + side column (Detail / Operator / NEPHES AI / Live Events).
// Profiles map to the header pills: Manufacturing · Enterprise · Backend.

const PROFILES = [
{ id: 'manufacturing', name: 'Manufacturing' },
{ id: 'enterprise', name: 'Enterprise' },
{ id: 'backend', name: 'Backend' }];


// ── Factory floor model ──────────────────────────────────────────────────────
const SECTIONS = [
{ name: 'Assembly Line A', sub: 'LINE 01', assets: [
  { id: 'arm1', name: 'ROBOT-ARM-1', label: 'Vibration', unit: 'mm/s', base: 5.9, vol: 0.32, min: 3.5, max: 8.5, dec: 1, warnHi: 5.5, critHi: 7.2 },
  { id: 'arm2', name: 'ROBOT-ARM-2', label: 'Vibration', unit: 'mm/s', base: 4.3, vol: 0.3, min: 3, max: 8, dec: 1, warnHi: 5.5, critHi: 7.2 },
  { id: 'spdl', name: 'SPINDLE-DRV', label: 'Temp', unit: '°C', base: 62, vol: 1.5, min: 50, max: 92, dec: 1, warnHi: 78, critHi: 88 },
  { id: 'servo', name: 'SERVO-AXIS', label: 'Load', unit: '%', base: 91, vol: 2.4, min: 30, max: 99, dec: 0, warnHi: 90, critHi: 97 },
  { id: 'convf', name: 'CONV-FEED', label: 'Belt Load', unit: '%', base: 75.7, vol: 3, min: 40, max: 99, dec: 1, warnHi: 92, critHi: 98 }]
},
{ name: 'Conveyor System', sub: 'LINE 02', assets: [
  { id: 'belt1', name: 'BELT-DRV-1', label: 'Speed', unit: 'm/s', base: 5.9, vol: 0.16, min: 4.5, max: 7, dec: 1, warnLo: 4.8, warnHi: 6.6 },
  { id: 'belt2', name: 'BELT-DRV-2', label: 'Speed', unit: 'm/s', base: 3.9, vol: 0.16, min: 2.8, max: 6, dec: 1, warnLo: 3.0, warnHi: 5.4 },
  { id: 'rollr', name: 'ROLLER-BANK', label: 'Torque', unit: 'Nm', base: 13.3, vol: 0.38, min: 4, max: 14, dec: 1, warnHi: 11, critHi: 13 },
  { id: 'divrt', name: 'DIVERTER', label: 'Cycle', unit: 's', base: 3.7, vol: 0.2, min: 2.5, max: 6, dec: 1, warnHi: 5, critHi: 5.6 },
  { id: 'sortr', name: 'SORTER', label: 'Throughput', unit: '%', base: 71, vol: 4, min: 30, max: 99, dec: 0, warnLo: 55, critLo: 40 }]
},
{ name: 'Hydraulic Systems', sub: 'LINE 03', assets: [
  { id: 'hp1', name: 'HYD-PUMP-1', label: 'Pressure', unit: 'PSI', base: 209, vol: 5, min: 160, max: 300, dec: 0, warnHi: 245, critHi: 280 },
  { id: 'hp2', name: 'HYD-PUMP-2', label: 'Pressure', unit: 'PSI', base: 256, vol: 6, min: 180, max: 320, dec: 0, warnHi: 245, critHi: 285 },
  { id: 'accum', name: 'ACCUMULATOR', label: 'Pressure', unit: 'PSI', base: 188, vol: 4, min: 140, max: 260, dec: 0, warnHi: 230, critHi: 255 },
  { id: 'manif', name: 'MANIFOLD', label: 'Flow', unit: 'L/m', base: 34.6, vol: 0.9, min: 18, max: 40, dec: 1, warnHi: 34, critHi: 38 },
  { id: 'filt', name: 'FILTER-DP', label: 'Differential', unit: 'bar', base: 8.0, vol: 0.25, min: 3, max: 9, dec: 1, warnHi: 6.5, critHi: 7.8 }]
},
{ name: 'Utilities', sub: 'PLANT', assets: [
  { id: 'pwr', name: 'MAIN-POWER', label: 'Load', unit: 'kW', base: 180, vol: 6, min: 120, max: 260, dec: 0, warnHi: 230, critHi: 250 },
  { id: 'air', name: 'COMP-AIR', label: 'Line Pressure', unit: 'bar', base: 6.8, vol: 0.2, min: 5, max: 8.5, dec: 1, warnLo: 5.8, critLo: 5.2 },
  { id: 'cool', name: 'COOLANT', label: 'Temp', unit: '°C', base: 37, vol: 0.8, min: 18, max: 48, dec: 1, warnHi: 36, critHi: 43 },
  { id: 'rh', name: 'AMBIENT', label: 'Humidity', unit: '%RH', base: 47, vol: 1.5, min: 30, max: 70, dec: 0, warnHi: 62, critHi: 68 }]
}];

const FLAT_SEED = SECTIONS.flatMap((s) => s.assets.map((a) => ({ ...a, group: s.name, sub: s.sub })));
const NODE_FW = { 'Assembly Line A': 'edge-01·v3.4.1', 'Conveyor System': 'edge-03·v3.4.1', 'Hydraulic Systems': 'edge-05·v3.3.9', 'Utilities': 'gw-plant·v2.9.4' };

// ── Sensor fleet (heatmap / Grid view) ───────────────────────────────────────
// One heatmap cell per real sensor on the floor (the few sensors, not a synthetic
// crowd), each seeded into a target zone so the wall shows a realistic spread
// (~86% OK, the rest flagged). Keeps the counts believable instead of "312 flagged".
const GRID_TOTAL = FLAT_SEED.length;
function buildGridSeed(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const tpl = FLAT_SEED[i % FLAT_SEED.length];
    const upper = tpl.critHi != null || tpl.warnHi != null;
    const roll = Math.random();
    const zone = roll < 0.86 ? 'ok' : roll < 0.965 ? 'warn' : 'crit';
    let base;
    if (upper) {
      const wH = tpl.warnHi != null ? tpl.warnHi : tpl.max;
      const cH = tpl.critHi != null ? tpl.critHi : tpl.max;
      if (zone === 'ok') base = tpl.min + Math.random() * (wH - tpl.min) * 0.92;else
      if (zone === 'warn') base = wH + Math.random() * Math.max(0.1, (cH - wH) * 0.9);else
      base = cH + Math.random() * Math.max(0.2, tpl.max - cH);
    } else {
      const wL = tpl.warnLo != null ? tpl.warnLo : tpl.min;
      const cL = tpl.critLo != null ? tpl.critLo : tpl.min;
      if (zone === 'ok') base = wL + Math.random() * Math.max(0.2, tpl.max - wL);else
      if (zone === 'warn') base = cL + Math.random() * Math.max(0.1, (wL - cL) * 0.9);else
      base = tpl.min + Math.random() * Math.max(0.2, cL - tpl.min);
    }
    base = Math.max(tpl.min, Math.min(tpl.max, base));
    const lineNo = i % 4 + 1;
    out.push({
      id: 'g' + i, group: tpl.group, sub: tpl.sub, label: tpl.label, unit: tpl.unit,
      name: tpl.name.replace(/-\d+$/, '') + '-' + String(i + 1).padStart(4, '0'),
      base, val: base, vol: tpl.vol, min: tpl.min, max: tpl.max, dec: tpl.dec,
      warnHi: tpl.warnHi, critHi: tpl.critHi, warnLo: tpl.warnLo, critLo: tpl.critLo
    });
  }
  return out;
}
const GRID_SEED = buildGridSeed(GRID_TOTAL);

// Lightweight live hook for the fleet — only a subset of points drift per tick so
// the 10k memoized cells mostly keep identical props (cheap re-renders).
function useGridPoints({ live = true, speed = 1, volatility = 1, autoMit = false, faultsRef, mitRef } = {}) {
  const SWIN = 12;
  const [pts, setPts] = React.useState(() => GRID_SEED.map((p) => ({
    ...p, ts: clk(), series: Array.from({ length: SWIN }, () => p.base + (Math.random() - 0.5) * p.vol * 2)
  })));
  React.useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => {
      setPts((prev) => {
        const next = prev.slice();
        const faults = faultsRef && faultsRef.current ? faultsRef.current : {};
        const mit = mitRef && mitRef.current ? mitRef.current : {};
        const hasFaults = Object.keys(faults).length > 0;
        // 1) fault injection: ramp a budget of cells in faulted groups into the alarm band
        if (hasFaults) {
          let budget = 180;
          let i = Math.random() * prev.length | 0;
          for (let scan = 0; scan < prev.length && budget > 0; scan++, i = (i + 1) % prev.length) {
            const p = next[i];
            const sev = faults[p.group];
            if (!sev || mit[p.id]) continue;
            const there = sev === 'crit' ? statusOf(p) === 'crit' : statusOf(p) !== 'ok';
            if (there) continue;
            const tgt = faultTarget(p, sev);
            let nv = p.val + (tgt - p.val) * 0.5 + (Math.random() - 0.5) * p.vol;
            nv = Math.max(p.min, Math.min(p.max, nv));
            next[i] = { ...p, val: nv, series: [...p.series.slice(1), nv], ts: clk() };
            budget--;
          }
        }
        // 2) global auto-mitigation: heal flagged cells (skip faulted groups)
        if (autoMit) {
          const flagged = [];
          for (let j = 0; j < next.length; j++) {if (statusOf(next[j]) !== 'ok' && !faults[next[j].group]) flagged.push(j);}
          const healCount = Math.min(flagged.length, 150);
          for (let n = 0; n < healCount; n++) {
            const j = flagged[Math.random() * flagged.length | 0];
            const p = next[j];
            let nv = p.val + (safeTarget(p) - p.val) * 0.45 + (Math.random() - 0.5) * p.vol * 0.4;
            nv = Math.max(p.min, Math.min(p.max, nv));
            next[j] = { ...p, val: nv, series: [...p.series.slice(1), nv], ts: clk() };
          }
        }
        // 3) per-device manual mitigation: heal specific cells every tick
        for (const id in mit) {
          const j = next.findIndex((p) => p.id === id);
          if (j >= 0 && statusOf(next[j]) !== 'ok') {
            const p = next[j];
            let nv = p.val + (safeTarget(p) - p.val) * 0.5 + (Math.random() - 0.5) * p.vol * 0.4;
            nv = Math.max(p.min, Math.min(p.max, nv));
            next[j] = { ...p, val: nv, series: [...p.series.slice(1), nv], ts: clk() };
          }
        }
        // 4) normal drift on a random subset (skip faulted groups so they stay lit)
        const k = Math.max(1, Math.round(prev.length * (autoMit ? 0.03 : 0.05)));
        for (let j = 0; j < k; j++) {
          const idx = Math.random() * prev.length | 0;
          const p = next[idx];
          if (faults[p.group] || mit[p.id]) continue;
          const nv = rw(p.val, p.vol * volatility, p.min, p.max);
          next[idx] = { ...p, val: nv, series: [...p.series.slice(1), nv], ts: clk() };
        }
        return next;
      });
    }, 950 / speed);
    return () => clearInterval(iv);
  }, [live, speed, volatility, autoMit]);
  return pts;
}

const REC_MSGS = {
  arm1: 'Bearing wear signature on axis 4. Schedule lubrication within 48h to avoid spindle seizure.',
  servo: 'Sustained load above 90% — reduce feed rate 8% or rebalance the cell to extend drive life.',
  rollr: 'Torque trending into critical band. Inspect roller bearings; possible debris on track.',
  filt: 'Filter ΔP near limit — clogging detected. Replace element next maintenance window.',
  cool: 'Coolant temperature above setpoint. Verify chiller loop flow and ambient extraction.'
};

// ── Profile switcher (dropdown) ───────────────────────────────────────────────
function ProfileSwitcher({ profile, setProfile }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const cur = PROFILES.find((p) => p.id === profile) || PROFILES[0];
  return (
    <div className="profile-dd" ref={ref}>
      <button className={`profile-dd-btn ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox" aria-expanded={open} title="Switch console profile">
        <span className="pdd-dot" />
        <span className="pdd-label">{cur.name}</span>
        <span className="pdd-caret">▾</span>
      </button>
      {open &&
        <div className="profile-dd-menu" role="listbox">
          {PROFILES.map((p) =>
          <button key={p.id} role="option" aria-selected={p.id === profile}
            className={`profile-dd-item ${p.id === profile ? 'on' : ''}`}
            onClick={() => { setOpen(false); setProfile(p.id); }}>
            <span className="pdd-dot" />{p.name}
            {p.id === profile && <span className="pdd-check">✓</span>}
          </button>
          )}
        </div>}
    </div>);

}

// ── Profile-switch boot splash (reuses the NEPHES intro look) ──────────────────
function ProfileSplash({ label, leaving }) {
  return (
    <div className={`fo-splash ${leaving ? 'out' : ''}`} role="status" aria-live="polite">
      <img src="dsr-logo.png" className="fo-splash-logo" alt="NEPHES"
        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
      <div className="fo-splash-word">
        <div className="fw-name">NEPHES</div>
        <div className="fw-sub">{label ? label + ' Console' : 'Factory Observer'}</div>
      </div>
      <div className="fo-splash-bar"><i /></div>
    </div>);

}

// ── Documentation viewer (renders docs/*.md via marked, sanitized by DOMPurify) ─
function DocViewer({ doc, onClose }) {
  const bodyRef = React.useRef(null);
  const [state, setState] = React.useState('loading'); // loading | ok | err
  React.useEffect(() => {
    let off = false;
    setState('loading');
    fetch('/factory-observer/docs/raw?path=' + encodeURIComponent(doc.path))
      .then((r) => r.ok ? r.text() : Promise.reject())
      .then((md) => {
        if (off) return;
        const el = bodyRef.current;
        let rendered = null;
        try { rendered = window.marked ? window.marked.parse(md) : null; } catch (e) { rendered = null; }
        // DOMPurify hands back sanitized DOM nodes directly — no HTML-string assignment.
        const frag = (rendered != null && window.DOMPurify)
          ? window.DOMPurify.sanitize(rendered, { RETURN_DOM_FRAGMENT: true })
          : null;
        if (el) {
          el.replaceChildren();
          if (frag) {
            el.appendChild(frag);
          } else {
            const pre = document.createElement('pre');
            pre.textContent = md; // textContent never parses HTML
            el.appendChild(pre);
          }
        }
        setState('ok');
      })
      .catch(() => { if (!off) setState('err'); });
    return () => { off = true; };
  }, [doc.path]);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Portal to <body> so the fixed backdrop covers the whole viewport (clicking
  // anywhere off the panel closes it) instead of being trapped in the header.
  return ReactDOM.createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="doc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">{doc.title}<button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="doc-modal-body md-body">
          {state === 'loading' && <div className="ai-empty">Loading…</div>}
          {state === 'err' && <div className="ai-empty">Could not load this document.</div>}
          <div ref={bodyRef} style={state === 'ok' ? null : { display: 'none' }} />
        </div>
        <div className="doc-modal-foot">{doc.path}</div>
      </div>
    </div>,
    document.body);

}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ health, statusText, recText, counts, profile, setProfile, clock, stale, blueLight, setBlueLight, autoMit, setAutoMit, onAddSensor, customCount }) {
  const hc = health >= 85 ? 'var(--ok)' : health >= 65 ? 'var(--accent)' : 'var(--crit)';
  const [open, setOpen] = React.useState(false);
  const [stab, setStab] = React.useState('settings');
  const [docs, setDocs] = React.useState(null);     // null = not fetched yet
  const [viewerDoc, setViewerDoc] = React.useState(null);
  const settingsWrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (settingsWrapRef.current && !settingsWrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  // lazy-load the docs list the first time the Docs tab is opened
  React.useEffect(() => {
    if (!open || stab !== 'docs' || docs !== null) return;
    let off = false;
    fetch('/factory-observer/docs')
      .then((r) => r.ok ? r.json() : [])
      .then((list) => { if (!off) setDocs(Array.isArray(list) ? list : []); })
      .catch(() => { if (!off) setDocs([]); });
    return () => { off = true; };
  }, [open, stab, docs]);
  return (
    <header className="hdr fade-in">
      <div className="hdr-brand">
        <img src="dsr-logo.png" className="hdr-logo-img" alt="NFO" />
        <div className="hdr-title">NEPHES FACTORY OBSERVER <small>MANUFACTURING INTELLIGENCE</small></div>
      </div>
      <div className="hdr-spacer" />
      <div className="hdr-health">
        <div className="hh-top">
          <span className="hh-l">PLANT HEALTH</span>
          <span className="hh-status" style={{ color: hc }}>{statusText}</span>
          <span className="hh-v" style={{ color: hc }}>{health}%</span>
        </div>
        <div className="hh-bar">
          <span className="hh-seg ok" style={{ width: counts.ok / (counts.ok + counts.warn + counts.crit || 1) * 100 + '%' }} />
          <span className="hh-seg warn" style={{ width: counts.warn / (counts.ok + counts.warn + counts.crit || 1) * 100 + '%' }} />
          <span className="hh-seg crit" style={{ width: counts.crit / (counts.ok + counts.warn + counts.crit || 1) * 100 + '%' }} />
        </div>
        <div className="hh-legend">
          <span><i className="ok" />OK <b>{counts.ok}</b></span>
          <span><i className="warn" />Warn <b>{counts.warn}</b></span>
          <span><i className="crit" />Crit <b>{counts.crit}</b></span>
          <span className="hh-rec">{recText}</span>
        </div>
      </div>
      <div className="hdr-spacer" />
      <div className={`live-dot-wrap ${stale ? 'stale' : ''}`}><span className="live-dot" />{stale ? 'PAUSED' : 'LIVE'}</div>
      <div className="hdr-clock">{clock}</div>
      <button className={`mit-toggle ${autoMit ? 'on' : ''}`} onClick={() => setAutoMit((v) => !v)} aria-pressed={autoMit} title="Global auto-mitigation">
        <span className="mt-icon">◉</span>
        <span className="mt-label">AUTO-MITIGATE</span>
        <span className="mt-switch"><span className="mt-knob" /></span>
      </button>
      <ProfileSwitcher profile={profile} setProfile={setProfile} />
      <div className="settings-wrap" ref={settingsWrapRef}>
        <button className={`settings-btn ${open ? 'open' : ''}`} title="Settings" onClick={() => setOpen((o) => !o)}>⚙</button>
        {open &&
        <div className="settings-panel">
            <div className="settings-tabs">
              <button className={`settings-tab ${stab === 'docs' ? 'on' : ''}`} onClick={() => setStab('docs')}>Docs</button>
              <button className={`settings-tab ${stab === 'settings' ? 'on' : ''}`} onClick={() => setStab('settings')}>Settings</button>
            </div>
            {stab === 'settings' &&
            <div className="settings-pane">
                <div className="settings-panel-title">Display</div>
                <div className="settings-row">
                  <span className="settings-label">Blue light filter</span>
                  <button className={`settings-toggle ${blueLight ? 'on' : ''}`} aria-pressed={blueLight} onClick={() => setBlueLight((v) => !v)}>
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
                <div className="settings-panel-title" style={{ marginTop: 14 }}>Sensors</div>
                <div className="settings-row">
                  <span className="settings-label">Provisioned</span>
                  <span className="settings-count">{customCount || 0} custom</span>
                </div>
                <button className="settings-add-sensor" onClick={() => { onAddSensor && onAddSensor(); }}>＋ Add Sensor</button>
                <div className="settings-hint">Manually register a sensor into the system — it goes live on the wall (Tiles view).</div>
              </div>}
            {stab === 'docs' &&
            <div className="settings-pane">
                <div className="settings-panel-title">Documentation</div>
                {docs === null && <div className="settings-hint">Loading docs…</div>}
                {docs && docs.length === 0 && <div className="settings-hint">No documents found under /docs.</div>}
                {docs && docs.map((dd) =>
                <a key={dd.path} className="doc-link" href="#" onClick={(e) => { e.preventDefault(); setOpen(false); setViewerDoc(dd); }}>
                    <span className="doc-ic">📄</span>
                    <span className="doc-text"><span className="doc-t">{dd.title}</span><span className="doc-d">{dd.path}</span></span>
                    <span className="doc-arrow">↗</span>
                  </a>
                )}
              </div>}
            <div className="settings-ver">
              <span className="sv-dot" />NEPHES Factory Observer
              <span className="sv-tag">LIVE DEMO · SIMULATED DATA</span>
            </div>
          </div>}
      </div>
      {viewerDoc && <DocViewer doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </header>);

}

// ── KPI strip ────────────────────────────────────────────────────────────────
function KpiStrip({ stream, counts, profile }) {
  const { last, series } = stream;
  const online = NODES.filter((n) => n.state !== 'offline').length;
  const sets = {
    manufacturing: [
      { label: 'OEE', value: last.oee.toFixed(1), unit: '%', s: series.oee, u: '%' },
      { label: 'Availability', value: last.avail.toFixed(1), unit: '%', s: series.avail, u: '%' },
      { label: 'Performance', value: last.perf.toFixed(1), unit: '%', s: series.perf, u: '%' },
      { label: 'Quality', value: last.quality.toFixed(1), unit: '%', s: series.quality, u: '%' },
      { label: 'MTBF', value: fmt(last.mtbf), unit: 'h', s: series.mtbf, u: 'h' },
      { label: 'Open Episodes', value: counts.crit + counts.warn, unit: '', s: series.queue, u: '' },
      { label: 'Findings', value: counts.crit, unit: '', s: series.latency, u: '' }],
    enterprise: [
      { label: 'OEE', value: last.oee.toFixed(1), unit: '%', s: series.oee, u: '%' },
      { label: 'Output Value', value: '$' + fmt(Math.round(last.throughput * 42)), unit: '/h', s: series.throughput, u: '' },
      { label: 'Throughput', value: fmt(last.throughput), unit: 'u/h', s: series.throughput, u: '' },
      { label: 'Cost / Unit', value: '$' + (3.10 + (90 - last.oee) * 0.06).toFixed(2), unit: '', s: series.energy, u: '' },
      { label: 'Energy Cost', value: '$' + fmt(Math.round(last.energy * 0.14)), unit: '/h', s: series.energy, u: '' },
      { label: 'Revenue at Risk', value: '$' + fmt(Math.round((92 - last.oee) * last.throughput * 0.6)), unit: '/h', s: series.queue, u: '' },
      { label: 'Quality', value: last.quality.toFixed(1), unit: '%', s: series.quality, u: '%' }],
    backend: [
      { label: 'Ingest', value: fmt(last.ingest), unit: 'pt/s', s: series.ingest, u: '' },
      { label: 'Latency', value: last.latency.toFixed(1), unit: 'ms', s: series.latency, u: 'ms' },
      { label: 'Queue Depth', value: fmt(Math.round(last.queue)), unit: '', s: series.queue, u: '' },
      { label: 'Nodes Online', value: online + '/' + NODES.length, unit: '', s: series.avail, u: '' },
      { label: 'DB Writes', value: fmt(Math.round(last.ingest * 0.98)), unit: 'rows/s', s: series.ingest, u: '' },
      { label: 'Packet Loss', value: '0.0', unit: '%', s: series.quality, u: '%' },
      { label: 'Uptime', value: '99.98', unit: '%', s: series.avail, u: '%' }],
    datasheets: [
      { label: 'Equipment profiles', value: '—', unit: '', s: series.avail, u: '' },
      { label: 'Avg confidence', value: '—', unit: '', s: series.quality, u: '' },
      { label: 'Linked assets', value: '—', unit: '', s: series.throughput, u: '' }]
  };
  const items = sets[profile] || sets.manufacturing;
  return (
    <section className="kpis fade-in">
      {items.map((k) => <KpiCard key={k.label} label={k.label} value={k.value} unit={k.unit} series={k.s} trend={trendOf(k.s, k.u)} />)}
    </section>);

}

// ── Sensor Wall ──────────────────────────────────────────────────────────────
function SensorWall({ assets, gridPoints, sel, setSel, view, setView, profile, stream, liveHw }) {
  const [grp, setGrp] = React.useState('all');
  const [sev, setSev] = React.useState('all');
  const [q, setQ] = React.useState('');

  const groups = SECTIONS.map((s) => s.name);
  const matchQ = (a) => !q || (a.name + ' ' + a.label).toLowerCase().includes(q.toLowerCase());
  const matchFilters = (a) => (grp === 'all' || a.group === grp) && (sev === 'all' || statusOf(a) === sev) && matchQ(a);

  const visibleTiles = assets.filter(matchFilters);
  const gridVisible = gridPoints.filter(matchFilters);
  const isGrid = view === 'grid';

  const total = isGrid ? gridPoints.length : assets.length;
  const flagged = (isGrid ? gridPoints : assets).filter((a) => statusOf(a) !== 'ok').length;

  // auto-size the wall window to the number of sensors currently shown — both views
  const visN = visibleTiles.length;
  const tileCols = visN <= 3 ? Math.max(1, visN) : visN <= 8 ? 3 : visN <= 15 ? 4 : visN <= 24 ? 5 : 6;
  const gBucket = Math.max(25, Math.ceil(gridVisible.length / 25) * 25); // bucket so live count changes don't jitter the width
  const gCols = Math.min(50, Math.max(6, Math.ceil(Math.sqrt(gBucket) * 1.6)));
  const wallW = isGrid ?
  gCols * 10 + (gCols - 1) * 3 + 44 :
  tileCols * 170 + (tileCols - 1) * 6 + 32;
  const cardStyle = { flex: '1 1 0', minWidth: 0 };

  // arrow-key navigation across the heatmap grid
  const navRef = React.useRef({});
  navRef.current = { gridVisible, gCols, sel, setSel, isGrid };
  React.useEffect(() => {
    const onKey = (e) => {
      const { gridVisible, gCols, sel, setSel, isGrid } = navRef.current;
      if (!isGrid) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const n = gridVisible.length;
      if (!n) return;
      e.preventDefault();
      const idx = gridVisible.findIndex((p) => p.id === sel);
      if (idx < 0) { setSel(gridVisible[0].id); return; }
      let ni = idx;
      if (e.key === 'ArrowLeft') ni = idx - 1;
      else if (e.key === 'ArrowRight') ni = idx + 1;
      else if (e.key === 'ArrowUp') ni = idx - gCols;
      else if (e.key === 'ArrowDown') ni = idx + gCols;
      ni = Math.max(0, Math.min(n - 1, ni));
      if (ni === idx) return;
      setSel(gridVisible[ni].id);
      requestAnimationFrame(() => {
        const cell = document.querySelector('.hm-cell.hm-sel');
        const scroller = document.querySelector('.wall-scroll');
        if (cell && scroller) {
          const cr = cell.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
          if (cr.top < sr.top) scroller.scrollTop -= sr.top - cr.top + 10;
          else if (cr.bottom > sr.bottom) scroller.scrollTop += cr.bottom - sr.bottom + 10;
        }
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`wall-card ${isGrid ? 'grid-view' : ''}`} style={cardStyle}>
      <div className="card-head">
        SENSOR WALL
        <span className="count-pill">{fmt(total)} sensors</span>
        {flagged > 0 && <span className="count-pill crit">{fmt(flagged)} flagged</span>}
        <div className="view-toggle" style={{ marginLeft: 'auto', display: 'inline-flex', border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
          {['tiles', 'grid'].map((v) =>
          <button key={v} className="vt-btn" onClick={() => setView(v)} style={{ background: view === v ? 'var(--accent)' : 'transparent', color: view === v ? '#000' : 'var(--text-2)', border: 'none', padding: '3px 11px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer', fontFamily: 'inherit' }}>{v === 'tiles' ? 'Tiles' : 'Grid'}</button>
          )}
        </div>
      </div>
      <div className="wall-filters">
        <div className="wf-group">
          <span className="wf-label">Group</span>
          <button className={`wf-btn ${grp === 'all' ? 'active' : ''}`} onClick={() => setGrp('all')}>All</button>
          {groups.map((g) => <button key={g} className={`wf-btn ${grp === g ? 'active' : ''}`} onClick={() => setGrp(g)}>{g.replace(' System', '').replace(' Systems', '')}</button>)}
        </div>
        <span className="wf-sep" />
        <div className="wf-group">
          <span className="wf-label">Status</span>
          <button className={`wf-btn ${sev === 'all' ? 'active' : ''}`} onClick={() => setSev('all')}>All</button>
          <button className={`wf-btn wf-warn ${sev === 'warn' ? 'active' : ''}`} onClick={() => setSev('warn')}>Warn</button>
          <button className={`wf-btn wf-crit ${sev === 'crit' ? 'active' : ''}`} onClick={() => setSev('crit')}>Crit</button>
        </div>
        <input className="wf-search" placeholder="Search assets…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </div>
      <div className="wall-scroll" style={view === 'art' ? { padding: 0, width: "100%", height: "603px", overflow: 'hidden' } : { padding: "10px", width: "100%", height: "603px" }}>
        {view === 'art' && <SensorArt points={gridPoints} />}
        {view !== 'art' && liveHw && liveHw.sensors.length > 0 &&
        <div className="grp">
            <div className="grp-head"><span className="g-name" style={{ color: 'var(--ok)' }}>◉ Live Hardware</span><span className="g-sub">REAL SENSORS</span><span className="g-count">{liveHw.sensors.length}</span></div>
            <div className="grp-grid" style={{ '--cols': isGrid ? 5 : tileCols }}>
              {liveHw.sensors.map((s) => <SensorTile key={s.id} a={s} selected={sel === s.id} onSelect={() => setSel(s.id)} />)}
            </div>
          </div>}
        {view !== 'art' && (isGrid ?
        <React.Fragment>
            <div className="hm-legend">
              <span className="hm-count">{fmt(gridVisible.length)} of {fmt(gridPoints.length)} points</span>
              <span className="hm-key"><span className="hm-sw" style={{ background: '#3e6a4d' }} />OK</span>
              <span className="hm-key"><span className="hm-sw" style={{ background: 'var(--warn)' }} />Warn</span>
              <span className="hm-key"><span className="hm-sw" style={{ background: 'var(--crit)' }} />Crit</span>
            </div>
            <div className="hm-grid hm-100" style={{ '--gcols': gCols }}>
              {gridVisible.map((a) => <HeatCell key={a.id} a={a} selected={sel === a.id} onSelect={setSel} />)}
            </div>
          </React.Fragment> :

        <React.Fragment>
          {SECTIONS.filter((s) => grp === 'all' || s.name === grp).map((s) => {
          const list = visibleTiles.filter((a) => a.group === s.name);
          if (!list.length) return null;
          const gst = list.some((a) => statusOf(a) === 'crit') ? 'crit' : list.some((a) => statusOf(a) === 'warn') ? 'warn' : '';
          return (
            <div key={s.name} className="grp">
                <div className={`grp-head ${gst}`}>
                  <span className="g-name">{s.name}</span>
                  <span className="g-sub">{profile === 'backend' ? NODE_FW[s.name] : s.sub}</span>
                  <span className="g-count">{list.length}</span>
                </div>
                <div className="grp-grid" style={{ '--cols': tileCols }}>
                  {list.map((a) => <SensorTile key={a.id} a={a} selected={sel === a.id} onSelect={() => setSel(a.id)} />)}
                </div>
              </div>);

          })}
          {stream && <PlantTrends stream={stream} />}
        </React.Fragment>
        )}
      </div>
    </div>);

}

// ── Enterprise: per-line rollup ───────────────────────────────────────────────
function PlantTrends({ stream }) {
  const { last, series } = stream;
  const cards = [
    { label: 'Plant OEE', value: last.oee.toFixed(1), unit: '%', s: series.oee, color: 'var(--accent)' },
    { label: 'Throughput', value: fmt(last.throughput), unit: 'u/h', s: series.throughput, color: 'var(--ok)' },
    { label: 'Energy Draw', value: fmt(last.energy), unit: 'kWh', s: series.energy, color: 'var(--warn)' }];

  return (
    <div className="grp trend-strip-wrap">
      <div className="grp-head"><span className="g-name">Plant Trends</span><span className="g-sub">THIS SHIFT</span><span className="g-count">live</span></div>
      <div className="trend-strip">
        {cards.map((c) =>
        <div className="trend-card" key={c.label}>
            <div className="tc-top">
              <span className="tc-label">{c.label}</span>
              <span className="tc-value">{c.value}<span className="tc-unit">{c.unit}</span></span>
            </div>
            <Spark series={c.s} w={210} h={42} color={c.color} strokeW={1.6} />
          </div>
        )}
      </div>
    </div>);

}

// ── System (Backend) profile: platform infrastructure ─────────────────────────
const NODES = [
  { id: 'edge-01', line: 'Assembly Line A', fw: 'v3.4.1', sensors: 5 },
  { id: 'edge-02', line: 'Assembly Line A', fw: 'v3.4.1', sensors: 4 },
  { id: 'edge-03', line: 'Conveyor System', fw: 'v3.4.1', sensors: 5 },
  { id: 'edge-04', line: 'Conveyor System', fw: 'v3.4.0', sensors: 4 },
  { id: 'edge-05', line: 'Hydraulic Systems', fw: 'v3.3.9', sensors: 5 },
  { id: 'edge-06', line: 'Hydraulic Systems', fw: 'v3.3.9', sensors: 3 },
  { id: 'edge-07', line: 'Utilities', fw: 'v2.9.4', sensors: 4 },
  { id: 'edge-08', line: 'Utilities', fw: 'v2.9.4', sensors: 4 },
  { id: 'edge-09', line: 'Press Shop', fw: 'v3.4.1', sensors: 6 },
  { id: 'edge-10', line: 'Paint Line', fw: 'v3.3.9', sensors: 5, state: 'degraded' },
  { id: 'edge-11', line: 'Packaging', fw: 'v3.4.0', sensors: 4 },
  { id: 'gw-plant', line: 'Plant Gateway', fw: 'v2.9.4', sensors: 0, role: 'gateway', state: 'offline' }];


function NodeCard({ n, tick, onSelect }) {
  const osc = (seed, amp, mid) => mid + Math.sin((tick + seed) * 0.5) * amp + (Math.random() - 0.5) * amp * 0.3;
  const offline = n.state === 'offline';
  const degraded = n.state === 'degraded';
  const st = offline ? 'crit' : degraded ? 'warn' : 'ok';
  const cpu = offline ? 0 : Math.round(degraded ? osc(n.id.length * 3, 6, 88) : osc(n.id.length * 3, 14, 46));
  const ingest = offline ? 0 : Math.round((n.role === 'gateway' ? osc(7, 600, 6200) : osc(n.id.length, 220, 1600 + n.sensors * 180)));
  const cpuColor = cpu >= 85 ? 'var(--crit)' : cpu >= 70 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className={`node-card node-card--clickable ${st === 'ok' ? '' : st}`} onClick={onSelect} role="button" tabIndex={0} title="Inspect node sensors">
      <div className="nc-top">
        <span className="nc-dot" style={{ background: SEV_COLOR[st] }} />
        <span className="nc-id">{n.id}</span>
        <span className="nc-fw">{n.fw}</span>
      </div>
      <div className="nc-line">{n.role === 'gateway' ? 'PLANT GATEWAY' : n.line}</div>
      {offline ?
      <div className="nc-offline">OFFLINE · last seen 4m ago</div> :
      <React.Fragment>
          <div className="nc-stat-row">
            <div className="nc-stat"><span className="ns-l">INGEST</span><span className="ns-v">{fmt(ingest)}<small>pt/s</small></span></div>
            <div className="nc-stat"><span className="ns-l">SENSORS</span><span className="ns-v">{n.sensors || '—'}</span></div>
          </div>
          <div className="nc-cpu">
            <div className="nc-cpu-row"><span className="ns-l">CPU</span><span className="ns-v" style={{ color: cpuColor }}>{cpu}%</span></div>
            <div className="nc-cpu-bar"><div style={{ width: `${cpu}%`, background: cpuColor }} /></div>
          </div>
        </React.Fragment>
      }
    </div>);

}

// ── Edge node inspector (per-node sensor contents + vitals) ───────────────────
function nodeSensors(node) {
  const n = node.sensors || 0;
  if (!n) return [];
  const pool = FLAT_SEED.filter((a) => a.group === node.line);
  const templates = pool.length ? pool : FLAT_SEED;
  const seed = parseInt((node.id.match(/\d+/) || ['1'])[0], 10) || 1;
  const degraded = node.state === 'degraded';
  const out = [];
  for (let i = 0; i < n; i++) {
    const tpl = templates[(seed + i) % templates.length];
    const span = (tpl.max - tpl.min) || 1;
    let frac = (seed * 7 + i * 29) % 100 / 100 * 0.7;
    if (degraded && i % 4 === 0) frac = 0.9 + i % 3 * 0.03;
    const base = Math.max(tpl.min, Math.min(tpl.max, tpl.min + frac * span));
    const series = Array.from({ length: 16 }, (_, k) =>
      Math.max(tpl.min, Math.min(tpl.max, base + Math.sin((seed + i + k) * 0.7) * (tpl.vol || 0.3) * 1.2)));
    out.push({
      id: node.id + '-s' + i, label: tpl.label, unit: tpl.unit, dec: tpl.dec,
      name: tpl.name.replace(/-\d+$/, '') + '-' + String(seed * 20 + i).padStart(4, '0'),
      val: base, min: tpl.min, max: tpl.max,
      warnHi: tpl.warnHi, critHi: tpl.critHi, warnLo: tpl.warnLo, critLo: tpl.critLo, series
    });
  }
  return out;
}

function EdgeNodeInspector({ node, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sensors = React.useMemo(() => nodeSensors(node), [node.id]);
  const offline = node.state === 'offline';
  const seed = parseInt((node.id.match(/\d+/) || ['1'])[0], 10) || 1;
  const flagged = sensors.filter((s) => statusOf(s) !== 'ok').length;
  const vitals = [
    ['Status', offline ? 'OFFLINE' : node.state === 'degraded' ? 'DEGRADED' : 'ONLINE'],
    ['Zone', node.role === 'gateway' ? 'Plant Gateway' : node.line],
    ['Firmware', node.fw],
    ['IP address', '192.0.2.' + (seed % 200 + 20)],
    ['Protocol', ['Modbus TCP', 'OPC-UA', 'EtherNet/IP', 'MQTT'][seed % 4]],
    ['Sensors', String(node.sensors || 0)],
    ['Uptime', offline ? '—' : (seed % 30 + 1) + 'd ' + seed % 24 + 'h'],
    ['Last seen', offline ? '4m ago' : 'just now']
  ];
  return ReactDOM.createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="doc-modal node-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">{node.id} · {node.role === 'gateway' ? 'PLANT GATEWAY' : node.line}<button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="doc-modal-body">
          <div className="dv-sec" style={{ marginTop: 0 }}>
            <div className="dv-head">⚙ NODE VITALS</div>
            <div className="dv-grid">
              {vitals.map(([k, v]) => <div className="dv-row" key={k}><span className="dv-k">{k}</span><span className="dv-v">{v}</span></div>)}
            </div>
          </div>
          <div className="dv-sec">
            <div className="dv-head">📡 SENSOR CONTENTS <span className="dv-model">{sensors.length} attached{flagged ? ' · ' + flagged + ' flagged' : ''}</span></div>
            {sensors.length ?
            <div className="grp-grid" style={{ '--cols': 3 }}>
              {sensors.map((s) => <SensorTile key={s.id} a={s} selected={false} onSelect={() => {}} />)}
            </div> :
            <div className="ai-empty">Aggregation gateway — no local sensors attached.</div>}
          </div>
        </div>
        <div className="doc-modal-foot">{node.id} · fw {node.fw} · {node.sensors || 0} sensors</div>
      </div>
    </div>,
    document.body);

}

// ── Protocol gateways (the real edge-ingest layer: gateway/*.py) ──────────────
const GATEWAYS = [
  { id: 'opcua', name: 'OPC-UA', state: 'ok', devices: 9, base: 5200 },
  { id: 'modbus', name: 'Modbus TCP', state: 'ok', devices: 7, base: 4100 },
  { id: 'ethernetip', name: 'EtherNet/IP', state: 'degraded', devices: 5, base: 2600 },
  { id: 'replay', name: 'Replay / Sim', state: 'ok', devices: 0, base: 1800 }];

function GatewayCard({ g, tick }) {
  const down = g.state === 'down';
  const degraded = g.state === 'degraded';
  const st = down ? 'crit' : degraded ? 'warn' : 'ok';
  const osc = (seed, amp, mid) => mid + Math.sin((tick + seed) * 0.5) * amp + (Math.random() - 0.5) * amp * 0.2;
  const tput = down ? 0 : Math.round(osc(g.id.length, g.base * 0.06, g.base));
  const err = down ? '100' : degraded ? (1.2 + Math.random() * 0.6).toFixed(1) : (Math.random() * 0.08).toFixed(2);
  const lastPoll = down ? '—' : (Math.random() < 0.6 ? 'just now' : (1 + Math.floor(Math.random() * 3)) + 's ago');
  return (
    <div className={`node-card ${st === 'ok' ? '' : st}`}>
      <div className="nc-top">
        <span className="nc-dot" style={{ background: SEV_COLOR[st] }} />
        <span className="nc-id">{g.name}</span>
        <span className="nc-fw">{down ? 'down' : degraded ? 'degraded' : 'connected'}</span>
      </div>
      <div className="nc-line">{g.devices ? g.devices + ' DEVICES' : 'SIMULATOR'}</div>
      <div className="nc-stat-row">
        <div className="nc-stat"><span className="ns-l">THROUGHPUT</span><span className="ns-v">{fmt(tput)}<small>pt/s</small></span></div>
        <div className="nc-stat"><span className="ns-l">ERRORS</span><span className="ns-v" style={{ color: SEV_COLOR[st] }}>{err}%</span></div>
      </div>
      <div className="nc-cpu-row"><span className="ns-l">LAST POLL</span><span className="ns-v" style={{ fontSize: 12 }}>{lastPoll}</span></div>
    </div>);

}

function SystemView({ stream }) {
  const { last, tick } = stream;
  const [selNode, setSelNode] = React.useState(null);
  const online = NODES.filter((n) => n.state !== 'offline').length;
  const totalIngest = last.ingest;
  const stages = [
    { name: 'Sensors', metric: fmt(GRID_TOTAL), unit: 'points', sub: '4 lines + grid' },
    { name: 'Edge Ingest', metric: fmt(totalIngest), unit: 'pt/s', sub: `${online}/${NODES.length} nodes` },
    { name: 'Stream Bus', metric: fmt(last.queue), unit: 'queued', sub: 'partition lag 0' },
    { name: 'NEPHES MoE', metric: last.latency.toFixed(1), unit: 'ms', sub: 'experts online' },
    { name: 'Time-series store', metric: fmt(Math.round(totalIngest * 0.98)), unit: 'rows/s', sub: 'retention 90d' }];

  return (
    <div className="wall-card">
      <div className="card-head">
        SYSTEM INFRASTRUCTURE
        <span className="count-pill">{online}/{NODES.length} nodes</span>
        <span className="count-pill crit">1 offline</span>
      </div>
      <div className="wall-scroll system-scroll">
        <div className="grp">
          <div className="grp-head"><span className="g-name">Data Pipeline</span><span className="g-sub">SENSORS → STORE</span><span className="g-count">live</span></div>
          <div className="pipeline">
            {stages.map((s, i) =>
            <React.Fragment key={s.name}>
                <div className="pipe-stage">
                  <div className="ps-name">{s.name}</div>
                  <div className="ps-metric">{s.metric}<small>{s.unit}</small></div>
                  <div className="ps-sub">{s.sub}</div>
                </div>
                {i < stages.length - 1 && <div className="pipe-arrow"><span className="pa-flow" /></div>}
              </React.Fragment>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Protocol Gateways</span><span className="g-sub">EDGE INGEST</span><span className="g-count">{GATEWAYS.filter((g) => g.state !== 'down').length}/{GATEWAYS.length} up</span></div>
          <div className="node-grid">
            {GATEWAYS.map((g) => <GatewayCard key={g.id} g={g} tick={tick} />)}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Edge Node Fleet</span><span className="g-sub">{NODES.length} NODES</span><span className="g-count">{online} online</span></div>
          <div className="node-grid">
            {NODES.map((n) => <NodeCard key={n.id} n={n} tick={tick} onSelect={() => setSelNode(n)} />)}
          </div>
        </div>
      </div>
      {selNode && <EdgeNodeInspector node={selNode} onClose={() => setSelNode(null)} />}
    </div>);

}

// ── Enterprise: per-line rollup + financials ─────────────────────────────────
const LINE_RATE = { 'Assembly Line A': 9200, 'Conveyor System': 5400, 'Hydraulic Systems': 6100, 'Utilities': 3300 }; // $/h downtime exposure

function ExecRollup({ assets, setSel, stream }) {
  const critN = assets.filter((a) => statusOf(a) === 'crit').length;
  const warnN = assets.filter((a) => statusOf(a) === 'warn').length;
  const last = stream ? stream.last : { throughput: 1240, oee: 84, energy: 412 };
  const UNIT_PRICE = 42;
  const revAtRisk = critN * 8200 + warnN * 1450;
  const downtimeCost = 4200 + critN * 3100 + warnN * 420;
  const outputRate = Math.round(last.throughput * UNIT_PRICE); // $/h
  const costPerUnit = (3.10 + warnN * 0.05 + critN * 0.14);
  const energyCost = Math.round(last.energy * 0.14); // $/h
  const maintUsed = 68;
  // — money saved by NEPHES (predictive catches → avoided downtime) —
  const now = new Date();
  const shiftStart = new Date(now); shiftStart.setHours(6, 0, 0, 0);
  let shiftSec = (now - shiftStart) / 1000; if (shiftSec < 0) shiftSec += 86400;
  const savedShift = Math.round(18600 + shiftSec * 1.9 + (critN + warnN) * 1400);
  const savedMTD = Math.round(now.getDate() * 61800 + shiftSec * 3.1 + (critN + warnN) * 1400);
  const failuresAverted = 14 + critN;
  const downtimeAvoided = (47.5 + critN * 2.5).toFixed(1);
  const fins = [
    { l: 'Revenue at Risk', v: '$' + fmt(revAtRisk), sub: `this shift · ${critN + warnN} anomalies`, tone: critN ? 'crit' : warnN ? 'warn' : 'ok' },
    { l: 'Downtime Cost', v: '$' + fmt(downtimeCost), sub: 'OEE loss · shift-to-date', tone: critN ? 'crit' : 'warn' },
    { l: 'Output Value', v: '$' + fmt(outputRate) + '/h', sub: `@ $${UNIT_PRICE}/unit`, tone: 'ok' },
    { l: 'Cost / Unit', v: '$' + costPerUnit.toFixed(2), sub: (costPerUnit > 3.10 ? '▲ ' : '') + 'vs $3.10 plan', tone: costPerUnit > 3.4 ? 'warn' : 'ok' },
    { l: 'Energy Cost', v: '$' + fmt(energyCost) + '/h', sub: 'plant draw', tone: 'ok' },
    { l: 'Maint. Budget', v: maintUsed + '%', sub: '$32.0k of $47.0k', tone: maintUsed > 85 ? 'warn' : 'ok' }];

  return (
    <div className="wall-card">
      <div className="card-head">PLANT OVERVIEW <span className="count-pill">{SECTIONS.length} lines</span><span className="count-pill" style={{ marginLeft: 6 }}>FINANCIAL</span></div>
      <div className="wall-scroll" style={{ padding: '10px 13px' }}>
        <div className="saved-hero">
          <div className="sh-left">
            <div className="sh-l">Saved by NEPHES · month-to-date</div>
            <div className="sh-v">${fmt(savedMTD)}</div>
            <div className="sh-trend">▲ accruing · ${fmt(savedShift)} this shift</div>
          </div>
          <div className="sh-stats">
            <div className="sh-stat"><span className="ss-v">{failuresAverted}</span><span className="ss-l">failures averted · 30d</span></div>
            <div className="sh-stat"><span className="ss-v">{downtimeAvoided}h</span><span className="ss-l">downtime avoided</span></div>
            <div className="sh-stat"><span className="ss-v">8.4×</span><span className="ss-l">return on NEPHES</span></div>
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Financial Impact</span><span className="g-sub">SHIFT A · LIVE</span><span className="g-count">USD</span></div>
          <div className="fin-strip">
            {fins.map((f) =>
            <div className={`fin-card ${f.tone}`} key={f.l}>
                <div className="fc-l">{f.l}</div>
                <div className="fc-v">{f.v}</div>
                <div className="fc-s">{f.sub}</div>
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Production Lines</span><span className="g-sub">HEALTH · $ EXPOSURE</span><span className="g-count">{SECTIONS.length}</span></div>
          <div className="exec-grid">
            {SECTIONS.map((s) => {
              const list = assets.filter((a) => a.group === s.name);
              let crit = 0,warn = 0,ok = 0;
              list.forEach((a) => {const st = statusOf(a);if (st === 'crit') crit++;else if (st === 'warn') warn++;else ok++;});
              const h = Math.round(ok / list.length * 100);
              const hc = h >= 85 ? 'var(--ok)' : h >= 65 ? 'var(--accent)' : 'var(--crit)';
              const worst = list.find((a) => statusOf(a) === 'crit') || list.find((a) => statusOf(a) === 'warn');
              const rate = LINE_RATE[s.name] || 4000;
              const atRisk = crit * Math.round(rate * 0.9) + warn * Math.round(rate * 0.16);
              const riskTone = crit ? 'var(--crit)' : warn ? 'var(--warn)' : 'var(--text-3)';
              return (
                <button key={s.name} className="exec-card" onClick={() => worst && setSel(worst.id)}>
                  <div className="ec-top">
                    <div>
                      <div className="ec-name">{s.name}</div>
                      <div className="ec-sub">{s.sub} · {list.length} assets</div>
                    </div>
                    <span className="ec-h" style={{ color: hc }}>{h}%</span>
                  </div>
                  <div className="exec-bar"><div style={{ width: `${h}%`, background: hc }} /></div>
                  <div className="exec-stats">
                    <span><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--crit)' }} />Crit <b style={{ color: 'var(--crit)' }}>{crit}</b></span>
                    <span><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warn)' }} />Warn <b style={{ color: 'var(--warn)' }}>{warn}</b></span>
                    <span style={{ marginLeft: 'auto' }} className="ec-risk">$ at risk <b style={{ color: riskTone }}>${fmt(atRisk)}</b></span>
                  </div>
                </button>);

            })}
          </div>
        </div>
      </div>
    </div>);

}

// ── Side column ──────────────────────────────────────────────────────────────
function DetailCard({ a, onClose, onAct, autoMit, mitigating, onMitigate }) {
  const st = statusOf(a);
  const c = SEV_COLOR[st];
  const mn = Math.min(...a.series),mx = Math.max(...a.series),avg = a.series.reduce((s, v) => s + v, 0) / a.series.length;
  return (
    <div className="side-card" id="detailCard">
      <div className="card-head">SENSOR DETAIL <button className="detail-close" onClick={onClose}>✕</button></div>
      <div className="detail-body">
        <div className="detail-title">{a.name}</div>
        <div className="detail-sub">{a.group} · {a.label} · sampling 950ms</div>
        <div className="detail-spark-lg"><Spark series={a.series} w={300} h={64} color={c} strokeW={1.8} min={a.min} max={a.max} /></div>
        <div className="detail-stats">
          {[['MIN', mn], ['AVG', avg], ['MAX', mx]].map(([l, v]) =>
          <div className="detail-stat" key={l}><div className="d-l">{l}</div><div className="d-v">{v.toFixed(a.dec || 1)}<span style={{ fontSize: 8, color: 'var(--text-3)' }}>{a.unit}</span></div></div>
          )}
        </div>
        {st !== 'ok' &&
        <div className="detail-ai">
            <div className="da-head"><span className="da-dot" style={{ background: c }} />NEPHES AI ANALYSIS</div>
            {(() => {
            const conf = st === 'crit' ? 0.86 + a.id.length % 7 * 0.014 : 0.62 + a.id.length % 7 * 0.025;
            const msg = REC_MSGS[a.id] || `${a.label} ${st === 'crit' ? 'exceeded its critical limit' : 'is drifting toward the warning band'} on ${a.name}. Recommend inspection at the next opportunity.`;
            const cls = st === 'crit' ? 'crit' : 'warn';
            return (
              <React.Fragment>
                  <div className="da-row">
                    <span className={`da-sev ${cls}`}>{st === 'crit' ? 'CRITICAL' : 'WARNING'}</span>
                    <span className="da-conf">{Math.round(conf * 100)}% confidence</span>
                  </div>
                  <div className="conf-bar-wrap"><div className={`conf-bar ${cls}`} style={{ width: `${Math.round(conf * 100)}%` }} /></div>
                  <div className="da-msg">{msg}</div>
                  {autoMit || mitigating ?
                <button className="r-act auto" disabled>◉ {autoMit ? 'Auto-mitigating' : 'Mitigating'}…</button> :
                <button className="r-act" onClick={() => onMitigate && onMitigate(a.id)}>Start mitigation</button>}
                </React.Fragment>);

          })()}
          </div>
        }
        {st === 'ok' &&
        <div className="detail-ai ok">
            <div className="da-head"><span className="da-dot" style={{ background: 'var(--ok)' }} />NEPHES AI ANALYSIS</div>
            <div className="da-msg">{a.label} on {a.name} is within normal parameters. No action required — baseline drift nominal vs 24h window.</div>
          </div>
        }
        {(() => {
          const d = deviceInfo(a);
          return (
            <React.Fragment>
              <div className="dv-sec">
                <div className="dv-head">⌖ LOCATION</div>
                <div className="dv-grid">
                  <div className="dv-row"><span className="dv-k">Zone</span><span className="dv-v">{d.zone}</span></div>
                  <div className="dv-row"><span className="dv-k">Line</span><span className="dv-v">{d.sub}</span></div>
                  <div className="dv-row"><span className="dv-k">Cabinet</span><span className="dv-v">{d.cabinet}</span></div>
                  <div className="dv-row"><span className="dv-k">Grid ref</span><span className="dv-v">{d.grid}</span></div>
                  <div className="dv-row dv-wide"><span className="dv-k">Position</span><span className="dv-v">{d.coord}</span></div>
                </div>
              </div>
              <div className="dv-sec">
                <div className="dv-head">⚙ DEVICE SETTINGS</div>
                <div className="dv-grid">
                  <div className="dv-row"><span className="dv-k">Protocol</span><span className="dv-v">{d.protocol}</span></div>
                  <div className="dv-row"><span className="dv-k">Address</span><span className="dv-v">{d.addr}</span></div>
                  <div className="dv-row"><span className="dv-k">Firmware</span><span className="dv-v">{d.firmware}</span></div>
                  <div className="dv-row"><span className="dv-k">Sample rate</span><span className="dv-v">{d.rate} Hz</span></div>
                  <div className="dv-row"><span className="dv-k">Latency</span><span className="dv-v" style={{ color: d.latency > 20 ? 'var(--warn)' : 'var(--ok)' }}>{d.latency.toFixed(1)} ms</span></div>
                  <div className="dv-row"><span className="dv-k">Range</span><span className="dv-v">{d.range}</span></div>
                  <div className="dv-row"><span className="dv-k">Gain</span><span className="dv-v">{d.gain}</span></div>
                  <div className="dv-row"><span className="dv-k">Warn limit</span><span className="dv-v" style={{ color: 'var(--warn)' }}>{d.warn}</span></div>
                  <div className="dv-row"><span className="dv-k">Crit limit</span><span className="dv-v" style={{ color: 'var(--crit)' }}>{d.crit}</span></div>
                  <div className="dv-row dv-wide"><span className="dv-k">Last calibrated</span><span className="dv-v">{d.cal}</span></div>
                </div>
              </div>
              <div className="dv-sec">
                <div className="dv-head">📑 DOCUMENTATION</div>
                <div className="dv-docs">
                  {d.docs.map((doc) =>
                  <a className="dv-doc" key={doc.t} href="#" onClick={(e) => e.preventDefault()}>
                      <span className="dvd-ic">{doc.ic}</span>
                      <span className="dvd-text"><span className="dvd-t">{doc.t}</span><span className="dvd-m">{doc.meta}</span></span>
                      <span className="dvd-arrow">⤓</span>
                    </a>
                  )}
                </div>
              </div>
              {window.AssetProfileSection && <AssetProfileSection assetId={a.id} />}
              <div className="dv-sec">
                <div className="dv-head">🧰 REPLACEMENT PARTS <span className="dv-model">{d.model}</span></div>
                <div className="dv-parts">
                  {d.parts.map((p) => {
                    const stat = p.qty === 0 ? 'out' : p.qty <= 2 ? 'low' : 'ok';
                    return (
                      <div className={`dv-part ${stat}`} key={p.sku}>
                        <span className="dvp-main"><span className="dvp-name">{p.name}</span><span className="dvp-sku">{p.sku}</span></span>
                        <span className={`dvp-qty ${stat}`}>{p.qty === 0 ? 'Out of stock' : p.qty + ' in stock'}</span>
                      </div>);
                  })}
                </div>
              </div>
            </React.Fragment>);
        })()}
      </div>
    </div>);

}

// derive stable location + device config for a sensor (deterministic from its id/name)
function deviceInfo(a) {
  const num = parseInt((a.name.match(/(\d+)\s*$/) || [])[1] || '1', 10);
  const lineMap = { 'Assembly Line A': 'A', 'Conveyor System': 'B', 'Hydraulic Systems': 'C', 'Utilities': 'D' };
  const ln = lineMap[a.group] || 'A';
  const bay = String(num % 12 + 1).padStart(2, '0');
  const rack = String.fromCharCode(65 + num % 6);
  const pos = String(num % 24 + 1).padStart(2, '0');
  const protocols = ['Modbus TCP', 'OPC-UA', 'EtherNet/IP', 'MQTT'];
  const fws = ['v3.4.1', 'v3.4.0', 'v3.3.9'];
  const rates = [10, 20, 50, 100];
  const cal = new Date(2026, num % 6, num % 27 + 1);
  const flagged = statusOf(a) !== 'ok';
  const latency = (7 + num % 13 + (flagged ? 16 : 0) + Math.random() * 4);
  const model = `NPS-${1000 + num % 8999}`;
  const calStr = cal.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const partDefs = [
    { name: a.label + ' element', sku: `SE-${ln}${100 + num % 800}` },
    { name: 'Sensor module', sku: model },
    { name: 'Mounting bracket', sku: `MB-${200 + num % 60}` },
    { name: 'M12 cable harness', sku: `CH-${num % 40 + 10}` },
    { name: 'Seal / gasket kit', sku: `SK-${num % 90 + 10}` }];
  const parts = partDefs.map((p, i) => { const qty = (num * (i + 3) + i * 7) % 9; return { ...p, qty }; });
  return {
    zone: a.group,
    sub: a.sub || ('LINE ' + ln),
    cabinet: `CAB-${ln}${bay}`,
    coord: `Bay ${bay} · Rack ${rack} · Pos ${pos}`,
    grid: `${ln}${bay}-${rack}${pos}`,
    model: model,
    protocol: protocols[num % protocols.length],
    addr: `192.0.2.${num % 200 + 20}`,
    firmware: fws[num % 3],
    rate: rates[num % 4],
    cal: calStr,
    range: `${a.min}–${a.max} ${a.unit}`,
    warn: (a.warnHi != null ? a.warnHi : a.warnLo != null ? a.warnLo : '—') + (a.unit || ''),
    crit: (a.critHi != null ? a.critHi : a.critLo != null ? a.critLo : '—') + (a.unit || ''),
    gain: (0.8 + num % 5 * 0.1).toFixed(2) + '×',
    latency: latency,
    docs: [
      { ic: '📄', t: 'Datasheet', meta: `${model}.pdf · 2.4 MB` },
      { ic: '🔌', t: 'Wiring Diagram', meta: 'rev C · PDF' },
      { ic: '📐', t: 'Calibration Certificate', meta: calStr },
      { ic: '🗒', t: 'Maintenance Log', meta: `${num % 9 + 1} entries` }],
    parts: parts
  };
}

// ── Fault Simulator — operator injects faults into the floor ──────────────────
const FAULT_TYPES = ['Overload', 'Overheat', 'Vibration spike', 'Pressure loss', 'Bearing wear'];
function FaultSim({ groups, zoneHealth, faults, faultTypes, injectFault, clearFault, clearAllFaults }) {
  const [target, setTarget] = React.useState(groups[0]);
  const [sev, setSev] = React.useState('crit');
  const active = Object.entries(faults);
  const zh = zoneHealth || {};
  return (
    <div className="side-card fault-sim" id="opCard">
      <div className="card-head">FAULT SIMULATOR <span className={`fs-pill ${active.length ? 'on' : ''}`} style={{ marginLeft: 'auto' }}>{active.length ? active.length + ' active' : 'armed'}</span></div>
      <div className="fs-body">
        <div className="fs-field">
          <span className="fs-label">Target zone</span>
          <select className="fs-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {groups.map((g) => <option key={g} value={g}>{g} — {zh[g] != null ? zh[g] : '—'}% healthy</option>)}
          </select>
        </div>
        <div className="fs-field">
          <span className="fs-label">Fault type</span>
          <div className="fs-random">⚄ Randomized by NEPHES on inject</div>
        </div>
        <div className="fs-field">
          <span className="fs-label">Severity</span>
          <div className="fs-sev">
            <button className={`fs-sev-btn warn ${sev === 'warn' ? 'on' : ''}`} onClick={() => setSev('warn')}>Warning</button>
            <button className={`fs-sev-btn crit ${sev === 'crit' ? 'on' : ''}`} onClick={() => setSev('crit')}>Critical</button>
          </div>
        </div>
        <button className="fs-inject" onClick={() => injectFault(target, sev)}>⚠ Inject Fault</button>
        <div className="fs-active">
          {active.length === 0 ?
          <div className="fs-empty">No active faults. Inject one to simulate an alarm — watch the wall light up and NEPHES respond.</div> :
          active.map(([g, s]) =>
          <div className={`fs-item ${s}`} key={g}>
                <span className="fs-dot" style={{ background: s === 'crit' ? 'var(--crit)' : 'var(--warn)' }} />
                <span className="fs-item-name">{g}<span className="fs-item-type"> · {(faultTypes || {})[g] || 'Fault'}</span></span>
                <span className={`fs-item-sev ${s}`}>{s === 'crit' ? 'CRIT' : 'WARN'}</span>
                <button className="fs-clear" onClick={() => clearFault(g)} title="Clear fault">✕</button>
              </div>
          )}
        </div>
        {active.length > 0 && <button className="fs-clear-all" onClick={clearAllFaults}>Clear all faults</button>}
      </div>
    </div>);

}

const EXEC_WINDOWS = {
  '📊 Impact': { title: 'Impact Report', rows: [['Throughput at risk', '3.2% · $1,240/shift'], ['Top contributor', 'Assembly Line A'], ['Open episodes', '4'], ['Saved month-to-date', '$1.94M']], cta: 'Open full report' },
  '📈 Forecast': { title: '7-Day Forecast', rows: [['Projected OEE', '85.6% ▲1.4pp'], ['Predicted failures', '3 events'], ['Next maint. window', 'Thu 02:00'], ['Model confidence', '88%']], cta: 'View forecast model' },
  '🔔 Notify Lead': { title: 'Escalate to Lead', rows: [['Recipients', 'Plant Lead · Ops Mgr'], ['Severity', 'High'], ['Channel', 'SMS + Email'], ['Last sent', '14:02']], cta: 'Send notification' },
  '📤 Export': { title: 'Export Snapshot', rows: [['Range', 'Shift A · 06:00–now'], ['Format', 'PDF'], ['Scope', 'All lines · 2,000 sensors']], cta: 'Generate export' }
};

const DIAG_WINDOWS = {
  '🖥 Inspect': { title: 'Edge Node Inspector', rows: [['Worst node', 'edge-10 · degraded'], ['CPU', '88%'], ['Ingest', '1.6k pt/s'], ['Firmware', 'v3.3.9']], cta: 'Open node detail' },
  '↻ Resync': { title: 'Resync Edge Fleet', rows: [['Nodes', '12'], ['Config drift', '2 nodes'], ['Method', 'NTP + config push'], ['Last sync', '14:02']], cta: 'Resync now' },
  '⚙ Params': { title: 'Pipeline Parameters', rows: [['Window', '30 samples'], ['Sample rate', '950 ms'], ['Batch size', '256'], ['Retention', '90 days']], cta: 'Edit parameters' },
  '✓ Ack Alert': { title: 'Acknowledge Alerts', rows: [['Open', '1 critical'], ['Source', 'gw-plant offline'], ['Since', '4m ago'], ['Owner', 'Sys Ops']], cta: 'Acknowledge all' }
};

const EXPORT_FORMATS = ['PDF', 'CSV', 'XLSX', 'JSON', 'PNG'];

function OperatorControls({ profile, assets }) {
  // Each opened action window stays on screen (stacked) — toggled in/out of this list.
  const [openActions, setOpenActions] = React.useState([]);
  const [exportFmt, setExportFmt] = React.useState('PDF');
  const [opCollapsed, setOpCollapsed] = React.useState(false);
  const cfg = {
    manufacturing: { title: 'OPERATOR CONTROLS', rows: [
      { label: 'Acknowledge', btns: ['✓ Ack All', '⏸ Pause Line'] },
      { label: 'Dispatch', btns: ['⚲ Maintenance', '↻ Handover'] }],
      status: 'Shift A · 06:00–14:00 · 1 work order open' },
    enterprise: { title: 'EXECUTIVE ACTIONS', rows: [
      { label: 'Reports', btns: ['📊 Impact', '📈 Forecast'] },
      { label: 'Escalate', btns: ['🔔 Notify Lead', '📤 Export'] }],
      status: 'Output 8,420 u · ▲6.2% vs plan · cost $3.38/u' },
    backend: { title: 'DIAGNOSTICS', rows: [
      { label: 'Edge nodes', btns: ['🖥 Inspect', '↻ Resync'] },
      { label: 'Pipeline', btns: ['⚙ Params', '✓ Ack Alert'] }],
      status: '11/12 nodes online · ingest 18.4k pt/s · loss 0.0%' }
  }[profile];
  const WINDOWS = profile === 'enterprise' ? EXEC_WINDOWS : profile === 'backend' ? DIAG_WINDOWS : null;
  React.useEffect(() => { setOpenActions([]); }, [profile]);
  const toggle = (b) => setOpenActions((prev) => prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]);
  const close = (b) => setOpenActions((prev) => prev.filter((x) => x !== b));
  return (
    <div className={`side-card ${opCollapsed ? 'collapsed' : ''}`} id="opCard">
      <div className="card-head">{cfg.title}<button className="collapse-btn" onClick={() => setOpCollapsed((c) => !c)}>▾</button></div>
      <div className="op-body">
        {cfg.rows.map((r, i) =>
        <React.Fragment key={i}>
            <div className="op-label">{r.label}</div>
            <div className="op-row">{r.btns.map((b) => {
              const opens = WINDOWS && WINDOWS[b];
              const isOpen = openActions.includes(b);
              return <button key={b} className={`op-btn ${b.includes('Pause') || b.includes('Maintenance') ? 'inject' : ''} ${isOpen ? 'active' : ''}`} onClick={opens ? () => toggle(b) : undefined}>{b}</button>;
            })}</div>
          </React.Fragment>
        )}
        <div className="op-status">{cfg.status}</div>
      </div>
      {WINDOWS && openActions.length > 0 &&
      <div className="op-windows">
        {openActions.map((b) => {
          const win = WINDOWS[b];
          if (!win) return null;
          const isExport = b === '📤 Export';
          return (
            <div className="op-window" key={b}>
              <div className="op-window-head">{win.title}<button className="op-window-close" onClick={() => close(b)}>✕</button></div>
              <div className="op-window-body">
                {win.rows.map(([k, v]) =>
                isExport && k === 'Format' ?
                <div className="ow-row" key={k}>
                    <span className="ow-k">{k}</span>
                    <select className="ow-select" value={exportFmt} onChange={(e) => setExportFmt(e.target.value)}>
                      {EXPORT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div> :
                <div className="ow-row" key={k}><span className="ow-k">{k}</span><span className="ow-v">{v}</span></div>
                )}
                <button className="ow-cta">{isExport ? `Generate ${exportFmt} export` : win.cta}</button>
              </div>
            </div>);
        })}
      </div>
      }
    </div>);

}

function AiAnalysis({ profile, alerts, onAct, autoMit, mitigating, onMitigate }) {
  const [aiCollapsed, setAiCollapsed] = React.useState(false);
  const assess = {
    manufacturing: 'NEPHES is tracking ' + alerts.length + ' open recommendation(s) across the floor. Prioritised by failure-risk confidence.',
    enterprise: 'Projected impact of current anomalies: ~3.2% throughput at risk this shift ($1,240). ' + alerts.length + ' item(s) need owner sign-off.',
    backend: 'Telemetry variance elevated on ' + alerts.length + ' channel(s). No packet loss; drift measured vs 24h baseline.'
  }[profile];
  return (
    <div className={`side-card ${aiCollapsed ? 'collapsed' : ''}`} id="aiCard">
      <div className="card-head">NEPHES AI ANALYSIS<button className="collapse-btn" onClick={() => setAiCollapsed((c) => !c)}>▾</button></div>
      <div className="ai-body">
        <div className="ai-assess"><div className="a-head">Assessment</div><div className="a-sum">{assess}</div></div>
        {alerts.length === 0 && <div className="ai-empty">No active recommendations — all assets nominal.</div>}
        {alerts.map((a) => {
          const st = statusOf(a);
          const conf = st === 'crit' ? 0.86 + Math.random() * 0.1 : 0.62 + Math.random() * 0.18;
          const msg = REC_MSGS[a.id] || `${a.label} ${st === 'crit' ? 'exceeded critical limit' : 'drifting toward warning band'} on ${a.name}. Recommend inspection.`;
          return <RecCard key={a.id} asset={a.name} sev={st === 'crit' ? 'critical' : 'warning'} conf={conf} msg={msg} action={profile === 'enterprise' ? 'View impact' : 'Start mitigation'} onAct={() => onAct(a.id)} onMitigate={profile === 'enterprise' ? () => onAct(a.id) : () => onMitigate && onMitigate(a.id)} auto={autoMit && profile !== 'enterprise'} mitigating={!!(mitigating && mitigating[a.id]) && profile !== 'enterprise'} />;
        })}
      </div>
    </div>);

}

// ── Top Risks — sensors ranked by proximity to a limit ────────────────────────
function riskOf(a) {
  const v = a.val;
  let frac = 0, limit = a.max, dir = 'hi';
  if (a.critHi != null || a.warnHi != null) {
    limit = a.critHi != null ? a.critHi : a.warnHi;
    frac = v / limit;
  }
  if (a.critLo != null || a.warnLo != null) {
    const lo = a.critLo != null ? a.critLo : a.warnLo;
    const loFrac = lo / Math.max(v, 0.0001);
    if (loFrac > frac) { frac = loFrac; limit = lo; dir = 'lo'; }
  }
  return { frac, limit, dir };
}

function TopRisks({ pool, setSel }) {
  const ranked = React.useMemo(() => {
    return pool
      .map((a) => ({ a, r: riskOf(a), st: statusOf(a) }))
      .sort((x, y) => y.r.frac - x.r.frac)
      .slice(0, 20);
  }, [pool]);
  const critN = pool.filter((a) => statusOf(a) === 'crit').length;
  return (
    <div className="side-card top-risks" id="risksCard">
      <div className="card-head">TOP RISKS <span className="count-pill crit" style={{ marginLeft: 'auto' }}>{critN} critical</span></div>
      <div className="tr-sub">Ranked by proximity to limit · click to inspect</div>
      <div className="tr-list">
        {ranked.map(({ a, r, st }, i) => {
          const c = SEV_COLOR[st];
          const pct = Math.max(4, Math.min(100, r.frac * 100));
          return (
            <button className={`tr-item ${st}`} key={a.id} onClick={() => setSel(a.id)}>
              <span className="tr-rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="tr-dot" style={{ background: c }} />
              <span className="tr-main">
                <span className="tr-name">{a.name}</span>
                <span className="tr-meta">{a.group} · {a.label}</span>
                <span className="tr-track"><span className="tr-fill" style={{ width: pct + '%', background: c }} /></span>
              </span>
              <span className="tr-vals">
                <span className="tr-val" style={{ color: st !== 'ok' ? c : 'var(--text-1)' }}>{a.val.toFixed(a.dec != null ? a.dec : 1)}<small>{a.unit}</small></span>
                <span className="tr-lim">/ {Number(r.limit).toFixed(a.dec || 0)}{a.unit}</span>
              </span>
            </button>);
        })}
      </div>
    </div>);

}

// ── Risk Trend — crit/warn over the shift + projected time-to-failure ─────────
function projectTTF(a) {
  const s = a.series;
  if (!s || s.length < 6) return null;
  const limit = a.critHi != null ? a.critHi : a.warnHi != null ? a.warnHi : null;
  if (limit == null) return null;
  if (a.val >= limit) return { breached: true };
  const recent = s.slice(-6);
  const slope = (recent[recent.length - 1] - recent[0]) / 5; // per sample
  if (slope <= 0.0001) return { steady: true };
  const samples = (limit - a.val) / slope;
  const mins = samples * 3; // each sample ≈ 3 min of plant time
  return { mins };
}

function RiskTrend({ pool, hist, selected }) {
  // selected-sensor mode: track that device's own reading
  if (selected) {
    const st = statusOf(selected);
    const c = SEV_COLOR[st];
    const series = selected.series || [];
    const ttf = projectTTF(selected);
    const ttfTxt = !ttf ? '—' : ttf.breached ? 'BREACHED' : ttf.steady ? 'STABLE' :
      ttf.mins < 15 ? '<15 min' : ttf.mins < 90 ? Math.round(ttf.mins) + ' min' : (ttf.mins / 60).toFixed(1) + ' h';
    const ttfColor = !ttf ? 'var(--text-3)' : ttf.breached || ttf.mins < 15 ? 'var(--crit)' : ttf.steady ? 'var(--ok)' : ttf.mins < 90 ? 'var(--warn)' : 'var(--accent)';
    return (
      <div className="side-card risk-trend" id="trendCard">
        <div className="card-head">RISK TREND <span className="rt-shift" style={{ marginLeft: 'auto' }}>SELECTED</span></div>
        <div className="rtr-body">
          <div className="rtr-legend">
            <span className="rtr-sel-name">{selected.name}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 700, color: c }}>{selected.val.toFixed(selected.dec != null ? selected.dec : 1)}<small style={{ color: 'var(--text-3)', fontWeight: 400 }}>{selected.unit}</small></span>
          </div>
          <div className="rtr-chart">
            <Spark series={series} w={258} h={46} color={c} strokeW={1.7} min={selected.min} max={selected.max} dot={false} />
          </div>
          <div className="rtr-ttf">
            <div className="rtr-ttf-l">NEPHES · projected time-to-failure</div>
            <div className="rtr-ttf-row">
              <span className="rtr-ttf-asset">{selected.label}</span>
              <span className="rtr-ttf-v" style={{ color: ttfColor }}>{ttfTxt}</span>
            </div>
          </div>
        </div>
      </div>);
  }
  const ranked = pool.map((a) => ({ a, f: riskOf(a).frac })).sort((x, y) => y.f - x.f);
  const top = ranked[0] ? ranked[0].a : null;
  const critSeries = hist.map((h) => h.c);
  const warnSeries = hist.map((h) => h.w);
  const peak = Math.max(1, ...hist.map((h) => h.c + h.w));
  const nowC = critSeries[critSeries.length - 1] || 0;
  const nowW = warnSeries[warnSeries.length - 1] || 0;
  const ttf = top ? projectTTF(top) : null;
  const ttfTxt = !ttf ? '—' : ttf.breached ? 'BREACHED' : ttf.steady ? 'STABLE' :
    ttf.mins < 15 ? '<15 min' : ttf.mins < 90 ? Math.round(ttf.mins) + ' min' : (ttf.mins / 60).toFixed(1) + ' h';
  const ttfColor = !ttf ? 'var(--text-3)' : ttf.breached || ttf.mins < 15 ? 'var(--crit)' : ttf.steady ? 'var(--ok)' : ttf.mins < 90 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className="side-card risk-trend" id="trendCard">
      <div className="card-head">RISK TREND <span className="rt-shift" style={{ marginLeft: 'auto' }}>SHIFT A</span></div>
      <div className="rtr-body">
        <div className="rtr-legend">
          <span><i style={{ background: 'var(--crit)' }} />Critical <b style={{ color: 'var(--crit)' }}>{nowC}</b></span>
          <span><i style={{ background: 'var(--warn)' }} />Warning <b style={{ color: 'var(--warn)' }}>{nowW}</b></span>
        </div>
        <div className="rtr-chart">
          <Spark series={warnSeries} w={258} h={46} color="var(--warn)" strokeW={1.5} min={0} max={peak} dot={false} />
          <Spark series={critSeries} w={258} h={46} color="var(--crit)" strokeW={1.7} min={0} max={peak} dot={false} />
        </div>
        <div className="rtr-ttf">
          <div className="rtr-ttf-l">NEPHES · projected time-to-failure</div>
          <div className="rtr-ttf-row">
            <span className="rtr-ttf-asset">{top ? top.name : '—'}</span>
            <span className="rtr-ttf-v" style={{ color: ttfColor }}>{ttfTxt}</span>
          </div>
        </div>
      </div>
    </div>);

}

// ── Action Log — recently dispatched mitigations + status ─────────────────────
const ACTION_SEED = [
  { asset: 'SERVO-AXIS-0042', act: 'Feed rate reduced 8%', age0: 2, status: 'progress', pct: 60 },
  { asset: 'ROLLER-BANK-0117', act: 'Bearing inspection dispatched', age0: 7, status: 'progress', pct: 30 },
  { asset: 'HYD-PUMP-0008', act: 'Pressure relief recalibrated', age0: 14, status: 'resolved', pct: 100 },
  { asset: 'FILTER-DP-0231', act: 'Element replacement scheduled', age0: 23, status: 'queued', pct: 0 },
  { asset: 'SPINDLE-DRV-0003', act: 'Lubrication cycle triggered', age0: 38, status: 'resolved', pct: 100 },
  { asset: 'COOLANT-0451', act: 'Chiller loop flow verified', age0: 52, status: 'resolved', pct: 100 }];

function ActionLog({ tick }) {
  const STAT = {
    queued: { label: 'Queued', cls: 'queued' },
    progress: { label: 'In progress', cls: 'progress' },
    resolved: { label: 'Resolved', cls: 'resolved' } };
  const fmtAge = (m) => m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ' + m % 60 + 'm ago';
  return (
    <div className="side-card action-log" id="actionCard">
      <div className="card-head">ACTION LOG <span className="count-pill" style={{ marginLeft: 'auto' }}>{ACTION_SEED.filter((a) => a.status !== 'resolved').length} active</span></div>
      <div className="al-list">
        {ACTION_SEED.map((a, i) => {
          const s = STAT[a.status];
          const age = a.age0 + Math.floor(tick / 20);
          return (
            <div className={`al-item ${s.cls}`} key={i}>
              <div className="al-top">
                <span className="al-asset">{a.asset}</span>
                <span className={`al-badge ${s.cls}`}>{s.label}</span>
              </div>
              <div className="al-act">{a.act}</div>
              <div className="al-foot">
                {a.status === 'progress' ?
                <span className="al-bar"><span style={{ width: a.pct + '%' }} /></span> :
                <span className="al-bar-sp" />}
                <span className="al-age">{fmtAge(age)}</span>
              </div>
            </div>);
        })}
      </div>
    </div>);

}

function EventsBar({ events }) {
  const [filter, setFilter] = React.useState('all');
  const shown = events.filter((e) => filter === 'all' || (filter === 'crit' ? e.sev >= 3 : e.sev === 2));
  const critCount = events.filter((e) => e.sev >= 3).length;
  return (
    <div className="events-bar side-card">
      <div className="card-head">
        LIVE EVENTS {critCount > 0 && <span className="ev-unread">{critCount} crit</span>}
        <div className="ev-filters-inline">
          <button className={`ev-filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          <button className={`ev-filter-btn f-warn ${filter === 'warn' ? 'active' : ''}`} onClick={() => setFilter('warn')}>Warn</button>
          <button className={`ev-filter-btn f-crit ${filter === 'crit' ? 'active' : ''}`} onClick={() => setFilter('crit')}>Crit</button>
        </div>
      </div>
      <div className="ev-row">
        {shown.length === 0 && <div className="ai-empty" style={{ width: '100%' }}>No events.</div>}
        {shown.map((e) => {
          const sevCls = e.sev >= 3 ? 'sev-crit' : e.sev === 2 ? 'sev-warn' : '';
          return (
            <div key={e.key} className={`ev-chip ${sevCls}`}>
              <div className="c-top"><span className="c-ts">{e.ts}</span><span className="c-asset">{e.asset}</span></div>
              <div className="c-msg">{e.msg}</div>
            </div>);
        })}
      </div>
    </div>);

}

// ── Add Sensor modal — auto-detect (network scan) or manual entry ─────────────
const DETECT_POOL = [
  { pfx: 'ROBOT-ARM', label: 'Vibration', unit: 'mm/s', min: 3.5, max: 8.5, warn: 5.5, crit: 7.2 },
  { pfx: 'SPINDLE-DRV', label: 'Temp', unit: '°C', min: 50, max: 92, warn: 78, crit: 88 },
  { pfx: 'HYD-PUMP', label: 'Pressure', unit: 'PSI', min: 160, max: 300, warn: 245, crit: 280 },
  { pfx: 'BELT-DRV', label: 'Speed', unit: 'm/s', min: 4.5, max: 7, warn: 6.6, crit: '' },
  { pfx: 'SERVO-AXIS', label: 'Load', unit: '%', min: 30, max: 99, warn: 90, crit: 97 },
  { pfx: 'COOLANT', label: 'Temp', unit: '°C', min: 18, max: 48, warn: 36, crit: 43 }];

function AddSensorModal({ groups, onAdd, onClose }) {
  const [mode, setMode] = React.useState('detect');
  const [f, setF] = React.useState({ name: '', group: groups[0], label: 'Vibration', unit: 'mm/s', min: '0', max: '10', warn: '7', crit: '9' });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.name.trim() && f.min !== '' && f.max !== '' && +f.max > +f.min;
  const submit = () => { if (valid) { onAdd(f); onClose(); } };

  // auto-detect state
  const [scan, setScan] = React.useState('idle'); // idle | scanning | done
  const [found, setFound] = React.useState([]);
  const [picked, setPicked] = React.useState({});
  const runScan = () => {
    setScan('scanning'); setFound([]); setPicked({});
    setTimeout(() => {
      const n = 4 + Math.floor(Math.random() * 3);
      const list = Array.from({ length: n }, (_, i) => {
        const t = DETECT_POOL[Math.floor(Math.random() * DETECT_POOL.length)];
        const g = groups[Math.floor(Math.random() * groups.length)];
        const num = 100 + Math.floor(Math.random() * 8900);
        return { id: i, name: `${t.pfx}-${num}`, group: g, label: t.label, unit: t.unit, min: t.min, max: t.max, warn: t.warn, crit: t.crit, addr: `192.0.2.${20 + num % 200}`, mac: `02:00:5E:${(num % 256).toString(16).padStart(2, '0').toUpperCase()}:${(num % 100).toString(16).padStart(2, '0').toUpperCase()}:F2` };
      });
      setFound(list);
      const all = {}; list.forEach((d) => all[d.id] = true); setPicked(all);
      setScan('done');
    }, 1800);
  };
  const toggle = (id) => setPicked((p) => ({ ...p, [id]: !p[id] }));
  const pickedCount = found.filter((d) => picked[d.id]).length;
  const register = () => { found.filter((d) => picked[d.id]).forEach((d) => onAdd(d)); onClose(); };

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">PROVISION SENSOR <button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-modes">
          <button className={`modal-mode ${mode === 'detect' ? 'on' : ''}`} onClick={() => setMode('detect')}>⟳ Auto-detect</button>
          <button className={`modal-mode ${mode === 'manual' ? 'on' : ''}`} onClick={() => setMode('manual')}>✎ Manual entry</button>
        </div>

        {mode === 'detect' &&
        <React.Fragment>
            <div className="scan-area">
              {scan === 'idle' &&
              <div className="scan-idle">
                  <div className="scan-prompt">Scan the plant network for unprovisioned sensors broadcasting on the field bus.</div>
                  <button className="scan-btn" onClick={runScan}>⟳ Scan network</button>
                  <div className="scan-range">Subnet 192.0.2.0/24 · Modbus / OPC-UA / MQTT</div>
                </div>}
              {scan === 'scanning' &&
              <div className="scan-running">
                  <div className="scan-radar"><span /><span /><span /></div>
                  <div className="scan-msg">Scanning 192.0.2.0/24…</div>
                  <div className="scan-sub">Probing endpoints · listening for device beacons</div>
                </div>}
              {scan === 'done' &&
              <div className="scan-results">
                  <div className="scan-found-head"><span>{found.length} devices discovered</span><button className="scan-rescan" onClick={runScan}>⟳ Rescan</button></div>
                  <div className="scan-list">
                    {found.map((d) =>
                  <label className={`scan-item ${picked[d.id] ? 'on' : ''}`} key={d.id}>
                        <input type="checkbox" checked={!!picked[d.id]} onChange={() => toggle(d.id)} />
                        <span className="si-check" aria-hidden="true">✓</span>
                        <span className="si-main"><span className="si-name">{d.name}</span><span className="si-meta">{d.group} · {d.label} · {d.addr}</span></span>
                        <span className="si-mac">{d.mac}</span>
                      </label>
                  )}
                  </div>
                </div>}
            </div>
            <div className="modal-foot">
              <button className="mf-cancel" onClick={onClose}>Cancel</button>
              <button className="mf-submit" disabled={scan !== 'done' || pickedCount === 0} onClick={register}>Register {pickedCount || ''} {pickedCount === 1 ? 'sensor' : 'sensors'}</button>
            </div>
          </React.Fragment>
        }

        {mode === 'manual' &&
        <React.Fragment>
            <div className="modal-body">
              <label className="mf-field mf-wide"><span className="mf-l">Sensor name / tag</span><input className="mf-in" value={f.name} onChange={set('name')} placeholder="e.g. ROBOT-ARM-9" /></label>
              <label className="mf-field"><span className="mf-l">Zone</span><select className="mf-in" value={f.group} onChange={set('group')}>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
              <label className="mf-field"><span className="mf-l">Metric</span><input className="mf-in" value={f.label} onChange={set('label')} placeholder="Vibration" /></label>
              <label className="mf-field"><span className="mf-l">Unit</span><input className="mf-in" value={f.unit} onChange={set('unit')} placeholder="mm/s" /></label>
              <label className="mf-field"><span className="mf-l">Sample range</span><div className="mf-pair"><input className="mf-in" type="number" value={f.min} onChange={set('min')} placeholder="min" /><span className="mf-dash">–</span><input className="mf-in" type="number" value={f.max} onChange={set('max')} placeholder="max" /></div></label>
              <label className="mf-field"><span className="mf-l">Warn limit</span><input className="mf-in" type="number" value={f.warn} onChange={set('warn')} placeholder="optional" /></label>
              <label className="mf-field"><span className="mf-l">Critical limit</span><input className="mf-in" type="number" value={f.crit} onChange={set('crit')} placeholder="optional" /></label>
            </div>
            <div className="modal-foot">
              <button className="mf-cancel" onClick={onClose}>Cancel</button>
              <button className="mf-submit" disabled={!valid} onClick={submit}>Register sensor</button>
            </div>
          </React.Fragment>
        }
      </div>
    </div>);

}

// ── Main ──────────────────────────────────────────────────────────────────────
// ── Live hardware stream (real Arduino / Raspberry Pi sensors via /ingest) ─────
function useLiveHardware({ live = true } = {}) {
  const [hw, setHw] = React.useState({ live: false, sensors: [] });
  React.useEffect(() => {
    if (!live) return;
    let off = false;
    const poll = () => {
      fetch('/factory-observer/live').then((r) => r.ok ? r.json() : null).then((d) => {
        if (off || !d) return;
        const sensors = (d.sensors || []).filter((s) => !s.stale).map((s) => {
          const series = Array.isArray(s.series) && s.series.length ? s.series : [s.value];
          let mn = s.min, mx = s.max;
          if (mn == null) mn = Math.min.apply(null, series.concat(s.value));
          if (mx == null) mx = Math.max.apply(null, series.concat(s.value));
          if (mx <= mn) mx = mn + 1;
          return { ...s, val: s.value, min: mn, max: mx, group: 'Live Hardware', sub: 'REAL', dec: s.dec != null ? s.dec : 1, series };
        });
        setHw({ live: !!d.live && sensors.length > 0, sensors });
      }).catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 1500);
    return () => { off = true; clearInterval(iv); };
  }, [live]);
  return hw;
}

function Industrial({ stream, density, defaultView = 'grid', startProfile = 'manufacturing', showEvents = true, gridTexture = true, glow = true, volatility = 1 }) {
  const [profile, setProfile] = React.useState(startProfile);
  const [sel, setSel] = React.useState(null);
  const [view, setView] = React.useState(defaultView);
  const [rightTab, setRightTab] = React.useState('ai');   // combined AI / Top Risks / Action Log panel
  const [riskHist, setRiskHist] = React.useState(() => Array.from({ length: 44 }, () => ({ c: 0, w: 0 })));
  const [blueLight, setBlueLight] = React.useState(true);
  const [autoMit, setAutoMit] = React.useState(false);
  const [faults, setFaults] = React.useState({}); // { groupName: 'warn'|'crit' }
  const [faultTypes, setFaultTypes] = React.useState({}); // { groupName: 'Overheat' ... }
  const [mitigating, setMitigating] = React.useState({}); // { sensorId: true }
  const [customSensors, setCustomSensors] = React.useState([]);
  const [showAdd, setShowAdd] = React.useState(false);
  // profile switch transition (NEPHES boot splash covers the swap)
  const [switching, setSwitching] = React.useState(false);
  const [splashLabel, setSplashLabel] = React.useState('');
  const [splashLeaving, setSplashLeaving] = React.useState(false);
  const profileRef = React.useRef(startProfile);
  const splashTimers = React.useRef([]);
  React.useEffect(() => { profileRef.current = profile; }, [profile]);
  React.useEffect(() => () => splashTimers.current.forEach(clearTimeout), []);
  const switchProfile = React.useCallback((next) => {
    if (!next || next === profileRef.current) return;
    profileRef.current = next;
    setProfile(next);
    setSplashLabel((PROFILES.find((p) => p.id === next) || {}).name || '');
    setSplashLeaving(false);
    setSwitching(true);
    splashTimers.current.forEach(clearTimeout);
    splashTimers.current = [
      setTimeout(() => setSplashLeaving(true), 1650),
      setTimeout(() => { setSwitching(false); setSplashLeaving(false); }, 2200)];
  }, []);
  const faultsRef = React.useRef(faults);
  const mitRef = React.useRef(mitigating);
  React.useEffect(() => { faultsRef.current = faults; }, [faults]);
  React.useEffect(() => { mitRef.current = mitigating; }, [mitigating]);
  const [clock, setClock] = React.useState(clk());
  const assets = useAssets(FLAT_SEED, { live: stream.live, speed: stream.speed || 1, volatility, autoMit, faultsRef, mitRef });
  const gridPoints = useGridPoints({ live: stream.live, speed: stream.speed || 1, volatility, autoMit, faultsRef, mitRef });
  const liveHw = useLiveHardware({ live: stream.live });

  const startMitigation = React.useCallback((id) => setMitigating((m) => ({ ...m, [id]: true })), []);
  const injectFault = React.useCallback((group, sev) => {
    const type = FAULT_TYPES[Math.floor(Math.random() * FAULT_TYPES.length)];
    setFaults((f) => ({ ...f, [group]: sev }));
    setFaultTypes((t) => ({ ...t, [group]: type }));
  }, []);
  const clearFault = React.useCallback((group) => {
    setFaults((f) => { const o = { ...f }; delete o[group]; return o; });
    setFaultTypes((t) => { const o = { ...t }; delete o[group]; return o; });
  }, []);
  const clearAllFaults = React.useCallback(() => { setFaults({}); setFaultTypes({}); }, []);
  const addSensor = React.useCallback((def) => {
    const min = +def.min, max = +def.max;
    const warn = def.warn === '' ? null : +def.warn;
    const crit = def.crit === '' ? null : +def.crit;
    const base = warn != null ? min + (warn - min) * 0.6 : min + (max - min) * 0.5;
    const vol = Math.max(0.01, (max - min) * 0.03);
    const sec = SECTIONS.find((s) => s.name === def.group);
    const sensor = { id: 'c' + Date.now() + Math.floor(Math.random() * 999), name: (def.name || 'CUSTOM').toUpperCase().replace(/\s+/g, '-'), group: def.group, sub: sec ? sec.sub : 'CUSTOM', label: def.label || 'Reading', unit: def.unit || '', base, val: base, vol, min, max, dec: 1, warnHi: warn, critHi: crit, custom: true, ts: clk(), series: Array.from({ length: 30 }, () => base + (Math.random() - 0.5) * vol * 2) };
    setCustomSensors((p) => [...p, sensor]);
  }, []);
  // live-animate custom sensors alongside the main fleet
  React.useEffect(() => {
    if (!stream.live) return;
    setCustomSensors((prev) => !prev.length ? prev : prev.map((a) => {
      const faultSev = faultsRef.current[a.group];
      const mit = mitRef.current[a.id];
      let nv;
      if (faultSev && !mit && !(faultSev === 'crit' ? statusOf(a) === 'crit' : statusOf(a) !== 'ok')) nv = a.val + (faultTarget(a, faultSev) - a.val) * 0.4 + (Math.random() - 0.5) * a.vol;
      else if (mit && statusOf(a) !== 'ok') nv = a.val + (safeTarget(a) - a.val) * 0.5 + (Math.random() - 0.5) * a.vol * 0.4;
      else if (autoMit && !faultSev && statusOf(a) !== 'ok') nv = a.val + (safeTarget(a) - a.val) * 0.42 + (Math.random() - 0.5) * a.vol * 0.4;
      else nv = rw(a.val, a.vol * volatility, a.min, a.max);
      nv = Math.max(a.min, Math.min(a.max, nv));
      return { ...a, val: nv, series: [...a.series.slice(1), nv], ts: clk() };
    }));
  }, [stream.tick]); // eslint-disable-line

  const zoneHealth = React.useMemo(() => {
    const m = {}; SECTIONS.forEach((s) => { m[s.name] = { ok: 0, total: 0 }; });
    gridPoints.forEach((p) => { const z = m[p.group]; if (!z) return; z.total++; if (statusOf(p) === 'ok') z.ok++; });
    const out = {}; for (const k in m) out[k] = Math.round(m[k].ok / (m[k].total || 1) * 100);
    return out;
  }, [gridPoints]);

  // Auto-Mitigate resolves any injected faults — NEPHES clears them, then heals the cells
  React.useEffect(() => {
    if (autoMit && Object.keys(faults).length) {
      const t = setTimeout(() => clearAllFaults(), 900);
      return () => clearTimeout(t);
    }
  }, [autoMit, faults, clearAllFaults]);

  React.useEffect(() => {const iv = setInterval(() => setClock(clk()), 1000);return () => clearInterval(iv);}, []);
  React.useEffect(() => {
    let c = 0, w = 0;
    gridPoints.forEach((p) => { const s = statusOf(p); if (s === 'crit') c++;else if (s === 'warn') w++; });
    setRiskHist((h) => [...h.slice(1), { c, w }]);
    // auto-clear per-device mitigation once a sensor returns to OK
    setMitigating((m) => {
      const ids = Object.keys(m);
      if (!ids.length) return m;
      let changed = false; const out = { ...m };
      for (const id of ids) {
        const dev = assets.find((a) => a.id === id) || gridPoints.find((p) => p.id === id);
        if (dev && statusOf(dev) === 'ok') { delete out[id]; changed = true; }
      }
      return changed ? out : m;
    });
  }, [stream.tick]); // eslint-disable-line
  React.useEffect(() => { setView(defaultView); }, [defaultView]);
  React.useEffect(() => { setProfile(startProfile); }, [startProfile]);
  React.useEffect(() => { document.body.classList.toggle('no-grid', !gridTexture); }, [gridTexture]);
  React.useEffect(() => { document.body.classList.toggle('no-glow', !glow); }, [glow]);

  const counts = React.useMemo(() => {
    let crit = 0,warn = 0,ok = 0;
    gridPoints.forEach((p) => {const s = statusOf(p);if (s === 'crit') crit++;else if (s === 'warn') warn++;else ok++;});
    return { crit, warn, ok };
  }, [gridPoints]);
  const health = Math.round(counts.ok / gridPoints.length * 100);
  const statusText = health >= 85 ? 'HEALTHY' : health >= 65 ? 'WARNING' : 'CRITICAL';
  const recText = counts.crit > 0 ? `NEPHES: ${counts.crit} sensor(s) in critical failure risk.` :
  counts.warn > 0 ? `NEPHES: ${counts.warn} sensor(s) flagged. Monitor closely.` :
  'NEPHES: all monitored assets within parameters.';

  const tileAssets = customSensors.length ? assets.concat(customSensors) : assets;
  const alerts = tileAssets.filter((a) => statusOf(a) !== 'ok').
  sort((a, b) => (statusOf(b) === 'crit' ? 1 : 0) - (statusOf(a) === 'crit' ? 1 : 0));

  // events feed
  const events = React.useMemo(() => {
    const flagged = alerts.slice(0, 10);
    return flagged.map((a, i) => {
      const st = statusOf(a);
      return { key: a.id + i, ts: a.ts, asset: a.name, sev: st === 'crit' ? 4 : 2, msg: `${a.label} ${a.val.toFixed(a.dec || 1)}${a.unit} ${st === 'crit' ? 'exceeded limit' : 'over threshold'}` };
    });
  }, [alerts.map((a) => a.id).join(',')]);

  const selAsset = tileAssets.find((a) => a.id === sel) || gridPoints.find((a) => a.id === sel) || (liveHw.sensors || []).find((a) => a.id === sel) || null;

  // notification badge counts for the combined right-side tabs
  const risksCrit = (view === 'grid' ? gridPoints : tileAssets).filter((a) => statusOf(a) === 'crit').length;
  const actN = ACTION_SEED.filter((a) => a.status !== 'resolved').length;

  return (
    <div className="shell" style={density === 'compact' ? { fontSize: 11 } : null}>
      <Header health={health} statusText={statusText} recText={recText} counts={counts} profile={profile} setProfile={switchProfile} clock={clock} stale={!stream.live} blueLight={blueLight} setBlueLight={setBlueLight} autoMit={autoMit} setAutoMit={setAutoMit} onAddSensor={() => setShowAdd(true)} customCount={customSensors.length} />
      <KpiStrip stream={stream} counts={counts} profile={profile} />
      <main className="main fade-in">
        <div className="wall-zone">
          {profile === 'enterprise' ?
          <ExecRollup assets={tileAssets} setSel={setSel} stream={stream} /> :
          profile === 'backend' ?
          <SystemView stream={stream} /> :
          profile === 'datasheets' ?
          <EquipmentKnowledge /> :
          <React.Fragment>
              <SensorWall assets={tileAssets} gridPoints={gridPoints} sel={sel} setSel={setSel} view={view} setView={setView} profile={profile} stream={stream} liveHw={liveHw} />
              {selAsset ?
            <DetailCard a={selAsset} onClose={() => setSel(null)} onAct={(id) => setSel(id)} autoMit={autoMit} mitigating={!!mitigating[selAsset.id]} onMitigate={startMitigation} /> :
            <div className="select-prompt" id="selectPrompt">
                  <div className="sp-inner">
                    <div className="sp-icon" aria-hidden="true">
                      {Array.from({ length: 9 }).map((_, i) => <span key={i} />)}
                    </div>
                    <div className="sp-title">Select a sensor</div>
                    <div className="sp-sub">Click any cell in the wall — or use the ← ↑ ↓ → keys — to inspect its live reading, location, device settings and NEPHES analysis.</div>
                  </div>
                </div>}
            </React.Fragment>}
        </div>
        <div className="right-region">
          {profile === 'enterprise' || profile === 'backend' ?
          <React.Fragment>
              <AiAnalysis profile={profile} alerts={alerts.slice(0, 6)} onAct={(id) => setSel(id)} autoMit={autoMit} mitigating={mitigating} onMitigate={startMitigation} />
              <OperatorControls profile={profile} assets={tileAssets} />
            </React.Fragment> :
          <div className="side-card right-tabs" id="rightTabs">
              <div className="rt-tabbar">
                {[{ k: 'ai', label: 'NEPHES AI', n: alerts.length },
                { k: 'risks', label: 'Top Risks', n: risksCrit, crit: true },
                { k: 'actions', label: 'Action Log', n: actN }].map((t) =>
                <button key={t.k} className={`rt-tab ${rightTab === t.k ? 'on' : ''}`} onClick={() => setRightTab(t.k)}>
                    {t.label}{t.n > 0 && <span className={`rt-badge ${t.crit ? 'crit' : ''}`}>{t.n}</span>}
                  </button>)}
              </div>
              <div className="rt-body">
                {rightTab === 'ai' && <AiAnalysis profile={profile} alerts={alerts.slice(0, 6)} onAct={(id) => setSel(id)} autoMit={autoMit} mitigating={mitigating} onMitigate={startMitigation} />}
                {rightTab === 'risks' && <TopRisks pool={view === 'grid' ? gridPoints : tileAssets} setSel={setSel} />}
                {rightTab === 'actions' && <ActionLog tick={stream.tick} />}
              </div>
            </div>}
        </div>
      </main>
      {showEvents && <EventsBar events={events} />}
      {blueLight && <div className="blue-filter" aria-hidden="true" />}
      {showAdd && <AddSensorModal groups={SECTIONS.map((s) => s.name)} onAdd={addSensor} onClose={() => setShowAdd(false)} />}
      {switching && <ProfileSplash label={splashLabel} leaving={splashLeaving} />}
    </div>);

}

Object.assign(window, { Industrial });
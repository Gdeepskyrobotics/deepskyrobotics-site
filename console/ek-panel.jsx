// Equipment Knowledge page for the Factory Observer console.
// Globals (no modules): EquipmentKnowledge, ProfileCard, UploadModal,
// ProfileDetail, AssetProfileSection. Reuses theme classes from index.html.
const EK = {
  confColor: (c) => (c >= 0.75 ? "var(--ok)" : c >= 0.5 ? "var(--accent)" : "var(--warn)"),
  range: (lo, hi, unit) =>
    lo == null && hi == null ? "—" : `${lo ?? "?"}–${hi ?? "?"} ${unit && unit !== "unknown" ? unit : ""}`.trim(),
  txt: (v) => (v && v !== "unknown" ? v : "—"),
};

function ProfileCard({ p, onView }) {
  const links = p.links || [];
  const conf = Math.round((p.confidence || 0) * 100);
  return (
    <div className="node-card node-card--clickable" onClick={() => onView(p)}
         style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div className="nc-top" style={{ justifyContent: "space-between" }}>
        <span className="nc-id">{EK.txt(p.manufacturer)} {EK.txt(p.model)}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: EK.confColor(p.confidence) }}>{conf}%</span>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <span className="ek-badge" style={{ background: "rgba(var(--accent-rgb),.10)", color: "var(--accent-bright)" }}>{EK.txt(p.device_type)}</span>
        {p.protocol && p.protocol !== "unknown" && <span className="ek-badge">{p.protocol}</span>}
        {p.output_type && p.output_type !== "unknown" && <span className="ek-badge">{p.output_type}</span>}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)" }}>
        <div>Supply: <span style={{ fontFamily: "var(--mono)", color: "var(--text-1)" }}>{EK.range(p.supply_voltage_min, p.supply_voltage_max, p.supply_voltage_unit)}</span></div>
        <div>Measured: <span style={{ fontFamily: "var(--mono)", color: "var(--text-1)" }}>{EK.range(p.measured_min, p.measured_max, p.measured_unit)}</span></div>
      </div>
      {(p.tags || []).length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {p.tags.map((t) => <span key={t} className="ek-pill">{t}</span>)}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)", borderTop: "1px solid var(--card-border)", paddingTop: 6 }}>
        <span>{links.length ? `linked: ${links.map((l) => l.asset_id).join(", ")}` : "not linked"}</span>
        <span>{(p.failure_signals || []).length}⚠ · {(p.maintenance_notes || []).length}🔧</span>
      </div>
    </div>
  );
}

// Public demo build: datasheet upload (UploadModal) and profile link/unlink
// editing are removed. This console is a read-only demonstration — a visitor
// cannot upload files or mutate any profile. Equipment profiles are browsed
// read-only from synthetic demo data.

function ProfileDetail({ p, assets, onClose, onChange }) {
  const links = p.links || [];
  const Row = ({ k, v }) => (
    <div className="dv-row"><span className="dv-k">{k}</span><span className="dv-v" style={{ fontFamily: "var(--mono)" }}>{v}</span></div>
  );
  return ReactDOM.createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: "94vw" }}>
        <div className="modal-head"><span>{EK.txt(p.manufacturer)} {EK.txt(p.model)}</span><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body" style={{ display: "block", maxHeight: "70vh", overflow: "auto" }}>
          <div className="dv-sec">
            <Row k="Device type" v={EK.txt(p.device_type)} />
            <Row k="Protocol" v={EK.txt(p.protocol)} />
            <Row k="Output" v={EK.txt(p.output_type)} />
            <Row k="Supply" v={EK.range(p.supply_voltage_min, p.supply_voltage_max, p.supply_voltage_unit)} />
            <Row k="Measured" v={EK.range(p.measured_min, p.measured_max, p.measured_unit)} />
            <Row k="Confidence" v={Math.round((p.confidence || 0) * 100) + "%"} />
          </div>
          {["failure_signals", "maintenance_notes", "wiring_notes", "evidence"].map((sec) =>
            (p[sec] || []).length ? (
              <div className="dv-sec" key={sec}>
                <div className="dv-head">{sec.replace("_", " ")}</div>
                {p[sec].map((line, i) => <div key={i} className="dv-doc" style={{ fontSize: 12 }}>{line}</div>)}
              </div>
            ) : null
          )}
          <div className="dv-sec">
            <div className="dv-head">linked assets</div>
            {links.length === 0
              ? <div className="dv-row"><span className="dv-v" style={{ color: "var(--text-3)" }}>not linked</span></div>
              : links.map((l, i) => (
                  <div key={i} className="dv-row"><span className="dv-v">{l.asset_id}{l.tag ? " · " + l.tag : ""}</span></div>
                ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function EquipmentKnowledge() {
  const [profiles, setProfiles] = React.useState(null);
  const [assets, setAssets] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [detail, setDetail] = React.useState(null);

  const reload = React.useCallback(() => {
    fetch("/nephes/equipment/profiles").then((r) => (r.ok ? r.json() : { profiles: [] }))
      .then((d) => setProfiles(d.profiles || [])).catch(() => setProfiles([]));
  }, []);
  React.useEffect(() => {
    reload();
    fetch("/assets").then((r) => (r.ok ? r.json() : { assets: [] })).then((d) => setAssets(d.assets || [])).catch(() => {});
  }, [reload]);

  const list = (profiles || []).filter((p) => {
    if (!q) return true;
    const hay = [p.manufacturer, p.model, p.device_type, p.protocol, ...(p.tags || [])].join(" ").toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <div className="wall-card">
      <div className="card-head">EQUIPMENT KNOWLEDGE <span className="count-pill">{profiles ? profiles.length : "…"}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input className="mf-in" placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 130, height: 28 }} />
        </span>
      </div>
      <div className="wall-scroll">
        {profiles === null ? <div style={{ padding: 16, color: "var(--text-3)" }}>Loading…</div>
          : list.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)" }}>No equipment profiles match.</div>
          : <div className="node-grid">{list.map((p) => <ProfileCard key={p.profile_id} p={p} onView={setDetail} />)}</div>}
      </div>
      {detail && <ProfileDetail p={detail} assets={assets} onClose={() => setDetail(null)} onChange={reload} />}
    </div>
  );
}

function AssetProfileSection({ assetId }) {
  const [profiles, setProfiles] = React.useState([]);
  React.useEffect(() => {
    let off = false;
    if (!assetId) return;
    fetch("/nephes/equipment/profiles?asset_id=" + encodeURIComponent(assetId))
      .then((r) => (r.ok ? r.json() : { profiles: [] }))
      .then((d) => { if (!off) setProfiles(d.profiles || []); })
      .catch(() => { if (!off) setProfiles([]); });
    return () => { off = true; };
  }, [assetId]);
  if (!profiles.length) return null;
  return (
    <div className="dv-sec">
      <div className="dv-head">equipment profile</div>
      {profiles.map((p) => (
        <div key={p.profile_id} className="dv-row">
          <span className="dv-v">{EK.txt(p.manufacturer)} {EK.txt(p.model)} · {EK.txt(p.device_type)}</span>
          <span style={{ fontFamily: "var(--mono)", color: "var(--text-3)" }}>{Math.round((p.confidence || 0) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { EquipmentKnowledge, ProfileCard, ProfileDetail, AssetProfileSection });

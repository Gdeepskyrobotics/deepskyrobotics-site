// ═══ NephesSource.js ═══
// NEPHES Source — data-source abstraction + command bus.
// Future-proofing seam: every console action routes through NEPHES_SOURCE.command(),
// so a remote backend can be wired in later without touching the UI.
// Command contract (mirrors Docs → API Reference):
//   command('mitigation.start',   {sensorId})          → POST  /v1/mitigations
//   command('technician.dispatch',{asset, zone})       → POST  /v1/workorders
//   command('sensor.patch',       {sensorId, patch})   → PATCH /v1/sensors/:id  (limits, mute, settings)
//   command('sensor.provision',   {...})               → POST  /v1/sensors
//   command('fault.inject',       {zone, sev, type})   → POST  /v1/sim/faults   (testing only)
// Modes: 'sim' (built-in simulator, default) · 'remote' (POSTs to `${url}/v1/commands`,
// falls back to the simulator automatically if the endpoint is unreachable).
(function () {
  const load = () => { try { return JSON.parse(localStorage.getItem('nfo_source') || '{}'); } catch (e) { return {}; } };
  const cfg = Object.assign({ mode: 'sim', url: '', status: 'untested' }, load(), { status: 'untested' });
  const save = () => { try { localStorage.setItem('nfo_source', JSON.stringify({ mode: cfg.mode, url: cfg.url })); } catch (e) {} };
  const outbox = []; // last 200 commands, newest first — inspectable in devtools via NEPHES_SOURCE.outbox
  const emit = () => window.dispatchEvent(new CustomEvent('nephes:source', { detail: Object.assign({}, cfg) }));
  const base = () => cfg.url.replace(/\/+$/, '');
  window.NEPHES_SOURCE = {
    outbox,
    get: function () { return Object.assign({ outbox: outbox.length }, cfg); },
    setMode: function (m) { cfg.mode = m; save(); emit(); },
    setConfig: function (p) { Object.assign(cfg, p); cfg.status = 'untested'; save(); emit(); },
    test: async function () {
      if (!cfg.url) { cfg.status = 'offline'; emit(); return { ok: false, msg: 'No endpoint set' }; }
      try {
        const ctl = new AbortController(); const t = setTimeout(function () { ctl.abort(); }, 4000);
        const r = await fetch(base() + '/v1/health', { signal: ctl.signal });
        clearTimeout(t);
        cfg.status = r.ok ? 'online' : 'offline'; emit();
        return { ok: r.ok, msg: r.ok ? 'Connected' : 'HTTP ' + r.status };
      } catch (e) { cfg.status = 'offline'; emit(); return { ok: false, msg: 'Unreachable — simulator remains active' }; }
    },
    command: async function (type, payload) {
      const rec = { type: type, payload: payload, ts: Date.now(), via: cfg.mode };
      if (cfg.mode === 'remote' && cfg.url && cfg.status === 'online') {
        try {
          await fetch(base() + '/v1/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) });
          rec.delivered = true;
        } catch (e) { rec.delivered = false; rec.fallback = 'sim'; cfg.status = 'offline'; emit(); }
      } else { rec.simulated = true; }
      outbox.unshift(rec); if (outbox.length > 200) outbox.pop();
      return rec;
    } };
})();

;
// ═══ LadderCorpus.js ═══
// LadderCorpus.js — the DSR ladder corpus, generated in-browser.
// Faithful JS port of NFO/program/synth (archetypes.py + generator.py): the same
// 30 clean archetypes rendered across the same 37-asset fleet, with the same six
// defect injectors replayed from the corpus manifest's answer key. File 0000–0299
// here reproduces DSR_Ladder_Corpus/0000…0299.L5X rung-for-rung, and toL5X()
// emits the identical export format (1756-L83E, SoftwareRevision 32.00).
(function () {
  const T = (n, dt, pre, acc) => ({ n, dt: dt || 'BOOL', pre: pre == null ? null : pre, acc: acc || 'Read/Write' });
  const A = (id, title, subsystem, tags, rungs) => ({ id, title, subsystem, tags, rungs });

  // ── Archetype library (program/synth/archetypes.py, verbatim) — '{a}' = asset prefix ──
  const ARCHETYPES = [
  A('motor-starter', 'DOL motor starter with seal-in', 'motor',
  [T('{a}_Start_PB'), T('{a}_Stop_PB'), T('{a}_OL_OK'), T('{a}_Estop_OK'), T('{a}_Run'), T('{a}_Fault')],
  [['Seal-in start/stop with overload and E-stop in series', 'XIO({a}_Stop_PB)XIC({a}_OL_OK)XIC({a}_Estop_OK)[XIC({a}_Start_PB),XIC({a}_Run)]OTE({a}_Run);'],
  ['Overload trip latches a fault', 'XIO({a}_OL_OK)OTL({a}_Fault);'],
  ['Fault cleared by the stop button', 'XIC({a}_Stop_PB)OTU({a}_Fault);']]),
  A('star-delta', 'Star-delta starter with transition', 'motor',
  [T('{a}_Start_PB'), T('{a}_Stop_PB'), T('{a}_Star'), T('{a}_Delta'), T('{a}_Run'), T('{a}_Trans_TMR', 'TIMER', 6000)],
  [['Run contactor seals in', 'XIO({a}_Stop_PB)[XIC({a}_Start_PB),XIC({a}_Run)]OTE({a}_Run);'],
  ['Star until the transition timer completes', 'XIC({a}_Run)TON({a}_Trans_TMR,?,?);'],
  ['Star winding energised during the timer', 'XIC({a}_Run)XIO({a}_Trans_TMR.DN)OTE({a}_Star);'],
  ['Delta after transition, interlocked against star', 'XIC({a}_Run)XIC({a}_Trans_TMR.DN)XIO({a}_Star)OTE({a}_Delta);']]),
  A('vfd-control', 'VFD start/stop with at-speed proving', 'motor',
  [T('{a}_Run_Cmd'), T('{a}_Drive_Ready'), T('{a}_Drive_Fault'), T('{a}_At_Speed'), T('{a}_Fault_Reset'), T('{a}_Running'), T('{a}_Speed_TMR', 'TIMER', 10000)],
  [['Run only when the drive reports ready and unfaulted', 'XIC({a}_Run_Cmd)XIC({a}_Drive_Ready)XIO({a}_Drive_Fault)OTE({a}_Running);'],
  ['Prove the drive reaches speed within the window', 'XIC({a}_Running)XIO({a}_At_Speed)TON({a}_Speed_TMR,?,?);'],
  ['Reset the drive fault on operator request', 'XIC({a}_Fault_Reset)OTU({a}_Drive_Fault);']]),
  A('conveyor-jam', 'Conveyor run with jam detection', 'conveyor',
  [T('{a}_Run_Cmd'), T('{a}_Photoeye'), T('{a}_Run'), T('{a}_Jam'), T('{a}_Jam_Reset'), T('{a}_Jam_TMR', 'TIMER', 8000)],
  [['Conveyor runs while commanded and not jammed', 'XIC({a}_Run_Cmd)XIO({a}_Jam)OTE({a}_Run);'],
  ['Photoeye blocked continuously means product is not moving', 'XIC({a}_Run)XIC({a}_Photoeye)TON({a}_Jam_TMR,?,?);'],
  ['Latch the jam when the timer expires', 'XIC({a}_Jam_TMR.DN)OTL({a}_Jam);'],
  ['Operator clears the jam', 'XIC({a}_Jam_Reset)OTU({a}_Jam);']]),
  A('zone-accumulation', 'Accumulation zone release', 'conveyor',
  [T('{a}_Zone_Full'), T('{a}_Downstream_Ready'), T('{a}_Release'), T('{a}_Release_TMR', 'TIMER', 1500)],
  [['Release when the zone has product and downstream can take it', 'XIC({a}_Zone_Full)XIC({a}_Downstream_Ready)TON({a}_Release_TMR,?,?);'],
  ['Drive the release solenoid once settled', 'XIC({a}_Release_TMR.DN)OTE({a}_Release);']]),
  A('pump-leadlag', 'Duty/standby pump alternation', 'pump',
  [T('{a}_Call'), T('{a}_Lead_Sel'), T('{a}_A_Run'), T('{a}_B_Run'), T('{a}_A_Fault'), T('{a}_B_Fault'), T('{a}_Alt_TMR', 'TIMER', 3600000)],
  [['Lead pump runs on demand unless faulted', 'XIC({a}_Call)XIC({a}_Lead_Sel)XIO({a}_A_Fault)OTE({a}_A_Run);'],
  ['Standby takes over when lead is faulted or not selected', 'XIC({a}_Call)[XIO({a}_Lead_Sel),XIC({a}_A_Fault)]XIO({a}_B_Fault)OTE({a}_B_Run);'],
  ['Runtime equalisation timer', 'XIC({a}_Call)RTO({a}_Alt_TMR,?,?);'],
  ['Alternate and restart the equalisation window', 'XIC({a}_Alt_TMR.DN)RES({a}_Alt_TMR);']]),
  A('level-hysteresis', 'Level control with hysteresis', 'tank',
  [T('{a}_Level_Low'), T('{a}_Level_High'), T('{a}_HiHi'), T('{a}_Fill_Valve'), T('{a}_Overfill')],
  [['Start filling on low level', 'XIC({a}_Level_Low)OTL({a}_Fill_Valve);'],
  ['Stop filling on high level', 'XIC({a}_Level_High)OTU({a}_Fill_Valve);'],
  ['High-high is an independent overfill interlock', 'XIC({a}_HiHi)OTL({a}_Overfill);'],
  ['Overfill clears only when level recovers', 'XIO({a}_HiHi)XIC({a}_Level_Low)OTU({a}_Overfill);']]),
  A('two-hand', 'Two-hand anti-tie-down press control', 'press',
  [T('{a}_LH_PB'), T('{a}_RH_PB'), T('{a}_Guard_Closed'), T('{a}_Cycle_Permit'), T('{a}_Concurrency_TMR', 'TIMER', 500)],
  [['Both buttons must be pressed within the concurrency window', 'XIC({a}_LH_PB)XIC({a}_RH_PB)TON({a}_Concurrency_TMR,?,?);'],
  ['Permit only with the guard closed and both hands committed', 'XIC({a}_LH_PB)XIC({a}_RH_PB)XIC({a}_Guard_Closed)XIO({a}_Concurrency_TMR.DN)OTE({a}_Cycle_Permit);']]),
  A('press-sequence', 'Press cycle step sequencer', 'press',
  [T('{a}_Cycle_Permit'), T('{a}_Advance'), T('{a}_Retract'), T('{a}_At_Bottom'), T('{a}_At_Top'), T('{a}_Dwell_TMR', 'TIMER', 2000)],
  [['Advance on permit until bottom of stroke', 'XIC({a}_Cycle_Permit)XIO({a}_At_Bottom)OTE({a}_Advance);'],
  ['Dwell at the bottom', 'XIC({a}_At_Bottom)TON({a}_Dwell_TMR,?,?);'],
  ['Retract once dwell completes', 'XIC({a}_Dwell_TMR.DN)XIO({a}_At_Top)OTE({a}_Retract);']]),
  A('gate-monitor', 'Safety gate status mirror (non-rated)', 'safety',
  [T('{a}_Gate_SW1'), T('{a}_Gate_SW2'), T('{a}_Gate_Closed'), T('{a}_Discrepancy'), T('{a}_Disc_TMR', 'TIMER', 3000)],
  [['Both switches agree the gate is closed. STATUS ONLY — the safety function lives in the rated safety relay, not in this rung', 'XIC({a}_Gate_SW1)XIC({a}_Gate_SW2)OTE({a}_Gate_Closed);'],
  ['Switches disagreeing for too long indicates a fault', 'XIC({a}_Gate_SW1)XIO({a}_Gate_SW2)TON({a}_Disc_TMR,?,?);'],
  ['Latch the discrepancy for maintenance', 'XIC({a}_Disc_TMR.DN)OTL({a}_Discrepancy);'],
  ['Cleared by maintenance acknowledge', 'XIC({a}_Gate_SW2)XIC({a}_Gate_SW1)OTU({a}_Discrepancy);']]),
  A('estop-reset', 'E-stop reset permissive', 'safety',
  [T('{a}_Estop_Chain'), T('{a}_Reset_PB'), T('{a}_Reset_Permit'), T('{a}_MCR_Permit')],
  [['Reset is only offered once the chain is restored', 'XIC({a}_Estop_Chain)OTE({a}_Reset_Permit);'],
  ['Rising-edge reset avoids a tied-down reset button', 'XIC({a}_Reset_Permit)ONS({a}_Reset_PB)OTL({a}_MCR_Permit);'],
  ['Any chain break drops the permit immediately', 'XIO({a}_Estop_Chain)OTU({a}_MCR_Permit);']]),
  A('first-out-alarm', 'First-out alarm annunciator', 'alarm',
  [T('{a}_Trip_1'), T('{a}_Trip_2'), T('{a}_Trip_3'), T('{a}_First_Out_1'), T('{a}_First_Out_2'), T('{a}_First_Out_3'), T('{a}_Any_Trip'), T('{a}_Ack_PB')],
  [['Any trip sets the common alarm', '[XIC({a}_Trip_1),XIC({a}_Trip_2),XIC({a}_Trip_3)]OTE({a}_Any_Trip);'],
  ['First-out capture: only latch if nothing was tripped yet', 'XIC({a}_Trip_1)XIO({a}_Any_Trip)OTL({a}_First_Out_1);'],
  ['First-out capture for trip 2', 'XIC({a}_Trip_2)XIO({a}_Any_Trip)OTL({a}_First_Out_2);'],
  ['First-out capture for trip 3', 'XIC({a}_Trip_3)XIO({a}_Any_Trip)OTL({a}_First_Out_3);'],
  ['Acknowledge clears the first-out register', 'XIC({a}_Ack_PB)OTU({a}_First_Out_1);'],
  ['Acknowledge clears trip 2 capture', 'XIC({a}_Ack_PB)OTU({a}_First_Out_2);'],
  ['Acknowledge clears trip 3 capture', 'XIC({a}_Ack_PB)OTU({a}_First_Out_3);']]),
  A('stack-light', 'Andon stack light', 'hmi',
  [T('{a}_Fault'), T('{a}_Warning'), T('{a}_Running'), T('{a}_Red'), T('{a}_Amber'), T('{a}_Green')],
  [['Red on fault', 'XIC({a}_Fault)OTE({a}_Red);'],
  ['Amber on warning when not faulted', 'XIC({a}_Warning)XIO({a}_Fault)OTE({a}_Amber);'],
  ['Green only when running cleanly', 'XIC({a}_Running)XIO({a}_Fault)XIO({a}_Warning)OTE({a}_Green);']]),
  A('part-counter', 'Part counter with shift reset', 'production',
  [T('{a}_Part_Present'), T('{a}_Shift_Change'), T('{a}_Count', 'COUNTER', 100000), T('{a}_Target_Met')],
  [['Count each part on the leading edge', 'ONS({a}_Part_Present)CTU({a}_Count,?,?);'],
  ['Target reached', 'XIC({a}_Count.DN)OTE({a}_Target_Met);'],
  ['Shift change resets the counter', 'XIC({a}_Shift_Change)RES({a}_Count);']]),
  A('runtime-hours', 'Runtime hour accumulator', 'maintenance',
  [T('{a}_Running'), T('{a}_Service_Reset'), T('{a}_Runtime_TMR', 'TIMER', 3600000), T('{a}_Service_Due')],
  [['Accumulate only while running', 'XIC({a}_Running)RTO({a}_Runtime_TMR,?,?);'],
  ['Service due at the interval', 'XIC({a}_Runtime_TMR.DN)OTE({a}_Service_Due);'],
  ['Service performed resets the accumulator', 'XIC({a}_Service_Reset)RES({a}_Runtime_TMR);']]),
  A('lubrication', 'Lubrication interval', 'maintenance',
  [T('{a}_Running'), T('{a}_Lube_Pump'), T('{a}_Lube_Cycle_Done'), T('{a}_Interval_TMR', 'TIMER', 1800000), T('{a}_Shot_TMR', 'TIMER', 4000)],
  [['Interval accrues with machine runtime', 'XIC({a}_Running)RTO({a}_Interval_TMR,?,?);'],
  ['Interval expiry runs the lube pump for one shot', 'XIC({a}_Interval_TMR.DN)TON({a}_Shot_TMR,?,?);'],
  ['Pump energised during the shot', 'XIC({a}_Interval_TMR.DN)XIO({a}_Shot_TMR.DN)OTE({a}_Lube_Pump);'],
  ['Shot complete resets the interval', 'XIC({a}_Shot_TMR.DN)RES({a}_Interval_TMR);'],
  ['Report the cycle', 'XIC({a}_Shot_TMR.DN)OTE({a}_Lube_Cycle_Done);']]),
  A('oven-soak', 'Oven zone soak profile', 'oven',
  [T('{a}_At_Temp'), T('{a}_Batch_Start'), T('{a}_Batch_Done'), T('{a}_Heat_Demand'), T('{a}_Soak_TMR', 'TIMER', 1800000)],
  [['Heat until at temperature', 'XIC({a}_Batch_Start)XIO({a}_At_Temp)OTE({a}_Heat_Demand);'],
  ['Soak accumulates only while at temperature', 'XIC({a}_At_Temp)RTO({a}_Soak_TMR,?,?);'],
  ['Batch complete when soak satisfied', 'XIC({a}_Soak_TMR.DN)OTE({a}_Batch_Done);'],
  ['New batch resets the soak', 'XIC({a}_Batch_Start)RES({a}_Soak_TMR);']]),
  A('flow-proving', 'Cooling flow proving', 'chiller',
  [T('{a}_Pump_Run'), T('{a}_Flow_SW'), T('{a}_Flow_Fail'), T('{a}_Ack_PB'), T('{a}_Prove_TMR', 'TIMER', 15000)],
  [['Flow must establish within the proving window', 'XIC({a}_Pump_Run)XIO({a}_Flow_SW)TON({a}_Prove_TMR,?,?);'],
  ['Latch the flow failure', 'XIC({a}_Prove_TMR.DN)OTL({a}_Flow_Fail);'],
  ['Acknowledged once flow returns', 'XIC({a}_Flow_SW)XIC({a}_Ack_PB)OTU({a}_Flow_Fail);']]),
  A('compressor-leadlag', 'Air compressor lead/lag', 'utilities',
  [T('{a}_Pressure_Low'), T('{a}_Pressure_VLow'), T('{a}_Lead_Run'), T('{a}_Lag_Run'), T('{a}_Lag_Delay_TMR', 'TIMER', 20000)],
  [['Lead starts on low pressure', 'XIC({a}_Pressure_Low)OTE({a}_Lead_Run);'],
  ['Lag is delayed to avoid both starting together', 'XIC({a}_Pressure_VLow)TON({a}_Lag_Delay_TMR,?,?);'],
  ['Lag runs after the delay', 'XIC({a}_Lag_Delay_TMR.DN)XIC({a}_Pressure_VLow)OTE({a}_Lag_Run);']]),
  A('dust-collector', 'Dust collector pulse-jet cleaning', 'utilities',
  [T('{a}_Fan_Run'), T('{a}_Pulse_Valve'), T('{a}_DP_High'), T('{a}_Pulse_TMR', 'TIMER', 200), T('{a}_Interval_TMR', 'TIMER', 30000)],
  [['Cleaning interval runs while the fan runs', 'XIC({a}_Fan_Run)TON({a}_Interval_TMR,?,?);'],
  ['Pulse on interval expiry or high differential pressure', '[XIC({a}_Interval_TMR.DN),XIC({a}_DP_High)]TON({a}_Pulse_TMR,?,?);'],
  ['Valve open for the pulse duration', 'XIC({a}_Interval_TMR.DN)XIO({a}_Pulse_TMR.DN)OTE({a}_Pulse_Valve);']]),
  A('filter-dp', 'Filter differential pressure alarm', 'utilities',
  [T('{a}_DP_High'), T('{a}_DP_Alarm'), T('{a}_Filter_Changed'), T('{a}_DP_TMR', 'TIMER', 60000)],
  [['Sustained high differential, not a transient', 'XIC({a}_DP_High)TON({a}_DP_TMR,?,?);'],
  ['Latch the alarm', 'XIC({a}_DP_TMR.DN)OTL({a}_DP_Alarm);'],
  ['Filter change clears it', 'XIC({a}_Filter_Changed)OTU({a}_DP_Alarm);']]),
  A('valve-travel', 'Valve travel proving', 'valve',
  [T('{a}_Open_Cmd'), T('{a}_Open_LS'), T('{a}_Closed_LS'), T('{a}_Travel_Fail'), T('{a}_Reset_PB'), T('{a}_Travel_TMR', 'TIMER', 12000)],
  [['Valve must reach the open limit within the travel time', 'XIC({a}_Open_Cmd)XIO({a}_Open_LS)TON({a}_Travel_TMR,?,?);'],
  ['Latch a travel failure', 'XIC({a}_Travel_TMR.DN)OTL({a}_Travel_Fail);'],
  ['Both limits made at once is a feedback fault', 'XIC({a}_Open_LS)XIC({a}_Closed_LS)OTL({a}_Travel_Fail);'],
  ['Reset by the operator', 'XIC({a}_Reset_PB)OTU({a}_Travel_Fail);']]),
  A('index-table', 'Rotary index table position confirm', 'index',
  [T('{a}_Index_Cmd'), T('{a}_In_Position'), T('{a}_Clamp'), T('{a}_Index_Fault'), T('{a}_Reset_PB'), T('{a}_Index_TMR', 'TIMER', 5000)],
  [['Index must confirm position in time', 'XIC({a}_Index_Cmd)XIO({a}_In_Position)TON({a}_Index_TMR,?,?);'],
  ['Clamp only when in position', 'XIC({a}_In_Position)XIO({a}_Index_Cmd)OTE({a}_Clamp);'],
  ['Failure to index latches', 'XIC({a}_Index_TMR.DN)OTL({a}_Index_Fault);'],
  ['Reset', 'XIC({a}_Reset_PB)OTU({a}_Index_Fault);']]),
  A('robot-handshake', 'Robot cell handshake', 'robot',
  [T('{a}_Cell_Ready'), T('{a}_Robot_Request'), T('{a}_Robot_Ack'), T('{a}_Part_Clear'), T('{a}_HS_TMR', 'TIMER', 30000), T('{a}_HS_Timeout')],
  [['Acknowledge only when the cell is ready and clear', 'XIC({a}_Robot_Request)XIC({a}_Cell_Ready)XIC({a}_Part_Clear)OTE({a}_Robot_Ack);'],
  ['A request that is never acknowledged is a timeout', 'XIC({a}_Robot_Request)XIO({a}_Robot_Ack)TON({a}_HS_TMR,?,?);'],
  ['Latch the handshake timeout', 'XIC({a}_HS_TMR.DN)OTL({a}_HS_Timeout);'],
  ['Clears when the request drops', 'XIO({a}_Robot_Request)OTU({a}_HS_Timeout);']]),
  A('reject-gate', 'Vision reject gate', 'quality',
  [T('{a}_Inspect_Done'), T('{a}_Part_Bad'), T('{a}_At_Gate'), T('{a}_Reject_Sol'), T('{a}_Reject_Latch'), T('{a}_Blow_TMR', 'TIMER', 300)],
  [['Latch a bad result when inspection completes', 'XIC({a}_Inspect_Done)XIC({a}_Part_Bad)OTL({a}_Reject_Latch);'],
  ['Fire the gate as the part arrives', 'XIC({a}_Reject_Latch)XIC({a}_At_Gate)TON({a}_Blow_TMR,?,?);'],
  ['Solenoid energised for the blow duration', 'XIC({a}_Reject_Latch)XIC({a}_At_Gate)XIO({a}_Blow_TMR.DN)OTE({a}_Reject_Sol);'],
  ['Clear the latch once ejected', 'XIC({a}_Blow_TMR.DN)OTU({a}_Reject_Latch);']]),
  A('screw-feeder', 'Screw feeder dosing', 'feeder',
  [T('{a}_Dose_Req'), T('{a}_Weight_Reached'), T('{a}_Feeder_Run'), T('{a}_Dose_Fault'), T('{a}_Reset_PB'), T('{a}_Dose_TMR', 'TIMER', 45000)],
  [['Feed until target weight', 'XIC({a}_Dose_Req)XIO({a}_Weight_Reached)OTE({a}_Feeder_Run);'],
  ['Dosing that runs too long indicates a blockage', 'XIC({a}_Feeder_Run)TON({a}_Dose_TMR,?,?);'],
  ['Latch the dosing fault', 'XIC({a}_Dose_TMR.DN)OTL({a}_Dose_Fault);'],
  ['Reset', 'XIC({a}_Reset_PB)OTU({a}_Dose_Fault);']]),
  A('heater-interlock', 'Heater enable with over-temp interlock', 'oven',
  [T('{a}_Heat_Call'), T('{a}_Over_Temp'), T('{a}_Fan_Proven'), T('{a}_Heater_On'), T('{a}_Overtemp_Latch'), T('{a}_Reset_PB')],
  [['Heat only with airflow proven and no over-temperature', 'XIC({a}_Heat_Call)XIC({a}_Fan_Proven)XIO({a}_Over_Temp)XIO({a}_Overtemp_Latch)OTE({a}_Heater_On);'],
  ['Over-temperature latches out the heater', 'XIC({a}_Over_Temp)OTL({a}_Overtemp_Latch);'],
  ['Manual reset only, once temperature has recovered', 'XIC({a}_Reset_PB)XIO({a}_Over_Temp)OTU({a}_Overtemp_Latch);']]),
  A('permissive-chain', 'Upstream/downstream permissive chain', 'line',
  [T('{a}_Upstream_Ready'), T('{a}_Downstream_Ready'), T('{a}_Local_Ready'), T('{a}_Line_Permit'), T('{a}_Blocked')],
  [['Run permit needs the whole chain', 'XIC({a}_Upstream_Ready)XIC({a}_Local_Ready)XIC({a}_Downstream_Ready)OTE({a}_Line_Permit);'],
  ['Blocked when downstream cannot accept', 'XIC({a}_Local_Ready)XIO({a}_Downstream_Ready)OTE({a}_Blocked);']]),
  A('auto-manual', 'Auto/manual mode with jog', 'mode',
  [T('{a}_Auto_Sel'), T('{a}_Jog_PB'), T('{a}_Auto_Cmd'), T('{a}_Output'), T('{a}_Estop_OK')],
  [['Auto and manual are mutually exclusive on one output', 'XIC({a}_Estop_OK)[XIC({a}_Auto_Sel)XIC({a}_Auto_Cmd),XIO({a}_Auto_Sel)XIC({a}_Jog_PB)]OTE({a}_Output);']]),
  A('hydraulic-power', 'Hydraulic power unit start', 'hydraulics',
  [T('{a}_Start_PB'), T('{a}_Stop_PB'), T('{a}_Level_OK'), T('{a}_Temp_OK'), T('{a}_Filter_OK'), T('{a}_HPU_Run'), T('{a}_Warmup_TMR', 'TIMER', 120000), T('{a}_Ready')],
  [['Start requires level, temperature and filter all healthy', 'XIO({a}_Stop_PB)XIC({a}_Level_OK)XIC({a}_Temp_OK)XIC({a}_Filter_OK)[XIC({a}_Start_PB),XIC({a}_HPU_Run)]OTE({a}_HPU_Run);'],
  ['Warm-up period before the system is offered as ready', 'XIC({a}_HPU_Run)TON({a}_Warmup_TMR,?,?);'],
  ['Ready after warm-up', 'XIC({a}_Warmup_TMR.DN)OTE({a}_Ready);']]),
  ];
  const BY_ID = {}; ARCHETYPES.forEach((a) => { BY_ID[a.id] = a; });

  // Fleet in generator order (file i → FLEET[i % 37], ARCHETYPES[i % 30])
  const FLEET = [];
  [['PRESS', 4], ['CONV', 4], ['PUMP', 3], ['OVEN', 2], ['ROBOT', 3], ['VALVE', 3], ['CHILLER', 2], ['COMPRESSOR', 2], ['MIXER', 2], ['SORTER', 2], ['TRIM', 2], ['DEBURR', 2], ['UPS', 1], ['HVAC', 1], ['LIFT', 1], ['VISION', 1], ['FILTER', 2]].
  forEach(([g, n]) => { for (let i = 1; i <= n; i++) FLEET.push(g + '_' + String(i).padStart(2, '0')); });

  // ── Answer key (DSR_Ladder_Corpus/manifest.json), in injection order ──
  // dc = dual-coil(tag suffix) · lw = latch-without-unlatch · rr = retentive-no-reset ·
  // zp = zero-preset-timer · ur = unreachable-rung · ut = unused-tag(Legacy_Spare).
  // Orphaned unused-tags (Reset_PB etc.) are re-derived by orphan labeling, not stored.
  const PLANTED = {
    2: [['dc', 'Running'], ['ur']], 3: [['dc', 'Run']], 5: [['ur']], 6: [['ut'], ['ur']], 7: [['ur']],
    10: [['lw', 'MCR_Permit']], 13: [['ur']], 14: [['ut']], 15: [['zp', 'Interval_TMR']], 16: [['ut']],
    25: [['ut']], 31: [['ur']], 41: [['lw', 'First_Out_2']], 45: [['zp', 'Interval_TMR']],
    50: [['ur'], ['zp', 'DP_TMR']], 52: [['lw', 'Index_Fault']], 53: [['dc', 'Robot_Ack']], 55: [['ut']],
    57: [['ur']], 58: [['dc', 'Output'], ['ut']], 60: [['ut']], 61: [['zp', 'Trans_TMR']], 62: [['ut']],
    64: [['ur']], 67: [['ur'], ['ut']], 69: [['dc', 'Gate_Closed'], ['ur']], 70: [['dc', 'Reset_Permit']],
    82: [['ur'], ['zp', 'Index_TMR']], 88: [['ut']], 89: [['zp', 'Warmup_TMR'], ['dc', 'Ready']],
    91: [['ur']], 92: [['ut']], 95: [['rr', 'Alt_TMR']], 97: [['ut']], 101: [['ut']],
    103: [['dc', 'Target_Met'], ['ut']], 104: [['rr', 'Runtime_TMR'], ['dc', 'Service_Due']], 105: [['ur']],
    108: [['dc', 'Lag_Run'], ['ut']], 113: [['zp', 'HS_TMR']], 114: [['dc', 'Reject_Sol']],
    115: [['zp', 'Dose_TMR']], 117: [['ur']], 121: [['dc', 'Delta']], 122: [['ur']], 124: [['ur']],
    125: [['dc', 'A_Run']], 128: [['ur']], 129: [['dc', 'Gate_Closed'], ['ur']], 130: [['ur'], ['ut']],
    131: [['lw', 'First_Out_2']], 133: [['zp', 'Count']], 134: [['rr', 'Runtime_TMR'], ['zp', 'Runtime_TMR']],
    135: [['dc', 'Lube_Pump']], 136: [['dc', 'Heat_Demand'], ['ut']], 137: [['lw', 'Flow_Fail']],
    141: [['zp', 'Travel_TMR']], 147: [['dc', 'Blocked']], 149: [['dc', 'HPU_Run']], 151: [['ur']],
    155: [['dc', 'A_Run']], 159: [['zp', 'Disc_TMR'], ['ur']], 162: [['ur']], 163: [['ur']],
    165: [['rr', 'Interval_TMR']], 166: [['rr', 'Soak_TMR']], 167: [['ut']],
    168: [['zp', 'Lag_Delay_TMR'], ['ur']], 171: [['lw', 'Travel_Fail']], 173: [['zp', 'HS_TMR']],
    177: [['dc', 'Blocked']], 182: [['zp', 'Speed_TMR']], 184: [['zp', 'Release_TMR'], ['ur']],
    185: [['dc', 'B_Run']], 187: [['dc', 'Cycle_Permit']], 190: [['ur'], ['dc', 'Test_Output']],
    191: [['lw', 'First_Out_3']], 192: [['dc', 'Amber']], 193: [['ut']], 194: [['ut']], 198: [['ur']],
    200: [['ur']], 201: [['ut']], 206: [['dc', 'Heater_On']], 207: [['ur']], 209: [['zp', 'Warmup_TMR']],
    211: [['dc', 'Delta']], 212: [['ut'], ['ur']], 213: [['ut']], 215: [['zp', 'Alt_TMR']], 218: [['ur']],
    220: [['lw', 'MCR_Permit']], 221: [['dc', 'Any_Trip'], ['ut']], 223: [['ur'], ['zp', 'Count']],
    224: [['dc', 'Service_Due']], 225: [['ut']], 226: [['ur'], ['rr', 'Soak_TMR']],
    231: [['zp', 'Travel_TMR'], ['lw', 'Travel_Fail']], 233: [['lw', 'HS_Timeout']],
    235: [['zp', 'Dose_TMR'], ['lw', 'Dose_Fault']], 236: [['ut']], 238: [['dc', 'Output']], 239: [['ut']],
    240: [['dc', 'Run']], 241: [['ur']], 244: [['ut'], ['dc', 'Release']], 248: [['zp', 'Dwell_TMR']],
    249: [['ur'], ['ut']], 259: [['ur']], 261: [['zp', 'Travel_TMR'], ['lw', 'Travel_Fail']],
    263: [['zp', 'HS_TMR']], 269: [['dc', 'Ready']], 270: [['ut']], 272: [['ur']], 273: [['zp', 'Jam_TMR']],
    276: [['ut']], 277: [['ut'], ['dc', 'Cycle_Permit']], 279: [['dc', 'Gate_Closed']],
    284: [['dc', 'Service_Due']], 287: [['ur']], 291: [['zp', 'Travel_TMR']], 292: [['dc', 'Clamp']],
    295: [['ut']], 298: [['ut']] };

  const RULE_NAMES = { dc: 'dual-coil', lw: 'latch-without-unlatch', rr: 'retentive-no-reset', zp: 'zero-preset-timer', ur: 'unreachable-rung', ut: 'unused-tag' };
  const DETAILS = { dc: 'a second OTE was appended for the same output', lw: 'the unlatch rung was removed', rr: 'the RES rung was removed', zp: 'preset reduced to 0', ur: 'gated on a tag nothing can write', ut: 'declared and never referenced' };

  const render = (tpl, asset) => tpl.split('{a}').join(asset);
  const baseTag = (op) => op.split('.', 1)[0].trim();
  // (rung index, tag) for each rung driving `mnemonic` — mirrors generator._outputs
  const outputs = (rungs, mn) => {
    const found = [];
    rungs.forEach((r, i) => {
      const re = new RegExp('\\b' + mn + '\\(([^),]+)', 'g'); let m;
      while (m = re.exec(r.t)) found.push([i, m[1].trim()]);
    });
    return found;
  };

  function buildProgram(i) {
    const asset = FLEET[i % FLEET.length];
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const prog = {
      idx: i, file: String(i).padStart(4, '0') + '_' + asset + '_' + arch.id + '.L5X',
      controller: asset + '_CTRL', asset, cls: asset.replace(/_\d+$/, ''),
      archetype: arch.id, title: arch.title, subsystem: arch.subsystem,
      routine: asset + '_' + arch.id.toUpperCase().replace(/-/g, '_'),
      tags: arch.tags.map((t) => ({ n: render(t.n, asset), dt: t.dt, pre: t.pre, acc: t.acc })),
      rungs: arch.rungs.map(([c, t]) => ({ c: render(c, asset), t: render(t, asset) })),
      planted: [] };
    (PLANTED[i] || []).forEach(([code, suffix]) => {
      const tag = suffix ? asset + '_' + suffix : null;
      if (code === 'dc') {
        prog.rungs.push({ c: 'Manual override added during commissioning', t: 'XIC(' + asset + '_Manual_Override)OTE(' + tag + ');' });
        prog.tags.push({ n: asset + '_Manual_Override', dt: 'BOOL', pre: null, acc: 'Read/Write' });
      } else if (code === 'lw') {
        const k = outputs(prog.rungs, 'OTU').find(([, t]) => t === tag);
        if (k) prog.rungs.splice(k[0], 1);
      } else if (code === 'rr') {
        const k = outputs(prog.rungs, 'RES').find(([, t]) => t === tag);
        if (k) prog.rungs.splice(k[0], 1);
      } else if (code === 'zp') {
        const t = prog.tags.find((x) => x.n === tag); if (t) t.pre = 0;
      } else if (code === 'ur') {
        prog.tags.push({ n: asset + '_Commissioning_Mode', dt: 'BOOL', pre: null, acc: 'None' });
        prog.rungs.push({ c: 'Commissioning test output, left in the program', t: 'XIC(' + asset + '_Commissioning_Mode)OTE(' + asset + '_Test_Output);' });
        prog.tags.push({ n: asset + '_Test_Output', dt: 'BOOL', pre: null, acc: 'Read/Write' });
      } else if (code === 'ut') {
        prog.tags.push({ n: asset + '_Legacy_Spare', dt: 'BOOL', pre: null, acc: 'None' });
      }
      prog.planted.push({ rule: RULE_NAMES[code], tag: code === 'ur' ? asset + '_Commissioning_Mode' : code === 'ut' ? asset + '_Legacy_Spare' : tag, detail: DETAILS[code] });
    });
    // ── standard automation & diagnostics wrapper ──
    // Every real controller carries housekeeping the bare archetype omits:
    // runtime metering, maintenance scheduling, auto/manual mode, HMI status
    // and alarm annunciation. Appended so each program reads like something an
    // engineer would actually ship, not a three-rung fragment. Every output
    // here is a NEW tag derived from the program's own primary output, so
    // nothing creates a dual coil, strands a latch, or collides with a planted
    // defect — the analyser still sees exactly the faults the answer key lists.
    const _outs = outputs(prog.rungs, 'OTE').concat(outputs(prog.rungs, 'OTL'));
    const PRIMARY = (_outs[0] && _outs[0][1]) || (asset + '_Run');
    const _a = asset, P = PRIMARY;
    [
      // ── safety permissives & interlocks ──
      ['Run permissive: guards closed, E-stop clear, no active alarm', 'XIC(' + _a + '_Guards_Closed)XIC(' + _a + '_Estop_Clear)XIO(' + _a + '_Alarm_Active)OTE(' + _a + '_Permit_To_Run);'],
      ['Latch a safety trip if a guard opens while running', 'XIC(' + P + ')XIO(' + _a + '_Guards_Closed)OTL(' + _a + '_Safety_Trip);'],
      ['Clear the safety trip only once guards are restored and reset is pressed', 'XIC(' + _a + '_Guards_Closed)XIC(' + _a + '_Reset_PB)OTU(' + _a + '_Safety_Trip);'],
      // ── device feedback & diagnostics ──
      ['Watchdog: the device should confirm running within the window', 'XIC(' + P + ')XIO(' + _a + '_Run_Feedback)TON(' + _a + '_Feedback_TMR,?,?);'],
      ['Feedback fault if the drive never proves it started', 'XIC(' + _a + '_Feedback_TMR.DN)OTL(' + _a + '_Feedback_Fault);'],
      ['Clear the feedback fault on operator reset', 'XIC(' + _a + '_Reset_PB)OTU(' + _a + '_Feedback_Fault);'],
      ['Network heartbeat missing starts the comms timeout', 'XIO(' + _a + '_Comms_Heartbeat)TON(' + _a + '_Comms_TMR,?,?);'],
      ['Communications fault after the heartbeat timeout expires', 'XIC(' + _a + '_Comms_TMR.DN)OTE(' + _a + '_Comms_Fault);'],
      // ── runtime & production data ──
      ['Accumulate running hours for maintenance scheduling', 'XIC(' + P + ')RTO(' + _a + '_Runtime_Hrs,?,?);'],
      ['Flag maintenance due once the runtime setpoint is reached', 'XIC(' + _a + '_Runtime_Hrs.DN)OTE(' + _a + '_Maint_Due);'],
      ['Reset the runtime meter when service is acknowledged', 'XIC(' + _a + '_Maint_Ack)RES(' + _a + '_Runtime_Hrs);'],
      ['Count completed cycles for production tracking', 'XIC(' + _a + '_Cycle_Complete)ONS(' + _a + '_Cycle_OS)CTU(' + _a + '_Prod_Count,?,?);'],
      ['Reset the production counter at shift change', 'XIC(' + _a + '_Shift_Reset)RES(' + _a + '_Prod_Count);'],
      // ── alarm annunciation ──
      ['Roll every trip and fault into one alarm summary', '[XIC(' + _a + '_Safety_Trip),XIC(' + _a + '_Feedback_Fault),XIC(' + _a + '_Comms_Fault),XIC(' + _a + '_Maint_Due)]OTE(' + _a + '_Alarm_Active);'],
      ['Sound the horn until the operator acknowledges the alarm', 'XIC(' + _a + '_Alarm_Active)XIO(' + _a + '_Alarm_Ack)OTE(' + _a + '_Alarm_Horn);'],
      // ── mode control & HMI status ──
      ['Auto mode unless the local station selects manual or maintenance', 'XIO(' + _a + '_Local_Manual)XIO(' + _a + '_Maint_Mode)OTE(' + _a + '_Auto_Mode);'],
      ['Mirror the running state to the HMI', 'XIC(' + P + ')OTE(' + _a + '_HMI_Running);'],
      ['Idle indicator when the equipment is in auto and stopped', 'XIO(' + P + ')XIC(' + _a + '_Auto_Mode)OTE(' + _a + '_HMI_Idle);'],
    ].forEach(([c, t]) => prog.rungs.push({ c, t }));
    [
      ['Guards_Closed', 'BOOL', null], ['Estop_Clear', 'BOOL', null], ['Permit_To_Run', 'BOOL', null],
      ['Safety_Trip', 'BOOL', null], ['Reset_PB', 'BOOL', null], ['Run_Feedback', 'BOOL', null],
      ['Feedback_TMR', 'TIMER', 5000], ['Feedback_Fault', 'BOOL', null], ['Comms_Heartbeat', 'BOOL', null],
      ['Comms_TMR', 'TIMER', 3000], ['Comms_Fault', 'BOOL', null], ['Runtime_Hrs', 'TIMER', 86400000],
      ['Maint_Due', 'BOOL', null], ['Maint_Ack', 'BOOL', null], ['Cycle_Complete', 'BOOL', null],
      ['Cycle_OS', 'BOOL', null], ['Prod_Count', 'COUNTER', 1000000], ['Shift_Reset', 'BOOL', null],
      ['Alarm_Active', 'BOOL', null], ['Alarm_Ack', 'BOOL', null], ['Alarm_Horn', 'BOOL', null],
      ['Local_Manual', 'BOOL', null], ['Maint_Mode', 'BOOL', null], ['Auto_Mode', 'BOOL', null],
      ['HMI_Running', 'BOOL', null], ['HMI_Idle', 'BOOL', null],
    ].forEach(([suf, dt, pre]) => prog.tags.push({ n: _a + '_' + suf, dt: dt, pre: pre, acc: 'Read/Write' }));

    // orphan labeling — a removal that strands a tag is a second TRUE defect (generator._label_orphans)
    const referenced = new Set();
    prog.rungs.forEach((r) => { let m; const re = /\(([^)]*)\)/g; while (m = re.exec(r.t)) m[1].split(',').forEach((p) => referenced.add(baseTag(p))); });
    const already = new Set(prog.planted.filter((p) => p.rule === 'unused-tag').map((p) => p.tag));
    prog.tags.forEach((t) => {
      if (referenced.has(t.n) || already.has(t.n)) return;
      prog.planted.push({ rule: 'unused-tag', tag: t.n, detail: 'orphaned when the rung that referenced it was removed' });
    });
    return prog;
  }

  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const TIMER_MEMBERS = ['ACC', 'EN', 'TT', 'DN'], COUNTER_MEMBERS = ['ACC', 'CU', 'CD', 'DN', 'OV', 'UN'];
  function tagXml(t) {
    const head = '<Tag Name="' + xmlEsc(t.n) + '" TagType="Base" DataType="' + xmlEsc(t.dt) + '" Constant="false" ExternalAccess="' + xmlEsc(t.acc) + '"';
    if (t.dt !== 'TIMER' && t.dt !== 'COUNTER') return head + '/>';
    const members = t.dt === 'TIMER' ? TIMER_MEMBERS : COUNTER_MEMBERS;
    const rows = ['<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="' + (t.pre || 0) + '"/>'].
    concat(members.map((m) => m === 'ACC' ?
    '<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="' + (t.acc2 || 0) + '"/>' :
    '<DataValueMember Name="' + m + '" DataType="BOOL" Value="0"/>'));
    return head + '>\n<Data Format="Decorated">\n<Structure DataType="' + t.dt + '">\n' + rows.join('\n') + '\n</Structure>\n</Data>\n</Tag>';
  }
  function toL5X(prog) {
    const tags = prog.tags.map(tagXml).join('\n');
    const rungs = prog.rungs.map((r, i) => '<Rung Number="' + i + '" Type="N">\n<Comment><![CDATA[' + r.c + ']]></Comment>\n<Text><![CDATA[' + r.t + ']]></Text>\n</Rung>').join('\n');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.00" TargetName="' + xmlEsc(prog.controller) + '" TargetType="Controller" ContainsContext="false" ExportOptions="References NoRawData">\n<Controller Use="Target" Name="' + xmlEsc(prog.controller) + '" ProcessorType="1756-L83E" MajorRev="32" MinorRev="11">\n<Tags>\n' + tags + '\n</Tags>\n<Programs>\n<Program Name="MainProgram" TestEdits="false" MainRoutineName="' + xmlEsc(prog.routine) + '" Disabled="false" UseAsFolder="false">\n<Tags/>\n<Routines>\n<Routine Name="' + xmlEsc(prog.routine) + '" Type="RLL">\n<RLLContent>\n' + rungs + '\n</RLLContent>\n</Routine>\n</Routines>\n</Program>\n</Programs>\n</Controller>\n</RSLogix5000Content>\n';
  }

  const list = []; for (let i = 0; i < 300; i++) list.push(buildProgram(i));
  const byClass = {}; list.forEach((p) => { (byClass[p.cls] = byClass[p.cls] || []).push(p); });
  window.LADDER_CORPUS = { list, byClass, ARCHETYPES, BY_ID, FLEET, toL5X };
})();

;
// ═══ IndustrialKit.jsx ═══
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
  return sev === 'crit' ? cl - (cl - a.min) * 0.55 : wl - (wl - cl != null ? (wl - cl) * 0.45 : (wl - a.min) * 0.3);
}
function rw(v, vol, min, max) {  let n = v + (Math.random() - 0.5) * vol;
  if (n < min) n = min + Math.random() * vol;
  if (n > max) n = max - Math.random() * vol;
  return n;
}
const SEV_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)' };

// ── Sparkline (SVG path) ────────────────────────────────────────────────────────
function Spark({ series, w = 56, h = 18, color, min, max, strokeW = 1.4, dot = true, glow = false }) {
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
    <svg width={w} height={h} className="t-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: 'visible', filter: glow ? `drop-shadow(0 0 3px color-mix(in srgb, ${c} 60%, transparent))` : 'none' }}>
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
const HeatCell = React.memo(function HeatCell({ a, selected, onSelect, ring, dim, onHover, onCtx }) {
  const st = statusOf(a);
  let delayStyle;
  if (st === 'crit') {
    let h = 0; for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) | 0;
    delayStyle = { '--fdelay': '-' + ((Math.abs(h) % 1000) / 1000 * 2.2).toFixed(2) + 's' };
  }
  return (
    <div className={`hm-cell ${st === 'warn' ? 'hm-warn' : st === 'crit' ? 'hm-crit' : ''} ${selected ? 'hm-sel' : ''} ${ring ? 'hm-g' + Math.min(ring, 3) : ''} ${dim ? 'hm-dimfx' : ''}`} style={delayStyle} title={onHover ? undefined : `${a.name} · ${a.label} ${a.val.toFixed(a.dec || 1)}${a.unit}`} onClick={() => onSelect(a.id)} onMouseEnter={onHover ? (e) => onHover(a.id, e.currentTarget.getBoundingClientRect()) : undefined} onMouseLeave={onHover ? () => onHover(null) : undefined} onContextMenu={onCtx ? (e) => { e.preventDefault(); onCtx(a.id); } : undefined} />);

});

// ── Hands-on alarm limits — trend chart with draggable warn/crit lines ──────────
// Drag a dashed line and release: the sensor's live thresholds change and the whole
// system (wall colors, queues, health) re-evaluates. First touch snapshots the
// original value as the "NEPHES recommended" baseline so the user can always revert.
function LimitChart({ a, onCommit }) {
  const W = 300, H = 96, PAD = 7;
  const lo = a.min, hi = a.max, range = hi - lo || 1;
  const yOf = (v) => H - PAD - (Math.max(lo, Math.min(hi, v)) - lo) / range * (H - PAD * 2);
  const vOf = (y) => lo + (1 - (Math.max(PAD, Math.min(H - PAD, y)) - PAD) / (H - PAD * 2)) * range;
  const svgRef = React.useRef(null);
  const [drag, setDrag] = React.useState(null); // { field, v }
  const dec = a.dec != null ? a.dec : 1;
  const eps = range * 0.02;
  const clampFor = (field, v) => {
    let mn = lo, mx = hi;
    if (field === 'warnHi' && a.critHi != null) mx = a.critHi - eps;
    if (field === 'critHi' && a.warnHi != null) mn = a.warnHi + eps;
    if (field === 'warnLo') { if (a.critLo != null) mn = a.critLo + eps; if (a.warnHi != null) mx = Math.min(mx, a.warnHi - eps); }
    if (field === 'critLo' && a.warnLo != null) mx = a.warnLo - eps;
    return Math.max(mn, Math.min(mx, v));
  };
  const startDrag = (field) => (e) => {
    e.preventDefault();
    if (e.currentTarget.setPointerCapture) try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    setDrag({ field, v: a[field] });
  };
  const onMove = (e) => {
    if (!drag || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height * H;
    setDrag((d) => d ? { ...d, v: clampFor(d.field, vOf(y)) } : d);
  };
  const onUp = () => {
    if (!drag) return;
    const patch = { [drag.field]: +drag.v.toFixed(dec) };
    const recKey = 'rec' + drag.field.charAt(0).toUpperCase() + drag.field.slice(1);
    if (a[recKey] == null) patch[recKey] = a[drag.field];
    onCommit && onCommit(patch);
    setDrag(null);
  };
  const pts = a.series.map((v, i) => `${(i / (a.series.length - 1) * W).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const st = statusOf(a);
  const limits = [['critHi', 'crit'], ['warnHi', 'warn'], ['warnLo', 'warn'], ['critLo', 'crit']].filter(([f]) => a[f] != null);
  const colorOf = (kind) => kind === 'crit' ? 'var(--crit)' : 'var(--warn)';
  return (
    <svg ref={svgRef} className="limit-chart" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} style={{ touchAction: 'none', display: 'block' }}>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={PAD + (H - PAD * 2) * f} y2={PAD + (H - PAD * 2) * f} stroke="rgba(255,255,255,.05)" strokeWidth="1" />)}
      <polyline points={pts} fill="none" stroke={SEV_COLOR[st]} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {limits.map(([f, kind]) => {
        const v = drag && drag.field === f ? drag.v : a[f];
        const y = yOf(v);
        const c = colorOf(kind);
        const active = drag && drag.field === f;
        return (
          <g key={f}>
            <line x1="0" x2={W} y1={y} y2={y} stroke={c} strokeWidth={active ? 1.8 : 1.1} strokeDasharray="6 4" opacity={active ? 1 : 0.8} />
            <text x="5" y={y + 2.5} fontSize="7.5" fill={c} opacity=".95" pointerEvents="none">⇕</text>
            <text x={W - 4} y={f.slice(-2) === 'Lo' ? y + 11 : y - 4.5} textAnchor="end" fontSize="8.5" fontFamily="var(--mono, monospace)" fontWeight="700" fill={c} pointerEvents="none">{(f.indexOf('warn') === 0 ? 'warn ' : 'crit ') + (+v).toFixed(dec)}</text>
            <rect x="0" y={y - 8} width={W} height="16" fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={startDrag(f)} />
          </g>);
      })}
    </svg>);

}

// ── KPI card ──────────────────────────────────────────────────────────────────────
function KpiCard({ label, value, unit, series, trend, onClick }) {
  const tr = trend || { dir: 'flat', txt: '' };
  const arrow = tr.dir === 'up' ? '▲' : tr.dir === 'down' ? '▼' : '→';
  const sparkColor = tr.dir === 'up' ? 'var(--ok)' : tr.dir === 'down' ? 'var(--crit)' : 'var(--text-4)';
  return (
    <div className={onClick ? 'kpi clk' : 'kpi'} onClick={onClick}>
      <div className="k-label">{label}</div>
      <span className="k-value">{value}</span>{unit && <span className="k-unit">{unit}</span>}
      <div className="k-bottom">
        <Spark series={series} w={68} h={20} color={sparkColor} strokeW={2.2} dot={false} />
        <span className={`k-trend ${tr.dir}`}>{arrow} {tr.txt}</span>
      </div>
    </div>
  );
}

// ── Recommendation card ─────────────────────────────────────────────────────────
function RecCard({ asset, sev, conf, msg, onAct, auto, mitigating, onMitigate, progress, resolved }) {
  const cls = sev === 'crit' || sev === 'critical' ? 'crit' : sev === 'warn' || sev === 'warning' ? 'warn' : '';
  const busy = auto || mitigating;
  const primaryLabel = cls === 'crit' ? 'Start Mitigation' : 'Dispatch Technician';
  return (
    <div className={`rec ${resolved ? 'rec-done' : ''}`}>
      <div className="r-top">
        <span className="r-asset">{asset}</span>
        <span className={`r-sev ${resolved ? 'done' : cls}`}>{resolved ? 'resolved' : sev}</span>
        {!resolved && <span className="r-conf">{Math.round(conf * 100)}%</span>}
      </div>
      {!resolved && <div className="conf-bar-wrap"><div className={`conf-bar ${cls}`} style={{ width: `${Math.round(conf * 100)}%` }} /></div>}
      <div className="r-msg">{msg}</div>
      <div className="r-cta-row">
        {resolved ?
        <button className="r-primary done" disabled>✓ Resolved</button> :
        busy ?
        <button className="r-primary auto" disabled>◉ {auto ? 'Auto-mitigating' : progress == null ? 'Dispatching' : 'Mitigating'}{progress != null ? ` · ${Math.round(progress * 100)}%` : '…'}</button> :
        <button className={`r-primary ${cls}`} onClick={() => onMitigate && onMitigate()}>{primaryLabel}</button>}
        {!resolved && onAct && <button className="r-secondary" onClick={onAct}>View Financial Impact Details</button>}
      </div>
    </div>);

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

// ── ⌘K command palette — find any sensor or action from anywhere ─────────────
function CommandPalette({ open, onClose, sensors, actions, onPick }) {
  const [q, setQ] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const inRef = React.useRef(null);
  React.useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inRef.current && inRef.current.focus(), 30); } }, [open]);
  if (!open) return null;
  const ql = q.trim().toLowerCase();
  const sHits = ql ? sensors.filter((s) => (s.name + ' ' + s.group + ' ' + s.label).toLowerCase().includes(ql)).slice(0, 8) : sensors.slice(0, 5);
  const aHits = actions.filter((a) => !ql || a.label.toLowerCase().includes(ql)).slice(0, 6);
  const items = [...aHits.map((a) => ({ kind: 'action', ...a })), ...sHits.map((s) => ({ kind: 'sensor', label: s.name, sub: s.group + ' · ' + s.label, id: s.id, st: statusOf(s) }))];
  const go = (it) => { onPick(it); onClose(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[idx]) go(items[idx]); }
    else if (e.key === 'Escape') { onClose(); }
  };
  return (
    <div className="cmdk-scrim" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={inRef} className="ck-input" placeholder="Search sensors, zones, actions…" value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} />
        <div className="ck-list">
          {items.length === 0 && <div className="ck-empty">No matches.</div>}
          {items.map((it, i) =>
          <button key={(it.kind === 'sensor' ? 's' : 'a') + (it.id || it.label)} className={`ck-item ${i === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => go(it)}>
              {it.kind === 'sensor' ? <span className={`ck-dot ${it.st}`} /> : <span className="ck-ic">{it.ic || '⚡'}</span>}
              <span className="ck-main"><span className="ck-l">{it.label}</span>{it.sub && <span className="ck-s">{it.sub}</span>}</span>
              <span className="ck-kind">{it.kind}</span>
            </button>)}
        </div>
        <div className="ck-foot">↑↓ navigate · Enter select · Esc close</div>
      </div>
    </div>);

}

// ── Live engines ─────────────────────────────────────────────────────────────────
function useAssets(seed, { live = true, speed = 1, volatility = 1, autoMit = false, faultsRef, mitRef, patchRef } = {}) {
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
          // per-device manual mitigation — staged: dispatch (~6s, no effect) → ramp → gradual correction
          const el = mit[a.id] > 1 ? Date.now() - mit[a.id] : 999999;
          const pull = el < 6000 ? 0.015 : el < 15000 ? 0.045 : 0.085;
          nv = a.val + (safeTarget(a) - a.val) * pull + (Math.random() - 0.5) * a.vol * 0.5;
        } else if (autoMit && !faultSev) {
          if (statusOf(a) !== 'ok') nv = a.val + (safeTarget(a) - a.val) * (0.05 + Math.random() * 0.04) + (Math.random() - 0.5) * a.vol * 0.5;
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
  // expose a targeted updater so the host can patch a sensor's fields (e.g. alarm limits)
  if (patchRef) patchRef.current = (id, patch) => setAssets((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
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

Object.assign(window, { fmt, clk, statusOf, rw, safeTarget, faultTarget, SEV_COLOR, Spark, SensorTile, HeatCell, KpiCard, RecCard, EventRow, HealthRing, LimitChart, CommandPalette, useAssets, useFactoryStream, trendOf });

;
// ═══ Datasheets.jsx ═══
// Datasheets.jsx — Datasheet Library UI for the NFO datasheet→AssetProfile pipeline.
// Faithful JS port of core/datasheets/spec_extractor.py + profile_schema.py so parsing
// genuinely runs on sample datasheet text. Exports DatasheetLibrary to window.

// ── extractor port (core/datasheets/spec_extractor.py) ────────────────────────
const DEVICE_HINTS = {
  temperature: ['temperature', 'temp', 'thermocouple', 'rtd', 'ds18b20'],
  photoeye: ['photoelectric', 'photo eye', 'photocell', 'case detection', 'presence sensor'],
  proximity: ['proximity', 'inductive', 'capacitive'],
  vibration: ['vibration', 'accelerometer', 'rms', 'velocity'],
  current: ['current sensor', 'amp', 'amperage', 'current transducer'],
  pressure: ['pressure', 'psi', 'bar', 'kpa'],
  motor: ['motor', 'drive', 'vfd', 'servo'],
  plc: ['plc', 'controller', 'i/o module', 'input module', 'output module'],
};
const PROTOCOL_HINTS = {
  modbus: ['modbus', 'modbus tcp', 'modbus rtu'],
  opcua: ['opc ua', 'opc-ua', 'opc unified'],
  ethernet_ip: ['ethernet/ip', 'ethernet ip', 'cip'],
  one_wire: ['1-wire', 'onewire', 'one-wire'],
  i2c: ['i2c', 'i²c'],
  spi: ['spi'],
  analog: ['4-20ma', '0-10v', 'analog'],
  discrete: ['npn', 'pnp', 'discrete', 'digital output', 'digital input'],
};
const FAILURE_PATTERNS = ['no response', 'open circuit', 'short circuit', 'over range', 'under range', 'fault', 'alarm', 'error', 'timeout', 'crc', 'failed', 'disconnect', 'loss of signal', 'stuck on', 'stuck off', 'blocked lens'];
const MAINT_PATTERNS = ['calibration', 'clean', 'inspect', 'replace', 'maintenance', 'service interval', 'lubrication'];
const WIRING_PATTERNS = ['wiring', 'pinout', 'terminal', 'brown', 'blue', 'black', 'white', 'shield', 'supply voltage', 'vdc', 'vac'];
const MANUFACTURERS = ['banner', 'allen-bradley', 'rockwell', 'siemens', 'omron', 'keyence', 'ifm', 'pepperl', 'fuchs', 'turck', 'sick', 'balluff', 'schneider', 'yaskawa', 'mitsubishi', 'abb', 'honeywell', 'omega', 'maxim'];

function sha1ish(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return Math.abs(h).toString(16).padStart(10, '0').slice(0, 10).toUpperCase(); }
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function findModel(text) {
  const pats = [/\bmodel[:\s]+([A-Z0-9][A-Z0-9\-_./]{2,})/i, /\bpart\s*(?:no\.?|number)?[:\s]+([A-Z0-9][A-Z0-9\-_./]{2,})/i, /\btype[:\s]+([A-Z0-9][A-Z0-9\-_./]{2,})/i];
  for (const p of pats) { const m = text.match(p); if (m) return m[1].trim(); }
  return 'unknown';
}
function findManufacturer(text, src) {
  const low = text.toLowerCase();
  for (const n of MANUFACTURERS) if (low.includes(n)) return titleCase(n);
  const stem = (src || '').replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  return stem ? titleCase(stem.split(' ')[0]) : 'unknown';
}
function findDeviceType(text) {
  const low = text.toLowerCase();
  let best = 'unknown', bestScore = 0;
  for (const k in DEVICE_HINTS) { const s = DEVICE_HINTS[k].reduce((a, h) => a + (low.includes(h) ? 1 : 0), 0); if (s > bestScore) { bestScore = s; best = k; } }
  return bestScore > 0 ? best : 'unknown';
}
function findProtocol(text) {
  const low = text.toLowerCase();
  for (const p in PROTOCOL_HINTS) if (PROTOCOL_HINTS[p].some((h) => low.includes(h))) return p;
  return 'unknown';
}
function findOutputType(text) {
  const low = text.toLowerCase();
  if (low.includes('pnp') && low.includes('npn')) return 'PNP/NPN';
  if (low.includes('pnp')) return 'PNP';
  if (low.includes('npn')) return 'NPN';
  if (low.includes('relay')) return 'relay';
  if (low.includes('4-20ma')) return '4-20mA';
  if (low.includes('0-10v')) return '0-10V';
  if (low.includes('discrete') || low.includes('digital output')) return 'discrete';
  return 'unknown';
}
function extractSupply(text) {
  const pats = [/(?:supply voltage|operating voltage|power supply)[^\n]{0,80}?(-?\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(-?\d+(?:\.\d+)?)\s*(VDC|VAC|V)/i, /(-?\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(-?\d+(?:\.\d+)?)\s*(VDC|VAC)/i];
  for (const p of pats) { const m = text.match(p); if (m) return { min: +m[1], max: +m[2], unit: m[3].toUpperCase(), ev: [m[0].trim()] }; }
  return { min: null, max: null, unit: 'unknown', ev: [] };
}
function extractRange(text, dt) {
  const byType = {
    temperature: [[/(-?\d+(?:\.\d+)?)\s*(?:°\s*C|degC|C)\s*(?:to|-|–)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*C|degC|C)/i, 'C']],
    pressure: [[/(-?\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(-?\d+(?:\.\d+)?)\s*(psi|PSI)/i, 'psi'], [/(-?\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(-?\d+(?:\.\d+)?)\s*(bar|BAR)/i, 'bar']],
    current: [[/(-?\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(-?\d+(?:\.\d+)?)\s*(mA|ma)/i, 'mA'], [/(-?\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(-?\d+(?:\.\d+)?)\s*(A|amp|amps)/i, 'A']],
    vibration: [[/(-?\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(-?\d+(?:\.\d+)?)\s*(g|G|mm\/s|in\/s)/i, 'vibration']],
  };
  for (const [pat, unit] of byType[dt] || []) { const m = text.match(pat); if (m) return { min: +m[1], max: +m[2], unit, ev: [m[0].trim()] }; }
  return { min: null, max: null, unit: 'unknown', ev: [] };
}
function collectLines(text, terms, max = 12) {
  const out = [];
  for (const raw of text.split('\n')) {
    const clean = raw.trim().split(/\s+/).join(' ');
    if (!clean) continue;
    const low = clean.toLowerCase();
    if (terms.some((t) => low.includes(t))) out.push(clean.slice(0, 300));
    if (out.length >= max) break;
  }
  return out;
}
const TAGS_BY_TYPE = { temperature: ['temp_c', 'state'], photoeye: ['state', 'case_present'], proximity: ['state', 'presence'], vibration: ['vib_rms_g', 'state'], current: ['current_a', 'state'], pressure: ['pressure_psi', 'state'], motor: ['current_a', 'rpm', 'temp_c', 'state'], plc: ['state'] };

function extractProfile(text, src) {
  const dt = findDeviceType(text);
  const protocol = findProtocol(text);
  const output = findOutputType(text);
  const r = extractRange(text, dt);
  const sv = extractSupply(text);
  const failure = collectLines(text, FAILURE_PATTERNS);
  const maint = collectLines(text, MAINT_PATTERNS);
  const wiring = collectLines(text, WIRING_PATTERNS);
  let c = 0.35;
  if (dt !== 'unknown') c += 0.15;
  if (protocol !== 'unknown') c += 0.10;
  if (output !== 'unknown') c += 0.05;
  if (r.min != null && r.max != null) c += 0.15;
  if (sv.min != null && sv.max != null) c += 0.10;
  if (failure.length) c += 0.10;
  if (wiring.length) c += 0.05;
  c = Math.max(0.1, Math.min(0.95, c));
  return {
    profile_id: 'DS-' + sha1ish(src), source_file: src,
    manufacturer: findManufacturer(text, src), model: findModel(text), device_type: dt, protocol,
    measured_unit: r.unit, measured_min: r.min, measured_max: r.max,
    supply_voltage_unit: sv.unit, supply_voltage_min: sv.min, supply_voltage_max: sv.max,
    output_type: output, tags: TAGS_BY_TYPE[dt] || ['state'],
    failure_signals: failure, maintenance_notes: maint, wiring_notes: wiring,
    evidence: r.ev.concat(sv.ev), confidence: c,
    created_at: new Date().toISOString(),
  };
}

// ── sample datasheets (realistic raw text the extractor parses) ───────────────
const SAMPLE_DATASHEETS = [
  { file: 'banner_QS18_photoeye.pdf', text: `BANNER ENGINEERING — QS18 Series Photoelectric Sensor
Model: QS18VP6LP   Type: Diffuse Photoelectric / Presence Sensor (case detection)
Supply voltage: 10 to 30 VDC. Output: PNP and NPN selectable, discrete digital output.
Communication: discrete / IO-Link. Response time 1.5 ms.
Wiring: brown +Vdc, blue 0V, black output, white secondary. Shield to ground.
Maintenance: clean lens every service interval; inspect alignment monthly.
Diagnostics: blocked lens fault, loss of signal alarm, short circuit protection, stuck on detection.` },
  { file: 'ifm_PN7094_pressure.pdf', text: `ifm electronic — PN7 Series Pressure Sensor
Part number: PN7094   Pressure transmitter with display.
Measuring range: 0 to 150 psi. Protocol: IO-Link / 4-20mA analog output.
Power supply 18 to 32 VDC. Output 4-20mA.
Wiring: terminal 1 brown supply voltage, terminal 3 blue, terminal 4 black analog.
Maintenance: calibration recommended every 12 months; replace seal on service.
Faults: over range, under range, open circuit, sensor error, timeout on comms.` },
  { file: 'AB_1734_temp_module.pdf', text: `Allen-Bradley / Rockwell — 1734-IT2I Thermocouple Input Module
Model: 1734-IT2I   Type: temperature input module (thermocouple / RTD)
Range: -270 to 1820 C. Communication: EtherNet/IP (CIP). PLC I/O module.
Operating voltage: 18 to 30 VDC.
Wiring: terminal block, shield, pinout per controller manual.
Diagnostics: open circuit detection, over range, under range, CRC error, no response timeout.
Maintenance: inspect terminals; calibration interval 24 months.` },
  { file: 'skf_CMSS_vibration.pdf', text: `SKF — CMSS Series Accelerometer (vibration)
Model: CMSS2200   Industrial accelerometer, RMS velocity output.
Range: 0 to 50 mm/s. Output: 4-20mA analog. Supply voltage 12 to 24 VDC.
Wiring: brown supply, blue common, shield grounded at one end.
Failure modes: loss of signal, open circuit, over range, bearing fault alarm.
Maintenance: inspect mounting torque; clean surface; replace cable if damaged.` },
  { file: 'generic_unlabeled_sensor.txt', text: `Sensor module. Connect power and read output. See manual for details.
Two wires. Mount near equipment.` },
];

// ── UI ────────────────────────────────────────────────────────────────────────
const DEVICE_ICON = { temperature: '🌡', photoeye: '👁', proximity: '🧲', vibration: '〰', current: '⚡', pressure: '🎚', motor: '⚙', plc: '🖧', unknown: '❔' };

function confColor(c) { return c >= 0.75 ? 'var(--ok)' : c >= 0.5 ? 'var(--accent)' : 'var(--crit)'; }

function ProfileRow({ p, active, onClick }) {
  return (
    <button className={`ds-row ${active ? 'on' : ''}`} onClick={onClick}>
      <span className="ds-ico">{DEVICE_ICON[p.device_type] || '❔'}</span>
      <span className="ds-row-main">
        <span className="ds-row-model">{p.profile_id}</span>
        <span className="ds-row-sub">{p.device_type}{p.model !== 'unknown' ? ' · ' + p.model : ''}</span>
      </span>
      <span className="ds-row-conf" style={{ color: confColor(p.confidence) }}>{Math.round(p.confidence * 100)}%</span>
    </button>
  );
}

const DEVICE_TYPES = ['temperature', 'photoeye', 'proximity', 'vibration', 'current', 'pressure', 'motor', 'plc', 'unknown'];

function EditField({ k, value, onChange, accent, options }) {
  return (
    <div className="ds-field ds-field-edit">
      <span className="ds-fk">{k}</span>
      {options ?
        <select className="ds-fv-in" value={value} onChange={(e) => onChange(e.target.value)} style={accent ? { color: 'var(--accent)' } : null}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select> :
        <input className="ds-fv-in" value={value == null ? '' : value} onChange={(e) => onChange(e.target.value)} style={accent ? { color: 'var(--accent)' } : null} />}
    </div>
  );
}

function NumIn({ value, onChange, ph }) {
  return <input className="ds-num-in" type="number" value={value == null ? '' : value} placeholder={ph} onChange={(e) => onChange(e.target.value === '' ? null : +e.target.value)} />;
}

function ProfileDetail({ p, assets, onMatch, onEdit }) {
  if (!p) return <div className="ds-empty-detail">Select a profile, parse a datasheet, or add a new device.</div>;
  const e = onEdit || (() => {});
  return (
    <div className="ds-detail">
      <div className="ds-detail-head">
        <span className="ds-ico-lg">{DEVICE_ICON[p.device_type] || '❔'}</span>
        <div className="ds-detail-id">
          <div className="ds-detail-namerow">
            <input className="ds-name-in mdl" value={p.profile_id} placeholder="Device ID" onChange={(ev) => e({ profile_id: ev.target.value })} />
          </div>
          <div className="ds-detail-src">{p.source_file}</div>
        </div>
        <div className="ds-conf-badge" style={{ borderColor: confColor(p.confidence), color: confColor(p.confidence) }}>
          {Math.round(p.confidence * 100)}%<small>confidence</small>
        </div>
      </div>
      <div className="ds-conf-track"><div className="ds-conf-fill" style={{ width: `${Math.round(p.confidence * 100)}%`, background: confColor(p.confidence) }} /></div>
      <div className="ds-edit-hint">✎ Every field is editable — refine the extracted spec or type in a new device.</div>

      <div className="ds-sec-label">Identity</div>
      <div className="ds-grid">
        <EditField k="Device type" value={p.device_type} onChange={(v) => e({ device_type: v })} accent options={DEVICE_TYPES} />
        <EditField k="Protocol" value={p.protocol} onChange={(v) => e({ protocol: v })} />
        <EditField k="Output" value={p.output_type} onChange={(v) => e({ output_type: v })} />
        <EditField k="Model" value={p.model} onChange={(v) => e({ model: v })} />
      </div>

      <div className="ds-sec-label">Operating envelope</div>
      <div className="ds-env">
        <div className="ds-env-row">
          <span className="ds-env-l">Measured range</span>
          <NumIn value={p.measured_min} ph="min" onChange={(v) => e({ measured_min: v })} />
          <span className="ds-env-dash">–</span>
          <NumIn value={p.measured_max} ph="max" onChange={(v) => e({ measured_max: v })} />
          <input className="ds-unit-in" value={p.measured_unit === 'unknown' ? '' : p.measured_unit} placeholder="unit" onChange={(ev) => e({ measured_unit: ev.target.value || 'unknown' })} />
        </div>
        <div className="ds-env-row">
          <span className="ds-env-l">Supply voltage</span>
          <NumIn value={p.supply_voltage_min} ph="min" onChange={(v) => e({ supply_voltage_min: v })} />
          <span className="ds-env-dash">–</span>
          <NumIn value={p.supply_voltage_max} ph="max" onChange={(v) => e({ supply_voltage_max: v })} />
          <input className="ds-unit-in" value={p.supply_voltage_unit === 'unknown' ? '' : p.supply_voltage_unit} placeholder="unit" onChange={(ev) => e({ supply_voltage_unit: ev.target.value || 'unknown' })} />
        </div>
      </div>

      <div className="ds-sec-label">Suggested tags</div>
      <input className="ds-tags-in" value={p.tags.join(', ')} placeholder="comma, separated, tags" onChange={(ev) => e({ tags: ev.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />

      {p.failure_signals.length > 0 && <React.Fragment>
        <div className="ds-sec-label">Failure signals <span className="ds-count">{p.failure_signals.length}</span></div>
        <ul className="ds-list crit">{p.failure_signals.slice(0, 6).map((l, i) => <li key={i}>{l}</li>)}</ul>
      </React.Fragment>}
      {p.maintenance_notes.length > 0 && <React.Fragment>
        <div className="ds-sec-label">Maintenance notes <span className="ds-count">{p.maintenance_notes.length}</span></div>
        <ul className="ds-list">{p.maintenance_notes.slice(0, 5).map((l, i) => <li key={i}>{l}</li>)}</ul>
      </React.Fragment>}
      {p.wiring_notes.length > 0 && <React.Fragment>
        <div className="ds-sec-label">Wiring notes <span className="ds-count">{p.wiring_notes.length}</span></div>
        <ul className="ds-list">{p.wiring_notes.slice(0, 5).map((l, i) => <li key={i}>{l}</li>)}</ul>
      </React.Fragment>}
      {p.evidence.length > 0 && <React.Fragment>
        <div className="ds-sec-label">Evidence</div>
        <div className="ds-evidence">{p.evidence.map((ev, i) => <code key={i}>{ev}</code>)}</div>
      </React.Fragment>}

      <div className="ds-sec-label">Match to asset</div>
      <div className="ds-match-row">
        <select className="ds-match-select" defaultValue="" id="dsMatchSel">
          <option value="" disabled>Select asset…</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.group}</option>)}
        </select>
        <button className="ds-match-btn" onClick={() => { const v = document.getElementById('dsMatchSel').value; if (v) onMatch(p, v); }}>Bind profile</button>
      </div>
    </div>
  );
}

function DatasheetLibrary({ assets, onClose, onBind }) {
  const [profiles, setProfiles] = React.useState(() => SAMPLE_DATASHEETS.slice(0, 4).map((d) => extractProfile(d.text, d.file)));
  const [sel, setSel] = React.useState(() => profiles[0] ? profiles[0].profile_id : null);
  const [parsing, setParsing] = React.useState(false);
  const [matchMsg, setMatchMsg] = React.useState('');
  const fileRef = React.useRef(null);

  const selProfile = profiles.find((p) => p.profile_id === sel) || null;
  const avgConf = profiles.length ? Math.round(profiles.reduce((s, p) => s + p.confidence, 0) / profiles.length * 100) : 0;

  const parseSample = () => {
    setParsing(true);
    const used = new Set(profiles.map((p) => p.source_file));
    const next = SAMPLE_DATASHEETS.find((d) => !used.has(d.file)) || SAMPLE_DATASHEETS[Math.floor(Math.random() * SAMPLE_DATASHEETS.length)];
    setTimeout(() => {
      const prof = extractProfile(next.text, next.file.replace('.pdf', '_' + Math.floor(Math.random() * 900 + 100) + '.pdf'));
      setProfiles((p) => [prof, ...p.filter((x) => x.profile_id !== prof.profile_id)]);
      setSel(prof.profile_id);
      setParsing(false);
    }, 1500);
  };
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setParsing(true);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const prof = extractProfile(text || f.name, f.name);
      setProfiles((p) => [prof, ...p.filter((x) => x.profile_id !== prof.profile_id)]);
      setSel(prof.profile_id);
      setParsing(false);
    };
    reader.onerror = () => { const prof = extractProfile(f.name, f.name); setProfiles((p) => [prof, ...p]); setSel(prof.profile_id); setParsing(false); };
    reader.readAsText(f);
  };
  const doMatch = (p, assetId) => {
    const a = assets.find((x) => x.id === assetId);
    setMatchMsg(`Bound ${p.profile_id} → ${a ? a.name : assetId}`);
    if (onBind) onBind(p, assetId);
    setTimeout(() => setMatchMsg(''), 3200);
  };
  const updateProfile = (id, patch) => { setProfiles((list) => list.map((p) => p.profile_id === id ? { ...p, ...patch } : p)); if (patch.profile_id && patch.profile_id !== id) setSel(patch.profile_id); };
  const newDevice = () => {
    const id = 'DS-NEW' + Math.floor(Math.random() * 9000 + 1000);
    const blank = {
      profile_id: id, source_file: 'manual entry', manufacturer: 'unknown', model: 'unknown',
      device_type: 'unknown', protocol: 'unknown', measured_unit: 'unknown', measured_min: null, measured_max: null,
      supply_voltage_unit: 'unknown', supply_voltage_min: null, supply_voltage_max: null, output_type: 'unknown',
      tags: [], failure_signals: [], maintenance_notes: [], wiring_notes: [], evidence: [], confidence: 0.1,
      created_at: new Date().toISOString(),
    };
    setProfiles((list) => [blank, ...list]);
    setSel(id);
  };

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="ds-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">DATASHEET LIBRARY
          <span className="ds-head-meta">{profiles.length} profiles · avg confidence {avgConf}%</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="ds-body">
          <div className="ds-sidebar">
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv" style={{ display: 'none' }} onChange={onFile} />
            <div className={`ds-drop ${parsing ? 'busy' : ''}`} onClick={() => !parsing && fileRef.current && fileRef.current.click()}>
              {parsing ?
                <React.Fragment><div className="ds-spin" /><div className="ds-drop-t">Extracting profile…</div><div className="ds-drop-s">spec_extractor · parsing spec sheet</div></React.Fragment> :
                <React.Fragment><div className="ds-drop-ic">⤓</div><div className="ds-drop-t">Drop a datasheet to parse</div><div className="ds-drop-s">PDF / TXT — NEPHES extracts an asset profile</div></React.Fragment>}
            </div>
            <button className="ds-sample-btn" disabled={parsing} onClick={parseSample}>⚙ Parse a sample datasheet</button>
            <button className="ds-new-btn" onClick={newDevice}>＋ New device (manual)</button>
            <div className="ds-list-label">Asset profiles</div>
            <div className="ds-rows">
              {profiles.map((p) => <ProfileRow key={p.profile_id} p={p} active={p.profile_id === sel} onClick={() => setSel(p.profile_id)} />)}
            </div>
          </div>
          <div className="ds-detail-pane">
            {matchMsg && <div className="ds-match-msg">✓ {matchMsg}</div>}
            <ProfileDetail p={selProfile} assets={assets} onMatch={doMatch} onEdit={(patch) => selProfile && updateProfile(selProfile.profile_id, patch)} />
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DatasheetLibrary, extractProfile });

;
// ═══ SensorArt.jsx ═══
/* ──────────────────────────────────────────────────────────────────────────
   SensorArt.jsx — generative-art gallery for the Factory Observer Sensor Wall.
   Ported from DeepSkyRobotics/NFO SensorArt.jsx
   (asset paths adapted to this project's flat file layout).

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
    const COL = { ok: cssVar('--ok', '#5fa377'), warn: cssVar('--warn', '#f5b841'), crit: cssVar('--crit', '#e0564f'), accent: cssVar('--accent', '#FF7A18') };
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

;
// ═══ AutoMap.jsx ═══
// AutoMap.jsx — Sensor Wall auto-mapping helpers:
//   A  · parseSensorId — self-placing provisioning (device name → zone + metric + confidence)
//   C4 · computeSensorGroups + GroupLane — NEPHES groups: sensors whose live series co-move
//   D3 · (sort logic lives in SensorWall's ⚡ Auto-Map)
// Loads after IndustrialKit (needs statusOf), before Industrial.jsx.

const ZONE_PREFIX = {
  ROBOT: 'Assembly Line A', ARM: 'Assembly Line A', WELD: 'Assembly Line A', SPINDLE: 'Assembly Line A', SERVO: 'Assembly Line A', ASM: 'Assembly Line A',
  CNV: 'Conveyor System', CONV: 'Conveyor System', BELT: 'Conveyor System', SORT: 'Conveyor System', SORTER: 'Conveyor System',
  HYD: 'Hydraulic Systems', PUMP: 'Hydraulic Systems', FILTER: 'Hydraulic Systems', VALVE: 'Hydraulic Systems', PRESS: 'Hydraulic Systems',
  UTL: 'Utilities', PWR: 'Utilities', MAIN: 'Utilities', COMP: 'Utilities', AIR: 'Utilities', COOLANT: 'Utilities', CHILL: 'Utilities', HVAC: 'Utilities', FLW: 'Utilities' };

const TYPE_CODE = {
  PT: ['Pressure', 'PSI'], TC: ['Temp', '°C'], TEMP: ['Temp', '°C'], VIB: ['Vibration', 'mm/s'],
  FLW: ['Flow', 'L/min'], DRV: ['Speed', 'm/s'], AXIS: ['Load', '%'], LOAD: ['Load', '%'] };

const ZONE_SHORT = { 'Assembly Line A': 'Assembly', 'Conveyor System': 'Conveyor', 'Hydraulic Systems': 'Hydraulics', 'Utilities': 'Utilities' };

function parseSensorId(raw) {
  const name = (raw || '').trim().toUpperCase();
  if (!name) return { zone: null, metric: null, unit: null, conf: 0 };
  const toks = name.split(/[-_\s.]+/).filter(Boolean);
  let zone = null, metric = null, unit = null;
  for (const t of toks) { if (!zone && ZONE_PREFIX[t]) zone = ZONE_PREFIX[t]; }
  for (const t of toks) { if (!metric && TYPE_CODE[t]) { metric = TYPE_CODE[t][0]; unit = TYPE_CODE[t][1]; } }
  let conf = 0;
  if (zone) { conf = 82 + (metric ? 12 : 0) + (toks.length >= 2 ? 2 : 0); }
  return { zone, metric, unit, conf: Math.min(96, conf) };
}

function pearsonR(a, b, k) {
  const n = Math.min(k, a.length, b.length);
  if (n < 6) return 0;
  const as = a.slice(-n), bs = b.slice(-n);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += as[i]; mb += bs[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = as[i] - ma, y = bs[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db);
  return den < 1e-9 ? 0 : num / den;
}

// Real correlation over each sensor's recent series (last 24 samples) against flagged seeds.
// Groups form when sensors genuinely co-move (e.g. a zone fault drags many readings together).
function computeSensorGroups(points, excluded) {
  if (!points || points.length < 20) return [];
  const ex = excluded || new Set();
  const flagged = points.
  filter((p) => statusOf(p) !== 'ok' && !ex.has(p.id) && p.series && p.series.length >= 12).
  sort((a, b) => (statusOf(b) === 'crit' ? 1 : 0) - (statusOf(a) === 'crit' ? 1 : 0));
  const out = [], claimed = new Set(), usedZones = new Set();
  for (const seed of flagged) {
    if (out.length >= 3) break;
    if (claimed.has(seed.id) || usedZones.has(seed.group)) continue;
    const members = [];
    for (const p of points) {
      if (p.id === seed.id || claimed.has(p.id) || !p.series) continue;
      const r = pearsonR(seed.series, p.series, 24);
      if (r > 0.62) members.push({ id: p.id, r, zone: p.group });
    }
    members.sort((a, b) => b.r - a.r);
    const top = members.slice(0, 13);
    if (top.length < 3) continue;
    let rSum = 0;
    top.forEach((m) => { claimed.add(m.id); rSum += m.r; });
    claimed.add(seed.id); usedZones.add(seed.group);
    const zones = new Set([seed.group]); top.forEach((m) => zones.add(m.zone));
    out.push({ id: seed.id, seedName: seed.name, members: [seed.id, ...top.map((m) => m.id)], n: top.length + 1, avgR: rSum / top.length, zones: zones.size });
  }
  return out;
}

// C4 — the Group Tabs lane above the grid (quiet by default: the wall stays clean
// until a group is focused; save/dismiss live on the focused tab)
function GroupLane({ groups, focusGid, setFocusGid, onSave, onDismiss, onRefresh }) {
  return (
    <div className="glane">
      <span className="glane-label">Groups</span>
      {groups.length === 0 && <span className="glane-empty">none yet — groups appear when sensors move together</span>}
      {groups.map((g, i) => {
        const active = focusGid === g.id;
        return (
          <span key={g.id} className="gchip-wrap">
            <button className={`gchip ${active ? 'on' : ''}`} onClick={() => setFocusGid(active ? null : g.id)} title={`${g.n} sensors moving with ${g.seedName}${g.zones > 1 ? ' · spans ' + g.zones + ' areas' : ''} — click to view`}>
              Group {i + 1}<span className="gchip-n">{g.n}</span>
            </button>
            {active &&
            <React.Fragment>
                <button className="gchip-act save" onClick={() => onSave(g)} title="Save as a wall filter">✓ Save</button>
                <button className="gchip-act" onClick={() => onDismiss(g)} title="Dismiss this group">✕</button>
              </React.Fragment>}
          </span>);

      })}
      <button className="glane-refresh" onClick={onRefresh} title="Re-check which sensors move together">⟳</button>
    </div>);

}

Object.assign(window, { parseSensorId, computeSensorGroups, GroupLane, ZONE_SHORT, pearsonR });

;
// ═══ SubNetLab.jsx ═══
/* SubNetLab — what each SubNet says about the program on screen, and whether
 * that expert is worth listening to.
 *
 * Two jobs in one panel, because they answer each other.
 *
 *   READ    Every SubNet's claim and confidence for the current program, each
 *           carrying its audit verdict. An operator reading "a short restart
 *           dwell is present" needs to know in the same glance that the expert
 *           saying it emits that claim for every case ever put to it.
 *
 *   PROBE   Move a value and watch which experts respond. The audit tells you a
 *           SubNet is constant; this is where you see it. Drag vibration from 2
 *           to 25 mm/s and SN-TIMER-003 does not twitch.
 *
 * WHY THE BADGE MATTERS MORE THAN THE CLAIM
 * A confident sentence from a quarantined expert is more dangerous than no
 * sentence at all, because it reads exactly like a useful one. The verdict is
 * therefore rendered at the same weight as the claim, not tucked into a
 * tooltip.
 *
 * Everything here is advisory and read-only. The panel recommends lifecycle
 * changes; it has no path to write one.
 */

/* global React */

const SNL_API = '';                       // same origin as the console
const SNL_DEBOUNCE_MS = 220;

/* The badge is not a label, it is a multiplier. PLCProg's STATUS_FACTOR scales
 * an expert's weight by exactly these numbers, so QUARANTINED means the opinion
 * is silenced outright — worth showing, because "downweighted" reads much
 * softer than halving someone's vote actually is. */
const SNL_VERDICT = {
  ACTIVE:       { cls: 'ok',   label: 'ACTIVE',       w: '1.00', hint: 'full weight — changes the answer' },
  WATCH:        { cls: 'warn', label: 'WATCH',        w: '0.82', hint: 'load-bearing but correlated with another' },
  DOWNWEIGHTED: { cls: 'warn', label: 'DOWNWEIGHTED', w: '0.48', hint: 'removing it changes no recommendation' },
  QUARANTINED:  { cls: 'crit', label: 'QUARANTINED',  w: '0.00', hint: 'silenced — same claim for every case' },
  REVALIDATION: { cls: 'warn', label: 'REVALIDATION', w: '0.25', hint: 'under re-test' },
  RETIRED:      { cls: 'crit', label: 'RETIRED',      w: '0.00', hint: 'removed from routing' },
};

/* What each SubNet is actually looking at, in the words an engineer would use.
 * The IDs are opaque — "SN-TIMER-003" tells you nothing, "Logix Timer
 * Specialist reading timer_logic" tells you what it claims to be for, which is
 * what makes a verdict against it meaningful. */
const SNL_READS = {
  sensor_anomaly:       'live telemetry — vibration, temperature, current',
  maintenance_history:  'the maintenance log and inspection notes',
  cycling_sequence:     'start/stop counts and restart behaviour',
  mechanical_root_cause:'mechanical evidence — alignment, bearings',
  timer_logic:          'timer and dwell configuration in the PLC program',
  ladder_logic:         'whether ladder source is present to review',
  risk_analysis:        'rollback and validation requirements for any change',
  safety_escalation:    'whether the context is safety-related',
  evidence_sufficiency: 'whether there is enough evidence to advise at all',
};

const SNL_DIMENSIONS = [
  { key: 'failures',            label: 'Failures',   min: 0,  max: 12,  step: 1 },
  { key: 'starts',              label: 'Starts',     min: 0,  max: 500, step: 10 },
  { key: 'peak_vibration_mm_s', label: 'Vib peak',   min: 0,  max: 25,  step: 0.5, unit: 'mm/s' },
  { key: 'peak_temp_c',         label: 'Temp peak',  min: 0,  max: 140, step: 1,   unit: '°C' },
];

function snlPost(path, body) {
  return fetch(SNL_API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    cache: 'no-store',
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

/* One expert: verdict badge, claim, confidence, and what moves it. */
function SubNetRow({ c, audit }) {
  const verdict = SNL_VERDICT[(audit && audit.recommended_status) || 'ACTIVE'] || SNL_VERDICT.ACTIVE;
  const responds = c.responds_to || [];
  const deaf = responds.length === 0;
  return (
    <div className={`snl-row snl-${verdict.cls}`}>
      <div className="snl-row-top">
        <span className="snl-role">{c.role || c.subnet_id}</span>
        <span className={`snl-badge snl-${verdict.cls}`} title={verdict.hint}>
          {verdict.label}<i className="snl-w">&times;{verdict.w}</i>
        </span>
      </div>
      <div className="snl-ident">
        <span className="snl-id">{c.subnet_id}</span>
        <span className="snl-reads">
          reads {SNL_READS[c.specialty] || (c.specialty || '').replace(/_/g, ' ')}
        </span>
        <span className="snl-conf" title="confidence this SubNet reports">
          {(c.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <div className="snl-claim">&ldquo;{c.claim}&rdquo;</div>
      <div className="snl-responds">
        {deaf
          ? <span className="snl-deaf">responds to nothing you can change here</span>
          : <span>moves with {responds.map((d) => (
              <em key={d} className="snl-dim">{d.replace(/_/g, ' ')}</em>
            )).reduce((a, b) => [a, ', ', b])}</span>}
      </div>
      {audit && audit.evidence && audit.evidence.length > 0 && (
        <div className="snl-why">{audit.evidence[0]}</div>
      )}
    </div>
  );
}

function SubNetLab({ program }) {
  const [values, setValues] = React.useState({
    failures: 2, starts: 120, peak_vibration_mm_s: 8, peak_temp_c: 85,
    safety_related: false, maintenance_history: [],
  });
  const [probe, setProbe] = React.useState(null);
  const [audit, setAudit] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const timer = React.useRef(null);

  // The ladder actually on screen is the PLC context, so the experts are
  // reasoning about the same program the engineer is reading.
  const sourceText = React.useMemo(() => {
    if (!program || !program.rungs) return '';
    return program.rungs.map((r) => r.text || r).join(' ');
  }, [program]);

  // The audit is over a whole probe set, so it is slow and does not depend on
  // the sliders — fetched once.
  React.useEffect(() => {
    let alive = true;
    snlPost('/plcprog/subnet-audit?count=40&seed=11', {}).then((d) => {
      if (!alive || !d) return;
      const map = {};
      (d.subnets || []).forEach((s) => { map[s.subnet_id] = s; });
      setAudit({ map, mayor: d.mayor, summary: d.summary });
    });
    return () => { alive = false; };
  }, []);

  // The probe follows the sliders, debounced so dragging does not queue a
  // request per pixel.
  React.useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBusy(true);
      snlPost('/plcprog/subnet-probe', {
        ...values,
        asset_id: (program && program.asset) || 'PRESS_01',
        routine: (program && program.routine) || 'PROBE_ROUTINE',
        source_text: sourceText,
      }).then((d) => {
        setBusy(false);
        if (!d) { setErr('probe unreachable'); return; }
        if (d.available === false) { setErr(d.detail || 'PLCProg not installed'); return; }
        setErr(''); setProbe(d);
      });
    }, SNL_DEBOUNCE_MS);
    return () => timer.current && clearTimeout(timer.current);
  }, [values, sourceText, program]);

  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));
  const contributions = (probe && probe.contributions) || [];
  const deafCount = contributions.filter((c) => (c.responds_to || []).length === 0).length;

  return (
    <div className="snl">
      <div className="snl-head">
        <span className="snl-title">SUBNET LAB</span>
        <span className="snl-sub">
          {program ? `${program.asset} · ${program.archetype || ''}` : 'no program selected'}
        </span>
        {busy && <span className="snl-busy">probing…</span>}
      </div>

      <div className="snl-explain">
        Each SubNet is one specialist opinion on the case — a telemetry analyst, a
        maintenance historian, a timer specialist. The Mayor collects them and
        weights each by its lifecycle status, so a quarantined expert still
        speaks but counts for nothing. The badge is that multiplier.
      </div>

      {err && <div className="snl-err">{err}</div>}

      {/* fault sim */}
      <div className="snl-sim">
        <div className="snl-sim-label">FAULT SIMULATOR · move a value, watch who reacts</div>
        {SNL_DIMENSIONS.map((d) => (
          <label className="snl-slider" key={d.key}>
            <span className="snl-slabel">{d.label}</span>
            <input
              type="range" min={d.min} max={d.max} step={d.step}
              value={values[d.key]}
              onChange={(e) => set(d.key, parseFloat(e.target.value))}
            />
            <span className="snl-sval">{values[d.key]}{d.unit || ''}</span>
          </label>
        ))}
        <div className="snl-toggles">
          <label className="snl-check">
            <input
              type="checkbox" checked={values.safety_related}
              onChange={(e) => set('safety_related', e.target.checked)}
            />
            <span>Safety-related context</span>
          </label>
          <label className="snl-check">
            <input
              type="checkbox"
              checked={values.maintenance_history.length > 0}
              onChange={(e) => set('maintenance_history',
                e.target.checked ? ['Laser alignment check failed'] : [])}
            />
            <span>Alignment finding in history</span>
          </label>
        </div>
      </div>

      {probe && probe.recommendation && (
        <div className="snl-outcome">
          <span className="snl-oc-k">PLCProg</span>
          <span className="snl-oc-v">{probe.recommendation.action}</span>
          <span className="snl-oc-k">risk</span>
          <span className="snl-oc-v">{probe.recommendation.risk}</span>
        </div>
      )}

      {contributions.length > 0 && (
        <div className="snl-meta">
          {deafCount > 0 && (
            <span className="snl-flag">
              {deafCount} of {contributions.length} respond to nothing at this operating point
            </span>
          )}
          {audit && audit.mayor && !audit.mayor.discriminates && (
            <span className="snl-flag">
              Mayor accepted every contribution — acceptance is not evidence of merit
            </span>
          )}
        </div>
      )}

      <div className="snl-rows">
        {contributions.map((c) => (
          <SubNetRow key={c.subnet_id} c={c}
                     audit={audit && audit.map ? audit.map[c.subnet_id] : null} />
        ))}
        {contributions.length === 0 && !err && (
          <div className="snl-empty">waiting for the first probe…</div>
        )}
      </div>

      <div className="snl-foot">
        Advisory. Verdicts are recommendations against the audit probe set — this
        panel cannot change a SubNet's lifecycle.
      </div>
    </div>
  );
}

window.SubNetLab = SubNetLab;

;
// ═══ LadderLogic.jsx ═══
// LadderLogic.jsx — Logic profile: live ladder viewer/editor over the DSR corpus.
// Three-pane workspace (program tree · rung canvas · Watch/NEPHES/History rail).
// Live power flow from a client-side scan engine; edits go through a draft →
// review (diff + rule findings + NEPHES advisory + blast radius) → apply flow.
// Rules are a JS port of NFO/program/rules.py; parsing mirrors program/neutral_text.py.
// Data-source semantics: NEPHES_SOURCE 'remote'+online = LIVE (writes POST through the
// command bus) · 'sim' = SIMULATOR (local scan engine) · 'remote'+offline = read-only.

/* ── neutral text parsing (program/neutral_text.py) ─────────────────────── */
const LAD_INSTR_RE = /\b([A-Z][A-Z0-9_]{1,9})\s*(?:\(([^)]*)\))?/g;
const ladParseFlat = (text) => {
  const out = []; let m; LAD_INSTR_RE.lastIndex = 0;
  while (m = LAD_INSTR_RE.exec(text || '')) {
    if (m[1] === 'CDATA') continue;
    out.push({ mn: m[1], ops: m[2] ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : [] });
  }
  return out;
};
const ladBase = (op) => (op || '').split('.', 1)[0].trim();
// structured parse: series of elements; '[a,b]' is a parallel branch of sub-series
function ladParseStruct(text) {
  let i = 0; const s = (text || '').replace(/;\s*$/, '');
  function series(stop) {
    const els = [];
    while (i < s.length) {
      const ch = s[i];
      if (stop.indexOf(ch) > -1) return els;
      if (ch === '[') {
        i++; const alts = [series(',]')];
        while (s[i] === ',') { i++; alts.push(series(',]')); }
        i++; // ']'
        els.push({ kind: 'branch', alts });
      } else if (/[A-Z]/.test(ch)) {
        let j = i; while (j < s.length && /[A-Z0-9_]/.test(s[j])) j++;
        const mn = s.slice(i, j); i = j; let ops = [];
        if (s[i] === '(') { const k = s.indexOf(')', i); ops = s.slice(i + 1, k).split(',').map((x) => x.trim()).filter(Boolean); i = k + 1; }
        els.push({ kind: 'el', mn, ops });
      } else i++;
    }
    return els;
  }
  return series('');
}
function ladSerialize(els) {
  return els.map((e) => e.kind === 'branch' ?
  '[' + e.alts.map((a) => ladSerialize(a)).join(',') + ']' :
  e.mn + (e.ops.length || e.mn === 'TON' || e.mn === 'RTO' || e.mn === 'TOF' || e.mn === 'CTU' || e.mn === 'CTD' ? '(' + e.ops.join(',') + ')' : '()')).join('') + ';';
}

/* ── static rules (program/rules.py, JS port — same ids, severities, copy) ── */
const LAD_WRITERS = { OTE: 1, OTL: 1, OTU: 1, MOV: 1, CLR: 1, COP: 1, FLL: 1 };
const LAD_READERS = { XIC: 1, XIO: 1, ONS: 1, OSR: 1, OSF: 1 };
const LAD_RETENTIVE = { RTO: 1, CTU: 1, CTD: 1 };
const LAD_TIMERISH = { RTO: 1, CTU: 1, CTD: 1, TON: 1, TOF: 1 };
function ladAnalyse(prog) {
  const rungs = prog.rungs.map((r, i) => ({ i, ins: ladParseFlat(r.t), dis: r.dis }));
  const active = rungs.filter((r) => !r.dis);
  const tagMap = {}; prog.tags.forEach((t) => { tagMap[t.n] = t; });
  const F = [];
  const writes = (r, mn) => r.ins.filter((x) => (mn ? x.mn === mn : LAD_WRITERS[x.mn]) && x.ops[0]).map((x) => [x.mn, ladBase(x.ops[0])]);
  // dual-coil (CRITICAL)
  const byTag = {};
  active.forEach((r) => writes(r, 'OTE').forEach(([, t]) => (byTag[t] = byTag[t] || []).push(r.i)));
  Object.keys(byTag).sort().forEach((t) => { if (byTag[t].length < 2) return;
    F.push({ rule: 'dual-coil', sev: 'crit', tag: t, rungs: byTag[t], summary: t + ' is energised by ' + byTag[t].length + ' separate rungs',
      detail: 'Both rungs write the same output with OTE, so the last one in the scan decides the state and the earlier rung is silently overridden every scan. The behaviour depends on rung order, not on the logic as written.',
      suggestion: 'Combine the conditions into one rung with a parallel branch, or drive an intermediate bit from each condition and OTE the output once from those.' }); });
  // latch-without-unlatch (CRITICAL)
  const latched = {}, unlatched = {};
  active.forEach((r) => { writes(r, 'OTL').forEach(([, t]) => (latched[t] = latched[t] || []).push(r.i)); writes(r, 'OTU').forEach(([, t]) => unlatched[t] = 1); });
  Object.keys(latched).sort().forEach((t) => { if (unlatched[t]) return;
    F.push({ rule: 'latch-without-unlatch', sev: 'crit', tag: t, rungs: latched[t], summary: t + ' is latched but never unlatched',
      detail: 'No rung in the parsed program issues OTU for this bit, so once set it stays set through mode changes and power cycles. If it gates production, recovery needs the programming software.',
      suggestion: 'Add an unlatch rung driven by the operator reset or the condition that proves the fault has cleared.' }); });
  // retentive-no-reset (WARNING)
  const retentive = {}, reset = {};
  active.forEach((r) => r.ins.forEach((x) => { if (!x.ops[0]) return; const t = ladBase(x.ops[0]);
    if (LAD_RETENTIVE[x.mn]) (retentive[t] = retentive[t] || []).push(r.i); else if (x.mn === 'RES') reset[t] = 1; }));
  Object.keys(retentive).sort().forEach((t) => { if (reset[t]) return;
    F.push({ rule: 'retentive-no-reset', sev: 'warn', tag: t, rungs: retentive[t], summary: 'retentive ' + t + ' is never reset',
      detail: 'No RES instruction targets this tag, so the accumulator is never cleared. Once it reaches the preset the done bit latches on permanently and any logic gated on it stops changing.',
      suggestion: 'Add a RES on cycle completion, or use a non-retentive TON if the timing does not need to survive the rung going false.' }); });
  // zero-preset-timer (WARNING)
  const used = {};
  active.forEach((r) => r.ins.forEach((x) => { if (LAD_TIMERISH[x.mn] && x.ops[0]) (used[ladBase(x.ops[0])] = used[ladBase(x.ops[0])] || []).push(r.i); }));
  Object.keys(used).sort().forEach((t) => { const d = tagMap[t];
    if (!d || d.pre == null || d.pre > 0) return;
    F.push({ rule: 'zero-preset-timer', sev: 'warn', tag: t, rungs: used[t], summary: t + ' has a preset of 0',
      detail: 'The done bit becomes true on the first scan the rung is true, so any dwell, debounce or purge this timer was meant to enforce does not happen. The rung still looks correct on screen.',
      suggestion: 'Set the preset to the intended interval, in milliseconds.' }); });
  // unreachable-rung (WARNING)
  const written = {}; active.forEach((r) => writes(r).forEach(([, t]) => written[t] = 1));
  active.forEach((r) => r.ins.filter((x) => LAD_READERS[x.mn] && x.ops[0]).forEach((x) => {
    const t = ladBase(x.ops[0]); const d = tagMap[t];
    if (!d || (d.acc || '').toLowerCase() !== 'none' || written[t]) return;
    F.push({ rule: 'unreachable-rung', sev: 'warn', tag: t, rungs: [r.i], summary: 'rung ' + r.i + ' can never be true (' + t + ' is never set)',
      detail: t + ' is examined here, is written by no rung, and has ExternalAccess=None so no HMI, message or I/O alias can write it either. The rung is dead code, and anything it was meant to protect is unprotected.',
      suggestion: 'Delete the rung, or restore whatever used to set the bit. If it is a commissioning aid, it should not ship.' }); }));
  // unused-tag (INFO)
  const referenced = {};
  rungs.forEach((r) => r.ins.forEach((x) => x.ops.forEach((o) => referenced[ladBase(o)] = 1)));
  prog.tags.map((t) => t.n).sort().forEach((n) => { if (referenced[n]) return;
    F.push({ rule: 'unused-tag', sev: 'info', tag: n, rungs: [], summary: n + ' is declared but never used',
      detail: 'No rung in the parsed program references ' + n + '. Often the residue of a change that was started and not finished.',
      suggestion: 'Remove it, or reconnect whatever was meant to use it.' }); });
  const ord = { crit: 0, warn: 1, info: 2 };
  return F.sort((a, b) => ord[a.sev] - ord[b.sev] || (a.rule < b.rule ? -1 : 1) || (a.tag < b.tag ? -1 : 1));
}

/* ── scan engine — one PLC scan over the rung list ──────────────────────── */
function ladNewSim(prog) {
  const sim = { vals: {}, box: {}, ons: {}, t: 0 };
  prog.tags.forEach((t) => { if (t.dt === 'TIMER' || t.dt === 'COUNTER') sim.box[t.n] = { PRE: t.pre || 0, ACC: 0, DN: false, TT: false, EN: false, dt: t.dt }; else sim.vals[t.n] = false; });
  return sim;
}
const ladHash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
// exerciser: drives INPUT tags (never written by the program) so the floor looks alive
function ladStimulus(tag, tMs) {
  const h = ladHash(tag);
  if (/Stop_PB|Estop_PB/.test(tag)) return tMs % (26000 + h % 9000) < 500; // rare stop taps
  if (/_OK|_Chain|_Proven|Level_OK|Temp_OK|Filter_OK|Drive_Ready|Guard_Closed|Cell_Ready|Part_Clear/.test(tag))
    return tMs % (45000 + h % 20000) > 1600; // healthy interlocks, brief dips
  if (/_PB|_Reset|_Ack/.test(tag)) { const p = 9000 + h % 8000; return tMs % p < 900; } // button pulses
  const p = 8000 + h % 14000, duty = 0.3 + h % 40 / 100;
  return tMs % p < p * duty;
}
function ladScan(prog, sim, dtMs, forces, sourceMode) {
  sim.t += dtMs;
  const acc = {}; prog.tags.forEach((t) => acc[t.n] = t.acc || 'Read/Write');
  const written = {}; prog.rungs.forEach((r) => { if (r.dis) return; ladParseFlat(r.t).forEach((x) => { if ((LAD_WRITERS[x.mn] || LAD_TIMERISH[x.mn] || x.mn === 'RES') && x.ops[0]) written[ladBase(x.ops[0])] = 1; }); });
  const rdBit = (base) => { // one resolution for scan AND display
    if (forces && forces[base] != null) return !!forces[base];
    if (written[base]) return !!sim.vals[base];
    if ((acc[base] || '').toLowerCase() === 'none') return !!sim.vals[base]; // nothing can write it — stays put
    return ladStimulus(base, sim.t); // undriven input — exerciser keeps the floor alive
  };
  const rd = (op) => {
    const base = ladBase(op);
    if (op.indexOf('.') > -1) { const [b, m] = op.split('.'); if (forces && forces[op] != null) return !!forces[op]; const bx = sim.box[b]; return bx ? !!bx[m] : false; }
    if (sim.box[op]) return !!sim.box[op].DN;
    return rdBit(base);
  };
  const power = []; // per rung: array of node states for the renderer
  prog.rungs.forEach((r, ri) => {
    const struct = r.struct || (r.struct = ladParseStruct(r.t));
    if (r.dis) { power[ri] = { on: false, dis: true }; return; }
    const evalSeries = (els, condIn, notes) => {
      let cond = condIn;
      els.forEach((e) => {
        if (e.kind === 'branch') {
          let out = false;
          e.notes = e.alts.map((alt) => { const n = []; const r2 = evalSeries(alt, cond, n); out = out || r2; return { on: r2, nodes: n }; });
          e.in = cond; e.out = out; cond = out; notes.push(e);
          return;
        }
        const tag = e.ops[0];
        if (e.mn === 'XIC') { e.in = cond; cond = cond && rd(tag); e.on = cond; e.val = rd(tag); }
        else if (e.mn === 'XIO') { e.in = cond; cond = cond && !rd(tag); e.on = cond; e.val = rd(tag); }
        else if (e.mn === 'ONS' || e.mn === 'OSR') { e.in = cond; const k = ri + ':' + tag; const prev = sim.ons[k] || false; const fire = cond && rd(tag) && !prev; sim.ons[k] = cond && rd(tag); cond = fire; e.on = cond; e.val = rd(tag); }
        else if (e.mn === 'TON' || e.mn === 'RTO') { e.in = cond; const bx = sim.box[ladBase(tag)]; if (bx) { bx.EN = cond;
            if (cond) { bx.ACC = Math.min(bx.PRE, bx.ACC + dtMs); bx.TT = bx.ACC < bx.PRE; bx.DN = bx.ACC >= bx.PRE; }
            else if (e.mn === 'TON') { bx.ACC = 0; bx.DN = false; bx.TT = false; } else bx.TT = false; }
          e.on = cond; }
        else if (e.mn === 'CTU' || e.mn === 'CTD') { e.in = cond; const bx = sim.box[ladBase(tag)]; const k = ri + ':' + tag; const prev = sim.ons[k] || false;
          if (bx && cond && !prev) { bx.ACC += e.mn === 'CTU' ? 1 : -1; bx.DN = bx.ACC >= bx.PRE; } sim.ons[k] = cond; e.on = cond; }
        else if (e.mn === 'RES') { e.in = cond; if (cond) { const bx = sim.box[ladBase(tag)]; if (bx) { bx.ACC = 0; bx.DN = false; bx.TT = false; } } e.on = cond; }
        else if (e.mn === 'OTE') { e.in = cond; if (forces && forces[tag] != null) sim.vals[tag] = !!forces[tag]; else sim.vals[tag] = cond; e.on = sim.vals[tag]; }
        else if (e.mn === 'OTL') { e.in = cond; if (cond) sim.vals[tag] = true; if (forces && forces[tag] != null) sim.vals[tag] = !!forces[tag]; e.on = sim.vals[tag]; }
        else if (e.mn === 'OTU') { e.in = cond; if (cond) sim.vals[tag] = false; if (forces && forces[tag] != null) sim.vals[tag] = !!forces[tag]; e.on = cond; }
        else { e.in = cond; e.on = cond; }
        notes.push(e);
      });
      return cond;
    };
    const notes = [];
    const out = evalSeries(struct, true, notes);
    power[ri] = { on: out, notes };
  });
  // display snapshot — the Watch table shows exactly what the scan resolved
  sim.disp = {}; prog.tags.forEach((t) => { if (!sim.box[t.n]) sim.disp[t.n] = rdBit(t.n); });
  return power;
}

/* ── SVG rung renderer — RSLogix-style drawn symbols, flowing dashes when hot ── */
const LAD_W = { el: 56, box: 158, coil: 64, gap: 18, railPad: 26 };
function LadRung({ prog, rung, ri, sim, draft, palette, onSlot, onElement, onComment, onRungAct, forcesArmed, forces, findingsByRung, readOnly }) {
  const struct = React.useMemo(() => ladParseStruct(rung.t), [rung.t]);
  // measure: element widths grow with their tag label so labels never collide
  const lblOf = (e) => ladBase(e.ops && e.ops[0] || '?').replace(prog.asset + '_', '');
  const widthOf = (e) => e.kind === 'branch' ? Math.max(...e.alts.map(wOf)) + 28 :
  LAD_TIMERISH[e.mn] ? LAD_W.box :
  /^OT|^RES/.test(e.mn) ? Math.max(LAD_W.coil, lblOf(e).length * 5.8 + 16) :
  Math.max(LAD_W.el, lblOf(e).length * 5.8 + 16);
  const wOf = (els) => els.reduce((w, e) => w + widthOf(e), 0);
  const hOf = (els) => Math.max(58, ...els.filter((e) => e.kind === 'branch').map((e) => e.alts.reduce((s, a) => s + Math.max(58, hOf(a)), 0) + 6));
  const W = Math.max(920, wOf(struct) + 200), H = hOf(struct) + 30;
  const mid = 34;
  const hot = (v) => v ? 'var(--ok)' : '#3a3831';
  const els = [];
  let slotIdx = 0;
  const wire = (x1, y, x2, on, key) => els.push(<line key={key} x1={x1} y1={y} x2={x2} y2={y} className={on && !rung.dis ? 'lad-wire on' : 'lad-wire'} />);
  const slot = (x, y, key) => draft && palette && els.push(<g key={'s' + key} className="lad-slot" onClick={() => onSlot(ri, key)}><circle cx={x} cy={y} r="8" /><text x={x} y={y + 3.5} textAnchor="middle">+</text></g>);
  const drawSeries = (series, x0, y, endX, depth) => {
    let x = x0;
    const isOut = (e) => e.kind === 'el' && (/^OT/.test(e.mn) || e.mn === 'RES' || LAD_TIMERISH[e.mn]);
    const firstOut = series.findIndex(isOut);
    series.forEach((e, ei) => {
      const path = depth + ':' + ei;
      // stretch wire so the output block lands on the right rail
      if (ei === firstOut && depth === '0') {
        const rest = wOf(series.slice(ei)) - 14;
        const tx = endX - rest;
        if (tx > x) { wire(x, y, tx, e.in, 'w' + path); slot((x + tx) / 2, y, slotIdx++); x = tx; }
      }
      if (e.kind === 'branch') {
        const bw = Math.max(...e.alts.map(wOf)) + 28;
        let yy = y;
        const x1 = x + 8, x2 = x + bw - 8;
        e.alts.forEach((alt, ai) => {
          const note = e.notes && e.notes[ai];
          if (ai > 0) { yy += Math.max(58, hOf(e.alts[ai - 1])); els.push(<line key={'bv1' + path + ai} x1={x1} y1={y} x2={x1} y2={yy} className={e.in && !rung.dis ? 'lad-wire on' : 'lad-wire'} />); els.push(<line key={'bv2' + path + ai} x1={x2} y1={yy} x2={x2} y2={y} className={note && note.on && !rung.dis ? 'lad-wire on' : 'lad-wire'} />); }
          const aw = wOf(alt);
          const pad = (bw - 16 - aw) / 2;
          wire(x1, yy, x1 + pad, ai === 0 ? e.in : e.in, 'bw1' + path + ai);
          const xe = drawSeries(alt, x1 + pad, yy, 0, path + '.' + ai);
          wire(xe, yy, x2, note ? note.on : false, 'bw2' + path + ai);
        });
        x += bw; wire(x - 8, y, x, e.out, 'wb' + path);
      } else {
        const tag = e.ops[0] || '?';
        const base = ladBase(tag);
        const w = widthOf(e);
        const forced = forces && (forces[tag] != null || forces[base] != null);
        const clickable = draft || (forcesArmed && !readOnly) || (LAD_TIMERISH[e.mn] && !readOnly);
        const gProps = { className: 'lad-el' + (clickable ? ' click' : '') + (forced ? ' forced' : ''), onClick: clickable ? () => onElement(ri, path, e) : undefined };
        if (LAD_TIMERISH[e.mn]) {
          const bx = sim && sim.box[base] || { PRE: 0, ACC: 0 };
          const pct = bx.PRE > 0 ? Math.min(1, bx.ACC / bx.PRE) : 0;
          els.push(<g key={'e' + path} {...gProps}>
            <rect x={x} y={y - 26} width={LAD_W.box - LAD_W.gap} height="52" rx="4" className={'lad-boxr' + (e.on && !rung.dis ? ' on' : '')} />
            <text x={x + 10} y={y - 11} className="lad-boxmn">{e.mn}</text>
            <text x={x + LAD_W.box - LAD_W.gap - 10} y={y - 11} textAnchor="end" className="lad-boxtag">{base.replace(prog.asset + '_', '')}</text>
            <text x={x + 10} y={y + 4} className="lad-boxrow">PRE {bx.PRE}{bx.dt === 'COUNTER' ? '' : ' ms'}</text>
            <text x={x + 10} y={y + 17} className="lad-boxrow">ACC {Math.round(bx.ACC)}</text>
            {bx.DN && <text x={x + LAD_W.box - LAD_W.gap - 10} y={y + 17} textAnchor="end" className="lad-boxdn">DN</text>}
            <rect x={x + 1} y={y + 23} width={LAD_W.box - LAD_W.gap - 2} height="2.5" className="lad-boxprog-t" />
            <rect x={x + 1} y={y + 23} width={(LAD_W.box - LAD_W.gap - 2) * pct} height="2.5" className="lad-boxprog" />
          </g>);
          x += LAD_W.box;
        } else if (/^OT|^RES/.test(e.mn)) {
          const cx = x + 22;
          els.push(<g key={'e' + path} {...gProps}>
            <text x={cx} y={y - 18} textAnchor="middle" className={'lad-tag' + (e.on && !rung.dis ? ' on' : '')}>{lblOf(e)}</text>
            <circle cx={cx} cy={y} r="12" className={'lad-coil' + (e.on && !rung.dis ? ' on' : '')} />
            {e.mn !== 'OTE' && <text x={cx} y={y + 3.5} textAnchor="middle" className="lad-coilmk">{e.mn === 'OTL' ? 'L' : e.mn === 'OTU' ? 'U' : 'R'}</text>}
            {e.mn === 'OTE' && e.on && !rung.dis && <circle cx={cx} cy={y} r="5" className="lad-coilcore" />}
            {forced && <text x={cx + 15} y={y - 8} className="lad-forcemk">⚡</text>}
          </g>);
          wire(x + 34, y, x + w - 10, e.on, 'wc' + path);
          x += w;
        } else { // contact
          const x1 = x + 14, x2 = x + 26, my = 12;
          els.push(<g key={'e' + path} {...gProps}>
            <text x={x + 20} y={y - 20} textAnchor="middle" className={'lad-tag' + (e.val ? ' lit' : '')}>{lblOf(e)}</text>
            <line x1={x1} y1={y - my} x2={x1} y2={y + my} className={'lad-cbar' + (e.on && !rung.dis ? ' on' : '')} />
            <line x1={x2} y1={y - my} x2={x2} y2={y + my} className={'lad-cbar' + (e.on && !rung.dis ? ' on' : '')} />
            {e.mn === 'XIO' && <line x1={x2 + 3} y1={y + my} x2={x1 - 3} y2={y - my} className={'lad-cbar' + (e.on && !rung.dis ? ' on' : '')} />}
            {e.mn === 'ONS' && <text x={x + 20} y={y + 24} textAnchor="middle" className="lad-onsmk">ONS</text>}
            {forced && <text x={x2 + 4} y={y - 10} className="lad-forcemk">⚡</text>}
            <rect x={x} y={y - 26} width="40" height="52" fill="transparent" />
          </g>);
          wire(x + 26, y, x + w - 14, e.on, 'wc' + path);
          slot(x + w - 7, y, slotIdx++);
          x += w;
        }
      }
    });
    return x;
  };
  // left rail wire to first element
  const notes = sim && sim.power && sim.power[ri];
  wire(LAD_W.railPad, mid, LAD_W.railPad + 14, !rung.dis, 'w0');
  slot(LAD_W.railPad + 7, mid, 'first');
  const xEnd = drawSeries((notes && notes.notes ? attachNotes(struct, notes.notes) : struct), LAD_W.railPad + 14, mid, W - LAD_W.railPad - 14, '0');
  wire(xEnd, mid, W - LAD_W.railPad, notes ? notes.on : false, 'wend');
  function attachNotes(st, ns) {
    const copy = (els, notes) => els.forEach((e, i) => {
      const n = notes && notes[i]; if (!n) return;
      e.in = n.in; e.on = n.on; e.out = n.out; e.val = n.val;
      if (e.kind === 'branch' && n.notes) { e.notes = n.notes; e.alts.forEach((a, ai) => copy(a, n.notes[ai] && n.notes[ai].nodes)); }
    });
    copy(st, ns); return st;
  }
  const rFinds = findingsByRung[ri] || [];
  return (
    <div className={`lad-rung ${rung.dis ? 'dis' : ''} ${rung.mark ? 'mark-' + rung.mark : ''}`} data-rung={ri}>
      <div className="lad-rung-top">
        <span className="lad-rn">{ri}</span>
        <span className="lad-comment" onClick={draft && !readOnly ? () => onComment(ri) : undefined} title={draft ? 'Edit comment' : undefined}>{rung.c || '—'}</span>
        {rung.mark === 'new' && <span className="lad-badge new">NEW</span>}
        {rung.mark === 'mod' && <span className="lad-badge mod">MODIFIED</span>}
        {rung.dis && <span className="lad-badge dis">DISABLED</span>}
        {rFinds.map((f, i) => <span key={i} className={`lad-badge find ${f.sev}`} title={f.summary}>{f.rule}</span>)}
        {draft && <span className="lad-rung-acts">
          <button onClick={() => onRungAct(ri, 'up')} title="Move up">↑</button>
          <button onClick={() => onRungAct(ri, 'down')} title="Move down">↓</button>
          <button onClick={() => onRungAct(ri, 'dis')} title={rung.dis ? 'Enable rung' : 'Disable rung'}>{rung.dis ? '▶' : '⏸'}</button>
          <button className="del" onClick={() => onRungAct(ri, 'del')} title="Delete rung">✕</button>
        </span>}
      </div>
      <div className="lad-svgwrap">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <line x1={LAD_W.railPad} y1="6" x2={LAD_W.railPad} y2={H - 6} className="lad-vrail l" />
          <line x1={W - LAD_W.railPad} y1="6" x2={W - LAD_W.railPad} y2={H - 6} className="lad-vrail r" />
          {els}
        </svg>
      </div>
    </div>);
}

/* ── main workspace ─────────────────────────────────────────────────────── */
const LAD_STORE_KEY = 'nfo_ladder';
const ladLoadStore = () => { try { return JSON.parse(localStorage.getItem(LAD_STORE_KEY) || '{}') || {}; } catch (e) { return {}; } };
// Render the SubNet-neuron panel, and SELF-HEAL if it registers late. The panel
// is window.SubNetLab, set by a sibling script; a bare `window.SubNetLab ? … : …`
// check latches on the first render and never recovers if the script had not run
// yet. This polls until it appears, so the tab can never be stuck on "not loaded".
function SubNetSlot({ program }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (window.SubNetLab) return undefined;
    const iv = setInterval(() => { if (window.SubNetLab) { clearInterval(iv); tick((x) => x + 1); } }, 250);
    return () => clearInterval(iv);
  }, []);
  return window.SubNetLab
    ? React.createElement(window.SubNetLab, { program })
    : React.createElement('div', { className: 'lad-empty' }, 'Loading SubNet neurons…');
}
const ladSaveStore = (patch) => { try { localStorage.setItem(LAD_STORE_KEY, JSON.stringify({ ...ladLoadStore(), ...patch })); } catch (e) {} };
const LAD_PALETTE = [
{ mn: 'XIC', label: '⊣ ⊢', name: 'XIC', desc: 'Examine if closed' },
{ mn: 'XIO', label: '⊣/⊢', name: 'XIO', desc: 'Examine if open' },
{ mn: 'ONS', label: '↿', name: 'ONS', desc: 'One-shot rising' },
{ mn: 'OTE', label: '( )', name: 'OTE', desc: 'Output energise' },
{ mn: 'OTL', label: '(L)', name: 'OTL', desc: 'Output latch' },
{ mn: 'OTU', label: '(U)', name: 'OTU', desc: 'Output unlatch' },
{ mn: 'TON', label: '⏱', name: 'TON', desc: 'Timer on-delay' },
{ mn: 'RTO', label: '⏱R', name: 'RTO', desc: 'Retentive timer' },
{ mn: 'CTU', label: '#', name: 'CTU', desc: 'Count up' },
{ mn: 'RES', label: '(R)', name: 'RES', desc: 'Reset timer/counter' },
{ mn: 'BRANCH', label: '⎇', name: 'BRANCH', desc: 'Parallel OR branch' }];

/* WRITE-PATH GATE — decided 2026-08-14: advisory now, supervised setpoints next.
 *
 * These taps emit ladder.force / ladder.apply / ladder.revert onto the command
 * bus, which POSTs to /v1/commands when the data source is remote and
 * reachable. Nothing serves that endpoint today, but the client half of a
 * tag-force and logic-apply path is the beginning of a road the product has now
 * explicitly decided not to take: the chosen position computes a recommended
 * setpoint and a human enters it, with no write path at all.
 *
 * Left in place rather than deleted so the work survives and the decision is
 * reversible in one line — but OFF by default, because the read-only guarantee
 * is worth more intact than partially true, and it survives a security review
 * precisely because there is no exception to explain.
 */
const LAD_WRITE_TAPS_ENABLED = false;
const ladCommand = (name, payload) => {
  if (!LAD_WRITE_TAPS_ENABLED) return;          // advisory build: emits nothing
  if (window.NEPHES_SOURCE) NEPHES_SOURCE.command(name, payload);
};

function LadderLogic({ onNotif, stream, jump }) {
  const corpus = window.LADDER_CORPUS;
  const store0 = React.useRef(ladLoadStore()).current;
  // live programs = corpus + applied overrides (+ imported)
  const [over, setOver] = React.useState(store0.over || {});
  const [imported, setImported] = React.useState(store0.imported || []);
  const [versions, setVersions] = React.useState(store0.versions || {});
  const [audit, setAudit] = React.useState(store0.audit || []);
  const progs = React.useMemo(() => {
    const list = corpus.list.map((p) => over[p.idx] ? { ...p, rungs: over[p.idx].rungs, tags: over[p.idx].tags, applied: over[p.idx].ts } : p);
    return list.concat(imported.map((p, i) => ({ ...p, idx: 1000 + i })));
  }, [over, imported]); // eslint-disable-line
  const byId = React.useMemo(() => { const m = {}; progs.forEach((p) => m[p.idx] = p); return m; }, [progs]);
  const [sel, setSel] = React.useState(() => { const s = (window.NFO_SESSION || {}).ladderSel; return byId[s] ? s : 0; });
  const prog = byId[sel] || progs[0];
  React.useEffect(() => { try { const s = JSON.parse(localStorage.getItem('nfo_session') || '{}'); s.ladderSel = sel; localStorage.setItem('nfo_session', JSON.stringify(s)); } catch (e) {} }, [sel]);
  // ── data source semantics ──
  const [source, setSource] = React.useState(() => window.NEPHES_SOURCE ? window.NEPHES_SOURCE.get() : { mode: 'sim', status: 'untested' });
  React.useEffect(() => { const f = (e) => setSource(e.detail); window.addEventListener('nephes:source', f); return () => window.removeEventListener('nephes:source', f); }, []);
  const readOnly = source.mode === 'remote' && source.status !== 'online';
  const live = source.mode === 'remote' && source.status === 'online';
  // ── search / tree ──
  const [q, setQ] = React.useState('');
  const [openCls, setOpenCls] = React.useState(() => {
    const init = { [((byId[(window.NFO_SESSION || {}).ladderSel] || corpus.list[0]) || {}).cls || 'PRESS']: true };
    // A saved or imported program must be VISIBLE after a reload, or "save"
    // feels broken. Expand the CUSTOM and IMPORTED groups whenever they hold
    // any of the operator's own programs.
    (store0.imported || []).forEach((p) => { if (p.cls) init[p.cls] = true; });
    return init;
  });
  // ── draft ──
  const [draft, setDraft] = React.useState(null); // {rungs, tags, note}
  const [palette, setPalette] = React.useState(null);
  const [picker, setPicker] = React.useState(null); // {ri, slotKey|path, el?, x, y}
  const [review, setReview] = React.useState(false);
  // ── forces ──
  const [armed, setArmed] = React.useState(false);
  const [armAsk, setArmAsk] = React.useState(false);
  const forcesRef = React.useRef({});
  const [, forceTick] = React.useState(0);
  // ── rail ──
  const [rail, setRail] = React.useState('watch');
  // ── sim loop ──
  const simRef = React.useRef({ progIdx: null, sim: null });
  const [simView, setSimView] = React.useState(null);
  const shown = draft ? { ...prog, rungs: draft.rungs, tags: draft.tags } : prog;
  React.useEffect(() => {
    if (!prog) return;
    if (simRef.current.progIdx !== prog.idx + (draft ? ':d' : '')) simRef.current = { progIdx: prog.idx + (draft ? ':d' : ''), sim: ladNewSim(shown) };
    const iv = setInterval(() => {
      const s = simRef.current.sim;
      s.power = ladScan(shown, s, 120, forcesRef.current, source.mode);
      // Publish the live scan so the SubNet-neuron panel can react to the
      // running program in real time -- the neurons read this, not a backend.
      window.__LADDER_SIM = { vals: s.vals, box: s.box, t: s.t, asset: shown.asset,
                              rungs: shown.rungs.length, tags: shown.tags,
                              findings: (window.__LADDER_FINDINGS || []) };
      setSimView({ t: s.t });
    }, 120);
    return () => clearInterval(iv);
  }, [prog && prog.idx, draft, shown.rungs, shown.tags]); // eslint-disable-line
  const sim = simRef.current.sim;
  // ── findings (live program + all programs for the tree) ──
  const findings = React.useMemo(() => ladAnalyse(shown), [shown]);
  React.useEffect(() => { window.__LADDER_FINDINGS = findings; }, [findings]);
  const allStatus = React.useMemo(() => { const m = {}; progs.forEach((p) => { const f = ladAnalyse(p); m[p.idx] = f.some((x) => x.sev === 'crit') ? 'crit' : f.some((x) => x.sev === 'warn') ? 'warn' : 'ok'; }); return m; }, [progs]);
  const findingsByRung = React.useMemo(() => { const m = {}; findings.forEach((f) => f.rungs.forEach((r) => (m[r] = m[r] || []).push(f))); return m; }, [findings]);
  // header critical alerts, once per program+rule
  const notifSent = React.useRef({});
  React.useEffect(() => {
    progs.forEach((p) => { if (allStatus[p.idx] !== 'crit') return; const k = 'p' + p.idx;
      if (notifSent.current[k]) return; notifSent.current[k] = 1;
      const f = ladAnalyse(p).find((x) => x.sev === 'crit');
      onNotif && onNotif('Ladder: ' + p.asset + ' ' + f.rule + ' — ' + f.summary, p.idx);
    });
  }, [allStatus]); // eslint-disable-line
  // ── deep link from the sensor wall ──
  const handleJump = React.useCallback((d) => {
    d = d || {};
    let target = d.progIdx != null ? byId[d.progIdx] : null;
    if (!target && d.cls) {
      const c = String(d.cls).toUpperCase();
      target = progs.find((p) => c.indexOf(p.cls) > -1);
      if (!target) {
        const KEY = [['HYDRAUL', null, 'hydraulic-power'], ['CONV', 'CONV'], ['BELT', 'CONV'], ['ASSEMBLY', 'CONV'], ['ROLLER', 'CONV'], ['LINE', 'CONV'], ['PUMP', 'PUMP'], ['PRESS', 'PRESS'], ['STAMP', 'PRESS'], ['CHILL', 'CHILLER'], ['COMPRESS', 'COMPRESSOR'], ['AIR', 'COMPRESSOR'], ['ROBOT', 'ROBOT'], ['WELD', 'ROBOT'], ['SPINDLE', 'DEBURR'], ['PAINT', 'OVEN'], ['BOOTH', 'OVEN'], ['OVEN', 'OVEN'], ['FURNACE', 'OVEN'], ['HEAT', 'OVEN'], ['FILTER', 'FILTER'], ['DUST', 'FILTER'], ['HVAC', 'HVAC'], ['LIFT', 'LIFT'], ['CRANE', 'LIFT'], ['AGV', 'LIFT'], ['VISION', 'VISION'], ['INSPECT', 'VISION'], ['SORT', 'SORTER'], ['PACK', 'SORTER'], ['MIX', 'MIXER'], ['TRIM', 'TRIM'], ['DEBURR', 'DEBURR'], ['UPS', 'UPS'], ['POWER', 'UPS'], ['TANK', 'VALVE'], ['VALVE', 'VALVE']];
        for (let k = 0; k < KEY.length; k++) { const kw = KEY[k];
          if (c.indexOf(kw[0]) > -1) { target = kw[2] ? progs.find((p) => p.archetype === kw[2]) : progs.find((p) => p.cls === kw[1]); if (target) break; } }
      }
    }
    if (target) { setSel(target.idx); setOpenCls((o) => ({ ...o, [target.cls]: true })); setDraft(null); }
  }, [progs, byId]);
  React.useEffect(() => {
    const f = (e) => handleJump(e.detail);
    window.addEventListener('nephes:ladder', f); return () => window.removeEventListener('nephes:ladder', f);
  }, [handleJump]);
  React.useEffect(() => { if (jump && jump.current) { handleJump(jump.current); jump.current = null; } }, []); // eslint-disable-line
  const persist = (patch) => ladSaveStore(patch);
  /* ── draft ops ── */
  const openDraft = (focus) => { if (readOnly || draft) return;
    setDraft({ rungs: prog.rungs.map((r, i) => ({ c: r.c, t: r.t, dis: !!r.dis, orig: i })), tags: prog.tags.map((t) => ({ ...t })), note: '' });
    setRail('nephes'); ladCommand('ladder.draft.open', { program: prog.file });
    toast('Draft opened — edits stay here until you apply them'); logAction(prog.asset, 'Ladder draft opened · ' + prog.routine);
  };
  const closeDraft = () => { setDraft(null); setPalette(null); setPicker(null); };
  const dPatch = (rungs, tags) => setDraft((d) => ({ ...d, rungs: rungs || d.rungs, tags: tags || d.tags }));
  const markMod = (r, i, orig) => { const o = r.orig == null ? null : prog.rungs[r.orig]; r.mark = !o ? 'new' : (r.t !== o.t || r.c !== o.c || !!r.dis !== !!o.dis ? 'mod' : null); return r; };
  const remark = (rungs) => rungs.map((r, i) => markMod({ ...r }, i));
  const onRungAct = (ri, act) => setDraft((d) => {
    const rungs = d.rungs.slice();
    if (act === 'del') rungs.splice(ri, 1);
    if (act === 'dis') rungs[ri] = { ...rungs[ri], dis: !rungs[ri].dis };
    if (act === 'up' && ri > 0) { const t = rungs[ri - 1]; rungs[ri - 1] = rungs[ri]; rungs[ri] = t; }
    if (act === 'down' && ri < rungs.length - 1) { const t = rungs[ri + 1]; rungs[ri + 1] = rungs[ri]; rungs[ri] = t; }
    return { ...d, rungs: remark(rungs) };
  });
  const addRung = () => setDraft((d) => {
    const coil = (d.tags.find((t) => t.dt === 'BOOL' && /Run|Output|Permit|Ready/.test(t.n)) || d.tags[0] || { n: prog.asset + '_Run' }).n;
    const cond = prog.asset + '_New_Cond';
    const tags = d.tags.find((t) => t.n === cond) ? d.tags : d.tags.concat([{ n: cond, dt: 'BOOL', pre: null, acc: 'Read/Write' }]);
    return { ...d, tags, rungs: remark(d.rungs.concat([{ c: 'New rung', t: 'XIC(' + cond + ')OTE(' + coil + ');', dis: false, orig: null }])) };
  });
  const editComment = (ri) => { const c = window.prompt('Rung comment:', draft.rungs[ri].c); if (c == null) return;
    setDraft((d) => { const rungs = d.rungs.slice(); rungs[ri] = { ...rungs[ri], c }; return { ...d, rungs: remark(rungs) }; }); };
  // insert palette instruction at slot (slots are between input elements; append semantics)
  const onSlot = (ri, slotKey) => { if (!palette) return; setPicker({ kind: 'insert', ri, slotKey, mn: palette }); };
  const onElement = (ri, path, el) => {
    if (draft) { setPicker({ kind: 'edit', ri, path, el }); return; }
    if (LAD_TIMERISH[el.mn]) { // live preset tweak: open a draft with the preset editor focused
      if (!readOnly && !armed) { openDraft(); setTimeout(() => setPicker({ kind: 'edit', ri, path, el }), 60); }
      return;
    }
    if (armed && el.ops[0]) { // force cycle: none → 1 → 0 → clear
      const tag = el.ops[0]; const f = forcesRef.current;
      const cur = f[tag]; const nxt = cur == null ? 1 : cur === 1 ? 0 : null;
      if (nxt == null) delete f[tag];else f[tag] = nxt;
      forceTick((x) => x + 1);
      ladCommand('ladder.force', { program: prog.file, tag, value: nxt });
      toast(nxt == null ? 'Force removed from ' + tag : tag + ' forced to ' + nxt, nxt == null ? 'ok' : 'warn');
      logAction(prog.asset, nxt == null ? 'Force removed · ' + tag : 'Forced ' + tag + ' = ' + nxt);
    }
  };
  const applyPick = (tag, extra) => {
    const p = picker; if (!p) return;
    setDraft((d) => {
      const rungs = d.rungs.slice(); let tags = d.tags;
      const struct = ladParseStruct(rungs[p.ri].t);
      const flatten = []; const walk = (els, parent) => els.forEach((e, i) => { flatten.push({ e, els, i }); if (e.kind === 'branch') e.alts.forEach((a) => walk(a, e)); });
      walk(struct, null);
      if (p.kind === 'edit') {
        const hit = flatten.find((x) => x.e.mn === p.el.mn && JSON.stringify(x.e.ops) === JSON.stringify(p.el.ops));
        if (hit) { if (extra === 'delete') hit.els.splice(hit.i, 1);else { hit.e.ops = [tag].concat(hit.e.ops.slice(1)); if (extra && extra !== hit.e.mn) hit.e.mn = extra; } }
      } else {
        const isOut = (e) => e.kind === 'el' && (/^OT/.test(e.mn) || e.mn === 'RES' || LAD_TIMERISH[e.mn]);
        const insertAt = struct.findIndex(isOut);
        const el = p.mn === 'BRANCH' ?
        { kind: 'branch', alts: [[{ kind: 'el', mn: 'XIC', ops: [tag] }], [{ kind: 'el', mn: 'XIC', ops: [tag] }]] } :
        { kind: 'el', mn: p.mn, ops: LAD_TIMERISH[p.mn] ? [tag, '?', '?'] : [tag] };
        if (/^OT|^RES|TON|RTO|CTU/.test(p.mn) && p.mn !== 'BRANCH') struct.push(el);else
        struct.splice(insertAt < 0 ? struct.length : insertAt, 0, el);
        if (LAD_TIMERISH[p.mn] && !d.tags.find((t) => t.n === tag)) tags = d.tags.concat([{ n: tag, dt: p.mn === 'CTU' ? 'COUNTER' : 'TIMER', pre: 5000, acc: 'Read/Write' }]);
        if (!LAD_TIMERISH[p.mn] && !d.tags.find((t) => t.n === tag)) tags = d.tags.concat([{ n: tag, dt: 'BOOL', pre: null, acc: 'Read/Write' }]);
      }
      rungs[p.ri] = { ...rungs[p.ri], t: ladSerialize(struct) };
      return { ...d, rungs: remark(rungs), tags };
    });
    setPicker(null); setPalette(null);
  };
  const setPreset = (tagName, pre) => setDraft((d) => ({ ...d, tags: d.tags.map((t) => t.n === tagName ? { ...t, pre: +pre || 0 } : t) }));
  /* ── diff for review ── */
  const diff = React.useMemo(() => {
    if (!draft) return null;
    const rows = [];
    const seen = {};
    draft.rungs.forEach((r, i) => {
      const o = r.orig == null ? null : prog.rungs[r.orig];
      if (!o) rows.push({ kind: 'add', i, r });else {
        seen[r.orig] = 1;
        if (o.t !== r.t || o.c !== r.c || !!o.dis !== !!r.dis || r.orig !== i) rows.push({ kind: o.t !== r.t || o.c !== r.c || !!o.dis !== !!r.dis ? 'mod' : 'move', i, r, o, oi: r.orig });
      }
    });
    prog.rungs.forEach((o, oi) => { if (!seen[oi]) rows.push({ kind: 'del', oi, o }); });
    const presets = draft.tags.filter((t) => { const o = prog.tags.find((x) => x.n === t.n); return o && o.pre !== t.pre; }).map((t) => ({ n: t.n, from: prog.tags.find((x) => x.n === t.n).pre, to: t.pre }));
    const newTags = draft.tags.filter((t) => !prog.tags.find((x) => x.n === t.n));
    return { rows, presets, newTags };
  }, [draft, prog]);
  const draftFindings = React.useMemo(() => draft ? ladAnalyse({ ...prog, rungs: draft.rungs, tags: draft.tags }) : [], [draft, prog]);
  const blast = React.useMemo(() => {
    if (!diff) return [];
    const tags = new Set();
    diff.rows.forEach((x) => { ladParseFlat((x.r || x.o).t).forEach((ins) => ins.ops.forEach((o) => tags.add(ladBase(o)))); });
    diff.presets.forEach((p) => tags.add(p.n));
    const readers = [];
    Array.from(tags).forEach((t) => {
      draft.rungs.forEach((r, i) => { if (r.t.indexOf(t) > -1) readers.push(t + ' → rung ' + i); });
    });
    return { tags: Array.from(tags), readers: readers.slice(0, 10), zone: prog.cls + ' assets (' + (corpus.byClass[prog.cls] || []).length + ' programs share this class)' };
  }, [diff, draft, prog]);
  const nephesSay = React.useMemo(() => {
    if (!diff) return '';
    const c = draftFindings.filter((f) => f.sev === 'crit'), w = draftFindings.filter((f) => f.sev === 'warn');
    const n = (k) => diff.rows.filter((x) => x.kind === k).length;
    const bits = [];
    if (n('add')) bits.push('adds ' + n('add') + ' rung' + (n('add') > 1 ? 's' : ''));
    if (n('del')) bits.push('removes ' + n('del') + ' rung' + (n('del') > 1 ? 's' : ''));
    if (n('mod')) bits.push('modifies ' + n('mod') + ' rung' + (n('mod') > 1 ? 's' : ''));
    if (n('move')) bits.push('reorders ' + n('move') + ' rung' + (n('move') > 1 ? 's' : ''));
    if (diff.presets.length) bits.push('retunes ' + diff.presets.map((p) => p.n.replace(prog.asset + '_', '') + ' ' + p.from + '→' + p.to + ' ms').join(', '));
    let s = bits.length ? 'This change ' + bits.join(', ') + ' on ' + prog.routine + '.' : 'The draft currently matches the running program — nothing to apply yet.';
    if (c.length) s += ' ⚠ It would ship ' + c.length + ' critical finding(s): ' + c.map((f) => f.rule + ' on ' + f.tag.replace(prog.asset + '_', '')).join('; ') + '. ' + c[0].detail;
    else if (w.length) s += ' It carries ' + w.length + ' warning(s) — ' + w.map((f) => f.rule).join(', ') + ' — review the suggestion notes before applying.';
    else if (bits.length) s += ' Static analysis is clean: no dual coils, dangling latches, dead rungs or zero presets. NEPHES sees no reason to hold it.';
    s += ' Advisory only — the operator decides.';
    return s;
  }, [diff, draftFindings, prog]);
  /* ── apply / revert ── */
  const doApply = (note) => {
    const snap = { ts: Date.now(), rungs: prog.rungs.map((r) => ({ c: r.c, t: r.t, dis: !!r.dis })), tags: prog.tags.map((t) => ({ ...t })), note: 'before: ' + (note || 'edit') };
    const nextRungs = draft.rungs.map((r) => ({ c: r.c, t: r.t, dis: !!r.dis }));
    const v = { ...versions, [prog.idx]: (versions[prog.idx] || []).concat([snap]).slice(-12) };
    const o = { ...over, [prog.idx]: { rungs: nextRungs, tags: draft.tags, ts: Date.now() } };
    const crit = draftFindings.filter((f) => f.sev === 'crit').length;
    const entry = { ts: Date.now(), prog: prog.file, asset: prog.asset, summary: note || diff.rows.length + ' rung change(s)' + (diff.presets.length ? ', ' + diff.presets.length + ' preset(s)' : ''), crit };
    const a = [entry].concat(audit).slice(0, 60);
    setVersions(v); setOver(o); setAudit(a); persist({ versions: v, over: o, audit: a });
    setReview(false); closeDraft();
    ladCommand('ladder.apply', { program: prog.file, changes: diff.rows.length, presets: diff.presets.length, findings: draftFindings.length });
    logAction(prog.asset, 'Ladder change applied · ' + entry.summary);
    toast('Applied to ' + prog.asset + ' — running program updated');
    if (crit) onNotif && onNotif('Ladder: ' + prog.asset + ' applied with ' + crit + ' critical finding(s)', prog.idx);
  };
  const doRevert = (vi) => {
    const list = versions[prog.idx] || []; const snap = list[vi]; if (!snap) return;
    const o = { ...over, [prog.idx]: { rungs: snap.rungs, tags: snap.tags, ts: Date.now() } };
    const entry = { ts: Date.now(), prog: prog.file, asset: prog.asset, summary: 'reverted to snapshot of ' + new Date(snap.ts).toTimeString().slice(0, 8), crit: 0 };
    const a = [entry].concat(audit).slice(0, 60);
    setOver(o); setAudit(a); persist({ over: o, audit: a });
    ladCommand('ladder.revert', { program: prog.file });
    logAction(prog.asset, 'Ladder reverted · ' + prog.routine); toast('Reverted ' + prog.asset + ' to earlier version', 'warn');
  };
  const doFactory = () => {
    if (!over[prog.idx]) return;
    const o = { ...over }; delete o[prog.idx];
    setOver(o); persist({ over: o });
    toast('Restored factory program for ' + prog.asset);
  };
  /* ── import / export ── */
  const fileRef = React.useRef(null);
  const importL5X = (text, fname) => {
    try {
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      const ctrl = doc.querySelector('Controller');
      const name = ctrl.getAttribute('Name') || 'IMPORTED_CTRL';
      const routine = doc.querySelector('Routine');
      const tags = Array.from(doc.querySelectorAll('Controller > Tags > Tag')).map((t) => ({
        n: t.getAttribute('Name'), dt: t.getAttribute('DataType') || 'BOOL',
        pre: (() => { const p = t.querySelector('DataValueMember[Name="PRE"]'); return p ? +p.getAttribute('Value') : null; })(),
        acc: t.getAttribute('ExternalAccess') || 'Read/Write' }));
      const rungs = Array.from(doc.querySelectorAll('Rung')).map((r) => ({
        c: (r.querySelector('Comment') || {}).textContent || '', t: (r.querySelector('Text') || {}).textContent || '' }));
      if (!rungs.length) { toast('No rungs found in that file', 'warn'); return; }
      const asset = name.replace(/_CTRL$/, '');
      const p = { file: fname || name + '.L5X', controller: name, asset, cls: 'IMPORTED', archetype: 'imported', title: 'Imported program', subsystem: 'imported', routine: routine ? routine.getAttribute('Name') : name, tags, rungs, planted: [] };
      const imp = imported.concat([p]); setImported(imp); persist({ imported: imp });
      setSel(1000 + imp.length - 1); setOpenCls((o) => ({ ...o, IMPORTED: true }));
      toast('Imported ' + p.file + ' — ' + rungs.length + ' rungs'); logAction(asset, 'Ladder program imported · ' + p.file);
    } catch (e) { toast('Import failed — not a readable L5X export', 'crit'); }
  };
  const pasteText = () => {
    const s = window.prompt('Paste neutral text (rungs end with ; — e.g. XIC(Tag_A)OTE(Tag_B);):');
    if (!s) return;
    const rungs = s.split(';').map((x) => x.trim()).filter(Boolean).map((t) => ({ c: 'Pasted logic', t: t + ';' }));
    if (!rungs.length) { toast('No ladder instructions found in the supplied text', 'warn'); return; }
    const p = { file: 'pasted_snippet.L5X', controller: 'SNIPPET', asset: 'SNIPPET', cls: 'IMPORTED', archetype: 'snippet', title: 'Pasted snippet (no declarations — degraded analysis)', subsystem: 'imported', routine: '(proposed)', tags: [], rungs, planted: [], degraded: true };
    const imp = imported.concat([p]); setImported(imp); persist({ imported: imp });
    setSel(1000 + imp.length - 1); setOpenCls((o) => ({ ...o, IMPORTED: true }));
    toast('Snippet parsed — ' + rungs.length + ' rung(s), analysis degraded without declarations', 'warn');
  };
  const duplicate = () => {
    const p = { ...prog, file: prog.file.replace('.L5X', '_COPY.L5X'), asset: prog.asset, cls: 'IMPORTED', title: prog.title + ' (copy)', rungs: prog.rungs.map((r) => ({ ...r })), tags: prog.tags.map((t) => ({ ...t })), planted: [] };
    const imp = imported.concat([p]); setImported(imp); persist({ imported: imp });
    setSel(1000 + imp.length - 1); setOpenCls((o) => ({ ...o, IMPORTED: true }));
    toast('Duplicated as template — edit freely, the source program is untouched');
  };
  const newProgram = () => {
    let name = window.prompt('Name your new program (letters, numbers, underscores — e.g. MY_PRESS):', 'MY_MACHINE');
    if (name == null) return;
    name = name.trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'CUSTOM';
    // A working start/stop seal-in as the first rung, so the program analyses
    // and simulates from the moment it is created rather than starting blank.
    const tags = [
      { n: name + '_Start_PB', dt: 'BOOL', pre: null, acc: 'Read/Write' },
      { n: name + '_Stop_PB', dt: 'BOOL', pre: null, acc: 'Read/Write' },
      { n: name + '_Run', dt: 'BOOL', pre: null, acc: 'Read/Write' },
    ];
    const rungs = [{ c: 'Start/stop seal-in — your first rung. Open EDIT DRAFT to add more and build the program.',
                     t: 'XIO(' + name + '_Stop_PB)[XIC(' + name + '_Start_PB),XIC(' + name + '_Run)]OTE(' + name + '_Run);' }];
    const p = { file: name + '.L5X', controller: name + '_CTRL', asset: name, cls: 'CUSTOM', archetype: 'custom',
                title: 'Custom program', subsystem: 'custom', routine: name + '_Main', tags, rungs, planted: [] };
    const imp = imported.concat([p]); setImported(imp); persist({ imported: imp });
    setSel(1000 + imp.length - 1); setOpenCls((o) => ({ ...o, CUSTOM: true }));
    toast('New program “' + name + '” created — it saves automatically. Hit EDIT DRAFT to build it.');
    logAction(name, 'Custom ladder program created · ' + p.file);
  };
  const exportL5X = () => {
    const xml = corpus.toL5X(shown.tags ? { ...shown, controller: shown.controller || prog.asset + '_CTRL' } : prog);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = prog.file;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Exported ' + prog.file);
  };
  /* ── demo ── */
  const [demo, setDemo] = React.useState(null);
  const demoTimers = React.useRef([]);
  const endLadDemo = () => { demoTimers.current.forEach(clearTimeout); demoTimers.current = []; setDemo(null); };
  const runLadDemo = () => {
    endLadDemo(); closeDraft();
    const target = progs.find((p) => p.idx === 2) || progs[0]; // PRESS_03 vfd-control — planted dual-coil
    const steps = [
    [0, () => { setSel(target.idx); setOpenCls((o) => ({ ...o, [target.cls]: true })); setRail('nephes'); }, 'PRESS_03 carries a planted dual-coil — two rungs drive Running. NEPHES flags it on the right.'],
    [7000, () => { setDraft({ rungs: target.rungs.map((r, i) => ({ c: r.c, t: r.t, dis: !!r.dis, orig: i })), tags: target.tags.map((t) => ({ ...t })), note: '' }); setRail('nephes'); }, 'Open a draft — the running program keeps scanning while you edit.'],
    [13000, () => setDraft((d) => d && { ...d, rungs: remark(d.rungs.filter((r, i) => !/Manual_Override/.test(r.t))) }), 'Delete the commissioning override rung that duplicates the coil.'],
    [19000, () => setReview(true), 'Review: rung-by-rung diff, re-run findings, blast radius — NEPHES explains in plain language.'],
    [27000, () => { setReview(false); }, 'The operator decides. Apply pushes it to the controller and writes the audit trail.'],
    [31000, () => { closeDraft(); setRail('history'); }, 'Every applied change lands in History with one-click revert.'],
    [36000, '__END__', '']];
    steps.forEach(([at, fn, cap], i) => {
      const t = setTimeout(() => { if (fn === '__END__') { endLadDemo(); return; } fn && fn(); setDemo({ text: cap, i: i + 1, n: steps.length - 1 }); }, at);
      demoTimers.current.push(t);
    });
  };
  React.useEffect(() => () => endLadDemo(), []); // eslint-disable-line
  /* ── tree data ── */
  const classes = React.useMemo(() => {
    const m = {}; progs.forEach((p) => { (m[p.cls] = m[p.cls] || []).push(p); });
    return Object.keys(m).sort().map((k) => ({ cls: k, list: m[k] }));
  }, [progs]);
  const qq = q.trim().toLowerCase();
  const terms = qq ? qq.split(/\s+/) : [];
  const match = (p) => { if (!terms.length) return true; const hay = (p.file + ' ' + p.routine + ' ' + p.archetype + ' ' + p.title).toLowerCase(); return terms.every((t) => hay.indexOf(t) > -1); };
  /* ── render ── */
  const stTag = allStatus[prog.idx];
  const watchTags = shown.tags;
  const fmtT = (ts) => new Date(ts).toTimeString().slice(0, 8);
  return (
    <div className="lad-page fade-in">
      {/* ── left: program tree ── */}
      <div className="lad-tree">
        <div className="lad-search"><input placeholder={'Search ' + progs.length + ' programs…'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="lad-tree-scroll">
          {classes.map(({ cls, list }) => {
            const vis = list.filter(match); if (!vis.length) return null;
            const open = openCls[cls] || !!qq;
            const worst = vis.reduce((w, p) => allStatus[p.idx] === 'crit' ? 'crit' : w === 'crit' ? w : allStatus[p.idx] === 'warn' ? 'warn' : w, 'ok');
            return (
              <div key={cls}>
                <button className="lad-cls" onClick={() => setOpenCls((o) => ({ ...o, [cls]: !o[cls] }))}>
                  <span className={`lad-cls-dot ${worst}`} /><span className="lad-cls-name">{cls}</span><span className="lad-cls-n">{vis.length}</span><span className="lad-cls-car">{open ? '▾' : '▸'}</span>
                </button>
                {open && vis.map((p) =>
                <button key={p.idx} className={`lad-prog ${p.idx === sel ? 'active' : ''}`} onClick={() => { setSel(p.idx); closeDraft(); }}>
                    <span className={`lad-p-dot ${allStatus[p.idx]}`} />
                    <span className="lad-p-name">{p.asset}</span>
                    <span className="lad-p-arch">{p.archetype}</span>
                    {over[p.idx] && <span className="lad-p-edit" title="Locally modified — differs from factory program">●</span>}
                  </button>)}
              </div>);
          })}
        </div>
        <div className="lad-tree-foot">
          <button onClick={newProgram} disabled={readOnly}>＋ New program</button>
          <button onClick={() => fileRef.current && fileRef.current.click()} disabled={readOnly}>⇪ Import L5X</button>
          <button onClick={pasteText} disabled={readOnly}>✎ Paste</button>
          <button onClick={duplicate} disabled={readOnly}>⧉ Duplicate</button>
          <input ref={fileRef} type="file" accept=".l5x,.L5X,.xml" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => importL5X(r.result, f.name); r.readAsText(f); e.target.value = ''; }} />
        </div>
      </div>
      {/* ── center: canvas ── */}
      <div className="lad-canvas">
        <div className="lad-prog-head">
          <span className="lad-routine">{prog.routine}</span>
          <span className={`lad-st ${stTag}`}>{stTag === 'crit' ? 'FINDINGS · CRITICAL' : stTag === 'warn' ? 'FINDINGS' : 'CLEAN'}</span>
          <span className={`lad-src ${live ? 'live' : readOnly ? 'off' : 'sim'}`}>{live ? '● LIVE · PLC' : readOnly ? '○ OFFLINE' : '● SIMULATOR'}</span>
          {over[prog.idx] && <span className="lad-modified" title={'Applied ' + fmtT(over[prog.idx].ts)}>MODIFIED</span>}
          <span className="lad-head-spacer" />
          <button className="lad-hbtn" onClick={() => demo ? endLadDemo() : runLadDemo()}>{demo ? '■ Stop demo' : '▶ Demo'}</button>
          <button className="lad-hbtn" onClick={exportL5X}>⤓ L5X</button>
          <button className={`lad-hbtn arm ${armed ? 'on' : ''}`} disabled={readOnly} onClick={() => { if (armed) { setArmed(false); forcesRef.current = {}; forceTick((x) => x + 1); toast('Forces disarmed — all forces removed'); logAction(prog.asset, 'Forces disarmed'); } else setArmAsk(true); }}>
            {armed ? '⚡ FORCES ARMED' : 'ARM FORCES'}
          </button>
          {!draft && <button className="lad-hbtn edit" disabled={readOnly} onClick={() => openDraft()}>✎ EDIT DRAFT</button>}
          {draft && <button className="lad-hbtn cancel" onClick={closeDraft}>✕ Discard</button>}
          {draft && <button className="lad-hbtn apply" onClick={() => setReview(true)}>REVIEW &amp; APPLY →</button>}
        </div>
        {readOnly && <div className="lad-banner off">Backend unreachable — the controller connection is down. Live values are frozen and the program is <b>read-only</b>: drafts, forces and imports are disabled until the link recovers. <button onClick={() => NEPHES_SOURCE.test().then((r) => toast(r.msg, r.ok ? 'ok' : 'warn'))}>Retry connection</button></div>}
        {armed && !readOnly && <div className="lad-banner arm">⚡ Forces armed — click any contact or coil (or a Watch row) to cycle force <b>1 → 0 → clear</b>. Forces override real I/O; disarm when done.</div>}
        {prog.degraded && <div className="lad-banner deg">Snippet without tag declarations — zero-preset-timer, unreachable-rung and unused-tag cannot be evaluated. Findings here are a weaker statement than on a full export.</div>}
        {draft && <div className="lad-palette">
          <span className="lad-pal-l">PALETTE</span>
          {LAD_PALETTE.map((p) => <button key={p.mn} className={`lad-pal-btn ${palette === p.mn ? 'active' : ''}`} title={p.desc} onClick={() => setPalette(palette === p.mn ? null : p.mn)}><span className="lp-sym">{p.label}</span>{p.name}</button>)}
          <span className="lad-pal-hint">{palette ? 'now click a ＋ slot on a rung' : 'pick an instruction, then a slot on a rung'}</span>
          <button className="lad-pal-add" onClick={addRung}>＋ New rung</button>
        </div>}
        <div className="lad-rungs">
          {shown.rungs.map((r, ri) =>
          <LadRung key={ri + ':' + r.t} prog={prog} rung={r} ri={ri} sim={sim} draft={!!draft} palette={palette}
          onSlot={onSlot} onElement={onElement} onComment={editComment} onRungAct={onRungAct}
          forcesArmed={armed} forces={forcesRef.current} findingsByRung={findingsByRung} readOnly={readOnly} />)}
          {draft && <button className="lad-rung-add" onClick={addRung}>＋ Add rung</button>}
        </div>
      </div>
      {/* ── right rail ── */}
      <div className="lad-side">
        <div className="lad-rtabs">
          {[['watch', 'WATCH'], ['nephes', 'NEPHES'], ['subnets', 'SUBNETS'], ['history', 'HISTORY']].map(([k, l]) =>
          <button key={k} className={`lad-rtab ${rail === k ? 'active' : ''}`} onClick={() => setRail(k)}>{l}{k === 'nephes' && findings.length > 0 && <i className={`lad-rtab-n ${findings.some((f) => f.sev === 'crit') ? 'crit' : 'warn'}`}>{findings.length}</i>}</button>)}
        </div>
        <div className="lad-rail-body">
            {/* Which experts are speaking about THIS program, and whether any of
                them is worth believing. Mounted beside the ladder deliberately:
                a confident claim from a quarantined SubNet reads exactly like a
                useful one, so the verdict has to arrive with the claim. */}
            {rail === 'subnets' && <SubNetSlot program={prog} />}
          {rail === 'watch' && <div className="lad-watch">
            <div className="lad-watch-head"><span>TAG</span><span>VALUE</span></div>
            {watchTags.map((t) => {
              const isBox = t.dt === 'TIMER' || t.dt === 'COUNTER';
              const bx = isBox && sim ? sim.box[t.n] : null;
              const v = !isBox && sim && sim.disp ? !!sim.disp[t.n] : false;
              const forced = forcesRef.current[t.n] != null;
              return (
                <div key={t.n} className={`lad-wrow ${armed && !isBox ? 'clickable' : ''} ${forced ? 'forced' : ''}`} onClick={armed && !isBox && !readOnly ? () => onElement(null, null, { ops: [t.n] }) : undefined}>
                  <span className="lad-wtag">{t.n.replace(prog.asset + '_', '')}{forced && ' ⚡'}</span>
                  {isBox ?
                  <span className="lad-wval box">{bx ? 'ACC ' + Math.round(bx.ACC) + ' / ' + bx.PRE : 'PRE ' + (t.pre || 0)}{bx && bx.DN ? ' · DN' : ''}</span> :
                  <span className={`lad-wval ${v ? 'on' : ''}`}>{v ? '1 ●' : '0'}</span>}
                </div>);
            })}
            <div className="lad-watch-note">{armed ? 'Forces armed — click a bit row to cycle its force.' : 'Live values from the scan. Arm forces to override a bit.'}</div>
          </div>}
          {rail === 'nephes' && <div className="lad-nephes">
            {findings.length === 0 && <div className="lad-clean">✓ Static analysis clean — no dual coils, dangling latches, dead rungs, zero presets or unused tags.</div>}
            {findings.map((f, i) =>
            <div key={i} className={`lad-find ${f.sev}`}>
                <div className="lad-find-top"><span className={`lad-sev ${f.sev}`}>{f.sev === 'crit' ? 'CRITICAL' : f.sev === 'warn' ? 'WARNING' : 'INFO'}</span><span className="lad-find-rule">{f.rule}</span></div>
                <div className="lad-find-sum">{f.summary}</div>
                <div className="lad-find-det">{f.detail}</div>
                <div className="lad-find-fix">→ {f.suggestion}</div>
                {f.rungs.length > 0 && <div className="lad-find-rungs">{f.rungs.map((r) => <button key={r} onClick={() => { const el = document.querySelector('.lad-rungs [data-rung="' + r + '"]'); if (el && el.offsetParent) el.offsetParent.scrollTop = el.offsetTop - 60; }}>rung {r}</button>)}</div>}
              </div>)}
            <div className="lad-adv-note">Findings are deterministic static rules from the program pack — NEPHES explains them and suggests fixes, but never edits a running program itself. Advisory only.</div>
          </div>}
          {rail === 'history' && <div className="lad-hist">
            <div className="lad-hist-sec">VERSIONS · {prog.asset}</div>
            {(versions[prog.idx] || []).length === 0 && <div className="lad-hist-empty">No snapshots yet — a snapshot is taken automatically each time a draft is applied.</div>}
            {(versions[prog.idx] || []).map((v, i) =>
            <div key={i} className="lad-ver">
                <span className="lad-ver-t">{fmtT(v.ts)}</span>
                <span className="lad-ver-n">{v.rungs.length} rungs</span>
                <button className="lad-ver-btn" disabled={readOnly} onClick={() => doRevert(i)}>↺ Revert</button>
              </div>)}
            {over[prog.idx] && <button className="lad-factory" disabled={readOnly} onClick={doFactory}>⟲ Restore factory program</button>}
            <div className="lad-hist-sec" style={{ marginTop: 12 }}>AUDIT TRAIL · ALL PROGRAMS</div>
            {audit.length === 0 && <div className="lad-hist-empty">Every applied change lands here with its findings count.</div>}
            {audit.slice(0, 14).map((a, i) =>
            <div key={i} className="lad-audit">
                <span className="lad-audit-t">{fmtT(a.ts)}</span>
                <span className="lad-audit-m"><b>{a.asset}</b> · {a.summary}{a.crit ? <i className="lad-audit-crit"> · {a.crit} critical</i> : null}</span>
              </div>)}
          </div>}
        </div>
      </div>
      {/* ── arm confirm (two-step) ── */}
      {armAsk && <div className="modal-scrim" onMouseDown={() => setArmAsk(false)}>
        <div className="lad-arm-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">ARM FORCES<button className="modal-close" onClick={() => setArmAsk(false)}>✕</button></div>
          <div className="lad-arm-body">
            <p>Forcing overrides real I/O on <b>{prog.asset}</b>. While armed, clicking any contact, coil or Watch row writes a force to the running controller — the machine will act on it.</p>
            <p className="lad-arm-warn">⚠ Interlocks and permissives can be defeated by a force. Disarm removes every force at once.</p>
            <button className="lad-arm-go" onClick={() => { setArmed(true); setArmAsk(false); toast('Forces armed on ' + prog.asset, 'warn'); logAction(prog.asset, 'Forces ARMED — operator override active'); ladCommand('ladder.forces.arm', { program: prog.file }); }}>⚡ Arm forces</button>
          </div>
        </div>
      </div>}
      {/* ── tag picker for insert/edit ── */}
      {picker && <div className="modal-scrim" onMouseDown={() => setPicker(null)}>
        <div className="lad-pick" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">{picker.kind === 'insert' ? 'INSERT ' + picker.mn : 'EDIT ' + picker.el.mn + ' · ' + (picker.el.ops[0] || '')}<button className="modal-close" onClick={() => setPicker(null)}>✕</button></div>
          <LadTagPick prog={prog} draft={draft} picker={picker} onPick={applyPick} onPreset={setPreset} />
        </div>
      </div>}
      {/* ── review modal ── */}
      {review && diff && <div className="modal-scrim" onMouseDown={() => setReview(false)}>
        <div className="lad-review" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">REVIEW &amp; APPLY · {prog.routine}<button className="modal-close" onClick={() => setReview(false)}>✕</button></div>
          <div className="lad-rev-body">
            <div className="lad-rev-sec">RUNG-BY-RUNG DIFF</div>
            {diff.rows.length === 0 && diff.presets.length === 0 && <div className="lad-rev-none">No changes yet — the draft matches the running program.</div>}
            {diff.rows.map((x, i) =>
            <div key={i} className={`lad-diff ${x.kind}`}>
                <span className="lad-diff-k">{x.kind === 'add' ? '+ NEW' : x.kind === 'del' ? '− REMOVED' : x.kind === 'move' ? '⇅ MOVED' : '± MODIFIED'}</span>
                {x.kind !== 'add' && x.o && <div className="lad-diff-t old">R{x.oi} {x.o.t}</div>}
                {x.kind !== 'del' && x.r && <div className="lad-diff-t new">R{x.i} {x.r.dis ? '[DISABLED] ' : ''}{x.r.t}</div>}
              </div>)}
            {diff.presets.map((p, i) => <div key={'p' + i} className="lad-diff pre"><span className="lad-diff-k">± PRESET</span><div className="lad-diff-t new">{p.n}: {p.from} → <b>{p.to}</b> ms</div></div>)}
            {diff.newTags.length > 0 && <div className="lad-diff add"><span className="lad-diff-k">+ TAGS</span><div className="lad-diff-t new">{diff.newTags.map((t) => t.n).join(' · ')}</div></div>}
            <div className="lad-rev-sec">FINDINGS ON THE DRAFT</div>
            {draftFindings.length === 0 && <div className="lad-rev-clean">✓ Clean — the six static rules found nothing.</div>}
            {draftFindings.map((f, i) => <div key={i} className={`lad-rev-find ${f.sev}`}><span className={`lad-sev ${f.sev}`}>{f.sev === 'crit' ? 'CRITICAL' : f.sev === 'warn' ? 'WARNING' : 'INFO'}</span> {f.summary}</div>)}
            <div className="lad-rev-sec">NEPHES ADVISORY</div>
            <div className="lad-rev-neph">{nephesSay}</div>
            <div className="lad-rev-sec">BLAST RADIUS</div>
            <div className="lad-rev-blast">
              <div><b>{blast.tags ? blast.tags.length : 0} tags touched:</b> {(blast.tags || []).map((t) => t.replace(prog.asset + '_', '')).join(' · ') || '—'}</div>
              <div>{blast.zone}</div>
            </div>
          </div>
          <div className="lad-rev-foot">
            <span className="lad-rev-note">Audit entry will be written · snapshot taken for one-click revert</span>
            <button className="lad-rev-cancel" onClick={() => setReview(false)}>Keep editing</button>
            <button className="lad-rev-apply" disabled={diff.rows.length === 0 && diff.presets.length === 0 && diff.newTags.length === 0} onClick={() => doApply()}>✓ Apply to controller</button>
          </div>
        </div>
      </div>}
      {demo && <div className="demo-bar lad-demo" role="status"><span className="db-dot" /><span className="db-step">{demo.i}/{demo.n}</span><span className="db-cap">{demo.text}</span><button className="db-end" onClick={endLadDemo}>✕ End</button></div>}
    </div>);
}

function LadTagPick({ prog, draft, picker, onPick, onPreset }) {
  const tags = (draft ? draft.tags : prog.tags);
  const isEdit = picker.kind === 'edit';
  const el = picker.el;
  const isBox = isEdit && LAD_TIMERISH[el.mn];
  const [txt, setTxt] = React.useState(isEdit ? el.ops[0] || '' : prog.asset + '_');
  const [pre, setPre] = React.useState(() => { if (!isBox) return ''; const t = tags.find((x) => x.n === ladBase(el.ops[0] || '')); return t && t.pre != null ? t.pre : ''; });
  const list = tags.filter((t) => t.n.toLowerCase().indexOf(txt.toLowerCase()) > -1).slice(0, 8);
  return (
    <div className="lad-pick-body">
      {isBox && <div className="lad-pick-pre">
        <span>PRESET (ms)</span>
        <input type="number" min="0" step="100" value={pre} onChange={(e) => setPre(e.target.value)} />
        <button onClick={() => { onPreset(ladBase(el.ops[0]), pre); onPick(el.ops[0]); }}>Set preset</button>
      </div>}
      <div className="lad-pick-tag">
        <span>{isEdit ? 'RETARGET TAG' : 'TAG'}</span>
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={prog.asset + '_New_Bit'} autoFocus={!isBox} />
      </div>
      <div className="lad-pick-list">
        {list.map((t) => <button key={t.n} onClick={() => onPick(t.n)}>{t.n}<i>{t.dt}{t.pre != null ? ' · PRE ' + t.pre : ''}</i></button>)}
        {txt && !tags.find((t) => t.n === txt) && <button className="new" onClick={() => onPick(txt)}>＋ Create “{txt}”</button>}
      </div>
      <div className="lad-pick-foot">
        {isEdit && (el.mn === 'XIC' || el.mn === 'XIO') && <button onClick={() => onPick(el.ops[0], el.mn === 'XIC' ? 'XIO' : 'XIC')}>⇄ Flip to {el.mn === 'XIC' ? 'XIO' : 'XIC'}</button>}
        {isEdit && <button className="del" onClick={() => onPick(null, 'delete')}>🗑 Delete element</button>}
      </div>
    </div>);
}

Object.assign(window, { LadderLogic });

;
// ═══ Industrial.jsx ═══
// Industrial.jsx — NEPHES Factory Observer console (faithful to DeepSkyRobotics/NFO)
// Layout: header (brand + health ring + profile pills) · 7-KPI strip ·
// main grid = Sensor Wall + side column (Detail / Operator / NEPHES AI / Live Events).
// Profiles map to the header pills: Manufacturing · Enterprise · Backend.

const PROFILES = [
{ id: 'manufacturing', name: 'Manufacturing', desc: 'Floor operations · live sensor wall' },
{ id: 'enterprise', name: 'Enterprise', desc: 'Financial view for managers' },
{ id: 'backend', name: 'Backend', desc: 'Infrastructure & data pipeline' },
{ id: 'analytics', name: 'Analytics', desc: 'Trends, zones & outcomes' },
{ id: 'logic', name: 'Logic', desc: 'Ladder programs · live edit & apply' }];

// Generic "open a detail" bus — any element can dispatch this to surface a panel.
const openInfo = (title, sub, rows, cta) => window.dispatchEvent(new CustomEvent('nephes:info', { detail: { title, sub, rows: rows || [], cta } }));
// global toast + action-log buses — every action in the console confirms itself
const toast = (msg, tone) => window.dispatchEvent(new CustomEvent('nephes:toast', { detail: { msg, tone: tone || 'ok' } }));
const logAction = (asset, act) => window.dispatchEvent(new CustomEvent('nephes:log', { detail: { asset, act } }));
// 🔊 audio alert — soft two-tone chirp for new criticals (opt-in, WebAudio)
let __nfoAudio = null;
const chirp = (kind, force) => {
  // alert chirps re-check the saved toggle at play time, so turning audio off silences
  // every open copy of the console at once (previews/user clicks pass force)
  if (!force) { try { const s = JSON.parse(localStorage.getItem('nfo_session') || '{}'); if (!s.sound) return; } catch (e) { return; } }
  try {
    __nfoAudio = __nfoAudio || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = __nfoAudio;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const tone = (f0, f1, at, dur, peak, type) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t + at);
      o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(peak, t + at + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + at); o.stop(t + at + dur + 0.05);
    };
    const k = kind || 'triple';
    if (k === 'chirp') { tone(830, 620, 0, 0.16, 0.45); tone(620, 470, 0.2, 0.24, 0.38); } else
    if (k === 'sonar') { tone(1150, 1120, 0, 1.0, 0.42); } else
    if (k === 'klaxon') { tone(240, 200, 0, 0.3, 0.3, 'sawtooth'); tone(240, 200, 0.38, 0.3, 0.3, 'sawtooth'); } else
    if (k === 'warble') { tone(760, 760, 0, 0.14, 0.42); tone(540, 540, 0.14, 0.14, 0.42); tone(760, 760, 0.28, 0.14, 0.42); tone(540, 540, 0.42, 0.16, 0.42); } else
    if (k === 'chime') { tone(880, 878, 0, 1.15, 0.36); tone(1320, 1318, 0, 0.85, 0.12); tone(1760, 1758, 0, 0.6, 0.06); } else
    { tone(940, 940, 0, 0.09, 0.45); tone(940, 940, 0.16, 0.09, 0.45); tone(940, 940, 0.32, 0.11, 0.45); } // triple beep (default)
  } catch (e) {/* audio unavailable — stay silent */}
};
const NFO_SOUNDS = [
{ id: 'chirp', name: 'Chirp', desc: 'two soft falling tones' },
{ id: 'sonar', name: 'Sonar ping', desc: 'single tone, long fade' },
{ id: 'triple', name: 'Triple beep', desc: 'three short pulses' },
{ id: 'klaxon', name: 'Klaxon', desc: 'harsh buzz — hard to miss' },
{ id: 'warble', name: 'Warble', desc: 'alternating siren tones' },
{ id: 'chime', name: 'Chime', desc: 'gentle bell' }];
// 💾 session memory — the console reopens exactly where you left off
const loadSession = () => { try { return JSON.parse(localStorage.getItem('nfo_session') || '{}') || {}; } catch (e) { return {}; } };
const NFO_SESSION = loadSession();
const saveSession = (patch) => { try { localStorage.setItem('nfo_session', JSON.stringify({ ...loadSession(), ...patch })); } catch (e) {/* storage unavailable */} };
// 🎨 appearance — user-customizable fonts, colors, sizing (applied as CSS variables)
const FONT_STACKS = {
  industrial: { name: 'Industrial', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  grotesk: { name: 'Grotesk', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  humanist: { name: 'Humanist', stack: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif' },
  technical: { name: 'Technical', stack: '"JetBrains Mono", ui-monospace, Consolas, monospace' },
  editorial: { name: 'Editorial', stack: 'Georgia, "Times New Roman", serif' } };
const AP_ACCENTS = [
{ name: 'NFO Gold', v: '#E4BC49' }, { name: 'Orange', v: '#FF7A18' }, { name: 'Amber', v: '#E8A33D' }, { name: 'Brass', v: '#C9B26E' },
{ name: 'Copper', v: '#D08B5B' }, { name: 'Silver', v: '#C9CDD3' }, { name: 'Ice', v: '#7FB8D8' }];
const BG_TONES = {
  deep: { name: 'Deep', v: ['#060402', '#0d0d0b', '#141412', '#0f0f0d'] },
  warm: { name: 'Warm', v: ['#0d0a06', '#12100b', '#191610', '#13110c'] },
  cool: { name: 'Cool', v: ['#080a0d', '#0e1013', '#15171a', '#101214'] } };
const STATUS_PALETTES = {
  default: { name: 'Default', ok: '#5fa377', warn: '#fbbf24', crit: '#c26a6a' },
  colorblind: { name: 'Colorblind', ok: '#6b9bd1', warn: '#e3b341', crit: '#d97941' },
  vivid: { name: 'Vivid', ok: '#43c463', warn: '#ffb020', crit: '#ff6b6b' } };
const APPEAR_DEFAULT = { font: 'industrial', scale: 1, accent: '#E4BC49', bg: 'deep', status: 'default', density: 'comfortable', radius: 8 };
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lighten = (h, f) => { const [r, g, b] = hexRgb(h); const L = (x) => Math.min(255, Math.round(x + (255 - x) * f)); return `rgb(${L(r)},${L(g)},${L(b)})`; };
// 📊 mitigation outcomes — seeded history + live records; feeds the analytics view (and, in production, the NEPHES decision model)
function seedOutcomes() {
  const names = ['HYD-PUMP-2', 'ROLLER-BANK-4', 'CONV-BELT-1', 'PAINT-BOOTH-3', 'FILTER-DP-1725', 'SPINDLE-7', 'CHILLER-2', 'PRESS-9', 'WELD-CELL-5', 'AGV-DOCK-1'];
  const out = []; const now = Date.now(); let slot = 0;
  const mk = (method, durMin) => { out.push({ tsMs: now - (26 + slot++ * 15 + Math.random() * 12) * 60000, name: names[Math.floor(Math.random() * names.length)], method, devBefore: 6 + Math.random() * 30, devAfter: method === 'none' ? Math.random() * 5 : Math.random() * 2.5, durMin, open: false, seed: true }); };
  for (let i = 0; i < 9; i++) mk('auto', .3 + Math.random() * 1.8);
  for (let i = 0; i < 5; i++) mk('manual', 1 + Math.random() * 4.5);
  for (let i = 0; i < 4; i++) mk('tech', 13 + Math.random() * 22);
  for (let i = 0; i < 10; i++) mk('none', 8 + Math.random() * 17);
  return out.sort((a, b) => b.tsMs - a.tsMs);
}
const exportCSV = (name, headers, rowsArr) => {
  const csv = [headers.join(','), ...rowsArr.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Exported ' + name);
};
const KPI_MEANING = {
  'OEE': 'How much of planned output we actually made — availability × performance × quality.',
  'Availability': 'Share of scheduled time the plant was actually running.',
  'Performance': 'Actual production speed vs the design speed.',
  'Quality': 'Share of output that passed first time.',
  'MTBF': 'Average hours between equipment failures — higher is better.',
  'Active Alarms': 'Sensors currently outside their limits (warning + critical).',
  'Critical Alarms': 'Sensors past their critical limit right now.',
  'Cluster RAM': 'Memory in use across the edge cluster.',
  'Disk Free': 'Remaining shared storage pool.',
  'Network I/O': 'Data moving in and out of the plant network.',
  'Packet Loss': 'Share of telemetry packets lost in transit.',
  'Uptime': 'Platform availability over the last 30 days.' };
const DOC_CONTENT = {
  'Remote Backend Roadmap': ['What a production deployment adds behind this console — the UI is already shaped around these seams.', [['Ingest layer', 'MQTT / OPC-UA connectors at the edge pushing telemetry to a stream bus — the Data Pipeline map depicts this route.'], ['Time-series historian', 'TimescaleDB / InfluxDB storing every reading — powers trends, histograms and analytics from real data instead of the in-browser buffer.'], ['Alarm rules engine', 'Server-side warn/crit evaluation so alerts fire with no browser open; drag-set limits write back via sensor.patch.'], ['Command API + audit', 'Authenticated endpoints for mitigations and technician dispatches with a who/what/when audit trail — already brokered by the command bus.'], ['Auth & roles', 'SSO mapping users to the four profiles as permissions, not just views.'], ['Notifications', 'The bell and critical banner backed by email / SMS / push escalation policies.'], ['Live feed', 'A WebSocket stream replacing the tick simulator — the wall subscribes instead of simulating.'], ['Command bus (built)', 'Settings → Data Source switches Simulator ⇄ Remote. Commands POST to /v1/commands and fall back to the simulator when unreachable; recent commands are inspectable via NEPHES_SOURCE.outbox.']]],
  'Operator Guide': ['How to run the floor from this console.', [['1 · Watch', 'The Sensor Wall colors by status — the legend in the filter bar explains each color.'], ['2 · Inspect', 'Click any cell (or use the arrow keys) to open Sensor Detail with live readings.'], ['3 · Act', 'Start Mitigation from the queue or detail panel — or flip on Auto-Mitigate.'], ['4 · Tune', 'Drag the dashed lines on the detail chart to change when a sensor alarms.']]],
  'Keyboard Shortcuts': ['Navigation and selection.', [['← ↑ ↓ →', 'Move the selected cell within a zone block'], ['Click a group tab', 'Focus that NEPHES group on the wall'], ['Esc / ✕', 'Close panels and menus'], ['▶ Demo', 'Run the 45-second guided story']]],
  'API Reference': ['NEPHES integration surface (OpenAPI 3.1).', [['GET /v1/sensors', 'Fleet state, values, thresholds'], ['POST /v1/mitigations', 'Dispatch a mitigation for a sensor'], ['GET /v1/groups', 'Correlation groups & membership'], ['POST /v1/webhooks', 'Subscribe to alarm & resolution events']]],
  'Release Notes': ['v0.9.0‑rc.3 · pre-release build.', [['New', 'Hands-on alarm limits · NEPHES groups · investor demo'], ['Improved', 'Priority queue · auto-zone provisioning · resolved-flash lifecycle'], ['Fixed', 'Hover-card positioning · reduced-motion animations'], ['Next', 'Lasso select · first-run tour · ⌘K search']]] };

// first-run tour steps, per profile — each profile's tour shows once
const TOURS = {
  logic: [
  { sel: '.lad-tree', title: 'Program library', txt: 'All 300 controller programs, grouped by asset class — search, import an L5X, paste neutral text, or duplicate one as a template. Dots mark programs with rule findings.' },
  { sel: '.lad-rungs', title: 'Live ladder', txt: 'Rungs scan live — energized paths flow green and timers count. EDIT DRAFT to change logic (palette + click-to-insert); ARM FORCES to override a bit — two-step on purpose.' },
  { sel: '.lad-side', title: 'Watch · NEPHES · History', txt: 'Live tag values, deterministic rule findings with NEPHES advisories (advisory only — you decide), and every applied change with one-click revert.' }],
  manufacturing: [
  { sel: '.wall-card', title: 'The Sensor Wall', txt: 'Every square is a live sensor, colored by status — green ok, amber warning, red critical. Click any cell (or use the arrow keys) to inspect it.' },
  { sel: '.wall-filters', title: 'Filters & NEPHES Groups', txt: 'Filter the wall by zone or status, or sort problems to the front. When sensors start failing together, NEPHES forms a group lane here automatically.' },
  { sel: '#aiCard', title: 'Priority Action Queue', txt: 'Your to-do list — every problem ranked worst-first with a recommended fix. One click starts the mitigation.' }],
  enterprise: [
  { sel: '.saved-hero', title: 'Saved by NEPHES', txt: 'The running total of downtime and failures NEPHES has prevented — accruing live, in dollars.' },
  { sel: '.fin-strip', title: 'The plant, in dollars', txt: 'Live financial exposure — revenue at risk, cost per unit, energy. Click any card to export its data.' },
  { sel: '.exec-grid', title: 'Production Lines', txt: 'Each line with live health and $ at risk. Click a line to drill into its assets.' }],
  backend: [
  { sel: '.pipeline', title: 'Data Pipeline', txt: 'The live route: sensors → edge → stream bus → NEPHES → storage. Numbers update in real time.' },
  { sel: '.node-grid', title: 'Edge Node Fleet', txt: 'Every gateway and edge box, worst-first. Click a node to ping or restart it.' },
  { sel: '#aiCard', title: 'Infrastructure Alerts', txt: 'Network and ingestion problems ranked by severity — NEPHES can restart what’s broken.' }],
  analytics: [
  { sel: '.ana-page', title: 'Analytics', txt: 'The whole plant’s story in one place — live health, worst zones, top offenders and mitigation outcomes.' },
  { sel: '.ana-tabs', title: 'Four lenses', txt: 'Overview for session trends · Zones ranked worst-first · Top Offenders closest to their limits · Mitigation outcomes with timing. Click any sensor to jump to it on the wall.' }] };

// 🎛 per-profile window customization — visibility, vertical size, accent tint, column width
const TINTS = { gold: null, teal: { a: '#5fb3a1', rgb: '95,179,161' }, violet: { a: '#a191d2', rgb: '161,145,210' }, steel: { a: '#8fa2b4', rgb: '143,162,180' }, amber: { a: '#d89b5a', rgb: '216,155,90' }, moss: { a: '#96b06a', rgb: '150,176,106' } };
const PANEL_DEFS = {
  manufacturing: [
  { id: 'kpis', label: 'KPI Ribbon', flags: '' },
  { id: 'events', label: 'Live Events Bar', flags: '' },
  { id: 'detail', label: 'Sensor Detail panel', flags: '' },
  { id: 'wall', label: 'Sensor Wall', flags: 'wall' },
  { id: 'ops', label: 'Priority Action Queue', flags: 'tint,size' },
  { id: 'log', label: 'Action Log', flags: 'tint,size' },
  { id: 'sim', label: 'Simulation & Tools tab', flags: '' }],
  enterprise: [
  { id: 'kpis', label: 'KPI Ribbon', flags: '' },
  { id: 'events', label: 'Live Events Bar', flags: '' },
  { id: 'ai', label: 'NEPHES AI Analysis', flags: 'tint,size' },
  { id: 'actions', label: 'Executive Actions', flags: 'tint,size' }],
  backend: [
  { id: 'kpis', label: 'KPI Ribbon', flags: '' },
  { id: 'events', label: 'Live Events Bar', flags: '' },
  { id: 'ops', label: 'Infrastructure Alerts', flags: 'tint,size' },
  { id: 'log', label: 'Action Log', flags: 'tint,size' },
  { id: 'risks', label: 'Top Risks (Simulation tab)', flags: '' },
  { id: 'sim', label: 'Fault Simulator tab', flags: '' }],
  analytics: [],
  logic: [] };
const KPI_LABELS = {
  manufacturing: ['OEE', 'Availability', 'Performance', 'Quality', 'MTBF'],
  enterprise: ['OEE', 'Availability', 'Performance', 'Quality', 'MTBF'],
  backend: ['Cluster RAM', 'Disk Free', 'Network I/O', 'Packet Loss', 'Uptime'] };
// baked-in default layout (captured from the operator's tuned setup) — used on first run and by Reset
const CZ_DEFAULT = { manufacturing: { panels: { log: { tint: 'teal', size: 's', show: false }, events: { show: true }, kpis: { show: false } }, rightW: 580 }, backend: { panels: { kpis: { show: false }, risks: { show: true }, log: { show: false }, ops: { show: true } }, rightW: 608 } };
function Pw({ cfg, base, children }) {
  const mult = cfg.size === 's' ? 0.6 : cfg.size === 'l' ? 1.8 : 1;
  const style = {};
  if (base && base.maxH) { style.flex = '0 0 auto'; style.maxHeight = (cfg.size === 's' ? 26 : cfg.size === 'l' ? 58 : base.maxH) + '%'; } else
  style.flex = `${((base && base.grow) || 1) * mult} 1 0%`;
  if (base && base.minH) style.minHeight = base.minH;
  const t = TINTS[cfg.tint];
  if (t) { style['--accent'] = t.a; style['--accent-rgb'] = t.rgb; style['--accent-bright'] = t.a; }
  return <div className="pw" style={style}>{children}</div>;
}
function CustomizeDrawer({ profile, cz, cust, onPatch, onRightW, onReset, onImport, onClose }) {
  const defs = PANEL_DEFS[profile] || [];
  const rw = (cz[profile] || {}).rightW || 668;
  const [io, setIo] = React.useState('');
  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []); // eslint-disable-line
  const rows = defs.map((d, i) => ({ d, o: cust(profile, d.id).order != null ? cust(profile, d.id).order : i })).sort((a, b) => a.o - b.o);
  const stackIds = rows.filter((r) => r.d.flags.includes('size')).map((r) => r.d.id);
  const move = (id, dir) => {
    const idx = stackIds.indexOf(id); const j = idx + dir;
    if (j < 0 || j >= stackIds.length) return;
    const a = rows.find((r) => r.d.id === id), b = rows.find((r) => r.d.id === stackIds[j]);
    onPatch(id, { order: b.o }); onPatch(stackIds[j], { order: a.o });
  };
  return (
    <div className="cz-scrim" onMouseDown={onClose}>
      <div className="cz-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cz-head">CUSTOMIZE · {profile.toUpperCase()}<button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="cz-body">
          {defs.length === 0 && <div className="cz-note">This view has no customizable windows — switch to Manufacturing, Enterprise or Backend, then open Customize again.</div>}
          {defs.length > 0 && <div className="cz-row"><div className="cz-top"><span className="cz-name">Side column width</span><span className="flt-n">{rw}px</span></div><input type="range" className="cz-range" min="560" max="800" step="4" value={rw} onChange={(e) => onRightW(+e.target.value)} /></div>}
          {rows.map(({ d }) => {
            const c = cust(profile, d.id);
            const isWall = d.flags.includes('wall');
            const si = stackIds.indexOf(d.id);
            return (
              <div className={`cz-row ${c.show || isWall ? '' : 'off'}`} key={d.id}>
                <div className="cz-top">
                  <span className="cz-name">{d.label}</span>
                  <span className="cz-top-r">
                    {si > -1 && <span className="cz-ord"><button disabled={si === 0} onClick={() => move(d.id, -1)} title="Move up in the stack">↑</button><button disabled={si === stackIds.length - 1} onClick={() => move(d.id, 1)} title="Move down in the stack">↓</button></span>}
                    {!isWall && <button className={`cz-tgl ${c.show ? 'on' : ''}`} onClick={() => onPatch(d.id, { show: !c.show })} title={c.show ? 'Hide this window' : 'Show this window'} aria-label={`Toggle ${d.label}`} />}
                  </span>
                </div>
                {c.show && d.flags.includes('size') && <div className="cz-ctl"><span className="cz-lbl">SIZE</span><div className="cz-seg">{[['s', 'S'], ['m', 'M'], ['l', 'L']].map(([v, l]) => <button key={v} className={c.size === v ? 'active' : ''} onClick={() => onPatch(d.id, { size: v })}>{l}</button>)}</div></div>}
                {c.show && d.flags.includes('tint') && <div className="cz-ctl"><span className="cz-lbl">ACCENT</span><div className="cz-sws">{Object.keys(TINTS).map((k) => <button key={k} className={`cz-sw ${c.tint === k ? 'active' : ''}`} style={{ background: TINTS[k] ? TINTS[k].a : 'var(--accent)' }} onClick={() => onPatch(d.id, { tint: k })} title={k} />)}</div></div>}
                {c.show && d.id === 'kpis' && KPI_LABELS[profile] && <div className="cz-ctl kpi"><span className="cz-lbl">CARDS SHOWN</span><div className="cz-chips">{KPI_LABELS[profile].map((l) => { const off = (c.off || []).includes(l); return <button key={l} className={`flt-chip ${off ? '' : 'active'}`} onClick={() => onPatch('kpis', { off: off ? (c.off || []).filter((x) => x !== l) : [...(c.off || []), l] })}>{l}</button>; })}</div></div>}
                {isWall && <React.Fragment>
                  <div className="cz-ctl"><span className="cz-lbl">HEALTHY-CELL BRIGHTNESS</span><span className="flt-n">{Math.round((c.dim != null ? c.dim : 0.6) * 100)}%</span></div>
                  <input type="range" className="cz-range" min="30" max="100" step="5" value={Math.round((c.dim != null ? c.dim : 0.6) * 100)} onChange={(e) => onPatch('wall', { dim: +e.target.value / 100 })} />
                  <div className="cz-ctl"><span className="cz-lbl">CRITICAL FLASH</span><button className={`cz-tgl ${c.flash !== false ? 'on' : ''}`} onClick={() => onPatch('wall', { flash: c.flash === false })} aria-label="Toggle critical flash" /></div>
                </React.Fragment>}
              </div>);
          })}
          <div className="cz-note">Changes apply instantly and are remembered per profile on this device. Export copies the whole layout as text — import it on any other station.</div>
        </div>
        {io && <div className="cz-io">{io}</div>}
        <div className="cz-foot">
          <button className="cz-reset" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(cz)); setIo('✓ Layout copied — paste it on any station'); } catch (e) { setIo('Copy failed — clipboard blocked'); } }}>⧉ Export</button>
          <button className="cz-reset" onClick={() => { const s = window.prompt('Paste a layout export:'); if (!s) return; try { const p = JSON.parse(s); if (!p || typeof p !== 'object') throw 0; onImport(p); setIo('✓ Layout imported'); } catch (e) { setIo('Invalid layout — nothing changed'); } }}>⇪ Import</button>
          <button className="cz-reset danger" onClick={onReset}>Reset</button>
        </div>
      </div>
    </div>);
}

function InfoModal({ data, onClose }) {
  if (!data) return null;
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="info-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">{data.title}<button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="info-body">
          {data.sub && <div className="info-sub">{data.sub}</div>}
          {data.rows && data.rows.length > 0 &&
          <div className="info-rows">
              {data.rows.map(([k, v], i) => <div className="info-row" key={i}><span className="info-k">{k}</span><span className="info-v">{v}</span></div>)}
            </div>}
          {data.cta &&
          <button className="info-cta" onClick={() => { if (data.cta.run) data.cta.run(); if (data.cta.toastMsg) toast(data.cta.toastMsg); if (data.cta.log) logAction(data.cta.log[0], data.cta.log[1]); onClose(); }}>{data.cta.label}</button>}
        </div>
      </div>
    </div>);

}

const DOCS_LINKS = [
{ t: 'Handbook', meta: 'start→finish' },
{ t: 'Architecture', meta: 'components' },
{ t: 'Getting started', meta: '' },
{ t: 'Security', meta: '' },
{ t: 'Deployment', meta: '' },
{ sep: true },
{ t: 'API reference', meta: 'OpenAPI' }];


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

// ── 2000-point sensor fleet (heatmap / Grid view) ────────────────────────────
// Each point clones a template's units + thresholds, with a base seeded into a
// target zone so the fleet shows a realistic spread (~86% OK, ~10% warn, ~4% crit).
const GRID_TOTAL = 2000;
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
function useGridPoints({ live = true, speed = 1, volatility = 1, autoMit = false, faultsRef, mitRef, patchRef } = {}) {
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
          // each flagged cell gets ONE gentle correction per tick — recovery takes tens of seconds, like a real setpoint change working through the plant
          const healCount = Math.min(flagged.length, 150);
          for (let n = 0; n < healCount; n++) {
            const j = flagged[n];
            const p = next[j];
            let nv = p.val + (safeTarget(p) - p.val) * (0.05 + Math.random() * 0.04) + (Math.random() - 0.5) * p.vol * 0.5;
            nv = Math.max(p.min, Math.min(p.max, nv));
            next[j] = { ...p, val: nv, series: [...p.series.slice(1), nv], ts: clk() };
          }
        }
        // 3) per-device manual mitigation — staged: dispatch (~6s, no effect) → ramp → correction
        for (const id in mit) {
          const j = next.findIndex((p) => p.id === id);
          if (j >= 0 && statusOf(next[j]) !== 'ok') {
            const p = next[j];
            const el = mit[id] > 1 ? Date.now() - mit[id] : 999999;
            const pull = el < 6000 ? 0.015 : el < 15000 ? 0.045 : 0.085;
            let nv = p.val + (safeTarget(p) - p.val) * pull + (Math.random() - 0.5) * p.vol * 0.5;
            nv = Math.max(p.min, Math.min(p.max, nv));
            next[j] = { ...p, val: nv, series: [...p.series.slice(1), nv], ts: clk() };
          }
        }
        // 4) normal drift on a random subset (skip faulted groups so they stay lit)
        const k = Math.max(1, Math.round(prev.length * (autoMit ? 0.05 : 0.09)));
        for (let j = 0; j < k; j++) {
          const idx = Math.random() * prev.length | 0;
          const p = next[idx];
          if (faults[p.group] || mit[p.id]) continue;
          const nv = rw(p.val, p.vol * volatility, p.min, p.max);
          next[idx] = { ...p, val: nv, series: [...p.series.slice(1), nv], ts: clk() };
        }
        return next;
      });
    }, Math.max(150, 220 / speed));
    return () => clearInterval(iv);
  }, [live, speed, volatility, autoMit]);
  // expose a targeted updater so the host can patch a point's fields (e.g. alarm limits)
  if (patchRef) patchRef.current = (id, patch) => setPts((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
  return pts;
}

const REC_MSGS = {
  arm1: 'Bearing wear signature on axis 4. Schedule lubrication within 48h to avoid spindle seizure.',
  servo: 'Sustained load above 90% — reduce feed rate 8% or rebalance the cell to extend drive life.',
  rollr: 'Torque trending into critical band. Inspect roller bearings; possible debris on track.',
  filt: 'Filter ΔP near limit — clogging detected. Replace element next maintenance window.',
  cool: 'Coolant temperature above setpoint. Verify chiller loop flow and ambient extraction.'
};

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ health, statusText, recText, counts, profile, setProfile, clock, stale, blueLight, setBlueLight, autoMit, setAutoMit, onAddSensor, onDatasheets, customCount, onDemo, demoOn, onToggleLive, onSearch, notifs, notifUnread, notifOpen, onNotifToggle, onNotifPick, onNotifClear, eyeComfort, setEyeComfort, soundOn, setSoundOn, soundKind, setSoundKind, onReport, onAnalytics, appear, setAppear }) {
  const ap = appear || APPEAR_DEFAULT;
  const hc = health >= 85 ? 'var(--ok)' : health >= 65 ? 'var(--accent)' : 'var(--crit)';
  const [open, setOpen] = React.useState(false);
  const [stab, setStab] = React.useState('settings');
  const [profOpen, setProfOpen] = React.useState(false);
  const docsRef = React.useRef(null);
  const settingsWrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (settingsWrapRef.current && !settingsWrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  React.useEffect(() => {
    if (!profOpen) return;
    const onDown = (e) => { if (docsRef.current && !docsRef.current.contains(e.target)) setProfOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [profOpen]);
  const notifRef = React.useRef(null);
  React.useEffect(() => {
    if (!notifOpen) return;
    const onDown = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) onNotifToggle(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [notifOpen]); // eslint-disable-line
  const [sndOpen, setSndOpen] = React.useState(false);
  const sndRef = React.useRef(null);
  React.useEffect(() => {
    if (!sndOpen) return;
    const onDown = (e) => { if (sndRef.current && !sndRef.current.contains(e.target)) setSndOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [sndOpen]);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [src, setSrc] = React.useState(() => window.NEPHES_SOURCE ? NEPHES_SOURCE.get() : { mode: 'sim', url: '', status: 'untested' });
  React.useEffect(() => {
    const f = (e) => setSrc({ ...e.detail });
    window.addEventListener('nephes:source', f);
    return () => window.removeEventListener('nephes:source', f);
  }, []);
  const menuRef = React.useRef(null);
  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  return (
    <header className="hdr fade-in">
      <div className="nav-menu-wrap" ref={menuRef}>
        <button className={`nav-burger ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen((o) => !o)} title="Menu — profiles, search, settings, docs" aria-label="Menu" aria-expanded={menuOpen}>
          <span /><span /><span />
        </button>
        {menuOpen &&
        <div className="nav-menu">
            <button className="nm-search" onClick={() => { setMenuOpen(false); onSearch && onSearch(); }}>⌕ Search sensors, actions… <kbd>⌘K</kbd></button>
            <div className="nm-sec">Profiles</div>
            {PROFILES.map((p) =>
          <button key={p.id} className={`nm-item ${profile === p.id ? 'active' : ''}`} onClick={() => { setProfile(p.id); setMenuOpen(false); }}>
              <span className="nm-dot" /><span className="nm-txt"><span className="nm-name">{p.name}</span><span className="nm-desc">{p.desc}</span></span>
              {profile === p.id && <span className="nm-check">✓</span>}
            </button>)}
            <div className="nm-sec">Console</div>
            <button className="nm-item" onClick={() => { setMenuOpen(false); onDemo && onDemo(); }}><span className="nm-ic">▶</span>Run investor demo</button>
            <button className="nm-item" onClick={() => { setMenuOpen(false); onAddSensor && onAddSensor(); }}><span className="nm-ic">＋</span>Provision a sensor</button>
            <button className="nm-item" onClick={() => { setMenuOpen(false); onDatasheets && onDatasheets(); }}><span className="nm-ic">📑</span>Datasheet Library</button>
            <button className="nm-item" onClick={() => { setMenuOpen(false); onReport && onReport(); }}><span className="nm-ic">📋</span>Shift handoff report</button>
            <button className="nm-item" onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('nephes:customize')); }}><span className="nm-ic">🎛</span>Customize this view</button>
            <div className="nm-sec">System</div>
            <button className="nm-item" onClick={() => { setMenuOpen(false); setStab('settings'); setOpen(true); }}><span className="nm-ic">⚙</span>Settings</button>
            <button className="nm-item" onClick={() => { setMenuOpen(false); setStab('docs'); setOpen(true); }}><span className="nm-ic">📘</span>Documentation</button>
            <div className="nm-foot"><span className="sv-dot" />NEPHES Factory Observer · v0.9.0‑rc.3</div>
          </div>}
      </div>
      <div className="hdr-brand">
        <img src="dsr-logo.png" className="hdr-logo-img" alt="NFO" />
        <div className="hdr-title">NEPHES FACTORY OBSERVER <small>MANUFACTURING INTELLIGENCE</small></div>
      </div>
      <div className="hdr-spacer" />
      <div className="hdr-health">
        <div className="hh-top">
          <span className="hh-l">PLANT HEALTH</span>
          <span className="hh-v" style={{ color: hc }}>{health}%</span>
        </div>
        <div className="hh-bar">
          <span className="hh-seg ok" style={{ width: counts.ok / (counts.ok + counts.warn + counts.crit || 1) * 100 + '%' }} />
          <span className="hh-seg warn" style={{ width: counts.warn / (counts.ok + counts.warn + counts.crit || 1) * 100 + '%' }} />
          <span className="hh-seg crit" style={{ width: counts.crit / (counts.ok + counts.warn + counts.crit || 1) * 100 + '%' }} />
        </div>
        <div className="hh-legend">
          <span><i className="ok" />OK <b>{counts.ok}</b></span>
          <button className="hh-chip warn" onClick={() => window.dispatchEvent(new CustomEvent('nfo-wall-filter', { detail: 'warn' }))} title="Filter the Sensor Wall to warning sensors"><i className="warn" />Warn <b>{counts.warn}</b></button>
          <button className={`hh-chip crit ${counts.crit > 0 ? 'hot' : ''}`} onClick={() => window.dispatchEvent(new CustomEvent('nfo-wall-filter', { detail: 'crit' }))} title="Filter the Sensor Wall to critical sensors"><i className="crit" />Crit <b>{counts.crit}</b></button>
          <span className="hh-rec">{recText}</span>
        </div>
      </div>
      <div className="hdr-spacer" />
      <div className={`live-dot-wrap ${stale ? 'stale' : ''}`} onClick={onToggleLive} role="button" tabIndex={0} style={{ cursor: 'pointer' }} title={stale ? 'Resume live data' : 'Pause live data'}><span className="live-dot" />{stale ? 'PAUSED' : 'LIVE'}</div>
      <button className={`src-badge ${src.mode === 'remote' ? src.status === 'online' ? 'remote-on' : 'remote-off' : 'sim'}`} onClick={() => { setStab('settings'); setOpen(true); }} title="Data source — click to configure">{src.mode === 'remote' ? 'REMOTE' : 'SIM DATA'}</button>
      <div className="hdr-clock">{clock}</div>
      <button className={`mit-toggle ${autoMit ? 'on' : ''}`} onClick={() => setAutoMit((v) => !v)} aria-pressed={autoMit} title="Auto-mitigate — NEPHES fixes problems by itself as they appear">
        <span className="mt-icon">◉</span>
        <span className="mt-label">AUTO-MITIGATE</span>
        <span className="mt-switch"><span className="mt-knob" /></span>
      </button>
      <div className="sound-wrap" ref={sndRef}>
        <button className={`sound-btn ${soundOn ? 'on' : ''}`} onClick={() => setSoundOn(!soundOn)} onContextMenu={(e) => { e.preventDefault(); setSndOpen((o) => !o); }} aria-pressed={soundOn} title="Audio alerts — click to toggle · right-click to choose the sound">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />{soundOn ? <path d="M19 5.5a9.5 9.5 0 0 1 0 13" /> : <g><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></g>}</svg>
        </button>
        {sndOpen &&
        <div className="sound-panel">
            <div className="snd-head">ALERT SOUND — CLICK TO PREVIEW</div>
            {NFO_SOUNDS.map((s) =>
          <button key={s.id} className={`snd-row ${soundKind === s.id ? 'on' : ''}`} onClick={() => setSoundKind(s.id)}>
              <span className="snd-name">{s.name}</span><span className="snd-desc">{s.desc}</span>{soundKind === s.id && <span className="snd-check">✓</span>}
            </button>)}
            <div className="snd-foot">{soundOn ? 'Plays when a sensor first goes critical.' : 'Alerts are off — click the speaker to enable.'}</div>
          </div>}
      </div>
      <div className="notif-wrap" ref={notifRef}>
        <button className={`notif-btn ${notifOpen ? 'open' : ''} ${notifUnread > 0 ? 'has-unread' : ''}`} onClick={onNotifToggle} title="Notifications — criticals and resolutions">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          {notifUnread > 0 && <span className="notif-badge">{notifUnread > 9 ? '9+' : notifUnread}</span>}
        </button>
        {notifOpen &&
        <div className="notif-panel">
            <div className="nf-head">NOTIFICATIONS {notifs.length > 0 && <button className="nf-clear" onClick={onNotifClear}>Clear all</button>}</div>
            {(!notifs || notifs.length === 0) && <div className="nf-empty">Nothing yet — critical alarms land here.</div>}
            <div className="nf-list">
              {(notifs || []).map((n) =>
            <button key={n.key} className="nf-row" onClick={() => n.sensorId && onNotifPick(n.sensorId)}>
                  <span className={`nf-dot ${n.sev}`} />
                  <span className="nf-main"><span className="nf-msg">{n.msg}</span><span className="nf-ts">{n.ts}</span></span>
                  {n.sensorId && <span className="nf-go">→</span>}
                </button>)}
            </div>
          </div>}
      </div>
      <div className="settings-wrap" ref={settingsWrapRef}>
        <button className={`settings-btn ${open ? 'open' : ''}`} title="Settings" onClick={() => setOpen((o) => !o)}>⚙</button>
        {open &&
        <div className="settings-panel">
            <div className="settings-tabs">
              <button className={`settings-tab ${stab === 'settings' ? 'on' : ''}`} onClick={() => setStab('settings')}>Settings</button>
              <button className={`settings-tab ${stab === 'appear' ? 'on' : ''}`} onClick={() => setStab('appear')}>Appearance</button>
              <button className={`settings-tab ${stab === 'docs' ? 'on' : ''}`} onClick={() => setStab('docs')}>Docs</button>
            </div>
            {stab === 'settings' &&
            <div className="settings-pane">
                <div className="settings-panel-title">Display</div>
                <div className="settings-row">
                  <span className="settings-label">Blue light filter</span>
                  <button className={`settings-toggle ${blueLight ? 'on' : ''}`} aria-pressed={blueLight} title="Warms the screen colors to ease eye strain" onClick={() => setBlueLight((v) => !v)}>
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Eye comfort mode</span>
                  <button className={`settings-toggle ${eyeComfort ? 'on' : ''}`} aria-pressed={eyeComfort} title="For all-day monitoring — softer contrast, no glow, calmer motion" onClick={() => setEyeComfort && setEyeComfort((v) => !v)}>
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
                <div className="settings-panel-title" style={{ marginTop: 14 }}>Sensors</div>
                <div className="settings-row">
                  <span className="settings-label">Provisioned</span>
                  <span className="settings-count">{customCount || 0} custom</span>
                </div>
                <button className="settings-add-sensor" onClick={() => { onAddSensor && onAddSensor(); }}>＋ Add Sensor</button>
                <button className="settings-add-sensor ds-launch" onClick={() => { onDatasheets && onDatasheets(); }}>📑 Datasheet Library</button>
                <div className="settings-hint">Manually register a sensor into the system — it goes live on the wall (Tiles view).</div>
                <div className="settings-panel-title" style={{ marginTop: 14 }}>Data Source</div>
                <div className="src-row">
                  <button className={`src-opt ${src.mode === 'sim' ? 'on' : ''}`} onClick={() => window.NEPHES_SOURCE && NEPHES_SOURCE.setMode('sim')}>Simulator<small>built-in live sim</small></button>
                  <button className={`src-opt ${src.mode === 'remote' ? 'on' : ''}`} onClick={() => window.NEPHES_SOURCE && NEPHES_SOURCE.setMode('remote')}>Remote<small>NEPHES cloud / on‑prem</small></button>
                </div>
                {src.mode === 'remote' &&
              <React.Fragment>
                  <input className="src-url" placeholder="https://nephes.yourplant.com/api" value={src.url || ''} onChange={(e) => window.NEPHES_SOURCE && NEPHES_SOURCE.setConfig({ url: e.target.value })} spellCheck={false} />
                  <div className="src-test-row">
                    <button className="settings-add-sensor" onClick={() => window.NEPHES_SOURCE && NEPHES_SOURCE.test()}>⇄ Test connection</button>
                    <span className={`src-status ${src.status}`}>{src.status === 'online' ? '● Connected' : src.status === 'offline' ? '● Unreachable — simulator active' : '○ Not tested'}</span>
                  </div>
                </React.Fragment>}
                <div className="settings-hint">Every console action already routes through the NEPHES command bus — mitigations, dispatches and limit changes will replay against a real backend when one exists. Unreachable endpoints fall back to the simulator automatically.</div>
                <div className="settings-panel-title" style={{ marginTop: 14 }}>Data</div>
                <button className="settings-add-sensor" onClick={() => { setOpen(false); onAnalytics && onAnalytics(); }}>📊 Mitigation Analytics</button>
                <div className="settings-hint">Recovery outcomes with timestamps — measured with vs without NEPHES mitigation.</div>
              </div>}
            {stab === 'appear' &&
            <div className="settings-pane">
                <div className="settings-panel-title">Appearance</div>
                <div className="ap-sec-t">Text</div>
                <div className="ap-font-btns">
                  {Object.entries(FONT_STACKS).map(([k, f]) =>
                <button key={k} className={`ap-font ${ap.font === k ? 'on' : ''}`} style={{ fontFamily: f.stack }} onClick={() => setAppear({ ...ap, font: k })}>
                      <span className="af-name">{f.name}</span><span className="af-sample">Aa 12.7</span>
                    </button>)}
                </div>
                <div className="ap-row"><span className="ap-l">UI scale</span><input type="range" className="ap-range" min="0.85" max="1.2" step="0.05" value={ap.scale} onChange={(e) => setAppear({ ...ap, scale: +e.target.value })} /><span className="ap-val">{Math.round(ap.scale * 100)}%</span></div>
                <div className="ap-sec-t">Color</div>
                <div className="ap-row"><span className="ap-l">Accent</span><div className="ap-swatches">{AP_ACCENTS.map((c) => <button key={c.v} title={c.name} className={`ap-sw ${ap.accent === c.v ? 'on' : ''}`} style={{ background: c.v }} onClick={() => setAppear({ ...ap, accent: c.v })} />)}</div></div>
                <div className="ap-row"><span className="ap-l">Background</span><div className="ap-seg">{Object.entries(BG_TONES).map(([k, t]) => <button key={k} className={ap.bg === k ? 'on' : ''} onClick={() => setAppear({ ...ap, bg: k })}>{t.name}</button>)}</div></div>
                <div className="ap-row"><span className="ap-l">Status</span><div className="ap-seg">{Object.entries(STATUS_PALETTES).map(([k, p]) => <button key={k} className={ap.status === k ? 'on' : ''} onClick={() => setAppear({ ...ap, status: k })}>{p.name}</button>)}</div></div>
                <div className="ap-sec-t">Layout</div>
                <div className="ap-row"><span className="ap-l">Density</span><div className="ap-seg"><button className={ap.density !== 'compact' ? 'on' : ''} onClick={() => setAppear({ ...ap, density: 'comfortable' })}>Comfortable</button><button className={ap.density === 'compact' ? 'on' : ''} onClick={() => setAppear({ ...ap, density: 'compact' })}>Compact</button></div></div>
                <div className="ap-row"><span className="ap-l">Corner radius</span><input type="range" className="ap-range" min="0" max="14" step="1" value={ap.radius} onChange={(e) => setAppear({ ...ap, radius: +e.target.value })} /><span className="ap-val">{ap.radius}px</span></div>
                <button className="ap-reset" onClick={() => setAppear({ ...APPEAR_DEFAULT })}>↺ Reset to defaults</button>
                <div className="settings-hint">Changes apply instantly and stay on this device.</div>
              </div>}
            {stab === 'docs' &&
            <div className="settings-pane">
                <div className="settings-panel-title">Documentation</div>
                {[['📘', 'Operator Guide', 'Floor monitoring & mitigation'], ['⌨', 'Keyboard Shortcuts', 'Navigation & selection'], ['🔌', 'API Reference', 'NEPHES integration & webhooks'], ['🗺', 'Remote Backend Roadmap', 'Production architecture & command bus'], ['📝', 'Release Notes', 'What’s new in this build']].map(([ic, t, d]) =>
                <a key={t} className="doc-link" href="#" onClick={(e) => { e.preventDefault(); const dc = DOC_CONTENT[t]; if (dc) openInfo(t, dc[0], dc[1]); }}>
                    <span className="doc-ic">{ic}</span>
                    <span className="doc-text"><span className="doc-t">{t}</span><span className="doc-d">{d}</span></span>
                    <span className="doc-arrow">↗</span>
                  </a>
                )}
              </div>}
            <div className="settings-ver">
              <span className="sv-dot" />NEPHES Factory Observer
              <span className="sv-num">v0.9.0‑rc.3</span>
              <span className="sv-tag">PRE‑RELEASE</span>
            </div>
          </div>}
      </div>
    </header>);

}

// ── KPI strip ────────────────────────────────────────────────────────────────
function KpiStrip({ stream, counts, profile, kpiOff }) {
  const { last, series } = stream;
  const isBackend = profile === 'backend';
  const t = stream.tick || 0;
  const infraCur = { ram: 76.4 + Math.sin(t * 0.3) * 3, disk: 1.2 + Math.sin(t * 0.15) * 0.12, bw: 142 + Math.sin(t * 0.4) * 16, loss: Math.max(0, Math.sin(t * 0.6)) * 0.03, uptime: 99.98 };
  const [infraHist, setInfraHist] = React.useState(() => { const o = {}; for (const k in infraCur) o[k] = Array.from({ length: 24 }, () => infraCur[k]); return o; });
  React.useEffect(() => {
    setInfraHist((h) => { const n = {}; for (const k in infraCur) n[k] = [...h[k].slice(1), infraCur[k]]; return n; });
  }, [t]);
  const items = isBackend ? [
  { label: 'Cluster RAM', value: infraCur.ram.toFixed(1), unit: '%', s: infraHist.ram, u: '%' },
  { label: 'Disk Free', value: infraCur.disk.toFixed(2), unit: 'TB', s: infraHist.disk, u: '' },
  { label: 'Network I/O', value: Math.round(infraCur.bw), unit: 'Mbps', s: infraHist.bw, u: '' },
  { label: 'Packet Loss', value: infraCur.loss.toFixed(2), unit: '%', s: infraHist.loss, u: '%' },
  { label: 'Uptime', value: infraCur.uptime.toFixed(2), unit: '%', s: infraHist.uptime, u: '%' }] :
  [
  { label: 'OEE', value: last.oee.toFixed(1), unit: '%', s: series.oee, u: '%' },
  { label: 'Availability', value: last.avail.toFixed(1), unit: '%', s: series.avail, u: '%' },
  { label: 'Performance', value: last.perf.toFixed(1), unit: '%', s: series.perf, u: '%' },
  { label: 'Quality', value: last.quality.toFixed(1), unit: '%', s: series.quality, u: '%' },
  { label: 'MTBF', value: fmt(last.mtbf), unit: 'h', s: series.mtbf, u: 'h' }];

  const shown = items.filter((k) => !(kpiOff || []).includes(k.label));
  if (!shown.length) return null;
  return (
    <section className="kpis fade-in">
      {shown.map((k) => <KpiCard key={k.label} label={k.label} value={k.value} unit={k.unit} series={k.s} trend={trendOf(k.s, k.u)} onClick={() => openInfo('KPI · ' + k.label, KPI_MEANING[k.label] || 'Live plant performance indicator.', [['Metric', k.label], ['Current', k.value + (k.unit || '')], ['Trend', trendOf(k.s, k.u).txt || 'steady']], { label: '⤓ Export CSV', run: () => exportCSV(k.label.replace(/[^\w]+/g, '_') + '.csv', ['sample', k.label], k.s.map((v, i) => [i + 1, (+v).toFixed(2)])) })} />)}
    </section>);

}

// ── Sensor Wall ──────────────────────────────────────────────────────────────
function SensorWall({ assets, gridPoints, sel, setSel, view, setView, profile, stream, focused, onToggleFocus, wsName, wsHasPins, initFilters, onFiltersChange, onPinVisible, onExitWs, onPinSensor }) {
  const [grp, setGrp] = React.useState(initFilters ? initFilters.grp || 'all' : 'all');
  const [sev, setSev] = React.useState(initFilters ? initFilters.sev || 'all' : 'all');
  const [q, setQ] = React.useState(initFilters ? initFilters.q || '' : '');
  React.useEffect(() => { if (onFiltersChange) onFiltersChange({ grp, sev, q }); }, [grp, sev, q]); // eslint-disable-line
  // zone re-rank timer (hoisted above activeSense — its dep array reads it)
  const [zoneOrderTick, setZoneOrderTick] = React.useState(0);
  React.useEffect(() => { const iv = setInterval(() => setZoneOrderTick((t) => t + 1), 2000); return () => clearInterval(iv); }, []);

  // ── C4 Group Tabs + D3 ⚡ Auto-Map state ──
  const [senseGroups, setSenseGroups] = React.useState([]);
  const [focusGid, setFocusGid] = React.useState(null);
  const [dismissedSeeds, setDismissedSeeds] = React.useState([]);
  const [savedGroups, setSavedGroups] = React.useState([]);
  const [amap, setAmap] = React.useState(null);
  // rich hover card for grid cells — instant mini-readout, no native tooltip lag
  const [cellPop, setCellPop] = React.useState(null); // { id, x, y }
  const onCellHover = React.useCallback((id, rect) => {
    if (!id) { setCellPop(null); return; }
    const flip = rect.right + 224 > window.innerWidth;
    setCellPop({ id, x: flip ? rect.left - 216 : rect.right + 10, y: Math.min(Math.max(10, rect.top - 12), window.innerHeight - 168) });
  }, []);
  const gpRef = React.useRef(gridPoints); gpRef.current = gridPoints;
  const exRef = React.useRef([]); exRef.current = [...dismissedSeeds, ...savedGroups.map((g) => g.seedId)];
  const recomputeGroups = React.useCallback(() => setSenseGroups(computeSensorGroups(gpRef.current, new Set(exRef.current))), []);
  React.useEffect(() => {
    if (view !== 'grid') return;
    recomputeGroups();
    const iv = setInterval(recomputeGroups, 5000);
    return () => clearInterval(iv);
  }, [view, dismissedSeeds, savedGroups, recomputeGroups]);
  const activeSense = React.useMemo(() => { const bad = new Set(gpRef.current.filter((p) => statusOf(p) !== 'ok').map((p) => p.id)); return senseGroups.filter((g) => g.members && g.members.some((id) => bad.has(id))); }, [senseGroups, zoneOrderTick]);
  React.useEffect(() => { if (focusGid && !activeSense.some((g) => g.id === focusGid)) setFocusGid(null); }, [activeSense, focusGid]);
  const gmap = React.useMemo(() => { const m = new Map(); activeSense.forEach((g, gi) => g.members.forEach((id) => { if (!m.has(id)) m.set(id, gi + 1); })); return m; }, [activeSense]);
  const focusSet = React.useMemo(() => { const g = activeSense.find((x) => x.id === focusGid); return g ? new Set(g.members) : null; }, [activeSense, focusGid]);
  const saveGroup = (g) => { setSavedGroups((p) => [...p, { name: g.seedName, ids: g.members, seedId: g.id }]); setFocusGid(null); setGrp('sg:' + g.seedName); };
  const dismissGroup = (g) => { setDismissedSeeds((p) => [...p, g.id]); setFocusGid(null); };

  React.useEffect(() => { const h = (e) => { setSev(e.detail); setGrp('all'); }; window.addEventListener('nfo-wall-filter', h); return () => window.removeEventListener('nfo-wall-filter', h); }, []);
  const groups = SECTIONS.map((s) => s.name);
  const matchQ = (a) => !q || (a.name + ' ' + a.label).toLowerCase().includes(q.toLowerCase());
  const savedSet = React.useMemo(() => { if (!grp.startsWith('sg:')) return null; const g = savedGroups.find((x) => 'sg:' + x.name === grp); return g ? new Set(g.ids) : null; }, [grp, savedGroups]);
  const matchFilters = (a) => (savedSet ? savedSet.has(a.id) : grp === 'all' || a.group === grp) && (sev === 'all' || statusOf(a) === sev) && matchQ(a);

  const visibleTiles = assets.filter(matchFilters);
  const gridVisible = gridPoints.filter(matchFilters);
  const isGrid = view === 'grid';

  const total = isGrid ? gridPoints.length : assets.length;
  const flagged = (isGrid ? gridPoints : assets).filter((a) => statusOf(a) !== 'ok').length;

  // measure the actual rendered width of the grid area so all zones can use the SAME column
  // count sized to fill it — more columns → smaller cells → far fewer rows, so every zone
  // (and thus the entire 2000-point fleet) fits on screen at once without vertical scrolling.
  const scrollRef = React.useRef(null);
  const [scrollW, setScrollW] = React.useState(820);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => { for (const entry of entries) setScrollW(entry.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const CELL_PITCH = 9; // px per column (cell + gap) — small enough to pack hundreds of points per row
  const dynCols = Math.max(24, Math.min(340, Math.floor((scrollW - 20) / CELL_PITCH)));

  // auto-size the wall window to the number of sensors currently shown — both views
  const visN = visibleTiles.length;
  const tileCols = visN <= 3 ? Math.max(1, visN) : visN <= 8 ? 3 : visN <= 15 ? 4 : visN <= 24 ? 5 : 6;
  const gBucket = Math.max(25, Math.ceil(gridVisible.length / 25) * 25); // bucket so live count changes don't jitter the width
  const gCols = Math.min(50, Math.max(6, Math.ceil(Math.sqrt(gBucket) * 1.6)));
  const wallW = isGrid ?
  gCols * 10 + (gCols - 1) * 3 + 44 :
  tileCols * 170 + (tileCols - 1) * 6 + 32;
  const cardStyle = { flex: '1 1 0', minWidth: 0 };

  // zone display order, worst plant health first (lowest OK-fraction → top) — recomputed on a slow timer (not every tick) so ordering is stable and cheap
  const tileZoneOrder = React.useMemo(() => {
    return SECTIONS.map((s, idx) => {
      const list = assets.filter((a) => a.group === s.name);
      const ok = list.filter((a) => statusOf(a) === 'ok').length;
      return { name: s.name, affected: list.length - ok, importance: idx };
    }).sort((a, b) => Math.round(b.affected / 15) - Math.round(a.affected / 15) || a.importance - b.importance || b.affected - a.affected).map((z) => z.name);
    // eslint-disable-next-line
  }, [zoneOrderTick]);
  const gridZoneOrder = React.useMemo(() => {
    const totals = {}; SECTIONS.forEach((s, idx) => totals[s.name] = { ok: 0, total: 0, importance: idx });
    gridPoints.forEach((p) => { const t = totals[p.group]; if (t) { t.total++; if (statusOf(p) === 'ok') t.ok++; } });
    return SECTIONS.map((s) => ({ name: s.name, affected: totals[s.name].total - totals[s.name].ok, importance: totals[s.name].importance })).
    sort((a, b) => Math.round(b.affected / 15) - Math.round(a.affected / 15) || a.importance - b.importance || b.affected - a.affected).map((z) => z.name);
    // eslint-disable-next-line
  }, [zoneOrderTick]);

  // grid points, organized into contiguous blocks by their location in the plant, worst-health zone first
  const gridZones = React.useMemo(() => {
    const byName = {};
    gridZoneOrder.forEach((name) => { const sec = SECTIONS.find((s) => s.name === name); byName[name] = { name, sub: sec.sub, pts: [] }; });
    gridVisible.forEach((p) => { const z = byName[p.group]; if (z) z.pts.push(p); });
    const sevRank = (p) => { const s = statusOf(p); return s === 'crit' ? 0 : s === 'warn' ? 1 : 2; };
    return gridZoneOrder.map((name) => byName[name]).filter((z) => z.pts.length > 0).map((z) => ({ ...z, pts: amap ? [...z.pts].sort((x, y) => sevRank(x) - sevRank(y)) : z.pts, cols: dynCols }));
  }, [gridVisible, gridZoneOrder, dynCols, amap]);
  // D3 ⚡ Auto-Map — flagged sensors move to the front of their zone block; count what would move
  const runAutoMap = () => {
    let moved = 0;
    gridZones.forEach((z) => { const lead = z.pts.filter((p) => statusOf(p) !== 'ok').length; z.pts.forEach((p, i) => { if (statusOf(p) !== 'ok' && i >= lead) moved++; }); });
    setAmap({ moved, at: Date.now() });
  };
  // flattened nav order matching the visual zone blocks, each point tagged with its own zone's column count + bounds
  const navPoints = React.useMemo(() => {
    const out = []; let cursor = 0;
    gridZones.forEach((z) => { const start = cursor; z.pts.forEach((p, i) => out.push({ id: p.id, cols: z.cols, zoneStart: start, zoneLen: z.pts.length, i })); cursor += z.pts.length; });
    return out;
  }, [gridZones]);

  // arrow-key navigation across the heatmap grid — stays within the selected sensor's own zone block
  const navRef = React.useRef({});
  navRef.current = { navPoints, sel, setSel, isGrid };
  React.useEffect(() => {
    const onKey = (e) => {
      const { navPoints, sel, setSel, isGrid } = navRef.current;
      if (!isGrid) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const n = navPoints.length;
      if (!n) return;
      e.preventDefault();
      const idx = navPoints.findIndex((p) => p.id === sel);
      if (idx < 0) { setSel(navPoints[0].id); return; }
      const cur = navPoints[idx];
      const zLo = cur.zoneStart, zHi = cur.zoneStart + cur.zoneLen - 1;
      let ni = idx;
      if (e.key === 'ArrowLeft') ni = idx - 1;
      else if (e.key === 'ArrowRight') ni = idx + 1;
      else if (e.key === 'ArrowUp') ni = idx - cur.cols;
      else if (e.key === 'ArrowDown') ni = idx + cur.cols;
      ni = Math.max(zLo, Math.min(zHi, ni));
      if (ni === idx) return;
      setSel(navPoints[ni].id);
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
        {wsName && <span className="ws-scope-pill" title="The wall is scoped to this workspace">🗂 {wsName}<button className="ws-x" onClick={onExitWs} title="Exit workspace — show all sensors">✕</button></span>}
        <div className="view-toggle" style={{ marginLeft: 'auto', display: 'inline-flex', flexShrink: 0, whiteSpace: 'nowrap', border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
          {['tiles', 'grid'].map((v) =>
          <button key={v} className="vt-btn" onClick={() => setView(v)} style={{ background: view === v ? 'var(--accent)' : 'transparent', color: view === v ? '#000' : 'var(--text-2)', border: 'none', padding: '3px 11px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer', fontFamily: 'inherit' }}>{v === 'tiles' ? 'Tiles' : 'Grid'}</button>
          )}
          {onToggleFocus &&
          <button className="vt-btn" onClick={onToggleFocus} title={focused ? 'Exit full-grid view' : 'View the entire sensor grid alone'} style={{ background: focused ? 'var(--accent)' : 'transparent', color: focused ? '#000' : 'var(--text-2)', border: 'none', borderLeft: '1px solid var(--card-border)', padding: '3px 11px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer', fontFamily: 'inherit' }}>⛶ Focus</button>
          }
        </div>
      </div>
      {view !== 'art' &&
      <div className="wall-filters">
        <div className="wf-group">
          <span className="wf-label">Group</span>
          <button className={`wf-btn ${grp === 'all' ? 'active' : ''}`} onClick={() => setGrp('all')}>All</button>
          {groups.map((g) => <button key={g} className={`wf-btn ${grp === g ? 'active' : ''}`} onClick={() => setGrp(g)}>{g.replace(' System', '').replace(' Systems', '')}</button>)}
          {savedGroups.map((g) => <button key={'sg:' + g.name} className={`wf-btn wf-star ${grp === 'sg:' + g.name ? 'active' : ''}`} onClick={() => setGrp('sg:' + g.name)}>★ {g.name}</button>)}
        </div>
        <span className="wf-sep" />
        <div className="wf-group">
          <span className="wf-label">Status</span>
          <button className={`wf-btn ${sev === 'all' ? 'active' : ''}`} onClick={() => setSev('all')}>All</button>
          <button className={`wf-btn wf-warn ${sev === 'warn' ? 'active' : ''}`} onClick={() => setSev('warn')}>Warn</button>
          <button className={`wf-btn wf-crit ${sev === 'crit' ? 'active' : ''}`} onClick={() => setSev('crit')}>Crit</button>
          {isGrid && <button className={`wf-btn ${amap ? 'active' : ''}`} onClick={() => amap ? setAmap(null) : runAutoMap()} title="Tidy the wall — sensors with problems move to the front of their zone blocks">⚡ {amap ? 'Sorted ✓' : 'Problems first'}</button>}
          {wsName && !wsHasPins && onPinVisible && <button className="wf-btn ws-pin-btn" onClick={() => onPinVisible((isGrid ? gridVisible : visibleTiles).map((a) => a.id))} title="Snapshot — pin every sensor matching these filters into the workspace">⊕ Pin these {fmt(isGrid ? gridVisible.length : visibleTiles.length)}</button>}
        </div>
        <input className="wf-search" placeholder="Search assets…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </div>}
      {isGrid && activeSense.length > 0 &&
      <GroupLane groups={activeSense} focusGid={focusGid} setFocusGid={setFocusGid} onSave={saveGroup} onDismiss={dismissGroup} onRefresh={recomputeGroups} />
      }
      {isGrid && amap &&
      <div className="am-toast">⚡ <b>Sorted</b>&nbsp;— {amap.moved > 0 ? `${amap.moved} flagged sensors moved to the front of their blocks — every zone now leads with its problems` : 'wall already organized — flagged sensors were front and center'} <button className="am-undo" onClick={() => setAmap(null)}>Undo</button></div>
      }
      {view === 'art' ?
      <div className="wall-scroll art-scroll" style={{ padding: 0, width: '100%', height: '603px', overflow: 'hidden' }}>
          <SensorArt points={gridPoints} />
        </div> :

      <div className="wall-scroll" ref={scrollRef} onScroll={() => setCellPop(null)} style={{ padding: "10px", width: "100%", height: "603px" }}>
        {isGrid ?
        <React.Fragment>
            <div className="hm-legend">
              <span className="hm-count">{fmt(gridVisible.length)} of {fmt(gridPoints.length)} points</span>
            </div>
            {gridZones.map((z) => {
              const zCrit = z.pts.filter((p) => statusOf(p) === 'crit').length;
              const zWarn = z.pts.filter((p) => statusOf(p) === 'warn').length;
              const zst = zCrit ? 'crit' : zWarn ? 'warn' : '';
              const zWorst = zCrit || zWarn ? z.pts.reduce((best, p) => { if (statusOf(p) === 'ok') return best; const f = riskOf(p).frac; return !best || f > best.f ? { p, f } : best; }, null) : null;
              return (
                <div className="grp hm-zone" key={z.name}>
                  <div className={`grp-head ${zst}`}>
                    <span className="g-name">{z.name}</span>
                    <span className="g-sub">{z.sub}</span>
                    <span className="g-count">{fmt(z.pts.length)} pts · {zCrit ? `${zCrit} critical` : zWarn ? `${zWarn} warning` : 'all normal'}</span>
                    {zWorst && <span className={`g-worst ${zst}`} onClick={(e) => { e.stopPropagation(); setSel(zWorst.p.id); }} title="Jump to this sensor">worst: {zWorst.p.name}</span>}
                  </div>
                  <div className="hm-grid hm-100" style={{ '--gcols': z.cols }}>
                    {z.pts.map((a) => <HeatCell key={a.id} a={a} selected={sel === a.id} onSelect={setSel} onHover={onCellHover} ring={focusSet && focusSet.has(a.id) ? 1 : 0} dim={!!(focusSet && !focusSet.has(a.id))} onCtx={onPinSensor} />)}
                  </div>
                </div>);

            })}
          </React.Fragment> :

        <React.Fragment>
          {tileZoneOrder.filter((name) => grp === 'all' || name === grp).map((name) => {
          const s = SECTIONS.find((sec) => sec.name === name);
          const list = visibleTiles.filter((a) => a.group === name);
          if (!list.length) return null;
          const gst = list.some((a) => statusOf(a) === 'crit') ? 'crit' : list.some((a) => statusOf(a) === 'warn') ? 'warn' : '';
          const worst = gst ? list.reduce((b, x) => { if (statusOf(x) === 'ok') return b; const f = riskOf(x).frac; return !b || f > b.f ? { x, f } : b; }, null) : null;
          return (
            <div key={name} className="grp">
                <div className={`grp-head ${gst}`}>
                  <span className="g-name">{name}</span>
                  <span className="g-sub">{profile === 'backend' ? NODE_FW[name] : s.sub}</span>
                  <span className="g-count">{list.length}</span>
                  {worst && <span className={`g-worst ${gst}`} onClick={(e) => { e.stopPropagation(); setSel(worst.x.id); }} title="Jump to this sensor">worst: {worst.x.name}</span>}
                </div>
                <div className="grp-grid" style={{ '--cols': tileCols }}>
                  {list.map((a) => <SensorTile key={a.id} a={a} selected={sel === a.id} onSelect={() => setSel(a.id)} />)}
                </div>
              </div>);

          })}
          {stream && <PlantTrends stream={stream} />}
        </React.Fragment>
        }
      </div>}
      <div className="wall-foot" aria-hidden="true"><span><i className="lg-ok" />ok</span><span><i className="lg-warn" />warning</span><span><i className="lg-crit" />critical</span>{isGrid && <span><i className="lg-grp" />in group</span>}<span className="wall-foot-hint">click a cell to inspect · arrow keys move</span></div>
      {cellPop && (() => {
        const p = gridPoints.find((x) => x.id === cellPop.id);
        if (!p) return null;
        const pst = statusOf(p);
        // portal to <body>: .main keeps a retained transform from its entrance animation,
        // which would otherwise hijack fixed positioning (transform → containing block)
        return ReactDOM.createPortal(
          <div className="cell-pop" style={{ left: cellPop.x, top: cellPop.y }}>
            <div className="cp-top"><span className="cp-name">{p.name}</span><span className={`cp-st ${pst}`}>{pst === 'ok' ? 'ok' : pst === 'warn' ? 'warning' : 'critical'}</span></div>
            <div className="cp-zone">{p.group} · {p.label}</div>
            <div className="cp-val" style={{ color: SEV_COLOR[pst] }}>{p.val.toFixed(p.dec != null ? p.dec : 1)}<small>{p.unit}</small></div>
            <Spark series={p.series} w={172} h={26} color={SEV_COLOR[pst]} strokeW={1.6} dot={false} />
            <div className="cp-hint">click to inspect · right-click to pin · arrows move</div>
          </div>, document.body);
      })()}
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


function NodeCard({ n, tick }) {
  const osc = (seed, amp, mid) => mid + Math.sin((tick + seed) * 0.5) * amp + (Math.random() - 0.5) * amp * 0.3;
  const offline = n.state === 'offline';
  const degraded = n.state === 'degraded';
  const st = offline ? 'crit' : degraded ? 'warn' : 'ok';
  const cpu = offline ? 0 : Math.round(degraded ? osc(n.id.length * 3, 6, 88) : osc(n.id.length * 3, 14, 46));
  const ingest = offline ? 0 : Math.round((n.role === 'gateway' ? osc(7, 600, 6200) : osc(n.id.length, 220, 1600 + n.sensors * 180)));
  const cpuColor = cpu >= 85 ? 'var(--crit)' : cpu >= 70 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className={`node-card clk ${st === 'ok' ? '' : st}`} onClick={() => openInfo('Edge Node · ' + n.id, (n.role === 'gateway' ? 'Plant gateway' : n.line) + ' · firmware ' + n.fw + '.', [['Node', n.id], ['Location', n.role === 'gateway' ? 'Plant gateway' : n.line], ['Firmware', n.fw], ['State', offline ? 'Offline' : degraded ? 'Degraded' : 'Online'], ['Sensors', String(n.sensors || '—')]], { label: offline ? '↻ Restart node' : degraded ? '↻ Restart container' : '⇄ Ping node', run: () => { toast(n.id + (offline || degraded ? ' restart dispatched · watchdog will confirm' : ' ping · 4 ms · healthy')); if (offline || degraded) logAction(n.id.toUpperCase(), 'Node restart dispatched'); } })}>
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

function SystemView({ stream }) {
  const { last, tick } = stream;
  const online = NODES.filter((n) => n.state !== 'offline').length;
  const totalIngest = last.ingest;
  const stages = [
    { name: 'Sensors', metric: '1,019', unit: 'points', sub: '4 lines + grid' },
    { name: 'Edge Ingest', metric: fmt(totalIngest), unit: 'pt/s', sub: `${online}/${NODES.length} nodes` },
    { name: 'Stream Bus', metric: fmt(last.queue), unit: 'queued', sub: 'partition lag 0' },
    { name: 'NEPHES MoE', metric: last.latency.toFixed(1), unit: 'ms', sub: '8 experts active' },
    { name: 'TimescaleDB', metric: fmt(Math.round(totalIngest * 0.98)), unit: 'rows/s', sub: 'retention 90d' }];

  // — NEPHES MoE model runtime (live per-expert load) —
  const osc = (seed, amp, mid) => Math.max(2, Math.round(mid + Math.sin((tick + seed) * 0.4) * amp + (Math.random() - 0.5) * amp * 0.3));
  const EXPERTS = [
    { n: 'Vibration', s: 1 }, { n: 'Thermal', s: 2 }, { n: 'Pressure', s: 3 }, { n: 'Electrical', s: 4 },
    { n: 'Acoustic', s: 5 }, { n: 'Flow', s: 6 }, { n: 'Motion', s: 7 }, { n: 'Gateway', s: 8 }];
  const experts = EXPERTS.map((e) => ({ ...e, load: osc(e.s * 7, 22, 48 + e.s % 3 * 8) }));
  const modelMeta = [
    { l: 'Model', v: 'nephes-moe v4.2.1' },
    { l: 'Inference', v: last.latency.toFixed(1) + ' ms' },
    { l: 'Accuracy', v: '94.6%' },
    { l: 'Drift vs 24h', v: '+0.3σ' }];

  // — applications running on top of the NEPHES model runtime (live per-app simulation) —
  const APPLICATIONS = [
    { id: 'predictive-maint', name: 'Predictive Maintenance', desc: 'Failure-risk scoring per asset, feeds the Priority Action Queue', seed: 1 },
    { id: 'anomaly-detect', name: 'Anomaly Detection', desc: 'Real-time outlier flagging across the 2,000-point sensor fleet', seed: 2 },
    { id: 'quality-vision', name: 'Quality Vision', desc: 'Defect detection on Paint Line inspection cameras', seed: 3, tiedNode: 'edge-10' },
    { id: 'energy-optimizer', name: 'Energy Optimizer', desc: 'Plant-wide energy draw tuning & setpoint recommendations', seed: 4 },
    { id: 'demand-forecast', name: 'Demand Forecasting', desc: 'Throughput, staffing & shift-load projections', seed: 5 },
    { id: 'digital-twin', name: 'Digital Twin Sync', desc: 'Live plant-state mirroring for the operator console', seed: 6 }];
  const applications = APPLICATIONS.map((a) => {
    const rps = osc(a.seed * 11, 40, 90 + a.seed % 3 * 20);
    const lat = osc(a.seed * 5, 6, 14 + a.seed % 4 * 3);
    const errRate = Math.max(0, Math.sin((tick + a.seed * 3) * 0.2) * 0.35 + 0.25).toFixed(2);
    const nodeDown = a.tiedNode && NODES.find((n) => n.id === a.tiedNode && n.state !== 'ok');
    const status = nodeDown || lat > 32 || +errRate > 1.3 ? 'warn' : 'ok';
    return { ...a, rps, lat, errRate, status };
  });

  // — data quality (live) —
  const staleN = NODES.filter((n) => n.state === 'offline').length * 4 + 2;
  const uptime = (100 - staleN / 2019 * 100).toFixed(2);
  const dq = [
    { l: 'Sensor Uptime', v: uptime + '%', tone: +uptime >= 99 ? 'ok' : 'warn' },
    { l: 'Stale Signals', v: staleN, tone: staleN > 10 ? 'warn' : 'ok' },
    { l: 'Dropped Pkts', v: (0.01 + (100 - online / NODES.length * 100) * 0.02).toFixed(2) + '%', tone: 'ok' },
    { l: 'Ingest Gaps', v: NODES.filter((n) => n.state === 'offline').length, tone: NODES.some((n) => n.state === 'offline') ? 'warn' : 'ok' }];

  // — job queue —
  const jobRunning = 2 + (tick % 3);
  const jobs = [
    { id: 'retrain-moe', label: 'MoE nightly retrain', st: 'running', meta: '68% · ETA 9m' },
    { id: 'snapshot', label: 'Health snapshot', st: 'running', meta: 'streaming' },
    { id: 'export-exec', label: 'Exec report export', st: 'queued', meta: 'waiting' },
    { id: 'backfill', label: 'TimescaleDB backfill', st: 'done', meta: '2m ago' },
    { id: 'webhook-retry', label: 'Webhook retry batch', st: NODES.some((n) => n.state === 'offline') ? 'failed' : 'done', meta: NODES.some((n) => n.state === 'offline') ? '1 failed' : 'ok' }];
  // — integrations —
  const integrations = [
    { l: 'Webhook Sink', v: 'connected', tone: 'ok', meta: '3 endpoints' },
    { l: 'Alert Mailer', v: 'connected', tone: 'ok', meta: 'SMTP · 12 sent' },
    { l: 'API Keys', v: '4 active', tone: 'ok', meta: '1 expiring 14d' },
    { l: 'OPC-UA Bridge', v: NODES.some((n) => n.state === 'offline') ? 'degraded' : 'connected', tone: NODES.some((n) => n.state === 'offline') ? 'warn' : 'ok', meta: 'gw-plant' }];
  // — audit log —
  const audit = [
    { who: 'ops.manager', act: 'updated plant configuration', t: '3m' },
    { who: 'nephes.system', act: 'auto-mitigation enabled', t: '11m' },
    { who: 'tech.reyes', act: 'completed WO-4820', t: '24m' },
    { who: 'admin', act: 'rotated API key svc-ingest', t: '1h' },
    { who: 'nephes.system', act: 'model promoted v4.2.1', t: '2h' }];

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
          <div className="grp-head"><span className="g-name">NEPHES Model Runtime</span><span className="g-sub">MIXTURE OF EXPERTS</span><span className="g-count">8 experts</span></div>
          <div className="mr-meta">
            {modelMeta.map((m) => <div className="mr-meta-card" key={m.l}><span className="mr-meta-l">{m.l}</span><span className="mr-meta-v">{m.v}</span></div>)}
          </div>
          <div className="mr-experts">
            {experts.map((e) =>
            <div className="mr-exp clk" key={e.n} onClick={() => openInfo('MoE Expert · ' + e.n, e.n + ' expert — current routing load ' + e.load + '%.', [['Expert', e.n], ['Load', e.load + '%'], ['Model', 'nephes-moe v4.2.1']])}>
                <div className="mr-exp-top"><span className="mr-exp-n">{e.n}</span><span className="mr-exp-l">{e.load}%</span></div>
                <div className="mr-exp-bar"><div style={{ width: e.load + '%', background: e.load >= 80 ? 'var(--warn)' : 'var(--accent)' }} /></div>
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Applications</span><span className="g-sub">RUNNING ON MODEL RUNTIME</span><span className="g-count">{applications.length} apps</span></div>
          <div className="app-grid">
            {applications.map((a) =>
            <div className={`app-card clk ${a.status}`} key={a.id} onClick={() => openInfo(a.name, a.desc, [['Status', a.status === 'warn' ? 'Degraded' : 'Healthy'], ['Requests', a.rps + '/s'], ['Latency', a.lat + ' ms'], ['Error rate', a.errRate + '%'], ['Model', 'nephes-moe v4.2.1']])}>
                <div className="app-top">
                  <span className={`app-dot ${a.status}`} />
                  <span className="app-name">{a.name}</span>
                  <span className={`app-status ${a.status}`}>{a.status === 'warn' ? 'degraded' : 'healthy'}</span>
                </div>
                <div className="app-desc">{a.desc}</div>
                <div className="app-stats">
                  <span><b>{a.rps}</b>/s reqs</span>
                  <span><b>{a.lat}</b>ms p50</span>
                  <span className={+a.errRate > 1.3 ? 'app-err-hot' : ''}><b>{a.errRate}</b>% err</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Data Quality</span><span className="g-sub">INGEST INTEGRITY</span><span className="g-count">live</span></div>
          <div className="dq-strip">
            {dq.map((d) => <div className={`dq-card clk ${d.tone}`} key={d.l} onClick={() => openInfo('Data Quality · ' + d.l, 'Live ingest-integrity metric.', [['Metric', d.l], ['Value', String(d.v)]])}><span className="dq-l">{d.l}</span><span className="dq-v">{d.v}</span></div>)}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Job Queue</span><span className="g-sub">BACKGROUND TASKS</span><span className="g-count">{jobRunning} running</span></div>
          <div className="jq-list">
            {jobs.map((j) =>
            <div className="jq-row clk" key={j.id} onClick={() => openInfo('Job · ' + j.label, 'Background task — status: ' + j.st + '.', [['Job ID', j.id], ['Status', j.st], ['Detail', j.meta]])}>
                <span className={`jq-badge ${j.st}`}>{j.st}</span>
                <span className="jq-main"><span className="jq-label">{j.label}</span><span className="jq-id">{j.id}</span></span>
                <span className="jq-meta">{j.meta}</span>
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Integrations</span><span className="g-sub">CONNECTORS &amp; KEYS</span><span className="g-count">{integrations.filter((x) => x.tone === 'ok').length}/{integrations.length} ok</span></div>
          <div className="dq-strip">
            {integrations.map((x) =>
            <div className={`intg-card clk ${x.tone}`} key={x.l} onClick={() => openInfo('Integration · ' + x.l, x.l + ' is ' + x.v + '.', [['Status', x.v], ['Detail', x.meta]])}>
                <span className="intg-top"><span className="intg-dot" style={{ background: x.tone === 'ok' ? 'var(--ok)' : 'var(--warn)' }} />{x.l}</span>
                <span className="intg-v">{x.v}</span>
                <span className="intg-meta">{x.meta}</span>
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Edge Node Fleet</span><span className="g-sub">{NODES.length} NODES</span><span className="g-count">{online} online</span></div>
          <div className="node-grid">
            {[...NODES].sort((a, b) => { const rank = (n) => n.state === 'offline' ? 0 : n.state === 'degraded' ? 1 : 2; return rank(a) - rank(b); }).map((n) => <NodeCard key={n.id} n={n} tick={tick} />)}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Audit Log</span><span className="g-sub">RECENT ACTIVITY</span><span className="g-count">live</span></div>
          <div className="audit-list">
            {audit.map((a, i) =>
            <div className="audit-row clk" key={i} onClick={() => openInfo('Audit entry', a.who + ' ' + a.act + ' (' + a.t + ' ago).', [['Actor', a.who], ['Action', a.act], ['When', a.t + ' ago']])}>
                <span className="audit-who">{a.who}</span>
                <span className="audit-act">{a.act}</span>
                <span className="audit-t">{a.t}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>);

}

// ── Enterprise: per-line rollup + financials ─────────────────────────────────
const LINE_RATE = { 'Assembly Line A': 9200, 'Conveyor System': 5400, 'Hydraulic Systems': 6100, 'Utilities': 3300 }; // $/h downtime exposure

// Editable plant configuration — single source of truth that NEPHES recomputes from.
const DEFAULT_PLANT = {
  lines: SECTIONS.map((s, i) => ({ id: s.name, name: s.name, srcGroup: s.name, speed: [420, 360, 300, 220][i] || 300, downtimeRate: LINE_RATE[s.name] || 4000, crew: [6, 5, 4, 3][i] || 4, health: 96 })),
  unitPrice: 42, costTarget: 3.10, onTimeTarget: 95, scrapTarget: 0.40,
  maintBudget: 47000, maintUsed: 32000, shiftHours: 8,
  prodCrew: 20, prodPresent: 18, maintCrew: 8,
};

function PlantConfigModal({ config, onSave, onClose }) {
  const [c, setC] = React.useState(() => JSON.parse(JSON.stringify(config || DEFAULT_PLANT)));
  const setField = (k, v) => setC((p) => ({ ...p, [k]: v }));
  const setLine = (i, k, v) => setC((p) => { const lines = p.lines.slice(); lines[i] = { ...lines[i], [k]: v }; return { ...p, lines }; });
  const addLine = () => setC((p) => ({ ...p, lines: [...p.lines, { id: 'line-' + Date.now(), name: 'New Line ' + (p.lines.length + 1), srcGroup: null, speed: 300, downtimeRate: 4000, crew: 4, health: 96 }] }));
  const removeLine = (i) => setC((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }));
  const num = (k) => (e) => setField(k, e.target.value === '' ? 0 : +e.target.value);
  const totalSpeed = c.lines.reduce((s, l) => s + (+l.speed || 0), 0);

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="pc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">PLANT CONFIGURATION
          <span className="ds-head-meta">NEPHES recomputes targets, exposure & routing on save</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="pc-body">
          <div className="pc-sec-label">Production Lines <span className="ds-count">{c.lines.length}</span><span className="pc-target">plan target {fmt(totalSpeed)} u/hr</span></div>
          <div className="pc-lines">
            <div className="pc-line pc-line-head">
              <span>Line name</span><span>Speed u/hr</span><span>Downtime $/h</span><span>Crew</span><span />
            </div>
            {c.lines.map((ln, i) =>
            <div className="pc-line" key={ln.id}>
                <input className="pc-in" value={ln.name} onChange={(e) => setLine(i, 'name', e.target.value)} />
                <input className="pc-in num" type="number" value={ln.speed} onChange={(e) => setLine(i, 'speed', +e.target.value || 0)} />
                <input className="pc-in num" type="number" value={ln.downtimeRate} onChange={(e) => setLine(i, 'downtimeRate', +e.target.value || 0)} />
                <input className="pc-in num" type="number" value={ln.crew} onChange={(e) => setLine(i, 'crew', +e.target.value || 0)} />
                <button className="pc-rm" onClick={() => removeLine(i)} title="Remove line" disabled={c.lines.length <= 1}>✕</button>
              </div>
            )}
          </div>
          <button className="pc-add" onClick={addLine}>＋ Add production line</button>

          <div className="pc-sec-label">Targets &amp; Budget</div>
          <div className="pc-grid">
            <label className="pc-field"><span>Unit price ($)</span><input className="pc-in" type="number" value={c.unitPrice} onChange={num('unitPrice')} /></label>
            <label className="pc-field"><span>Cost / unit target ($)</span><input className="pc-in" type="number" step="0.01" value={c.costTarget} onChange={num('costTarget')} /></label>
            <label className="pc-field"><span>On-time target (%)</span><input className="pc-in" type="number" value={c.onTimeTarget} onChange={num('onTimeTarget')} /></label>
            <label className="pc-field"><span>Scrap target (%)</span><input className="pc-in" type="number" step="0.01" value={c.scrapTarget} onChange={num('scrapTarget')} /></label>
            <label className="pc-field"><span>Maint. budget ($)</span><input className="pc-in" type="number" value={c.maintBudget} onChange={num('maintBudget')} /></label>
            <label className="pc-field"><span>Maint. spent ($)</span><input className="pc-in" type="number" value={c.maintUsed} onChange={num('maintUsed')} /></label>
            <label className="pc-field"><span>Shift length (h)</span><input className="pc-in" type="number" value={c.shiftHours} onChange={num('shiftHours')} /></label>
          </div>

          <div className="pc-sec-label">Crew</div>
          <div className="pc-grid">
            <label className="pc-field"><span>Production crew</span><input className="pc-in" type="number" value={c.prodCrew} onChange={num('prodCrew')} /></label>
            <label className="pc-field"><span>Present this shift</span><input className="pc-in" type="number" value={c.prodPresent} onChange={num('prodPresent')} /></label>
            <label className="pc-field"><span>Maintenance crew</span><input className="pc-in" type="number" value={c.maintCrew} onChange={num('maintCrew')} /></label>
          </div>
        </div>
        <div className="modal-foot">
          <button className="mf-cancel" onClick={() => setC(JSON.parse(JSON.stringify(DEFAULT_PLANT)))}>Reset defaults</button>
          <button className="mf-submit" onClick={() => onSave(c)}>Apply &amp; reconfigure NEPHES</button>
        </div>
      </div>
    </div>);

}

function ExecRollup({ assets, setSel, stream, config, onConfigure }) {
  const cfg = config || DEFAULT_PLANT;
  const [drillLine, setDrillLine] = React.useState(null);
  const [woDone, setWoDone] = React.useState({});
  const [repPaused, setRepPaused] = React.useState({});
  // production-line cards sample slowly (~6s) so they shift gently instead of every tick
  const assetsRef = React.useRef(assets); assetsRef.current = assets;
  const snapLines = React.useCallback(() => {
    const snap = {};
    (cfg.lines || []).forEach((ln) => {
      const list = ln.srcGroup ? assetsRef.current.filter((a) => a.group === ln.srcGroup) : [];
      let crit = 0,warn = 0,ok = 0;
      list.forEach((a) => {const st = statusOf(a);if (st === 'crit') crit++;else if (st === 'warn') warn++;else ok++;});
      const h = list.length ? Math.round(ok / list.length * 100) : (ln.health != null ? ln.health : 96);
      snap[ln.id] = { crit, warn, ok, n: list.length, h };
    });
    return snap;
  }, [cfg.lines]);
  const [lineSnap, setLineSnap] = React.useState(snapLines);
  React.useEffect(() => { setLineSnap(snapLines()); const iv = setInterval(() => setLineSnap(snapLines()), 6000); return () => clearInterval(iv); }, [snapLines]);
  const critN = assets.filter((a) => statusOf(a) === 'crit').length;
  const warnN = assets.filter((a) => statusOf(a) === 'warn').length;
  const last = stream ? stream.last : { throughput: 1240, oee: 84, energy: 412 };
  const UNIT_PRICE = cfg.unitPrice;
  const revAtRisk = critN * 8200 + warnN * 1450;
  const downtimeCost = 4200 + critN * 3100 + warnN * 420;
  const outputRate = Math.round(last.throughput * UNIT_PRICE); // $/h
  const costPerUnit = (cfg.costTarget + warnN * 0.05 + critN * 0.14);
  const energyCost = Math.round(last.energy * 0.14); // $/h
  const maintUsed = Math.round(cfg.maintUsed / cfg.maintBudget * 100);
  // — money saved by NEPHES: real-time accrual at a fixed savings rate ($/sec) —
  const now = new Date();
  const shiftStart = new Date(now); shiftStart.setHours(6, 0, 0, 0);
  let shiftSec = (now - shiftStart) / 1000; if (shiftSec < 0) shiftSec += 86400;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthSec = (now - monthStart) / 1000;
  const SAVE_RATE = 0.05; // $ saved per second, scales with open anomalies
  const rate = SAVE_RATE + (critN + warnN) * 0.004;
  const savedShift = 18600 + shiftSec * rate + (critN + warnN) * 1400;
  const savedMTD = 1180000 + monthSec * rate + (critN + warnN) * 1400;
  const money2 = (n) => '$' + Math.floor(n).toLocaleString('en-US');
  const failuresAverted = 14 + critN;
  const downtimeAvoided = (47.5 + critN * 2.5).toFixed(1);
  // — rolling history for fin-card sparklines (self-contained, ~24 samples) —
  const finCur = { revAtRisk, outputRate, costPerUnit, energyCost };
  const [finHist, setFinHist] = React.useState(() => { const o = {}; for (const k in finCur) o[k] = Array.from({ length: 24 }, () => finCur[k]); return o; });
  React.useEffect(() => {
    setFinHist((h) => { const n = {}; for (const k in finCur) n[k] = [...h[k].slice(1), finCur[k]]; return n; });
  }, [stream ? stream.tick : 0]);
  const polColor = (hist, goodDir) => {
    if (!hist || hist.length < 6) return 'var(--text-3)';
    const d = hist[hist.length - 1] - hist[hist.length - 6];
    if (Math.abs(d) < Math.abs(hist[hist.length - 1]) * 0.004 + 0.02) return 'var(--text-3)';
    const rising = d > 0;
    return (goodDir === 'up' ? rising : !rising) ? 'var(--ok)' : 'var(--crit)';
  };
  const fins = [
    { l: 'Revenue at Risk', v: '$' + fmt(revAtRisk), sub: `this shift · ${critN + warnN} anomalies`, tone: critN ? 'crit' : warnN ? 'warn' : 'ok', hist: finHist.revAtRisk, goodDir: 'down' },
    { l: 'Downtime Cost', v: '$' + fmt(downtimeCost), sub: 'OEE loss · shift-to-date', tone: critN ? 'crit' : 'warn' },
    { l: 'Output Value', v: '$' + fmt(outputRate) + '/h', sub: `@ $${UNIT_PRICE}/unit`, tone: 'ok', hist: finHist.outputRate, goodDir: 'up' },
    { l: 'Cost / Unit', v: '$' + costPerUnit.toFixed(2), sub: (costPerUnit > cfg.costTarget ? '▲ ' : '') + 'vs $' + cfg.costTarget.toFixed(2) + ' plan', tone: costPerUnit > cfg.costTarget + 0.3 ? 'warn' : 'ok', hist: finHist.costPerUnit, goodDir: 'down' },
    { l: 'Energy Cost', v: '$' + fmt(energyCost) + '/h', sub: 'plant draw', tone: 'ok', hist: finHist.energyCost, goodDir: 'down' },
    { l: 'Maint. Budget', v: maintUsed + '%', sub: '$' + (cfg.maintUsed / 1000).toFixed(1) + 'k of $' + (cfg.maintBudget / 1000).toFixed(1) + 'k', tone: maintUsed > 85 ? 'warn' : 'ok' }];

  // — shift production vs plan (live, target = sum of line speeds) —
  const target = Math.max(1, cfg.lines.reduce((s, l) => s + (+l.speed || 0), 0));
  const attain = Math.round(last.throughput / target * 100);
  const unitsToday = Math.round(last.throughput * shiftSec / 3600);
  const unitsTarget = Math.max(1, Math.round(target * shiftSec / 3600));
  const takt = (3600 / Math.max(1, last.throughput)).toFixed(1);
  const onTime = Math.max(80, 98 - critN * 1.8 - warnN * 0.4).toFixed(1);
  const scrap = Math.max(0, 100 - last.quality).toFixed(2);
  const attainTone = attain >= 100 ? 'ok' : attain >= 92 ? 'warn' : 'crit';
  const shiftCards = [
    { l: 'Shift Attainment', v: attain + '%', sub: `${fmt(unitsToday)} / ${fmt(unitsTarget)} u`, tone: attainTone, bar: Math.min(100, attain) },
    { l: 'Output Rate', v: fmt(last.throughput), sub: 'units / hr', tone: 'ok' },
    { l: 'Takt Time', v: takt + 's', sub: 'per unit', tone: 'ok' },
    { l: 'On-Time Delivery', v: onTime + '%', sub: `vs ${cfg.onTimeTarget}% target`, tone: onTime >= cfg.onTimeTarget ? 'ok' : 'warn' },
    { l: 'Scrap Rate', v: scrap + '%', sub: `vs ${cfg.scrapTarget.toFixed(2)}% target`, tone: +scrap > cfg.scrapTarget + 0.2 ? 'warn' : 'ok' },
    { l: 'Crew On Shift', v: `${cfg.prodPresent}/${cfg.prodCrew}`, sub: `Shift A · ${Math.max(0, cfg.prodCrew - cfg.prodPresent)} absent`, tone: cfg.prodPresent >= cfg.prodCrew * 0.85 ? 'ok' : 'warn' }];

  // — work orders & maintenance (live counts, routed across maintenance crew) —
  const woOpen = 5 + warnN + critN;
  const woOverdue = critN;
  const pmCompliance = Math.max(68, 94 - critN * 4);
  const flaggedAssets = assets.filter((a) => statusOf(a) !== 'ok').sort((a, b) => (statusOf(b) === 'crit' ? 1 : 0) - (statusOf(a) === 'crit' ? 1 : 0));
  const ASSIGNEES = Array.from({ length: Math.max(1, cfg.maintCrew) }, (_, i) => `Tech ${i + 1}`);
  const NAMED = ['M. Reyes', 'T. Okafor', 'L. Berg', 'J. Park', 'D. Singh', 'A. Cole', 'R. Vance', 'S. Kim'];
  for (let i = 0; i < ASSIGNEES.length && i < NAMED.length; i++) ASSIGNEES[i] = NAMED[i];
  const workOrders = [];
  flaggedAssets.slice(0, 4).forEach((a, i) => {
    const cr = statusOf(a) === 'crit';
    workOrders.push({ id: 'WO-' + (4820 + i), asset: a.name, pri: cr ? 'P1' : 'P2', who: ASSIGNEES[i % ASSIGNEES.length], due: cr ? 'Due now' : i % 2 ? '2h' : 'Today', tone: cr ? 'crit' : 'warn' });
  });
  workOrders.push({ id: 'WO-4815', asset: 'SPINDLE-DRV', pri: 'P3', who: ASSIGNEES[2], due: 'Scheduled · Thu', tone: 'ok' });
  workOrders.push({ id: 'WO-4811', asset: 'CONV-FEED', pri: 'PM', who: ASSIGNEES[3], due: 'PM · 120h', tone: 'ok' });

  // — trends (live session series) —
  const ser = stream && stream.series ? stream.series : {};
  const oeeSeries = ser.oee || [];
  const outSeries = ser.throughput || [];
  const enSeries = ser.energy || [];
  const trendCards = [
    { l: 'OEE', v: last.oee != null ? last.oee.toFixed(1) + '%' : '—', s: oeeSeries, color: 'var(--accent)' },
    { l: 'Output', v: fmt(last.throughput) + ' u/h', s: outSeries, color: 'var(--ok)' },
    { l: 'Energy', v: fmt(last.energy) + ' kW', s: enSeries, color: 'var(--warn)' }];
  // shift-over-shift attainment bars (last 7 shifts, synthetic + current)
  const shiftBars = [94, 88, 101, 97, 91, 99, attain].map((v, i) => ({ v, cur: i === 6 }));

  // — downtime Pareto (top causes, scaled by live anomaly mix) —
  const paretoRaw = [
    { c: 'Mechanical wear', v: 34 + critN * 6 },
    { c: 'Sensor / signal fault', v: 21 + warnN * 3 },
    { c: 'Changeover / setup', v: 18 },
    { c: 'Material starvation', v: 12 },
    { c: 'Operator / process', v: 9 },
    { c: 'Power / utilities', v: 6 }];
  const paretoMax = Math.max(...paretoRaw.map((p) => p.v));
  const paretoTotal = paretoRaw.reduce((s, p) => s + p.v, 0);

  // — safety & compliance —
  const daysSinceIncident = 47 - (critN > 1 ? 1 : 0);
  const safety = [
    { l: 'Days Since Incident', v: daysSinceIncident, sub: 'recordable', tone: daysSinceIncident >= 30 ? 'ok' : 'warn' },
    { l: 'Open CAPAs', v: 3 + critN, sub: 'corrective actions', tone: critN ? 'warn' : 'ok' },
    { l: 'Audits Due', v: 2, sub: 'next 30 days', tone: 'ok' },
    { l: 'Near-Misses', v: 4, sub: 'this month', tone: 'ok' }];

  // — scheduled reports —
  const reports = [
    { name: 'Shift Summary', cad: 'Every shift · 14:00', next: '2h 14m', on: true },
    { name: 'Executive Daily', cad: 'Daily · 06:00', next: 'Tomorrow', on: true },
    { name: 'Maintenance Weekly', cad: 'Mon · 08:00', next: '4 days', on: true },
    { name: 'Energy & Sustainability', cad: 'Monthly · 1st', next: '12 days', on: false }];

  return (
    <div className="wall-card">
      <div className="card-head">
        {drillLine ?
        <button className="back-btn" onClick={() => setDrillLine(null)}>← Back to Plant Overview</button> :

        <React.Fragment>PLANT OVERVIEW <span className="count-pill">{cfg.lines.length} lines</span><span className="count-pill" style={{ marginLeft: 6 }}>FINANCIAL</span>
            <button className="cfg-btn" onClick={onConfigure} title="Configure plant">⚙ Configure</button>
          </React.Fragment>}

      </div>
      <div className="wall-scroll" style={{ padding: '10px 13px' }}>
        {drillLine ? (() => {
          const list = assets.filter((a) => a.group === drillLine);
          let dCrit = 0,dWarn = 0,dOk = 0;
          list.forEach((a) => { const st = statusOf(a); if (st === 'crit') dCrit++; else if (st === 'warn') dWarn++; else dOk++; });
          const dH = list.length ? Math.round(dOk / list.length * 100) : 96;
          const dHc = dH >= 85 ? 'var(--ok)' : dH >= 65 ? 'var(--accent)' : 'var(--crit)';
          return (
            <div className="drill-view fade-in">
              <div className="drill-head">
                <div className="drill-name">{drillLine}</div>
                <div className="drill-health" style={{ color: dHc }}>{dH}% healthy · {list.length} assets · {dCrit} crit · {dWarn} warn</div>
              </div>
              <div className="grp-grid">
                {list.map((a) => <SensorTile key={a.id} a={a} selected={false} onSelect={() => openInfo(a.name, a.group + ' · ' + a.label, [['Value', a.val.toFixed(a.dec != null ? a.dec : 1) + a.unit], ['Status', statusOf(a)], ['Range', a.min + '–' + a.max + a.unit]])} />)}
              </div>
            </div>);

        })() :

        <React.Fragment>
        <div className="saved-hero">
          <div className="sh-left">
            <div className="sh-l">Saved by NEPHES · month-to-date</div>
            <div className="sh-v">{money2(savedMTD)}</div>
            <div className="sh-trend">▲ accruing · {money2(savedShift)} this shift</div>
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
            <div className={`fin-card clk ${f.tone}`} key={f.l} onClick={() => openInfo(f.l, f.sub, [['Value', f.v], ['Detail', f.sub]], f.hist ? { label: '⤓ Export CSV', run: () => exportCSV(f.l.replace(/[^\w]+/g, '_') + '.csv', ['sample', f.l], f.hist.map((v, i) => [i + 1, (+v).toFixed(2)])) } : { label: '📌 Add to Executive Daily', toastMsg: f.l + ' added to the Executive Daily report' })}>
                <div className="fc-l">{f.l}</div>
                <div className="fc-v" style={f.hist ? { color: polColor(f.hist, f.goodDir) } : null}>{f.v}</div>
                <div className="fc-s">{f.sub}</div>
                {f.hist && <div className="fc-spark"><Spark series={f.hist} w={120} h={24} color={polColor(f.hist, f.goodDir)} strokeW={2.2} glow dot={false} /></div>}
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Shift Performance</span><span className="g-sub">SHIFT A · VS PLAN</span><span className="g-count">live</span></div>
          <div className="fin-strip">
            {shiftCards.map((c) =>
            <div className={`fin-card clk ${c.tone}`} key={c.l} onClick={() => openInfo(c.l, c.sub, [['Value', c.v], ['Detail', c.sub]])}>
                <div className="fc-l">{c.l}</div>
                <div className="fc-v">{c.v}</div>
                <div className="fc-s">{c.sub}</div>
                {c.bar != null && <div className="sp-attain-bar"><div style={{ width: c.bar + '%', background: c.tone === 'ok' ? 'var(--ok)' : c.tone === 'warn' ? 'var(--warn)' : 'var(--crit)' }} /></div>}
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Production Lines</span><span className="g-sub">HEALTH · $ EXPOSURE</span><span className="g-count">{cfg.lines.length}</span></div>
          <div className="exec-grid">
            {cfg.lines.map((ln) => {
              const s = lineSnap[ln.id] || { crit: 0, warn: 0, ok: 0, n: 0, h: ln.health != null ? ln.health : 96 };
              const crit = s.crit,warn = s.warn,h = s.h;
              const hc = h >= 85 ? 'var(--ok)' : h >= 65 ? 'var(--accent)' : 'var(--crit)';
              const atRisk = crit * Math.round(ln.downtimeRate * 0.9) + warn * Math.round(ln.downtimeRate * 0.16);
              const riskTone = crit ? 'var(--crit)' : warn ? 'var(--warn)' : 'var(--text-3)';
              return (
                <button key={ln.id} className="exec-card" onClick={() => setDrillLine(ln.name)}>
                  <div className="ec-top">
                    <div>
                      <div className="ec-name">{ln.name}</div>
                      <div className="ec-sub">{ln.speed} u/hr · {ln.crew} crew · {s.n || '—'} sensors</div>
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
        <div className="grp">
          <div className="grp-head"><span className="g-name">Work Orders &amp; Maintenance</span><span className="g-sub">TODAY</span><span className="g-count">{woOpen} open</span></div>
          <div className="wo-summary">
            <div className="wo-stat"><span className="wo-sv">{woOpen}</span><span className="wo-sl">Open WOs</span></div>
            <div className="wo-stat"><span className="wo-sv" style={{ color: woOverdue ? 'var(--crit)' : 'var(--ok)' }}>{woOverdue}</span><span className="wo-sl">Overdue</span></div>
            <div className="wo-stat"><span className="wo-sv" style={{ color: pmCompliance >= 90 ? 'var(--ok)' : 'var(--warn)' }}>{pmCompliance}%</span><span className="wo-sl">PM Compliance</span></div>
            <div className="wo-stat"><span className="wo-sv">{downtimeAvoided}h</span><span className="wo-sl">Downtime Avoided</span></div>
          </div>
          <div className="wo-list">
            {workOrders.map((w) => woDone[w.id] ?
            <div className="wo-row off" key={w.id}>
                <span className="wo-pri ok">✓</span>
                <span className="wo-main"><span className="wo-asset">{w.asset}</span><span className="wo-id">{w.id} · completed</span></span>
                <span className="wo-due" style={{ color: 'var(--ok)' }}>Done</span>
              </div> :
            <div className={`wo-row clk ${w.tone}`} key={w.id} onClick={() => openInfo(w.id + ' · ' + w.asset, w.pri + ' work order assigned to ' + w.who, [['Priority', w.pri], ['Asset', w.asset], ['Assignee', w.who], ['Due', w.due]], { label: '✓ Mark complete', run: () => { setWoDone((p) => ({ ...p, [w.id]: true })); logAction(w.asset, 'Work order ' + w.id + ' completed · ' + w.who); toast(w.id + ' marked complete'); } })}>
                <span className={`wo-pri ${w.tone}`}>{w.pri}</span>
                <span className="wo-main"><span className="wo-asset">{w.asset}</span><span className="wo-id">{w.id} · {w.who}</span></span>
                <span className="wo-due" style={{ color: w.tone === 'crit' ? 'var(--crit)' : w.tone === 'warn' ? 'var(--warn)' : 'var(--text-3)' }}>{w.due}</span>
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Performance Trends</span><span className="g-sub">SESSION · SHIFT-OVER-SHIFT</span><span className="g-count">live</span></div>
          <div className="trend-strip">
            {trendCards.map((c) =>
            <div className="trend-card" key={c.l}>
                <div className="tc-top"><span className="tc-label">{c.l}</span><span className="tc-value">{c.v}</span></div>
                <Spark series={c.s} w={210} h={40} color={c.color} strokeW={1.6} />
              </div>
            )}
          </div>
          <div className="sos-wrap">
            <div className="sos-label">Shift attainment — last 7</div>
            <div className="sos-bars">
              {shiftBars.map((b, i) =>
              <div className="sos-col" key={i}>
                  <div className="sos-bar" style={{ height: Math.min(100, b.v) + '%', background: b.cur ? 'var(--accent)' : b.v >= 100 ? 'var(--ok)' : b.v >= 92 ? 'rgba(var(--accent-rgb),.5)' : 'var(--warn)' }} />
                  <span className="sos-v">{b.v}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Downtime Pareto</span><span className="g-sub">CAUSES · 7-DAY</span><span className="g-count">{paretoTotal}h</span></div>
          <div className="pareto">
            {paretoRaw.map((p, i) =>
            <div className="pareto-row clk" key={p.c} onClick={() => openInfo('Downtime cause · ' + p.c, p.v + ' hours over the last 7 days (' + Math.round(p.v / paretoTotal * 100) + '% of total downtime).', [['Cause', p.c], ['Hours (7d)', p.v + 'h'], ['Share', Math.round(p.v / paretoTotal * 100) + '%']])}>
                <span className="pareto-c">{p.c}</span>
                <div className="pareto-track"><div className="pareto-fill" style={{ width: p.v / paretoMax * 100 + '%', background: i === 0 ? 'var(--crit)' : i === 1 ? 'var(--warn)' : 'var(--accent)' }} /></div>
                <span className="pareto-v">{p.v}h · {Math.round(p.v / paretoTotal * 100)}%</span>
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Safety &amp; Compliance</span><span className="g-sub">PLANT</span><span className="g-count">{daysSinceIncident}d clean</span></div>
          <div className="fin-strip">
            {safety.map((s) =>
            <div className={`fin-card clk ${s.tone}`} key={s.l} onClick={() => openInfo(s.l, s.sub, [['Value', s.v], ['Detail', s.sub]])}>
                <div className="fc-l">{s.l}</div>
                <div className="fc-v">{s.v}</div>
                <div className="fc-s">{s.sub}</div>
              </div>
            )}
          </div>
        </div>
        <div className="grp">
          <div className="grp-head"><span className="g-name">Scheduled Reports</span><span className="g-sub">AUTO-DELIVERY</span><span className="g-count">{reports.filter((r) => r.on).length} active</span></div>
          <div className="rep-list">
            {reports.map((r) => { const effOn = repPaused[r.name] ? !r.on : r.on; return (
            <div className={`rep-row clk ${effOn ? '' : 'off'}`} key={r.name} onClick={() => openInfo('Report · ' + r.name, (effOn ? 'Auto-delivery active.' : 'Currently paused.') + ' ' + r.cad, [['Cadence', r.cad], ['Status', effOn ? 'Active' : 'Paused'], ['Next run', effOn ? r.next : '—']], { label: effOn ? '⏸ Pause report' : '▶ Resume report', run: () => { setRepPaused((p) => ({ ...p, [r.name]: !p[r.name] })); toast(r.name + (effOn ? ' paused' : ' resumed · next run ' + r.next)); } })}>
                <span className={`rep-dot ${effOn ? 'on' : ''}`} />
                <span className="rep-main"><span className="rep-name">{r.name}</span><span className="rep-cad">{r.cad}</span></span>
                <span className="rep-next">{effOn ? 'next · ' + r.next : 'paused'}</span>
              </div>);
            })}
          </div>
        </div>
        </React.Fragment>}

      </div>
    </div>);

}

// ── Side column ──────────────────────────────────────────────────────────────
function DetailCard({ a, onClose, onAct, autoMit, mitigating, onMitigate, isTop, justResolved, progress, onPatchSensor, muted, onMute, pinnedWs, onPinWs }) {
  const st = statusOf(a);
  const c = SEV_COLOR[st];
  const mn = Math.min(...a.series),mx = Math.max(...a.series),avg = a.series.reduce((s, v) => s + v, 0) / a.series.length;
  return (
    <div className="side-card" id="detailCard">
      <div className="card-head">SENSOR DETAIL {isTop && <span className="dc-pill">TOP PRIORITY · AUTO</span>}{onPinWs && <button className={'ws-pin' + (pinnedWs ? ' on' : '')} onClick={() => onPinWs(a.id)} title={pinnedWs ? 'Unpin from the active workspace' : 'Pin to workspace — builds a working set you can return to'}>{pinnedWs ? '📌 PINNED' : '📌 PIN'}</button>}<button className="detail-close" onClick={onClose}>✕</button></div>
      <div className="detail-body">
        <div className="detail-title">{a.name}</div>
        <div className="detail-sub">{a.group} · {a.label} · sampling 950ms</div>
        <button className="lad-link" title="Open this asset's control program in the Logic profile" onClick={() => window.dispatchEvent(new CustomEvent('nephes:ladder', { detail: { cls: (a.group || '') + ' ' + a.name } }))}>⠹⠺ LADDER LOGIC</button>
        <div className="mute-row">
          <span className="mute-l">ALERTS</span>
          <span className="mute-tog-wrap">
            <span className={`mute-tog-label ${muted && (muted.banner || muted.bell) ? 'off' : ''}`}>{muted && (muted.banner || muted.bell) ? 'Muted' : 'On'}</span>
            <button className={`mini-tog ${!(muted && (muted.banner || muted.bell)) ? 'on' : ''}`} aria-pressed={!(muted && (muted.banner || muted.bell))} onClick={() => onMute && onMute(a.id, 'all')} title={(muted && (muted.banner || muted.bell) ? 'Unmute' : 'Mute') + ' this sensor — events + notifications'}><span className="mt-knob2" /></button>
          </span>
        </div>
        <div className="detail-spark-lg limit-wrap">
          <LimitChart a={a} onCommit={(patch) => onPatchSensor && onPatchSensor(a.id, patch)} />
          <div className="limit-cap">Alarm limits — drag the dashed lines to tune when this sensor alarms</div>
          {(() => {
          const mods = [['warnHi', 'recWarnHi'], ['critHi', 'recCritHi'], ['warnLo', 'recWarnLo'], ['critLo', 'recCritLo']].filter(([f, r]) => a[r] != null && a[f] !== a[r]);
          if (!mods.length) return null;
          const d2 = a.dec != null ? a.dec : 1;
          return (
            <div className="limit-rec">
                <span className="lr-tag">custom limits</span>
                <span className="lr-txt">NEPHES recommends {mods.map(([f, r]) => `${f.indexOf('warn') === 0 ? 'warn' : 'crit'}${f.slice(-2) === 'Lo' ? ' low' : ''} ${(+a[r]).toFixed(d2)}`).join(' · ')}</span>
                <button className="lr-apply" onClick={() => { const patch = {}; mods.forEach(([f, r]) => patch[f] = a[r]); onPatchSensor && onPatchSensor(a.id, patch); }}>Apply</button>
              </div>);
        })()}
        </div>
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
                  {justResolved ?
                <button className="r-primary done" disabled>✓ Resolved — readings normal</button> :
                autoMit || mitigating ?
                <button className="r-primary auto" disabled>◉ {autoMit ? 'Auto-mitigating' : 'Mitigating'}{progress != null ? ` · ${Math.round(progress * 100)}%` : '…'}</button> :
                <button className={`r-primary ${cls}`} onClick={() => onMitigate && onMitigate(a.id)}>{st === 'crit' ? 'Start Mitigation' : 'Dispatch Technician'}</button>}
                </React.Fragment>);

          })()}
          </div>
        }
        {st === 'ok' && (justResolved || mitigating) &&
        <div className="detail-ai ok">
            <div className="da-head"><span className="da-dot" style={{ background: 'var(--ok)' }} />NEPHES AI ANALYSIS</div>
            <div className="da-msg">Mitigation completed — {a.label.toLowerCase()} on {a.name} is back in the normal range.</div>
            <button className="r-primary done" disabled>✓ Resolved — readings normal</button>
          </div>
        }
        {st === 'ok' && !justResolved && !mitigating &&
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
                  <a className="dv-doc" key={doc.t} href="#" onClick={(e) => { e.preventDefault(); openInfo(doc.t, 'Device documentation · ' + d.model, [['Document', doc.t], ['Type', doc.meta], ['Model', d.model], ['Format', 'PDF · 2.1 MB']], { label: '⤓ Download PDF', toastMsg: doc.t + ' downloaded' }); }}>
                      <span className="dvd-ic">{doc.ic}</span>
                      <span className="dvd-text"><span className="dvd-t">{doc.t}</span><span className="dvd-m">{doc.meta}</span></span>
                      <span className="dvd-arrow">⤓</span>
                    </a>
                  )}
                </div>
              </div>
              <div className="dv-sec">
                <div className="dv-head">🧰 REPLACEMENT PARTS <span className="dv-model">{d.model}</span></div>
                <div className="dv-parts">
                  {d.parts.map((p) => {
                    const stat = p.qty === 0 ? 'out' : p.qty <= 2 ? 'low' : 'ok';
                    return (
                      <div className={`dv-part ${stat}`} key={p.sku}>
                        <span className="dvp-main"><span className="dvp-name">{p.name}</span><span className="dvp-sku">{p.sku}</span></span>
                        <span className={`dvp-qty ${stat}`}>{p.qty === 0 ? 'Out of stock' : p.qty + ' in stock'}</span>
                        <button className="dvp-order" onClick={() => { const po = 'PO-' + (7300 + Math.floor(Math.random() * 600)); toast(p.name + ' ordered · ' + po); logAction(a.name, p.name + ' ordered · ' + po); }}>{p.qty === 0 ? 'Backorder' : 'Order'}</button>
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
    addr: `10.4.${num % 6 + 1}.${num % 200 + 20}`,
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
function FaultSim({ groups, zoneHealth, faults, faultTypes, faultHw, techs, injectFault, clearFault, clearAllFaults }) {
  const [target, setTarget] = React.useState(groups[0]);
  const [sev, setSev] = React.useState('crit');
  const active = Object.entries(faults);
  const zh = zoneHealth || {};
  return (
    <div className="side-card fault-sim" id="opCard">
      <div className="card-head">FAULT SIMULATOR <span className="sim-badge">simulation only</span><span className={`fs-pill ${active.length ? 'on' : ''}`} style={{ marginLeft: 'auto' }}>{active.length ? active.length + ' active' : 'armed'}</span></div>
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
                <span className="fs-item-name">{g}<span className="fs-item-type"> · {(faultTypes || {})[g] || 'Fault'}{(faultHw || {})[g] ? (techs || {})[g] ? ' · tech en route' : ' · needs technician' : ''}</span></span>
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
  '📊 Impact': { title: 'Impact Report', rows: [['Throughput at risk', '3.2% · $1,240/shift'], ['Top contributor', 'Assembly Line A'], ['Active alarms', '4'], ['Saved month-to-date', '$1.94M']], cta: 'Open full report' },
  '📈 Forecast': { title: '7-Day Forecast', rows: [['Projected OEE', '85.6% ▲1.4pp'], ['Predicted failures', '3 events'], ['Next maint. window', 'Thu 02:00'], ['Model confidence', '88%']], cta: 'View forecast model' },
  '🔔 Notify Lead': { title: 'Escalate to Lead', rows: [['Recipients', 'Plant Lead · Ops Mgr'], ['Severity', 'High'], ['Channel', 'SMS + Email'], ['Last sent', '14:02']], cta: 'Send notification' },
  '📤 Export': { title: 'Export Snapshot', rows: [['Range', 'Shift A · 06:00–now'], ['Format', 'PDF'], ['Scope', 'All lines · 2,000 sensors']], cta: 'Generate export' }
};

const EXEC_ACTIONS = [
  { key: 'impact', ic: '📊', t: 'Impact Report', d: 'Live throughput & $ at risk', title: 'Impact Report', rows: [['Throughput at risk', '3.2% · $1,240/shift'], ['Top contributor', 'Assembly Line A'], ['Active alarms', '4'], ['Saved month-to-date', '$1.94M']], cta: 'Open full report' },
  { key: 'forecast', ic: '📈', t: '7-Day Forecast', d: 'Predicted OEE & failures', title: '7-Day Forecast', rows: [['Projected OEE', '85.6% ▲1.4pp'], ['Predicted failures', '3 events'], ['Next maint. window', 'Thu 02:00'], ['Model confidence', '88%']], cta: 'View forecast model' },
  { key: 'notify', ic: '🔔', t: 'Notify Lead', d: 'Escalate to plant lead', title: 'Escalate to Lead', rows: [['Recipients', 'Plant Lead · Ops Mgr'], ['Severity', 'High'], ['Channel', 'SMS + Email'], ['Last sent', '14:02']], cta: 'Send notification' },
  { key: 'export', ic: '📤', t: 'Export Snapshot', d: 'PDF of current state', title: 'Export Snapshot', rows: [['Range', 'Shift A · 06:00–now'], ['Format', 'PDF'], ['Scope', 'All lines · 2,000 sensors']], cta: 'Generate export' },
  { key: 'spend', ic: '✅', t: 'Approve Spend', d: '2 maintenance POs pending', title: 'Approve Spend', rows: [['PO-2231 · Bearings', '$4,200'], ['PO-2232 · Filter kit', '$1,150'], ['Budget remaining', '$15.0k'], ['Approver', 'You']], cta: 'Approve all' },
  { key: 'review', ic: '🗓', t: 'Schedule Review', d: 'Shift handover & standup', title: 'Schedule Review', rows: [['Next handover', '14:00 · Shift B'], ['Standup', 'Tomorrow 06:15'], ['Attendees', '6 leads'], ['Agenda items', '4']], cta: 'Open scheduler' }];

function ExecActions({ summaryStatus }) {
  const [open, setOpen] = React.useState(null);
  const win = EXEC_ACTIONS.find((a) => a.key === open) || null;
  return (
    <div className="side-card exec-actions" id="opCard">
      <div className="card-head">EXECUTIVE ACTIONS <span className="count-pill">{EXEC_ACTIONS.length}</span></div>
      <div className="ea-body">
        <div className="ea-grid">
          {EXEC_ACTIONS.map((a) =>
          <button key={a.key} className={`ea-tile ${open === a.key ? 'on' : ''}`} onClick={() => setOpen(open === a.key ? null : a.key)}>
              <span className="ea-ic">{a.ic}</span>
              <span className="ea-t">{a.t}</span>
              <span className="ea-d">{a.d}</span>
            </button>
          )}
        </div>
        {win &&
        <div className="ea-detail">
            <div className="ea-detail-head">{win.title}<button className="op-window-close" onClick={() => setOpen(null)}>✕</button></div>
            <div className="ea-detail-rows">
              {win.rows.map(([k, v]) => <div className="ow-row" key={k}><span className="ow-k">{k}</span><span className="ow-v">{v}</span></div>)}
            </div>
            <button className="ow-cta" onClick={() => {
            if (open === 'notify') { toast('Notification sent to Plant Lead · SMS + Email'); logAction('PLANT-LEAD', 'Escalation sent to Plant Lead & Ops Mgr'); }
            else if (open === 'forecast') { toast('Forecast recalculated · model v4.2.1 · confidence 88%'); }
            else if (open === 'impact') { exportCSV('impact_report.csv', ['metric', 'value'], win.rows.map((r) => [r[0], String(r[1]).replace(/,/g, ' ')])); logAction('PLANT', 'Impact report exported'); }
            else if (open === 'review') { toast('Handover scheduled · invites sent to Shift B'); logAction('SHIFT-B', 'Handover review scheduled · 14:00'); }
            else { toast(win.cta + ' ✓'); }
            setOpen(null);
          }}>{win.cta}</button>
          </div>
        }
        <div className="ea-status">{summaryStatus}</div>
      </div>
    </div>);

}

function OperatorControls({ profile, assets }) {
  const [openAction, setOpenAction] = React.useState(null);
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
  const win = profile === 'enterprise' && openAction ? EXEC_WINDOWS[openAction] : null;
  return (
    <div className="side-card" id="opCard">
      <div className="card-head">{cfg.title}<button className="collapse-btn">▾</button></div>
      <div className="op-body">
        {cfg.rows.map((r, i) =>
        <React.Fragment key={i}>
            <div className="op-label">{r.label}</div>
            <div className="op-row">{r.btns.map((b) => {
              const opens = profile === 'enterprise' && EXEC_WINDOWS[b];
              const isOpen = openAction === b;
              return <button key={b} className={`op-btn ${b.includes('Pause') || b.includes('Maintenance') ? 'inject' : ''} ${isOpen ? 'active' : ''}`} onClick={opens ? () => setOpenAction(isOpen ? null : b) : undefined}>{b}</button>;
            })}</div>
          </React.Fragment>
        )}
        <div className="op-status">{cfg.status}</div>
      </div>
      {win &&
      <div className="op-window">
          <div className="op-window-head">{win.title}<button className="op-window-close" onClick={() => setOpenAction(null)}>✕</button></div>
          <div className="op-window-body">
            {win.rows.map(([k, v]) => <div className="ow-row" key={k}><span className="ow-k">{k}</span><span className="ow-v">{v}</span></div>)}
            <button className="ow-cta">{win.cta}</button>
          </div>
        </div>
      }
    </div>);

}

function AiAnalysis({ profile, alerts, onAct, autoMit, setAutoMit, mitigating, onMitigate, topId, shownId, shownName, pool, mitProgress, resolved, hwGroups, techs, onDispatch, wsPinned, onPinWs }) {
  const n = alerts.length;
  const critN = alerts.filter((a) => statusOf(a) === 'crit').length;
  const meta = {
    manufacturing: {
      sum: n ? `Tracking ${n} open recommendation${n > 1 ? 's' : ''} across the floor, ranked by failure-risk confidence.` : 'All monitored assets within nominal parameters. No mitigations required.',
      chips: [['Scan', '950ms'], ['Experts', '8 active'], ['Confidence', '92%']],
    },
    enterprise: {
      sum: n ? `~3.2% throughput at risk this shift ($1,240). ${n} item${n > 1 ? 's' : ''} need owner sign-off.` : 'No financial exposure from anomalies this shift. Output tracking to plan.',
      chips: [['At risk', '$1,240'], ['Throughput', '−3.2%'], ['Sign-off', n + ' item' + (n === 1 ? '' : 's')]],
    },
    backend: {
      sum: n ? `Telemetry variance elevated on ${n} channel${n > 1 ? 's' : ''}. No packet loss; drift measured vs 24h baseline.` : 'All channels nominal. Model drift within tolerance; zero packet loss.',
      chips: [['Drift', '+0.3σ'], ['Loss', '0.0%'], ['Model', 'v4.2.1']],
    },
  }[profile];

  if (profile === 'manufacturing' && pool && pool.length) {
    // ── Priority Action Queue, manufacturing: merges AI recommendations + Top-Risks proximity ranking into one list ──
    const ranked = pool.map((a) => ({ a, r: riskOf(a), st: statusOf(a) })).sort((x, y) => y.r.frac - x.r.frac).slice(0, 7);
    const mCritN = ranked.filter((x) => x.st === 'crit').length;
    return (
      <div className="side-card priority-queue" id="aiCard">
        <div className="card-head">
          PRIORITY ACTION QUEUE
          <span className={`count-pill ${mCritN ? 'crit' : ''}`} style={{ marginLeft: 'auto' }}>{mCritN} critical</span>
          <button className={`pq-auto ${autoMit ? 'on' : ''}`} onClick={() => setAutoMit && setAutoMit((v) => !v)} title="Auto-mitigate — same switch as the header; NEPHES fixes problems by itself">◉ Auto {autoMit ? 'ON' : 'OFF'}</button>
        </div>
        <div className="ai-body">
          <div className="ai-assess">
            <div className="a-head">Assessment</div>
            <div className="a-sum">{meta.sum}</div>
            <div className="ai-chips">
              {meta.chips.map(([k, v]) => <span className="ai-chip" key={k}><span className="aic-k">{k}</span><span className="aic-v">{v}</span></span>)}
            </div>
          </div>
          {ranked.length === 0 && <div className="ai-empty">✓ All quiet — every sensor in range. Inject a test fault from Simulation &amp; Tools, or press ▶ Demo in the header, to watch NEPHES respond.</div>}
          {ranked.map(({ a, r, st }, i) => {
            const conf = st === 'crit' ? 0.86 + a.id.length % 7 * 0.014 : st === 'warn' ? 0.62 + a.id.length % 7 * 0.025 : Math.min(0.55, r.frac * 0.6);
            const hw = !!(hwGroups && hwGroups[a.group] && st !== 'ok');
            const msg = hw ?
            `${a.label} out of range on ${a.name} — mechanical wear detected. Software can't correct this; on-site repair required.` :
            st !== 'ok' ?
            REC_MSGS[a.id] || `${a.label} ${st === 'crit' ? 'exceeded critical limit' : 'drifting toward warning band'} on ${a.name}. Recommend inspection.` :
            `${a.label} on ${a.name} is trending toward its warning threshold — no breach yet.`;
            return (
              <PriorityItem key={a.id} index={i} a={a} st={st} conf={conf} msg={msg}
                busy={st !== 'ok' && !hw && !!(autoMit || (mitigating && mitigating[a.id]))}
                progress={mitigating && mitigating[a.id] && mitProgress ? mitProgress(a) : null}
                autoLabel={autoMit ? 'Auto-mitigating' : mitigating && mitigating[a.id] > 1 && Date.now() - mitigating[a.id] < 6000 ? 'Dispatching' : 'Mitigating'}
                onMitigate={() => onMitigate && onMitigate(a.id)}
                hw={hw} tech={!!(techs && techs[a.group])} onDispatch={() => onDispatch && onDispatch(a)}
                shown={a.id === shownId || (shownName != null && a.name === shownName)} onOpen={() => onAct && onAct(a.id)}
                top={a.id === topId} pinned={onPinWs ? !!(wsPinned && wsPinned.has(a.id)) : null} onPin={onPinWs ? () => onPinWs(a.id) : null} />);

          })}
        </div>
      </div>);

  }

  if (profile === 'backend') {
    // ── Priority Action Queue, backend: infrastructure/network alerts (never mechanical sensor alerts) ──
    const INFRA_ALERTS = [
    { id: 'gw-plant', name: 'GW-PLANT', label: 'Minutes Offline', unit: 'm', val: 4, dec: 0, min: 0, max: 15, warnHi: 1, critHi: 2,
      msg: 'Plant Gateway is OFFLINE (last seen 4m ago). Zero telemetry routing from Assembly Line B wrapper. Immediate container restart recommended.', conf: 0.97 },
    { id: 'edge-10', name: 'EDGE-10', label: 'CPU Utilization', unit: '%', val: 83, dec: 0, min: 0, max: 100, warnHi: 75, critHi: 90,
      msg: 'Paint Line edge node hitting 83% CPU utilization. Memory leak or thread contention suspected on container v3.3.9.', conf: 0.81 },
    { id: 'ethip-gw', name: 'ETHERNET/IP', label: 'Packet Loss', unit: '%', val: 1.8, dec: 1, min: 0, max: 10, warnHi: 1.0, critHi: 3.0,
      msg: 'Packet loss degraded to 1.8%. Check network switch port configuration or cabling noise near line drop.', conf: 0.74 }];

    const critN2 = INFRA_ALERTS.filter((a) => statusOf(a) === 'crit').length;
    return (
      <div className="side-card priority-queue" id="aiCard">
        <div className="card-head">
          PRIORITY ACTION QUEUE
          <span className={`count-pill ${critN2 ? 'crit' : ''}`} style={{ marginLeft: 'auto' }}>{critN2} critical</span>
        </div>
        <div className="ai-body">
          <div className="ai-assess">
            <div className="a-head">Assessment</div>
            <div className="a-sum">{meta.sum}</div>
            <div className="ai-chips">
              {meta.chips.map(([k, v]) => <span className="ai-chip" key={k}><span className="aic-k">{k}</span><span className="aic-v">{v}</span></span>)}
            </div>
          </div>
          {INFRA_ALERTS.map((a, i) => {
            const st = statusOf(a);
            return (
              <PriorityItem key={a.id} index={i} a={a} st={st} conf={a.conf} msg={a.msg}
                busy={!!(mitigating && mitigating[a.id])}
                autoLabel="Mitigating"
                onMitigate={() => onMitigate && onMitigate(a.id)}
                shown={a.id === shownId || (shownName != null && a.name === shownName)} onOpen={() => onAct && onAct(a.id)}
                top={i === 0} />);

          })}
        </div>
      </div>);

  }

  if (profile !== 'enterprise') {
    // ── Priority Action Queue (manufacturing / backend) ──
    return (
      <div className="side-card priority-queue" id="aiCard">
        <div className="card-head">
          PRIORITY ACTION QUEUE
          <span className={`count-pill ${critN ? 'crit' : ''}`} style={{ marginLeft: 'auto' }}>{critN} critical</span>
          <button className={`pq-auto ${autoMit ? 'on' : ''}`} onClick={() => setAutoMit && setAutoMit((v) => !v)} title="Auto-mitigate — same switch as the header; NEPHES fixes problems by itself">◉ Auto {autoMit ? 'ON' : 'OFF'}</button>
        </div>
        <div className="ai-body">
          <div className="ai-assess">
            <div className="a-head">Assessment</div>
            <div className="a-sum">{meta.sum}</div>
            <div className="ai-chips">
              {meta.chips.map(([k, v]) => <span className="ai-chip" key={k}><span className="aic-k">{k}</span><span className="aic-v">{v}</span></span>)}
            </div>
          </div>
          {n === 0 && <div className="ai-empty">✓ No active recommendations — all channels nominal.</div>}
          {alerts.map((a, i) => {
            const st = statusOf(a);
            const conf = st === 'crit' ? 0.86 + a.id.length % 7 * 0.014 : 0.62 + a.id.length % 7 * 0.025;
            const msg = REC_MSGS[a.id] || `${a.label} ${st === 'crit' ? 'exceeded critical limit' : 'drifting toward warning band'} on ${a.name}. Recommend inspection.`;
            return (
              <PriorityItem key={a.id} index={i} a={a} st={st} conf={conf} msg={msg}
                busy={!!(autoMit || (mitigating && mitigating[a.id]))}
                progress={mitigating && mitigating[a.id] && mitProgress ? mitProgress(a) : null}
                autoLabel={autoMit ? 'Auto-mitigating' : mitigating && mitigating[a.id] > 1 && Date.now() - mitigating[a.id] < 6000 ? 'Dispatching' : 'Mitigating'}
                onMitigate={() => onMitigate && onMitigate(a.id)}
                shown={a.id === shownId || (shownName != null && a.name === shownName)} onOpen={() => onAct && onAct(a.id)}
                top={a.id === topId} />);

          })}
        </div>
      </div>);

  }

  return (
    <div className="side-card" id="aiCard">
      <div className="card-head">
        <span className="ai-grid" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /></span>NEPHES AI ANALYSIS
        <span className={`ai-state ${n ? 'active' : 'idle'}`}>{n ? 'analyzing' : 'nominal'}</span>
        <button className="collapse-btn">▾</button>
      </div>
      <div className="ai-body">
        <div className="ai-assess">
          <div className="a-head">Assessment</div>
          <div className="a-sum">{meta.sum}</div>
          <div className="ai-chips">
            {meta.chips.map(([k, v]) => <span className="ai-chip" key={k}><span className="aic-k">{k}</span><span className="aic-v">{v}</span></span>)}
          </div>
        </div>
        <div className="ai-rec-label">Items for sign-off{n > 0 && <span className="ai-rec-count">{n}</span>}</div>
        {n === 0 && <div className="ai-empty">✓ No items need sign-off — production is tracking to plan.</div>}
        {alerts.map((a) => {
          const st = statusOf(a);
          const conf = st === 'crit' ? 0.86 + a.id.length % 7 * 0.014 : 0.62 + a.id.length % 7 * 0.025;
          const msg = REC_MSGS[a.id] || `${a.label} ${st === 'crit' ? 'exceeded critical limit' : 'drifting toward warning band'} on ${a.name}. Recommend inspection.`;
          return <RecCard key={a.id} asset={a.name} sev={st === 'crit' ? 'critical' : 'warning'} conf={conf} msg={msg}
            onAct={() => openInfo('Financial Impact · ' + a.name, msg, [['Asset', a.name], ['Severity', st === 'crit' ? 'Critical' : 'Warning'], ['Confidence', Math.round(conf * 100) + '%'], ['Est. shift impact', st === 'crit' ? '$1,240' : '$310'], ['Owner sign-off', 'Pending']])}
            onMitigate={() => onMitigate && onMitigate(a.id)}
            auto={autoMit} mitigating={!!(mitigating && mitigating[a.id])} progress={mitigating && mitigating[a.id] && mitProgress ? mitProgress(a) : null} />;
        })}
        {(resolved || []).map((r) =>
        <RecCard key={'res-' + r.id} asset={r.name} sev="resolved" conf={1} msg="Mitigation completed — readings back in the normal range." resolved />
        )}
      </div>
    </div>);

}

// ── Priority Action Queue row: numbered, big confidence %, value/limit, action ──
function PriorityItem({ index, a, st, conf, msg, busy, autoLabel, onMitigate, top, progress, hw, tech, onDispatch, shown, onOpen, pinned, onPin }) {
  const watch = st === 'ok';
  const c = watch ? 'var(--text-3)' : SEV_COLOR[st];
  const pct = Math.min(100, Math.round(conf * 100));
  const r = riskOf(a);
  return (
    <div className={`pq-item ${watch ? 'watch' : st}`}>
      <div className="pq-top">
        <span className="pq-num">{String(index + 1).padStart(2, '0')}</span>
        <span className="pq-name">{a.name}</span>
        <span className={`pq-sev ${watch ? 'watch' : st}`}>{watch ? 'watch' : st === 'crit' ? 'critical' : 'warning'}</span>
        {top && <span className="pq-top-tag">TOP</span>}
        <span className="pq-pct" style={{ color: c }}>{pct}%</span>
      </div>
      <div className="pq-bar"><div style={{ width: pct + '%', background: c }} /></div>
      <div className="pq-msg">{msg}</div>
      <div className="pq-foot">
        <span className="pq-vals">{a.val.toFixed(a.dec != null ? a.dec : 1)}{a.unit} / {Number(r.limit).toFixed(a.dec || 0)}{a.unit}</span>
        {onPin && <button className={'ws-pqpin' + (pinned ? ' on' : '')} onClick={onPin} title={pinned ? 'Unpin from the active workspace' : 'Pin to workspace'}>📌</button>}
        {watch ?
        <span className="pq-watch-tag">Monitoring</span> :
        tech ?
        <button className="r-primary auto" disabled>◉ Technician en route…</button> :
        hw ?
        <button className={`r-primary ${st}`} onClick={onDispatch}>Dispatch Technician</button> :
        busy ?
        <button className="r-primary auto" disabled>◉ {autoLabel}{progress != null ? ` · ${Math.round(progress * 100)}%` : ''}…</button> :
        shown ?
        <button className="r-primary ghost" onClick={onOpen}>Act in Sensor Detail ⟶</button> :
        <button className={`r-primary ${st}`} onClick={onMitigate}>{st === 'crit' ? 'Start Mitigation' : 'Dispatch Technician'}</button>}
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
      .slice(0, 9);
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
  // live entries pushed from anywhere in the console via the nephes:log bus
  const [extra, setExtra] = React.useState([]);
  React.useEffect(() => {
    const onLog = (e) => setExtra((x) => [{ asset: e.detail.asset, act: e.detail.act, t0: Date.now(), pct0: 10 + Math.floor(Math.random() * 25) }, ...x].slice(0, 6));
    window.addEventListener('nephes:log', onLog);
    return () => window.removeEventListener('nephes:log', onLog);
  }, []);
  const liveRows = extra.map((x) => {
    const elapsed = Date.now() - x.t0;
    const pct = Math.min(100, x.pct0 + Math.floor(elapsed / 400));
    return { asset: x.asset, act: x.act, t0: x.t0, status: pct >= 100 ? 'resolved' : 'progress', pct };
  });
  const rows = [...liveRows, ...ACTION_SEED];
  const STAT = {
    queued: { label: 'Queued', cls: 'queued' },
    progress: { label: 'In progress', cls: 'progress' },
    resolved: { label: 'Resolved', cls: 'resolved' } };
  const fmtAge = (m) => m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ' + m % 60 + 'm ago';
  return (
    <div className="side-card action-log" id="actionCard">
      <div className="card-head">ACTION LOG <span className="count-pill" style={{ marginLeft: 'auto' }}>{rows.filter((a) => a.status !== 'resolved').length} active</span></div>
      <div className="al-list">
        {rows.map((a, i) => {
          const s = STAT[a.status];
          const age = a.t0 != null ? Math.floor((Date.now() - a.t0) / 60000) : a.age0 + Math.floor(tick / 20);
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

function EventsBar({ events, onPick }) {
  const [filter, setFilter] = React.useState('all');
  const shown = events.filter((e) => filter === 'all' || (filter === 'crit' ? e.sev >= 3 : filter === 'warn' ? e.sev === 2 : e.sev === 1));
  const critCount = events.filter((e) => e.sev >= 3).length;
  return (
    <div className="events-bar side-card">
      <div className="card-head">
        LIVE EVENTS {critCount > 0 && <span className="ev-unread">{critCount} crit</span>}
        <div className="ev-filters-inline">
          <button className={`ev-filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          <button className={`ev-filter-btn f-warn ${filter === 'warn' ? 'active' : ''}`} onClick={() => setFilter('warn')}>Warn</button>
          <button className={`ev-filter-btn f-crit ${filter === 'crit' ? 'active' : ''}`} onClick={() => setFilter('crit')}>Crit</button>
          <button className={`ev-filter-btn f-ok ${filter === 'ok' ? 'active' : ''}`} onClick={() => setFilter('ok')}>Recovered</button>
        </div>
      </div>
      <div className="ev-row">
        {shown.length === 0 && <div className="ai-empty" style={{ width: '100%' }}>{filter === 'all' ? 'No events yet — the wall is quiet. Inject a test fault from Simulation & Tools to see the feed light up.' : 'Nothing matches this filter yet.'}</div>}
        {(() => { const out = []; for (const e of shown) { const last = out[out.length - 1]; if (last && last.asset === e.asset && last.msg === e.msg) last.n++; else out.push({ ...e, n: 1 }); } return out; })().map((e) => {
          const sevCls = e.sev >= 3 ? 'sev-crit' : e.sev === 2 ? 'sev-warn' : 'sev-ok';
          const glyph = e.sev >= 3 ? '●' : e.sev === 2 ? '▲' : '✓';
          return (
            <div key={e.key} className={`ev-chip clk ${sevCls}`} onClick={() => onPick ? onPick(e) : openInfo('Event · ' + e.asset, e.msg, [['Time', e.ts], ['Asset', e.asset], ['Message', e.msg]])} title="Click to inspect this sensor">
              <div className="c-top"><span className={`c-glyph ${sevCls}`}>{glyph}</span><span className="c-ts">{e.ts}</span><span className="c-asset">{e.asset}</span>{e.n > 1 && <span className="c-mult">×{e.n}</span>}</div>
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
  { pfx: 'COOLANT', label: 'Temp', unit: '°C', min: 18, max: 48, warn: 36, crit: 43 },
  { pfx: 'SNS', label: 'Reading', unit: '', min: 0, max: 100, warn: 80, crit: 95 }];

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
        const num = 100 + Math.floor(Math.random() * 8900);
        const name = `${t.pfx}-${num}`;
        const parsed = parseSensorId(name); // self-placing: zone read straight from the device name
        return { id: i, name, group: parsed.zone, conf: parsed.conf, label: t.label, unit: t.unit, min: t.min, max: t.max, warn: t.warn, crit: t.crit, addr: `10.4.${1 + i}.${20 + num % 200}`, mac: `A4:${(num % 100).toString(16).padStart(2, '0').toUpperCase()}:F2:${(num % 256).toString(16).padStart(2, '0').toUpperCase()}` };
      });
      setFound(list);
      const all = {}; list.forEach((d) => all[d.id] = !!d.group); setPicked(all);
      setScan('done');
    }, 1800);
  };
  const toggle = (id) => setPicked((p) => { const d = found.find((x) => x.id === id); if (d && !d.group) return p; return { ...p, [id]: !p[id] }; });
  const fixZone = (id, zone) => { setFound((list) => list.map((d) => d.id === id ? { ...d, group: zone, conf: 74 } : d)); setPicked((p) => ({ ...p, [id]: true })); };
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
                  <div className="scan-prompt">Scan the plant network for unprovisioned sensors broadcasting on the NEPHES bus.</div>
                  <button className="scan-btn" onClick={runScan}>⟳ Scan network</button>
                  <div className="scan-range">Subnet 10.4.0.0/16 · Modbus / OPC-UA / MQTT</div>
                </div>}
              {scan === 'scanning' &&
              <div className="scan-running">
                  <div className="scan-radar"><span /><span /><span /></div>
                  <div className="scan-msg">Scanning 10.4.0.0/16…</div>
                  <div className="scan-sub">Probing endpoints · listening for device beacons</div>
                </div>}
              {scan === 'done' &&
              <div className="scan-results">
                  <div className="scan-found-head"><span>{found.length} devices discovered</span><button className="scan-rescan" onClick={runScan}>⟳ Rescan</button></div>
                  <div className="scan-list">
                    {found.map((d) =>
                  <label className={`scan-item ${picked[d.id] ? 'on' : ''} ${!d.group ? 'review' : ''}`} key={d.id}>
                        <input type="checkbox" checked={!!picked[d.id]} onChange={() => toggle(d.id)} />
                        <span className="si-check" aria-hidden="true">✓</span>
                        <span className="si-main"><span className="si-name">{d.name}</span><span className="si-meta">{d.group || 'unassigned'} · {d.label} · {d.addr}</span></span>
                        {d.group ?
                    <span className="si-assign">→ {ZONE_SHORT[d.group] || d.group} · {d.conf || 88}%</span> :
                    <select className="si-fix" value="" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.preventDefault()} onChange={(e) => fixZone(d.id, e.target.value)}>
                          <option value="" disabled>zone…</option>
                          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>}
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
              <label className="mf-field mf-wide"><span className="mf-l">Sensor name / tag</span><input className="mf-in" value={f.name} onChange={(e) => { const v = e.target.value; const p = parseSensorId(v); setF((prev) => ({ ...prev, name: v, group: p.zone || prev.group })); }} placeholder="e.g. HYD-PT-0447" />
                {f.name.trim() !== '' && (parseSensorId(f.name).zone ?
              <span className="mf-hint ok">⌁ auto-placed → {parseSensorId(f.name).zone} · {parseSensorId(f.name).conf}% match from the name</span> :
              <span className="mf-hint warn">name not recognized — pick a zone manually</span>)}
              </label>
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

// ── 📊 Mitigation analytics — measured outcomes, with vs without NEPHES ──
function Histo({ title, buckets, la, lb, ca, cb }) {
  const max = Math.max(1, ...buckets.map((x) => Math.max(x.a, x.b)));
  const BW = 30, H = 90, CH = 60;
  return (
    <div className="hg-card">
      <div className="rp-sec-t">{title}</div>
      <div className="hg-legend"><span><i style={{ background: ca }} />{la}</span><span><i style={{ background: cb }} />{lb}</span></div>
      <svg className="hg-svg" viewBox={`0 0 ${buckets.length * BW} ${H}`}>
        {buckets.map((bk, i) =>
        <g key={i}>
            <rect x={i * BW + 4} y={CH - bk.a / max * CH + 8} width="9" height={bk.a ? Math.max(bk.a / max * CH, 2) : 0} fill={ca} rx="1.5" />
            <rect x={i * BW + 15} y={CH - bk.b / max * CH + 8} width="9" height={bk.b ? Math.max(bk.b / max * CH, 2) : 0} fill={cb} rx="1.5" opacity=".85" />
            <text x={i * BW + BW / 2} y={H - 8} textAnchor="middle" fontSize="7.5" fill="#7a766f">{bk.label}</text>
          </g>)}
        <line x1="0" y1={CH + 8.5} x2={buckets.length * BW} y2={CH + 8.5} stroke="#34322c" strokeWidth="1" />
      </svg>
    </div>);
}

function AnalyticsPanel({ recs, hist = [], points = [], events = [], onInspect, onClose }) {
  const [tab, setTab] = React.useState('overview');
  const [insp, setInsp] = React.useState(null);
  const [offFilter, setOffFilter] = React.useState('alarm');
  const [offZone, setOffZone] = React.useState('all');
  const [mitFilter, setMitFilter] = React.useState('all');
  const [mitLive, setMitLive] = React.useState(false);
  const [mitAll, setMitAll] = React.useState(false);
  React.useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line
  const done = recs.filter((r) => !r.open && r.durMin != null);
  const neph = done.filter((r) => r.method !== 'none');
  const soft = done.filter((r) => r.method === 'auto' || r.method === 'manual');
  const base = done.filter((r) => r.method === 'none');
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const fmtDur = (m) => m == null ? '—' : m < 1 ? Math.round(m * 60) + 's' : m.toFixed(m < 10 ? 1 : 0) + ' min';
  const medSoft = med(soft.map((r) => r.durMin));
  const medBase = med(base.map((r) => r.durMin));
  const devCut = neph.length ? neph.reduce((s, r) => s + (r.devBefore - r.devAfter), 0) / neph.length : 0;
  const liveN = recs.filter((r) => !r.seed).length;
  const DUR = [[0, 1, '<1m'], [1, 2, '1–2'], [2, 4, '2–4'], [4, 8, '4–8'], [8, 12, '8–12'], [12, 16, '12–16'], [16, 24, '16–24'], [24, 1e9, '24m+']];
  const DEV = [[0, 2, '<2%'], [2, 5, '2–5'], [5, 10, '5–10'], [10, 15, '10–15'], [15, 20, '15–20'], [20, 30, '20–30'], [30, 1e9, '30%+']];
  const bucketize = (defs, va, vb) => defs.map(([lo, hi, label]) => ({ label, a: va.filter((v) => v >= lo && v < hi).length, b: vb.filter((v) => v >= lo && v < hi).length }));
  const durB = bucketize(DUR, neph.map((r) => r.durMin), base.map((r) => r.durMin));
  const devB = bucketize(DEV, neph.map((r) => r.devBefore), neph.map((r) => r.devAfter));
  const fmtTs = (ms) => new Date(ms).toTimeString().slice(0, 5);
  const M_LABEL = { auto: 'AUTO', manual: 'MANUAL', tech: 'TECHNICIAN', none: 'UNASSISTED' };
  // live-state rollups
  const counts = { ok: 0, warn: 0, crit: 0 };
  points.forEach((p) => counts[statusOf(p)]++);
  const health = points.length ? Math.round(counts.ok / points.length * 100) : 100;
  const evC = events.filter((e) => e.sev >= 3).length, evW = events.filter((e) => e.sev === 2).length, evR = events.filter((e) => e.sev === 1).length;
  const peakC = hist.length ? Math.max(...hist.map((h) => h.c)) : 0;
  const zones = (() => {
    const m = new Map();
    points.forEach((p) => {
      if (!m.has(p.group)) m.set(p.group, { name: p.group, n: 0, ok: 0, warn: 0, crit: 0, worst: null, wf: -1 });
      const z = m.get(p.group); const st = statusOf(p); z.n++; z[st]++;
      if (st !== 'ok') { const f = riskOf(p).frac; if (f > z.wf) { z.wf = f; z.worst = p; } }
    });
    return [...m.values()].map((z) => ({ ...z, health: Math.round(z.ok / z.n * 100) })).sort((a, b) => a.health - b.health);
  })();
  const ranked = [...points].map((p) => ({ p, f: riskOf(p).frac, st: statusOf(p) })).sort((a, b) => b.f - a.f);
  const zoneNames = [...new Set(points.map((p) => p.group))];
  let offenders = ranked.filter(({ p, st }) => (offZone === 'all' || p.group === offZone) && (offFilter === 'all' ? true : offFilter === 'alarm' ? st !== 'ok' : st === offFilter));
  const alarmEmpty = offFilter === 'alarm' && offenders.length === 0;
  if (alarmEmpty) offenders = ranked.filter(({ p }) => offZone === 'all' || p.group === offZone);
  offenders = offenders.slice(0, 20);
  const mrecs = recs.filter((r) => (mitFilter === 'all' || r.method === mitFilter) && (!mitLive || !r.seed));
  const Trend = () => {
    const W = 560, H = 96, P = 6;
    const max = Math.max(4, ...hist.map((h) => h.c + h.w));
    const x = (i) => P + i / Math.max(1, hist.length - 1) * (W - P * 2);
    const y = (v) => H - P - v / max * (H - P * 2);
    const line = (k) => hist.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h[k]).toFixed(1)}`).join('');
    const area = line('c') + `L${(W - P).toFixed(1)},${H - P}L${P},${H - P}Z`;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="tr-svg" preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={P} x2={W - P} y1={y(max * g)} y2={y(max * g)} className="tr-grid" />)}
        <path d={area} fill="rgba(194,106,106,.10)" />
        <path d={line('w')} fill="none" stroke="var(--warn)" strokeWidth="1.5" />
        <path d={line('c')} fill="none" stroke="var(--crit)" strokeWidth="1.8" />
      </svg>);
  };
  const TABS = [['overview', 'OVERVIEW'], ['zones', 'ZONES'], ['sensors', 'TOP OFFENDERS'], ['mit', 'MITIGATION']];
  return (
    <React.Fragment>
        <div className="ana-tabs">{TABS.map(([id, l]) => <button key={id} className={`ana-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{l}</button>)}</div>
        <div className="ana-body">
          {tab === 'overview' && <React.Fragment>
            <div className="rp-stats">
              <div className="rp-stat"><span className="rs-v" style={{ color: health >= 85 ? 'var(--ok)' : health >= 65 ? 'var(--warn)' : 'var(--crit)' }}>{health}%</span><span className="rs-l">Plant health now</span></div>
              <div className="rp-stat"><span className="rs-v" style={{ color: counts.crit ? 'var(--crit)' : 'var(--text-1)' }}>{counts.crit}</span><span className="rs-l">Critical now</span></div>
              <div className="rp-stat"><span className="rs-v" style={{ color: counts.warn ? 'var(--warn)' : 'var(--text-1)' }}>{counts.warn}</span><span className="rs-l">Warnings now</span></div>
              <div className="rp-stat"><span className="rs-v">{peakC}</span><span className="rs-l">Peak critical · session</span></div>
              <div className="rp-stat"><span className="rs-v">{evC}</span><span className="rs-l">Critical events</span></div>
              <div className="rp-stat"><span className="rs-v" style={{ color: 'var(--ok)' }}>{evR}</span><span className="rs-l">Recoveries</span></div>
            </div>
            <div className="tr-wrap">
              <div className="tr-t">SENSORS IN TROUBLE — SESSION TREND<span className="tl"><i style={{ background: 'var(--crit)' }} />critical</span><span className="tl"><i style={{ background: 'var(--warn)' }} />warning</span></div>
              <Trend />
            </div>
            <div className="rp-meta">Events this session: {evC} critical · {evW} warnings · {evR} recoveries · every event and mitigation outcome below is timestamped and fed back into NEPHES.</div>
            <div className="ov-grid">
              <div className="ov-col">
                <div className="rp-sec-t ov-t">WORST ZONES<button className="ov-more" onClick={() => setTab('zones')}>all zones →</button></div>
                {zones.slice(0, 4).map((z) =>
                <div className="zn-row ov" key={z.name}>
                    <span className="zn-name">{z.name}</span>
                    <span className="zn-bar"><i className="ok" style={{ width: z.ok / z.n * 100 + '%' }} /><i className="warn" style={{ width: z.warn / z.n * 100 + '%' }} /><i className="crit" style={{ width: z.crit / z.n * 100 + '%' }} /></span>
                    <span className="zn-h" style={{ color: z.health >= 85 ? 'var(--ok)' : z.health >= 65 ? 'var(--warn)' : 'var(--crit)' }}>{z.health}%</span>
                  </div>)}
              </div>
              <div className="ov-col">
                <div className="rp-sec-t ov-t">TOP OFFENDERS<button className="ov-more" onClick={() => setTab('sensors')}>inspect →</button></div>
                {(ranked.some((r) => r.st !== 'ok') ? ranked.filter((r) => r.st !== 'ok') : ranked).slice(0, 4).map(({ p, f, st }, i) =>
                <div className="sn-row ov" key={p.id} onClick={() => { setInsp(p.id); setTab('sensors'); }} title="Open live histogram">
                    <span className="sn-rank">{i + 1}</span>
                    <span className={`sn-st ${st}`} />
                    <span className="sn-name">{p.name}</span>
                    <span className="sn-pct" style={{ color: SEV_COLOR[st] }}>{Math.round(f * 100)}%</span>
                  </div>)}
              </div>
            </div>
            <div className="rp-sec">
              <div className="rp-sec-t ov-t">LATEST OUTCOMES<button className="ov-more" onClick={() => setTab('mit')}>full record →</button></div>
              {recs.slice(0, 3).map((r, i) =>
              <div className="rp-row" key={i}>
                  <span className="rp-when">{fmtTs(r.tsMs)}</span>
                  <span className={`m-chip ${r.method}`}>{M_LABEL[r.method]}</span>
                  <span className="rp-name">{r.name}</span>
                  <span className="rp-val">{r.open ? <span className="ana-live">in progress</span> : fmtDur(r.durMin)}</span>
                </div>)}
            </div>
          </React.Fragment>}
          {tab === 'zones' && <React.Fragment>
            <div className="rp-meta">Every zone ranked worst-first — the bar shows the live mix of OK / warning / critical sensors. Click a culprit to inspect it on the wall.</div>
            {zones.map((z) =>
            <div className="zn-row" key={z.name}>
                <span className="zn-name">{z.name}</span>
                <span className="zn-bar"><i className="ok" style={{ width: z.ok / z.n * 100 + '%' }} /><i className="warn" style={{ width: z.warn / z.n * 100 + '%' }} /><i className="crit" style={{ width: z.crit / z.n * 100 + '%' }} /></span>
                <span className="zn-h" style={{ color: z.health >= 85 ? 'var(--ok)' : z.health >= 65 ? 'var(--warn)' : 'var(--crit)' }}>{z.health}%</span>
                <span className="zn-cnt">{z.crit} crit · {z.warn} warn · {fmt(z.n)} pts</span>
                {z.worst ? <button className="zn-worst" onClick={() => { setInsp(z.worst.id); setTab('sensors'); }} title="Inspect readings & histogram">⌖ {z.worst.name}</button> : <span className="zn-worst none">all normal</span>}
              </div>)}
          </React.Fragment>}
          {tab === 'sensors' && (() => {
            const inspP = points.find((p) => p.id === insp) || (offenders[0] && offenders[0].p) || null;
            return <React.Fragment>
            <div className="rp-meta">{alarmEmpty ? 'Nothing is in alarm right now — showing every sensor ranked by closeness to its limit.' : 'Sensors ranked by closeness to (or past) their safe limit — click a row for its live reading histogram.'}</div>
            <div className="flt-row">
              {[['alarm', 'IN ALARM'], ['crit', 'CRITICAL'], ['warn', 'WARNING'], ['all', 'ALL SENSORS']].map(([id, l]) => <button key={id} className={`flt-chip ${offFilter === id ? 'active' : ''}`} onClick={() => setOffFilter(id)}>{l}</button>)}
              <select className="flt-sel" value={offZone} onChange={(e) => setOffZone(e.target.value)} title="Filter by zone">
                <option value="all">All zones</option>
                {zoneNames.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
              <span className="flt-n">{offenders.length} shown</span>
            </div>
            {inspP && (() => {
              const st = statusOf(inspP);
              const r = riskOf(inspP);
              const s = inspP.series || [];
              const lims = [inspP.warnHi, inspP.critHi, inspP.warnLo, inspP.critLo].filter((x) => x != null);
              const lo = Math.min(...s, ...lims), hi = Math.max(...s, ...lims);
              const span = hi - lo || 1;
              const NB = 24;
              const bins = Array.from({ length: NB }, () => 0);
              s.forEach((v) => { const bi = Math.min(NB - 1, Math.max(0, Math.floor((v - lo) / span * NB))); bins[bi]++; });
              const maxB = Math.max(...bins, 1);
              const mid = (bi) => lo + (bi + 0.5) / NB * span;
              const clsOf = (v) => statusOf({ ...inspP, val: v });
              const mark = (v, cls) => v != null && v >= lo && v <= hi ? { x: (v - lo) / span * 100, cls, v } : null;
              const marks = [mark(inspP.warnHi, 'warn'), mark(inspP.critHi, 'crit'), mark(inspP.warnLo, 'warn'), mark(inspP.critLo, 'crit')].filter(Boolean);
              const dec = inspP.dec != null ? inspP.dec : 1;
              return (
                <div className={`insp ${st}`}>
                  <div className="insp-head">
                    <span className={`sn-st ${st}`} />
                    <span className="insp-name">{inspP.name}</span>
                    <span className="sn-zone">{inspP.group}</span>
                    <span className={`insp-chip ${st}`}>{st === 'ok' ? 'NORMAL' : st === 'warn' ? 'WARNING' : 'CRITICAL'}</span>
                    <span className="insp-val">{inspP.val.toFixed(dec)}<small>{inspP.unit}</small></span>
                    <button className="zn-worst" onClick={() => onInspect && onInspect(inspP.id)} title="Jump to this sensor on the Sensor Wall">⌖ Open on wall</button>
                  </div>
                  <div className="insp-grid">
                    <div className="insp-cell">
                      <div className="tr-t">READING DISTRIBUTION — LAST {s.length} SAMPLES</div>
                      <div className="histo-viz">
                        {bins.map((b, bi) => <i key={bi} className={clsOf(mid(bi))} style={{ height: Math.max(4, b / maxB * 100) + '%' }} title={`${mid(bi).toFixed(dec)} ${inspP.unit} · ${b} samples`} />)}
                        {marks.map((m, mi) => <span key={mi} className={`hv-mark ${m.cls}`} style={{ left: m.x + '%' }} title={`${m.cls === 'crit' ? 'Critical' : 'Warning'} limit · ${m.v}`} />)}
                        <span className="hv-now" style={{ left: Math.min(100, Math.max(0, (inspP.val - lo) / span * 100)) + '%' }} title="Reading now" />
                      </div>
                      <div className="hv-axis"><span>{lo.toFixed(dec)}</span><span>{inspP.unit} · | now · dashed = limits</span><span>{hi.toFixed(dec)}</span></div>
                      {(() => {
                        const mean = s.length ? s.reduce((a2, b2) => a2 + b2, 0) / s.length : 0;
                        const sLo = s.length ? Math.min(...s) : 0, sHi = s.length ? Math.max(...s) : 0;
                        const inAlarm = s.length ? Math.round(s.filter((v) => clsOf(v) !== 'ok').length / s.length * 100) : 0;
                        return (
                          <div className="hv-stats">
                            <span><b>{mean.toFixed(dec)}</b>average</span>
                            <span><b>{sLo.toFixed(dec)}</b>lowest</span>
                            <span><b>{sHi.toFixed(dec)}</b>highest</span>
                            <span><b style={{ color: inAlarm > 25 ? 'var(--crit)' : inAlarm > 0 ? 'var(--warn)' : 'var(--ok)' }}>{inAlarm}%</b>of samples in alarm</span>
                          </div>);
                      })()}
                    </div>
                    <div className="insp-cell">
                      <div className="tr-t">LIVE TREND · % TO LIMIT</div>
                      <Spark series={s} w={230} h={58} color={SEV_COLOR[st]} strokeW={1.6} dot={false} />
                      <div className="insp-limrow"><span className="sn-lim big"><i className={st} style={{ width: Math.min(100, r.frac * 100) + '%' }} /></span><span className="sn-pct" style={{ color: SEV_COLOR[st] }}>{Math.round(r.frac * 100)}%</span></div>
                    </div>
                  </div>
                </div>);
            })()}
            {offenders.map(({ p, f }, i) => {
              const st = statusOf(p);
              return (
                <div className={`sn-row ${inspP && inspP.id === p.id ? 'active' : ''}`} key={p.id} onClick={() => setInsp(p.id)} title="Click for live histogram">
                  <span className="sn-rank">{i + 1}</span>
                  <span className={`sn-st ${st}`} />
                  <span className="sn-name">{p.name}</span>
                  <span className="sn-zone">{p.group}</span>
                  <span className="sn-val">{p.val.toFixed(p.dec != null ? p.dec : 1)}<small>{p.unit}</small></span>
                  <span className="sn-lim"><i className={st} style={{ width: Math.min(100, f * 100) + '%' }} /></span>
                  <span className="sn-pct" style={{ color: SEV_COLOR[st] }}>{Math.round(f * 100)}%</span>
                  <Spark series={p.series} w={70} h={18} color={SEV_COLOR[st]} strokeW={1.4} dot={false} />
                </div>);
            })}
          </React.Fragment>;
          })()}
          {tab === 'mit' && <React.Fragment>
          <div className="rp-meta">{done.length} recovery outcomes on record · {liveN} logged live this session · every outcome is timestamped and fed back into NEPHES</div>
          <div className="flt-row">
            {[['all', 'ALL'], ['auto', 'AUTO'], ['manual', 'MANUAL'], ['tech', 'TECHNICIAN'], ['none', 'UNASSISTED']].map(([id, l]) => <button key={id} className={`flt-chip ${mitFilter === id ? 'active' : ''}`} onClick={() => { setMitFilter(id); setMitAll(false); }}>{l}</button>)}
            <button className={`flt-chip ${mitLive ? 'active' : ''}`} onClick={() => { setMitLive((v) => !v); setMitAll(false); }} title="Hide seeded history — only what happened this session">THIS SESSION ONLY</button>
            <span className="flt-n">{mrecs.length} records</span>
          </div>
          <div className="rp-stats">
            <div className="rp-stat"><span className="rs-v">{done.length}</span><span className="rs-l">Outcomes logged</span></div>
            <div className="rp-stat"><span className="rs-v" style={{ color: 'var(--accent)' }}>{fmtDur(medSoft)}</span><span className="rs-l">Median fix · NEPHES</span></div>
            <div className="rp-stat"><span className="rs-v">{fmtDur(medBase)}</span><span className="rs-l">Median · unassisted</span></div>
            <div className="rp-stat"><span className="rs-v" style={{ color: 'var(--ok)' }}>−{devCut.toFixed(0)} pts</span><span className="rs-l">Avg deviation cut</span></div>
            <div className="rp-stat"><span className="rs-v">{medBase && medSoft ? Math.round(medBase / medSoft) + '×' : '—'}</span><span className="rs-l">Faster with NEPHES</span></div>
          </div>
          <div className="ana-grid">
            <Histo title="TIME TO RECOVER — HISTOGRAM" buckets={durB} la="NEPHES-mitigated" lb="Unassisted baseline" ca="var(--accent)" cb="#6a675f" />
            <Histo title="DEVIATION FROM SAFE RANGE — MITIGATED" buckets={devB} la="At dispatch" lb="After recovery" ca="var(--crit)" cb="var(--ok)" />
          </div>
          <div className="rp-sec">
            <div className="rp-sec-t">RECENT OUTCOMES — TIMESTAMPED</div>
            {mrecs.length === 0 && <div className="rp-meta">No outcomes match this filter yet.</div>}
            {mrecs.slice(0, mitAll ? 80 : 10).map((r, i) =>
            <div className="rp-row" key={i}>
                <span className="rp-when">{fmtTs(r.tsMs)}</span>
                <span className={`m-chip ${r.method}`}>{M_LABEL[r.method]}</span>
                <span className="rp-name">{r.name}</span>
                <span className="rp-msg">{r.devBefore.toFixed(0)}% → {r.open ? '…' : r.devAfter.toFixed(1) + '%'} off target</span>
                {!r.open && <span className="rp-delta">−{Math.max(0, r.devBefore - r.devAfter).toFixed(0)} pts</span>}
                <span className="rp-val">{r.open ? <span className="ana-live">in progress</span> : fmtDur(r.durMin)}</span>
              </div>)}
            {mrecs.length > 10 && <button className="show-more" onClick={() => setMitAll((v) => !v)}>{mitAll ? 'Show fewer ↑' : `Show all ${mrecs.length} ↓`}</button>}
          </div>
          <div className="rp-note">NEPHES weights future mitigation choices toward what measurably recovered fastest — unassisted recoveries form the baseline it has to beat. History shown includes seeded records plus everything logged live this session.</div>
          </React.Fragment>}
        </div>
    </React.Fragment>);
}
function AnalyticsModal(props) {
  return (
    <div className="modal-scrim" onMouseDown={props.onClose}>
      <div className="info-modal ana-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">NEPHES ANALYTICS<button className="modal-close" onClick={props.onClose}>✕</button></div>
        <AnalyticsPanel {...props} />
      </div>
    </div>);
}

// ── Shift handoff report — one click compiles the shift for the next operator ──
function ShiftReport({ data, onClose }) {
  const d = data;
  const fmtT = (dt) => dt.toTimeString().slice(0, 5);
  const money = (n) => '$' + Math.floor(n).toLocaleString('en-US');
  const dateStr = d.now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line
  const doPrint = () => { document.body.classList.add('print-report'); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('print-report'), 300); }, 60); };
  const copy = () => {
    const lines = [
    'NEPHES SHIFT HANDOFF — ' + dateStr,
    `Shift ${fmtT(d.start)}–${fmtT(d.now)} · Plant health ${Math.round(d.health)}%`,
    `Sensors: ${d.counts.ok} OK · ${d.counts.warn} warn · ${d.counts.crit} critical`,
    `Events: ${d.events.crit} critical · ${d.events.warn} warnings · ${d.events.ok} recoveries`,
    `Mitigations: ${d.nDis} dispatched · ${d.nRes} resolved · auto-mitigate ${d.autoMit ? 'ON' : 'OFF'}`,
    `Saved by NEPHES this shift: ${money(d.saved)}`,
    d.risks.length ? 'Hand off: ' + d.risks.map((r) => `${r.name} (${r.val})`).join(', ') : 'No open risks at handoff.',
    d.workspaces && d.workspaces.length ? 'Workspaces: ' + d.workspaces.map((w) => w.name + ' — ' + w.n + ' sensors, ' + w.c + ' crit' + (w.lastNote ? ' (“' + w.lastNote + '”)' : '')).join(' · ') : 'No open workspace investigations.'];
    if (navigator.clipboard) navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Handoff summary copied'));
  };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="info-modal report-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">SHIFT HANDOFF REPORT<button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="rp-body">
          <div className="rp-meta">{dateStr} · shift {fmtT(d.start)} – {fmtT(d.now)} · generated {d.now.toTimeString().slice(0, 8)}</div>
          <div className="rp-stats">
            <div className="rp-stat"><span className="rs-v" style={{ color: d.health >= 85 ? 'var(--ok)' : d.health >= 65 ? 'var(--accent)' : 'var(--crit)' }}>{Math.round(d.health)}%</span><span className="rs-l">Plant health</span></div>
            <div className="rp-stat"><span className="rs-v">{d.counts.warn}<i className="rs-sep">·</i><b style={{ color: d.counts.crit > 0 ? 'var(--crit)' : 'inherit' }}>{d.counts.crit}</b></span><span className="rs-l">Warn · crit now</span></div>
            <div className="rp-stat"><span className="rs-v">{d.events.crit + d.events.warn}</span><span className="rs-l">Alarm events</span></div>
            <div className="rp-stat"><span className="rs-v">{d.nRes}<i className="rs-sep">/</i>{d.nDis}</span><span className="rs-l">Resolved / sent</span></div>
            <div className="rp-stat"><span className="rs-v" style={{ color: 'var(--accent)' }}>{money(d.saved)}</span><span className="rs-l">Saved by NEPHES</span></div>
          </div>
          <div className="rp-cols">
            <div className="rp-sec">
              <div className="rp-sec-t">HAND THESE OFF — STILL OPEN</div>
              {d.risks.length === 0 && <div className="rp-empty">✓ Nothing open — clean handoff.</div>}
              {d.risks.map((r, i) =>
              <div className="rp-row" key={i}><span className={`rp-dot ${r.st}`} /><span className="rp-name">{r.name}</span><span className={`rp-val ${r.st}`}>{r.val}</span></div>)}
            </div>
            <div className="rp-sec">
              <div className="rp-sec-t">MITIGATIONS THIS SHIFT</div>
              {d.dispatched.length === 0 && <div className="rp-empty">None dispatched yet.</div>}
              {d.dispatched.map((m, i) =>
              <div className="rp-row" key={i}><span className={`rp-dot ${d.resolvedIds[m.id] ? 'ok' : 'warn'}`} /><span className="rp-name">{m.name}</span><span className="rp-when">{d.resolvedIds[m.id] ? '✓ resolved' : 'in progress'} · {m.ts}</span></div>)}
            </div>
          </div>
          {d.workspaces && d.workspaces.length > 0 &&
          <div className="rp-sec">
            <div className="rp-sec-t">WORKSPACES — OPEN INVESTIGATIONS</div>
            {d.workspaces.map((w, i) =>
            <div className="rp-row" key={i}><span className={'rp-dot ' + (w.c ? 'crit' : w.w ? 'warn' : 'ok')} /><span className="rp-name">{w.name}</span><span className="rp-msg">{w.n ? w.n + ' sensors · ' + w.c + ' crit · ' + w.w + ' warn' : 'filter view'}{w.rule ? ' · auto-join: ' + w.rule : ''}{w.watch ? ' · watching' : ''}{w.lastNote ? ' — “' + w.lastNote + '”' : ''}</span></div>)}
          </div>}
          <div className="rp-sec">
            <div className="rp-sec-t">LAST EVENTS</div>
            <div className="rp-evs">
              {d.events.list.length === 0 && <div className="rp-empty">Quiet shift — no alarm events logged.</div>}
              {d.events.list.map((e) =>
              <div className="rp-row" key={e.key}><span className={`rp-dot ${e.sev >= 3 ? 'crit' : e.sev === 2 ? 'warn' : 'ok'}`} /><span className="rp-when">{e.ts}</span><span className="rp-name">{e.asset}</span><span className="rp-msg">{e.msg}</span></div>)}
            </div>
          </div>
          <div className="rp-note">Auto-mitigate was <b>{d.autoMit ? 'ON' : 'OFF'}</b> at handoff. Numbers reflect the console at generation time.</div>
          <div className="rp-actions">
            <button className="rp-btn" onClick={copy}>⧉ Copy summary</button>
            <button className="rp-btn" onClick={doPrint}>⎙ Print</button>
            <button className="rp-btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function Industrial({ stream, density, defaultView = 'grid', startProfile = 'manufacturing', showEvents = true, gridTexture = true, glow = true, volatility = 1, onToggleLive }) {
  const [profile, setProfile] = React.useState(NFO_SESSION.profile || startProfile);
  const [sel, setSel] = React.useState(NFO_SESSION.sel || null);
  const [view, setView] = React.useState(NFO_SESSION.view || defaultView);
  const [wallFocus, setWallFocus] = React.useState(false);
  const [riskHist, setRiskHist] = React.useState(() => Array.from({ length: 44 }, () => ({ c: 0, w: 0 })));
  const [blueLight, setBlueLight] = React.useState(NFO_SESSION.blueLight != null ? !!NFO_SESSION.blueLight : true);
  const [autoMit, setAutoMit] = React.useState(!!NFO_SESSION.autoMit);
  const [faults, setFaults] = React.useState({}); // { groupName: 'warn'|'crit' }
  const [faultTypes, setFaultTypes] = React.useState({}); // { groupName: 'Overheat' ... }
  const [faultHw, setFaultHw] = React.useState({}); // { groupName: true } — hardware faults NEPHES can only detect, not fix remotely
  const [techs, setTechs] = React.useState({}); // { groupName: { asset } } — technician dispatched, repair pending
  const [mitigating, setMitigating] = React.useState({}); // { sensorId: true }
  const [mitFrom, setMitFrom] = React.useState({}); // { id: { val, target } } — where mitigation started, for progress %
  const [mitDone, setMitDone] = React.useState({}); // { id: { name, until } } — brief “✓ Resolved” flash
  const [mitStart, setMitStart] = React.useState({}); // { id: tick mitigation began } — lets non-sensor (e.g. infra) targets resolve on a timer like real devices heal
  const [customSensors, setCustomSensors] = React.useState([]);
  const [showAdd, setShowAdd] = React.useState(false);
  const [showDatasheets, setShowDatasheets] = React.useState(false);
  const [plantConfig, setPlantConfig] = React.useState(DEFAULT_PLANT);
  const [showConfig, setShowConfig] = React.useState(false);
  const [cfgToast, setCfgToast] = React.useState('');
  const [rTab, setRTab] = React.useState(NFO_SESSION.rTab || 'ops');
  const [infoData, setInfoData] = React.useState(null);
  // ─── 🗂 Workspaces — tabbed working sets: pinned sensors + per-workspace filters ───
  const [wsState, setWsState] = React.useState(loadWorkspaces);
  const wsAll = wsState.list; const wsActive = wsState.active;
  const wsCur = wsAll.find((w) => w.id === wsActive) || null;
  React.useEffect(() => { saveWorkspaces(wsState); }, [wsState]);
  const wsAllRef = React.useRef(wsAll);
  React.useEffect(() => { wsAllRef.current = wsAll; }, [wsAll]);
  const lastFiltersRef = React.useRef({ grp: 'all', sev: 'all', q: '' });
  const setWsActive = React.useCallback((id) => setWsState((s) => ({ ...s, active: id, list: id ? s.list.map((w) => w.id === id && w.newIds && w.newIds.length ? { ...w, newIds: [] } : w) : s.list })), []);
  const wsUpdate = React.useCallback((id, patch) => setWsState((s) => ({ ...s, list: s.list.map((w) => w.id === id ? { ...w, ...(typeof patch === 'function' ? patch(w) : patch) } : w) })), []);
  const wsCreate = React.useCallback((o) => {
    const w = { id: 'ws' + Date.now().toString(36) + Math.floor(Math.random() * 90 + 10), name: 'Workspace', pins: [], filters: { grp: 'all', sev: 'all', q: '' }, ...o };
    if (w.srcLabel && !w.rule) w.rule = { label: w.srcLabel };
    if (!w.notes) w.notes = [{ ts: clk(), txt: w.pins.length ? 'Created with ' + w.pins.length + ' sensors' + (w.srcLabel ? ' — NEPHES cluster: failing ' + w.srcLabel : '') : 'Created — pin sensors or set filters', kind: 'sys' }];
    setWsState((s) => ({ list: [...s.list, w], active: w.id }));
    toast('Workspace “' + w.name + '” created' + (w.pins.length ? ' — ' + w.pins.length + ' sensors grouped' : ''));
  }, []);
  const wsDelete = React.useCallback((id) => setWsState((s) => { const w = s.list.find((x) => x.id === id); if (w) toast('Workspace “' + w.name + '” deleted'); return { list: s.list.filter((x) => x.id !== id), active: s.active === id ? null : s.active }; }), []);
  const wsDuplicate = React.useCallback((id) => setWsState((s) => { const w = s.list.find((x) => x.id === id); if (!w) return s; const c = { ...w, id: 'ws' + Date.now().toString(36), name: w.name + ' copy', def: false, pins: [...(w.pins || [])], filters: { ...(w.filters || {}) } }; toast('Duplicated as “' + c.name + '”'); return { list: [...s.list, c], active: c.id }; }), []);
  const wsSetDefault = React.useCallback((id) => setWsState((s) => { const w = s.list.find((x) => x.id === id); if (w) toast(!w.def ? '“' + w.name + '” now opens by default on this console' : 'Default cleared'); return { ...s, list: s.list.map((x) => ({ ...x, def: x.id === id ? !x.def : false })) }; }), []);
  const wsExport = React.useCallback((id) => {
    const w = wsAllRef.current.find((x) => x.id === id); if (!w) return;
    const json = JSON.stringify({ name: w.name, pins: w.pins, filters: w.filters }, null, 2);
    const done = () => toast('Workspace config copied — import it on any console');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, () => window.prompt('Workspace config — copy this:', json));
    else window.prompt('Workspace config — copy this:', json);
  }, []);
  const wsPin = React.useCallback((id) => {
    setWsState((s) => {
      const cur = s.list.find((w) => w.id === s.active);
      if (!cur) { const w = { id: 'ws' + Date.now().toString(36), name: 'Investigation', pins: [id], filters: { grp: 'all', sev: 'all', q: '' } }; toast('Pinned — new “Investigation” workspace started'); return { list: [...s.list, w], active: w.id }; }
      const has = (cur.pins || []).includes(id);
      toast(has ? 'Unpinned from “' + cur.name + '”' : 'Pinned to “' + cur.name + '”');
      return { ...s, list: s.list.map((w) => w.id === cur.id ? { ...w, pins: has ? w.pins.filter((x) => x !== id) : [...(w.pins || []), id] } : w) };
    });
  }, []);
  React.useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const d = e.code && e.code.indexOf('Digit') === 0 ? +e.code.slice(5) : NaN;
      if (isNaN(d)) return;
      e.preventDefault();
      if (d === 0) { setWsActive(null); return; }
      const w = wsAllRef.current.filter((x) => !x.archived)[d - 1];
      if (w) setWsActive(w.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line
  const wsArchive = React.useCallback((id, outcome) => setWsState((s) => { const w = s.list.find((x) => x.id === id); if (!w) return s; toast('“' + w.name + '” resolved & archived'); return { active: s.active === id ? null : s.active, list: s.list.map((x) => x.id === id ? { ...x, archived: { ts: new Date().toISOString().slice(0, 16).replace('T', ' '), outcome: outcome || '' }, notes: [...(x.notes || []), { ts: clk(), txt: 'Resolved & archived' + (outcome ? ' — ' + outcome : ''), kind: 'sys' }] } : x) }; }), []);
  const wsRestore = React.useCallback((id) => setWsState((s) => ({ active: id, list: s.list.map((x) => x.id === id ? { ...x, archived: null, notes: [...(x.notes || []), { ts: clk(), txt: 'Restored from archive', kind: 'sys' }] } : x) })), []);
  const wsToggleWatch = React.useCallback((id) => setWsState((s) => { const w = s.list.find((x) => x.id === id); if (w) toast(!w.watch ? 'Watching “' + w.name + '” — bell & sound alerts now fire only for its sensors' : 'Watch off — alerts cover the whole plant'); return { ...s, list: s.list.map((x) => x.id === id ? { ...x, watch: !x.watch } : x) }; }), []);
  const wsToggleRule = React.useCallback((id) => setWsState((s) => { const w = s.list.find((x) => x.id === id); if (!w) return s; const on = !(w.rule && w.rule.label); const label = w.srcLabel || null; if (on && !label) { toast('Auto-join needs a measure — create the workspace from a NEPHES cluster to enable it', 'warn'); return s; } toast(on ? 'Auto-join on — failing ' + label + ' sensors will join automatically' : 'Auto-join off'); return { ...s, list: s.list.map((x) => x.id === id ? { ...x, rule: on ? { label } : null } : x) }; }), []);
  const [showReport, setShowReport] = React.useState(false);
  const [showAnalytics, setShowAnalytics] = React.useState(false);
  // 🎛 per-profile window customization
  const [showCz, setShowCz] = React.useState(false);
  const [cz, setCz] = React.useState(NFO_SESSION.cz || CZ_DEFAULT);
  React.useEffect(() => {
    const f = () => setShowCz(true);
    window.addEventListener('nephes:customize', f);
    return () => window.removeEventListener('nephes:customize', f);
  }, []);
  const cust = React.useCallback((pf, id) => ({ show: true, tint: 'gold', size: 'm', ...((cz[pf] || {}).panels || {})[id] }), [cz]);
  const czPatch = (id, patch) => setCz((c) => { const n = { ...c, [profile]: { ...(c[profile] || {}), panels: { ...((c[profile] || {}).panels || {}), [id]: { ...((c[profile] || {}).panels || {})[id], ...patch } } } }; saveSession({ cz: n }); return n; });
  const czRightW = (w) => setCz((c) => { const n = { ...c, [profile]: { ...(c[profile] || {}), rightW: w } }; saveSession({ cz: n }); return n; });
  const czReset = () => setCz((c) => { const n = { ...c }; if (CZ_DEFAULT[profile]) n[profile] = JSON.parse(JSON.stringify(CZ_DEFAULT[profile]));else delete n[profile]; saveSession({ cz: n }); return n; });
  React.useEffect(() => { document.body.classList.toggle('no-flash', cust('manufacturing', 'wall').flash === false); }, [cz]); // eslint-disable-line
  // 🎨 appearance — applied as CSS variables so every color/font/size responds live
  const [appear, setAppear] = React.useState({ ...APPEAR_DEFAULT, ...(NFO_SESSION.appear || {}) });
  React.useEffect(() => {
    const r = document.documentElement.style;
    const f = FONT_STACKS[appear.font] || FONT_STACKS.industrial;
    r.setProperty('--font-ui', f.stack);
    r.setProperty('--ui-zoom', String(appear.scale));
    const acc = /^#[0-9a-fA-F]{6}$/.test(appear.accent || '') ? appear.accent : APPEAR_DEFAULT.accent;
    r.setProperty('--accent', acc);
    const [ar, ag, ab] = hexRgb(acc);
    r.setProperty('--accent-rgb', ar + ',' + ag + ',' + ab);
    r.setProperty('--accent-bright', lighten(acc, .35));
    const bt = BG_TONES[appear.bg] || BG_TONES.deep;
    r.setProperty('--bg-root', bt.v[0]); r.setProperty('--bg-body', bt.v[1]); r.setProperty('--card-bg', bt.v[2]); r.setProperty('--card-bg2', bt.v[3]);
    const sp = STATUS_PALETTES[appear.status] || STATUS_PALETTES.default;
    r.setProperty('--ok', sp.ok); r.setProperty('--warn', sp.warn); r.setProperty('--crit', sp.crit);
    r.setProperty('--r-md', appear.radius + 'px'); r.setProperty('--r-sm', Math.max(2, Math.round(appear.radius * .62)) + 'px');
    saveSession({ appear });
  }, [appear]);
  React.useEffect(() => {
    const h = (e) => setInfoData(e.detail);
    window.addEventListener('nephes:info', h);
    return () => window.removeEventListener('nephes:info', h);
  }, []);
  const faultsRef = React.useRef(faults);
  const mitRef = React.useRef(mitigating);
  React.useEffect(() => { faultsRef.current = faults; }, [faults]);
  React.useEffect(() => { mitRef.current = mitigating; }, [mitigating]);
  const [clock, setClock] = React.useState(clk());
  // hands-on alarm limits: patch a sensor's thresholds in whichever pool holds it
  const patchAssetsRef = React.useRef(null);
  const patchGridRef = React.useRef(null);
  const patchSensor = React.useCallback((id, patch) => {
    if (window.NEPHES_SOURCE) NEPHES_SOURCE.command('sensor.patch', { sensorId: id, patch });
    if (patchAssetsRef.current) patchAssetsRef.current(id, patch);
    if (patchGridRef.current) patchGridRef.current(id, patch);
    setCustomSensors((prev) => prev.some((c) => c.id === id) ? prev.map((c) => c.id === id ? { ...c, ...patch } : c) : prev);
  }, []);
  const assets = useAssets(FLAT_SEED, { live: stream.live, speed: stream.speed || 1, volatility, autoMit, faultsRef, mitRef, patchRef: patchAssetsRef });
  const gridPoints = useGridPoints({ live: stream.live, speed: stream.speed || 1, volatility, autoMit, faultsRef, mitRef, patchRef: patchGridRef });
  // workspace scoping — the pools every panel reads while a workspace with pins is active
  const wsSet = React.useMemo(() => profile === 'manufacturing' && wsCur && wsCur.pins && wsCur.pins.length ? new Set(wsCur.pins) : null, [wsCur, profile]);
  const wsGrid = React.useMemo(() => wsSet ? gridPoints.filter((p) => wsSet.has(p.id)) : gridPoints, [wsSet, gridPoints]);
  // 🗒 investigation notes — timestamped log per workspace (user + system entries)
  const wsNote = React.useCallback((id, txt, kind) => setWsState((s) => ({ ...s, list: s.list.map((w) => w.id === id ? { ...w, notes: [...(w.notes || []), { ts: clk(), txt, kind: kind || 'sys' }] } : w) })), []);
  // 🔔 watch mode — when the active workspace is watched, bell + chirp fire only for its sensors
  const watchSetRef = React.useRef(null);
  React.useEffect(() => { watchSetRef.current = wsCur && wsCur.watch && wsCur.pins && wsCur.pins.length ? new Set(wsCur.pins) : null; }, [wsCur]);
  // 📈 workspace risk trend — crit/warn history scoped to the active workspace
  const [wsHist, setWsHist] = React.useState(() => Array.from({ length: 44 }, () => ({ c: 0, w: 0 })));
  React.useEffect(() => { setWsHist(Array.from({ length: 44 }, () => ({ c: 0, w: 0 }))); }, [wsActive]);
  React.useEffect(() => {
    if (!wsSet) return;
    let c = 0, w = 0;
    wsGrid.forEach((p) => { const s = statusOf(p); if (s === 'crit') c++; else if (s === 'warn') w++; });
    setWsHist((h) => [...h.slice(1), { c, w }]);
  }, [stream.tick]); // eslint-disable-line
  // ⚡ auto-join — new failing sensors matching a workspace's measure rule join it automatically
  const wsJoinCoolRef = React.useRef(0);
  React.useEffect(() => {
    const now = Date.now();
    if (now - wsJoinCoolRef.current < 5000) return;
    if (!wsAllRef.current.some((w) => !w.archived && w.rule && w.rule.label)) return;
    wsJoinCoolRef.current = now;
    const failing = {};
    gridPoints.forEach((p) => { if (statusOf(p) !== 'ok') (failing[p.label] = failing[p.label] || []).push(p.id); });
    setWsState((s) => {
      let changed = false;
      const list = s.list.map((w) => {
        if (w.archived || !w.rule || !w.rule.label) return w;
        const have = new Set(w.pins || []);
        const add = (failing[w.rule.label] || []).filter((id) => !have.has(id));
        if (!add.length) return w;
        changed = true;
        return { ...w, pins: [...(w.pins || []), ...add], newIds: [...(w.newIds || []), ...add], notes: [...(w.notes || []), { ts: clk(), txt: add.length + ' sensor(s) auto-joined — rule: failing ' + w.rule.label, kind: 'sys' }] };
      });
      return changed ? { ...s, list } : s;
    });
  }, [stream.tick]); // eslint-disable-line

  const tickRef = React.useRef(stream.tick);
  React.useEffect(() => { tickRef.current = stream.tick; }, [stream.tick]);
  const liveRef = React.useRef({ assets: [], gridPoints: [], customSensors: [] });
  liveRef.current = { assets, gridPoints, customSensors };
  // 📋 shift log — mitigations dispatched/resolved this session, feeds the handoff report
  const shiftLogRef = React.useRef({ dispatched: [], resolved: [] });
  // 📊 outcome records — every mitigation logged with timestamps + deviation before/after
  const mitRecRef = React.useRef(null);
  if (mitRecRef.current === null) mitRecRef.current = seedOutcomes();
  const recOpen = React.useCallback((dev, method) => {
    const t = safeTarget(dev);
    mitRecRef.current = [{ tsMs: Date.now(), name: dev.name, id: dev.id, method, devBefore: Math.abs(dev.val - t) / Math.max(Math.abs(t), 1e-6) * 100, devAfter: null, durMin: null, open: true }, ...mitRecRef.current].slice(0, 200);
  }, []);
  const recClose = React.useCallback((dev, opts) => {
    const rec = mitRecRef.current.find((x) => x.open && x.id === dev.id);
    if (!rec) return;
    rec.open = false;
    const t = safeTarget(dev);
    rec.devAfter = opts && opts.devAfter != null ? opts.devAfter : Math.abs(dev.val - t) / Math.max(Math.abs(t), 1e-6) * 100;
    rec.durMin = opts && opts.durMin != null ? opts.durMin : (Date.now() - rec.tsMs) / 60000;
  }, []);
  const startMitigation = React.useCallback((id) => {
    if (window.NEPHES_SOURCE) NEPHES_SOURCE.command('mitigation.start', { sensorId: id });
    setMitigating((m) => ({ ...m, [id]: Date.now() }));
    setMitStart((m) => ({ ...m, [id]: tickRef.current }));
    const L = liveRef.current;
    const dev = L.assets.find((a) => a.id === id) || L.gridPoints.find((p) => p.id === id) || L.customSensors.find((c) => c.id === id);
    if (dev) {
      setMitFrom((m) => ({ ...m, [id]: { val: dev.val, target: safeTarget(dev) } }));
      recOpen(dev, autoMitRef.current ? 'auto' : 'manual');
      const sl = shiftLogRef.current;
      sl.dispatched = [{ name: dev.name, id, ts: new Date().toTimeString().slice(0, 5) }, ...sl.dispatched.filter((x) => x.id !== id)].slice(0, 80);
    }
  }, []);
  // progress toward the safe band for a mitigating sensor (0..1), for lifecycle buttons
  const mitProgress = React.useCallback((a) => {
    const s = mitigating[a.id];
    if (typeof s === 'number' && s > 1 && Date.now() - s < 6000) return null; // dispatch window — command sent, no effect yet
    const f = mitFrom[a.id]; if (!f) return null;
    const span = f.val - f.target; if (Math.abs(span) < 1e-9) return 0.95;
    return Math.max(0.04, Math.min(0.98, (f.val - a.val) / span));
  }, [mitFrom, mitigating]);
  const resolvedFlash = React.useMemo(() => Object.keys(mitDone).map((id) => ({ id, name: mitDone[id].name })), [mitDone]);
  const injectFault = React.useCallback((group, sev, opts) => {
    const type = opts && opts.type || FAULT_TYPES[Math.floor(Math.random() * FAULT_TYPES.length)];
    if (window.NEPHES_SOURCE) NEPHES_SOURCE.command('fault.inject', { zone: group, sev, type });
    setFaults((f) => ({ ...f, [group]: sev }));
    setFaultTypes((t) => ({ ...t, [group]: type }));
    // mechanical wear is a hardware problem — software can detect it but not repair it
    setFaultHw((h) => ({ ...h, [group]: !!(opts && opts.hw) || type === 'Bearing wear' }));
  }, []);
  const clearFault = React.useCallback((group) => {
    setFaults((f) => { const o = { ...f }; delete o[group]; return o; });
    setFaultTypes((t) => { const o = { ...t }; delete o[group]; return o; });
    setFaultHw((h) => { const o = { ...h }; delete o[group]; return o; });
    setTechs((t) => { const o = { ...t }; delete o[group]; return o; });
  }, []);
  const clearAllFaults = React.useCallback(() => { setFaults({}); setFaultTypes({}); setFaultHw({}); setTechs({}); }, []);
  // ── ▶ Demo — a ~65s honest story: detect everything → fix what software can → dispatch humans for the rest ──
  const autoMitRef = React.useRef(autoMit);
  React.useEffect(() => { autoMitRef.current = autoMit; }, [autoMit]);
  const [demoCap, setDemoCap] = React.useState(null);
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(() => {
    const onToast = (e) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, msg: e.detail.msg, tone: e.detail.tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
    };
    window.addEventListener('nephes:toast', onToast);
    return () => window.removeEventListener('nephes:toast', onToast);
  }, []);
  // 🔊 audio alerts (opt-in) — soft chirp when a sensor first goes critical
  const [soundOn, setSoundOn] = React.useState(!!NFO_SESSION.sound);
  const soundRef = React.useRef(soundOn);
  React.useEffect(() => { soundRef.current = soundOn; }, [soundOn]);
  const [soundKind, setSoundKind] = React.useState(NFO_SESSION.soundKind || 'triple');
  const soundKindRef = React.useRef(soundKind);
  React.useEffect(() => { soundKindRef.current = soundKind; }, [soundKind]);
  const handleSoundKind = React.useCallback((k) => { setSoundKind(k); chirp(k, true); }, []);
  const handleSound = React.useCallback((v) => {
    setSoundOn(v);
    if (v) { chirp(soundKindRef.current, true); toast('Audio alerts on — plays when a sensor goes critical'); } else toast('Audio alerts off');
  }, []);
  // 🔄 cross-tab sync — if audio is toggled in another open console tab, follow it here too
  React.useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== 'nfo_session' || !e.newValue) return;
      try { const s = JSON.parse(e.newValue); if (typeof s.sound === 'boolean') setSoundOn(s.sound); if (s.soundKind) setSoundKind(s.soundKind); } catch (x) {}
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // 🔔 notification center — criticals & resolutions collect here (bell tab in header)
  const [notifs, setNotifs] = React.useState([]);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [notifUnread, setNotifUnread] = React.useState(0);
  const pushNotif = React.useCallback((sev, msg, sensorId) => {
    if (sev !== 'crit') return; // bell = critical-only; the events bar carries warnings & recoveries
    setNotifs((p) => [{ key: Date.now() + Math.random(), sev, msg, sensorId, ts: clk() }, ...p].slice(0, 30));
    setNotifUnread((u) => u + 1);
  }, []);
  // 🔧 hardware escalation — NEPHES can't fix mechanical wear in software; it routes a technician with the diagnosis attached
  const techTimers = React.useRef([]);
  React.useEffect(() => () => techTimers.current.forEach(clearTimeout), []);
  const dispatchTech = React.useCallback((a, ms) => {
    const g = a.group;
    if (window.NEPHES_SOURCE) NEPHES_SOURCE.command('technician.dispatch', { asset: a.name, zone: g });
    setTechs((t) => ({ ...t, [g]: { asset: a.name } }));
    recOpen(a, 'tech');
    logAction(a.name, 'Technician dispatched — hardware repair, diagnosis + part no. attached');
    pushNotif('warn', 'Work order dispatched — technician en route to ' + a.name, a.id);
    toast('Technician dispatched to ' + a.name, 'warn');
    const timer = setTimeout(() => {
      clearFault(g);
      recClose(a, { durMin: 12 + Math.random() * 16, devAfter: Math.random() * 2 });
      logAction(a.name, 'Hardware repaired on site — verified back in range');
      pushNotif('ok', a.name + ' repaired by technician — readings recovering', a.id);
    }, ms || 26000);
    techTimers.current.push(timer);
  }, [clearFault, pushNotif]);
  // 🔕 per-sensor alert muting — banner and bell independently
  const [muted, setMuted] = React.useState({});
  const mutedRef = React.useRef(muted);
  React.useEffect(() => { mutedRef.current = muted; }, [muted]);
  const toggleMute = React.useCallback((id, kind) => {
    const cur = mutedRef.current[id] || {};
    if (kind === 'all') {
      const nowMuted = !(cur.banner || cur.bell);
      setMuted((m) => ({ ...m, [id]: { banner: nowMuted, bell: nowMuted } }));
      toast(nowMuted ? 'Sensor muted — no events or notifications' : 'Sensor unmuted');
      return;
    }
    const nowMuted = !cur[kind];
    setMuted((m) => ({ ...m, [id]: { ...(m[id] || {}), [kind]: !((m[id] || {})[kind]) } }));
    toast((kind === 'banner' ? 'Event feed' : 'Bell') + (nowMuted ? ' muted · this sensor' : ' back on · this sensor'));
  }, []);
  // ⚠ critical bell notification — fires when a sensor FIRST crosses critical
  const prevCritRef = React.useRef(null);
  const critCoolRef = React.useRef(0);
  React.useEffect(() => {
    const cur = new Set();
    gridPoints.forEach((p) => { if (statusOf(p) === 'crit') cur.add(p.id); });
    if (prevCritRef.current === null) { prevCritRef.current = cur; return; }
    const prev = prevCritRef.current;
    const fresh = [];
    cur.forEach((id) => { if (!prev.has(id)) fresh.push(id); });
    prevCritRef.current = cur;
    if (!fresh.length) return;
    const now = Date.now();
    if (now - critCoolRef.current < 5000) return;
    const mm = mutedRef.current;
    const wset = watchSetRef.current;
    const freshBell = fresh.filter((fid) => !(mm[fid] && mm[fid].bell) && (!wset || wset.has(fid)));
    if (!freshBell.length) return;
    critCoolRef.current = now;
    const wb = gridPoints.find((p) => p.id === freshBell[0]);
    if (wb) {
      const valB = wb.val.toFixed(wb.dec != null ? wb.dec : 1) + wb.unit;
      pushNotif('crit', wb.name + ' went critical · ' + valB + (freshBell.length > 1 ? ' · +' + (freshBell.length - 1) + ' more' : ''), wb.id);
      if (soundRef.current) chirp(soundKindRef.current);
    }
  }, [stream.tick]); // eslint-disable-line
  // first-run tour — three callouts per profile, each shown once
  const tourSteps = TOURS[profile] || [];
  const [tourStep, setTourStep] = React.useState(null);
  const [tourRect, setTourRect] = React.useState(null);
  React.useEffect(() => {
    setTourStep(null);
    let t;
    try {
      const seen = localStorage.getItem('nephes_tour_' + profile) || (profile === 'manufacturing' && localStorage.getItem('nephes_tour_done'));
      if (!seen) t = setTimeout(() => setTourStep(0), 1000);
    } catch (e) {}
    return () => clearTimeout(t);
  }, [profile]);
  React.useEffect(() => {
    if (tourStep == null || !tourSteps[tourStep]) { setTourRect(null); return; }
    const el = document.querySelector(tourSteps[tourStep].sel);
    if (!el) { setTourRect(null); return; }
    const r = el.getBoundingClientRect();
    setTourRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, [tourStep, profile]); // eslint-disable-line
  const endTour = () => { setTourStep(null); try { localStorage.setItem('nephes_tour_' + profile, '1'); } catch (e) {} };
  // ⌘K universal search
  const [cmdk, setCmdk] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setCmdk((v) => !v); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const demoTimers = React.useRef([]);
  const demoPrevAutoMit = React.useRef(false);
  const endDemo = React.useCallback(() => {
    demoTimers.current.forEach(clearTimeout); demoTimers.current = [];
    techTimers.current.forEach(clearTimeout); techTimers.current = [];
    setDemoCap(null);
    clearAllFaults();
    setAutoMit(demoPrevAutoMit.current);
  }, [clearAllFaults]);
  const runDemo = React.useCallback(() => {
    demoPrevAutoMit.current = autoMitRef.current;
    setProfile('manufacturing'); setView('grid'); setRTab('ops'); setAutoMit(false); setSel(null);
    const steps = [
    [0, 'A live plant — 2,000 sensors streaming into NEPHES in real time.'],
    [4000, '__FAULT__A hydraulic failure begins — watch the wall catch it as it spreads.'],
    [8500, '__FAULT2__And a second, nastier problem: a bearing physically wearing out on Assembly Line A.'],
    [14000, 'NEPHES separates the two problems and groups the sensors behind each — automatically, no alarm flood.'],
    [20000, 'Everything detected and ranked. And NEPHES is honest: the hydraulic fault is software-fixable — the worn bearing is not.'],
    [26000, '__AUTOMIT__Auto-Mitigate on. Corrections are dispatched — and NEPHES is honest here too: readings walk back to safe over the next minute, not by magic.'],
    [34000, '__DISPATCH__…while the bearing gets what it actually needs: a technician, dispatched with the diagnosis and part number attached.'],
    [42500, '__TECHDONE__Technician on site — bearing replaced. NEPHES verifies the recovery live.'],
    [50000, '__ENTERPRISE__The same hour in dollars — downtime avoided, revenue protected, and the running total NEPHES saved.'],
    [58000, 'Detect everything. Fix what software can. Route the rest to the right hands. That’s NEPHES ✓'],
    [66000, '__END__']];
    const total = steps.length - 1;
    steps.forEach(([at, cap], idx) => {
      const t = setTimeout(() => {
        if (cap === '__END__') { endDemo(); return; }
        let text = cap;
        if (text.indexOf('__FAULT__') === 0) { injectFault('Hydraulic Systems', 'crit', { type: 'Pressure loss' }); text = text.slice(9); }
        if (text.indexOf('__FAULT2__') === 0) { injectFault('Assembly Line A', 'crit', { hw: true, type: 'Bearing wear' }); text = text.slice(10); }
        if (text.indexOf('__AUTOMIT__') === 0) { setAutoMit(true); text = text.slice(11); }
        if (text.indexOf('__DISPATCH__') === 0) {
          const L = liveRef.current;
          const arm = L.assets.find((x) => x.group === 'Assembly Line A' && statusOf(x) !== 'ok') || L.assets.find((x) => x.group === 'Assembly Line A');
          if (arm) dispatchTech(arm, 8000); // tech “finishes” right as the next caption lands
          text = text.slice(12);
        }
        if (text.indexOf('__TECHDONE__') === 0) { clearFault('Assembly Line A'); text = text.slice(12); }
        if (text.indexOf('__ENTERPRISE__') === 0) { setProfile('enterprise'); text = text.slice(14); }
        setDemoCap({ text, i: idx + 1, n: total });
      }, at);
      demoTimers.current.push(t);
    });
  }, [injectFault, endDemo, dispatchTech, clearFault]);
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

  // Auto-Mitigate resolves the faults software can fix — hardware faults hold until a technician clears them
  React.useEffect(() => {
    if (autoMit && Object.keys(faults).length) {
      const soft = Object.keys(faults).filter((g) => !faultHw[g]);
      if (!soft.length) return;
      const t = setTimeout(() => soft.forEach((g) => clearFault(g)), 900);
      return () => clearTimeout(t);
    }
  }, [autoMit, faults, faultHw, clearFault]);

  React.useEffect(() => {const iv = setInterval(() => setClock(clk()), 1000);return () => clearInterval(iv);}, []);
  React.useEffect(() => {
    let c = 0, w = 0;
    gridPoints.forEach((p) => { const s = statusOf(p); if (s === 'crit') c++;else if (s === 'warn') w++; });
    setRiskHist((h) => [...h.slice(1), { c, w }]);
    // auto-clear per-device mitigation once a sensor returns to OK (or, for non-sensor targets
    // like backend infra alerts, once a short simulated remediation window has elapsed)
    setMitigating((m) => {
      const ids = Object.keys(m);
      if (!ids.length) return m;
      let changed = false; const out = { ...m };
      for (const id of ids) {
        const dev = assets.find((a) => a.id === id) || gridPoints.find((p) => p.id === id);
        if (dev) {
          if (statusOf(dev) === 'ok') {
            delete out[id]; changed = true;
            setMitDone((d) => ({ ...d, [id]: { name: dev.name, until: Date.now() + 3200 } }));
            { const sl = shiftLogRef.current; sl.resolved = [{ name: dev.name, id, ts: new Date().toTimeString().slice(0, 5) }, ...sl.resolved.filter((x) => x.id !== id)].slice(0, 80); }
            recClose(dev);
            pushNotif && !(mutedRef.current[id] && mutedRef.current[id].bell) && pushNotif('ok', dev.name + ' resolved — readings back in range', id);
            setMitFrom((f) => { const n = { ...f }; delete n[id]; return n; });
          }
        } else {
          const started = mitStart[id];
          if (started == null || stream.tick - started > 22) { delete out[id]; changed = true; }
        }
      }
      return changed ? out : m;
    });
    // prune expired “resolved” flashes
    setMitDone((d) => { const now = Date.now(); const ks = Object.keys(d); if (!ks.length) return d; const keep = {}; let ch = false; ks.forEach((k) => { if (d[k].until > now) keep[k] = d[k]; else ch = true; }); return ch ? keep : d; });
  }, [stream.tick]); // eslint-disable-line
  React.useEffect(() => { setView(defaultView); }, [defaultView]);
  React.useEffect(() => { setProfile(startProfile); }, [startProfile]);
  React.useEffect(() => { document.body.classList.toggle('no-grid', !gridTexture); }, [gridTexture]);
  // ⠹⠺ ladder deep-link — any asset can jump to its control program; LadderLogic reads the detail on mount
  const ladderJump = React.useRef(null);
  React.useEffect(() => { const f = (e) => { ladderJump.current = e.detail || null; setProfile('logic'); }; window.addEventListener('nephes:ladder', f); return () => window.removeEventListener('nephes:ladder', f); }, []);
  React.useEffect(() => { document.body.classList.toggle('blue-on', !!blueLight); }, [blueLight]);
  const [eyeComfort, setEyeComfort] = React.useState(true); // all-day-operator mode: softer peaks, calmer motion
  React.useEffect(() => { document.body.classList.toggle('comfort', !!eyeComfort); }, [eyeComfort]);
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
  const wsTiles = wsSet ? tileAssets.filter((a) => wsSet.has(a.id)) : tileAssets;
  const alerts = (wsSet ? [...wsTiles, ...wsGrid] : tileAssets).filter((a) => statusOf(a) !== 'ok').
  sort((a, b) => (statusOf(b) === 'crit' ? 1 : 0) - (statusOf(a) === 'crit' ? 1 : 0));

  // events feed — rolling history of real status transitions (crossings + recoveries)
  const evtLogRef = React.useRef([]);
  const prevEvStRef = React.useRef(null);
  const evtCoolRef = React.useRef({});
  const evtGlobalRef = React.useRef(0);
  const [, setEvtVer] = React.useState(0);
  React.useEffect(() => {
    const fmt = (p) => p.val.toFixed(p.dec != null ? p.dec : 1) + p.unit;
    const nowTs = new Date().toTimeString().slice(0, 8);
    const mk = (p, kind) => ({
      key: p.id + ':' + kind + ':' + Date.now() + ':' + Math.floor(Math.random() * 1e4),
      ts: nowTs, asset: p.name, id: p.id,
      sev: kind === 'crit' ? 4 : kind === 'warn' ? 2 : 1,
      msg: kind === 'crit' ? `${p.label} ${fmt(p)} exceeded critical limit`
      : kind === 'warn' ? `${p.label} ${fmt(p)} over warning threshold`
      : `recovered — ${p.label.toLowerCase()} back in range at ${fmt(p)}` });

    const cur = {};
    gridPoints.forEach((p) => { cur[p.id] = statusOf(p); });
    if (prevEvStRef.current === null) {
      const seed = [];
      for (const p of gridPoints) { if (cur[p.id] !== 'ok') { seed.push(mk(p, cur[p.id])); if (seed.length >= 8) break; } }
      seed.sort((a, b) => b.sev - a.sev);
      evtLogRef.current = seed;
      prevEvStRef.current = cur;
      if (seed.length) setEvtVer((v) => v + 1);
      return;
    }
    const prev = prevEvStRef.current;
    const mm = mutedRef.current;
    const cool = evtCoolRef.current;
    const now = Date.now();
    const globalOpen = now - evtGlobalRef.current >= 7000; // pace the feed — routine batches at most every 7s
    let fresh = [];
    gridPoints.forEach((p) => {
      const was = prev[p.id] || 'ok', is = cur[p.id];
      if (was === is) return;
      if (mm[p.id] && mm[p.id].banner) return; // per-sensor event-feed mute
      const hot = is === 'crit' || is === 'ok' && was === 'crit'; // criticals + their recoveries always log
      if (!hot && !globalOpen) return;
      if (!hot && now - (cool[p.id] || 0) < 20000) return; // debounce flip-flop chatter
      let ev = null;
      if (is === 'crit') ev = mk(p, 'crit');else
      if (is === 'warn' && was === 'ok') ev = mk(p, 'warn');else
      if (is === 'ok') ev = mk(p, 'ok');
      if (ev) { ev.hot = hot; fresh.push(ev); }
    });
    prevEvStRef.current = cur;
    if (fresh.length) {
      fresh.sort((a, b) => b.sev - a.sev);
      fresh = fresh.filter((e) => e.hot).slice(0, 8).concat(fresh.filter((e) => !e.hot).slice(0, 3));
      fresh.forEach((e) => { cool[e.id] = now; });
      if (fresh.some((e) => !e.hot)) evtGlobalRef.current = now;
      evtLogRef.current = [...fresh, ...evtLogRef.current].slice(0, 48);
      setEvtVer((v) => v + 1);
    }
  }, [stream.tick]); // eslint-disable-line
  const events = evtLogRef.current;

  const selAsset = tileAssets.find((a) => a.id === sel) || gridPoints.find((a) => a.id === sel) || null;

  // top-priority sensor across the currently viewed pool (feeds the queue + the "TOP" tag)
  const rankPool = view === 'grid' ? wsGrid : wsTiles;
  let topId = null, topFrac = -1;
  for (const a of rankPool) { const f = riskOf(a).frac; if (f > topFrac) { topFrac = f; topId = a.id; } }

  // smart default: when nothing is manually selected, auto-load the top-priority sensor instead of an empty panel
  // pin the auto-selection while its mitigation runs or its “Resolved” flash shows,
  // so the panel doesn't jump to the next-worst sensor before the user sees the outcome
  const autoPinRef = React.useRef(null);
  let effectiveAsset = selAsset;
  if (!effectiveAsset) {
    const pin = autoPinRef.current;
    const pinLive = pin && (mitigating[pin] || mitDone[pin]) ? rankPool.find((a) => a.id === pin) || tileAssets.find((a) => a.id === pin) || null : null;
    effectiveAsset = pinLive || (topId ? rankPool.find((a) => a.id === topId) : null);
    autoPinRef.current = effectiveAsset ? effectiveAsset.id : null;
  } else {autoPinRef.current = null;}
  const autoDefault = !sel;

  // 💾 persist session — profile, selection, view, tab and toggles survive a refresh
  React.useEffect(() => {
    saveSession({ profile, view, sel, rTab, blueLight, autoMit, sound: soundOn, soundKind, comfort: eyeComfort });
  }, [profile, view, sel, rTab, blueLight, autoMit, soundOn, soundKind, eyeComfort]);
  React.useEffect(() => { if (NFO_SESSION.comfort != null) setEyeComfort(!!NFO_SESSION.comfort); }, []); // eslint-disable-line

  const paletteActions = [
  { label: 'Run investor demo', ic: '▶', run: () => runDemo() },
  { label: 'Inject test fault (Hydraulics)', ic: '⚠', run: () => { injectFault('Hydraulic Systems', 'crit'); toast('Test fault injected into Hydraulic Systems', 'warn'); } },
  { label: 'Clear all faults', ic: '✓', run: () => { clearAllFaults(); toast('All faults cleared'); } },
  { label: autoMit ? 'Turn Auto-Mitigate off' : 'Turn Auto-Mitigate on', ic: '◉', run: () => setAutoMit((v) => !v) },
  { label: 'Provision a sensor', ic: '＋', run: () => setShowAdd(true) },
  { label: 'Open Datasheet Library', ic: '📑', run: () => setShowDatasheets(true) },
  { label: 'Shift handoff report', ic: '📋', run: () => setShowReport(true) },
  { label: 'Open Analytics profile', ic: '📊', run: () => setProfile('analytics') },
  { label: 'Customize this view', ic: '🎛', run: () => setShowCz(true) },
  { label: soundOn ? 'Turn audio alerts off' : 'Turn audio alerts on', ic: '🔊', run: () => handleSound(!soundOn) },
  { label: 'Switch to Manufacturing view', ic: '⇄', run: () => setProfile('manufacturing') },
  { label: 'Switch to Enterprise view', ic: '⇄', run: () => setProfile('enterprise') },
  { label: 'Switch to Backend view', ic: '⇄', run: () => setProfile('backend') },
  { label: (stream.live ? 'Pause' : 'Resume') + ' live data', ic: '⏯', run: () => onToggleLive && onToggleLive() },
  ...wsAll.filter((w) => !w.archived).slice(0, 6).map((w) => ({ label: 'Workspace: ' + w.name, ic: '🗂', run: () => { setProfile('manufacturing'); setWsActive(w.id); } })),
  { label: 'New workspace', ic: '🗂', run: () => { setProfile('manufacturing'); wsCreate({ name: 'Workspace ' + (wsAll.length + 1) }); } }];

  const opsVis = cust(profile, 'ops').show || cust(profile, 'log').show;
  const simTabVis = profile === 'backend' ? cust(profile, 'sim').show || cust(profile, 'risks').show : cust(profile, 'sim').show;
  const rTabEff = !simTabVis ? 'ops' : !opsVis ? 'sim' : rTab;
  const rightVis = profile === 'enterprise' ? cust(profile, 'ai').show || cust(profile, 'actions').show : opsVis || simTabVis;
  return (
    <div className="shell" style={appear.density === 'compact' || density === 'compact' ? { fontSize: 11 } : null}>
      <Header health={health} statusText={statusText} recText={recText} counts={counts} profile={profile} setProfile={setProfile} clock={clock} stale={!stream.live} blueLight={blueLight} setBlueLight={setBlueLight} autoMit={autoMit} setAutoMit={setAutoMit} onAddSensor={() => setShowAdd(true)} onDatasheets={() => setShowDatasheets(true)} customCount={customSensors.length} onDemo={() => demoCap ? endDemo() : runDemo()} demoOn={!!demoCap} onToggleLive={onToggleLive} onSearch={() => setCmdk(true)} notifs={notifs} notifUnread={notifUnread} notifOpen={notifOpen} onNotifToggle={() => setNotifOpen((o) => { if (!o) setNotifUnread(0); return !o; })} onNotifPick={(id) => { if (String(id).indexOf('ladder:') === 0) { window.dispatchEvent(new CustomEvent('nephes:ladder', { detail: { progIdx: +String(id).slice(7) } })); setNotifOpen(false); return; } setProfile('manufacturing'); setSel(id); setNotifOpen(false); }} onNotifClear={() => { setNotifs([]); setNotifUnread(0); }} eyeComfort={eyeComfort} setEyeComfort={setEyeComfort} soundOn={soundOn} setSoundOn={handleSound} soundKind={soundKind} setSoundKind={handleSoundKind} onReport={() => setShowReport(true)} onAnalytics={() => setShowAnalytics(true)} appear={appear} setAppear={setAppear} />
      {profile === 'manufacturing' && <WorkspaceStrip list={wsAll.filter((w) => !w.archived)} archived={wsAll.filter((w) => !!w.archived)} active={wsActive} cur={wsCur} gridPoints={gridPoints} tiles={tileAssets} hist={wsHist} flagged={wsCur && wsCur.pins && wsCur.pins.length ? [...wsGrid, ...wsTiles].filter((a) => statusOf(a) !== 'ok').length : 0} onSwitch={setWsActive} onCreate={(o) => { if (o && o.fromFilters) { const { fromFilters, ...rest } = o; wsCreate({ ...rest, filters: { ...lastFiltersRef.current } }); } else wsCreate(o); }} onUpdate={wsUpdate} onDelete={wsDelete} onDuplicate={wsDuplicate} onSetDefault={wsSetDefault} onExport={wsExport} onNote={(id, txt) => wsNote(id, txt, 'user')} onArchive={wsArchive} onRestore={wsRestore} onToggleWatch={wsToggleWatch} onToggleRule={wsToggleRule} onBulkMitigate={() => { if (!wsCur || !wsCur.pins || !wsCur.pins.length) return; const flagged = [...wsGrid, ...wsTiles].filter((a) => statusOf(a) !== 'ok'); if (!flagged.length) { toast('Nothing flagged in this workspace'); return; } flagged.forEach((a) => startMitigation(a.id)); wsNote(wsCur.id, 'Bulk mitigation dispatched to ' + flagged.length + ' flagged sensor(s)', 'sys'); toast('Mitigation dispatched to ' + flagged.length + ' sensor(s)'); }} />}
      {profile !== 'logic' && cust(profile, 'kpis').show && <KpiStrip stream={stream} counts={counts} profile={profile} kpiOff={cust(profile, 'kpis').off || []} />}
      <main className={`main fade-in ${wallFocus ? 'wall-focus' : ''} ${profile === 'analytics' || profile === 'logic' || !rightVis ? 'analytics-full' : ''}`} style={{ '--right-w': ((cz[profile] || {}).rightW || 668) + 'px', '--ok-dim': cust('manufacturing', 'wall').dim != null ? cust('manufacturing', 'wall').dim : 0.6 }}>
        <div className={`wall-zone ${profile === 'analytics' || profile === 'logic' ? 'wall-zone-full' : ''}`}>
          {profile === 'enterprise' ?
          <ExecRollup assets={tileAssets} setSel={setSel} stream={stream} config={plantConfig} onConfigure={() => setShowConfig(true)} /> :
          profile === 'logic' ?
          <LadderLogic stream={stream} jump={ladderJump} onNotif={(msg, idx) => pushNotif('crit', msg, 'ladder:' + idx)} /> :
          profile === 'analytics' ?
          <div className="ana-page fade-in">
            <div className="ana-page-head">NEPHES ANALYTICS<span className="ana-live-tag"><i />LIVE · UPDATES EVERY TICK</span></div>
            <AnalyticsPanel recs={mitRecRef.current} hist={riskHist} points={gridPoints} events={events} onInspect={(id) => { setProfile('manufacturing'); setSel(id); }} />
          </div> :
          profile === 'backend' ?
          <SystemView stream={stream} /> :
          <React.Fragment>
              <SensorWall key={wsActive || 'all'} assets={wsSet ? [...wsTiles, ...wsGrid] : tileAssets} gridPoints={wsSet ? [...wsGrid, ...wsTiles] : gridPoints} sel={sel} setSel={setSel} view={view} setView={setView} profile={profile} stream={stream} focused={wallFocus} onToggleFocus={() => setWallFocus((f) => !f)} wsName={wsCur ? wsCur.name : null} wsHasPins={!!wsSet} initFilters={wsCur ? wsCur.filters : null} onFiltersChange={(f) => { lastFiltersRef.current = f; if (wsCur) wsUpdate(wsCur.id, { filters: f }); }} onPinVisible={wsCur ? (ids) => { wsUpdate(wsCur.id, (w) => ({ pins: Array.from(new Set([...(w.pins || []), ...ids])) })); toast(ids.length + ' sensors pinned to “' + wsCur.name + '”'); } : null} onExitWs={() => setWsActive(null)} onPinSensor={wsPin} />
              {!wallFocus && cust(profile, 'detail').show && (effectiveAsset ?
            <DetailCard a={effectiveAsset} onClose={() => setSel(null)} onAct={(id) => setSel(id)} autoMit={autoMit} mitigating={!!mitigating[effectiveAsset.id]} onMitigate={startMitigation} isTop={autoDefault} justResolved={!!mitDone[effectiveAsset.id]} progress={mitigating[effectiveAsset.id] ? mitProgress(effectiveAsset) : null} onPatchSensor={patchSensor} muted={muted[effectiveAsset.id]} onMute={toggleMute} pinnedWs={wsCur ? (wsCur.pins || []).includes(effectiveAsset.id) : false} onPinWs={wsPin} /> :
            <div className="select-prompt" id="selectPrompt">
                  <div className="sp-inner">
                    <div className="sp-icon" aria-hidden="true">
                      {Array.from({ length: 9 }).map((_, i) => <span key={i} />)}
                    </div>
                    <div className="sp-title">Select a sensor</div>
                    <div className="sp-sub">Click any cell in the wall — or use the ← ↑ ↓ → keys — to inspect its live reading, location, device settings and NEPHES analysis.</div>
                  </div>
                </div>)}
            </React.Fragment>}
        </div>
        {!wallFocus && profile !== 'analytics' && profile !== 'logic' && rightVis &&
        <div className="right-region">
          {profile === 'enterprise' ?
          <React.Fragment>
              {[
            { id: 'ai', el: <Pw cfg={cust(profile, 'ai')} base={{ maxH: 38 }}><AiAnalysis profile={profile} alerts={alerts.slice(0, 6)} onAct={(id) => setSel(id)} autoMit={autoMit} setAutoMit={setAutoMit} mitigating={mitigating} onMitigate={startMitigation} topId={topId} mitProgress={mitProgress} resolved={resolvedFlash} /></Pw> },
            { id: 'actions', el: <Pw cfg={cust(profile, 'actions')} base={{ grow: 1 }}><ExecActions summaryStatus="Output 8,420 u · ▲6.2% vs plan · cost $3.38/u" /></Pw> }].
            map((x, i) => ({ ...x, o: cust(profile, x.id).order != null ? cust(profile, x.id).order : i })).sort((a, b) => a.o - b.o).map((x) => cust(profile, x.id).show && <React.Fragment key={x.id}>{x.el}</React.Fragment>)}
            </React.Fragment> :

          <React.Fragment>
              <div className="rtabs">
                {opsVis && <button className={`rtab ${rTabEff === 'ops' ? 'active' : ''}`} onClick={() => setRTab('ops')}>Active Operations</button>}
                {simTabVis && <button className={`rtab ${rTabEff === 'sim' ? 'active' : ''}`} onClick={() => setRTab('sim')}>Simulation &amp; Tools{Object.keys(faults).length > 0 && <span className="rtab-badge">{Object.keys(faults).length}</span>}</button>}
              </div>
              <div className="rtab-content">
                {rTabEff === 'ops' ?
              <React.Fragment>
                    {[
                { id: 'ops', el: <Pw cfg={cust(profile, 'ops')} base={{ grow: 1.4 }}><AiAnalysis profile={profile} alerts={alerts.slice(0, 6)} shownId={effectiveAsset ? effectiveAsset.id : null} shownName={effectiveAsset ? effectiveAsset.name : null} onAct={(id) => setSel(id)} autoMit={autoMit} setAutoMit={setAutoMit} mitigating={mitigating} onMitigate={startMitigation} topId={topId} mitProgress={mitProgress} resolved={resolvedFlash} pool={profile === 'manufacturing' ? rankPool : null} hwGroups={faultHw} techs={techs} onDispatch={dispatchTech} wsPinned={wsCur ? new Set(wsCur.pins || []) : null} onPinWs={profile === 'manufacturing' ? wsPin : null} /></Pw> },
                { id: 'log', el: <Pw cfg={cust(profile, 'log')} base={{ grow: 1, minH: 100 }}><ActionLog tick={stream.tick} /></Pw> }].
                map((x, i) => ({ ...x, o: cust(profile, x.id).order != null ? cust(profile, x.id).order : i })).sort((a, b) => a.o - b.o).map((x) => cust(profile, x.id).show && <React.Fragment key={x.id}>{x.el}</React.Fragment>)}
                  </React.Fragment> :

              profile === 'manufacturing' ?
              <FaultSim groups={SECTIONS.map((s) => s.name)} zoneHealth={zoneHealth} faults={faults} faultTypes={faultTypes} faultHw={faultHw} techs={techs} injectFault={injectFault} clearFault={clearFault} clearAllFaults={clearAllFaults} /> :

              <React.Fragment>
                    {cust(profile, 'risks').show && <TopRisks pool={view === 'grid' ? wsGrid : wsTiles} setSel={setSel} />}
                    {cust(profile, 'sim').show && <FaultSim groups={SECTIONS.map((s) => s.name)} zoneHealth={zoneHealth} faults={faults} faultTypes={faultTypes} faultHw={faultHw} techs={techs} injectFault={injectFault} clearFault={clearFault} clearAllFaults={clearAllFaults} />}
                  </React.Fragment>}

              </div>
            </React.Fragment>}

        </div>}
      </main>
      {showEvents && cust(profile, 'events').show && <EventsBar events={events} onPick={(e) => { const dev = (e.id && (gridPoints.find((p) => p.id === e.id) || tileAssets.find((a) => a.id === e.id))) || tileAssets.find((a) => a.name === e.asset) || gridPoints.find((p) => p.name === e.asset); if (dev) { setSel(dev.id); toast('Jumped to ' + e.asset); } else openInfo('Event · ' + e.asset, e.msg, [['Time', e.ts], ['Asset', e.asset], ['Message', e.msg]]); }} />}
      {blueLight && <div className="blue-filter" aria-hidden="true" />}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => <div className={`toast ${t.tone}`} key={t.id}>✓ {t.msg}</div>)}
      </div>
      {tourStep != null && tourSteps[tourStep] &&
      <div className="tour-overlay">
          {tourRect && <div className="tour-hole" style={{ left: tourRect.x - 6, top: tourRect.y - 6, width: tourRect.w + 12, height: tourRect.h + 12 }} />}
          <div className="tour-card" style={tourRect ? { left: Math.min(window.innerWidth - 330, Math.max(12, tourRect.x + tourRect.w / 2 - 155)), top: Math.min(window.innerHeight - 200, tourRect.y + tourRect.h + 14) } : { left: '50%', top: '40%', transform: 'translate(-50%,-50%)' }}>
            <div className="tc-step">{tourStep + 1} / {tourSteps.length}</div>
            <div className="tc-title">{tourSteps[tourStep].title}</div>
            <div className="tc-txt">{tourSteps[tourStep].txt}</div>
            <div className="tc-row">
              <button className="tc-skip" onClick={endTour}>Skip tour</button>
              <button className="tc-next" onClick={() => tourStep >= tourSteps.length - 1 ? endTour() : setTourStep(tourStep + 1)}>{tourStep >= tourSteps.length - 1 ? 'Done ✓' : 'Next →'}</button>
            </div>
          </div>
        </div>}
      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} sensors={cmdk ? [...tileAssets, ...gridPoints] : []} actions={paletteActions} onPick={(it) => { if (it.kind === 'action') it.run(); else { setProfile('manufacturing'); setSel(it.id); toast('Jumped to ' + it.label); } }} />
      {demoCap &&
      <div className="demo-bar" role="status">
          <span className="db-dot" />
          <span className="db-step">{demoCap.i}/{demoCap.n}</span>
          <span className="db-cap">{demoCap.text}</span>
          <button className="db-end" onClick={endDemo}>✕ End</button>
        </div>}
      {showAdd && <AddSensorModal groups={SECTIONS.map((s) => s.name)} onAdd={addSensor} onClose={() => setShowAdd(false)} />}
      {showDatasheets && <DatasheetLibrary assets={tileAssets.slice(0, 40)} onClose={() => setShowDatasheets(false)} onBind={() => {}} />}
      {showConfig && <PlantConfigModal config={plantConfig} onSave={(c) => { setPlantConfig(c); setShowConfig(false); setCfgToast(`NEPHES reconfigured · ${c.lines.length} lines · target ${fmt(c.lines.reduce((s, l) => s + (+l.speed || 0), 0))} u/hr`); setTimeout(() => setCfgToast(''), 4200); }} onClose={() => setShowConfig(false)} />}
      {cfgToast && <div className="cfg-toast">✓ {cfgToast}</div>}
      {infoData && <InfoModal data={infoData} onClose={() => setInfoData(null)} />}
      {showCz && <CustomizeDrawer profile={profile} cz={cz} cust={cust} onPatch={czPatch} onRightW={czRightW} onReset={czReset} onImport={(p) => { setCz(p); saveSession({ cz: p }); }} onClose={() => setShowCz(false)} />}
      {showAnalytics && <AnalyticsModal recs={mitRecRef.current} hist={riskHist} points={gridPoints} events={events} onInspect={(id) => { setSel(id); setShowAnalytics(false); }} onClose={() => setShowAnalytics(false)} />}
      {showReport && (() => {
        const now = new Date();
        const start = new Date(now); start.setHours(6, 0, 0, 0); if (start > now) start.setDate(start.getDate() - 1);
        const shiftSec = (now - start) / 1000;
        const rate = 0.05 + (counts.crit + counts.warn) * 0.004;
        const evs = evtLogRef.current; const sl = shiftLogRef.current;
        const data = {
          now, start, health, counts, autoMit,
          saved: 18600 + shiftSec * rate + (counts.crit + counts.warn) * 1400,
          events: { crit: evs.filter((e) => e.sev >= 3).length, warn: evs.filter((e) => e.sev === 2).length, ok: evs.filter((e) => e.sev === 1).length, list: evs.slice(0, 8) },
          dispatched: sl.dispatched.slice(0, 7), nDis: sl.dispatched.length, nRes: sl.resolved.length,
          resolvedIds: Object.fromEntries(sl.resolved.map((r) => [r.id, true])),
          risks: alerts.slice(0, 6).map((a) => ({ name: a.name, val: a.val.toFixed(a.dec != null ? a.dec : 1) + a.unit, st: statusOf(a) })),
          workspaces: wsAll.filter((w) => !w.archived).map((w) => { const set = new Set(w.pins || []); let c = 0, wn = 0; gridPoints.forEach((p) => { if (set.has(p.id)) { const s = statusOf(p); if (s === 'crit') c++; else if (s === 'warn') wn++; } }); tileAssets.forEach((p) => { if (set.has(p.id)) { const s = statusOf(p); if (s === 'crit') c++; else if (s === 'warn') wn++; } }); const un = (w.notes || []).filter((x) => x.kind === 'user'); return { name: w.name, n: (w.pins || []).length, c, w: wn, watch: !!w.watch, rule: w.rule && w.rule.label, lastNote: un.length ? un[un.length - 1].txt : null }; }) };
        return <ShiftReport data={data} onClose={() => setShowReport(false)} />;
      })()}
    </div>);

}

Object.assign(window, { Industrial });
;

// ═══ 🗂 Workspaces — tabbed working sets (pins + saved filters), persisted per console ═══
const WS_LS_KEY = 'nfo_workspaces_v1';
const WS_PRESETS = [
{ key: 'triage', name: 'Criticals triage', desc: 'Operator', filters: { grp: 'all', sev: 'crit', q: '' } },
{ key: 'vib', name: 'Vibration audit', desc: 'Engineer', filters: { grp: 'all', sev: 'all', q: 'vib' } },
{ key: 'thermal', name: 'Thermal watch', desc: 'Engineer', filters: { grp: 'all', sev: 'all', q: 'temp' } },
{ key: 'exec', name: 'Line A overview', desc: 'Exec', filters: { grp: 'Assembly Line A', sev: 'all', q: '' } }];
function loadWorkspaces() {
  try {
    const s = JSON.parse(localStorage.getItem(WS_LS_KEY) || 'null');
    if (s && Array.isArray(s.list)) {
      const def = s.list.find((w) => w.def);
      return { list: s.list, active: s.active != null && s.list.some((w) => w.id === s.active) ? s.active : def ? def.id : null };
    }
  } catch (e) {}
  return { list: [{ id: 'ws-seed-triage', name: 'Criticals triage', def: false, pins: [], filters: { grp: 'all', sev: 'crit', q: '' } }], active: null };
}
function saveWorkspaces(s) { try { localStorage.setItem(WS_LS_KEY, JSON.stringify(s)); } catch (e) {} }

function WorkspaceStrip({ list, active, cur, gridPoints, tiles, onSwitch, onCreate, onUpdate, onDelete, onDuplicate, onSetDefault, onExport, hist, flagged, onBulkMitigate, onNote, onArchive, onToggleWatch, onToggleRule, archived, onRestore }) {
  const [menu, setMenu] = React.useState(null); // 'new' | workspace id
  const [renaming, setRenaming] = React.useState(null);
  const [notesFor, setNotesFor] = React.useState(null);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!menu) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenu(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);
  const pool = tiles.concat(gridPoints);
  const statsOf = (w) => {
    if (!w.pins || !w.pins.length) return null;
    const set = new Set(w.pins);
    let n = 0, crit = 0, warn = 0;
    for (const p of pool) { if (!set.has(p.id)) continue; n++; const s = statusOf(p); if (s === 'crit') crit++; else if (s === 'warn') warn++; }
    return { n, crit, warn };
  };
  // ⚡ NEPHES suggestion — ≥4 failing sensors sharing one measure read as one problem: offer to group them
  const suggestion = React.useMemo(() => {
    const byLabel = {};
    for (const p of gridPoints) { if (statusOf(p) === 'ok') continue; (byLabel[p.label] = byLabel[p.label] || []).push(p.id); }
    let best = null;
    for (const l in byLabel) if (byLabel[l].length >= 4 && (!best || byLabel[l].length > best.ids.length)) best = { label: l, ids: byLabel[l] };
    if (!best) return null;
    return list.some((w) => w.srcLabel === best.label) ? null : best;
  }, [gridPoints, list]);
  return (
    <div className="ws-strip" ref={wrapRef}>
      <span className="ws-label">Workspaces</span>
      <button className={'ws-tab' + (!active ? ' on' : '')} onClick={() => onSwitch(null)} title="Everything — no workspace scoping">⌂ All sensors</button>
      {list.map((w) => {
        const st = statsOf(w);
        const dot = st ? (st.crit ? 'crit' : st.warn ? 'warn' : 'ok') : 'flt';
        return (
          <span key={w.id} className="ws-tab-wrap">
            <button className={'ws-tab' + (active === w.id ? ' on' : '')} onClick={() => active === w.id ? setMenu(menu === w.id ? null : w.id) : onSwitch(w.id)} onDoubleClick={() => { setMenu(null); setRenaming(w.id); }} title={st ? st.n + ' pinned · ' + st.crit + ' critical · click again for actions' : 'Saved filter view · click again for actions'}>
              <i className={'ws-dot ' + dot} />
              {renaming === w.id ?
              <input className="ws-rename" autoFocus defaultValue={w.name} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') { onUpdate(w.id, { name: e.target.value.trim() || w.name }); setRenaming(null); } else if (e.key === 'Escape') setRenaming(null); }} onBlur={(e) => { onUpdate(w.id, { name: e.target.value.trim() || w.name }); setRenaming(null); }} /> :
              <span className="ws-name">{w.def ? '★ ' : ''}{w.name}</span>}
              <span className="ws-n">{st ? st.n : 'filter'}</span>
              {st && st.crit > 0 && <span className="ws-crit">{st.crit}!</span>}
              {w.newIds && w.newIds.length > 0 && <span className="ws-newb" title="Auto-joined since you last looked">+{w.newIds.length} new</span>}
              {w.watch && <span className="ws-wicon" title="Watching — alerts scoped to this workspace">🔔</span>}
              {active === w.id && <span className="ws-caret">▾</span>}
            </button>
            {menu === w.id &&
            <div className="ws-menu">
              <button className="ws-mi" onClick={() => { setRenaming(w.id); setMenu(null); }}>✎ Rename<kbd>dbl·click</kbd></button>
              <button className="ws-mi" onClick={() => { onDuplicate(w.id); setMenu(null); }}>⧉ Duplicate</button>
              <button className="ws-mi" onClick={() => { onSetDefault(w.id); setMenu(null); }}>{w.def ? '★ Default workspace ✓' : '☆ Set as default'}</button>
              <button className="ws-mi" onClick={() => { onExport(w.id); setMenu(null); }}>⇪ Export config</button>
              <div className="ws-msep" />
              <button className="ws-mi" onClick={() => { setNotesFor(w.id); setMenu(null); }}>🗒 Investigation notes<kbd>{(w.notes || []).length || ''}</kbd></button>
              <button className="ws-mi" onClick={() => { onToggleWatch(w.id); setMenu(null); }}>{w.watch ? '🔔 Watching ✓ — alerts scoped here' : '🔕 Watch — alerts only for this'}</button>
              <button className="ws-mi" onClick={() => { onToggleRule(w.id); setMenu(null); }}>{w.rule && w.rule.label ? '⚡ Auto-join ✓ — failing ' + String(w.rule.label).toLowerCase() : '⚡ Auto-join matching failures'}</button>
              <div className="ws-msep" />
              <button className="ws-mi" onClick={() => { const o = window.prompt('Outcome for the archive & shift handoff (optional):', ''); if (o !== null) onArchive(w.id, o.trim()); setMenu(null); }}>✔ Resolve & archive</button>
              <button className="ws-mi del" onClick={() => { onDelete(w.id); setMenu(null); }}>✕ Delete workspace</button>
            </div>}
          </span>);
      })}
      <span className="ws-new-wrap">
        <button className={'ws-new' + (menu === 'new' ? ' open' : '')} onClick={() => setMenu(menu === 'new' ? null : 'new')}>＋ New</button>
        {menu === 'new' && <WsNewModal gridPoints={gridPoints} list={list} archived={archived} onRestore={onRestore} onCreate={(o) => { onCreate(o); setMenu(null); }} onClose={() => setMenu(null)} />}
      </span>
      {suggestion &&
      <button className="ws-suggest" onClick={() => onCreate({ name: suggestion.label + ' cluster', pins: suggestion.ids, srcLabel: suggestion.label })} title="NEPHES groups sensors failing on the same measure so the pattern reads as one problem — not an alarm flood">
        ⚡ NEPHES: {suggestion.ids.length} failing {String(suggestion.label).toLowerCase()} sensors — group them
      </button>}
      <span className="ws-hint">{cur ? 'filters save to this workspace · ⌥0 exits' : '⌥1–9 switch · pin from any sensor detail'}</span>
      {cur && cur.pins && cur.pins.length > 0 && <span className="ws-trend" title="Warn (amber) and critical (red) counts inside this workspace over the shift"><Spark series={(hist || []).map((h) => h.w)} w={62} h={14} color="var(--warn)" strokeW={1.2} dot={false} /><Spark series={(hist || []).map((h) => h.c)} w={62} h={14} color="var(--crit)" strokeW={1.2} dot={false} /></span>}
      {cur && <button className="ws-act" onClick={() => setNotesFor(cur.id)} title="Investigation log — notes travel with the shift handoff">🗒 Notes{(cur.notes || []).length ? ' · ' + (cur.notes || []).length : ''}</button>}
      {cur && flagged > 0 && <button className="ws-act mit" onClick={onBulkMitigate} title="Dispatch mitigation to every flagged sensor in this workspace">◉ Mitigate all ({flagged})</button>}
      {notesFor && (() => { const w = list.find((x) => x.id === notesFor); return w ? <WsNotesPanel ws={w} onAdd={onNote} onClose={() => setNotesFor(null)} /> : null; })()}
    </div>);
}


// 🗂 New-workspace chooser — NEPHES-recommended failure clusters first, then presets / blank / import
function WsNewModal({ gridPoints, list, archived, onRestore, onCreate, onClose }) {
  const recs = React.useMemo(() => {
    const covered = new Set(list.map((w) => w.srcLabel).filter(Boolean));
    const byLabel = {}, byZone = {};
    for (const p of gridPoints) {
      if (statusOf(p) === 'ok') continue;
      (byLabel[p.label] = byLabel[p.label] || []).push(p);
      (byZone[p.group] = byZone[p.group] || []).push(p);
    }
    const out = [];
    Object.keys(byLabel).filter((l) => byLabel[l].length >= 3).sort((a, b) => byLabel[b].length - byLabel[a].length).slice(0, 3).forEach((l) => {
      const pts = byLabel[l];
      out.push({ name: l + ' cluster', why: 'Same measure failing across ' + new Set(pts.map((p) => p.group)).size + ' zone(s) — likely one root pattern', pins: pts.map((p) => p.id), crit: pts.filter((p) => statusOf(p) === 'crit').length, srcLabel: l, covered: covered.has(l) });
    });
    Object.keys(byZone).filter((z) => byZone[z].length >= 5).sort((a, b) => byZone[b].length - byZone[a].length).slice(0, 2).forEach((z) => {
      const pts = byZone[z];
      out.push({ name: z + ' sweep', why: 'Fault concentration in one zone — inspect it as a unit', pins: pts.map((p) => p.id), crit: pts.filter((p) => statusOf(p) === 'crit').length });
    });
    return out;
  }, [gridPoints, list]);
  return ReactDOM.createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal ws-new-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">NEW WORKSPACE<button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="ws-nm-body">
          <div className="ws-msec2">⚡ NEPHES recommends<span className="ws-msec-sub">live failure clusters — grouped so a pattern reads as one problem, not an alarm flood</span></div>
          {recs.length === 0 && <div className="ws-rec-empty">No failure clusters right now — the plant is quiet. Start from a preset or a blank workspace below.</div>}
          {recs.map((r, i) =>
          <button key={i} className="ws-rec" disabled={!!r.covered} onClick={() => onCreate({ name: r.name, pins: r.pins, srcLabel: r.srcLabel })}>
            <i className={'ws-dot ' + (r.crit ? 'crit' : 'warn')} />
            <span className="ws-rec-main">
              <span className="ws-rec-name">{r.name}{r.covered && <em className="ws-rec-cov">already a workspace</em>}</span>
              <span className="ws-rec-why">{r.why}</span>
            </span>
            <span className="ws-rec-n">{r.pins.length} sensors{r.crit ? ' · ' + r.crit + ' crit' : ''}</span>
            <span className="ws-rec-go">Create →</span>
          </button>)}
          <div className="ws-msec2">Start from</div>
          <div className="ws-nm-row">
            <button className="ws-nm-opt" onClick={() => onCreate({ name: 'Workspace ' + (list.length + 1) })}>▢ Blank<small>empty — pin sensors as you investigate</small></button>
            <button className="ws-nm-opt" onClick={() => onCreate({ name: 'Current view', fromFilters: true })}>⛃ Current filters<small>saves the wall exactly as filtered now</small></button>
            <button className="ws-nm-opt" onClick={() => { const t = window.prompt('Paste a workspace config (JSON):'); if (!t) return; try { const w = JSON.parse(t); onCreate({ name: w.name || 'Imported', pins: Array.isArray(w.pins) ? w.pins : [], filters: w.filters && typeof w.filters === 'object' ? w.filters : { grp: 'all', sev: 'all', q: '' } }); } catch (e) { toast('Could not parse that workspace JSON', 'warn'); } }}>⇩ Import<small>paste a config exported elsewhere</small></button>
          </div>
          <div className="ws-msec2">Role presets</div>
          <div className="ws-nm-row">
            {WS_PRESETS.map((p) => <button key={p.key} className="ws-nm-opt" onClick={() => onCreate({ name: p.name, filters: Object.assign({}, p.filters) })}>{p.name}<small>{p.desc} — saved filter view</small></button>)}
          </div>
          {archived && archived.length > 0 && <React.Fragment>
            <div className="ws-msec2">🗄 Resolved & archived</div>
            {archived.map((w) => <div key={w.id} className="ws-arch"><span className="ws-arch-name">{w.name}</span><span className="ws-arch-meta">{(w.pins || []).length} sensors · {w.archived.ts}{w.archived.outcome ? ' · “' + w.archived.outcome + '”' : ''}</span><button className="ws-arch-restore" onClick={() => { onRestore(w.id); onClose(); }}>↺ Restore</button></div>)}
          </React.Fragment>}
        </div>
      </div>
    </div>, document.body);
}


// 🗒 Investigation log panel — timestamped notes per workspace; feeds the shift handoff
function WsNotesPanel({ ws, onAdd, onClose }) {
  const [txt, setTxt] = React.useState('');
  const listRef = React.useRef(null);
  React.useEffect(() => { if (listRef.current) listRef.current.scrollTop = 1e6; }, [ws.notes]);
  const submit = () => { const t = txt.trim(); if (!t) return; onAdd(ws.id, t); setTxt(''); };
  return ReactDOM.createPortal(
    <div className="ws-notes">
      <div className="ws-nt-head">🗒 {ws.name} — investigation log<button className="modal-close" onClick={onClose}>✕</button></div>
      <div className="ws-nt-list" ref={listRef}>
        {(ws.notes || []).length === 0 && <div className="ws-nt-empty">No notes yet — record why this workspace exists and what you find. Notes travel with the shift handoff.</div>}
        {(ws.notes || []).map((n, i) => <div key={i} className={'ws-nt ' + (n.kind || 'user')}><span className="ws-nt-ts">{n.ts}</span><span className="ws-nt-txt">{n.kind === 'sys' ? '⚙ ' : ''}{n.txt}</span></div>)}
      </div>
      <div className="ws-nt-inrow">
        <input className="ws-nt-in" placeholder="Add a finding… (Enter)" value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        <button className="ws-nt-add" onClick={submit}>Add</button>
      </div>
    </div>, document.body);
}

// ═══ DC wrapper — mounts the real console with a live stream ═══
function NFOConsoleApp(props) {
  const [live, setLive] = React.useState(true);
  const SPEED = { slow: 0.5, normal: 1, fast: 2 };
  const stream = useFactoryStream({ live, speed: SPEED[props.speed] || 0.5, volatility: 0.5 });
  return React.createElement(Industrial, {
    stream, density: 'comfortable', defaultView: 'grid',
    startProfile: props.profile || 'manufacturing',
    showEvents: true, gridTexture: false, glow: true, volatility: 0.5,
    onToggleLive: () => setLive(v => !v) });
}
window.NFOConsoleApp = NFOConsoleApp;

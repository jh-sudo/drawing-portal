import { useEffect, useState } from 'react';
import { useCanvasStore } from '../../store/canvasStore';
import { useUiStore } from '../../store/uiStore';
import {
  TANK_MATERIAL_OPTIONS,
  PAPER_SIZES_MM,
  SHEET_PX_PER_MM,
  calcTankCapacityLitres,
  calcWaterLevelAmsl,
  getPxPerMetre,
  type TankProperties,
} from '../../types';
import { mrlToPixel } from '../../utils/mrlMapping';

interface Props {
  tankId: string;
  onClose: () => void;
}

interface TankValidationErrors {
  inletPipeMAmsl?: string;
  overflowPipeDiameterM?: string;
  overflowPipeMAmsl?: string;
  warningPipeMAmsl?: string;
  distanceOutletToBaseM?: string;
  capacityShortfallL?: number;
  capacityOverageL?: number;
  waterLevelWarning?: string;
}

function validateTankDraft(draft: TankProperties, waterLevelAmsl: number | null): TankValidationErrors {
  const errors: TankValidationErrors = {};

  // Inlet level cannot exceed tank top (floor + height)
  if (draft.inletPipeMAmsl != null && draft.floorLevelMAmsl != null && draft.heightM != null) {
    const tankTopM = draft.floorLevelMAmsl + draft.heightM;
    if (draft.inletPipeMAmsl > tankTopM) {
      errors.inletPipeMAmsl = `Inlet is above tank top — max ${tankTopM.toFixed(1)} m AMSL (floor ${draft.floorLevelMAmsl} + height ${draft.heightM})`;
    }
  }

  // Overflow level cannot exceed inlet level
  if (draft.overflowPipeMAmsl != null && draft.inletPipeMAmsl != null) {
    if (draft.overflowPipeMAmsl > draft.inletPipeMAmsl) {
      errors.overflowPipeMAmsl = `Overflow cannot be higher than inlet (${draft.inletPipeMAmsl!.toFixed(1)} m AMSL)`;
    }
  }

  // Overflow pipe Ø must be > inlet pipe Ø
  if (draft.overflowPipeDiameterM != null && draft.inletPipeDiameterM != null) {
    if (draft.overflowPipeDiameterM <= draft.inletPipeDiameterM) {
      errors.overflowPipeDiameterM = `Must be larger than inlet pipe (${(draft.inletPipeDiameterM * 1000).toFixed(0)} mm)`;
    }
  }

  // Warning pipe must be ≥ 50 mm below overflow pipe level
  if (draft.overflowPipeMAmsl != null && draft.warningPipeMAmsl != null) {
    const gapMm = Math.round((draft.overflowPipeMAmsl - draft.warningPipeMAmsl) * 1000);
    if (gapMm < 50) {
      errors.warningPipeMAmsl = `Only ${gapMm} mm below overflow level — minimum 50 mm required`;
    }
  }

  // Calculated water level must be ≥ 25 mm below warning pipe level
  if (waterLevelAmsl != null && draft.warningPipeMAmsl != null) {
    const gapMm = Math.round((draft.warningPipeMAmsl - waterLevelAmsl) * 1000);
    if (gapMm < 25) {
      errors.waterLevelWarning = `Normal water level is only ${gapMm} mm below warning pipe — minimum 25 mm required`;
    }
  }

  // Outlet → base must be 75–100 mm
  if (draft.distanceOutletToBaseM != null) {
    const mm = Math.round(draft.distanceOutletToBaseM * 1000);
    if (mm < 75 || mm > 100) {
      errors.distanceOutletToBaseM = `${mm} mm — must be within 75–100 mm`;
    }
  }

  // Effective capacity vs occupant-based daily demand
  const capacityL = calcTankCapacityLitres(draft);
  if (capacityL != null && draft.occupants != null && draft.occupants > 0) {
    const requiredL = draft.occupants * 141;
    if (capacityL < requiredL) {
      errors.capacityShortfallL = requiredL - capacityL;
    } else if (capacityL > requiredL * 1.2) {
      errors.capacityOverageL = capacityL - requiredL;
    }
  }

  return errors;
}

type NumKey =
  | 'lengthM' | 'widthM' | 'heightM' | 'floorLevelMAmsl'
  | 'inletPipeDiameterM' | 'inletPipeMAmsl'
  | 'outletPipeDiameterM' | 'distanceOutletToBaseM'
  | 'overflowPipeDiameterM' | 'overflowPipeMAmsl'
  | 'warningPipeDiameterM' | 'warningPipeMAmsl'
  | 'supportHeightM' | 'occupants';

export function WaterTankPropertiesModal({ tankId, onClose }: Props) {
  const tank = useCanvasStore((s) =>
    s.elements.find((el) => el.id === tankId && el.symbolId === 'water_tank')
  );
  const updateTankProperties = useCanvasStore((s) => s.updateTankProperties);
  const updateElementDimensions = useCanvasStore((s) => s.updateElementDimensions);
  const updateElementPosition = useCanvasStore((s) => s.updateElementPosition);
  const sheetConfig = useUiStore((s) => s.sheetConfig);
  const mrlConfig = useUiStore((s) => s.mrlConfig);

  const [draft, setDraft] = useState<TankProperties>({ ...(tank?.tankProperties ?? {}) });

  // Resync the draft if the store's tankProperties changes underneath us — e.g.
  // an undo/redo fired while this modal is open (focus not in a text field).
  // Without this, Save would silently re-apply the stale pre-undo values.
  useEffect(() => {
    if (!tank) {
      onClose();
      return;
    }
    setDraft({ ...(tank.tankProperties ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tank?.tankProperties]);

  if (!tank) return null;

  const setField = (key: NumKey, raw: string) => {
    if (raw === '') {
      const next = { ...draft };
      delete next[key];
      setDraft(next);
      return;
    }
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    setDraft({ ...draft, [key]: Math.max(0, Math.round(val * 10000) / 10000) });
  };

  const capacityL = calcTankCapacityLitres(draft);
  const waterLevelAmsl = calcWaterLevelAmsl(draft);
  const errors = validateTankDraft(draft, waterLevelAmsl);

  // Derived hints for reactive level fields
  const tankTopM = (draft.floorLevelMAmsl != null && draft.heightM != null)
    ? draft.floorLevelMAmsl + draft.heightM : null;
  const maxInletHint = tankTopM != null
    ? `Max: ${tankTopM.toFixed(1)} m AMSL (floor ${draft.floorLevelMAmsl} + height ${draft.heightM})` : null;
  const maxOverflowHint = draft.inletPipeMAmsl != null
    ? `Max: ${draft.inletPipeMAmsl!.toFixed(1)} m AMSL (cannot exceed inlet)` : null;

  const handleSave = () => {
    updateTankProperties(tankId, draft);
    const { upperMrl, lowerMrl } = mrlConfig;
    const paperH = PAPER_SIZES_MM[sheetConfig.paperSize].h * SHEET_PX_PER_MM;
    const pxPerM = getPxPerMetre(sheetConfig.drawingScale);
    const MIN_PX = 24;
    if (draft.lengthM && draft.heightM) {
      const w = Math.max(MIN_PX, Math.round(draft.lengthM * pxPerM));
      const h = Math.max(MIN_PX, Math.round(draft.heightM * pxPerM));
      updateElementDimensions(tankId, w, h);
      if (draft.floorLevelMAmsl !== undefined) {
        const centerY = mrlToPixel(
          draft.floorLevelMAmsl + draft.heightM / 2,
          paperH, upperMrl, lowerMrl,
        );
        updateElementPosition(tankId, tank.x, centerY);
      }
    }
    onClose();
  };

  // Demand calculation
  const demandL = (draft.occupants ?? 0) > 0 ? (draft.occupants! * 141) : null;
  const pct = (capacityL != null && demandL != null) ? Math.round((capacityL / demandL) * 100) : null;
  const barColor = pct == null ? '#cbd5e1'
    : pct < 100 ? '#ef4444'
    : pct > 120 ? '#eab308'
    : '#22c55e';

  const hasAlerts = errors.waterLevelWarning || errors.capacityShortfallL != null || errors.capacityOverageL != null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 1000, overflowY: 'auto', padding: '24px 16px',
    }}>
      <div style={{
        background: '#fff', borderRadius: 10,
        width: 'min(700px, calc(100vw - 32px))',
        boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
        boxSizing: 'border-box', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>
            Water Tank — Advanced Details
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            All elevations in metres AMSL · Diameters and dimensions in metres
          </div>
        </div>

        {/* Two-column body */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 230px',
          gap: 0,
        }}>

          {/* ── LEFT: inputs ─────────────────────────────── */}
          <div style={{ padding: '14px 16px', borderRight: '1px solid #f1f5f9' }}>

            {/* Material + Sunken Tank checkbox on one line */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={LBL}>Material</label>
                <select
                  value={draft.material ?? ''}
                  onChange={(e) => setDraft({ ...draft, material: e.target.value || undefined })}
                  style={{ ...INPUT, padding: '5px 8px' }}
                >
                  <option value="">— Select —</option>
                  {TANK_MATERIAL_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <CheckField
                label="Sunken Tank"
                checked={draft.isSunkenTank ?? false}
                onChange={(v) => setDraft({ ...draft, isSunkenTank: v })}
              />
            </div>

            {/* Dimensions — all 4 on one row */}
            <SectionHead title="Dimensions" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '0 16px', alignItems: 'start' }}>
              <NumField label="Length"      unit="m"      value={draft.lengthM}         onChange={(v) => setField('lengthM', v)} />
              <NumField label="Width"       unit="m"      value={draft.widthM}          onChange={(v) => setField('widthM', v)} />
              <NumField label="Height"      unit="m"      value={draft.heightM}         onChange={(v) => setField('heightM', v)} />
              <NumField label="Floor Level" unit="m AMSL" value={draft.floorLevelMAmsl} onChange={(v) => setField('floorLevelMAmsl', v)} />
            </div>

            {/* Pipes — compact table */}
            <SectionHead title="Pipes" />
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '68px 1fr 1fr', gap: '0 12px', marginBottom: 4 }}>
              <div />
              <div style={COL_HDR}>Pipe Ø (m)</div>
              <div style={COL_HDR}>Level / Distance</div>
            </div>
            {/* Inlet */}
            <PipeRow label="Inlet">
              <InlineField unit="m"      value={draft.inletPipeDiameterM}   onChange={(v) => setField('inletPipeDiameterM', v)} />
              <InlineField unit="m AMSL" value={draft.inletPipeMAmsl}       onChange={(v) => setField('inletPipeMAmsl', v)}
                error={errors.inletPipeMAmsl} hint={!errors.inletPipeMAmsl ? maxInletHint ?? undefined : undefined} />
            </PipeRow>
            {/* Outlet */}
            <PipeRow label="Outlet">
              <InlineField unit="m" value={draft.outletPipeDiameterM}   onChange={(v) => setField('outletPipeDiameterM', v)} />
              <InlineField unit="m (→Base)" value={draft.distanceOutletToBaseM} onChange={(v) => setField('distanceOutletToBaseM', v)}
                error={errors.distanceOutletToBaseM} />
            </PipeRow>
            {/* Overflow */}
            <PipeRow label="Overflow">
              <InlineField unit="m"      value={draft.overflowPipeDiameterM} onChange={(v) => setField('overflowPipeDiameterM', v)}
                error={errors.overflowPipeDiameterM} />
              <InlineField unit="m AMSL" value={draft.overflowPipeMAmsl}     onChange={(v) => setField('overflowPipeMAmsl', v)}
                error={errors.overflowPipeMAmsl} hint={!errors.overflowPipeMAmsl ? maxOverflowHint ?? undefined : undefined} />
            </PipeRow>
            {/* Warning */}
            <PipeRow label="Warning">
              <InlineField unit="m"      value={draft.warningPipeDiameterM} onChange={(v) => setField('warningPipeDiameterM', v)} />
              <InlineField unit="m AMSL" value={draft.warningPipeMAmsl}     onChange={(v) => setField('warningPipeMAmsl', v)}
                error={errors.warningPipeMAmsl} />
            </PipeRow>

            {/* Supports + Occupants on one row */}
            <SectionHead title="Other" />
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <NumField label="Support Height" unit="m" placeholder="blank = 0.6 m" inputWidth={110} value={draft.supportHeightM} onChange={(v) => setField('supportHeightM', v)} />
              <NumField
                label="Occupants" unit="persons"
                value={draft.occupants} placeholder="e.g. 120"
                onChange={(raw) => {
                  if (raw === '') { const n = { ...draft }; delete n.occupants; setDraft(n); return; }
                  const val = Math.max(1, Math.round(parseFloat(raw)));
                  if (!isNaN(val)) setDraft({ ...draft, occupants: val });
                }}
              />
            </div>
          </div>

          {/* ── RIGHT: outputs ───────────────────────────── */}
          <div style={{ padding: '12px 14px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={OUTPUT_LABEL}>Summary</div>

            {/* Capacity + Water Level — compact side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div style={{ padding: '6px 8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Capacity</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: capacityL == null ? '#94a3b8' : '#1d4ed8', fontFamily: 'monospace' }}>
                  {capacityL == null ? '—' : `${capacityL.toLocaleString()} L`}
                </div>
              </div>
              <div style={{ padding: '6px 8px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Water Level</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: waterLevelAmsl == null ? '#94a3b8' : '#0369a1', fontFamily: 'monospace' }}>
                  {waterLevelAmsl == null ? '—' : `${waterLevelAmsl} m`}
                </div>
              </div>
            </div>

            {/* Demand bar — compact */}
            {demandL != null && pct != null && (
              <div style={{ padding: '6px 8px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginBottom: 4 }}>
                  <span>vs {demandL.toLocaleString()} L demand</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: barColor }}>{pct}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: '#e2e8f0', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(pct, 150)}%`, background: barColor, borderRadius: 3, transition: 'width 0.2s' }} />
                </div>
                <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>Target: 100–120% of daily demand</div>
              </div>
            )}

            {/* Tank cross-section diagram */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Cross Section
              </div>
              <TankDiagram draft={draft} waterLevelAmsl={waterLevelAmsl} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 4 }}>
                {([
                  { lbl: 'IN Inlet',       color: '#16a34a' },
                  { lbl: 'OV Overflow',    color: '#ea580c' },
                  { lbl: 'WN Warning',     color: '#d97706' },
                  { lbl: 'OUT Outlet',     color: '#2563eb' },
                  { lbl: 'WL Water level', color: '#1d4ed8' },
                ] as const).map(({ lbl, color }) => (
                  <span key={lbl} style={{ fontSize: 9, color, fontWeight: 600 }}>{lbl}</span>
                ))}
              </div>
            </div>

            {/* Validation alerts */}
            {hasAlerts && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={OUTPUT_LABEL}>Alerts</div>
                {errors.waterLevelWarning && (
                  <Alert color="#dc2626" bg="#fef2f2" border="#fca5a5">{errors.waterLevelWarning}</Alert>
                )}
                {errors.capacityShortfallL != null && (
                  <Alert color="#9a3412" bg="#fff7ed" border="#fed7aa">
                    Capacity <strong>{errors.capacityShortfallL.toLocaleString()} L short</strong> of 1-day storage.
                  </Alert>
                )}
                {errors.capacityOverageL != null && (
                  <Alert color="#854d0e" bg="#fefce8" border="#fde047">
                    Surplus <strong>{errors.capacityOverageL.toLocaleString()} L</strong> — confirm oversizing.
                  </Alert>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid #f1f5f9',
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          <button onClick={onClose} style={BTN_SECONDARY}>Cancel</button>
          <button onClick={handleSave} style={BTN_PRIMARY}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Tank cross-section diagram ──────────────────────────────────────────────

function TankDiagram({ draft, waterLevelAmsl }: { draft: TankProperties; waterLevelAmsl: number | null }) {
  const W = 202;
  const H = 175;
  const L_PAD = 26; // left: inlet label
  const R_PAD = 36; // right: outlet/overflow/warning labels
  const tankL = L_PAD;
  const tankR = W - R_PAD;
  const tankTop = 10;
  const tankBot = H - 22;
  const tankHpx = tankBot - tankTop;
  const tankWpx = tankR - tankL;

  const floorM  = draft.floorLevelMAmsl ?? null;
  const heightM = draft.heightM ?? null;
  const hasGeo  = floorM != null && heightM != null && heightM > 0;

  const toY = (amsl: number) => {
    if (!hasGeo) return tankBot;
    const frac = Math.max(0, Math.min(1, (amsl - floorM!) / heightM!));
    return tankBot - frac * tankHpx;
  };
  const toYBase = (dist: number) => floorM != null ? toY(floorM + dist) : tankBot;
  const cl = (y: number) => Math.max(tankTop + 1, Math.min(tankBot - 1, y));

  const waterY    = waterLevelAmsl != null && hasGeo ? cl(toY(waterLevelAmsl))                     : null;
  const inletY    = draft.inletPipeMAmsl != null && hasGeo      ? cl(toY(draft.inletPipeMAmsl))    : null;
  const outletY   = draft.distanceOutletToBaseM != null && hasGeo ? cl(toYBase(draft.distanceOutletToBaseM)) : null;
  const overflowY = draft.overflowPipeMAmsl != null && hasGeo   ? cl(toY(draft.overflowPipeMAmsl)) : null;
  const warningY  = draft.warningPipeMAmsl != null && hasGeo    ? cl(toY(draft.warningPipeMAmsl))  : null;

  const PIPE_LEN = 14;

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {/* Water fill */}
      {waterY != null && (
        <rect x={tankL + 1.5} y={waterY} width={tankWpx - 3} height={Math.max(0, tankBot - waterY)}
              fill="#bfdbfe" fillOpacity={0.85} />
      )}

      {/* Tank body */}
      <rect x={tankL} y={tankTop} width={tankWpx} height={tankHpx}
            fill="none" stroke="#334155" strokeWidth={2} />

      {/* Ground line */}
      <line x1={tankL - 6} y1={tankBot + 1} x2={tankR + 6} y2={tankBot + 1}
            stroke="#94a3b8" strokeWidth={1} />

      {/* Floor label */}
      <text x={tankL + tankWpx / 2} y={tankBot + 14}
            textAnchor="middle" fontSize={7.5} fill="#64748b">
        {floorM != null ? `${floorM} m AMSL` : 'Floor —'}
      </text>

      {/* Water level dashed line */}
      {waterY != null && (
        <>
          <line x1={tankL + 2} y1={waterY} x2={tankR - 2} y2={waterY}
                stroke="#1d4ed8" strokeWidth={1} strokeDasharray="4 2" />
          <text x={tankL + tankWpx / 2} y={waterY - 3}
                textAnchor="middle" fontSize={7} fill="#1d4ed8">
            WL {waterLevelAmsl!.toFixed(1)} m
          </text>
        </>
      )}

      {/* Inlet — left side, arrow pointing right into tank */}
      {inletY != null && (
        <g>
          <line x1={tankL - PIPE_LEN} y1={inletY} x2={tankL} y2={inletY} stroke="#16a34a" strokeWidth={2.5} />
          <polygon points={`${tankL - 5},${inletY - 4} ${tankL - 5},${inletY + 4} ${tankL + 1},${inletY}`} fill="#16a34a" />
          <text x={tankL - PIPE_LEN - 2} y={inletY + 3} textAnchor="end" fontSize={8} fill="#16a34a" fontWeight="700">IN</text>
        </g>
      )}

      {/* Outlet — right side, arrow pointing right out of tank */}
      {outletY != null && (
        <g>
          <line x1={tankR} y1={outletY} x2={tankR + PIPE_LEN} y2={outletY} stroke="#2563eb" strokeWidth={2.5} />
          <polygon points={`${tankR + PIPE_LEN - 5},${outletY - 4} ${tankR + PIPE_LEN - 5},${outletY + 4} ${tankR + PIPE_LEN + 1},${outletY}`} fill="#2563eb" />
          <text x={tankR + PIPE_LEN + 3} y={outletY + 3} textAnchor="start" fontSize={8} fill="#2563eb" fontWeight="700">OUT</text>
        </g>
      )}

      {/* Overflow — right side */}
      {overflowY != null && (
        <g>
          <line x1={tankR} y1={overflowY} x2={tankR + PIPE_LEN} y2={overflowY} stroke="#ea580c" strokeWidth={2.5} />
          <polygon points={`${tankR + PIPE_LEN - 5},${overflowY - 4} ${tankR + PIPE_LEN - 5},${overflowY + 4} ${tankR + PIPE_LEN + 1},${overflowY}`} fill="#ea580c" />
          <text x={tankR + PIPE_LEN + 3} y={overflowY + 3} textAnchor="start" fontSize={8} fill="#ea580c" fontWeight="700">OV</text>
        </g>
      )}

      {/* Warning — right side, dashed */}
      {warningY != null && (
        <g>
          <line x1={tankR} y1={warningY} x2={tankR + PIPE_LEN} y2={warningY}
                stroke="#d97706" strokeWidth={2} strokeDasharray="3 2" />
          <text x={tankR + PIPE_LEN + 3} y={warningY + 3} textAnchor="start" fontSize={8} fill="#d97706" fontWeight="700">WN</text>
        </g>
      )}

      {/* Placeholder when no geometry */}
      {!hasGeo && (
        <text x={W / 2} y={H / 2 - 4} textAnchor="middle" fontSize={9.5} fill="#94a3b8">
          Enter floor level &amp; height
        </text>
      )}
    </svg>
  );
}

// Legend below diagram (HTML so it's easy to read)
// Rendered inline in JSX as a small colour key

// ─── Presentational helpers ───────────────────────────────────────────────────

function SectionHead({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: '#475569',
      textTransform: 'uppercase', letterSpacing: '0.06em',
      marginTop: 10, marginBottom: 5,
      paddingBottom: 3, borderBottom: '1px solid #e5e7eb',
    }}>
      {title}
    </div>
  );
}

function PipeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '68px 1fr 1fr', gap: '0 12px', marginBottom: 4, alignItems: 'start' }}>
      <div style={{ fontSize: 11, color: '#374151', fontWeight: 600, paddingTop: 6 }}>{label}</div>
      {children}
    </div>
  );
}

interface InlineFieldProps {
  unit: string;
  value: number | undefined;
  onChange: (raw: string) => void;
  error?: string;
  hint?: string;
}

function InlineField({ unit, value, onChange, error, hint }: InlineFieldProps) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number" min={0} step={0.01}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 72, padding: '4px 6px',
            border: `1px solid ${error ? '#dc2626' : '#d1d5db'}`,
            borderRadius: 4, fontSize: 12,
            background: error ? '#fef2f2' : '#fff',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
        <span style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap' }}>{unit}</span>
      </div>
      {error && <div style={{ fontSize: 9, color: '#dc2626', marginTop: 2, lineHeight: 1.3 }}>{error}</div>}
      {hint && !error && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, lineHeight: 1.3 }}>{hint}</div>}
    </div>
  );
}

const COL_HDR: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};

function OutputCard({ title, accent, bg, border, children }: {
  title: string; accent: string; bg: string; border: string; children: React.ReactNode;
}) {
  return (
    <div style={{ padding: '10px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 7 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Alert({ color, bg, border, children }: {
  color: string; bg: string; border: string; children: React.ReactNode;
}) {
  return (
    <div style={{ padding: '7px 10px', background: bg, border: `1px solid ${border}`, borderRadius: 5, fontSize: 11, color, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 7,
      fontSize: 12, color: '#444', cursor: 'pointer',
      padding: '6px 0',
    }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ margin: 0 }} />
      {label}
    </label>
  );
}

interface NumFieldProps {
  label: string;
  unit: string;
  value: number | undefined;
  placeholder?: string;
  onChange: (raw: string) => void;
  error?: string;
  hint?: string;
  inputWidth?: number;
}

function NumField({ label, unit, value, placeholder, onChange, error, hint, inputWidth = 80 }: NumFieldProps) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={{ display: 'block', fontSize: 11, color: error ? '#dc2626' : '#475569', marginBottom: 3 }}>
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number" min={0} step={0.01}
          value={value ?? ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: inputWidth, minWidth: 0, padding: '5px 7px',
            border: `1px solid ${error ? '#dc2626' : '#d1d5db'}`,
            borderRadius: 4, fontSize: 13,
            background: error ? '#fef2f2' : '#fff',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
        <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{unit}</span>
      </div>
      {error && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 3, lineHeight: 1.4 }}>{error}</div>}
      {hint && !error && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

const LBL: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#444', marginBottom: 4,
};

const INPUT: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid #d1d5db',
  borderRadius: 5, fontSize: 13, outline: 'none', background: '#fff',
};

const OUTPUT_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#475569',
  textTransform: 'uppercase', letterSpacing: '0.06em',
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '9px 28px', borderRadius: 6, border: 'none',
  background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const BTN_SECONDARY: React.CSSProperties = {
  padding: '9px 22px', borderRadius: 6,
  border: '1px solid #d1d5db', background: '#f9fafb',
  color: '#374151', fontSize: 13, cursor: 'pointer',
};

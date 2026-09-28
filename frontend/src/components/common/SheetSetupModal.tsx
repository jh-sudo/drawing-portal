import { useState } from 'react';
import { useUiStore } from '../../store/uiStore';
import {
  PAPER_SIZES_MM,
  DEFAULT_SHEET_CONFIG,
  getUpperMrl,
  MRL_LOWER_HARD_MIN,
  type PaperSize,
  type PaperSeries,
  type DrawingScale,
  type SheetConfig,
  type SubmissionType,
} from '../../types';
import { isFieldRequired, type RequirableField } from '../../utils/titleBlockRequirements';

const ISO_SIZES:  { id: PaperSize; label: string }[] = [
  { id: 'A0', label: 'A0' },
  { id: 'A1', label: 'A1' },
  { id: 'A2', label: 'A2' },
  { id: 'A3', label: 'A3' },
  { id: 'A4', label: 'A4' },
];
const ANSI_SIZES: { id: PaperSize; label: string }[] = [
  { id: 'ANSI_A', label: 'A' },
  { id: 'ANSI_B', label: 'B' },
  { id: 'ANSI_C', label: 'C' },
  { id: 'ANSI_D', label: 'D' },
  { id: 'ANSI_E', label: 'E' },
];
const SCALES: DrawingScale[] = [20, 25, 50, 100, 200, 500];

function getSeriesOf(size: PaperSize): PaperSeries {
  return size.startsWith('ANSI') ? 'ANSI' : 'ISO';
}

export function SheetSetupModal() {
  const { sheetConfig, mrlConfig, setSheetConfig, setMrlConfig, closeSheetSetup, sheetSetupInitialTab } = useUiStore();
  const [draft, setDraft] = useState<SheetConfig>({ ...sheetConfig });
  const [lowerMrlDraft, setLowerMrlDraft] = useState<string>(String(mrlConfig.lowerMrl));
  const [tab, setTab] = useState<'sheet' | 'titleblock'>(sheetSetupInitialTab);
  const [series, setSeries] = useState<PaperSeries>(getSeriesOf(sheetConfig.paperSize));

  const parsedLowerMrl = Math.max(MRL_LOWER_HARD_MIN, parseFloat(lowerMrlDraft) || 0);
  const previewUpperMrl = getUpperMrl(parsedLowerMrl, draft);
  const sheetHeightM = (PAPER_SIZES_MM[draft.paperSize].h * draft.drawingScale / 1000).toFixed(1);

  const setTB = (key: keyof SheetConfig['titleBlock'], val: string) =>
    setDraft((d) => ({ ...d, titleBlock: { ...d.titleBlock, [key]: val } }));
  const submissionType = draft.titleBlock.submissionType;
  const req = (field: RequirableField) => isFieldRequired(draft.titleBlock, field);

  const handleSeriesSwitch = (s: PaperSeries) => {
    setSeries(s);
    // Switch to the nearest equivalent size in the other series
    const defaults: Record<PaperSeries, PaperSize> = { ISO: 'A3', ANSI: 'ANSI_B' };
    if (getSeriesOf(draft.paperSize) !== s) setDraft((d) => ({ ...d, paperSize: defaults[s] }));
  };

  const handleConfirm = () => {
    setSheetConfig(draft);
    setMrlConfig({ lowerMrl: parsedLowerMrl });
    closeSheetSetup();
  };

  const sizes = series === 'ISO' ? ISO_SIZES : ANSI_SIZES;
  const seriesLabel = series === 'ISO' ? 'ISO A-Series' : 'ANSI Series';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, width: 'min(540px, calc(100vw - 32px))',
        maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '22px 28px 0' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#111', marginBottom: 16 }}>
            Sheet Setup
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', gap: 0 }}>
            {(['sheet', 'titleblock'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '8px 18px',
                border: 'none', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
                background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: tab === t ? 600 : 400,
                color: tab === t ? '#2563eb' : '#6b7280',
                marginBottom: -1,
              }}>
                {t === 'sheet' ? 'Sheet' : 'Title Block'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 28px', flex: 1 }}>

          {/* ── Sheet tab ─────────────────────────────────── */}
          {tab === 'sheet' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

              {/* Paper size */}
              <div>
                <div style={LABEL}>Paper Size</div>

                {/* Series toggle */}
                <div style={{
                  display: 'inline-flex', background: '#f3f4f6', borderRadius: 7,
                  padding: 3, marginBottom: 12,
                }}>
                  {(['ISO', 'ANSI'] as PaperSeries[]).map((s) => (
                    <button key={s} onClick={() => handleSeriesSwitch(s)} style={{
                      padding: '5px 16px', border: 'none', borderRadius: 5,
                      background: series === s ? '#fff' : 'transparent',
                      boxShadow: series === s ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                      color: series === s ? '#111' : '#6b7280',
                      fontWeight: series === s ? 600 : 400,
                      fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                      {s === 'ISO' ? 'ISO A-Series' : 'ANSI Series'}
                    </button>
                  ))}
                </div>

                {/* Size chips */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {sizes.map(({ id, label }) => {
                    const mm = PAPER_SIZES_MM[id];
                    const selected = draft.paperSize === id;
                    return (
                      <button key={id} onClick={() => setDraft((d) => ({ ...d, paperSize: id }))} style={{
                        padding: '8px 14px', borderRadius: 7, cursor: 'pointer',
                        border: selected ? '2px solid #2563eb' : '1px solid #d1d5db',
                        background: selected ? '#eff6ff' : '#fafafa',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        minWidth: 72,
                      }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: selected ? '#2563eb' : '#111' }}>
                          {seriesLabel === 'ISO A-Series' ? label : `ANSI ${label}`}
                        </span>
                        <span style={{ fontSize: 10, color: '#6b7280' }}>
                          {mm.w}×{mm.h}
                        </span>
                        <span style={{ fontSize: 9, color: '#9ca3af' }}>mm</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Drawing scale */}
              <div>
                <div style={LABEL}>Drawing Scale</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {SCALES.map((s) => {
                    const selected = draft.drawingScale === s;
                    return (
                      <button key={s} onClick={() => setDraft((d) => ({ ...d, drawingScale: s }))} style={{
                        padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                        border: selected ? '2px solid #2563eb' : '1px solid #d1d5db',
                        background: selected ? '#eff6ff' : '#fafafa',
                        color: selected ? '#2563eb' : '#374151',
                        fontWeight: selected ? 700 : 400,
                      }}>
                        1:{s}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 7, fontSize: 11, color: '#6b7280' }}>
                  1 m = {(1000 / draft.drawingScale).toFixed(0)} mm on paper
                  &nbsp;·&nbsp; sheet shows <b>{sheetHeightM} m</b> of elevation
                </div>
              </div>

              {/* Base elevation */}
              <div>
                <div style={LABEL}>Base Elevation (m AMSL)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    value={lowerMrlDraft}
                    min={MRL_LOWER_HARD_MIN}
                    step={0.5}
                    onChange={(e) => setLowerMrlDraft(e.target.value)}
                    style={{
                      width: 100, padding: '7px 9px',
                      border: '1px solid #d1d5db', borderRadius: 5,
                      fontSize: 13, outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    → ceiling: <b>{previewUpperMrl.toFixed(1)} m AMSL</b>
                  </span>
                </div>
                <div style={{ marginTop: 5, fontSize: 11, color: '#9ca3af' }}>
                  Used for the Mode of Supply compliance check (SS636 §3). Set to the lowest floor elevation.
                </div>
              </div>
            </div>
          )}

          {/* ── Title Block tab ───────────────────────────── */}
          {tab === 'titleblock' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

              {/* ── Submission type ── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Submission Type<RequiredMark />
              </div>
              <select
                value={submissionType ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, titleBlock: { ...d.titleBlock, submissionType: (e.target.value || undefined) as SubmissionType | undefined } }))}
                style={{
                  alignSelf: 'flex-start', width: 220, padding: '7px 9px', marginBottom: 6,
                  border: `1px solid ${submissionType ? '#d1d5db' : '#fca5a5'}`, borderRadius: 5,
                  fontSize: 13, outline: 'none', background: '#fff', color: submissionType ? '#111' : '#9ca3af',
                }}
              >
                <option value="" disabled>Select…</option>
                <option value="PE">PE Submission</option>
                <option value="LP">LP Submission</option>
              </select>
              {!submissionType && (
                <div style={{
                  fontSize: 11, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 5, padding: '6px 9px', marginBottom: 6,
                }}>
                  ⚠ Please select PE or LP submission — it decides which fields below are mandatory.
                </div>
              )}
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 18 }}>
                Fields marked <RequiredMark /> must be filled before the PDF can be exported.
              </div>

              {/* ── Block sections ── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                Block Sections
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                <div>
                  <TextAreaField
                    label="Owner / Developer"
                    hint="Name, address, email, phone"
                    value={draft.titleBlock.ownerDeveloper ?? ''}
                    onChange={(v) => setTB('ownerDeveloper', v)}
                  />
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Stamp / Signature Image</div>
                    {draft.titleBlock.ownerStamp ? (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ border: '1px solid #d1d5db', borderRadius: 5, padding: 6, background: '#f9fafb' }}>
                          <img src={draft.titleBlock.ownerStamp} alt="Owner stamp" style={{ maxWidth: 140, maxHeight: 60, display: 'block', objectFit: 'contain' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <StampButton label="Replace" onClick={() => triggerStampUpload((v) => setTB('ownerStamp', v))} />
                          <StampButton label="Remove"  danger onClick={() => setTB('ownerStamp', '')} />
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => triggerStampUpload((v) => setTB('ownerStamp', v))}
                        style={{ border: '2px dashed #d1d5db', borderRadius: 6, padding: '12px 16px', textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2563eb'; (e.currentTarget as HTMLDivElement).style.background = '#eff6ff'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db'; (e.currentTarget as HTMLDivElement).style.background = '#fafafa'; }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>⬆ Upload stamp / signature</div>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>PNG, JPG or WebP · transparent background recommended</div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <TextAreaField
                    label="Professional Engineer"
                    hint="Name, company, address, email, phone"
                    required={req('professionalEngineer')}
                    value={draft.titleBlock.professionalEngineer ?? ''}
                    onChange={(v) => setTB('professionalEngineer', v)}
                  />
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>PE Stamp &amp; Signature{req('peStamp') && <RequiredMark />}</div>
                    {draft.titleBlock.peStamp ? (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ border: '1px solid #d1d5db', borderRadius: 5, padding: 6, background: '#f9fafb' }}>
                          <img src={draft.titleBlock.peStamp} alt="PE stamp" style={{ maxWidth: 140, maxHeight: 60, display: 'block', objectFit: 'contain' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <StampButton label="Replace" onClick={() => triggerStampUpload((v) => setTB('peStamp', v))} />
                          <StampButton label="Remove"  danger onClick={() => setTB('peStamp', '')} />
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => triggerStampUpload((v) => setTB('peStamp', v))}
                        style={{ border: '2px dashed #d1d5db', borderRadius: 6, padding: '12px 16px', textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2563eb'; (e.currentTarget as HTMLDivElement).style.background = '#eff6ff'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db'; (e.currentTarget as HTMLDivElement).style.background = '#fafafa'; }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>⬆ Upload PE stamp &amp; signature</div>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>PNG, JPG or WebP · transparent background recommended</div>
                      </div>
                    )}
                  </div>
                </div>

                <TextAreaField
                  label="Project Title"
                  hint="Full project description"
                  required={req('projectName')}
                  value={draft.titleBlock.projectName}
                  onChange={(v) => setTB('projectName', v)}
                />

                <TextAreaField
                  label="Main Contractor"
                  hint="Company name, address, phone"
                  required={req('mainContractor')}
                  value={draft.titleBlock.mainContractor ?? ''}
                  onChange={(v) => setTB('mainContractor', v)}
                />

                <TextAreaField
                  label="Licensed Plumber"
                  hint="Name, company, address, email, phone"
                  required={req('licensedPlumber')}
                  value={draft.titleBlock.licensedPlumber ?? ''}
                  onChange={(v) => setTB('licensedPlumber', v)}
                />
              </div>

              {/* ── LP Stamp ── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 22, marginBottom: 8, paddingTop: 18, borderTop: '1px solid #e5e7eb' }}>
                LP Stamp &amp; Signature{req('lpStamp') && <RequiredMark />}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
                Uploaded stamp is placed directly on the canvas — drag it to position.
              </div>
              {draft.titleBlock.lpStamp ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ border: '1px solid #d1d5db', borderRadius: 5, padding: 6, background: '#f9fafb' }}>
                    <img src={draft.titleBlock.lpStamp} alt="LP stamp" style={{ maxWidth: 140, maxHeight: 80, display: 'block', objectFit: 'contain' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <StampButton label="Replace" onClick={() => triggerStampUpload((v) => setTB('lpStamp', v))} />
                    <StampButton label="Remove"  danger onClick={() => { setTB('lpStamp', ''); }} />
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => triggerStampUpload((v) => setTB('lpStamp', v))}
                  style={{ border: '2px dashed #d1d5db', borderRadius: 6, padding: '12px 16px', textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2563eb'; (e.currentTarget as HTMLDivElement).style.background = '#eff6ff'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db'; (e.currentTarget as HTMLDivElement).style.background = '#fafafa'; }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>⬆ Upload LP stamp &amp; signature</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>PNG, JPG or WebP · transparent background recommended</div>
                </div>
              )}

              {/* ── Drawing Info ── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 22, marginBottom: 12, paddingTop: 18, borderTop: '1px solid #e5e7eb' }}>
                Drawing Info
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Drawn By"       value={draft.titleBlock.drawnBy}      onChange={(v) => setTB('drawnBy', v)} />
                <Field label="Checked By"     value={draft.titleBlock.checkedBy}    onChange={(v) => setTB('checkedBy', v)} />
                <Field label="Date"           value={draft.titleBlock.date}         onChange={(v) => setTB('date', v)} type="date" />
                <Field label="Scale"          value={`1:${draft.drawingScale}`}     onChange={() => {}} disabled />
                <Field label="Drawing No."    value={draft.titleBlock.drawingNo}    onChange={(v) => setTB('drawingNo', v)} />
                <Field label="Project No."    value={draft.titleBlock.projectNo ?? ''}    onChange={(v) => setTB('projectNo', v)} />
                <Field label="Rev."           value={draft.titleBlock.rev}          onChange={(v) => setTB('rev', v)} />
                <Field label="Tenure of Land" value={draft.titleBlock.tenureOfLand ?? ''} onChange={(v) => setTB('tenureOfLand', v)} />
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 28px', borderTop: '1px solid #f3f4f6',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button
            onClick={() => { setDraft({ ...DEFAULT_SHEET_CONFIG }); setSeries('ISO'); }}
            style={{
              padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6,
              background: '#f9fafb', color: '#374151', cursor: 'pointer', fontSize: 13,
            }}
          >
            Reset
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: '8px 20px', border: 'none', borderRadius: 6,
              background: '#2563eb', color: '#fff',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function triggerStampUpload(onLoad: (dataUrl: string) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onLoad(reader.result as string);
    reader.readAsDataURL(file);
  };
  input.click();
}

function StampButton({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12,
      border: `1px solid ${danger ? '#fca5a5' : '#d1d5db'}`,
      background: '#fff', color: danger ? '#dc2626' : '#374151',
    }}>
      {label}
    </button>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#475569',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
};

function Field({ label, value, onChange, type = 'text', disabled }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: '100%', padding: '7px 9px', border: '1px solid #d1d5db',
          borderRadius: 5, fontSize: 13, outline: 'none', boxSizing: 'border-box',
          background: disabled ? '#f3f4f6' : undefined,
          color: disabled ? '#9ca3af' : undefined,
        }}
      />
    </div>
  );
}

function RequiredMark() {
  return <span style={{ color: '#dc2626', fontWeight: 700, marginLeft: 2 }} title="Required">*</span>;
}

function TextAreaField({ label, hint, value, onChange, required }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
        <label style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>{label}{required && <RequiredMark />}</label>
        {hint && <span style={{ fontSize: 10, color: '#9ca3af' }}>{hint}</span>}
      </div>
      <textarea
        value={value}
        rows={4}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        style={{
          width: '100%', padding: '7px 9px', border: '1px solid #d1d5db',
          borderRadius: 5, fontSize: 12, outline: 'none', boxSizing: 'border-box',
          resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, color: '#111',
        }}
      />
    </div>
  );
}

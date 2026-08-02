import { useState, useRef } from 'react';
import { useCanvasStore } from '../../store/canvasStore';
import { useMetadataExport } from '../../hooks/useMetadataExport';
import { useJsonImport } from '../../hooks/useJsonImport';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EvaluationModal } from '../common/EvaluationModal';
import { AcknowledgmentModal } from '../common/AcknowledgmentModal';
import { FeedbackModal } from '../common/FeedbackModal';
import { TemplateModal } from '../common/TemplateModal';
import { useUiStore } from '../../store/uiStore';
import { getUnconnectedPorts } from '../../utils/portConnectionStatus';
import { evaluationApi } from '../../api/client';
import type { EvaluationResponse } from '../../types/evaluation';
import type { AcknowledgmentFlags, DrawingMetadata } from '../../types';
import { PAPER_SIZES_MM, SHEET_PX_PER_MM, AXIS_WIDTH } from '../../types';


interface ActionPanelProps {
  canvasWidth: number;
  canvasHeight: number;
}

interface ConnectionWarning {
  issues: Array<{ elementId: string; elementName: string; portLabel: string }>;
}

// TODO: replace with the real FormSG link once it's ready.
const BUG_REPORT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// Personal escape hatch for the admin's own testing — visit once with
// ?skipFeedback=1 and it's remembered in this browser via localStorage.
// Does not affect other testers.
function shouldSkipFeedback(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('skipFeedback') === '1') {
    localStorage.setItem('skipFeedback', '1');
    return true;
  }
  return localStorage.getItem('skipFeedback') === '1';
}

export function ActionPanel({ canvasWidth, canvasHeight }: ActionPanelProps) {
  const clearCanvas = useCanvasStore((s) => s.clearCanvas);
  const setActiveTool = useUiStore((s) => s.setActiveTool);
  const exportPdfFn = useUiStore((s) => s.exportPdfFn);
  const openSheetSetup = useUiStore((s) => s.openSheetSetup);
  const sheetConfig = useUiStore((s) => s.sheetConfig);
  const elements = useCanvasStore((s) => s.elements);
  const pipes = useCanvasStore((s) => s.pipes);
  const pdfBackground = useUiStore((s) => s.pdfBackground);
  const setPdfBackground = useUiStore((s) => s.setPdfBackground);
  const updatePdfBackground = useUiStore((s) => s.updatePdfBackground);
  const pdfImportFn = useUiStore((s) => s.pdfImportFn);
  const pdfFileInputRef = useRef<HTMLInputElement>(null);
  const resetTitleBlock = useUiStore((s) => s.resetTitleBlock);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearTitleBlock, setClearTitleBlock] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [connectionWarning, setConnectionWarning] = useState<ConnectionWarning | null>(null);
  const [showAckModal, setShowAckModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalResult, setEvalResult] = useState<EvaluationResponse | null>(null);
  const [evalMetadata, setEvalMetadata] = useState<DrawingMetadata | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const { exportMetadata, getMetadata } = useMetadataExport(canvasWidth, canvasHeight);
  const { openFilePicker: openJsonImport } = useJsonImport();

  const handleClear = () => {
    clearCanvas();
    if (clearTitleBlock) resetTitleBlock();
    setActiveTool('select');
    setConfirmClear(false);
    setClearTitleBlock(false);
  };

  const runExportMetadataFlow = () => {
    const issues = getUnconnectedPorts(elements, pipes);
    if (issues.length > 0) {
      setConnectionWarning({ issues });
    } else {
      exportMetadata();
    }
  };

  const handleExportMetadata = () => {
    if (shouldSkipFeedback()) {
      runExportMetadataFlow();
    } else {
      setShowFeedbackModal(true);
    }
  };

  const handleEvaluateClick = () => {
    setShowAckModal(true);
  };

  const runEvaluation = async (acks: AcknowledgmentFlags) => {
    setEvalError(null);
    setEvalLoading(true);
    try {
      const metadata = getMetadata(acks);
      const formData = new FormData();
      formData.append('metadata_json', JSON.stringify(metadata));
      formData.append('skip_llm', 'true');
      const result = await evaluationApi.evaluate(formData);
      setEvalResult(result);
      setEvalMetadata(metadata);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'Evaluation failed');
    } finally {
      setEvalLoading(false);
    }
  };

  const handleAckConfirm = (acks: AcknowledgmentFlags) => {
    setShowAckModal(false);
    runEvaluation(acks);
  };

  const handleFeedbackSubmit = () => {
    setShowFeedbackModal(false);
    runExportMetadataFlow();
  };

  const hasContent = elements.length > 0 || pipes.length > 0;

  const handlePdfFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      await pdfImportFn?.(file);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'PDF import failed');
    }
  };

  return (
    <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 12, marginTop: 12 }}>

      {/* Sheet Setup */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
          Sheet
        </div>
        <button
          onClick={openSheetSetup}
          style={{
            width: '100%', padding: '7px 12px', border: '1px solid #bbb',
            borderRadius: 6, background: '#fff', color: '#374151',
            cursor: 'pointer', fontSize: 13, textAlign: 'left',
          }}
        >
          {sheetConfig.paperSize} · 1:{sheetConfig.drawingScale} · Sheet Setup
        </button>
      </div>
      <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 12, marginBottom: 12 }} />

      {/* Templates section */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
          Templates
        </div>
        <button
          onClick={() => setShowTemplates(true)}
          style={{
            width: '100%', padding: '7px 12px', border: '1px solid #bbb',
            borderRadius: 6, background: '#fff', color: '#374151',
            cursor: 'pointer', fontSize: 13,
          }}
        >
          Browse Templates
        </button>
      </div>
      <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 12, marginBottom: 12 }} />

      {/* PDF Background section */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
          PDF Background
        </div>
        <button
          onClick={() => pdfFileInputRef.current?.click()}
          style={{
            width: '100%', padding: '7px 12px', border: '1px solid #bbb',
            borderRadius: 6, background: '#fff', color: '#374151',
            cursor: 'pointer', fontSize: 13, marginBottom: 6,
          }}
        >
          {pdfBackground ? 'Replace PDF' : 'Import PDF'}
        </button>
        {pdfBackground && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <button
                onClick={() => {
                  const vw = AXIS_WIDTH + PAPER_SIZES_MM[sheetConfig.paperSize].w * SHEET_PX_PER_MM;
                  const vh = PAPER_SIZES_MM[sheetConfig.paperSize].h * SHEET_PX_PER_MM;
                  const scale = Math.min(vw / pdfBackground.width, vh / pdfBackground.height);
                  updatePdfBackground({
                    x: vw / 2,
                    y: vh / 2,
                    width: pdfBackground.width * scale,
                    height: pdfBackground.height * scale,
                  });
                }}
                title="Scale PDF to fill the canvas (keeps aspect ratio)"
                style={{
                  flex: 1, padding: '6px 0', border: '1px solid #bbb',
                  borderRadius: 6, background: '#fff', color: '#374151',
                  cursor: 'pointer', fontSize: 12,
                }}
              >
                Fit to canvas
              </button>
              <button
                onClick={() => updatePdfBackground({ rotation: (pdfBackground.rotation + 90) % 360 })}
                title="Rotate 90° clockwise"
                style={{
                  flex: 1, padding: '6px 0', border: '1px solid #bbb',
                  borderRadius: 6, background: '#fff', color: '#374151',
                  cursor: 'pointer', fontSize: 12,
                }}
              >
                Rotate 90°
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <button
                onClick={() => updatePdfBackground({ locked: !pdfBackground.locked })}
                title={pdfBackground.locked ? 'Unlock to move/resize' : 'Lock in place'}
                style={{
                  flex: 1, padding: '6px 0', border: '1px solid #bbb',
                  borderRadius: 6, background: pdfBackground.locked ? '#e0f2fe' : '#fff',
                  color: '#374151', cursor: 'pointer', fontSize: 12,
                }}
              >
                {pdfBackground.locked ? 'Unlock' : 'Lock'}
              </button>
              <button
                onClick={() => setPdfBackground(null)}
                title="Remove PDF background"
                style={{
                  flex: 1, padding: '6px 0', border: '1px solid #fca5a5',
                  borderRadius: 6, background: '#fff', color: '#dc2626',
                  cursor: 'pointer', fontSize: 12,
                }}
              >
                Remove
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>Opacity</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={pdfBackground.opacity}
                onChange={(e) => updatePdfBackground({ opacity: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: '#7c3aed' }}
              />
              <span style={{ fontSize: 11, color: '#6b7280', minWidth: 28, textAlign: 'right' }}>
                {Math.round(pdfBackground.opacity * 100)}%
              </span>
            </div>
          </>
        )}
        <input
          ref={pdfFileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          style={{ display: 'none' }}
          onChange={handlePdfFileChange}
        />
      </div>
      <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 12, marginBottom: 8 }} />

      <button
        onClick={handleEvaluateClick}
        disabled={!hasContent || evalLoading}
        style={{
          width: '100%', padding: '9px 12px', border: 'none', borderRadius: 6,
          background: hasContent && !evalLoading ? '#7c3aed' : '#ccc', color: '#fff',
          cursor: hasContent && !evalLoading ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {evalLoading ? 'Evaluating…' : 'Evaluate Schematic'}
      </button>
      {evalError && (
        <div style={{ fontSize: 11, color: '#e53e3e', marginBottom: 8, wordBreak: 'break-word' }}>
          {evalError}
        </div>
      )}
      <button
        onClick={openJsonImport}
        style={{
          width: '100%', padding: '9px 12px', border: '1px solid #0066cc', borderRadius: 6,
          background: 'transparent', color: '#0066cc',
          cursor: 'pointer', fontSize: 13, fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Import Schematic (JSON)
      </button>
      <button
        onClick={handleExportMetadata}
        disabled={!hasContent}
        style={{
          width: '100%', padding: '9px 12px', border: 'none', borderRadius: 6,
          background: hasContent ? '#0066cc' : '#ccc', color: '#fff',
          cursor: hasContent ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Export Metadata (JSON)
      </button>
      <button
        onClick={() => exportPdfFn?.()}
        disabled={!hasContent}
        style={{
          width: '100%', padding: '9px 12px', border: 'none', borderRadius: 6,
          background: hasContent ? '#2d7a4f' : '#ccc', color: '#fff',
          cursor: hasContent ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Export Diagram (PDF)
      </button>
      <button
        onClick={() => setConfirmClear(true)}
        disabled={!hasContent}
        style={{
          width: '100%', padding: '7px 12px', border: `1px solid ${hasContent ? '#e53e3e' : '#ccc'}`,
          borderRadius: 6, background: '#fff', color: hasContent ? '#e53e3e' : '#aaa',
          cursor: hasContent ? 'pointer' : 'not-allowed', fontSize: 13,
        }}
      >
        Clear Canvas
      </button>

      <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 12, marginTop: 12 }} />
      <a
        href={BUG_REPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block', width: '100%', padding: '7px 12px', border: '1px solid #bbb',
          borderRadius: 6, background: '#fff', color: '#374151',
          cursor: 'pointer', fontSize: 13, textAlign: 'center', boxSizing: 'border-box',
          textDecoration: 'none',
        }}
      >
        Report a Bug / Feedback
      </a>

      <ConfirmDialog
        isOpen={confirmClear}
        title="Clear Canvas"
        message="This will remove all elements and pipes from the canvas. This cannot be undone."
        confirmLabel="Clear"
        onConfirm={handleClear}
        onCancel={() => { setConfirmClear(false); setClearTitleBlock(false); }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={clearTitleBlock}
            onChange={(e) => setClearTitleBlock(e.target.checked)}
            style={{ width: 15, height: 15, cursor: 'pointer' }}
          />
          Also reset title block information
        </label>
      </ConfirmDialog>
      {showAckModal && (
        <AcknowledgmentModal
          elements={elements}
          onConfirm={handleAckConfirm}
          onCancel={() => setShowAckModal(false)}
        />
      )}
      {showFeedbackModal && (
        <FeedbackModal onSubmit={handleFeedbackSubmit} onCancel={() => setShowFeedbackModal(false)} />
      )}
      {evalResult && evalMetadata && (
        <EvaluationModal result={evalResult} metadata={evalMetadata} onClose={() => setEvalResult(null)} />
      )}
      {showTemplates && (
        <TemplateModal onClose={() => setShowTemplates(false)} />
      )}

      {/* Unconnected port warning dialog */}
      {connectionWarning && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setConnectionWarning(null)}
        >
          <div
            style={{
              background: '#fff', borderRadius: 10, padding: 24,
              minWidth: 340, maxWidth: 480,
              boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: 15, color: '#b45309' }}>
                Unconnected Ports Detected
              </h3>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: '#555' }}>
              The following ports have no pipe connection. This may cause compliance checks
              to produce incorrect results.
            </p>
            <div style={{
              background: '#fef9c3', border: '1px solid #fde68a',
              borderRadius: 6, padding: '8px 12px', marginBottom: 14,
              maxHeight: 200, overflowY: 'auto',
            }}>
              {connectionWarning.issues.map((issue, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 0',
                  borderBottom: i < connectionWarning.issues.length - 1 ? '1px solid #fde68a' : 'none',
                }}>
                  <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>✗</span>
                  <span style={{ fontSize: 12, color: '#78350f' }}>
                    <strong>{issue.elementName}</strong>
                    {' — '}
                    {issue.portLabel} port
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConnectionWarning(null)}
                style={{
                  padding: '7px 16px', border: '1px solid #ccc', borderRadius: 5,
                  background: '#fff', cursor: 'pointer', fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => { setConnectionWarning(null); exportMetadata(); }}
                style={{
                  padding: '7px 16px', border: 'none', borderRadius: 5,
                  background: '#b45309', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >
                Export Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

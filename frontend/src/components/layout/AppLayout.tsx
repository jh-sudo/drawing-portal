import { useState } from 'react';
import { CanvasPane } from './CanvasPane';
import { ControlPane } from './ControlPane';
import { SheetSetupModal } from '../common/SheetSetupModal';
import { ToastNotification, DcvToastNotification } from '../common/ToastNotification';
import { useUiStore } from '../../store/uiStore';

export function AppLayout() {
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const activeTool = useUiStore((s) => s.activeTool);
  const sheetSetupOpen = useUiStore((s) => s.sheetSetupOpen);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Singapore Government masthead (SGDS web component, registered in main.tsx) */}
      <sgds-masthead style={{ flexShrink: 0 }} />

      {/* Header */}
      <div style={{
        height: 48, background: '#1a3a5c', color: '#fff',
        display: 'flex', alignItems: 'center', paddingLeft: 20, gap: 16,
        flexShrink: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.03em' }}>
          Schematic Drawing Portal
        </span>
        {(activeTool === 'pipe' || activeTool === 'cold_pipe' || activeTool === 'hot_pipe') && (
          <span style={{
            fontSize: 11,
            background: activeTool === 'hot_pipe' ? '#e63329' : '#007bff',
            color: '#fff',
            padding: '2px 8px',
            borderRadius: 12,
            fontWeight: 600,
          }}>
            {activeTool === 'cold_pipe'
              ? 'COLD PIPE — Click two points · H/V only · Esc to cancel'
              : activeTool === 'hot_pipe'
              ? 'HOT PIPE — Click two points · H/V only · Esc to cancel'
              : 'PIPE MODE — Click canvas to place points · Esc to cancel'}
          </span>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <CanvasPane
          onSizeChange={(w, h) => setCanvasSize({ width: w, height: h })}
        />
        <ControlPane canvasWidth={canvasSize.width} canvasHeight={canvasSize.height} />
      </div>

      {sheetSetupOpen && <SheetSetupModal />}
      <ToastNotification />
      <DcvToastNotification />
    </div>
  );
}

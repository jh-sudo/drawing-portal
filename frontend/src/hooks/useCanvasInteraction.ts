import { useState, useCallback, useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { useCanvasStore } from '../store/canvasStore';
import { PipeElement, PipeType, isBackflowRiskElement } from '../types';
import { findNearestPort } from '../utils/symbolPorts';

const PORT_SNAP_THRESHOLD = 4; // px — user clicks near a port dot to connect
const PORT_ALIGN_TOLERANCE = 1; // px — a port must already share the anchor's x or y to be used directly; otherwise connecting to it would draw a diagonal pipe

type PipeDrawState = 'idle' | 'waiting_first' | 'waiting_second';

function activeToPipeType(activeTool: string): PipeType {
  if (activeTool === 'cold_pipe') return 'cold';
  if (activeTool === 'hot_pipe') return 'hot';
  return 'generic';
}

function snapToAxis(
  x: number,
  y: number,
  anchorX: number,
  anchorY: number
): { x: number; y: number } {
  const dx = Math.abs(x - anchorX);
  const dy = Math.abs(y - anchorY);
  return dx >= dy ? { x, y: anchorY } : { x: anchorX, y };
}

export function useCanvasInteraction() {
  const activeTool = useUiStore((s) => s.activeTool);
  const setActiveTool = useUiStore((s) => s.setActiveTool);
  const pipeColorDefaults = useUiStore((s) => s.pipeColorDefaults);
  const addPipe = useCanvasStore((s) => s.addPipe);
  const setSelected = useCanvasStore((s) => s.setSelected);

  const [drawState, setDrawState] = useState<PipeDrawState>('idle');
  const [anchorPoint, setAnchorPoint] = useState<{ x: number; y: number } | null>(null);
  const [anchorPortRef, setAnchorPortRef] = useState<{ elementId: string; portIndex: number } | null>(null);
  const [previewEnd, setPreviewEnd] = useState<{ x: number; y: number } | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  const isPipeTool =
    activeTool === 'pipe' || activeTool === 'cold_pipe' || activeTool === 'hot_pipe';
  const isColdOrHot = activeTool === 'cold_pipe' || activeTool === 'hot_pipe';

  // Track Shift key for generic pipe H/V snap
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setShiftHeld(e.shiftKey);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  // Reset state when switching away from pipe tools
  useEffect(() => {
    if (!isPipeTool) {
      setDrawState('idle');
      setAnchorPoint(null);
      setAnchorPortRef(null);
      setPreviewEnd(null);
    } else {
      setDrawState('waiting_first');
    }
  }, [activeTool, isPipeTool]);

  // Escape cancels pipe drawing
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPipeTool) {
        setActiveTool('select');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPipeTool, setActiveTool]);

  const applyConstraint = useCallback(
    (x: number, y: number): { x: number; y: number } => {
      if (!anchorPoint) return { x, y };
      // Cold/hot pipes always H/V; generic pipe only when Shift is held
      if (isColdOrHot || shiftHeld) {
        return snapToAxis(x, y, anchorPoint.x, anchorPoint.y);
      }
      return { x, y };
    },
    [anchorPoint, isColdOrHot, shiftHeld]
  );

  const handleCanvasClick = useCallback(
    (rawX: number, rawY: number) => {
      if (!isPipeTool) return;

      // Snap to a port if the click is close enough.
      // For typed pipes, also search the matching-label port within a larger
      // radius — but it only wins the tie when at least as close as the
      // nearest generic port, so it never steals a click that's clearly on a
      // different, nearer port (see findNearestPort's docstring).
      const elements = useCanvasStore.getState().elements;
      const pipeType = activeToPipeType(activeTool);
      const preferLabel = pipeType === 'cold' ? 'Cold' : pipeType === 'hot' ? 'Hot' : undefined;
      const nearPort = findNearestPort(rawX, rawY, elements, PORT_SNAP_THRESHOLD, preferLabel);
      const x = nearPort ? nearPort.x : rawX;
      const y = nearPort ? nearPort.y : rawY;

      if (drawState === 'waiting_first') {
        setAnchorPoint({ x, y });
        setAnchorPortRef(nearPort ? { elementId: nearPort.elementId, portIndex: nearPort.portIndex } : null);
        setPreviewEnd({ x, y });
        setDrawState('waiting_second');
      } else if (drawState === 'waiting_second' && anchorPoint) {
        // A port snap is only honoured if it already shares the anchor's x or y —
        // using its exact position otherwise would draw a diagonal pipe. A
        // misaligned port is treated as an ordinary click (H/V-constrained), so
        // the pipe stops short of it instead of cutting a diagonal line across.
        const portAligned =
          !!nearPort &&
          (Math.abs(nearPort.x - anchorPoint.x) < PORT_ALIGN_TOLERANCE ||
            Math.abs(nearPort.y - anchorPoint.y) < PORT_ALIGN_TOLERANCE);
        const usablePort = portAligned ? nearPort : null;
        const end = usablePort ? { x: usablePort.x, y: usablePort.y } : applyConstraint(rawX, rawY);
        const pipeType = activeToPipeType(activeTool);
        const pipe: PipeElement = {
          id: crypto.randomUUID(),
          pipeType,
          startX: anchorPoint.x,
          startY: anchorPoint.y,
          endX: end.x,
          endY: end.y,
          startElementId: anchorPortRef?.elementId,
          startPortIndex: anchorPortRef?.portIndex,
          endElementId: usablePort?.elementId,
          endPortIndex: usablePort?.portIndex,
          customColor: pipeColorDefaults[pipeType],
        };
        addPipe(pipe);
        setSelected(pipe.id);

        // Offer DCV insertion if the pipe endpoint snapped to a backflow-risk element's upstream port
        if (usablePort && usablePort.role === 'upstream') {
          const snappedEl = elements.find((e) => e.id === usablePort.elementId);
          if (snappedEl && isBackflowRiskElement(snappedEl)) {
            useUiStore.getState().showDcvToast(snappedEl.id, snappedEl.x, snappedEl.y, pipe.id);
          }
        }

        // Resume chaining immediately from the end point
        setAnchorPoint(end);
        setAnchorPortRef(usablePort ? { elementId: usablePort.elementId, portIndex: usablePort.portIndex } : null);
        setPreviewEnd(end);
        setDrawState('waiting_second');
      }
    },
    [isPipeTool, drawState, anchorPoint, anchorPortRef, applyConstraint, addPipe, activeTool, pipeColorDefaults]
  );

  const handleCanvasMouseMove = useCallback(
    (x: number, y: number) => {
      if (drawState === 'waiting_second') {
        setPreviewEnd(applyConstraint(x, y));
      }
    },
    [drawState, applyConstraint]
  );

  // Re-arms the pipe tool's chaining state from an external point (e.g. the
  // outlet port of a fitting just placed mid-chain) so the next canvas click
  // continues the run without the user re-clicking the pipe tool.
  const resumeChainFrom = useCallback(
    (x: number, y: number, portRef?: { elementId: string; portIndex: number }) => {
      if (!isPipeTool) return;
      setAnchorPoint({ x, y });
      setAnchorPortRef(portRef ?? null);
      setPreviewEnd({ x, y });
      setDrawState('waiting_second');
    },
    [isPipeTool]
  );

  return {
    isDrawingPipe: isPipeTool,
    drawState,
    anchorPoint,
    previewEnd,
    handleCanvasClick,
    handleCanvasMouseMove,
    resumeChainFrom,
  };
}

import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Rect as KonvaRect } from 'react-konva';
import Konva from 'konva';
import { GridLayer } from './GridLayer';
import { TitleBlockLayer } from './TitleBlockLayer';
import { LpPeStampLayer } from './LpPeStampLayer';
import { ElementsLayer } from './ElementsLayer';
import { AnnotationsLayer } from './AnnotationsLayer';
import { AnnotationContextMenu } from './AnnotationContextMenu';
import { MirrorContextMenu } from './MirrorContextMenu';
import { PipeDraftLayer } from './PipeDraftLayer';
import { RotationPanel } from './RotationPanel';
import { TeeJunctionPortDialog } from './TeeJunctionPortDialog';
import { ElbowBendPortDialog } from './ElbowBendPortDialog';
import { FlipOrientationDialog } from './FlipOrientationDialog';
import { HighestFittingValueDialog } from './HighestFittingValueDialog';
import { LongBathPanel } from './LongBathPanel';
import { SymbolPropertiesModal } from './SymbolPropertiesModal';
import { PdfBackgroundLayer } from './PdfBackgroundLayer';
import { WaterTankPropertiesModal } from './WaterTankPropertiesModal';
import { useUiStore } from '../../store/uiStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useCanvasInteraction } from '../../hooks/useCanvasInteraction';
import { useClampToViewport } from '../../hooks/useClampToViewport';
import { CanvasElement, PipeElement as PipeElementType, ROTATABLE_SYMBOL_IDS, FLIP_ONLY_SYMBOL_IDS, PAPER_SIZES_MM, SHEET_PX_PER_MM, SCHEMATIC_SYMBOL_PX, AXIS_WIDTH, TITLE_BLOCK_MM, getSymbolSizePx, FIXTURE_MWELS_CATEGORY, isBackflowRiskElement } from '../../types';
import { symbolsApi } from '../../api/client';
import { closestPointOnSegment, distance } from '../../utils/geometry';
import { inferFluidAtPoint } from '../../utils/fluidInference';
import { SYMBOL_PORTS, rotateOffset, getScaledPortOffset, getPortPosition, getEffectivePortRole, getElementPorts, DUAL_SUPPLY_SYMBOLS } from '../../utils/symbolPorts';
import { renderPdfPageToDataUrl } from '../../utils/pdfRenderer';
import { exportSchematicToPdf } from '../../utils/pdfVectorExport';

const SNAP_THRESHOLD = 4;
const SNAP_T_MIN = 0.02;
const SNAP_T_MAX = 0.98;

// Canvas content dimensions are fixed to the selected paper size (Option B: paper drives everything)
const MAX_SCALE = 12.0;
const SCALE_STEP = 0.25;
// At "100%" zoom the page occupies this fraction of the viewport, leaving grey margins on all sides
const FIT_PAD = 0.92;

// Symbols where the pipe passes straight through inlet → outlet (split at both ports)
const INLINE_SYMBOL_IDS = new Set([
  'gate_valve', 'check_valve', 'pump', 'flow_meter', 'water_heater', 'instantaneous_water_heater', 'water_meter',
  // new inline valves & equipment
  'solenoid_valve', 'motorised_valve', 'globe_valve', 'prv_with_sensor',
  'sub_meter', 'cold_water_tank',
  'pressure_gauge_cock', 'pressure_gauge_prv', 'sight_glass', 'strainer',
  'multiport_valve',
  // section 6 inline
  'vacuum_breaker', 'pressure_relief_valve',
  // new equipment
  'y_type_strainer', 'flexible_connection', 'puddle_flange',
]);
// Symbols where the pipe terminates at the connection port (no pipe continues through)
const TERMINAL_SYMBOL_IDS = new Set([
  'water_tank',
  // fixtures
  'single_tap', 'single_tap_combined', 'twin_tap', 'shower_head',
  'long_bath', 'shower_bath',
  'drinking_fountain_pedestal', 'drinking_fountain_trough', 'drinking_fountain_wall',
  'water_closet', 'urinal_wall',
  // terminal valves & equipment (single upstream port)
  'cap_off_valve', 'pipe_blank_off',
  'auto_air_relief_valve', 'water_hammer_absorber',
  'pressure_vessel_schematic', 'water_tank_air_vent',
  'vortex_inhibitor_schematic', 'tap_point_schematic', 'ball_float_valve', 'sampling_tap',
  // section 6 terminal fixtures
  'bidet_spray',
  // SS636 §6.4 backflow-risk appliances
  'washing_machine', 'dishwasher', 'water_dispenser',
  // new fixtures
  'foot_bath', 'multiple_show_unit', 'square_bath', 'sink', 'wash_basin_rectangular',
  'bib_tap_cw_cap_and_lock_schematic',
]);

// Symbols that open the generic SymbolPropertiesModal (dual-supply fixtures, MWELS
// fittings, and pumps). water_tank/long_bath have their own dedicated modals and are
// checked separately at each call site.
function isModalEligibleSymbol(symbolId: string): boolean {
  return DUAL_SUPPLY_SYMBOLS.has(symbolId) || symbolId in FIXTURE_MWELS_CATEGORY || symbolId === 'pump';
}

/**
 * Infers what fluid type (cold/hot) flows through a given pipe.
 * For cold/hot pipes the answer is direct. For generic pipes the function looks
 * for an upstream element (one whose downstream port touches either pipe endpoint)
 * and returns that element's carriesFluid value, enabling series propagation.
 */

function getInlinePortPositions(el: CanvasElement) {
  const ports = SYMBOL_PORTS[el.symbolId] ?? [];
  const inletPort  = ports.find((p) => p.role === 'upstream');
  const outletPort = ports.find((p) => p.role === 'downstream');
  return {
    inletPos:  inletPort  ? getPortPosition(el, inletPort)  : { x: el.x, y: el.y },
    outletPos: outletPort ? getPortPosition(el, outletPort) : { x: el.x, y: el.y },
  };
}

interface DrawingCanvasProps {
  onSizeChange?: (width: number, height: number) => void;
}

export function DrawingCanvas({ onSizeChange }: DrawingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1600, height: 600 });
  // Tracks the last known mouse position in canvas content coordinates for paste-at-cursor
  const lastMouseCanvasPosRef = useRef<{ x: number; y: number } | null>(null);

  // Virtual canvas scroll/zoom state
  const [stageOffsetY, setStageOffsetY] = useState(0); // viewport px scrolled
  const [stageOffsetX, setStageOffsetX] = useState(0);
  const [stageScale, setStageScale] = useState(1.0);
  // The scale at which the full sheet fits the viewport — defined as "100%" and the minimum zoom
  const [baseScale, setBaseScale] = useState(1.0);
  const baseScaleRef = useRef(1.0);
  baseScaleRef.current = baseScale;
  // Always-fresh refs so the wheel handler can read current values without stale closures
  const stageOffsetXRef = useRef(0);
  const stageOffsetYRef = useRef(0);
  const stageScaleRef   = useRef(1.0);
  stageOffsetXRef.current = stageOffsetX;
  stageOffsetYRef.current = stageOffsetY;
  stageScaleRef.current   = stageScale;
  const scrollbarDragRef = useRef<{ startY: number; startOffset: number } | null>(null);
  const horizontalScrollbarDragRef = useRef<{startX: number; startOffset: number;} | null>(null);

  // sheetConfig must be read before the derived canvas dimensions below
  const sheetConfig = useUiStore((s) => s.sheetConfig);

  // Content dimensions are fixed to the selected paper size — independent of viewport
  const virtualHeight = PAPER_SIZES_MM[sheetConfig.paperSize].h * SHEET_PX_PER_MM;
  const virtualWidth  = AXIS_WIDTH + PAPER_SIZES_MM[sheetConfig.paperSize].w * SHEET_PX_PER_MM + TITLE_BLOCK_MM * SHEET_PX_PER_MM;
  // Stable refs so the one-time ResizeObserver callback can read the latest values
  const virtualHeightRef = useRef(virtualHeight);
  const virtualWidthRef  = useRef(virtualWidth);
  virtualHeightRef.current = virtualHeight;
  virtualWidthRef.current  = virtualWidth;
  const maxOffset  = Math.max(0, virtualHeight * stageScale - canvasSize.height);
  const maxOffsetX = Math.max(0, virtualWidth  * stageScale - canvasSize.width);

  const horizontalThumbWidth =
    maxOffsetX > 0
      ? Math.max(40, (canvasSize.width / (virtualWidth * stageScale)) * canvasSize.width)
      : canvasSize.width;

  const horizontalThumbLeft =
    maxOffsetX > 0
      ? (stageOffsetX / maxOffsetX) * (canvasSize.width - horizontalThumbWidth)
      : 0;

  // Fit-to-screen — returns to the base (100%) scale with the full sheet visible + grey margins
  const fitToScreen = useCallback(() => {
    const fitScale = Math.min(MAX_SCALE, Math.min(
      canvasSize.width  / virtualWidth,
      canvasSize.height / virtualHeight,
    )) * FIT_PAD;
    const offsetX = -(canvasSize.width  - virtualWidth  * fitScale) / 2;
    const offsetY = -(canvasSize.height - virtualHeight * fitScale) / 2;
    setBaseScale(fitScale);
    setStageScale(fitScale);
    setStageOffsetX(offsetX);
    setStageOffsetY(offsetY);
  }, [canvasSize.width, canvasSize.height, virtualWidth, virtualHeight]);

  // Zoom helper — keeps viewport centre fixed in content space
  const zoom = useCallback((delta: number) => {
    setStageScale((prevScale) => {
      // Read via ref, not the closed-over `baseScale` state — fitToScreen() can
      // change baseScale without changing canvasSize/virtualHeight, which would
      // otherwise leave this callback's memoized closure clamping against a
      // stale value (the wheel-zoom handler already does this correctly).
      const newScale = Math.max(baseScaleRef.current, Math.min(MAX_SCALE, prevScale + delta));
      if (newScale === prevScale) return prevScale;
      setStageOffsetY((prevOffset) => {
        const vp = canvasSize.height;
        const contentCenterY = (prevOffset + vp / 2) / prevScale;
        const newOffset = contentCenterY * newScale - vp / 2;
        const pageH = virtualHeight * newScale;
        const minOfs = pageH < vp ? -(vp - pageH) / 2 : 0;
        return Math.max(minOfs, Math.min(newOffset, Math.max(0, pageH - vp)));
      });
      return newScale;
    });
  }, [canvasSize.height, virtualHeight]);

  // Convert virtual canvas (content) coords to viewport px (for overlay panels)
  const contentToViewport = useCallback(
    (cx: number, cy: number) => ({
      x: cx * stageScale - stageOffsetX,
      y: cy * stageScale - stageOffsetY,
    }),
    [stageScale, stageOffsetX, stageOffsetY]
  );

  // PDF background — state lives in uiStore; DrawingCanvas registers the import handler
  // because it needs access to the current viewport/zoom state for initial placement.
  const pdfBackground = useUiStore((s) => s.pdfBackground);
  const setPdfBackground = useUiStore((s) => s.setPdfBackground);
  const updatePdfBackground = useUiStore((s) => s.updatePdfBackground);
  const registerPdfImport = useUiStore((s) => s.registerPdfImport);

  useEffect(() => {
    const handler = async (file: File) => {
      try {
        const { dataUrl, naturalWidth, naturalHeight } = await renderPdfPageToDataUrl(file);
        const viewportContentW = canvasSize.width / stageScale;
        const viewportContentH = canvasSize.height / stageScale;
        const targetW = viewportContentW * 0.9;
        const targetH = (naturalHeight / naturalWidth) * targetW;
        // x, y are the CENTER of the image in content coords
        const cx = stageOffsetX / stageScale + viewportContentW / 2;
        const cy = stageOffsetY / stageScale + viewportContentH / 2;
        setPdfBackground({ dataUrl, x: cx, y: cy, width: targetW, height: targetH, rotation: 0, locked: false, opacity: 0.4 });
      } catch (err) {
        console.error('PDF import failed:', err);
        alert('Could not read the PDF. Please try a different file.');
      }
    };
    registerPdfImport(handler);
  }, [canvasSize, stageScale, stageOffsetX, stageOffsetY, setPdfBackground, registerPdfImport]);

  const mrlConfig          = useUiStore((s) => s.mrlConfig);
  const floorLevels        = useUiStore((s) => s.floorLevels);
  const floorLevelOpacity  = useUiStore((s) => s.floorLevelOpacity);
  const activeTool  = useUiStore((s) => s.activeTool);
  const draggingSymbolId = useUiStore((s) => s.draggingSymbolId);
  const setDraggingSymbolId = useUiStore((s) => s.setDraggingSymbolId);
  const pendingSymbol = useUiStore((s) => s.pendingSymbol);
  const setPendingSymbol = useUiStore((s) => s.setPendingSymbol);
  const pendingTemplate = useUiStore((s) => s.pendingTemplate);
  const setPendingTemplate = useUiStore((s) => s.setPendingTemplate);
  const registerExportPdf = useUiStore((s) => s.registerExportPdf);
  const registerCaptureStageRegion = useUiStore((s) => s.registerCaptureStageRegion);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const showBidetToast = useUiStore((s) => s.showBidetToast);
  const showDcvToast   = useUiStore((s) => s.showDcvToast);

  const [dragOverPos, setDragOverPos] = useState<{ x: number; y: number } | null>(null);

  // Rubber band (marquee) selection state
  const [rubberAnchor, setRubberAnchor] = useState<{ x: number; y: number } | null>(null);
  const [rubberCurrent, setRubberCurrent] = useState<{ x: number; y: number } | null>(null);
  const rubberDraggedRef = useRef(false);
  // Refs mirror anchor/current so event handlers always see the latest value
  // without depending on potentially-stale React state closures.
  const rubberAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const rubberCurrentRef = useRef<{ x: number; y: number } | null>(null);

  const rubberBandRect = rubberAnchor && rubberCurrent ? {
    x: Math.min(rubberAnchor.x, rubberCurrent.x),
    y: Math.min(rubberAnchor.y, rubberCurrent.y),
    width: Math.abs(rubberCurrent.x - rubberAnchor.x),
    height: Math.abs(rubberCurrent.y - rubberAnchor.y),
  } : null;

  // Pending tee junction: element + optional pipe snap, awaiting port selection
  const [pendingTee, setPendingTee] = useState<{
    element: CanvasElement;
    pipeId: string;
    snapX: number;
    snapY: number;
    elX: number;
    elY: number;
    snapped: boolean;
  } | null>(null);
  const teeConfirmedRef = useRef(false);

  // Pending elbow bend: awaiting inlet port selection
  const [pendingElbow, setPendingElbow] = useState<{
    element: CanvasElement;
    pipeId: string;
    snapX: number;
    snapY: number;
    elX: number;
    elY: number;
    snapped: boolean;
  } | null>(null);

  // Pending flip-only symbol: awaiting orientation selection
  const [pendingFlip, setPendingFlip] = useState<{
    element: CanvasElement;
    pipeId: string;
    snapX: number;
    snapY: number;
    snapped: boolean;
  } | null>(null);

  // Highest Direct Supply Fitting: element awaiting its elevation value right after
  // placement (mirrors pendingFlip — nothing is added to canvasStore until confirmed).
  const [pendingHighestFitting, setPendingHighestFitting] = useState<CanvasElement | null>(null);
  // ...or the id of an already-placed one being re-edited (double-click).
  const [highestFittingEditId, setHighestFittingEditId] = useState<string | null>(null);

  // Water tank: id of the tank whose properties modal is open
  const [tankModalId, setTankModalId] = useState<string | null>(null);
  const [symbolPropertiesModalId, setSymbolPropertiesModalId] = useState<string | null>(null);
  const [longBathPanelId, setLongBathPanelId] = useState<string | null>(null);
  const tankModalOpenRef = useRef(false);
  tankModalOpenRef.current = !!tankModalId;

  const setSelected = useCanvasStore((s) => s.setSelected);
  const setSelectedIds = useCanvasStore((s) => s.setSelectedIds);
  const appendTemplate = useCanvasStore((s) => s.appendTemplate);
  const setMultiSelection = useCanvasStore((s) => s.setMultiSelection);
  const addElement = useCanvasStore((s) => s.addElement);
  const insertElementOnPipe = useCanvasStore((s) => s.insertElementOnPipe);
  const insertElementOnPipeInline = useCanvasStore((s) => s.insertElementOnPipeInline);
  const addAnnotation = useCanvasStore((s) => s.addAnnotation);
  const removeAnnotation = useCanvasStore((s) => s.removeAnnotation);
  const updateAnnotation = useCanvasStore((s) => s.updateAnnotation);
  const mirrorSelection = useCanvasStore((s) => s.mirrorSelection);
  const updateHighestFittingElevation = useCanvasStore((s) => s.updateHighestFittingElevation);

  // Right-click context menu — 'annotation' when nothing selected, 'mirror' when multi-selected
  const [contextMenu, setContextMenu] = useState<{
    type: 'annotation' | 'mirror';
    viewportX: number;
    viewportY: number;
    contentX: number;
    contentY: number;
  } | null>(null);

  const [editingAnnotation, setEditingAnnotation] = useState<{
    id: string;
    text: string;
    screenX: number;
    screenY: number;
    fontSize: number;
    maxWidth: number;
    height: number;
  } | null>(null);
  const cancelEditRef = useRef(false);
  const editingAnnotationRawLeft = editingAnnotation ? editingAnnotation.screenX - 4.5 * stageScale : 0;
  const editingAnnotationRawTop = editingAnnotation ? editingAnnotation.screenY - 4.5 * stageScale : 0;
  const { ref: editingAnnotationRef, left: editingAnnotationLeft, top: editingAnnotationTop } =
    useClampToViewport<HTMLTextAreaElement>(editingAnnotationRawLeft, editingAnnotationRawTop, { bounds: 'window' });

  // Register PDF export — walks the canvas/UI store data directly and emits native PDF
  // vector commands (lines, text, SVG-derived symbol paths) instead of rasterizing the stage.
  useEffect(() => {
    registerExportPdf(() => {
      exportSchematicToPdf(virtualWidth, virtualHeight).catch((err) => {
        console.error('PDF export failed:', err);
      });
    });
  }, [registerExportPdf, virtualWidth, virtualHeight]);

  // Register per-region schematic capture for the compliance-report Word export. Rather
  // than rasterizing the whole sheet once and cropping a tiny raster region out of it
  // (which left every symbol crop looking upscaled and blurry — schematic symbols render
  // at a fixed 6px logical size regardless of drawing scale, so the whole sheet is only
  // ~1000px wide), each compliance issue gets its own small crop captured DIRECTLY at a
  // high pixelRatio targeted just at that region. Konva re-renders the actual vector
  // shapes fresh on every toDataURL() call, so a tiny region at a high pixelRatio is
  // genuinely crisp — not an upscaled raster. The Stage still needs to be temporarily
  // reset to its full untransformed size (scale 1, origin 0,0, width/height = the full
  // virtual sheet) first, since Konva only rasterizes what's within the Stage's current
  // width/height into each Layer's buffer before a sub-region can be read out of it — the
  // reset/restore happens synchronously around the toDataURL call so there's no visible
  // flicker of the live viewport.
  useEffect(() => {
    registerCaptureStageRegion((region, pixelRatio = 12) => {
      const stage = stageRef.current;
      if (!stage) return null;
      const prevScale = stage.scale();
      const prevPos = stage.position();
      const prevSize = { width: stage.width(), height: stage.height() };
      try {
        stage.size({ width: virtualWidth, height: virtualHeight });
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        stage.batchDraw();
        return stage.toDataURL({
          x: region.x, y: region.y, width: region.width, height: region.height,
          pixelRatio, mimeType: 'image/jpeg', quality: 0.92,
        });
      } finally {
        stage.size(prevSize);
        stage.scale(prevScale ?? { x: 1, y: 1 });
        stage.position(prevPos ?? { x: 0, y: 0 });
        stage.batchDraw();
      }
    });
  }, [registerCaptureStageRegion, virtualWidth, virtualHeight]);

  // Delete selected element or pipe with Delete/Backspace key; Escape clears pending placement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        useUiStore.getState().setPendingSymbol(null);
        useUiStore.getState().setPendingTemplate(null);
        useCanvasStore.getState().setSelectedIds([]);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        useCanvasStore.getState().undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        useCanvasStore.getState().redo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        useCanvasStore.getState().copySelection();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        useCanvasStore.getState().pasteClipboard(lastMouseCanvasPosRef.current ?? undefined);
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const { selectedId, selectedIds, selectedPipeIds, selectedAnnotationIds, elements, pipes, removeMultiple, removeElement, removePipe, removeAnnotation } = useCanvasStore.getState();
      // Multi-select delete — one history entry, one state update
      if (selectedIds.length > 0 || selectedPipeIds.length > 0 || selectedAnnotationIds.length > 0) {
        removeMultiple(selectedIds, selectedPipeIds, selectedAnnotationIds);
        return;
      }
      if (!selectedId) return;
      if (elements.some((el) => el.id === selectedId)) removeElement(selectedId);
      else if (pipes.some((p) => p.id === selectedId)) removePipe(selectedId);
      else removeAnnotation(selectedId);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Only show rotation panel for rotatable symbols when selected
  const selectedRotatable = useCanvasStore((s) => {
    const el = s.elements.find((e) => e.id === s.selectedId);
    return el && (ROTATABLE_SYMBOL_IDS as readonly string[]).includes(el.symbolId) ? el : null;
  });

  // Show long bath panel when double-clicked
  const longBathElement = useCanvasStore((s) =>
    s.elements.find((e) => e.id === longBathPanelId && e.symbolId === 'long_bath') ?? null
  );

  const {
    isDrawingPipe,
    drawState,
    anchorPoint,
    previewEnd,
    handleCanvasClick,
    handleCanvasMouseMove,
    resumeChainFrom,
  } = useCanvasInteraction();

  // If a fitting is placed at the current chain tip while a pipe is mid-draw,
  // resume the chain from the fitting's outlet port so the user doesn't have
  // to re-click the pipe tool to continue past it. Gated to placements near
  // the tip so an unrelated drag-and-drop elsewhere on the canvas doesn't
  // yank the dangling pipe preview over to it.
  const RESUME_PROXIMITY_PX = 60;
  const maybeResumePipeChain = useCallback(
    (placedEl: CanvasElement, placedAtX: number, placedAtY: number) => {
      if (!isDrawingPipe || drawState !== 'waiting_second' || !anchorPoint) return;
      if (Math.hypot(placedAtX - anchorPoint.x, placedAtY - anchorPoint.y) > RESUME_PROXIMITY_PX) return;
      const ports = getElementPorts(placedEl);
      const downstreamIndex = ports.findIndex((_, i) => getEffectivePortRole(placedEl, i) === 'downstream');
      if (downstreamIndex === -1) return;
      const pos = getPortPosition(placedEl, ports[downstreamIndex]);
      resumeChainFrom(pos.x, pos.y, { elementId: placedEl.id, portIndex: downstreamIndex });
    },
    [isDrawingPipe, drawState, anchorPoint, resumeChainFrom]
  );

  // Responsive sizing — tracks viewport dimensions only; auto-fits on first measurement
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let hasFit = false;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const w = Math.max(width, 400);
      const h = Math.max(height, 400);
      setCanvasSize({ width: w, height: h });
      if (!hasFit) {
        hasFit = true;
        const fitScale = Math.min(MAX_SCALE, Math.min(
          w / virtualWidthRef.current,
          h / virtualHeightRef.current,
        )) * FIT_PAD;
        const offsetX = -(w - virtualWidthRef.current  * fitScale) / 2;
        const offsetY = -(h - virtualHeightRef.current * fitScale) / 2;
        setBaseScale(fitScale);
        setStageScale(fitScale);
        setStageOffsetX(offsetX);
        setStageOffsetY(offsetY);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep a stable ref to onSizeChange so the effect below doesn't re-run on every render
  const onSizeChangeRef = useRef(onSizeChange);
  onSizeChangeRef.current = onSizeChange;

  // Report paper-based content dimensions whenever sheet config changes
  useEffect(() => {
    onSizeChangeRef.current?.(virtualWidth, virtualHeight);
  }, [virtualWidth, virtualHeight]);

  // Re-fit to screen when sheet config changes (new paper size or scale)
  // Skip the very first render — the ResizeObserver handles the initial fit
  const isFirstSheetEffect = useRef(true);
  useEffect(() => {
    if (isFirstSheetEffect.current) { isFirstSheetEffect.current = false; return; }
    const fitScale = Math.min(MAX_SCALE, Math.min(
      canvasSize.width  / virtualWidth,
      canvasSize.height / virtualHeight,
    )) * FIT_PAD;
    const offsetX = -(canvasSize.width  - virtualWidth  * fitScale) / 2;
    const offsetY = -(canvasSize.height - virtualHeight * fitScale) / 2;
    setBaseScale(fitScale);
    setStageScale(fitScale);
    setStageOffsetX(offsetX);
    setStageOffsetY(offsetY);
  }, [virtualWidth, virtualHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prevent browser page zoom on Ctrl+scroll — canvas should be the only thing that zooms
  useEffect(() => {
    const prevent = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    window.addEventListener('wheel', prevent, { passive: false });
    return () => window.removeEventListener('wheel', prevent);
  }, []);

  // Wheel scroll — must be non-passive to call preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      setEditingAnnotation(null);
      if (tankModalOpenRef.current) return;
      e.preventDefault();

      // Ctrl+scroll → zoom centred on cursor
      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;   // cursor in viewport px
        const py = e.clientY - rect.top;
        const prevScale  = stageScaleRef.current;
        const prevOfsX   = stageOffsetXRef.current;
        const prevOfsY   = stageOffsetYRef.current;
        const scaleFactor = Math.pow(0.999, e.deltaY);
        const newScale = Math.max(baseScaleRef.current, Math.min(MAX_SCALE, prevScale * scaleFactor));
        if (newScale === prevScale) return;
        // Content point under cursor must stay fixed
        const contentX = (px + prevOfsX) / prevScale;
        const contentY = (py + prevOfsY) / prevScale;
        setStageScale(newScale);
        const pageW = virtualWidth  * newScale;
        const pageH = virtualHeight * newScale;
        const minX = pageW < canvasSize.width  ? -(canvasSize.width  - pageW) / 2 : 0;
        const minY = pageH < canvasSize.height ? -(canvasSize.height - pageH) / 2 : 0;
        setStageOffsetX(Math.max(minX, Math.min(contentX * newScale - px, Math.max(0, pageW - canvasSize.width))));
        setStageOffsetY(Math.max(minY, Math.min(contentY * newScale - py, Math.max(0, pageH - canvasSize.height))));
        return;
      }

      // Detect horizontal vs vertical scrolling
      const deltaX = e.shiftKey ? e.deltaY : e.deltaX;
      const deltaY = e.shiftKey ? 0 : e.deltaY;

      // Horizontal scroll
      setStageOffsetX((prev) => {
        const pageW = virtualWidth * stageScale;
        const minOfs = pageW < canvasSize.width ? -(canvasSize.width - pageW) / 2 : 0;
        return Math.max(minOfs, Math.min(prev + deltaX, Math.max(0, pageW - canvasSize.width)));
      });

      // Vertical scroll
      setStageOffsetY((prev) => {
        const pageH = virtualHeight * stageScale;
        const minOfs = pageH < canvasSize.height ? -(canvasSize.height - pageH) / 2 : 0;
        return Math.max(minOfs, Math.min(prev + deltaY, Math.max(0, pageH - canvasSize.height)));
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasSize.width, canvasSize.height, stageScale, virtualWidth, virtualHeight]);

  const getCursor = () => {
    if (isDrawingPipe) return 'crosshair';
    return 'default';
  };

  const getCanvasPos = useCallback(
    (clientX: number, clientY: number) => {
      if (!stageRef.current) return null;
      const stageBox = stageRef.current.container().getBoundingClientRect();
      const rawX = clientX - stageBox.left;
      const rawY = clientY - stageBox.top;
      // Convert viewport px → virtual canvas content coordinates
      const contentX = (rawX + stageOffsetX) / stageScale;
      const contentY = (rawY + stageOffsetY) / stageScale;
      const symPx = getSymbolSizePx(sheetConfig.drawingScale);
      return {
        x: Math.max(AXIS_WIDTH + symPx / 2, contentX),
        y: Math.max(symPx / 2, Math.min(contentY, virtualHeight - symPx / 2)),
      };
    },
    [stageScale, stageOffsetX, stageOffsetY, virtualHeight]
  );

  // Open properties modal on double-click
  const handleElementClick = useCallback((_id: string, symbolId: string) => {
    if (symbolId === 'water_tank') {
      setSymbolPropertiesModalId(null);
      setLongBathPanelId(null);
      setTankModalId(_id);
    } else if (symbolId === 'long_bath') {
      setSymbolPropertiesModalId(null);
      setLongBathPanelId(_id);
    } else if (symbolId === 'highest_direct_supply_fitting') {
      setSymbolPropertiesModalId(null);
      setLongBathPanelId(null);
      setHighestFittingEditId(_id);
    } else if (isModalEligibleSymbol(symbolId)) {
      setLongBathPanelId(null);
      setSymbolPropertiesModalId(_id);
    } else {
      setSymbolPropertiesModalId(null);
      setLongBathPanelId(null);
    }
  }, []);

  // Size multipliers relative to the base symbol size (1× = 6 px = 3 mm on paper).
  // Medium ≈ 10 px (5 mm), large ≈ 16 px (8 mm) — keeps fixtures legible at fixed paper size.
  const SYMBOL_SIZE_MULTIPLIERS: Partial<Record<string, number>> = {
    // Medium fixtures — ~1.7× (≈ 10 px)
    wash_basin_rectangular:     1.7,
    sink:                       1.7,
    water_closet:               1.7,
    urinal_wall:                1.7,
    drinking_fountain_pedestal: 1.7,
    drinking_fountain_trough:   1.7,
    drinking_fountain_wall:     1.7,
    foot_bath:                  1.7,
    multiple_show_unit:         1.7,
    water_heater:               1.7,
    instantaneous_water_heater: 1.7,
    pump:                       1.7,
    long_bath:                  1.7,
    shower_bath:                1.7,
    square_bath:                1.7,
  };

  // Core placement logic shared by drag-drop and tap-to-place
  const placeSymbolAt = useCallback(
    (x: number, y: number, symbolId: string, symbolName: string) => {
      const basePx = getSymbolSizePx(sheetConfig.drawingScale);
      const mult = SYMBOL_SIZE_MULTIPLIERS[symbolId] ?? 1;
      const sz = Math.round(basePx * mult);
      let el: CanvasElement = {
        id: crypto.randomUUID(),
        symbolId,
        symbolName,
        x,
        y,
        rotation: 0,
        width:  sz,
        height: sz,
      };

      // Port-aware snap: align the closest port of the dropped symbol to the nearest pipe
      const { pipes, elements: placedElements } = useCanvasStore.getState();
      const symbolPorts = SYMBOL_PORTS[symbolId] ?? [];
      let snapped = false;
      let bestDist = SNAP_THRESHOLD;
      let bestPipeId = '';
      let bestSnapX = x;
      let bestSnapY = y;
      let bestElX = x;
      let bestElY = y;

      const isInlineOrTerminal = INLINE_SYMBOL_IDS.has(symbolId) || TERMINAL_SYMBOL_IDS.has(symbolId);
      // Inline/terminal symbols only snap their inlet (upstream) port.
      const portsToSnap = isInlineOrTerminal
        ? symbolPorts.filter((p) => p.role === 'upstream')
        : symbolPorts;

      // ── Unified snap strategy ──────────────────────────────────────────────
      // Step 1: Select the pipe closest to the DROP POINT.
      //   Using the drop point (not port positions) ensures the user's cursor
      //   intent wins even when offset ports happen to be closer to a
      //   neighbouring pipe.
      let targetPipe = null as (typeof pipes)[0] | null;
      let targetPipeDist = SNAP_THRESHOLD;
      for (const pipe of pipes) {
        const { x: sx, y: sy } = closestPointOnSegment(
          x, y, pipe.startX, pipe.startY, pipe.endX, pipe.endY
        );
        const d = distance(x, y, sx, sy);
        if (d < targetPipeDist) {
          targetPipeDist = d;
          targetPipe = pipe;
        }
      }

      if (targetPipe) {
        const tp = targetPipe;

        if (isInlineOrTerminal) {
          // Returns true if (px,py) sits on an existing symbol's INLET port.
          // Snapping a new symbol's inlet to another symbol's inlet causes
          // overlap — skip those endpoints.
          const isAtSymbolInlet = (px: number, py: number): boolean =>
            placedElements.some((el) => {
              const ports = SYMBOL_PORTS[el.symbolId] ?? [];
              return ports.some((_, i) => {
                const pos = getPortPosition(el, ports[i]);
                return distance(px, py, pos.x, pos.y) < 10
                  && getEffectivePortRole(el, i) === 'upstream';
              });
            });

          // Step 2a: Endpoint snap on the selected pipe only.
          let endpointSnapped = false;
          for (const port of portsToSnap) {
            // Snap detection must use the symbol's actual rendered size (sz), not the
            // ±24px reference offsets defined for a 48px symbol — otherwise the snap
            // point diverges from getPortPosition's scaled port location whenever the
            // symbol renders at a non-48px size (any non-default drawing scale/multiplier).
            const { ox: portOx, oy: portOy } = getScaledPortOffset(symbolId, port, sz, sz, 1);
            const rot = rotateOffset(portOx, portOy, 0);
            const portAbsX = x + rot.x;
            const portAbsY = y + rot.y;
            for (const [ex, ey] of [
              [tp.startX, tp.startY],
              [tp.endX,   tp.endY  ],
            ] as [number, number][]) {
              // Skip endpoints already occupied by another symbol's inlet —
              // that would place the new symbol on top of the existing one.
              if (isAtSymbolInlet(ex, ey)) continue;
              const d = distance(portAbsX, portAbsY, ex, ey);
              if (d < bestDist) {
                bestDist = d;
                bestPipeId = tp.id;
                bestSnapX = ex;
                bestSnapY = ey;
                bestElX = ex - rot.x;
                bestElY = ey - rot.y;
                snapped = true;
                endpointSnapped = true;
              }
            }
          }

          // Step 2b: Body snap fallback (mid-pipe placement).
          if (!endpointSnapped) {
            for (const port of portsToSnap) {
              // Snap detection must use the symbol's actual rendered size (sz), not the
            // ±24px reference offsets defined for a 48px symbol — otherwise the snap
            // point diverges from getPortPosition's scaled port location whenever the
            // symbol renders at a non-48px size (any non-default drawing scale/multiplier).
            const { ox: portOx, oy: portOy } = getScaledPortOffset(symbolId, port, sz, sz, 1);
            const rot = rotateOffset(portOx, portOy, 0);
              const portAbsX = x + rot.x;
              const portAbsY = y + rot.y;
              const { x: sx, y: sy, t } = closestPointOnSegment(
                portAbsX, portAbsY, tp.startX, tp.startY, tp.endX, tp.endY
              );
              const d = distance(portAbsX, portAbsY, sx, sy);
              if (d < bestDist && t > SNAP_T_MIN && t < SNAP_T_MAX) {
                bestDist = d;
                bestPipeId = tp.id;
                bestSnapX = sx;
                bestSnapY = sy;
                bestElX = sx - rot.x;
                bestElY = sy - rot.y;
                snapped = true;
              }
            }
          }
        } else {
          // Elbow, tee, custom: try an endpoint snap first — the port's actual
          // rendered offset is only a few px (SCHEMATIC_SYMBOL_PX-scaled), so a
          // click at/near a pipe's tip can otherwise land inside the body-snap's
          // SNAP_T_MIN/MAX exclusion zone and be wrongly treated as unconnected.
          let endpointSnapped = false;
          for (const port of portsToSnap) {
            const { ox: portOx, oy: portOy } = getScaledPortOffset(symbolId, port, sz, sz, 1);
            const rot = rotateOffset(portOx, portOy, 0);
            const portAbsX = x + rot.x;
            const portAbsY = y + rot.y;
            for (const [ex, ey] of [
              [tp.startX, tp.startY],
              [tp.endX,   tp.endY  ],
            ] as [number, number][]) {
              const d = distance(portAbsX, portAbsY, ex, ey);
              if (d < bestDist) {
                bestDist = d;
                bestPipeId = tp.id;
                bestSnapX = ex;
                bestSnapY = ey;
                bestElX = ex - rot.x;
                bestElY = ey - rot.y;
                snapped = true;
                endpointSnapped = true;
              }
            }
          }

          // Body snap fallback (mid-pipe placement).
          if (!endpointSnapped) {
            for (const port of portsToSnap) {
              // Snap detection must use the symbol's actual rendered size (sz), not the
              // ±24px reference offsets defined for a 48px symbol — otherwise the snap
              // point diverges from getPortPosition's scaled port location whenever the
              // symbol renders at a non-48px size (any non-default drawing scale/multiplier).
              const { ox: portOx, oy: portOy } = getScaledPortOffset(symbolId, port, sz, sz, 1);
              const rot = rotateOffset(portOx, portOy, 0);
              const portAbsX = x + rot.x;
              const portAbsY = y + rot.y;
              const { x: sx, y: sy, t } = closestPointOnSegment(
                portAbsX, portAbsY, tp.startX, tp.startY, tp.endX, tp.endY
              );
              const d = distance(portAbsX, portAbsY, sx, sy);
              if (d < bestDist && t > SNAP_T_MIN && t < SNAP_T_MAX) {
                bestDist = d;
                bestPipeId = tp.id;
                bestSnapX = sx;
                bestSnapY = sy;
                bestElX = sx - rot.x;
                bestElY = sy - rot.y;
                snapped = true;
              }
            }
          }
        }
      }

      // Propagate fluid type from the snapped pipe (or its upstream element)
      if (snapped && bestPipeId) {
        const snappedPipe = pipes.find((p) => p.id === bestPipeId);
        if (snappedPipe) {
          const fluid = inferFluidAtPoint([snappedPipe], snappedPipe.startX, snappedPipe.startY, placedElements, 8)
                     ?? inferFluidAtPoint([snappedPipe], snappedPipe.endX, snappedPipe.endY, placedElements, 8);
          if (fluid) el = { ...el, carriesFluid: fluid };
        }
      }

      if (symbolId === 'tee_junction') {
        teeConfirmedRef.current = false;
        setPendingTee({
          element: snapped ? { ...el, x: bestElX, y: bestElY } : el,
          pipeId: bestPipeId,
          snapX: bestSnapX,
          snapY: bestSnapY,
          elX: bestElX,
          elY: bestElY,
          snapped,
        });
        return;
      }

      if (symbolId === 'elbow_bend') {
        setPendingElbow({
          element: snapped ? { ...el, x: bestElX, y: bestElY } : el,
          pipeId: bestPipeId,
          snapX: bestSnapX,
          snapY: bestSnapY,
          elX: bestElX,
          elY: bestElY,
          snapped,
        });
        return;
      }

      if ((FLIP_ONLY_SYMBOL_IDS as readonly string[]).includes(symbolId)) {
        setPendingFlip({
          element: snapped ? { ...el, x: bestElX, y: bestElY } : el,
          pipeId: bestPipeId,
          snapX: bestSnapX,
          snapY: bestSnapY,
          snapped,
        });
        return;
      }

      // Standalone marker, not connected to pipes/ports — prompts for its elevation
      // value before it's added to the store at all (cancel just discards it, same
      // as pendingFlip above).
      if (symbolId === 'highest_direct_supply_fitting') {
        setPendingHighestFitting(el);
        return;
      }

      if (snapped) {
        const placedEl = { ...el, x: bestElX, y: bestElY };
        if (INLINE_SYMBOL_IDS.has(symbolId)) {
          const { inletPos, outletPos } = getInlinePortPositions(placedEl);
          insertElementOnPipeInline(bestPipeId, placedEl, inletPos, outletPos);
        } else if (TERMINAL_SYMBOL_IDS.has(symbolId)) {
          // Use actual scaled upstream port position so the pipe terminates at the
          // element's real port, not the unscaled virtual port used for snap detection.
          const terminalUpstream = (SYMBOL_PORTS[symbolId] ?? []).find((p) => p.role === 'upstream');
          const snapPt = terminalUpstream
            ? getPortPosition(placedEl, terminalUpstream)
            : { x: bestSnapX, y: bestSnapY };
          insertElementOnPipe(bestPipeId, placedEl, snapPt.x, snapPt.y, true);
        } else {
          insertElementOnPipe(bestPipeId, placedEl, bestSnapX, bestSnapY);
        }
        // Offer DCV if a backflow-risk fitting was just connected to a pipe
        if (isBackflowRiskElement(placedEl)) {
          showDcvToast(placedEl.id, placedEl.x, placedEl.y, bestPipeId);
        }
        if (!TERMINAL_SYMBOL_IDS.has(symbolId)) maybeResumePipeChain(placedEl, x, y);
      } else {
        addElement(el);
        maybeResumePipeChain(el, x, y);
      }

      // Bidet proximity nudge
      const TAP_SYMBOL_IDS = new Set(['single_tap', 'single_tap_combined', 'twin_tap']);
      const BIDET_PROXIMITY = 48; // ~8 symbol widths
      const { elements: placed } = useCanvasStore.getState();
      if (TAP_SYMBOL_IDS.has(symbolId)) {
        // Case A: tap placed near an existing WC
        const nearWC = placed.some(
          (e) => e.symbolId === 'water_closet' &&
            Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2) < BIDET_PROXIMITY,
        );
        if (nearWC) showBidetToast(el.id, x, y);
      } else if (symbolId === 'water_closet') {
        // Case B: WC placed near an existing tap
        const nearTap = placed.find(
          (e) => TAP_SYMBOL_IDS.has(e.symbolId) &&
            Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2) < BIDET_PROXIMITY,
        );
        if (nearTap) showBidetToast(nearTap.id, nearTap.x, nearTap.y);
      }
    },
    [addElement, insertElementOnPipe, insertElementOnPipeInline, setPendingTee, setPendingElbow, setPendingFlip, setPendingHighestFitting, showBidetToast, showDcvToast, maybeResumePipeChain]
  );


  // Handle drop from symbol palette (desktop drag-drop)
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOverPos(null);
      setDraggingSymbolId(null);
      const symbolId = e.dataTransfer.getData('symbolId');
      const symbolName = e.dataTransfer.getData('symbolName');
      if (!symbolId || !stageRef.current) return;

      const pos = getCanvasPos(e.clientX, e.clientY);
      if (!pos) return;
      placeSymbolAt(pos.x, pos.y, symbolId, symbolName);
    },
    [placeSymbolAt, getCanvasPos, setDraggingSymbolId]
  );

  const handleTeePortConfirm = useCallback(
    (inletIndices: number[], rotation: number) => {
      if (!pendingTee || teeConfirmedRef.current) return;
      teeConfirmedRef.current = true;

      // Use first selected inlet for snap-point positioning
      const primaryInletIndex = inletIndices[0] ?? 0;

      let elX = pendingTee.element.x;
      let elY = pendingTee.element.y;
      if (pendingTee.snapped) {
        const inletPort = (SYMBOL_PORTS['tee_junction'] ?? [])[primaryInletIndex];
        if (inletPort) {
          const { ox, oy } = getScaledPortOffset('tee_junction', inletPort, pendingTee.element.width, pendingTee.element.height, 1);
          const rot = rotateOffset(ox, oy, rotation);
          elX = pendingTee.snapX - rot.x;
          elY = pendingTee.snapY - rot.y;
        }
      }

      // Store as upstreamPortIndices (array) for 2-inlet mode, or upstreamPortIndex for single
      const portOverride =
        inletIndices.length > 1
          ? { upstreamPortIndices: inletIndices }
          : { upstreamPortIndex: inletIndices[0] };

      const finalEl: CanvasElement = { ...pendingTee.element, x: elX, y: elY, ...portOverride, rotation };
      if (pendingTee.snapped) {
        // terminatePipe=true: incoming pipe ends at the tee inlet; user draws
        // pipes from the outlets — avoids a phantom pipe through the tee body.
        insertElementOnPipe(pendingTee.pipeId, finalEl, pendingTee.snapX, pendingTee.snapY, true);
      } else {
        addElement(finalEl);
      }
      maybeResumePipeChain(finalEl, pendingTee.snapX, pendingTee.snapY);
      setPendingTee(null);
      teeConfirmedRef.current = false;
    },
    [pendingTee, addElement, insertElementOnPipe, maybeResumePipeChain]
  );

  const handleElbowPortConfirm = useCallback(
    (upstreamPortIndex: number, rotation: number) => {
      if (!pendingElbow) return;

      // Recalculate element position so the chosen inlet port, after the chosen
      // rotation, lands exactly on the snap point on the pipe.
      let elX = pendingElbow.element.x;
      let elY = pendingElbow.element.y;
      if (pendingElbow.snapped) {
        const inletPort = (SYMBOL_PORTS['elbow_bend'] ?? [])[upstreamPortIndex];
        if (inletPort) {
          const { ox, oy } = getScaledPortOffset('elbow_bend', inletPort, pendingElbow.element.width, pendingElbow.element.height, 1);
          const rot = rotateOffset(ox, oy, rotation);
          elX = pendingElbow.snapX - rot.x;
          elY = pendingElbow.snapY - rot.y;
        }
      }

      const finalEl: CanvasElement = { ...pendingElbow.element, x: elX, y: elY, upstreamPortIndex, rotation };
      if (pendingElbow.snapped) {
        // terminatePipe=true: elbow changes direction, so don't create a phantom pipe
        // through the elbow body — the incoming pipe ends at the inlet.
        insertElementOnPipe(pendingElbow.pipeId, finalEl, pendingElbow.snapX, pendingElbow.snapY, true);
      } else {
        addElement(finalEl);
      }
      maybeResumePipeChain(finalEl, pendingElbow.snapX, pendingElbow.snapY);
      setPendingElbow(null);
    },
    [pendingElbow, addElement, insertElementOnPipe, maybeResumePipeChain]
  );

  const handleFlipConfirm = useCallback(
    (rotation: number, scaleX?: number) => {
      if (!pendingFlip) return;
      const finalEl: CanvasElement = { ...pendingFlip.element, rotation, scaleX: scaleX ?? 1 };
      if (pendingFlip.snapped) {
        const { symbolId } = finalEl;
        if (INLINE_SYMBOL_IDS.has(symbolId)) {
          // Recalculate element position so the inlet port (respecting the
          // chosen scaleX) lands exactly on the snap point. Without this,
          // flipping RTL shifts the inlet to the wrong side.
          let elX = finalEl.x;
          let elY = finalEl.y;
          const inletPort = (SYMBOL_PORTS[symbolId] ?? []).find((p) => p.role === 'upstream');
          if (inletPort) {
            const sx = scaleX ?? 1;
            const { ox, oy } = getScaledPortOffset(symbolId, inletPort, finalEl.width, finalEl.height, sx);
            const rot = rotateOffset(ox, oy, rotation);
            elX = pendingFlip.snapX - rot.x;
            elY = pendingFlip.snapY - rot.y;
          }
          const correctedEl = { ...finalEl, x: elX, y: elY };
          const { inletPos, outletPos } = getInlinePortPositions(correctedEl);
          insertElementOnPipeInline(pendingFlip.pipeId, correctedEl, inletPos, outletPos);
        } else if (TERMINAL_SYMBOL_IDS.has(symbolId)) {
          // Recalculate element position so the inlet port (respecting the chosen
          // scaleX / rotation) lands exactly on the snap point — same fix as inline symbols.
          let elX = finalEl.x;
          let elY = finalEl.y;
          const inletPort = (SYMBOL_PORTS[symbolId] ?? []).find((p) => p.role === 'upstream');
          if (inletPort) {
            const sx = scaleX ?? 1;
            const { ox, oy } = getScaledPortOffset(symbolId, inletPort, finalEl.width, finalEl.height, sx);
            const rot = rotateOffset(ox, oy, rotation);
            elX = pendingFlip.snapX - rot.x;
            elY = pendingFlip.snapY - rot.y;
          }
          const correctedEl = { ...finalEl, x: elX, y: elY };
          insertElementOnPipe(pendingFlip.pipeId, correctedEl, pendingFlip.snapX, pendingFlip.snapY, true);
        } else {
          insertElementOnPipe(pendingFlip.pipeId, finalEl, pendingFlip.snapX, pendingFlip.snapY);
        }
      } else {
        addElement(finalEl);
      }
      setPendingFlip(null);
    },
    [pendingFlip, addElement, insertElementOnPipe, insertElementOnPipeInline]
  );

  const handleStagePointerDown = useCallback(
    (pos: { x: number; y: number }, targetIsStage: boolean) => {
      const { pendingTemplate: pt } = useUiStore.getState();
      if (pt) {
        // Ghost drag-to-place: offset all elements/pipes/annotations so the template centre lands on click
        const xs = [...pt.elements.map((e) => e.x), ...pt.pipes.flatMap((p) => [p.startX, p.endX]), ...pt.annotations.map((a) => a.x)];
        const ys = [...pt.elements.map((e) => e.y), ...pt.pipes.flatMap((p) => [p.startY, p.endY]), ...pt.annotations.map((a) => a.y)];
        // An empty template (no elements/pipes/annotations) has no centroid to
        // offset from — Math.min/max of an empty array is ±Infinity, which would
        // otherwise place everything at NaN (matches the ghost-preview guard in
        // ElementsLayer.tsx).
        if (xs.length === 0) {
          setPendingTemplate(null);
          setGhostPos(null);
          return;
        }
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        const elements = pt.elements.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
        const pipes = pt.pipes.map((p) => ({ ...p, startX: p.startX + dx, startY: p.startY + dy, endX: p.endX + dx, endY: p.endY + dy }));
        const annotations = pt.annotations.map((a) => ({ ...a, x: a.x + dx, y: a.y + dy }));
        appendTemplate(elements, pipes, annotations);
        setPendingTemplate(null);
        setGhostPos(null);
        return;
      }

      const { pendingSymbol: ps } = useUiStore.getState();
      if (ps) {
        // Tap-to-place mode: place the armed symbol and clear the pending state
        placeSymbolAt(pos.x, pos.y, ps.id, ps.name);
        setPendingSymbol(null);
        return;
      }

      if (activeTool === 'pipe' || activeTool === 'cold_pipe' || activeTool === 'hot_pipe') {
        handleCanvasClick(pos.x, pos.y);
      } else {
        if (targetIsStage) {
          setSelected(null);
        }
      }
    },
    [activeTool, handleCanvasClick, setSelected, placeSymbolAt, setPendingSymbol, appendTemplate, setPendingTemplate]
  );

  // Convert stage pointer (viewport px) → virtual canvas content coords
  const pointerToContent = useCallback(
    (pos: { x: number; y: number }) => ({
      x: (pos.x + stageOffsetX) / stageScale,
      y: (pos.y + stageOffsetY) / stageScale,
    }),
    [stageScale, stageOffsetX, stageOffsetY]
  );

  // Right-click on stage → show annotation context menu
  // Native contextmenu listener — avoids Konva's synthetic event system entirely
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const rawX = e.clientX - box.left;
      const rawY = e.clientY - box.top;
      const contentX = (rawX + stageOffsetXRef.current) / stageScaleRef.current;
      const contentY = (rawY + stageOffsetYRef.current) / stageScaleRef.current;
      const { selectedIds, selectedPipeIds, selectedAnnotationIds } = useCanvasStore.getState();
      const hasMultiSelection = selectedIds.length > 1
        || selectedPipeIds.length > 1
        || (selectedIds.length + selectedPipeIds.length + selectedAnnotationIds.length) > 1;
      const type = hasMultiSelection ? 'mirror' : 'annotation';
      setContextMenu({ type, viewportX: rawX, viewportY: rawY, contentX, contentY });
    };
    el.addEventListener('contextmenu', handler);
    return () => el.removeEventListener('contextmenu', handler);
  }, []);

  const handleAnnotationSelect = useCallback(
    (text: string, fontSize: number, maxWidth: number) => {
      if (!contextMenu) return;
      addAnnotation({
        id: crypto.randomUUID(),
        x: contextMenu.contentX,
        y: contextMenu.contentY,
        text,
        fontSize,
        color: '#1a1a1a',
        maxWidth,
      });
      setContextMenu(null);
    },
    [contextMenu, addAnnotation],
  );

  const handleAnnotationDblClick = useCallback(
    (id: string, x: number, y: number, text: string, fontSize: number, maxWidth: number, height: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Exit any multi-select state so the annotation renders in AnnotationsLayer after editing
      setSelected(id);
      const screenX = x * stageScale - stageOffsetX + rect.left;
      const screenY = y * stageScale - stageOffsetY + rect.top;
      setEditingAnnotation({ id, text, screenX, screenY, fontSize, maxWidth, height });
    },
    [setSelected, stageOffsetX, stageOffsetY, stageScale],
  );

  // Shared rubber band completion — reads from refs so it's safe to call from
  // any event handler without worrying about stale React state closures.
  const completeRubberBand = useCallback(() => {
    const anchor = rubberAnchorRef.current;
    const current = rubberCurrentRef.current;
    if (!anchor || !current) return;
    rubberAnchorRef.current = null;
    rubberCurrentRef.current = null;
    setRubberAnchor(null);
    setRubberCurrent(null);
    const rect = {
      x: Math.min(anchor.x, current.x),
      y: Math.min(anchor.y, current.y),
      width: Math.abs(current.x - anchor.x),
      height: Math.abs(current.y - anchor.y),
    };
    if (rubberDraggedRef.current && rect.width > 5 && rect.height > 5) {
      rubberDraggedRef.current = false;
      const { elements: els, pipes, annotations } = useCanvasStore.getState();
      const insideEls = els.filter(
        (el) =>
          el.x >= rect.x && el.x <= rect.x + rect.width &&
          el.y >= rect.y && el.y <= rect.y + rect.height,
      );
      // A pipe is selected only if BOTH endpoints are fully inside the rect.
      const insidePipes = pipes.filter(
        (p) =>
          p.startX >= rect.x && p.startX <= rect.x + rect.width &&
          p.startY >= rect.y && p.startY <= rect.y + rect.height &&
          p.endX   >= rect.x && p.endX   <= rect.x + rect.width &&
          p.endY   >= rect.y && p.endY   <= rect.y + rect.height,
      );
      const insideAnns = annotations.filter(
        (ann) =>
          ann.x >= rect.x && ann.x <= rect.x + rect.width &&
          ann.y >= rect.y && ann.y <= rect.y + rect.height,
      );
      const total = insideEls.length + insidePipes.length + insideAnns.length;
      if (total === 1 && insideEls.length === 1) {
        setSelected(insideEls[0].id);
      } else if (total === 1 && insideAnns.length === 1) {
        setSelected(insideAnns[0].id);
      } else if (total > 1) {
        setMultiSelection(insideEls.map((el) => el.id), insidePipes.map((p) => p.id), insideAnns.map((a) => a.id));
      }
    } else {
      rubberDraggedRef.current = false;
    }
  }, [setSelected, setMultiSelection]);

  // Global window mouseup — fires even when released over scrollbars or outside canvas.
  useEffect(() => {
    window.addEventListener('mouseup', completeRubberBand);
    return () => window.removeEventListener('mouseup', completeRubberBand);
  }, [completeRubberBand]);

  // Start rubber band on mousedown on empty canvas (non-pipe modes only)
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Right mouse button → reserved for context menu, never start rubber band
      if (e.evt.button === 2) return;
      // Middle mouse button → pan canvas
      if (e.evt.button === 1) {
        setEditingAnnotation(null);
        e.evt.preventDefault();
        const startX = e.evt.clientX;
        const startY = e.evt.clientY;
        const startOffsetX = stageOffsetXRef.current;
        const startOffsetY = stageOffsetYRef.current;
        const container = containerRef.current;
        if (container) container.style.cursor = 'grabbing';
        const onMove = (me: MouseEvent) => {
          const s  = stageScaleRef.current;
          const vw = virtualWidthRef.current;
          const vh = virtualHeightRef.current;
          const cw = canvasSize.width;
          const ch = canvasSize.height;
          const minX = vw * s < cw ? -(cw - vw * s) / 2 : 0;
          const minY = vh * s < ch ? -(ch - vh * s) / 2 : 0;
          setStageOffsetX(Math.max(minX, Math.min(startOffsetX - (me.clientX - startX), Math.max(0, vw * s - cw))));
          setStageOffsetY(Math.max(minY, Math.min(startOffsetY - (me.clientY - startY), Math.max(0, vh * s - ch))));
        };
        const onUp = (ue: MouseEvent) => {
          if (ue.button !== 1) return;
          if (container) container.style.cursor = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }
      if (activeTool === 'pipe' || activeTool === 'cold_pipe' || activeTool === 'hot_pipe') return;
      if (e.target !== e.target.getStage()) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const raw = stage.getPointerPosition();
      if (!raw) return;
      const content = pointerToContent(raw);
      rubberDraggedRef.current = false;
      rubberAnchorRef.current = content;
      rubberCurrentRef.current = content;
      setRubberAnchor(content);
      setRubberCurrent(content);
    },
    [activeTool, pointerToContent, virtualWidth, virtualHeight, canvasSize],
  );

  // Konva onMouseUp kept as no-op — window listener above handles completion.
  const handleStageMouseUp = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => { /* handled by window mouseup */ },
    [],
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // window.mouseup (completeRubberBand) fires AFTER Konva's onClick, so if
      // rubberDragged is still true here we must NOT reset it — completeRubberBand
      // needs to see it when it runs a moment later.
      if (rubberDraggedRef.current) {
        return;
      }
      const stage = e.target.getStage();
      if (!stage) return;
      const raw = stage.getPointerPosition();
      if (!raw) return;
      handleStagePointerDown(pointerToContent(raw), e.target === stage);
    },
    [handleStagePointerDown, pointerToContent],
  );

  const handleStageTap = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const raw = stage.getPointerPosition();
      if (!raw) return;
      handleStagePointerDown(pointerToContent(raw), e.target === stage);
    },
    [handleStagePointerDown, pointerToContent]
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const raw = stage.getPointerPosition();
      if (!raw) return;
      const content = pointerToContent(raw);
      handleCanvasMouseMove(content.x, content.y);
      if (useUiStore.getState().pendingTemplate) setGhostPos(content);
      // Update rubber band while dragging (use ref — state update may lag)
      if (rubberAnchorRef.current) {
        const dx = content.x - rubberAnchorRef.current.x;
        const dy = content.y - rubberAnchorRef.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) rubberDraggedRef.current = true;
        rubberCurrentRef.current = content;
        setRubberCurrent(content);
      }
    },
    [handleCanvasMouseMove, pointerToContent, rubberAnchor],
  );

  // Scrollbar geometry
  const thumbHeight = Math.max(24, (canvasSize.height / (virtualHeight * stageScale)) * canvasSize.height);
  const thumbTop = maxOffset > 0 ? (stageOffsetY / maxOffset) * (canvasSize.height - thumbHeight) : 0;

  const handleThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const capturedOffset = stageOffsetY;
    const capturedMax = maxOffset;
    const capturedThumbH = Math.max(24, (canvasSize.height / (virtualHeight * stageScale)) * canvasSize.height);
    const trackH = canvasSize.height - capturedThumbH;
    scrollbarDragRef.current = { startY: e.clientY, startOffset: capturedOffset };
    const onMove = (me: MouseEvent) => {
      if (!scrollbarDragRef.current) return;
      const delta = me.clientY - scrollbarDragRef.current.startY;
      const newOffset = scrollbarDragRef.current.startOffset + (trackH > 0 ? (delta / trackH) * capturedMax : 0);
      setStageOffsetY(Math.max(0, Math.min(newOffset, capturedMax)));
    };
    const onUp = () => {
      scrollbarDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [stageOffsetY, maxOffset, canvasSize.height, virtualHeight, stageScale]);

  const handleHorizontalThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const capturedOffset = stageOffsetX;
    const capturedMax = maxOffsetX;
    const capturedThumbW = horizontalThumbWidth;
    const trackW = canvasSize.width - 12 - capturedThumbW;

    horizontalScrollbarDragRef.current = {
      startX: e.clientX,
      startOffset: capturedOffset,
    };

    const onMove = (me: MouseEvent) => {
      if (!horizontalScrollbarDragRef.current) return;

      const delta = me.clientX - horizontalScrollbarDragRef.current.startX;

      const newOffset =
        horizontalScrollbarDragRef.current.startOffset +
        (trackW > 0 ? (delta / trackW) * capturedMax : 0);

      setStageOffsetX(Math.max(0, Math.min(newOffset, capturedMax)));
    };

    const onUp = () => {
      horizontalScrollbarDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [
    stageOffsetX,
    maxOffsetX,
    horizontalThumbWidth,
    canvasSize.width,
  ]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: getCursor(), position: 'relative' }}
      onDrop={handleDrop}
      onMouseMove={(e) => {
        const pos = getCanvasPos(e.clientX, e.clientY);
        if (pos) lastMouseCanvasPosRef.current = pos;
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (draggingSymbolId) {
          const pos = getCanvasPos(e.clientX, e.clientY);
          if (pos) setDragOverPos(pos);
        }
      }}
      onDragLeave={() => setDragOverPos(null)}
    >
      {(pendingSymbol || pendingTemplate) && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          background: '#fef3c7',
          border: '1.5px solid #f59e0b',
          borderRadius: 8,
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          fontWeight: 600,
          color: '#92400e',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}>
          {pendingTemplate
            ? `Click canvas to place: ${pendingTemplate.name}`
            : `Tap canvas to place: ${pendingSymbol!.name}`}
          <button
            onClick={() => { setPendingSymbol(null); setPendingTemplate(null); }}
            style={{
              pointerEvents: 'auto',
              marginLeft: 4,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              color: '#92400e',
              padding: '0 2px',
            }}
            aria-label="Cancel placement"
          >
            ×
          </button>
        </div>
      )}
      <Stage
        ref={stageRef}
        width={canvasSize.width}
        height={canvasSize.height}
        x={-stageOffsetX}
        y={-stageOffsetY}
        scaleX={stageScale}
        scaleY={stageScale}
        onClick={handleStageClick}
        onTap={handleStageTap}
        onMouseDown={handleStageMouseDown}
        onMouseUp={handleStageMouseUp}
        onMouseMove={handleStageMouseMove}
        style={{ background: '#b0b8c1', cursor: (pendingSymbol || pendingTemplate) ? 'crosshair' : undefined }}
      >
        {/* White page sheet — must be the very first layer so PDF and content render on top */}
        <Layer listening={false}>
          <KonvaRect
            x={0}
            y={0}
            width={virtualWidth}
            height={virtualHeight}
            fill="white"
            shadowColor="rgba(0,0,0,0.25)"
            shadowBlur={20}
            shadowOffsetX={0}
            shadowOffsetY={4}
          />
        </Layer>

        {pdfBackground && (
          <PdfBackgroundLayer
            dataUrl={pdfBackground.dataUrl}
            x={pdfBackground.x}
            y={pdfBackground.y}
            width={pdfBackground.width}
            height={pdfBackground.height}
            opacity={pdfBackground.opacity}
            rotation={pdfBackground.rotation}
            locked={pdfBackground.locked}
            onChange={updatePdfBackground}
          />
        )}
        <GridLayer
          canvasWidth={virtualWidth}
          canvasHeight={virtualHeight}
          upperMrl={mrlConfig.upperMrl}
          lowerMrl={mrlConfig.lowerMrl}
          axisWidth={AXIS_WIDTH}
          floorLevels={floorLevels}
          floorLevelOpacity={floorLevelOpacity}
        />
        <TitleBlockLayer
          sheetConfig={sheetConfig}
          onTitleBlockClick={() => useUiStore.getState().openSheetSetupAtTitleBlock()}
        />
        <LpPeStampLayer sheetConfig={sheetConfig} />
        <ElementsLayer
          stageScale={stageScale}
          stageOffsetX={stageOffsetX}
          stageOffsetY={stageOffsetY}
          viewportWidth={canvasSize.width}
          viewportHeight={canvasSize.height}
          dragPreview={draggingSymbolId && dragOverPos
            ? { symbolId: draggingSymbolId, x: dragOverPos.x, y: dragOverPos.y }
            : null}
          templateGhost={pendingTemplate && ghostPos ? { elements: pendingTemplate.elements, pipes: pendingTemplate.pipes, cursorX: ghostPos.x, cursorY: ghostPos.y } : null}
          onElementClick={handleElementClick}
          onElementDblClick={(id) => {
            const el = useCanvasStore.getState().elements.find((e) => e.id === id);
            if (!el) return;
            if (isModalEligibleSymbol(el.symbolId)) setSymbolPropertiesModalId(id);
          }}
          rubberBand={rubberBandRect}
          onAnnotationDblClick={handleAnnotationDblClick}
        />
        <AnnotationsLayer onAnnotationDblClick={handleAnnotationDblClick} editingAnnotationId={editingAnnotation?.id} />
        <PipeDraftLayer
          anchorPoint={anchorPoint}
          previewEnd={previewEnd}
          isActive={isDrawingPipe && !draggingSymbolId}
          activeTool={activeTool}
        />
      </Stage>
      {/* Custom vertical scrollbar */}
      {maxOffset > 0 && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: 12,
            height: canvasSize.height,
            background: '#e8e8e8',
            zIndex: 20,
            cursor: 'pointer',
            borderLeft: '1px solid #ccc',
          }}
          onMouseDown={(e) => {
            // Click on track scrolls to that proportion
            const rect = e.currentTarget.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const newOffset = (clickY / canvasSize.height) * maxOffset;
            setStageOffsetY(Math.max(0, Math.min(newOffset, maxOffset)));
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: 1,
              width: 10,
              height: thumbHeight,
              top: thumbTop,
              background: '#aaa',
              borderRadius: 5,
              cursor: 'grab',
            }}
            onMouseDown={handleThumbMouseDown}
          />
        </div>
      )}

      {/* Horizontal scrollbar */}
      {maxOffsetX > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 12,
            bottom: 0,
            height: 12,
            background: '#f6f3f3',
            borderTop: '1px solid #e5e7eb',
            zIndex: 20,
          }}
          onMouseDown={(e) => {
            // Click on track scrolls to that proportion
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const newOffset = (clickX / canvasSize.width) * maxOffsetX;
            setStageOffsetX(Math.max(0, Math.min(newOffset, maxOffsetX)));
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: horizontalThumbLeft,
              top: 2,
              height: 8,
              width: horizontalThumbWidth,
              borderRadius: 5,
              background: '#aaa',
              cursor: 'grab',
            }}
            onMouseDown={handleHorizontalThumbMouseDown}
          />
        </div>
      )}

      {/* Zoom controls — bottom right */}
      <div style={{
        position: 'absolute',
        bottom: 56,
        right: maxOffset > 0 ? 20 : 8,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        zIndex: 20,
      }}>
        <button
          onClick={() => { setEditingAnnotation(null); zoom(-SCALE_STEP); }}
          title="Zoom out"
          style={{
            width: 32, height: 32,
            border: '1px solid #bbb',
            borderRadius: 4,
            background: '#fff',
            fontSize: 20,
            lineHeight: 1,
            cursor: 'pointer',
            color: '#333',
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >-</button>
        <div style={{
          fontSize: 10,
          color: '#666',
          userSelect: 'none',
          background: 'rgba(255,255,255,0.85)',
          borderRadius: 3,
          padding: '3px 6px',
          border: '1px solid #ddd',
          minWidth: 36,
          textAlign: 'center',
        }}>
          {Math.round((stageScale / baseScale) * 100)}%
        </div>
        <button
          onClick={() => { setEditingAnnotation(null); zoom(SCALE_STEP); }}
          title="Zoom in"
          style={{
            width: 32, height: 32,
            border: '1px solid #bbb',
            borderRadius: 4,
            background: '#fff',
            fontSize: 20,
            lineHeight: 1,
            cursor: 'pointer',
            color: '#333',
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >+</button>
        <button
          onClick={() => { setEditingAnnotation(null); fitToScreen(); }}
          title="Fit to screen"
          style={{
            width: 32, height: 32,
            border: '1px solid #bbb',
            borderRadius: 4,
            background: '#fff',
            cursor: 'pointer',
            color: '#333',
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M1 5V1h4M11 1h4v4M1 11v4h4M15 11v4h-4"/>
          </svg>
        </button>
      </div>

      {selectedRotatable && activeTool !== 'pipe' && activeTool !== 'cold_pipe' && activeTool !== 'hot_pipe' && (() => {
        const vp = contentToViewport(selectedRotatable.x, selectedRotatable.y);
        const halfWidthVp = ((selectedRotatable.width ?? getSymbolSizePx(sheetConfig.drawingScale)) / 2) * stageScale;
        return (
          <RotationPanel
            elementId={selectedRotatable.id}
            symbolId={selectedRotatable.symbolId}
            x={vp.x}
            y={vp.y}
            currentRotation={selectedRotatable.rotation}
            currentScaleX={selectedRotatable.scaleX ?? 1}
            elementHalfWidthVp={halfWidthVp}
          />
        );
      })()}
      {pendingTee && (
        <TeeJunctionPortDialog
          onConfirm={handleTeePortConfirm}
          onCancel={() => setPendingTee(null)}
        />
      )}
      {pendingElbow && (
        <ElbowBendPortDialog
          imageUrl={symbolsApi.getImageUrl('elbow_bend')}
          onConfirm={handleElbowPortConfirm}
          onCancel={() => setPendingElbow(null)}
        />
      )}
      {pendingFlip && (
        <FlipOrientationDialog
          symbolId={pendingFlip.element.symbolId}
          symbolName={pendingFlip.element.symbolName}
          onConfirm={handleFlipConfirm}
          onCancel={() => setPendingFlip(null)}
        />
      )}
      {pendingHighestFitting && (
        <HighestFittingValueDialog
          onConfirm={(elevationM) => {
            addElement({ ...pendingHighestFitting, highestFittingElevationM: elevationM });
            setPendingHighestFitting(null);
          }}
          onCancel={() => setPendingHighestFitting(null)}
        />
      )}
      {highestFittingEditId && (() => {
        const el = useCanvasStore.getState().elements.find((e) => e.id === highestFittingEditId);
        if (!el) return null;
        return (
          <HighestFittingValueDialog
            initialValueM={el.highestFittingElevationM}
            onConfirm={(elevationM) => {
              updateHighestFittingElevation(highestFittingEditId, elevationM);
              setHighestFittingEditId(null);
            }}
            onCancel={() => setHighestFittingEditId(null)}
          />
        );
      })()}
      {symbolPropertiesModalId && (() => {
        const el = useCanvasStore.getState().elements.find((e) => e.id === symbolPropertiesModalId);
        if (!el) return null;
        if (!isModalEligibleSymbol(el.symbolId)) return null;
        if (el.symbolId === 'long_bath') return null;
        const vp = contentToViewport(el.x, el.y);
        const halfWidthVp = ((el.width ?? getSymbolSizePx(sheetConfig.drawingScale)) / 2) * stageScale;
        return (
          <SymbolPropertiesModal
            elementId={symbolPropertiesModalId}
            x={vp.x}
            y={vp.y}
            elementHalfWidthVp={halfWidthVp}
            onClose={() => setSymbolPropertiesModalId(null)}
          />
        );
      })()}
      {longBathElement && activeTool !== 'pipe' && activeTool !== 'cold_pipe' && activeTool !== 'hot_pipe' && (() => {
        const vp = contentToViewport(longBathElement.x, longBathElement.y);
        const halfWidthVp = ((longBathElement.width ?? getSymbolSizePx(sheetConfig.drawingScale)) / 2) * stageScale;
        return (
          <LongBathPanel
            elementId={longBathElement.id}
            x={vp.x}
            y={vp.y}
            currentCapacityL={longBathElement.longBathCapacityL}
            dualSupply={longBathElement.dualSupply}
            swapDualSupply={longBathElement.swapDualSupply}
            elementHalfWidthVp={halfWidthVp}
            onClose={() => setLongBathPanelId(null)}
          />
        );
      })()}
      {tankModalId && (
        <WaterTankPropertiesModal
          tankId={tankModalId}
          onClose={() => setTankModalId(null)}
        />
      )}
      {contextMenu && contextMenu.type === 'annotation' && (
        <AnnotationContextMenu
          viewportX={contextMenu.viewportX}
          viewportY={contextMenu.viewportY}
          onSelect={handleAnnotationSelect}
          onClose={() => setContextMenu(null)}
        />
      )}
      {contextMenu && contextMenu.type === 'mirror' && (
        <MirrorContextMenu
          viewportX={contextMenu.viewportX}
          viewportY={contextMenu.viewportY}
          onMirror={(axis) => mirrorSelection(axis)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {editingAnnotation && (
        <textarea
          ref={editingAnnotationRef}
          autoFocus
          defaultValue={editingAnnotation.text}
          onMouseDown={(e) => e.stopPropagation()}
          onFocus={(e) => { const l = e.target.value.length; e.target.setSelectionRange(l, l); }}
          onBlur={(e) => {
            if (cancelEditRef.current) { cancelEditRef.current = false; return; }
            const v = e.target.value.trim();
            if (v) updateAnnotation(editingAnnotation.id, v);
            else removeAnnotation(editingAnnotation.id);
            setEditingAnnotation(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { cancelEditRef.current = true; setEditingAnnotation(null); return; }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const ta = e.target as HTMLTextAreaElement;
              const v = ta.value.trim();
              if (v) updateAnnotation(editingAnnotation.id, v);
              else removeAnnotation(editingAnnotation.id);
              setEditingAnnotation(null);
            }
          }}
          style={{
            position: 'fixed',
            left: editingAnnotationLeft,
            top: editingAnnotationTop,
            width: (editingAnnotation.maxWidth + 9) * stageScale,
            height: (editingAnnotation.height + 9) * stageScale,
            fontSize: editingAnnotation.fontSize * stageScale,
            fontFamily: 'inherit',
            lineHeight: 1.35,
            color: '#1a1a1a',
            background: 'rgba(255,255,220,0.95)',
            border: `${1.5 * stageScale}px solid #0066cc`,
            borderRadius: 2 * stageScale,
            padding: `${3 * stageScale}px`,
            outline: 'none',
            resize: 'none',
            boxSizing: 'border-box',
            zIndex: 3000,
            overflow: 'hidden',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        />
      )}
    </div>
  );
}

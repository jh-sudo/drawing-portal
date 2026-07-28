import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ActiveTool, FloorLevel, MrlConfig, MRL_LOWER_HARD_MIN, SheetConfig, TitleBlockData, DEFAULT_SHEET_CONFIG, getUpperMrl, PAPER_SIZES_MM, SHEET_PX_PER_MM, DEFAULT_ANNOTATION_FONT_SIZE } from '../types';
import type { CanvasElement, PipeElement, AnnotationElement, PipeType } from '../types';
import { useCanvasStore } from './canvasStore';

export interface PendingTemplate {
  name: string;
  elements: CanvasElement[];
  pipes: PipeElement[];
  annotations: AnnotationElement[];
}

export interface PdfBackground {
  dataUrl: string;
  x: number;      // center x in content coords
  y: number;      // center y in content coords
  width: number;
  height: number;
  rotation: number;
  locked: boolean;
  opacity: number; // 0–1
}

export interface BidetToast {
  tapElementId: string;
  tapX: number;
  tapY: number;
}

export interface DcvToast {
  elementId: string;
  elementX: number;
  elementY: number;
  pipeId: string;
}

/** Transient (non-persisted) smart-guide shown while dragging a symbol into
 *  axis-alignment with another symbol's port — lets a later pipe between them
 *  be a straight H/V line instead of a diagonal. */
export interface AlignmentGuide {
  axis: 'x' | 'y';
  value: number;
}

interface UiStore {
  activeTool: ActiveTool;
  mrlConfig: MrlConfig;
  floorLevels: FloorLevel[];
  draggingSymbolId: string | null;
  pendingSymbol: { id: string; name: string } | null;
  pendingTemplate: PendingTemplate | null;
  exportPdfFn: (() => void) | null;
  captureStageRegionFn: ((region: { x: number; y: number; width: number; height: number }, pixelRatio?: number) => string | null) | null;
  pdfBackground: PdfBackground | null;
  pdfImportFn: ((file: File) => Promise<void>) | null;
  sheetConfig: SheetConfig;
  sheetSetupOpen: boolean;
  sheetSetupInitialTab: 'sheet' | 'titleblock';
  bidetToast: BidetToast | null;
  dcvToast: DcvToast | null;
  alignmentGuide: AlignmentGuide | null;
  floorLevelOpacity: number;
  /** Persisted per-type default color for newly-drawn pipes — set whenever the
   *  user picks a custom color in PipeColorPanel, so future pipes of that type
   *  start with it too instead of always reverting to the built-in blue/red. */
  pipeColorDefaults: Partial<Record<PipeType, string>>;
  /** Shared (not per-type) most-recently-used custom pipe colors, newest first, max 3. */
  recentPipeColors: string[];
  /** Last font size the user picked/typed in the annotation insert menu — becomes the
   *  starting value for the next annotation placed, so it doesn't reset every time. */
  annotationFontSizeDefault: number;
  setActiveTool: (tool: ActiveTool) => void;
  setMrlConfig: (config: Partial<MrlConfig>) => void;
  addFloorLevel: (floor: Omit<FloorLevel, 'id'>) => void;
  updateFloorLevel: (id: string, changes: Partial<Omit<FloorLevel, 'id'>>) => void;
  removeFloorLevel: (id: string) => void;
  setDraggingSymbolId: (id: string | null) => void;
  setPendingSymbol: (sym: { id: string; name: string } | null) => void;
  setPendingTemplate: (t: PendingTemplate | null) => void;
  registerExportPdf: (fn: () => void) => void;
  registerCaptureStageRegion: (fn: (region: { x: number; y: number; width: number; height: number }, pixelRatio?: number) => string | null) => void;
  setPdfBackground: (bg: PdfBackground | null) => void;
  updatePdfBackground: (props: Partial<PdfBackground>) => void;
  registerPdfImport: (fn: (file: File) => Promise<void>) => void;
  setSheetConfig: (cfg: SheetConfig) => void;
  setTitleBlock: (tb: TitleBlockData) => void;
  resetTitleBlock: () => void;
  openSheetSetup: () => void;
  openSheetSetupAtTitleBlock: () => void;
  closeSheetSetup: () => void;
  showBidetToast: (tapElementId: string, tapX: number, tapY: number) => void;
  dismissBidetToast: () => void;
  showDcvToast: (elementId: string, elementX: number, elementY: number, pipeId: string) => void;
  dismissDcvToast: () => void;
  setAlignmentGuide: (guide: AlignmentGuide) => void;
  clearAlignmentGuide: () => void;
  setFloorLevelOpacity: (opacity: number) => void;
  setPipeColorDefault: (pipeType: PipeType, color: string) => void;
  resetPipeColorDefault: (pipeType: PipeType) => void;
  addRecentPipeColor: (color: string) => void;
  setAnnotationFontSizeDefault: (size: number) => void;
}

export const useUiStore = create<UiStore>()(persist((set, get) => ({
  activeTool: 'select',
  mrlConfig: {
    lowerMrl: 40,
    upperMrl: getUpperMrl(40, DEFAULT_SHEET_CONFIG),
  },
  floorLevels: [],
  draggingSymbolId: null,
  pendingSymbol: null,
  pendingTemplate: null,
  exportPdfFn: null,
  captureStageRegionFn: null,
  pdfBackground: null,
  pdfImportFn: null,
  sheetConfig: DEFAULT_SHEET_CONFIG,
  sheetSetupOpen: true,
  sheetSetupInitialTab: 'sheet' as const,
  bidetToast: null,
  dcvToast: null,
  alignmentGuide: null,
  floorLevelOpacity: 1,
  pipeColorDefaults: {},
  recentPipeColors: [],
  annotationFontSizeDefault: DEFAULT_ANNOTATION_FONT_SIZE,

  setActiveTool: (tool) => set({ activeTool: tool }),
  setDraggingSymbolId: (id) => set({ draggingSymbolId: id }),
  setPendingSymbol: (sym) => set({ pendingSymbol: sym }),
  setPendingTemplate: (t) => set({ pendingTemplate: t }),
  registerExportPdf: (fn) => set({ exportPdfFn: fn }),
  registerCaptureStageRegion: (fn) => set({ captureStageRegionFn: fn }),
  setPdfBackground: (bg) => set({ pdfBackground: bg }),
  updatePdfBackground: (props) => set((state) => ({
    pdfBackground: state.pdfBackground ? { ...state.pdfBackground, ...props } : null,
  })),
  registerPdfImport: (fn) => set({ pdfImportFn: fn }),
  setSheetConfig: (cfg) => {
    const { sheetConfig: prev, mrlConfig } = get();
    // Paper size alone (even with drawingScale unchanged) moves the canvas-bottom
    // anchor that elevations are measured from — both must trigger a rescale, or
    // every element's real-world elevation silently drifts with no visual change.
    if (cfg.drawingScale !== prev.drawingScale || cfg.paperSize !== prev.paperSize) {
      const oldVirtualH = PAPER_SIZES_MM[prev.paperSize].h * SHEET_PX_PER_MM;
      const newVirtualH = PAPER_SIZES_MM[cfg.paperSize].h * SHEET_PX_PER_MM;
      useCanvasStore.getState().rescaleAll(prev.drawingScale, cfg.drawingScale, oldVirtualH, newVirtualH);
    }
    set({ sheetConfig: cfg, mrlConfig: { lowerMrl: mrlConfig.lowerMrl, upperMrl: getUpperMrl(mrlConfig.lowerMrl, cfg) } });
  },
  setTitleBlock: (tb) => set((state) => ({ sheetConfig: { ...state.sheetConfig, titleBlock: tb } })),
  resetTitleBlock: () => set((state) => ({ sheetConfig: { ...state.sheetConfig, titleBlock: DEFAULT_SHEET_CONFIG.titleBlock } })),
  openSheetSetup: () => set({ sheetSetupOpen: true, sheetSetupInitialTab: 'sheet' }),
  openSheetSetupAtTitleBlock: () => set({ sheetSetupOpen: true, sheetSetupInitialTab: 'titleblock' }),
  closeSheetSetup: () => set({ sheetSetupOpen: false }),
  showBidetToast: (tapElementId, tapX, tapY) => set({ bidetToast: { tapElementId, tapX, tapY } }),
  dismissBidetToast: () => set({ bidetToast: null }),
  showDcvToast: (elementId, elementX, elementY, pipeId) => set({ dcvToast: { elementId, elementX, elementY, pipeId } }),
  dismissDcvToast: () => set({ dcvToast: null }),
  setAlignmentGuide: (guide) => set({ alignmentGuide: guide }),
  clearAlignmentGuide: () => set({ alignmentGuide: null }),
  setFloorLevelOpacity: (opacity) => set({ floorLevelOpacity: Math.max(0, Math.min(1, opacity)) }),

  addFloorLevel: (floor) =>
    set((state) => ({
      floorLevels: [...state.floorLevels, { id: crypto.randomUUID(), ...floor }]
        .sort((a, b) => a.fflM - b.fflM),
    })),

  updateFloorLevel: (id, changes) =>
    set((state) => ({
      floorLevels: state.floorLevels
        .map((f) => f.id === id ? { ...f, ...changes } : f)
        .sort((a, b) => a.fflM - b.fflM),
    })),

  removeFloorLevel: (id) =>
    set((state) => ({
      floorLevels: state.floorLevels.filter((f) => f.id !== id),
    })),

  setMrlConfig: (partial) => {
    // Only lowerMrl is user-configurable; upperMrl is always derived from sheetConfig
    const lowerMrl = Math.max(MRL_LOWER_HARD_MIN, partial.lowerMrl ?? get().mrlConfig.lowerMrl);
    set({ mrlConfig: { lowerMrl, upperMrl: getUpperMrl(lowerMrl, get().sheetConfig) } });
  },

  setPipeColorDefault: (pipeType, color) =>
    set((state) => ({ pipeColorDefaults: { ...state.pipeColorDefaults, [pipeType]: color } })),
  resetPipeColorDefault: (pipeType) =>
    set((state) => {
      const next = { ...state.pipeColorDefaults };
      delete next[pipeType];
      return { pipeColorDefaults: next };
    }),
  addRecentPipeColor: (color) =>
    set((state) => ({
      recentPipeColors: [color, ...state.recentPipeColors.filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, 3),
    })),
  setAnnotationFontSizeDefault: (size) => set({ annotationFontSizeDefault: size }),
}), {
  name: 'schematic-ui',
  version: 1,
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    sheetConfig:        state.sheetConfig,
    mrlConfig:          state.mrlConfig,
    floorLevels:        state.floorLevels,
    sheetSetupOpen:     state.sheetSetupOpen,
    floorLevelOpacity:  state.floorLevelOpacity,
    pipeColorDefaults:  state.pipeColorDefaults,
    recentPipeColors:   state.recentPipeColors,
    annotationFontSizeDefault: state.annotationFontSizeDefault,
  }),
  migrate: (_persisted, version) => {
    if (version < 1) return {} as UiStore;
    return _persisted as UiStore;
  },
}));

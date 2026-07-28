import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AnnotationElement, CanvasElement, PipeElement, TankProperties, AXIS_WIDTH } from '../types';
import { getElementPorts, getPortPosition, findElementPortIndexAt } from '../utils/symbolPorts';

// A connected pipe endpoint sits essentially exactly on its port (aside from
// float rounding) — this must stay tight. Symbols render at only ~6px with
// ports ~3px from center, so a looser radius can wrongly capture a nearby,
// unrelated pipe endpoint that just happens to be close by.
const PORT_MATCH = 0.5;

/** Builds a new pipe carrying through `orig`'s "identity" fields (pipeType, customColor)
 *  with a fresh id — the shared shape for every pipe-splitting operation (inserting a
 *  fitting or backflow assembly mid-pipe). Centralizing this means a future per-pipe
 *  field only needs adding here once, instead of by hand at every split call site (the
 *  exact bug class that already required customColor to be added to 5 separate literals
 *  when it was introduced).
 *
 *  diameterLabel is deliberately NOT auto-copied here (unlike pipeType/customColor) —
 *  callers pass it explicitly only on the split segment that should keep it, since
 *  copying it onto both halves of a split renders two identical "ØXXmm" text labels
 *  clustered around the newly inserted fitting, which reads as a duplication bug rather
 *  than two pipes sharing a color. */
function derivePipe(orig: PipeElement, overrides: Omit<PipeElement, 'id' | 'pipeType' | 'customColor'>): PipeElement {
  return { id: crypto.randomUUID(), pipeType: orig.pipeType, customColor: orig.customColor, ...overrides };
}

/**
 * Single sync point for "an element moved/rotated/flipped/resized — bring its
 * connected pipe endpoints along". Any pipe endpoint bound to `newElement`'s id
 * (via startElementId/endElementId + …PortIndex) is recomputed exactly from the
 * new element state. Unbound endpoints (legacy data, or pipes never explicitly
 * connected) fall back to matching the old port position by proximity, same as
 * the pre-migration behavior.
 */
function syncConnectedPipeEndpoints(
  pipes: PipeElement[],
  oldElement: CanvasElement,
  newElement: CanvasElement,
): PipeElement[] {
  const oldPorts = getElementPorts(oldElement).map((port) => getPortPosition(oldElement, port));
  const newPorts = getElementPorts(newElement).map((port) => getPortPosition(newElement, port));

  return pipes.map((pipe) => {
    let { startX, startY, endX, endY } = pipe;

    if (pipe.startElementId === newElement.id && pipe.startPortIndex !== undefined && newPorts[pipe.startPortIndex]) {
      ({ x: startX, y: startY } = newPorts[pipe.startPortIndex]);
    } else if (pipe.startElementId === undefined) {
      for (let i = 0; i < oldPorts.length; i++) {
        if (Math.hypot(startX - oldPorts[i].x, startY - oldPorts[i].y) < PORT_MATCH) {
          ({ x: startX, y: startY } = newPorts[i]);
          break;
        }
      }
    }

    if (pipe.endElementId === newElement.id && pipe.endPortIndex !== undefined && newPorts[pipe.endPortIndex]) {
      ({ x: endX, y: endY } = newPorts[pipe.endPortIndex]);
    } else if (pipe.endElementId === undefined) {
      for (let i = 0; i < oldPorts.length; i++) {
        if (Math.hypot(endX - oldPorts[i].x, endY - oldPorts[i].y) < PORT_MATCH) {
          ({ x: endX, y: endY } = newPorts[i]);
          break;
        }
      }
    }

    return { ...pipe, startX, startY, endX, endY };
  });
}

interface Clipboard {
  elements: CanvasElement[];
  pipes: PipeElement[];
}

interface HistoryEntry {
  elements: CanvasElement[];
  pipes: PipeElement[];
  annotations: AnnotationElement[];
}

export interface DcvAssemblySpec {
  /** Ordered nearest-the-fixture first (i.e. most downstream first). */
  elements: CanvasElement[];
  targetPipeId: string | null;
  snapX: number;
  snapY: number;
}

/** Inserts one or more backflow-protection assemblies (e.g. Gate Valve + 2 Check
 *  Valves, or Vacuum Breaker + Check Valve), truncating each assembly's target
 *  pipe (if any) to end at its outermost element's inlet. */
function applyDcvAssemblies(
  state: { elements: CanvasElement[]; pipes: PipeElement[] },
  assemblies: DcvAssemblySpec[],
): { elements: CanvasElement[]; pipes: PipeElement[] } {
  let elements = state.elements;
  let pipes = state.pipes;
  for (const { elements: asmEls, targetPipeId, snapX, snapY } of assemblies) {
    elements = [...elements, ...asmEls];
    if (targetPipeId) {
      const orig = pipes.find((p) => p.id === targetPipeId);
      if (orig) {
        const pipeA = derivePipe(orig, { startX: orig.startX, startY: orig.startY, endX: snapX, endY: snapY, diameterLabel: orig.diameterLabel });
        pipes = [...pipes.filter((p) => p.id !== targetPipeId), pipeA];
      }
    }
  }
  return { elements, pipes };
}

const MAX_HISTORY = 50;

interface CanvasStore {
  elements: CanvasElement[];
  pipes: PipeElement[];
  annotations: AnnotationElement[];
  selectedId: string | null;
  selectedIds: string[];            // selected element IDs (multi-select)
  selectedPipeIds: string[];        // selected pipe IDs (multi-select)
  selectedAnnotationIds: string[];  // selected annotation IDs (multi-select)
  clipboard: Clipboard | null;
  history: HistoryEntry[];
  future: HistoryEntry[];

  // Selection
  setSelected: (id: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  setMultiSelection: (elementIds: string[], pipeIds: string[], annotationIds?: string[]) => void;

  // Canvas mutations
  addElement: (el: CanvasElement) => void;
  loadTemplate: (elements: CanvasElement[], pipes: PipeElement[]) => void;
  loadSchematic: (elements: CanvasElement[], pipes: PipeElement[], annotations?: AnnotationElement[]) => void;
  appendTemplate: (elements: CanvasElement[], pipes: PipeElement[], annotations?: AnnotationElement[]) => void;
  updateElementPosition: (id: string, x: number, y: number) => void;
  moveElement: (id: string, newX: number, newY: number) => void;
  moveMultiple: (elementIds: string[], dx: number, dy: number, pipeIds?: string[], annotationIds?: string[]) => void;
  /** Sets (or, with `null`, resets to "Automatic") the color override for every pipe id given. */
  setPipesCustomColor: (pipeIds: string[], customColor: string | null) => void;
  /** Sets (or, with `null`, clears) the diameter label for every pipe id given. */
  setPipesDiameterLabel: (pipeIds: string[], diameterLabel: string | null) => void;
  updateElementRotation: (id: string, rotation: number) => void;
  updateElementScaleX: (id: string, scaleX: number) => void;
  updateFittingType: (id: string, fittingType: string) => void;
  updateEfficiencyRating: (id: string, rating: 1 | 2 | 3 | 4) => void;
  updateLongBathCapacity: (id: string, capacityL: number) => void;
  updatePumpRatedHead: (id: string, headM: number | undefined) => void;
  updateHighestFittingElevation: (id: string, elevationM: number | undefined) => void;
  addPipe: (pipe: PipeElement) => void;
  updatePipeEndpoints: (id: string, startX: number, startY: number, endX: number, endY: number) => void;
  insertElementOnPipe: (pipeId: string, element: CanvasElement, snapX: number, snapY: number, terminatePipe?: boolean) => void;
  insertElementOnPipeInline: (pipeId: string, element: CanvasElement, inletPos: { x: number; y: number }, outletPos: { x: number; y: number }) => void;
  insertDcvAssemblies: (assemblies: DcvAssemblySpec[]) => void;
  removeElement: (id: string) => void;
  removePipe: (id: string) => void;
  removeMultiple: (elementIds: string[], pipeIds: string[], annotationIds?: string[]) => void;
  clearCanvas: () => void;
  updateTankProperties: (id: string, props: Partial<TankProperties>) => void;
  updateElementDimensions: (id: string, width: number, height: number) => void;
  updateCarriesFluid: (id: string, fluid: 'cold' | 'hot' | undefined) => void;
  // Annotations
  addAnnotation: (ann: Omit<AnnotationElement, 'height'> & { height?: number }) => void;
  moveAnnotation: (id: string, x: number, y: number) => void;
  removeAnnotation: (id: string) => void;
  removeAnnotations: (ids: string[]) => void;
  updateAnnotation: (id: string, text: string, maxWidth?: number) => void;
  updateAnnotationSize: (id: string, height: number) => void;
  resizeAnnotation: (id: string, maxWidth: number, height: number) => void;

  // Scale/paper-size change — resize all content proportionally, anchored to
  // canvas bottom (lowerMRL). oldVirtualHeight/newVirtualHeight let the anchor
  // itself move (paper size change) independently of the drawing-scale factor.
  rescaleAll: (oldScale: number, newScale: number, oldVirtualHeight: number, newVirtualHeight: number) => void;

  // Copy-paste
  copySelection: () => void;
  pasteClipboard: (target?: { x: number; y: number }) => void;
  mirrorSelection: (axis: 'horizontal' | 'vertical') => void;
  setDualSupply: (id: string, enabled: boolean) => void;
  setSwapDualSupply: (id: string, swapped: boolean) => void;

  // Undo-redo
  undo: () => void;
  redo: () => void;
}

export const useCanvasStore = create<CanvasStore>()(persist((set, get) => {
  // Save current elements+pipes+annotations to history before a mutation.
  const pushHistory = () => {
    const { elements, pipes, annotations, history } = get();
    set({
      history: [...history.slice(-(MAX_HISTORY - 1)), { elements, pipes, annotations }],
      future: [],
    });
  };

  return {
    elements: [],
    pipes: [],
    annotations: [],
    selectedId: null,
    selectedIds: [],
    selectedPipeIds: [],
    selectedAnnotationIds: [],
    clipboard: null,
    history: [],
    future: [],

    // ── Selection ────────────────────────────────────────────────────────────

    setSelected: (id) =>
      set({ selectedId: id, selectedIds: [], selectedPipeIds: [], selectedAnnotationIds: [] }),

    setSelectedIds: (ids) =>
      set({ selectedIds: ids, selectedId: null, selectedPipeIds: [], selectedAnnotationIds: [] }),

    // Atomically set element, pipe, and annotation selections (used by rubber band).
    setMultiSelection: (elementIds, pipeIds, annotationIds = []) =>
      set({ selectedIds: elementIds, selectedPipeIds: pipeIds, selectedAnnotationIds: annotationIds, selectedId: null }),

    // ── Canvas mutations ─────────────────────────────────────────────────────

    addElement: (el) => {
      pushHistory();
      set((state) => ({ elements: [...state.elements, el] }));
    },

    loadTemplate: (elements, pipes) => {
      pushHistory();
      set({ elements, pipes, selectedId: null, selectedIds: [], selectedPipeIds: [] });
    },

    loadSchematic: (elements, pipes, annotations = []) => {
      pushHistory();
      set({
        elements,
        pipes,
        annotations,
        selectedId: null,
        selectedIds: [],
        selectedPipeIds: [],
        selectedAnnotationIds: [],
      });
    },

    appendTemplate: (elements, pipes, annotations = []) => {
      pushHistory();
      set((state) => ({
        elements: [...state.elements, ...elements],
        pipes: [...state.pipes, ...pipes],
        annotations: [...state.annotations, ...annotations],
        selectedId: null,
        selectedIds: [],
        selectedPipeIds: [],
      }));
    },

    updateElementPosition: (id, x, y) =>
      set((state) => ({
        elements: state.elements.map((el) => el.id === id ? { ...el, x, y } : el),
      })),

    moveElement: (id, newX, newY) => {
      pushHistory();
      set((state) => {
        const oldEl = state.elements.find((e) => e.id === id);
        if (!oldEl) return {};
        const newEl = { ...oldEl, x: newX, y: newY };
        return {
          elements: state.elements.map((e) => e.id === id ? newEl : e),
          pipes: syncConnectedPipeEndpoints(state.pipes, oldEl, newEl),
        };
      });
    },

    moveMultiple: (elementIds, dx, dy, pipeIds = [], annotationIds = []) => {
      pushHistory();
      set((state) => {
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return {};
        const idSet = new Set(elementIds);
        const pipeIdSet = new Set(pipeIds);
        const annIdSet = new Set(annotationIds);
        const selectedEls = state.elements.filter((e) => idSet.has(e.id));

        const newElements = state.elements.map((el) =>
          idSet.has(el.id) ? { ...el, x: el.x + dx, y: el.y + dy } : el
        );

        let newPipes = state.pipes.map((pipe) =>
          pipeIdSet.has(pipe.id)
            ? { ...pipe, startX: pipe.startX + dx, startY: pipe.startY + dy, endX: pipe.endX + dx, endY: pipe.endY + dy }
            : pipe
        );

        for (const oldEl of selectedEls) {
          const newEl = newElements.find((e) => e.id === oldEl.id)!;
          newPipes = syncConnectedPipeEndpoints(newPipes, oldEl, newEl);
        }

        const newAnnotations = state.annotations.map((a) =>
          annIdSet.has(a.id) ? { ...a, x: a.x + dx, y: a.y + dy } : a
        );

        return { elements: newElements, pipes: newPipes, annotations: newAnnotations };
      });
    },

    setPipesCustomColor: (pipeIds, customColor) => {
      pushHistory();
      set((state) => {
        const idSet = new Set(pipeIds);
        return {
          pipes: state.pipes.map((p) =>
            idSet.has(p.id) ? { ...p, customColor: customColor === null ? undefined : customColor } : p
          ),
        };
      });
    },

    setPipesDiameterLabel: (pipeIds, diameterLabel) => {
      pushHistory();
      set((state) => {
        const idSet = new Set(pipeIds);
        return {
          pipes: state.pipes.map((p) =>
            idSet.has(p.id) ? { ...p, diameterLabel: diameterLabel === null ? undefined : diameterLabel } : p
          ),
        };
      });
    },

    updateElementRotation: (id, rotation) => {
      pushHistory();
      set((state) => {
        const oldEl = state.elements.find((e) => e.id === id);
        if (!oldEl) return {};
        const newEl = { ...oldEl, rotation };
        return {
          elements: state.elements.map((e) => e.id === id ? newEl : e),
          pipes: syncConnectedPipeEndpoints(state.pipes, oldEl, newEl),
        };
      });
    },

    updateElementScaleX: (id, scaleX) => {
      pushHistory();
      set((state) => {
        const oldEl = state.elements.find((e) => e.id === id);
        if (!oldEl) return {};
        const newEl = { ...oldEl, scaleX };
        return {
          elements: state.elements.map((e) => e.id === id ? newEl : e),
          pipes: syncConnectedPipeEndpoints(state.pipes, oldEl, newEl),
        };
      });
    },

    updateFittingType: (id, fittingType) => {
      pushHistory();
      set((state) => ({ elements: state.elements.map((el) => el.id === id ? { ...el, fittingType } : el) }));
    },

    updateEfficiencyRating: (id, efficiencyRating) => {
      pushHistory();
      set((state) => ({ elements: state.elements.map((el) => el.id === id ? { ...el, efficiencyRating } : el) }));
    },

    updateLongBathCapacity: (id, longBathCapacityL) => {
      pushHistory();
      set((state) => ({ elements: state.elements.map((el) => el.id === id ? { ...el, longBathCapacityL } : el) }));
    },

    updatePumpRatedHead: (id, pumpRatedHeadM) => {
      pushHistory();
      set((state) => ({ elements: state.elements.map((el) => el.id === id ? { ...el, pumpRatedHeadM } : el) }));
    },

    updateHighestFittingElevation: (id, highestFittingElevationM) => {
      pushHistory();
      set((state) => ({ elements: state.elements.map((el) => el.id === id ? { ...el, highestFittingElevationM } : el) }));
    },

    addPipe: (pipe) => {
      pushHistory();
      set((state) => ({ pipes: [...state.pipes, pipe] }));
    },

    updatePipeEndpoints: (id, startX, startY, endX, endY) =>
      set((state) => ({
        pipes: state.pipes.map((p) => p.id === id ? { ...p, startX, startY, endX, endY } : p),
      })),

    insertElementOnPipe: (pipeId, element, snapX, snapY, terminatePipe = false) => {
      pushHistory();
      set((state) => {
        const orig = state.pipes.find((p) => p.id === pipeId);
        if (!orig) return { elements: [...state.elements, element] };
        const portIndex = findElementPortIndexAt(element, snapX, snapY);
        const pipeA = derivePipe(orig, {
          startX: orig.startX, startY: orig.startY, endX: snapX, endY: snapY,
          startElementId: orig.startElementId, startPortIndex: orig.startPortIndex,
          endElementId: element.id, endPortIndex: portIndex,
          diameterLabel: orig.diameterLabel,
        });
        const newPipes = terminatePipe
          ? [...state.pipes.filter((p) => p.id !== pipeId), pipeA]
          : [...state.pipes.filter((p) => p.id !== pipeId), pipeA, derivePipe(orig, {
              startX: snapX, startY: snapY, endX: orig.endX, endY: orig.endY,
              startElementId: element.id, startPortIndex: portIndex,
              endElementId: orig.endElementId, endPortIndex: orig.endPortIndex,
              // diameterLabel intentionally omitted — keeping it here too would duplicate
              // the "ØXXmm" label right next to the newly inserted element (see derivePipe).
            })];
        return { elements: [...state.elements, element], pipes: newPipes };
      });
    },

    insertElementOnPipeInline: (pipeId, element, inletPos, outletPos) => {
      pushHistory();
      set((state) => {
        const orig = state.pipes.find((p) => p.id === pipeId);
        if (!orig) return { elements: [...state.elements, element] };
        const origDx = orig.endX - orig.startX;
        const origDy = orig.endY - orig.startY;
        const newPipes: PipeElement[] = state.pipes.filter((p) => p.id !== pipeId);
        const inletPortIndex = findElementPortIndexAt(element, inletPos.x, inletPos.y);
        const outletPortIndex = findElementPortIndexAt(element, outletPos.x, outletPos.y);
        const pipeALen = Math.hypot(inletPos.x - orig.startX, inletPos.y - orig.startY);
        if (pipeALen > 1) newPipes.push(derivePipe(orig, {
          startX: orig.startX, startY: orig.startY, endX: inletPos.x, endY: inletPos.y,
          startElementId: orig.startElementId, startPortIndex: orig.startPortIndex,
          endElementId: element.id, endPortIndex: inletPortIndex,
          diameterLabel: orig.diameterLabel,
        }));
        const pipeBdx = orig.endX - outletPos.x;
        const pipeBdy = orig.endY - outletPos.y;
        const pipeBLen = Math.hypot(pipeBdx, pipeBdy);
        const sameDir = pipeBdx * origDx + pipeBdy * origDy >= 0;
        if (pipeBLen > 1 && sameDir) newPipes.push(derivePipe(orig, {
          startX: outletPos.x, startY: outletPos.y, endX: orig.endX, endY: orig.endY,
          startElementId: element.id, startPortIndex: outletPortIndex,
          endElementId: orig.endElementId, endPortIndex: orig.endPortIndex,
          // diameterLabel intentionally omitted — keeping it here too would duplicate
          // the "ØXXmm" label right next to the newly inserted element (see derivePipe).
        }));
        return { elements: [...state.elements, element], pipes: newPipes };
      });
    },

    // Inserts one or more Gate Valve + 2 Check Valve assemblies (e.g. a dual-supply
    // fitting needs one on each of its Hot/Cold upstream ports) as a single atomic
    // history entry so one undo reverts the whole thing.
    insertDcvAssemblies: (assemblies) => {
      if (assemblies.length === 0) return;
      pushHistory();
      set((state) => applyDcvAssemblies(state, assemblies));
    },

    removeElement: (id) => {
      pushHistory();
      set((state) => ({
        elements: state.elements.filter((el) => el.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
        selectedIds: state.selectedIds.filter((sid) => sid !== id),
        selectedPipeIds: state.selectedPipeIds,
      }));
    },

    removePipe: (id) => {
      pushHistory();
      set((state) => ({
        pipes: state.pipes.filter((p) => p.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
        selectedIds: state.selectedIds.filter((sid) => sid !== id),
        selectedPipeIds: state.selectedPipeIds.filter((sid) => sid !== id),
      }));
    },

    removeMultiple: (elementIds, pipeIds, annotationIds = []) => {
      if (elementIds.length === 0 && pipeIds.length === 0 && annotationIds.length === 0) return;
      pushHistory();
      const elSet  = new Set(elementIds);
      const pSet   = new Set(pipeIds);
      const annSet = new Set(annotationIds);
      set((state) => ({
        elements:             state.elements.filter((el) => !elSet.has(el.id)),
        pipes:                state.pipes.filter((p)  => !pSet.has(p.id)),
        annotations:          state.annotations.filter((a) => !annSet.has(a.id)),
        selectedId:           elSet.has(state.selectedId ?? '') || pSet.has(state.selectedId ?? '') ? null : state.selectedId,
        selectedIds:          [],
        selectedPipeIds:      [],
        selectedAnnotationIds: [],
      }));
    },

    clearCanvas: () => {
      pushHistory();
      set({ elements: [], pipes: [], annotations: [], selectedId: null, selectedIds: [], selectedPipeIds: [], selectedAnnotationIds: [] });
    },

    updateTankProperties: (id, props) => {
      pushHistory();
      set((state) => ({
        elements: state.elements.map((el) =>
          el.id === id ? { ...el, tankProperties: { ...(el.tankProperties ?? {}), ...props } } : el
        ),
      }));
    },

    updateElementDimensions: (id, width, height) => {
      pushHistory();
      set((state) => ({
        elements: state.elements.map((el) =>
          el.id === id ? { ...el, width, height } : el
        ),
      }));
    },

    updateCarriesFluid: (id, fluid) =>
      set((state) => ({
        elements: state.elements.map((el) => el.id === id ? { ...el, carriesFluid: fluid } : el),
      })),

    addAnnotation: (ann) => {
      pushHistory();
      const annotationWithHeight: AnnotationElement = { height: ann.fontSize * 1.35 * 2, ...ann };
      set((state) => ({ annotations: [...state.annotations, annotationWithHeight] }));
    },

    moveAnnotation: (id, x, y) =>
      set((state) => ({
        annotations: state.annotations.map((a) => a.id === id ? { ...a, x, y } : a),
      })),

    updateAnnotation: (id, text, maxWidth) =>
      set((state) => ({
        annotations: state.annotations.map((a) =>
          a.id === id ? { ...a, text, ...(maxWidth !== undefined && { maxWidth }) } : a
        ),
      })),

    updateAnnotationSize: (id, height) =>
      set((state) => ({
        annotations: state.annotations.map((a) =>
          a.id === id ? { ...a, height } : a
        ),
      })),

    resizeAnnotation: (id, maxWidth, height) => {
      pushHistory();
      set((state) => ({
        annotations: state.annotations.map((a) =>
          a.id === id ? { ...a, maxWidth, height } : a
        ),
      }));
    },

    removeAnnotation: (id) => {
      pushHistory();
      set((state) => ({
        annotations: state.annotations.filter((a) => a.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
      }));
    },

    removeAnnotations: (ids) => {
      if (ids.length === 0) return;
      pushHistory();
      const idSet = new Set(ids);
      set((state) => ({
        annotations: state.annotations.filter((a) => !idSet.has(a.id)),
        selectedAnnotationIds: [],
        selectedId: idSet.has(state.selectedId ?? '') ? null : state.selectedId,
      }));
    },

    rescaleAll: (oldScale, newScale, oldVirtualHeight, newVirtualHeight) => {
      const { elements, pipes } = get();
      if (elements.length === 0 && pipes.length === 0) return;
      // factor < 1 when scale increases (1:100→1:200): content compresses
      const factor = oldScale / newScale;
      pushHistory();
      set((state) => ({
        elements: state.elements.map((el) => ({
          ...el,
          x: AXIS_WIDTH + (el.x - AXIS_WIDTH) * factor,
          // anchor y at canvas bottom (= lowerMRL) so elevations are preserved —
          // measured from the OLD bottom, reapplied from the NEW bottom, so a
          // paper-size change (which moves the bottom) doesn't shift elevations
          y: newVirtualHeight - (oldVirtualHeight - el.y) * factor,
          // width/height are fixed paper-size — not scaled with drawing scale
        })),
        pipes: state.pipes.map((p) => ({
          ...p,
          startX: AXIS_WIDTH + (p.startX - AXIS_WIDTH) * factor,
          startY: newVirtualHeight - (oldVirtualHeight - p.startY) * factor,
          endX:   AXIS_WIDTH + (p.endX   - AXIS_WIDTH) * factor,
          endY:   newVirtualHeight - (oldVirtualHeight - p.endY)   * factor,
        })),
      }));
    },

    // ── Copy-paste ───────────────────────────────────────────────────────────

    copySelection: () => {
      const state = get();
      const elementIds = state.selectedIds.length > 0
        ? new Set(state.selectedIds)
        : state.selectedId ? new Set([state.selectedId]) : new Set<string>();

      const selectedEls = state.elements.filter((el) => elementIds.has(el.id));

      // Pipes: include explicitly selected pipe IDs, plus any between selected elements
      const explicitPipeIds = new Set(state.selectedPipeIds);
      const MATCH = 8;
      const selectedPortPositions: { x: number; y: number }[] = [];
      for (const el of selectedEls) {
        const ports = getElementPorts(el);
        for (const port of ports) {
          selectedPortPositions.push(getPortPosition(el, port));
        }
      }
      const isNearSelectedPort = (x: number, y: number) =>
        selectedPortPositions.some((p) => Math.hypot(p.x - x, p.y - y) < MATCH);

      const selectedPipes = state.pipes.filter((pipe) =>
        explicitPipeIds.has(pipe.id) ||
        (isNearSelectedPort(pipe.startX, pipe.startY) && isNearSelectedPort(pipe.endX, pipe.endY))
      );

      if (selectedEls.length === 0 && selectedPipes.length === 0) return;
      set({ clipboard: { elements: selectedEls, pipes: selectedPipes } });
    },

    pasteClipboard: (target?: { x: number; y: number }) => {
      const state = get();
      if (!state.clipboard || (state.clipboard.elements.length === 0 && state.clipboard.pipes.length === 0)) return;
      pushHistory();

      let dx = 40;
      let dy = 40;
      if (target && (state.clipboard.elements.length > 0 || state.clipboard.pipes.length > 0)) {
        // Compute bounding-box center of the clipboard group
        const xs: number[] = [];
        const ys: number[] = [];
        for (const el of state.clipboard.elements) { xs.push(el.x); ys.push(el.y); }
        for (const p of state.clipboard.pipes) {
          xs.push(p.startX, p.endX);
          ys.push(p.startY, p.endY);
        }
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        dx = target.x - cx;
        dy = target.y - cy;
      }

      const idMap = new Map<string, string>();
      const newElements: CanvasElement[] = state.clipboard.elements.map((el) => {
        const newId = crypto.randomUUID();
        idMap.set(el.id, newId);
        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
      });
      // Pipe endpoint element references only make sense if the referenced element
      // was copied too (and thus has a mapped new id) — otherwise drop to "unbound".
      const newPipes: PipeElement[] = state.clipboard.pipes.map((pipe) => ({
        ...pipe,
        id: crypto.randomUUID(),
        startX: pipe.startX + dx, startY: pipe.startY + dy, endX: pipe.endX + dx, endY: pipe.endY + dy,
        startElementId: pipe.startElementId ? idMap.get(pipe.startElementId) : undefined,
        endElementId: pipe.endElementId ? idMap.get(pipe.endElementId) : undefined,
      }));
      set({
        elements: [...state.elements, ...newElements],
        pipes: [...state.pipes, ...newPipes],
        selectedIds: newElements.map((el) => el.id),
        selectedPipeIds: newPipes.map((p) => p.id),
        selectedId: null,
      });
    },

    mirrorSelection: (axis) => {
      const state = get();
      const elIds = new Set(state.selectedIds);
      const pipeIds = new Set(state.selectedPipeIds);
      const annIds = new Set(state.selectedAnnotationIds);
      if (elIds.size === 0 && pipeIds.size === 0 && annIds.size === 0) return;

      const selectedEls = state.elements.filter((el) => elIds.has(el.id));
      const selectedPipes = state.pipes.filter((p) => pipeIds.has(p.id));
      const selectedAnns = state.annotations.filter((a) => annIds.has(a.id));

      // Compute bounding box of selected elements (by position) + selected pipe endpoints
      const xs: number[] = [];
      const ys: number[] = [];
      for (const el of selectedEls) { xs.push(el.x); ys.push(el.y); }
      for (const p of selectedPipes) { xs.push(p.startX, p.endX); ys.push(p.startY, p.endY); }
      for (const a of selectedAnns) { xs.push(a.x); ys.push(a.y); }
      if (xs.length === 0) return;

      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

      pushHistory();
      set((s) => {
        const updatedElements = s.elements.map((el) => {
          if (!elIds.has(el.id)) return el;
          // Negating rotation is required because Konva applies scale BEFORE rotation
          // in world space. Without it, scaleX=-1 on a 90° element causes a vertical
          // flip instead of a horizontal one (and vice versa for vertical mirror).
          const newRotation = (360 - el.rotation) % 360;
          if (axis === 'horizontal') {
            return { ...el, x: 2 * centerX - el.x, rotation: newRotation, scaleX: (el.scaleX ?? 1) * -1 };
          } else {
            return { ...el, y: 2 * centerY - el.y, rotation: newRotation };
          }
        });

        const updatedPipes = s.pipes.map((pipe) => {
          if (!pipeIds.has(pipe.id)) return pipe;
          if (axis === 'horizontal') {
            return { ...pipe, startX: 2 * centerX - pipe.startX, endX: 2 * centerX - pipe.endX };
          } else {
            return { ...pipe, startY: 2 * centerY - pipe.startY, endY: 2 * centerY - pipe.endY };
          }
        });

        const updatedAnnotations = s.annotations.map((ann) => {
          if (!annIds.has(ann.id)) return ann;
          if (axis === 'horizontal') {
            return { ...ann, x: 2 * centerX - ann.x };
          } else {
            return { ...ann, y: 2 * centerY - ann.y };
          }
        });

        return { elements: updatedElements, pipes: updatedPipes, annotations: updatedAnnotations };
      });
    },

    setDualSupply: (id, enabled) => {
      pushHistory();
      set((state) => ({
        elements: state.elements.map((el) => el.id === id ? { ...el, dualSupply: enabled } : el),
      }));
    },

    setSwapDualSupply: (id, swapped) => {
      pushHistory();
      set((state) => ({
        elements: state.elements.map((el) => el.id === id ? { ...el, swapDualSupply: swapped } : el),
      }));
    },

    // ── Undo / Redo ──────────────────────────────────────────────────────────

    undo: () => {
      const { history, elements, pipes, annotations, future } = get();
      if (history.length === 0) return;
      const prev = history[history.length - 1];
      set({
        history: history.slice(0, -1),
        future: [{ elements, pipes, annotations }, ...future.slice(0, MAX_HISTORY - 1)],
        elements: prev.elements,
        pipes: prev.pipes,
        annotations: prev.annotations,
        selectedId: null,
        selectedIds: [],
        selectedPipeIds: [],
        selectedAnnotationIds: [],
      });
    },

    redo: () => {
      const { history, elements, pipes, annotations, future } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        future: future.slice(1),
        history: [...history.slice(-(MAX_HISTORY - 1)), { elements, pipes, annotations }],
        elements: next.elements,
        pipes: next.pipes,
        annotations: next.annotations,
        selectedId: null,
        selectedIds: [],
        selectedPipeIds: [],
        selectedAnnotationIds: [],
      });
    },
  };
}, {
  name: 'schematic-canvas',
  version: 2,
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    elements:          state.elements,
    pipes:             state.pipes,
    annotations:       state.annotations,
  }),
  migrate: (_persisted, version) => {
    // Version mismatch (schema changed) — discard saved data and start fresh
    if (version < 1) return {} as CanvasStore;
    if (version === 1) {
      const p = _persisted as {
        annotations?: Array<{ fontSize: number; height?: number } & Record<string, unknown>>;
        [key: string]: unknown;
      };
      return {
        ...p,
        annotations: (p.annotations ?? []).map((a) => ({
          ...a,
          height: a.height ?? a.fontSize * 1.35 * 2,
        })),
      } as unknown as CanvasStore;
    }
    return _persisted as CanvasStore;
  },
}));

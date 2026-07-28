import { CanvasElement } from '../types';

/**
 * Canonical "is this port connected" distance threshold, in px. Shared by
 * portConnectionStatus.ts (pre-export warning), metadataBuilder.ts (export-time
 * port-to-pipe matching), and ChatWindow.tsx (Evaluate-tab pre-check) so the
 * three can't independently drift on what "connected" means.
 */
export const PORT_MATCH_THRESHOLD_PX = 2;

export interface SymbolPortDef {
  role: 'upstream' | 'downstream';
  offsetX: number;
  offsetY: number;
  label?: string;
  /** Enforce a minimum canvas-space |offsetX| in px.
   *  Must be > PORT_MATCH_THRESHOLD_PX so a center-placed pipe cannot
   *  accidentally satisfy both dual supply ports. */
  minCanvasOffsetX?: number;
}

const SYMBOL_SIZE = 48;

/**
 * Returns the effective port offset (in px) for an element, accounting for
 * custom width/height on symbols that can be scaled (e.g. water_tank).
 */
export function getScaledPortOffset(
  symbolId: string,
  port: SymbolPortDef,
  width: number | undefined,
  height: number | undefined,
  scaleX = 1,
): { ox: number; oy: number } {
  const w = width ?? SYMBOL_SIZE;
  const h = height ?? SYMBOL_SIZE;
  let ox = port.offsetX * (w / SYMBOL_SIZE) * scaleX;
  if (port.minCanvasOffsetX !== undefined && port.offsetX !== 0) {
    const sign = port.offsetX > 0 ? 1 : -1;
    ox = sign * Math.max(Math.abs(ox), port.minCanvasOffsetX);
  }
  return { ox, oy: port.offsetY * (h / SYMBOL_SIZE) };
}

// ─── Port registry (offsets in px from element centre; symbol size = 48px) ───

export const SYMBOL_PORTS: Record<string, SymbolPortDef[]> = {
  gate_valve: [
    { role: 'upstream',   offsetX: -24, offsetY:   0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY:   0, label: 'Output' },
  ],
  check_valve: [
    { role: 'upstream',   offsetX: -24, offsetY:   0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY:   0, label: 'Output' },
  ],
  pump: [
    { role: 'upstream',   offsetX: -10, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  12, offsetY: 0, label: 'Output' },
  ],
  tee_junction: [
    { role: 'upstream',   offsetX: -24, offsetY:   0, label: 'in'  },
    { role: 'downstream', offsetX:  24, offsetY:   0, label: 'out' },
    { role: 'downstream', offsetX:   0, offsetY:  24, label: 'out' },
  ],
  water_tank: [
    { role: 'upstream',   offsetX: -22, offsetY: -18, label: 'Input'  },  // top-left  (inlet) — -18 aligns with SVG body top (y=8 in 64px viewBox → -24*(48/64) = -18 in 48px ref)
    { role: 'downstream', offsetX:  22, offsetY:  18, label: 'Output' },  // bottom-right (outlet)
  ],
  water_heater: [
    { role: 'upstream',   offsetX: -24, offsetY:   0, label: 'Input'  },  // left side (inlet)
    { role: 'downstream', offsetX:  24, offsetY:   0, label: 'Output' },  // right side (outlet)
  ],
  instantaneous_water_heater: [
    { role: 'upstream',   offsetX: -24, offsetY:   0, label: 'Input'  },  // left side (inlet)
    { role: 'downstream', offsetX:  24, offsetY:   0, label: 'Output' },  // right side (outlet)
  ],
  elbow_bend: [
    { role: 'upstream',   offsetX: -22, offsetY: -22, label: 'Input'  },  // top-left end of horizontal stub
    { role: 'downstream', offsetX:  22, offsetY:  22, label: 'Output' },  // bottom-right end of vertical stub
  ],
  flow_meter: [
    { role: 'upstream',   offsetX: -24, offsetY:   0 },
    { role: 'downstream', offsetX:  24, offsetY:   0 },
  ],
  water_meter: [
    { role: 'upstream',   offsetX: -24, offsetY:   0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY:   0, label: 'Output' },
  ],
  // ── Fixtures (terminal – upstream port only) ─────────────────────────────────
  single_tap: [
    { role: 'upstream', offsetX: 4, offsetY: -24 },
  ],
  single_tap_combined: [
    { role: 'upstream', offsetX: -16, offsetY: -24, label: 'Hot'  },
    { role: 'upstream', offsetX:  16, offsetY: -24, label: 'Cold' },
  ],
  twin_tap: [
    { role: 'upstream', offsetX: 3, offsetY: -20 },
  ],
  shower_head: [
    { role: 'upstream', offsetX: 0, offsetY: -24 },
  ],
  drinking_fountain_pedestal: [
    { role: 'upstream', offsetX: 0, offsetY: -24 },
  ],
  drinking_fountain_trough: [
    { role: 'upstream', offsetX: 0, offsetY: -8 },
  ],
  drinking_fountain_wall: [
    { role: 'upstream', offsetX: 0, offsetY: -8 },
  ],
  water_closet: [
    { role: 'upstream', offsetX: 0, offsetY: -24 },
  ],
  urinal_wall: [
    { role: 'upstream', offsetX: 2, offsetY: -10 },
  ],
  long_bath: [
    { role: 'upstream', offsetX: 0, offsetY: -24 },
  ],
  shower_bath: [
    { role: 'upstream', offsetX: 0, offsetY: -24 },
  ],

  // ── Inline valves (left upstream, right downstream) ──────────────────────────
  solenoid_valve: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  motorised_valve: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  globe_valve: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  prv_with_sensor: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  sub_meter: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  cold_water_tank: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  pressure_gauge_prv: [
    { role: 'upstream',   offsetX:   12, offsetY: -16, label: 'Input (top)'   },
    { role: 'downstream', offsetX:  24, offsetY:   0, label: 'Output (right)' },
  ],
  sight_glass: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  strainer: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],

  // ── Terminal valves (upstream left only) ─────────────────────────────────────
  cap_off_valve: [
    { role: 'upstream', offsetX: -24, offsetY: 0, label: 'Input' },
  ],

  // ── Branch / terminal (upstream bottom) ──────────────────────────────────────
  auto_air_relief_valve: [
    { role: 'upstream', offsetX: 0, offsetY: 24 },
  ],
  pressure_gauge_cock: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  water_hammer_absorber: [
    { role: 'upstream', offsetX: 0, offsetY: 24 },
  ],
  pressure_vessel_schematic: [
    { role: 'upstream', offsetX: 0, offsetY: 24 },
  ],
  water_tank_air_vent: [
    { role: 'upstream', offsetX: 0, offsetY: 24 },
  ],

  tap_point_schematic: [
    { role: 'upstream', offsetX: -14, offsetY: 4 },
  ],
  ball_float_valve: [
    { role: 'upstream', offsetX: -24, offsetY: 0 },
  ],

  // ── Branch / terminal (upstream left) ────────────────────────────────────────
  vortex_inhibitor_schematic: [
    { role: 'upstream', offsetX: 24, offsetY: 0 },
  ],

  // ── Section 6 — Hot water / contamination symbols ────────────────────────────
  pressure_relief_valve: [
    { role: 'upstream',   offsetX: 0, offsetY: -24, label: 'Input'  },
    { role: 'downstream', offsetX: 0, offsetY:  24, label: 'Output' },
  ],
  vacuum_breaker: [
    { role: 'upstream',   offsetX: 0, offsetY: -24, label: 'Input'  },
    { role: 'downstream', offsetX: 0, offsetY:  24, label: 'Output' },
  ],
  bidet_spray: [
    { role: 'upstream', offsetX: -24, offsetY: 0, label: 'Supply' },
  ],

  // ── Multi-port (left upstream, right downstream, bottom downstream) ──────────
  multiport_valve: [
    { role: 'upstream',   offsetX: -24, offsetY:  0, label: 'Input'   },
    { role: 'downstream', offsetX:  24, offsetY:  0, label: 'Output'  },
    { role: 'downstream', offsetX:   0, offsetY: 24, label: 'Branch'  },
  ],
  sampling_tap: [
    { role: 'upstream',   offsetX:   -16, offsetY: 20, label: 'Input'  },
    { role: 'downstream', offsetX:  18, offsetY:  0, label: 'Output' },
  ],

  y_type_strainer: [
    { role: 'upstream',   offsetX:  24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX: -24, offsetY: 0, label: 'Output' },
  ],
  pipe_blank_off: [
    { role: 'upstream', offsetX: -24, offsetY: 0, label: 'Input' },
  ],
  flexible_connection: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],

  // ── New fixtures ─────────────────────────────────────────────────────────────
  foot_bath: [
    { role: 'upstream', offsetX: 0, offsetY: -24, label: 'Supply' },
  ],
  multiple_show_unit: [
    { role: 'upstream', offsetX: 0, offsetY: -24, label: 'Supply' },
  ],
  square_bath: [
    { role: 'upstream', offsetX: 0, offsetY: -24, label: 'Supply' },
  ],
  sink: [
    { role: 'upstream', offsetX: 0, offsetY: -24, label: 'Supply' },
  ],
  wash_basin_rectangular: [
    { role: 'upstream', offsetX: -3, offsetY: -24, label: 'Supply' },
  ],

  puddle_flange: [
    { role: 'upstream',   offsetX: -24, offsetY: 0, label: 'Input'  },
    { role: 'downstream', offsetX:  24, offsetY: 0, label: 'Output' },
  ],
  bib_tap_cw_cap_and_lock_schematic: [
    { role: 'upstream', offsetX: -24, offsetY: 0, label: 'Supply' },
  ],

  // ── SS636 §6.4 backflow-risk appliances ─────────────────────────────────────
  washing_machine: [
    { role: 'upstream', offsetX: 0, offsetY: -24, label: 'Supply' },
  ],
  dishwasher: [
    { role: 'upstream', offsetX: 0, offsetY: -24, label: 'Supply' },
  ],
  water_dispenser: [
    { role: 'upstream', offsetX: 0, offsetY: -24, label: 'Supply' },
  ],

  // ── Standalone (no pipe ports) ───────────────────────────────────────────────
  level_sensor_switch:    [],
  wc_ur_isolator:         [],
  vent_cowl_schematic:    [],
  control_panel:          [],
};

// ─── Dual supply port definitions ─────────────────────────────────────────────
// Symbols that support a per-instance dual hot+cold supply toggle.

export const DUAL_SUPPLY_SYMBOLS = new Set([
  'shower_head', 'long_bath', 'washing_machine', 'dishwasher',
  'shower_bath', 'square_bath', 'foot_bath', 'wash_basin_rectangular',
  'sink',
]);

const COLD_PORT = (offsetY = -24): SymbolPortDef => ({ role: 'upstream', offsetX: -16, offsetY, label: 'Cold', minCanvasOffsetX: 2 });
const HOT_PORT  = (offsetY = -24): SymbolPortDef => ({ role: 'upstream', offsetX:  16, offsetY, label: 'Hot',  minCanvasOffsetX: 2 });

const DUAL_SUPPLY_PORTS: Record<string, SymbolPortDef[]> = {
  shower_head:           [COLD_PORT(), HOT_PORT()],
  long_bath:             [COLD_PORT(), HOT_PORT()],
  washing_machine:       [COLD_PORT(), HOT_PORT()],
  dishwasher:            [COLD_PORT(), HOT_PORT()],
  shower_bath:           [COLD_PORT(), HOT_PORT()],
  square_bath:           [COLD_PORT(), HOT_PORT()],
  foot_bath:             [COLD_PORT(), HOT_PORT()],
  wash_basin_rectangular:[COLD_PORT(), HOT_PORT()],
  sink:                  [COLD_PORT(), HOT_PORT()],
};

const SWAPPED_LABELS: Record<string, string> = { Cold: 'Hot', Hot: 'Cold' };

/**
 * Returns the effective port definitions for an element, respecting the
 * per-instance dualSupply and swapDualSupply toggles for supported fixture symbols.
 */
export function getElementPorts(element: CanvasElement): SymbolPortDef[] {
  if (element.dualSupply && DUAL_SUPPLY_SYMBOLS.has(element.symbolId)) {
    const ports = DUAL_SUPPLY_PORTS[element.symbolId] ?? [];
    if (element.swapDualSupply) {
      return ports.map((p) => ({
        ...p,
        label: p.label !== undefined ? (SWAPPED_LABELS[p.label] ?? p.label) : p.label,
      }));
    }
    return ports;
  }
  return SYMBOL_PORTS[element.symbolId] ?? [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Rotate an offset vector clockwise by `rotation` degrees in screen space
 * (y-axis points down).  Designed for 0 / 90 / 180 / 270.
 */
export function rotateOffset(
  offsetX: number,
  offsetY: number,
  rotation: number
): { x: number; y: number } {
  // Exact cases for the four cardinal angles — avoids floating-point noise from
  // Math.cos/sin (e.g. cos(90°) isn't exactly 0) which previously required
  // rounding to whole pixels, introducing up to ~0.5px of port misalignment
  // (very visible once zoomed in, since symbols render at only a few px).
  switch (((rotation % 360) + 360) % 360) {
    case 90:  return { x: -offsetY, y: offsetX };
    case 180: return { x: -offsetX, y: -offsetY };
    case 270: return { x: offsetY, y: -offsetX };
    default: {
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return {
        x: offsetX * cos - offsetY * sin,
        y: offsetX * sin + offsetY * cos,
      };
    }
  }
}

/** Absolute canvas position of a port on a given element. */
export function getPortPosition(
  element: CanvasElement,
  port: SymbolPortDef
): { x: number; y: number } {
  const sx = element.scaleX ?? 1;
  const w = element.width ?? SYMBOL_SIZE;
  const h = element.height ?? SYMBOL_SIZE;

  // Water tank: pin Input to the AMSL ceiling (element top = -h/2),
  // Output to the AMSL floor (element bottom = +h/2).
  // element.height = heightM × pxPerM so these are exact AMSL positions.
  if (element.symbolId === 'water_tank') {
    const ox = port.offsetX * (w / SYMBOL_SIZE) * sx;
    let fixedOy: number | null = null;
    if (port.label === 'Input')  fixedOy = -h / 2;
    if (port.label === 'Output') fixedOy =  h / 2;
    if (fixedOy !== null) {
      const { x: rx, y: ry } = rotateOffset(ox, fixedOy, element.rotation);
      return { x: element.x + rx, y: element.y + ry };
    }
  }

  const { ox, oy } = getScaledPortOffset(element.symbolId, port, w, h, sx);
  const { x: rx, y: ry } = rotateOffset(ox, oy, element.rotation);
  return { x: element.x + rx, y: element.y + ry };
}

// ─── Per-instance role overrides (used for tee junction) ─────────────────────

/**
 * Returns the effective role of a port, respecting any per-instance override
 * set via element.upstreamPortIndex.
 */
export function getEffectivePortRole(
  element: CanvasElement,
  portIndex: number
): 'upstream' | 'downstream' {
  if (element.upstreamPortIndices !== undefined) {
    return element.upstreamPortIndices.includes(portIndex) ? 'upstream' : 'downstream';
  }
  if (element.upstreamPortIndex !== undefined) {
    return portIndex === element.upstreamPortIndex ? 'upstream' : 'downstream';
  }
  return getElementPorts(element)?.[portIndex]?.role ?? 'downstream';
}

/**
 * Returns the effective label for a port, reflecting any role override.
 */
export function getEffectivePortLabel(
  element: CanvasElement,
  portIndex: number
): string | undefined {
  const port = getElementPorts(element)?.[portIndex];
  if (!port?.label) return undefined;
  if (element.upstreamPortIndices !== undefined) {
    return element.upstreamPortIndices.includes(portIndex) ? 'in' : 'out';
  }
  if (element.upstreamPortIndex !== undefined) {
    return portIndex === element.upstreamPortIndex ? 'in' : 'out';
  }
  return port.label;
}

/** Index of the port on `element` closest to (x, y) — used to bind a newly
 *  created pipe endpoint to the port it was drawn/snapped onto. */
export function findElementPortIndexAt(element: CanvasElement, x: number, y: number): number | undefined {
  const ports = getElementPorts(element);
  let best: number | undefined;
  let bestDist = Infinity;
  for (let i = 0; i < ports.length; i++) {
    const pos = getPortPosition(element, ports[i]);
    const d = Math.hypot(pos.x - x, pos.y - y);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// ─── Port snap ────────────────────────────────────────────────────────────────

export interface NearestPortResult {
  elementId: string;
  portIndex: number;
  x: number;
  y: number;
  role: 'upstream' | 'downstream';
}

/**
 * Find the port closest to (cx, cy) within `threshold` px.
 *
 * When `preferLabel` is provided (e.g. 'Cold' or 'Hot'), ports whose label
 * matches are also searched within the wider `labelThreshold` px (default 16),
 * not just the normal (tighter) threshold. The closest candidate overall wins;
 * the labeled port is only preferred as a tie-break when it is at least as
 * close as the nearest generic port — it never overrides a generic port that
 * is physically nearer, so an unrelated port right under the cursor still
 * takes priority over a same-labeled port further away.
 */
export function findNearestPort(
  cx: number,
  cy: number,
  elements: CanvasElement[],
  threshold: number,
  preferLabel?: string,
  labelThreshold = 16,
): NearestPortResult | null {
  let best: NearestPortResult | null = null;
  let bestDist = threshold;
  let bestLabeled: NearestPortResult | null = null;
  let bestLabeledDist = labelThreshold;

  for (const el of elements) {
    const ports = getElementPorts(el);
    for (let i = 0; i < ports.length; i++) {
      const port = ports[i];
      const pos = getPortPosition(el, port);
      const d = Math.sqrt((cx - pos.x) ** 2 + (cy - pos.y) ** 2);
      if (preferLabel && port.label === preferLabel && d <= bestLabeledDist) {
        bestLabeledDist = d;
        bestLabeled = { elementId: el.id, portIndex: i, x: pos.x, y: pos.y, role: port.role };
      }
      if (d <= bestDist) {
        bestDist = d;
        best = { elementId: el.id, portIndex: i, x: pos.x, y: pos.y, role: port.role };
      }
    }
  }
  // Labeled port wins only when it is the closest candidate overall —
  // never override a generic port that is physically nearer.
  if (bestLabeled !== null && (best === null || bestLabeledDist <= bestDist)) {
    return bestLabeled;
  }
  return best;
}

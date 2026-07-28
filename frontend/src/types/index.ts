export type ActiveTool = 'select' | 'pipe' | 'cold_pipe' | 'hot_pipe';

// ── Sheet / drawing setup ─────────────────────────────────────────────────────

export type PaperSeries = 'ISO' | 'ANSI';
export type PaperSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4'
                      | 'ANSI_A' | 'ANSI_B' | 'ANSI_C' | 'ANSI_D' | 'ANSI_E';
export type DrawingScale = 20 | 25 | 50 | 100 | 200 | 500;

export const PAPER_SIZES_MM: Record<PaperSize, { w: number; h: number }> = {
  // ISO A-series (landscape)
  A0: { w: 1189, h: 841 },
  A1: { w: 841,  h: 594 },
  A2: { w: 594,  h: 420 },
  A3: { w: 420,  h: 297 },
  A4: { w: 297,  h: 210 },
  // ANSI series (landscape)
  ANSI_A: { w: 279, h: 216 },
  ANSI_B: { w: 432, h: 279 },
  ANSI_C: { w: 559, h: 432 },
  ANSI_D: { w: 864, h: 559 },
  ANSI_E: { w: 1118, h: 864 },
};

/** Base pixel density: 2 px per mm — used for both canvas display and content coordinates. */
export const SHEET_PX_PER_MM = 2;

/** Standard schematic symbol size: 3 mm on paper → 6 px at 2 px/mm. Fixed regardless of drawing scale. */
export const SYMBOL_SIZE_MM = 3;
export const SCHEMATIC_SYMBOL_PX = SYMBOL_SIZE_MM * SHEET_PX_PER_MM; // 6

/** Left-margin reserved for the MRL elevation axis (px). Exported so canvas store can use it. */
export const AXIS_WIDTH = 64;

/** Default annotation font size (schematic world units) before the user has ever picked one —
 *  shared between `AnnotationContextMenu.tsx` (its initial state) and `uiStore.ts` (the
 *  persisted "last used" default's own initial value) so the two can't drift apart. */
export const DEFAULT_ANNOTATION_FONT_SIZE = 3;

/** Highest Direct Supply Fitting marker's dynamic value label — shared by the canvas
 *  renderer (ElementsLayer.tsx) and the PDF exporter (pdfVectorExport.ts) so the two
 *  can't drift apart, same convention as the pipe styling constants in PipeElement.tsx. */
export const HIGHEST_FITTING_LABEL_FONT_SIZE = 2.2;
export const HIGHEST_FITTING_LABEL_COLOR = '#1a3a5c';

/**
 * Canvas-pixel size for symbols at a given drawing scale.
 * Fixed at SCHEMATIC_SYMBOL_PX (3 mm paper size) regardless of scale — matches real CAD convention
 * where schematic symbols are a fixed paper size, not a fixed real-world size.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getSymbolSizePx(_scale: DrawingScale): number {
  return SCHEMATIC_SYMBOL_PX;
}

/** Title block width in mm (right-side strip, matches ISO standard ~100 mm). */
export const TITLE_BLOCK_MM = 100;

/** Pixels per metre in content coordinates for a given drawing scale. */
export function getPxPerMetre(drawingScale: DrawingScale): number {
  return (SHEET_PX_PER_MM * 1000) / drawingScale;
}

export interface TitleBlockData {
  // Free-form block sections (textarea — line breaks preserved)
  ownerDeveloper?:       string;
  structuralEngineer?:   string;
  projectName:           string;
  mainContractor?:       string;
  plumbingContractor?:   string;
  // Short structured fields (bottom table)
  drawingNo:    string;
  drawnBy:      string;
  checkedBy:    string;
  date:         string;
  rev:          string;
  projectNo?:   string;
  tenureOfLand?: string;
  /** Base64 data-URL of the owner/developer signature image */
  ownerStamp?: string;
  /** Base64 data-URL of the structural engineer stamp/signature image */
  structuralEngineerStamp?: string;
  /** Base64 data-URL of the LP/PE stamp placed freely on the canvas */
  lpPeStamp?: string;
  /** Canvas-space position and size of the LP/PE stamp overlay */
  lpPeStampX?: number;
  lpPeStampY?: number;
  lpPeStampSize?: number;
}

export interface SheetConfig {
  paperSize:    PaperSize;
  drawingScale: DrawingScale;
  titleBlock:   TitleBlockData;
}

export const DEFAULT_SHEET_CONFIG: SheetConfig = {
  paperSize:    'A3',
  drawingScale: 50,
  titleBlock: {
    ownerDeveloper:       '',
    structuralEngineer:   '',
    projectName:          '',
    mainContractor:       '',
    plumbingContractor:   '',
    drawingNo:            '',
    drawnBy:              '',
    checkedBy:            '',
    date:                 new Date().toISOString().slice(0, 10),
    rev:                  '-',
    projectNo:            '',
    tenureOfLand:         '',
  },
};
export type PipeType = 'generic' | 'cold' | 'hot';

export const WATER_FITTING_TYPES = [
  { id: 'shower_tap',            code: 'ST',  label: 'Shower Tap'            },
  { id: 'basin_tap',             code: 'BT',  label: 'Basin Tap'             },
  { id: 'sink_tap',              code: 'ST',  label: 'Sink Tap'              },
  { id: 'urinal_flush',          code: 'UR',  label: 'Urinal Flush'          },
  { id: 'water_closet',          code: 'WC',  label: 'Water Closet'          },
  { id: 'dual_flushing_cistern', code: 'DFC', label: 'Dual Flushing Cistern' },
  { id: 'dishwasher',            code: 'DW',  label: 'Dishwasher'            },
  { id: 'water_dispenser',       code: 'WDP', label: 'Water Dispenser'       },
  { id: 'washing_machine',       code: 'WM',  label: 'Washing Machine'       },
  { id: 'landscape_tap',         code: 'LT',  label: 'Landscape Tap'         },
] as const;

export type WaterFittingTypeId = (typeof WATER_FITTING_TYPES)[number]['id'];

/**
 * Maps dedicated fixture symbol IDs to their fixed MWELS category.
 * null = ambiguous (user must pick basin_tap or sink_tap via the panel).
 * Symbols absent from this map are not subject to MWELS.
 */
export const FIXTURE_MWELS_CATEGORY: Record<string, WaterFittingTypeId | null> = {
  shower_head:            'shower_tap',
  multiple_show_unit:     'shower_tap',
  shower_bath:            'shower_tap',
  wash_basin_rectangular: 'basin_tap',
  sink:                   'sink_tap',
  water_closet:           'dual_flushing_cistern',
  urinal_wall:            'urinal_flush',
  dishwasher:             'dishwasher',
  washing_machine:        'washing_machine',
  water_dispenser:        'water_dispenser',
};

/**
 * fitting_type values with no MWELS tick rating table at all (a Section 6 check valve
 * is required instead) — mirrors NON_MWELS_FITTING_IDS in backend/app/agents/compliance_checks.py.
 * These are still keys in FIXTURE_MWELS_CATEGORY (so fitting_type is exported and the
 * "not subject to MWELS" row appears in the check), but the tick-rating picker must not
 * be shown for them — the backend ignores any efficiency_rating on these fittings
 * entirely, so offering the control is misleading.
 *
 * washing_machine and dishwasher are NOT in this set — PUB's "Water Efficiency Rating &
 * Requirements" (1 Dec 2021) confirms both are genuinely MWELS-graded appliances (1-4
 * tick scale), on top of also needing a §6.4 check valve for backflow — the two
 * requirements are independent of each other.
 */
export const NON_MWELS_FITTING_TYPE_IDS = new Set<WaterFittingTypeId>([
  'water_dispenser', 'landscape_tap',
]);

/**
 * Which tick ratings are selectable per MWELS fitting type, for the properties panel.
 * Defaults to [2, 3] — the standard tap/cistern/valve scale. Appliances use a wider
 * 1-4 tick scale per PUB's appliance water-consumption table (washing machines have no
 * 1-tick tier at all). Mirrors the "2"/"3"/"4" keys present per entry in the backend's
 * MWELS dict (compliance_checks.py).
 */
export const MWELS_TICK_OPTIONS: Partial<Record<WaterFittingTypeId, readonly number[]>> = {
  washing_machine: [2, 3, 4],
  dishwasher: [1, 2, 3, 4],
};
export const DEFAULT_MWELS_TICK_OPTIONS = [2, 3] as const;

export const ROTATABLE_SYMBOL_IDS = [
  'check_valve', 'gate_valve', 'tee_junction', 'pump', 'elbow_bend', 'water_tank', 'water_heater', 'instantaneous_water_heater', 'water_meter',
  // new inline valves & equipment
  'solenoid_valve', 'motorised_valve', 'globe_valve', 'prv_with_sensor',
  'sub_meter', 'cold_water_tank',
  'pressure_gauge_cock', 'pressure_gauge_prv', 'sight_glass', 'strainer',
  'cap_off_valve', 'multiport_valve', 'sampling_tap',
  // section 6 — hot water / contamination
  'pressure_relief_valve', 'vacuum_breaker',
  // fixtures with rotation support
  'bidet_spray',
  // new equipment
  'y_type_strainer', 'pipe_blank_off', 'flexible_connection', 'puddle_flange',
  // flip-only terminal fittings
  'tap_point_schematic',
] as const;
export type RotatableSymbolId = (typeof ROTATABLE_SYMBOL_IDS)[number];

/** Full 360° clockwise rotation (0/90/180/270). */
export const CLOCKWISE_SYMBOL_IDS = [
  'tee_junction', 'elbow_bend', 'check_valve', 'gate_valve',
  // new inline valves & equipment
  'solenoid_valve', 'motorised_valve', 'globe_valve', 'prv_with_sensor',
  'sub_meter', 'cold_water_tank',
  'pressure_gauge_cock', 'pressure_gauge_prv', 'sight_glass', 'strainer',
  'cap_off_valve', 'multiport_valve', 'sampling_tap',
  // section 6 — hot water / contamination
  'pressure_relief_valve', 'vacuum_breaker',
  // fixtures with rotation support
  'bidet_spray',
  // new equipment
  'y_type_strainer', 'pipe_blank_off', 'flexible_connection', 'puddle_flange',
] as const;
/** Left-to-right / right-to-left flip only (0° or 180°). */
export const FLIP_ONLY_SYMBOL_IDS = ['pump', 'water_tank', 'water_heater', 'instantaneous_water_heater', 'water_meter', 'tap_point_schematic'] as const;

/**
 * Of the FLIP_ONLY_SYMBOL_IDS, which ones flip via scaleX=-1 (image stays
 * upright, ports mirror left/right) vs. rotation=180 (whole image rotates,
 * used for symbols with no left/right-symmetric artwork). Single source of
 * truth for RotationPanel.tsx (the ↔ button on a placed element) and
 * FlipOrientationDialog.tsx (the placement-time orientation picker) — both
 * used to carry their own hand-maintained copy of this same 5-symbol list,
 * which is exactly the kind of drift that caused the water_heater "WH"→"HW"
 * bug (fixed via NEVER_MIRROR_IMAGE_SYMBOL_IDS below).
 */
export const SCALE_FLIP_SYMBOL_IDS = new Set(['water_tank', 'water_heater', 'instantaneous_water_heater', 'water_meter', 'pump', 'tap_point_schematic']);

/**
 * Symbols whose SVG has baked-in text that would read backwards if the whole
 * image were mirrored (e.g. water_heater's "WH" flips to "HW" — both letters
 * are individually left-right symmetric, so only their reading order visibly
 * flips, making the bug look like an intentional-but-wrong relabel). For
 * these symbols, only the port geometry should flip — the rendered image
 * stays unmirrored (safe because their connector stubs are visually
 * symmetric left/right, so nothing else changes on screen). Used by both
 * SymbolNode.tsx (live canvas) and FlipOrientationDialog.tsx (placement
 * preview) so the two can't drift out of sync again.
 */
export const NEVER_MIRROR_IMAGE_SYMBOL_IDS = new Set(['water_heater', 'instantaneous_water_heater', 'water_meter']);

/**
 * Symbols that SS636 or PUB explicitly mandate in a drawing.
 * Palette items in this set receive a small amber "§" tag to distinguish them
 * from neutral pipework symbols (gates, elbows, etc.) within the same category.
 */
export const COMPLIANCE_OBLIGATED_IDS = new Set([
  // Backflow & pressure protection (SS636 §5)
  'check_valve', 'vacuum_breaker', 'pressure_relief_valve',
  'auto_air_relief_valve', 'ball_float_valve',
  'prv_with_sensor', 'pressure_gauge_prv',
  // Metering (PUB mandatory)
  'water_meter',
  // Contamination prevention (SS636 §6.5)
  'bidet_spray',
  // Appliances requiring double check valve (SS636 §6.4)
  'washing_machine', 'dishwasher', 'water_dispenser', 'bib_tap_cw_cap_and_lock_schematic',
]);

/**
 * Backflow protection rule per element type (SS636):
 *   double_check_valve  — §6.4 appliances: 2 check valves in series upstream
 *   vb_and_check_valve  — §6.5 bidet spray: vacuum breaker + check valve assembly
 */
export type BackflowRule = 'double_check_valve' | 'vb_and_check_valve';

const DOUBLE_CHECK_VALVE_SYMBOL_IDS = new Set([
  'bib_tap_cw_cap_and_lock_schematic', // yard / landscape tap  — SS636 §6.4
  'washing_machine',                   // SS636 §6.4
  'dishwasher',                        // SS636 §6.4
  'water_dispenser',                   // SS636 §6.4
  'water_heater',                      // SS636 §6.4
]);

const VB_AND_CHECK_VALVE_SYMBOL_IDS = new Set([
  'bidet_spray', // SS636 §6.5
]);

/** Returns the backflow protection rule for an element, or null if not applicable. */
export function getBackflowRule(el: { symbolId: string; fittingType?: string }): BackflowRule | null {
  if (VB_AND_CHECK_VALVE_SYMBOL_IDS.has(el.symbolId)) return 'vb_and_check_valve';
  if (DOUBLE_CHECK_VALVE_SYMBOL_IDS.has(el.symbolId)) return 'double_check_valve';
  return null;
}

export function isBackflowRiskElement(el: { symbolId: string; fittingType?: string }): boolean {
  return getBackflowRule(el) !== null;
}

export interface MrlConfig {
  upperMrl: number;
  lowerMrl: number;
}

export interface FloorLevel {
  id: string;
  name: string;   // e.g. "1ST STOREY", "2ND STOREY"
  fflM: number;   // Finished Floor Level in metres AMSL
}

export const MRL_LOWER_HARD_MIN = 0;

/**
 * Derives the upper MRL from a lower MRL and sheet config.
 * The paper height at the chosen drawing scale sets the elevation range exactly.
 * e.g. A3 (297 mm) at 1:100 → range = 29.7 m → upperMrl = lowerMrl + 29.7
 */
export function getUpperMrl(lowerMrl: number, sheetConfig: SheetConfig): number {
  return lowerMrl + (PAPER_SIZES_MM[sheetConfig.paperSize].h * sheetConfig.drawingScale) / 1000;
}

export interface CanvasElement {
  id: string;
  symbolId: string;
  symbolName: string;
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  /** Horizontal scale: 1 = normal, -1 = mirrored (used for water_tank Left←Right). */
  scaleX?: number;
  /** Fitting sub-type for water_fittings elements (stores WaterFittingTypeId). */
  fittingType?: string;
  /** Water efficiency rating (WELS ticks) for water_fittings elements. Appliances (washing
   *  machine, dishwasher) use a wider 1-4 tick scale — see MWELS_TICK_OPTIONS. */
  efficiencyRating?: 1 | 2 | 3 | 4;
  /** Single upstream port index — backward-compat for 1-inlet symbols. */
  upstreamPortIndex?: number;
  /** Multiple upstream port indices — used for tee in 2-inlet mode. */
  upstreamPortIndices?: number[];
  /** Tank-specific properties — only present on water_tank elements. */
  tankProperties?: TankProperties;
  /** Capacity in litres — only present on long_bath elements. */
  longBathCapacityL?: number;
  /** When true, dual hot + cold supply ports are active instead of a single supply port. */
  dualSupply?: boolean;
  /** When true, the hot/cold side assignment is swapped (hot on left, cold on right). */
  swapDualSupply?: boolean;
  /**
   * Fluid type carried by this element (cold or hot).
   * Set automatically when the element is snapped to a pipe at placement time
   * and propagated through generic pipes to upstream elements.
   * Used to tint tee junctions and elbow bends to match their input pipe colour.
   */
  carriesFluid?: 'cold' | 'hot';
  /** Declared pump rated head in metres — only present on pump elements. */
  pumpRatedHeadM?: number;
  /** User-declared elevation (m AMSL) of the highest direct-supply fitting on the
   *  drawing — only present on highest_direct_supply_fitting elements. */
  highestFittingElevationM?: number;
}

// ─── Canvas annotations ───────────────────────────────────────────────────────

export interface AnnotationElement {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  maxWidth: number;
  height: number;
}

export interface AnnotationTemplate {
  id: string;
  label: string;
  text: string;
}

export const ANNOTATION_TEMPLATES: AnnotationTemplate[] = [
  {
    id: 'bypass_pump',
    label: 'Pump bypass line',
    text: 'Pump bypass line provided with normally closed valve (NC) and check valve.',
  },
  {
    id: 'bidet_spray',
    label: 'Bidet spray assembly',
    text: 'Bidet spray assembly: check valve and vacuum breaker provided on flexible hose to prevent backflow contamination.',
  },
  {
    id: 'dcv_appliance',
    label: 'DCV for appliances',
    text: 'Double check valve (DCV) provided for backflow prevention as required under Reg. 28.',
  },
  {
    id: 'prv_note',
    label: 'PRV setting note',
    text: 'Pressure reducing valve (PRV) to be set to ___ bar. LP/PE to verify setting on site.',
  },
  {
    id: 'tank_overflow',
    label: 'Tank overflow compliance',
    text: 'Overflow pipe one nominal size larger than inlet pipe. Warning pipe 50 mm below overflow level. Normal water level 25 mm below warning pipe level.',
  },
];

// ─── Water Tank properties ────────────────────────────────────────────────────

export type TankMaterial = string; // 'FRP' | 'GRP' | 'SS_316' | 'RC' | 'Other' | custom

export const TANK_MATERIAL_OPTIONS = [
  { value: 'FRP',    label: 'FRP'                  },
  { value: 'GRP',    label: 'GRP'                  },
  { value: 'SS_316', label: 'Stainless Steel 316'  },
  { value: 'RC',     label: 'Reinforced Concrete'  },
  { value: 'Other',  label: 'Other'                },
] as const;

/**
 * Editable properties for a Water Tank element.
 * Mirrors the PE WSI Tank Checker fields. All elevations in metres AMSL,
 * all dimensions/diameters in metres. Effective capacity is derived
 * from length × width × height at runtime, not stored here.
 */
export interface TankProperties {
  // Quick-panel
  material?: TankMaterial;
  isSunkenTank?: boolean;

  // Dimensions (m) — drive auto-calculated capacity
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  floorLevelMAmsl?: number;

  // Inlet
  inletPipeDiameterM?: number;
  inletPipeMAmsl?: number;

  // Outlet
  outletPipeDiameterM?: number;
  distanceOutletToBaseM?: number;

  // Overflow
  overflowPipeDiameterM?: number;
  overflowPipeMAmsl?: number;

  // Warning
  warningPipeDiameterM?: number;
  warningPipeMAmsl?: number;

  // Supports
  supportHeightM?: number;

  // Water requirement schedule
  occupants?: number;
}

/**
 * Compute the maximum water level AMSL from inlet/overflow geometry.
 * Formula (SS 245): Inlet Pipe AMSL − Overflow Pipe Diameter − 0.075
 */
export function calcWaterLevelAmsl(props: TankProperties | undefined): number | null {
  if (!props) return null;
  const { inletPipeMAmsl, overflowPipeDiameterM } = props;
  if (typeof inletPipeMAmsl !== 'number' || typeof overflowPipeDiameterM !== 'number') return null;
  return Math.round((inletPipeMAmsl - overflowPipeDiameterM - 0.075) * 10000) / 10000;
}

/**
 * Compute tank effective capacity in litres using PUB formula (Tank Checker, SS 245):
 *   effective_depth = water_level − outlet_elevation
 *   water_level     = inlet_amsl − overflow_diameter − 0.075
 *   outlet_elevation = floor_amsl + support_height + outlet_to_base
 *   capacity_L      = effective_depth × length × width × 1000
 *
 * Returns null if any required input is missing.
 */
export function calcTankCapacityLitres(props: TankProperties | undefined): number | null {
  if (!props) return null;
  const {
    inletPipeMAmsl,
    overflowPipeDiameterM,
    floorLevelMAmsl,
    distanceOutletToBaseM,
    lengthM,
    widthM,
  } = props;
  const supportH = typeof props.supportHeightM === 'number' ? props.supportHeightM : 0.6;
  if (
    typeof inletPipeMAmsl      !== 'number' ||
    typeof overflowPipeDiameterM !== 'number' ||
    typeof floorLevelMAmsl     !== 'number' ||
    typeof distanceOutletToBaseM !== 'number' ||
    typeof lengthM             !== 'number' || lengthM <= 0 ||
    typeof widthM              !== 'number' || widthM  <= 0
  ) {
    return null;
  }
  const waterLevel    = inletPipeMAmsl - overflowPipeDiameterM - 0.075;
  const outletElev    = floorLevelMAmsl + supportH + distanceOutletToBaseM;
  const effectiveDepth = waterLevel - outletElev;
  if (effectiveDepth <= 0) return 0;
  return Math.round(effectiveDepth * lengthM * widthM * 1000 * 100) / 100;
}

export interface PipeElement {
  id: string;
  pipeType: PipeType;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Element + port this endpoint is bound to, if any. Undefined means
   *  "unbound" — endpoint sync falls back to proximity matching against
   *  that element's ports, same as pre-migration behavior. */
  startElementId?: string;
  startPortIndex?: number;
  endElementId?: string;
  endPortIndex?: number;
  /** User-set color override (#rrggbb), replacing the pipeType default wherever
   *  this pipe is drawn (canvas, PDF export, elbow/tee tint). Undefined = "Automatic". */
  customColor?: string;
  /** Freeform pipe size label (e.g. "20mm", "DN25") rendered above the pipe's
   *  midpoint flow arrow. Undefined = no label shown. */
  diameterLabel?: string;
}

export interface SymbolMeta {
  id: string;
  name: string;
  category: 'water_supply' | 'backflow_prevention' | 'pumps' | 'tanks' | 'sanitary' | 'default' | 'custom';
  filename: string;
  url: string;
  created_at: string;
}

// ─── Metadata export types ────────────────────────────────────────────────────

/**
 * Hydraulic role of a placed symbol in the flow network.
 * Used by Stage 2 AI agents to reason about the system without
 * needing to hard-code symbol IDs.
 */
export type NodeType =
  | 'source'            // water_tank — origin of supply
  | 'pressure_booster'  // pump — increases pressure / lifts water
  | 'isolation_valve'   // gate_valve — can shut off flow
  | 'check_valve'       // check_valve — prevents backflow
  | 'junction'          // tee_junction — splits or joins flow
  | 'heat_exchanger'    // water_heater
  | 'bend'              // elbow_bend
  | 'flow_meter'        // flow_meter, water_meter
  | 'water_fitting'    // water_fittings — terminal fixture (tap, WC, etc.)
  | 'component';       // anything else / custom symbol

export interface ExportedPort {
  index: number;
  role: 'upstream' | 'downstream';
  label: string | null;
  position: { canvas_x: number; canvas_y: number };
  mrl: { value: number; unit: 'm AMSL' };
  /** ID of the pipe whose endpoint sits on this port, or null if unconnected. */
  connected_pipe_id: string | null;
  /** Element on the other end of the connected pipe (i.e. the adjacent element in the flow graph), or null. */
  connects_to_element_id: string | null;
  /** Port index on that adjacent element, or null. */
  connects_to_port_index: number | null;
  /** Whether THIS port's supply line is direct (mains) or indirect (via a water_tank). Independent per port — a water_fitting's Hot and Cold ports can differ. */
  supply_mode: SupplyMode;
}

export type SupplyMode = 'direct_supply' | 'indirect_supply' | null;

export interface ExportedElement {
  id: string;
  type: 'symbol';
  symbol_id: string;
  symbol_name: string;
  node_type: NodeType;
  position: { canvas_x: number; canvas_y: number };
  /** Canvas size in pixels — needed to reconstruct the element on import. */
  width: number;
  height: number;
  /** Elevation above datum in metres AMSL. */
  elevation_m: number;
  /** Whether this element is before (direct_supply) or after (indirect_supply) the water meter. Null if no meter present or element is the meter itself. */
  supply_mode: SupplyMode;
  rotation_deg: number;
  scale_x: number;
  /** Per-port upstream/downstream detail — empty for custom symbols with no port definition. */
  ports: ExportedPort[];
  /** Flat list of all connected pipe IDs (convenience — same info as ports[].connected_pipe_id). */
  connected_pipe_ids: string[];
  /** Fitting sub-type — only present on water_fittings elements (e.g. "shower_tap", "basin_tap"). */
  fitting_type?: string;
  /** WELS tick rating — only present on water_fittings elements. Appliances use 1-4; other fixtures use 2-3. */
  efficiency_rating?: 1 | 2 | 3 | 4;
  /** Fluid type flowing through this element — only present on tee_junction and elbow_bend. */
  pipe_type?: PipeType | null;
  /** Tank-specific properties — only present on water_tank elements. */
  tank_properties?: ExportedTankProperties;
  /** Capacity in litres — only present on long_bath elements. */
  long_bath_capacity_l?: number | null;
  /** Pump rated head in metres — only present on pump elements. */
  pump_rated_head_m?: number | null;
  /** User-declared elevation (m AMSL) of the highest direct-supply fitting — only
   *  present on highest_direct_supply_fitting elements. */
  highest_fitting_elevation_m?: number | null;
  /** Backflow protection required: 'check_valve' (Reg28/§6.4) or 'vacuum_breaker' (§6.5). Absent if not applicable. */
  backflow_requirement?: 'check_valve' | 'vacuum_breaker';
  /** Per-instance upstream port override — only present when the user has changed the default inlet (e.g. on a tee junction). */
  upstream_port_index?: number;
  /** Multi-inlet upstream port override — only present when two ports are designated as inlets (tee in 2-inlet mode). */
  upstream_port_indices?: number[];
  /** Whether Hot+Cold dual supply ports are active instead of a single generic supply port — only present on fixtures that support the toggle. Must round-trip through import or the fixture silently loses its Hot/Cold split (breaking Rule 6.1 on re-import). */
  dual_supply?: boolean;
  /** Whether the hot/cold side assignment is swapped — only meaningful when dual_supply is true. */
  swap_dual_supply?: boolean;
}

/**
 * Tank properties as written to the exported schematic JSON.
 * `effective_capacity_l` is derived using PUB formula (water level − outlet elevation) × L × W.
 */
export interface ExportedTankProperties {
  material: string | null;

  // Dimensions
  length_m: number | null;
  width_m: number | null;
  height_m: number | null;
  floor_level_m_amsl: number | null;

  // Inlet
  inlet_pipe_diameter_m: number | null;
  inlet_pipe_m_amsl: number | null;

  // Outlet
  outlet_pipe_diameter_m: number | null;
  distance_outlet_to_base_m: number | null;

  // Overflow
  overflow_pipe_diameter_m: number | null;
  overflow_pipe_m_amsl: number | null;

  // Warning
  warning_pipe_diameter_m: number | null;
  warning_pipe_m_amsl: number | null;

  // Supports
  support_height_m: number | null;

  /** Effective capacity from PUB formula (water level − outlet elevation) × L × W × 1000. */
  effective_capacity_l: number | null;
  is_sunken_tank: boolean | null;

  /** Number of occupants — drives daily demand (141 L/person). */
  occupants: number | null;
  /** Derived daily demand in m³ (occupants × 0.141). */
  daily_demand_m3: number | null;
}

export interface ExportedPipe {
  id: string;
  type: 'water_pipe';
  pipe_type: PipeType;
  start: { canvas_x: number; canvas_y: number; mrl: number };
  end: { canvas_x: number; canvas_y: number; mrl: number };
  /** Whether this pipe is before (direct_supply) or after (indirect_supply) the water meter. */
  supply_mode: SupplyMode;
  /** Element id whose port sits at this pipe's start point, or null (free end). */
  start_connects_to: string | null;
  /** Port index on that element, or null. */
  start_port_index: number | null;
  /** Role of the port on the start-end element that this pipe end connects to. */
  start_port_role: 'upstream' | 'downstream' | null;
  /** Element id whose port sits at this pipe's end point, or null (free end). */
  end_connects_to: string | null;
  /** Port index on that element, or null. */
  end_port_index: number | null;
  /** Role of the port on the end-end element that this pipe end connects to. */
  end_port_role: 'upstream' | 'downstream' | null;
  /**
   * Convenience: which element/port the flow enters this pipe from (the outlet/downstream port).
   * Null when the entry end is a free end.
   */
  flow_from_element_id: string | null;
  flow_from_port_index: number | null;
  /**
   * Convenience: which element/port the flow exits this pipe to (the inlet/upstream port).
   * Null when the exit end is a free end.
   */
  flow_to_element_id: string | null;
  flow_to_port_index: number | null;
  length_px: number;
  rotation_deg: number;
  /** User-set color override (#rrggbb), or absent if using the pipe_type default ("Automatic"). */
  custom_color?: string;
  /** Freeform pipe size label (e.g. "20mm", "DN25"), or absent if none was set. */
  diameter_label?: string;
}

/**
 * High-level hydraulic interpretation of the drawing.
 * Tells Stage 2 agents what kind of system this is and whether
 * gravity head is sufficient to reach the outlets.
 */
export interface HydraulicContext {
  flow_mode: 'gravity' | 'pump_assisted' | 'undetermined';
  source_element_id: string | null;
  source_mrl_m: number | null;
  pump_element_ids: string[];
  lowest_outlet_mrl_m: number | null;
  gravity_head_available_m: number | null;
  gravity_head_sufficient: boolean | null;
  note: string;
}

/** All LP/PE acknowledgment flags collected in the pre-evaluation checklist popup. */
export interface AcknowledgmentFlags {
  materialsAcknowledged: boolean;
  /** Rule 8 — Pump discharge pipes use PUB-approved non-plastic materials. */
  pumpDischargeMaterialAcknowledged: boolean;
  /** 6.4 — Double check valves installed for applicable appliances. */
  applianceCheckValveAcknowledged: boolean;
  /** 6.5 — Bidet sprays installed with vacuum breaker + check valve assembly. */
  bidetVacuumBreakerAcknowledged: boolean;
  /** 6.6 — Tanks/pumps not installed below sanitary or non-potable water pipes. */
  tankPositionAcknowledged: boolean;
}

export interface DrawingMetadata {
  schema_version: '1.0';
  exported_at: string;
  mrl_config: { upper_mrl: number; lower_mrl: number; unit: 'm AMSL'; range: number };
  canvas: { width_px: number; height_px: number };
  /** Sheet setup used at export time — needed to reconstruct the same paper size/drawing scale on import instead of silently reinterpreting elevations against whatever sheet config the importing session happens to have. */
  sheet_config: { paper_size: PaperSize; drawing_scale: DrawingScale };
  /** LP/PE has acknowledged use of PUB-approved materials. */
  materials_acknowledged: boolean;
  /** LP/PE has acknowledged pump discharge pipes use PUB-approved non-plastic materials. */
  pump_discharge_material_acknowledged: boolean;
  /** LP/PE has acknowledged double check valves are installed for applicable appliances. */
  appliance_check_valve_acknowledged: boolean;
  /** LP/PE has acknowledged bidet sprays have vacuum breaker + check valve assembly. */
  bidet_vacuum_breaker_acknowledged: boolean;
  /** LP/PE has acknowledged tanks/pumps are not below sanitary or non-potable water pipes. */
  tank_position_acknowledged: boolean;
  /** Title block fields as filled in by the LP/PE. Stamps are included as base64 data-URLs. */
  title_block: TitleBlockData;
  elements: ExportedElement[];
  pipes: ExportedPipe[];
  annotations: ExportedAnnotation[];
  hydraulic_context: HydraulicContext;
  summary: {
    total_elements: number;
    total_pipes: number;
    total_pipe_length_px: number;
  };
}

export interface ExportedAnnotation {
  id: string;
  type: 'annotation';
  text: string;
  position: { canvas_x: number; canvas_y: number };
  mrl: { value: number; unit: 'm AMSL' };
  font_size: number;
  color: string;
  /** User-resizable text-box width in px. Must round-trip through import or a re-imported annotation silently loses its drawn box size/wrap. */
  max_width: number;
  height: number;
}

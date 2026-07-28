import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import type { CanvasElement, PipeElement as PipeElementType, PipeType, FloorLevel, AnnotationElement } from '../types';
import { PAPER_SIZES_MM, SHEET_PX_PER_MM, AXIS_WIDTH, HIGHEST_FITTING_LABEL_FONT_SIZE, HIGHEST_FITTING_LABEL_COLOR } from '../types';
import { getGridMrlValues, mrlToPixel } from './mrlMapping';
import {
  getPipeDrawStyle, getPipeMidpointArrow, getPipeDiameterLabelAnchor, PIPE_ARROW_POINTER_LENGTH, PIPE_ARROW_POINTER_WIDTH, PIPE_HOT_DASH,
  PIPE_DIAMETER_LABEL_FONT_SIZE, PIPE_DIAMETER_LABEL_OFFSET,
} from '../components/canvas/PipeElement';
import { shouldMirrorSymbolImage } from '../components/canvas/SymbolNode';
import { getElbowTeeTint, TINT_SYMBOL_IDS } from '../components/canvas/ElementsLayer';
import { computePipeJumps, buildJumpSegments, PIPE_JUMP_RADIUS_PX } from './pipeJumps';
import { symbolsApi } from '../api/client';
import {
  computeTitleBlockLayout, BORDER, LBL_CLR, VAL_CLR, LBL_SZ, VAL_SZ, PAD,
  LEGEND_ROW_H, LEGEND_HDR_H, LEGEND_MAX_ROWS,
} from './titleBlockLayout';

// ── Unit conversion ──────────────────────────────────────────────────────────
// Content-space "px" (2 px/mm, see SHEET_PX_PER_MM) -> PDF page mm.
const mm = (contentPx: number): number => contentPx / SHEET_PX_PER_MM;
// jsPDF's setFontSize() is always in points regardless of document unit — everything
// else (coordinates, line widths, dash patterns) uses the document's chosen unit (mm here).
const MM_PER_PT = 25.4 / 72;
const pt = (contentPx: number): number => mm(contentPx) / MM_PER_PT;

/** Truncates text with an ellipsis to fit maxWidthMm at the current font — matches the Konva
 *  legend's `wrap="none" ellipsis` behavior. jsPDF's own `text(..., {maxWidth})` doesn't
 *  ellipsize, it wraps onto additional lines instead, which silently overflows into the row
 *  below when a legend entry's name is long (found via a real "Pressure Vessel (Schematic)"
 *  vs "Tee Junction" legend collision) — call this and pass the result to text() with no
 *  maxWidth, rather than relying on jsPDF's wrapping for anything meant to stay one line. */
function truncateToWidth(pdf: jsPDF, text: string, maxWidthMm: number): string {
  if (pdf.getTextWidth(text) <= maxWidthMm) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (pdf.getTextWidth(text.slice(0, mid) + '…') <= maxWidthMm) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

// ── Symbol SVG loading/caching ───────────────────────────────────────────────

/** svg2pdf.js silently fails to render an SVG at small target sizes (e.g. a ~5mm legend icon)
 *  when it has no explicit viewBox — only width/height. Derive one from the SVG's own
 *  width/height so every symbol gets this fix regardless of how its source file was authored. */
function ensureSvgViewBox(svgEl: SVGElement): void {
  if (svgEl.hasAttribute('viewBox')) return;
  const w = parseFloat(svgEl.getAttribute('width') || '');
  const h = parseFloat(svgEl.getAttribute('height') || '');
  if (w > 0 && h > 0) svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
}

/** Fetches and parses a symbol's raw SVG once per export, cached by symbolId. Returns
 *  the pristine parsed template — callers must clone before mutating (e.g. for tint). */
async function getSymbolSvgTemplate(symbolId: string, cache: Map<string, SVGElement | null>): Promise<SVGElement | null> {
  if (cache.has(symbolId)) return cache.get(symbolId) ?? null;
  try {
    const res = await fetch(symbolsApi.getImageUrl(symbolId));
    if (!res.ok) { cache.set(symbolId, null); return null; }
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
      cache.set(symbolId, null);
      return null;
    }
    ensureSvgViewBox(svgEl as unknown as SVGElement);
    normalizeSvgStrokeDefaults(svgEl as unknown as SVGElement);
    cache.set(symbolId, svgEl as unknown as SVGElement);
    return svgEl as unknown as SVGElement;
  } catch {
    cache.set(symbolId, null);
    return null;
  }
}

// jsPDF's valid stroke-linecap/stroke-linejoin keywords (its CapJoinStyles map) — anything
// else (including a missing attribute) makes svg2pdf.js pass through a bad value that jsPDF
// throws on ("Line cap style of '...' is not recognized").
const VALID_LINECAP = new Set(['butt', 'but', 'miter', 'round', 'rounded', 'circle', 'projecting', 'project', 'square', 'bevel']);

/** Several symbol SVGs were produced by an SVG editor that literally serialized JS `undefined`
 *  values into the markup — e.g. `stroke-linecap="undefined"` (a real, present, but garbage
 *  attribute value, not a missing one). svg2pdf.js passes that string straight through to
 *  jsPDF's setLineCap()/setLineJoin(), which only accept a fixed keyword set and throw on
 *  anything else — crashing the whole export on any symbol with this defect. Normalize every
 *  element's linecap/linejoin to a valid value (SVG spec defaults 'butt'/'miter' when absent
 *  or invalid) so this can't happen regardless of what a given symbol's source SVG contains. */
function normalizeSvgStrokeDefaults(svgEl: SVGElement): void {
  const all = [svgEl, ...Array.from(svgEl.querySelectorAll('*'))];
  for (const el of all) {
    const linecap = el.getAttribute('stroke-linecap');
    if (!linecap || !VALID_LINECAP.has(linecap)) el.setAttribute('stroke-linecap', 'butt');
    const linejoin = el.getAttribute('stroke-linejoin');
    if (!linejoin || !VALID_LINECAP.has(linejoin)) el.setAttribute('stroke-linejoin', 'miter');
  }
}

/** Recolors tee/elbow symbols to match their traced upstream fluid — vector equivalent of
 *  SymbolNode.tsx's offscreen-canvas pixel recolor. */
function recolorSvgStroke(svgEl: SVGElement, hexColor: string): void {
  svgEl.querySelectorAll('[stroke]').forEach((node) => {
    if (node.getAttribute('stroke')?.toLowerCase() === '#1a1a1a') {
      node.setAttribute('stroke', hexColor);
    }
  });
}

/** The point symbols rotate/mirror around, in the SVG's own user-unit coordinate system —
 *  derived from its viewBox if present (mapping the declared width/height's midpoint back
 *  into viewBox units), falling back to plain width/2,height/2 for the (common) viewBox-less
 *  case where user units equal pixels 1:1. */
function getSvgIntrinsicCenter(svgEl: SVGElement): { cx: number; cy: number } {
  const w = parseFloat(svgEl.getAttribute('width') || '0') || 0;
  const h = parseFloat(svgEl.getAttribute('height') || '0') || 0;
  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      const [minX, minY, vbW, vbH] = parts;
      // The outer box's midpoint is where rotation/mirror should visually pivot (matching Konva
      // treating the rendered image like a scaled <img>) — map it into viewBox user units.
      return { cx: minX + vbW / 2, cy: minY + vbH / 2 };
    }
  }
  return { cx: w / 2, cy: h / 2 };
}

/** Places a symbol's SVG centered at (centerXmm, centerYmm), matching Konva's
 *  offsetX/offsetY=halfW/halfH convention. Rotation/mirror are baked directly into the SVG's
 *  own `transform` attribute (native SVG semantics svg2pdf.js handles natively) rather than
 *  via jsPDF's low-level transformation-matrix stack — wrapping svg2pdf() in a hand-rolled
 *  saveGraphicsState()/setCurrentTransformationMatrix() call turned out to misplace symbols
 *  entirely (jsPDF's raw CTM API doesn't compose with svg2pdf's own internal mm/y-flip handling
 *  the way a simple "append matrix" description implies) — this approach sidesteps that. */
async function placeSymbolCentered(
  pdf: jsPDF,
  svgEl: SVGElement,
  centerXmm: number,
  centerYmm: number,
  widthMm: number,
  heightMm: number,
  rotationDeg: number,
  mirror: boolean,
): Promise<void> {
  if (rotationDeg !== 0 || mirror) {
    const { cx, cy } = getSvgIntrinsicCenter(svgEl);
    const mirrorX = mirror ? -1 : 1;
    const doc = svgEl.ownerDocument;
    const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${cx} ${cy}) rotate(${rotationDeg}) scale(${mirrorX} 1) translate(${-cx} ${-cy})`);
    while (svgEl.firstChild) g.appendChild(svgEl.firstChild);
    svgEl.appendChild(g);
  }

  await svg2pdf(svgEl, pdf, {
    x: centerXmm - widthMm / 2,
    y: centerYmm - heightMm / 2,
    width: widthMm,
    height: heightMm,
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function dataUrlFormat(dataUrl: string): string {
  const match = /^data:image\/(\w+);base64,/i.exec(dataUrl);
  return (match?.[1] ?? 'PNG').toUpperCase();
}

// ── Grid / MRL axis / floor levels ───────────────────────────────────────────

function drawGrid(
  pdf: jsPDF,
  canvasWidthPx: number,
  canvasHeightPx: number,
  upperMrl: number,
  lowerMrl: number,
  floorLevels: FloorLevel[],
  floorLevelOpacity: number,
): void {
  const axisW = mm(AXIS_WIDTH);
  const w = mm(canvasWidthPx);
  const h = mm(canvasHeightPx);

  pdf.setDrawColor('#cccccc');
  pdf.setLineWidth(mm(1));
  pdf.line(axisW, 0, axisW, h);

  pdf.setFontSize(pt(9));
  pdf.setTextColor('#999999');
  pdf.text('m AMSL', axisW - mm(4), mm(4), { align: 'right', baseline: 'top' });

  const gridValues = getGridMrlValues(upperMrl, lowerMrl);
  for (const mrl of gridValues) {
    const y = mm(mrlToPixel(mrl, canvasHeightPx, upperMrl, lowerMrl));
    pdf.setDrawColor('#e0e0e0');
    pdf.setLineWidth(mm(1));
    pdf.setLineDashPattern([mm(6), mm(4)], 0);
    pdf.line(axisW, y, w, y);
    pdf.setLineDashPattern([], 0);
    pdf.setFontSize(pt(10));
    pdf.setTextColor('#666666');
    pdf.text(`${mrl.toFixed(1)}m`, axisW - mm(4), y - mm(8), { align: 'right', baseline: 'top' });
  }

  if (!gridValues.includes(lowerMrl)) {
    pdf.setFontSize(pt(10));
    pdf.setTextColor('#999999');
    pdf.text(`${lowerMrl.toFixed(1)}m`, axisW - mm(4), h - mm(14), { align: 'right', baseline: 'top' });
  }

  for (const floor of floorLevels) {
    if (floor.fflM < lowerMrl || floor.fflM > upperMrl) continue;
    const y = mm(mrlToPixel(floor.fflM, canvasHeightPx, upperMrl, lowerMrl));
    pdf.setDrawColor('#1a1a1a');
    pdf.setLineWidth(mm(1.5));
    pdf.setGState(pdf.GState({ opacity: floorLevelOpacity }));
    pdf.line(axisW, y, w, y);
    pdf.setGState(pdf.GState({ opacity: 1 }));
    pdf.setFontSize(pt(9));
    pdf.setTextColor('#1a1a1a');
    pdf.text(floor.name, axisW + mm(4), y - mm(22), { baseline: 'top' });
    pdf.setFontSize(pt(8));
    pdf.setTextColor('#555555');
    pdf.text(`${floor.fflM.toFixed(1)}m AMSL`, axisW + mm(4), y - mm(12), { baseline: 'top' });
  }

  pdf.setDrawColor('#cccccc');
  pdf.setLineWidth(mm(1));
  pdf.rect(axisW, 0, w - axisW, h);
}

// ── Title block ───────────────────────────────────────────────────────────

async function drawTitleBlock(
  pdf: jsPDF,
  sheetConfig: ReturnType<typeof useUiStore.getState>['sheetConfig'],
  elements: CanvasElement[],
  svgCache: Map<string, SVGElement | null>,
): Promise<void> {
  const { titleBlock, drawingScale } = sheetConfig;

  const uniqueSymbols = (() => {
    const seen = new Set<string>();
    const result: { symbolId: string; symbolName: string }[] = [];
    for (const el of elements) {
      if (!seen.has(el.symbolId)) {
        seen.add(el.symbolId);
        result.push({ symbolId: el.symbolId, symbolName: el.symbolName });
      }
    }
    return result.sort((a, b) => a.symbolName.localeCompare(b.symbolName));
  })();

  const layout = computeTitleBlockLayout(sheetConfig, uniqueSymbols.length, !!titleBlock.ownerStamp, !!titleBlock.structuralEngineerStamp);
  const {
    paperH, tbW, tbX, headerH,
    ownerStampExtraH, structuralStampExtraH,
    ownerH, structuralH, projH, mainH, plumbH,
    yOwner, yStructural, yProj, yMain, yPlumb,
    legendCols, legendH, yLegend,
    btRowH, dtRowH, yDt, yRow1, yRow2, yRow3,
    c1W, c2W, c3W, borderWidth,
  } = layout;

  const tbXmm = mm(tbX), tbWmm = mm(tbW), paperHmm = mm(paperH);

  const box = (x: number, y: number, w: number, h: number) => {
    pdf.setDrawColor(BORDER);
    pdf.setFillColor('#ffffff');
    pdf.setLineWidth(mm(borderWidth));
    pdf.rect(mm(x), mm(y), mm(w), mm(h), 'FD');
  };

  const label = (x: number, y: number, text: string, size = LBL_SZ, color = LBL_CLR, bold = false) => {
    pdf.setFontSize(pt(size));
    pdf.setTextColor(color);
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.text(text, mm(x), mm(y), { baseline: 'top' });
    pdf.setFont('helvetica', 'normal');
  };

  const blockText = (x: number, y: number, lbl: string, text: string | undefined) => {
    label(x + PAD, y + PAD, lbl, LBL_SZ, LBL_CLR);
    pdf.setFontSize(pt(VAL_SZ));
    pdf.setTextColor(VAL_CLR);
    pdf.text(text || '', mm(x + PAD), mm(y + PAD + LBL_SZ + 4), {
      baseline: 'top', maxWidth: mm(tbW - PAD * 2), lineHeightFactor: 1.35,
    });
  };

  pdf.setFillColor('#ffffff');
  pdf.rect(tbXmm, 0, tbWmm, paperHmm, 'F');
  pdf.setDrawColor(BORDER);
  pdf.setLineWidth(mm(1.5));
  pdf.line(tbXmm, 0, tbXmm, paperHmm);

  // Header
  box(tbX, 0, tbW, headerH);
  pdf.setFontSize(pt(11));
  pdf.setTextColor('#111111');
  pdf.setFont('helvetica', 'bold');
  pdf.text('SCHEMATIC DRAWING', tbXmm + tbWmm / 2, mm(headerH) / 2, { align: 'center', baseline: 'middle' });
  pdf.setFont('helvetica', 'normal');

  // Owner / Developer
  box(tbX, yOwner, tbW, ownerH);
  blockText(tbX, yOwner, 'OWNER / DEVELOPER :', titleBlock.ownerDeveloper);
  if (titleBlock.ownerStamp) await drawStamp(pdf, titleBlock.ownerStamp, ownerStampExtraH, yOwner, ownerH, tbX, tbW);
  label(tbX + PAD, yOwner + ownerH - 13, 'SIGN :');

  // Structural Engineer
  box(tbX, yStructural, tbW, structuralH);
  blockText(tbX, yStructural, 'STRUCTURAL ENGINEER :', titleBlock.structuralEngineer);
  if (titleBlock.structuralEngineerStamp) await drawStamp(pdf, titleBlock.structuralEngineerStamp, structuralStampExtraH, yStructural, structuralH, tbX, tbW);
  label(tbX + PAD, yStructural + structuralH - 13, 'SIGN :');

  // Project Title / Main Con / Plumbing Contractor
  box(tbX, yProj, tbW, projH);
  blockText(tbX, yProj, 'PROJECT TITLE', titleBlock.projectName);
  box(tbX, yMain, tbW, mainH);
  blockText(tbX, yMain, 'MAIN CON :', titleBlock.mainContractor);
  box(tbX, yPlumb, tbW, plumbH);
  blockText(tbX, yPlumb, 'PLUMBING CONTRACTOR', titleBlock.plumbingContractor);

  // Legend
  if (legendH > 0) {
    pdf.setFillColor('#f8fafc');
    pdf.setDrawColor(BORDER);
    pdf.setLineWidth(mm(borderWidth));
    pdf.rect(tbXmm, mm(yLegend), tbWmm, mm(legendH), 'FD');
    label(tbX + PAD, yLegend + 3, 'LEGEND', LBL_SZ, LBL_CLR, true);
    pdf.setDrawColor(BORDER);
    pdf.setLineWidth(mm(0.5));
    pdf.line(tbXmm, mm(yLegend + LEGEND_HDR_H - 1), tbXmm + tbWmm, mm(yLegend + LEGEND_HDR_H - 1));

    const shown = uniqueSymbols.slice(0, LEGEND_MAX_ROWS * legendCols);
    for (let i = 0; i < shown.length; i++) {
      const { symbolId, symbolName } = shown[i];
      const col = i % legendCols;
      const row = Math.floor(i / legendCols);
      const colW = Math.floor(tbW / legendCols);
      const rowY = yLegend + LEGEND_HDR_H + row * LEGEND_ROW_H;
      const colX = tbX + col * colW;
      const iconSize = LEGEND_ROW_H - 2;

      const template = await getSymbolSvgTemplate(symbolId, svgCache);
      if (template) {
        const svgEl = template.cloneNode(true) as SVGElement;
        try {
          await svg2pdf(svgEl, pdf, { x: mm(colX + PAD), y: mm(rowY + 1), width: mm(iconSize), height: mm(iconSize) });
        } catch (err) {
          // Legend text label still conveys the symbol name even if the icon fails.
          console.error(`PDF export: failed to place legend icon for "${symbolId}":`, err);
        }
      }
      pdf.setFontSize(pt(7));
      pdf.setTextColor(VAL_CLR);
      const nameMaxWidthMm = mm(colW - PAD * 2 - iconSize - 3);
      pdf.text(truncateToWidth(pdf, symbolName, nameMaxWidthMm), mm(colX + PAD + iconSize + 3), mm(rowY + 2), {
        baseline: 'top',
      });
    }
    for (let ci = 0; ci < legendCols - 1; ci++) {
      const divX = tbXmm + mm(Math.floor(tbW * (ci + 1) / legendCols));
      pdf.setDrawColor(BORDER);
      pdf.setLineWidth(mm(0.5));
      pdf.line(divX, mm(yLegend + LEGEND_HDR_H), divX, mm(yLegend + legendH));
    }
  }

  // Drawing title
  box(tbX, yDt, tbW, dtRowH);
  label(tbX + PAD, yDt + 3, 'DRAWING TITLE', 5);
  label(tbX + PAD, yDt + 11, 'SCHEMATIC PLUMBING DRAWING', 6, VAL_CLR, true);

  // Row 1 — Drawn By | Date | Tenure of Land (spans rows 1+2)
  box(tbX, yRow1, c1W, btRowH);
  label(tbX + PAD, yRow1 + 2, 'DRAWN BY', 5);
  label(tbX + PAD, yRow1 + 10, titleBlock.drawnBy || '—', VAL_SZ, VAL_CLR);
  box(tbX + c1W, yRow1, c2W, btRowH);
  label(tbX + c1W + PAD, yRow1 + 2, 'DATE', 5);
  label(tbX + c1W + PAD, yRow1 + 10, titleBlock.date || '—', VAL_SZ, VAL_CLR);
  box(tbX + c1W + c2W, yRow1, c3W, btRowH * 2);
  label(tbX + c1W + c2W + PAD, yRow1 + 2, 'TENURE OF LAND', 5);
  pdf.setFontSize(pt(VAL_SZ));
  pdf.setTextColor(VAL_CLR);
  pdf.text(titleBlock.tenureOfLand || '—', mm(tbX + c1W + c2W + PAD), mm(yRow1 + 10), {
    baseline: 'top', maxWidth: mm(c3W - PAD * 2),
  });

  // Row 2 — Checked | Scale
  box(tbX, yRow2, c1W, btRowH);
  label(tbX + PAD, yRow2 + 2, 'CHECKED', 5);
  label(tbX + PAD, yRow2 + 10, titleBlock.checkedBy || '—', VAL_SZ, VAL_CLR);
  box(tbX + c1W, yRow2, c2W, btRowH);
  label(tbX + c1W + PAD, yRow2 + 2, 'SCALE', 5);
  label(tbX + c1W + PAD, yRow2 + 10, `1:${drawingScale}`, VAL_SZ, VAL_CLR);

  // Row 3 — Drawing No. | Project No. | Rev.
  box(tbX, yRow3, c1W, btRowH);
  label(tbX + PAD, yRow3 + 2, 'DRAWING NO.', 5);
  label(tbX + PAD, yRow3 + 10, titleBlock.drawingNo || '—', VAL_SZ, VAL_CLR);
  box(tbX + c1W, yRow3, c2W, btRowH);
  label(tbX + c1W + PAD, yRow3 + 2, 'PROJECT NO.', 5);
  label(tbX + c1W + PAD, yRow3 + 10, titleBlock.projectNo || '—', VAL_SZ, VAL_CLR);
  box(tbX + c1W + c2W, yRow3, c3W, btRowH);
  label(tbX + c1W + c2W + PAD, yRow3 + 2, 'REV.', 5);
  label(tbX + c1W + c2W + PAD, yRow3 + 10, titleBlock.rev || '—', VAL_SZ, VAL_CLR);
}

async function drawStamp(pdf: jsPDF, dataUrl: string, extraH: number, blockY: number, bH: number, tbX: number, tbW: number): Promise<void> {
  const img = await loadImage(dataUrl).catch(() => null);
  if (!img) return;
  const maxW = tbW - PAD * 4;
  const maxH = Math.min(extraH - 4, bH - 40);
  if (maxH <= 0) return;
  const s = Math.min(maxW / img.width, maxH / img.height, 1);
  const sw = img.width * s;
  const sh = img.height * s;
  const x = tbX + (tbW - sw) / 2;
  const y = blockY + bH - extraH + (extraH - sh) / 2 - 4;
  pdf.addImage(dataUrl, dataUrlFormat(dataUrl), mm(x), mm(y), mm(sw), mm(sh));
}

// ── Pipes ─────────────────────────────────────────────────────────────────

function drawArrowhead(pdf: jsPDF, sx: number, sy: number, ex: number, ey: number, pointerLength: number, pointerWidth: number): void {
  const angle = Math.atan2(ey - sy, ex - sx);
  const baseX = ex - pointerLength * Math.cos(angle);
  const baseY = ey - pointerLength * Math.sin(angle);
  const perpX = -Math.sin(angle) * (pointerWidth / 2);
  const perpY = Math.cos(angle) * (pointerWidth / 2);
  pdf.triangle(ex, ey, baseX + perpX, baseY + perpY, baseX - perpX, baseY - perpY, 'F');
}

/** Draws one pipe run (a straight segment or an arc bulge) as ONE continuous stroked
 *  path via jsPDF's .lines() — a multi-point arc needs this so it doesn't fragment into
 *  separately-stroked sub-segments; a 2-point straight run degrades to the same thing a
 *  plain .line() would draw. Segments are drawn independently (not one path for the
 *  whole pipe) precisely so an arc bulge's dash state can differ from the straight runs
 *  around it — see buildJumpSegments' isArcBulge doc. */
function drawPipeBody(pdf: jsPDF, points: { x: number; y: number }[], dashed: boolean): void {
  if (dashed) pdf.setLineDashPattern([mm(PIPE_HOT_DASH[0]), mm(PIPE_HOT_DASH[1])], 0);
  const [p0, ...rest] = points;
  const deltas = rest.map((p, i) => {
    const prev = i === 0 ? p0 : rest[i - 1];
    return [mm(p.x) - mm(prev.x), mm(p.y) - mm(prev.y)];
  });
  pdf.lines(deltas, mm(p0.x), mm(p0.y), [1, 1], 'S');
  if (dashed) pdf.setLineDashPattern([], 0); // reset before the next segment/pipe/shape, mirrors drawGrid's grid-line dash reset above
}

function drawPipes(pdf: jsPDF, pipes: PipeElementType[]): void {
  const pipeJumps = computePipeJumps(pipes); // one-shot per export, not memoized like the canvas side
  for (const pipe of pipes) {
    const dx = pipe.endX - pipe.startX;
    const dy = pipe.endY - pipe.startY;
    // A near-zero-length pipe has nothing meaningful to draw in a static export —
    // unlike the live canvas (PipeElement.tsx), there's no "keep it grabbable so
    // the user can pull it apart" concern here, so it's simply skipped.
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    const { color, strokeWidth } = getPipeDrawStyle(pipe.pipeType, false, pipe.customColor);
    const segments = buildJumpSegments(pipe.startX, pipe.startY, pipe.endX, pipe.endY, pipeJumps.get(pipe.id) ?? [], PIPE_JUMP_RADIUS_PX);

    pdf.setDrawColor(color);
    pdf.setFillColor(color);
    pdf.setLineWidth(mm(strokeWidth));
    pdf.setLineCap('round');
    pdf.setLineJoin('round');
    for (const seg of segments) {
      drawPipeBody(pdf, seg.points, pipe.pipeType === 'hot' && !seg.isArcBulge);
    }

    // Flow-direction arrowhead at the pipe's midpoint (matches PipeElement.tsx's canvas
    // render — see getPipeMidpointArrow) rather than terminating the line at its endpoint.
    const arrow = getPipeMidpointArrow(pipe.startX, pipe.startY, pipe.endX, pipe.endY, PIPE_ARROW_POINTER_LENGTH);
    drawArrowhead(
      pdf, mm(arrow.tailX), mm(arrow.tailY), mm(arrow.midX), mm(arrow.midY),
      mm(PIPE_ARROW_POINTER_LENGTH), mm(PIPE_ARROW_POINTER_WIDTH),
    );

    if (pipe.diameterLabel) {
      const anchor = getPipeDiameterLabelAnchor(pipe.startX, pipe.startY, pipe.endX, pipe.endY, PIPE_DIAMETER_LABEL_OFFSET);
      pdf.setFontSize(pt(PIPE_DIAMETER_LABEL_FONT_SIZE));
      pdf.setTextColor(color);
      pdf.text(`Ø${pipe.diameterLabel}`, mm(anchor.x), mm(anchor.y), {
        align: anchor.align, baseline: anchor.vAlign,
      });
    }
  }
}

// ── Symbols ───────────────────────────────────────────────────────────────

async function drawSymbols(
  pdf: jsPDF,
  elements: CanvasElement[],
  pipes: PipeElementType[],
  svgCache: Map<string, SVGElement | null>,
): Promise<void> {
  for (const el of elements) {
    const template = await getSymbolSvgTemplate(el.symbolId, svgCache);
    if (!template) continue; // skip symbols whose SVG failed to load rather than aborting the export

    const svgEl = template.cloneNode(true) as SVGElement;
    if (TINT_SYMBOL_IDS.has(el.symbolId)) {
      const tint = getElbowTeeTint(el, elements, pipes);
      if (tint) recolorSvgStroke(svgEl, getPipeDrawStyle(tint.pipeType, false, tint.customColor).color);
    }

    const mirror = (el.scaleX ?? 1) === -1 && shouldMirrorSymbolImage(el.symbolId);
    try {
      await placeSymbolCentered(
        pdf, svgEl,
        mm(el.x), mm(el.y), mm(el.width), mm(el.height),
        el.rotation, mirror,
      );
    } catch (err) {
      // One malformed symbol shouldn't take down the whole export — skip it and keep going.
      console.error(`PDF export: failed to place symbol "${el.symbolId}" (element ${el.id}):`, err);
    }

    // Dynamic value label — matches ElementsLayer.tsx's canvas render (same shared
    // constants) so the marker's declared elevation is actually visible on the exported
    // drawing, not just on-screen.
    if (el.symbolId === 'highest_direct_supply_fitting') {
      pdf.setFontSize(pt(HIGHEST_FITTING_LABEL_FONT_SIZE));
      pdf.setTextColor(HIGHEST_FITTING_LABEL_COLOR);
      pdf.setFont('helvetica', 'bold');
      const text = `Highest Direct Supply Fitting: ${el.highestFittingElevationM ?? '—'} m`;
      pdf.text(text, mm(el.x + el.width / 2 + 2), mm(el.y - 1.5), { baseline: 'bottom' });
      pdf.setFont('helvetica', 'normal');
    }
  }
}

// ── Annotations ───────────────────────────────────────────────────────────

function drawAnnotations(pdf: jsPDF, annotations: AnnotationElement[]): void {
  for (const ann of annotations) {
    const displayHeight = ann.height > 0 ? ann.height : ann.fontSize * 1.35 * 2;
    const x = mm(ann.x - 4.5);
    const y = mm(ann.y - 4.5);
    const w = mm(ann.maxWidth + 9);
    const h = mm(displayHeight + 9);

    pdf.setFillColor('#fffFdc'); // approximates rgba(255,255,220,0.95) at full opacity on a white page
    pdf.setDrawColor('#bbbbbb');
    pdf.setLineWidth(mm(0.5));
    pdf.roundedRect(x, y, w, h, mm(2), mm(2), 'FD');

    pdf.setFontSize(pt(ann.fontSize));
    pdf.setTextColor(ann.color);
    pdf.text(ann.text, mm(ann.x), mm(ann.y), {
      baseline: 'top', maxWidth: mm(ann.maxWidth), lineHeightFactor: 1.35,
    });
  }
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function exportSchematicToPdf(virtualWidth: number, virtualHeight: number): Promise<void> {
  const { elements, pipes, annotations } = useCanvasStore.getState();
  const { sheetConfig, floorLevels, mrlConfig, floorLevelOpacity } = useUiStore.getState();

  const widthMm = mm(virtualWidth);
  const heightMm = mm(virtualHeight);
  const pdf = new jsPDF({
    orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
  });

  const svgCache = new Map<string, SVGElement | null>();

  // Same bottom-to-top z-order as the Konva Stage in DrawingCanvas.tsx.
  drawGrid(pdf, virtualWidth, virtualHeight, mrlConfig.upperMrl, mrlConfig.lowerMrl, floorLevels, floorLevelOpacity);
  await drawTitleBlock(pdf, sheetConfig, elements, svgCache);
  if (sheetConfig.titleBlock.lpPeStamp) {
    const size = sheetConfig.titleBlock.lpPeStampSize ?? 100;
    const paperH = PAPER_SIZES_MM[sheetConfig.paperSize].h * SHEET_PX_PER_MM;
    const lx = sheetConfig.titleBlock.lpPeStampX ?? AXIS_WIDTH + 20;
    const ly = sheetConfig.titleBlock.lpPeStampY ?? paperH - size - 20;
    pdf.addImage(sheetConfig.titleBlock.lpPeStamp, dataUrlFormat(sheetConfig.titleBlock.lpPeStamp), mm(lx), mm(ly), mm(size), mm(size));
  }
  drawPipes(pdf, pipes);
  await drawSymbols(pdf, elements, pipes, svgCache);
  drawAnnotations(pdf, annotations);

  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  pdf.save(`schematic_${ts}.pdf`);
}

import { Arrow, Circle, Line, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '../../store/canvasStore';
import { PipeType } from '../../types';
import { buildJumpSegments, PipeJump, PIPE_JUMP_RADIUS_PX } from '../../utils/pipeJumps';

interface PipeColors {
  normal: string;
  selected: string;
}

const PIPE_COLORS: Record<PipeType, PipeColors> = {
  generic: { normal: '#1a6faf', selected: '#0066cc' },
  cold:    { normal: '#007bff', selected: '#0055cc' },
  hot:     { normal: '#e63329', selected: '#b51f1a' },
};

/** Arrowhead dimensions for cold/hot pipes (react-konva Arrow props) — shared with the PDF exporter. */
export const PIPE_ARROW_POINTER_LENGTH = 2;
export const PIPE_ARROW_POINTER_WIDTH = 2;

/** [onLength, offLength] dash pattern for hot pipes — shared with the PDF exporter (there,
 *  each value is converted via mm()) so the two can't silently drift apart the way this
 *  codebase's duplicated constants have before (see e.g. NEVER_MIRROR_IMAGE_SYMBOL_IDS'
 *  history in types/index.ts). */
export const PIPE_HOT_DASH: [number, number] = [4, 2];

/** Font size (schematic world units) and clearance between the pipe centerline and its
 *  optional diameter label — shared with the PDF exporter. */
export const PIPE_DIAMETER_LABEL_FONT_SIZE = 1.8;
export const PIPE_DIAMETER_LABEL_OFFSET = 2.6;
/** Width of the text box the label is laid out in — wide enough for a short size string
 *  ("Ø20mm", "ØDN25"); longer text simply overflows the box rather than clipping. */
export const PIPE_DIAMETER_LABEL_BOX_WIDTH = 20;

export interface PipeDiameterLabelAnchor {
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
}

/** Diameter label placement: offset from the pipe's midpoint along the perpendicular to
 *  its direction, not a fixed "move up" — a fixed vertical offset only reads correctly for
 *  a horizontal pipe; on a vertical one it just slides the label further along the pipe's
 *  own line, straight through the arrowhead. Rotating the pipe's unit direction vector 90°
 *  gives a normal that happens to point "up" for a left-to-right horizontal pipe and
 *  "right" for a top-to-bottom vertical one — matching the drafting convention in the
 *  reference drawing (size label above a horizontal run, beside a vertical one). Diagonal
 *  pipes fall through to whichever axis the offset is more aligned with. Text itself always
 *  stays upright (never rotated to match the pipe), same as the reference drawing.
 *
 *  The direction vector is canonicalized (flipped to a consistent half-plane) BEFORE
 *  computing the perpendicular, so the label's side depends only on the pipe's geometry —
 *  not on which end happened to be clicked first while drawing it. Without this, two
 *  pipes that look identical on screen but were drawn in opposite order would place the
 *  label on opposite sides, which is confusing when there's no house convention for which
 *  end to click first. This deliberately does NOT affect the arrowhead's own direction
 *  (getPipeMidpointArrow) — that still reflects the pipe's real start=outlet/end=inlet
 *  flow direction, which other logic (port-connection validation, export flow-direction)
 *  depends on. Shared by the canvas renderer and the PDF exporter. */
export function getPipeDiameterLabelAnchor(
  startX: number, startY: number, endX: number, endY: number, offset: number,
): PipeDiameterLabelAnchor {
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.hypot(dx, dy) || 1;
  let ux = dx / len, uy = dy / len;
  // Canonicalize to the half-plane where ux > 0 (or, for an exactly-vertical pipe, uy > 0)
  // — flipping (ux,uy) to its negation doesn't change the pipe's geometry, only which end
  // is "start", so this cancels out draw-order entirely.
  if (ux < 0 || (ux === 0 && uy < 0)) { ux = -ux; uy = -uy; }
  const nx = uy, ny = -ux; // rotate direction 90°
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;

  if (Math.abs(uy) < Math.abs(ux)) {
    // Mostly horizontal pipe — stack the label above/below, centered on x.
    return { x: midX, y: midY + ny * offset, align: 'center', vAlign: ny < 0 ? 'bottom' : 'top' };
  }
  // Mostly vertical (or diagonal) pipe — place the label beside it, centered on y.
  return { x: midX + nx * offset, y: midY, align: nx >= 0 ? 'left' : 'right', vAlign: 'middle' };
}

/** Flow-direction arrowhead placement: the pipe's straight-line midpoint (not the
 *  jump-arc-detoured path — jump bulges are tiny relative to a typical pipe run, so
 *  using the true endpoints keeps the arrow pointing along the pipe's overall direction
 *  instead of picking up a stray tangent if the midpoint happens to land inside a bulge).
 *  Returns the two points an Arrow needs (a short tail-to-tip stub) so the tip lands
 *  exactly at the midpoint, plus the angle for anything that needs to place a label
 *  relative to it. Shared by the canvas renderer and the PDF exporter. */
export function getPipeMidpointArrow(startX: number, startY: number, endX: number, endY: number, pointerLength: number) {
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const angle = Math.atan2(endY - startY, endX - startX);
  const tailX = midX - pointerLength * Math.cos(angle);
  const tailY = midY - pointerLength * Math.sin(angle);
  return { midX, midY, angle, tailX, tailY };
}

/** Pipe stroke color/width for a given type + selection state — single source of truth for both the Konva canvas and the PDF exporter.
 *  `customColor`, when set, always wins over the type default — even while selected. Selection is then communicated by
 *  strokeWidth alone (matches Word: your chosen color persists regardless of cursor/selection state). */
export function getPipeDrawStyle(pipeType: PipeType, isSelected: boolean, customColor?: string): { color: string; strokeWidth: number } {
  const { normal, selected } = PIPE_COLORS[pipeType ?? 'generic'];
  const color = customColor ?? (isSelected ? selected : normal);
  return { color, strokeWidth: isSelected ? 1 : 0.5 };
}

interface PipeElementProps {
  id: string;
  pipeType: PipeType;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  isSelected: boolean;
  isHovered?: boolean;
  customColor?: string;
  diameterLabel?: string;
  jumps?: PipeJump[];
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
}

export function PipeElement({
  id,
  pipeType,
  startX,
  startY,
  endX,
  endY,
  isSelected,
  isHovered = false,
  customColor,
  diameterLabel,
  jumps,
  onHoverEnter,
  onHoverLeave,
}: PipeElementProps) {
  const setSelected = useCanvasStore((s) => s.setSelected);
  const updatePipeEndpoints = useCanvasStore((s) => s.updatePipeEndpoints);

  const { color, strokeWidth } = getPipeDrawStyle(pipeType, isSelected, customColor);
  const dash: [number, number] | undefined = pipeType === 'hot' ? PIPE_HOT_DASH : undefined;
  const segments = buildJumpSegments(startX, startY, endX, endY, jumps ?? [], PIPE_JUMP_RADIUS_PX);

  const dx = endX - startX;
  const dy = endY - startY;
  // A pipe collapsed to near-zero length (e.g. one endpoint dragged onto the
  // other) still renders its Line segment(s) and endpoint Circles below — that
  // Line is what gives it a clickable hit region at all (the Circles only
  // start listening once selected), so bailing out entirely here would make
  // the pipe permanently unselectable/undeletable while still existing in the
  // store. Only the arrowhead and diameter label — meaningless at a point —
  // are skipped.
  const isNearZeroLength = Math.abs(dx) < 1 && Math.abs(dy) < 1;

  // Flow-direction arrowhead, pointing start->end, drawn at the pipe's midpoint.
  // All pipe types carry this start=outlet/end=inlet direction convention —
  // it's what port-connection validation (portConnectionStatus.ts) and export
  // flow-direction (metadataBuilder.ts) key off of; only where the arrow itself
  // renders (midpoint, not the endpoint) has changed.
  const arrow = getPipeMidpointArrow(startX, startY, endX, endY, PIPE_ARROW_POINTER_LENGTH);

  // Draggable endpoints when selected.
  const isHorizontal = Math.abs(dx) >= Math.abs(dy);
  const dragCursor = isHorizontal ? 'ew-resize' : 'ns-resize';

  const handleStartDragMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isHorizontal) (e.target as Konva.Node).y(startY);
    else (e.target as Konva.Node).x(startX);
  };

  const handleStartDragEnd = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const nx = isHorizontal ? (e.target as Konva.Node).x() : startX;
    const ny = isHorizontal ? startY : (e.target as Konva.Node).y();
    updatePipeEndpoints(id, nx, ny, endX, endY);
  };

  const handleEndDragMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isHorizontal) (e.target as Konva.Node).y(endY);
    else (e.target as Konva.Node).x(endX);
  };

  const handleEndDragEnd = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const nx = isHorizontal ? (e.target as Konva.Node).x() : endX;
    const ny = isHorizontal ? endY : (e.target as Konva.Node).y();
    updatePipeEndpoints(id, startX, startY, nx, ny);
  };

  const handleCursorEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = (e.target as Konva.Node).getStage();
    if (stage) stage.container().style.cursor = dragCursor;
  };

  const handleCursorLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = (e.target as Konva.Node).getStage();
    if (stage) stage.container().style.cursor = 'default';
  };

  const handleBodyMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    onHoverEnter?.();
    const stage = (e.target as Konva.Node).getStage();
    if (stage) stage.container().style.cursor = 'pointer';
  };

  const handleBodyMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    onHoverLeave?.();
    const stage = (e.target as Konva.Node).getStage();
    if (stage) stage.container().style.cursor = 'default';
  };

  const handleBodyClick = (e: Konva.KonvaEventObject<MouseEvent>) => { if (e.evt.button === 0) setSelected(id); };
  const handleBodyTap = () => setSelected(id);

  return (
    <>
      {/* Hover indicator — same treatment as a hovered symbol's port dots
          (ElementsLayer.tsx): small filled circles with a white ring, shown
          at the pipe's two endpoints. */}
      {isHovered && !isSelected && (
        <>
          <Circle x={startX} y={startY} radius={1} fill={color} stroke="#fff" strokeWidth={0.5} listening={false} />
          <Circle x={endX} y={endY} radius={1} fill={color} stroke="#fff" strokeWidth={0.5} listening={false} />
        </>
      )}
      {/* Rendered as one segment per straight run / arc bulge so a jump arc can always
          render solid regardless of the pipe's own dash pattern — see buildJumpSegments'
          isArcBulge doc for why. The zero-jump case (the common one) still produces
          exactly one segment, i.e. one plain Line spanning the whole pipe. The flow-
          direction arrowhead is drawn separately, at the pipe's midpoint rather than
          terminating this line (AutoCAD-style flow arrow) — see getPipeMidpointArrow. */}
      {segments.map((seg, i) => {
        const flatPoints = seg.points.flatMap((p) => [p.x, p.y]);
        const segDash = seg.isArcBulge ? undefined : dash;
        // Keyed by the segment's own physical location (not array index) — jump-arc
        // count/order can shift between renders when an unrelated pipe starts or stops
        // crossing this one, and an index key would let React silently reuse a Konva
        // node instance across two segments that just happen to land at the same
        // position, rather than the same segment. Harmless today since every prop is
        // recomputed fresh each render, but would misattribute any future per-node
        // state (e.g. a Tween) to the wrong segment.
        const segKey = `${seg.isArcBulge ? 'arc' : 'run'}:${seg.points[0].x.toFixed(3)},${seg.points[0].y.toFixed(3)}`;
        return (
          <Line
            key={segKey}
            points={flatPoints}
            stroke={color}
            strokeWidth={strokeWidth}
            dash={segDash}
            lineCap="round"
            lineJoin="round"
            hitStrokeWidth={3}
            perfectDrawEnabled={false}
            onClick={handleBodyClick}
            onTap={handleBodyTap}
            onMouseEnter={handleBodyMouseEnter}
            onMouseLeave={handleBodyMouseLeave}
          />
        );
      })}
      {!isNearZeroLength && (
        <Arrow
          points={[arrow.tailX, arrow.tailY, arrow.midX, arrow.midY]}
          stroke={color}
          fill={color}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={3}
          pointerLength={PIPE_ARROW_POINTER_LENGTH}
          pointerWidth={PIPE_ARROW_POINTER_WIDTH}
          perfectDrawEnabled={false}
          onClick={handleBodyClick}
          onTap={handleBodyTap}
          onMouseEnter={handleBodyMouseEnter}
          onMouseLeave={handleBodyMouseLeave}
        />
      )}
      {!isNearZeroLength && diameterLabel && (() => {
        const anchor = getPipeDiameterLabelAnchor(startX, startY, endX, endY, PIPE_DIAMETER_LABEL_OFFSET);
        const w = PIPE_DIAMETER_LABEL_BOX_WIDTH;
        const boxX = anchor.align === 'center' ? anchor.x - w / 2 : anchor.align === 'right' ? anchor.x - w : anchor.x;
        const boxY = anchor.vAlign === 'middle' ? anchor.y - PIPE_DIAMETER_LABEL_FONT_SIZE / 2
          : anchor.vAlign === 'bottom' ? anchor.y - PIPE_DIAMETER_LABEL_FONT_SIZE
          : anchor.y;
        return (
          <Text
            x={boxX}
            y={boxY}
            width={w}
            text={`Ø${diameterLabel}`}
            fontSize={PIPE_DIAMETER_LABEL_FONT_SIZE}
            fill={color}
            align={anchor.align}
            listening={false}
          />
        );
      })()}
      {/* Upstream endpoint */}
      <Circle
        x={startX}
        y={startY}
        radius={isSelected ? 1 : 0.5}
        fill={color}
        listening={isSelected}
        draggable={isSelected}
        onDragMove={handleStartDragMove}
        onDragEnd={handleStartDragEnd}
        onMouseEnter={handleCursorEnter}
        onMouseLeave={handleCursorLeave}
      />
      {/* Downstream endpoint */}
      <Circle
        x={endX}
        y={endY}
        radius={isSelected ? 1 : 0.5}
        fill={color}
        listening={isSelected}
        draggable={isSelected}
        onDragMove={handleEndDragMove}
        onDragEnd={handleEndDragEnd}
        onMouseEnter={handleCursorEnter}
        onMouseLeave={handleCursorLeave}
      />
    </>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Layer, Rect, Text, Line, Image as KonvaImage } from 'react-konva';
import { type SheetConfig } from '../../types';
import { useCanvasStore } from '../../store/canvasStore';
import { symbolsApi } from '../../api/client';
import {
  computeTitleBlockLayout, BORDER, LBL_CLR, VAL_CLR, LBL_SZ, VAL_SZ, PAD,
  LEGEND_ROW_H, LEGEND_HDR_H, LEGEND_MAX_ROWS,
} from '../../utils/titleBlockLayout';

interface Props {
  sheetConfig: SheetConfig;
  onTitleBlockClick?: () => void;
}

export function TitleBlockLayer({ sheetConfig, onTitleBlockClick }: Props) {
  const { titleBlock, drawingScale } = sheetConfig;

  const [ownerStampImg, setOwnerStampImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!titleBlock.ownerStamp) { setOwnerStampImg(null); return; }
    const img = new window.Image();
    img.onload = () => setOwnerStampImg(img);
    img.src = titleBlock.ownerStamp;
  }, [titleBlock.ownerStamp]);

  const [peStampImg, setPeStampImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!titleBlock.peStamp) { setPeStampImg(null); return; }
    const img = new window.Image();
    img.onload = () => setPeStampImg(img);
    img.src = titleBlock.peStamp;
  }, [titleBlock.peStamp]);

  // ── Legend: unique symbols on canvas ──────────────────────────
  const elements = useCanvasStore((s) => s.elements);
  const uniqueSymbols = useMemo(() => {
    const seen = new Set<string>();
    const result: { symbolId: string; symbolName: string }[] = [];
    for (const el of elements) {
      if (!seen.has(el.symbolId)) {
        seen.add(el.symbolId);
        result.push({ symbolId: el.symbolId, symbolName: el.symbolName });
      }
    }
    return result.sort((a, b) => a.symbolName.localeCompare(b.symbolName));
  }, [elements]);

  const [legendImgs, setLegendImgs] = useState<Map<string, HTMLImageElement>>(new Map());
  const symbolKey = uniqueSymbols.map((s) => s.symbolId).join(',');
  useEffect(() => {
    if (uniqueSymbols.length === 0) { setLegendImgs(new Map()); return; }
    const map = new Map<string, HTMLImageElement>();
    let pending = uniqueSymbols.length;
    uniqueSymbols.forEach(({ symbolId }) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      const done = () => { pending--; if (pending === 0) setLegendImgs(new Map(map)); };
      img.onload = () => { map.set(symbolId, img); done(); };
      img.onerror = done;
      img.src = symbolsApi.getImageUrl(symbolId);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey]);

  const layout = useMemo(
    () => computeTitleBlockLayout(sheetConfig, uniqueSymbols.length, !!ownerStampImg, !!peStampImg),
    [sheetConfig, uniqueSymbols.length, ownerStampImg, peStampImg],
  );
  const {
    paperH, tbW, tbX, headerH,
    ownerStampExtraH, peStampExtraH,
    ownerH, peH, projH, mainH, plumberH,
    yOwner, yPe, yProj, yMain, yPlumber,
    legendCols: LEGEND_COLS, legendH, yLegend,
    btRowH, dtRowH, yDt, yRow1, yRow2, yRow3,
    c1W, c2W, c3W, borderWidth: bw,
  } = layout;

  const BlockText = (x: number, y: number, label: string, text: string | undefined) => [
    <Text key={`lbl-${label}`} x={x + PAD} y={y + PAD}
          text={label} fontSize={LBL_SZ} fill={LBL_CLR} listening={false} />,
    <Text key={`val-${label}`}
          x={x + PAD} y={y + PAD + LBL_SZ + 4}
          width={tbW - PAD * 2}
          text={text || ''}
          fontSize={VAL_SZ} fill={VAL_CLR}
          lineHeight={1.35} wrap="word" listening={false} />,
  ];

  const renderStamp = (
    img: HTMLImageElement | null,
    extraH: number,
    blockY: number,
    bH: number,
    key: string,
  ) => {
    if (!img) return null;
    const maxW = tbW - PAD * 4;
    const maxH = Math.min(extraH - 4, bH - 40);
    if (maxH <= 0) return null;
    const s  = Math.min(maxW / img.width, maxH / img.height, 1);
    const sw = img.width  * s;
    const sh = img.height * s;
    return (
      <KonvaImage
        key={key}
        image={img}
        x={tbX + (tbW - sw) / 2}
        y={blockY + bH - extraH + (extraH - sh) / 2 - 4}
        width={sw} height={sh}
        listening={false}
      />
    );
  };

  return (
    <Layer>
      <Rect x={tbX} y={0} width={tbW} height={paperH} fill="#fff" listening={false} />
      <Line points={[tbX, 0, tbX, paperH]} stroke={BORDER} strokeWidth={1.5} listening={false} />

      {/* ═══ HEADER ══════════════════════════════════════════════ */}
      <Rect x={tbX} y={0} width={tbW} height={headerH}
            fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX} y={0} width={tbW} height={headerH}
            text="SCHEMATIC DRAWING"
            fontSize={11} fontStyle="bold" fill="#111"
            align="center" verticalAlign="middle" listening={false} />

      {/* ═══ OWNER / DEVELOPER ═══════════════════════════════════ */}
      <Rect x={tbX} y={yOwner} width={tbW} height={ownerH}
            fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      {BlockText(tbX, yOwner, 'OWNER / DEVELOPER :', titleBlock.ownerDeveloper)}
      {renderStamp(ownerStampImg, ownerStampExtraH, yOwner, ownerH, 'owner-stamp')}
      <Text x={tbX + PAD} y={yOwner + ownerH - 13}
            text="SIGN :" fontSize={LBL_SZ} fill={LBL_CLR} listening={false} />

      {/* ═══ PROFESSIONAL ENGINEER ═══════════════════════════════ */}
      <Rect x={tbX} y={yPe} width={tbW} height={peH}
            fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      {BlockText(tbX, yPe, 'PROFESSIONAL ENGINEER :', titleBlock.professionalEngineer)}
      {renderStamp(peStampImg, peStampExtraH, yPe, peH, 'pe-stamp')}
      <Text x={tbX + PAD} y={yPe + peH - 13}
            text="SIGN :" fontSize={LBL_SZ} fill={LBL_CLR} listening={false} />

      {/* ═══ PROJECT TITLE ════════════════════════════════════════ */}
      <Rect x={tbX} y={yProj} width={tbW} height={projH}
            fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      {BlockText(tbX, yProj, 'PROJECT TITLE', titleBlock.projectName)}

      {/* ═══ MAIN CON ═════════════════════════════════════════════ */}
      <Rect x={tbX} y={yMain} width={tbW} height={mainH}
            fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      {BlockText(tbX, yMain, 'MAIN CON :', titleBlock.mainContractor)}

      {/* ═══ LICENSED PLUMBER ═════════════════════════════════════ */}
      <Rect x={tbX} y={yPlumber} width={tbW} height={plumberH}
            fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      {BlockText(tbX, yPlumber, 'LICENSED PLUMBER', titleBlock.licensedPlumber)}

      {/* ═══ LEGEND ══════════════════════════════════════════════ */}
      {legendH > 0 && (
        <>
          <Rect x={tbX} y={yLegend} width={tbW} height={legendH}
                fill="#f8fafc" stroke={BORDER} strokeWidth={bw} listening={false} />
          <Text x={tbX + PAD} y={yLegend + 3}
                text="LEGEND" fontSize={LBL_SZ} fontStyle="bold" fill={LBL_CLR}
                listening={false} />
          <Line points={[tbX, yLegend + LEGEND_HDR_H - 1, tbX + tbW, yLegend + LEGEND_HDR_H - 1]}
                stroke={BORDER} strokeWidth={0.5} listening={false} />
          {uniqueSymbols.slice(0, LEGEND_MAX_ROWS * LEGEND_COLS).map(({ symbolId, symbolName }, i) => {
            const col = i % LEGEND_COLS;
            const row = Math.floor(i / LEGEND_COLS);
            const colW = Math.floor(tbW / LEGEND_COLS);
            const rowY = yLegend + LEGEND_HDR_H + row * LEGEND_ROW_H;
            const colX = tbX + col * colW;
            const img = legendImgs.get(symbolId);
            const iconSize = LEGEND_ROW_H - 2;
            return (
              <React.Fragment key={symbolId}>
                {img && (
                  <KonvaImage
                    image={img}
                    x={colX + PAD}
                    y={rowY + 1}
                    width={iconSize}
                    height={iconSize}
                    listening={false}
                  />
                )}
                <Text
                  x={colX + PAD + iconSize + 3}
                  y={rowY + 2}
                  text={symbolName}
                  fontSize={7}
                  fill={VAL_CLR}
                  listening={false}
                  width={colW - PAD * 2 - iconSize - 3}
                  ellipsis
                  wrap="none"
                />
              </React.Fragment>
            );
          })}
          {legendH > 0 && Array.from({ length: LEGEND_COLS - 1 }, (_, ci) => (
            <Line
              key={`legend-div-${ci}`}
              points={[tbX + Math.floor(tbW * (ci + 1) / LEGEND_COLS), yLegend + LEGEND_HDR_H, tbX + Math.floor(tbW * (ci + 1) / LEGEND_COLS), yLegend + legendH]}
              stroke={BORDER} strokeWidth={0.5} listening={false}
            />
          ))}
        </>
      )}

      {/* ═══ DRAWING TITLE ════════════════════════════════════════ */}
      <Rect x={tbX} y={yDt} width={tbW} height={dtRowH}
            fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + PAD} y={yDt + 3}
            text="DRAWING TITLE" fontSize={5} fill={LBL_CLR} listening={false} />
      <Text x={tbX + PAD} y={yDt + 11}
            text="SCHEMATIC PLUMBING DRAWING"
            fontSize={6} fontStyle="bold" fill={VAL_CLR} listening={false} />

      {/* ═══ Row 1 — Drawn By | Date | Tenure of Land (spans rows 1+2) */}
      <Rect x={tbX}       y={yRow1} width={c1W} height={btRowH} fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + PAD} y={yRow1 + 2}  text="DRAWN BY"                    fontSize={5}    fill={LBL_CLR} listening={false} />
      <Text x={tbX + PAD} y={yRow1 + 10} text={titleBlock.drawnBy || '—'}   fontSize={VAL_SZ} fill={VAL_CLR} listening={false} />

      <Rect x={tbX + c1W}       y={yRow1} width={c2W} height={btRowH} fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + c1W + PAD} y={yRow1 + 2}  text="DATE"                      fontSize={5}    fill={LBL_CLR} listening={false} />
      <Text x={tbX + c1W + PAD} y={yRow1 + 10} text={titleBlock.date || '—'}    fontSize={VAL_SZ} fill={VAL_CLR} listening={false} />

      {/* Tenure of Land — spans rows 1+2 */}
      <Rect x={tbX + c1W + c2W} y={yRow1} width={c3W} height={btRowH * 2} fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + c1W + c2W + PAD} y={yRow1 + 2}  text="TENURE OF LAND"                    fontSize={5}    fill={LBL_CLR} listening={false} />
      <Text x={tbX + c1W + c2W + PAD} y={yRow1 + 10} text={titleBlock.tenureOfLand || '—'}    fontSize={VAL_SZ} fill={VAL_CLR} wrap="word" width={c3W - PAD * 2} listening={false} />

      {/* ═══ Row 2 — Checked | Scale (Tenure col already drawn above) */}
      <Rect x={tbX}       y={yRow2} width={c1W} height={btRowH} fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + PAD} y={yRow2 + 2}  text="CHECKED"                      fontSize={5}    fill={LBL_CLR} listening={false} />
      <Text x={tbX + PAD} y={yRow2 + 10} text={titleBlock.checkedBy || '—'}  fontSize={VAL_SZ} fill={VAL_CLR} listening={false} />

      <Rect x={tbX + c1W}       y={yRow2} width={c2W} height={btRowH} fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + c1W + PAD} y={yRow2 + 2}  text="SCALE"                     fontSize={5}    fill={LBL_CLR} listening={false} />
      <Text x={tbX + c1W + PAD} y={yRow2 + 10} text={`1:${drawingScale}`}        fontSize={VAL_SZ} fill={VAL_CLR} listening={false} />

      {/* ═══ Row 3 — Drawing No. | Project No. | Rev. */}
      <Rect x={tbX}       y={yRow3} width={c1W} height={btRowH} fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + PAD} y={yRow3 + 2}  text="DRAWING NO."                   fontSize={5}    fill={LBL_CLR} listening={false} />
      <Text x={tbX + PAD} y={yRow3 + 10} text={titleBlock.drawingNo || '—'}   fontSize={VAL_SZ} fill={VAL_CLR} listening={false} />

      <Rect x={tbX + c1W}       y={yRow3} width={c2W} height={btRowH} fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + c1W + PAD} y={yRow3 + 2}  text="PROJECT NO."                     fontSize={5}    fill={LBL_CLR} listening={false} />
      <Text x={tbX + c1W + PAD} y={yRow3 + 10} text={titleBlock.projectNo || '—'}     fontSize={VAL_SZ} fill={VAL_CLR} listening={false} />

      <Rect x={tbX + c1W + c2W}       y={yRow3} width={c3W} height={btRowH} fill="#fff" stroke={BORDER} strokeWidth={bw} listening={false} />
      <Text x={tbX + c1W + c2W + PAD} y={yRow3 + 2}  text="REV."                    fontSize={5}    fill={LBL_CLR} listening={false} />
      <Text x={tbX + c1W + c2W + PAD} y={yRow3 + 10} text={titleBlock.rev || '—'}   fontSize={VAL_SZ} fill={VAL_CLR} listening={false} />

      {/* ═══ Transparent click overlay — must be last (on top) ═══ */}
      {onTitleBlockClick && (
        <Rect
          x={tbX} y={0} width={tbW} height={paperH}
          fill="#ffffff" opacity={0}
          onClick={onTitleBlockClick}
          onTap={onTitleBlockClick}
          style={{ cursor: 'pointer' } as React.CSSProperties}
        />
      )}
    </Layer>
  );
}

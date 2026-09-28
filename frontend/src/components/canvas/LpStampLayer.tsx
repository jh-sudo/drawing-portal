import { useEffect, useRef, useState } from 'react';
import { Layer, Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useUiStore } from '../../store/uiStore';
import { AXIS_WIDTH, PAPER_SIZES_MM, SHEET_PX_PER_MM } from '../../types';
import type { SheetConfig } from '../../types';

interface Props {
  sheetConfig: SheetConfig;
}

const DEFAULT_SIZE = 100; // canvas px

export function LpStampLayer({ sheetConfig }: Props) {
  const { titleBlock, paperSize } = sheetConfig;
  const setSheetConfig = useUiStore((s) => s.setSheetConfig);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [selected, setSelected] = useState(false);
  const imageRef   = useRef<Konva.Image>(null);
  const trRef      = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (!titleBlock.lpStamp) { setImg(null); return; }
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = titleBlock.lpStamp;
  }, [titleBlock.lpStamp]);

  // Attach transformer when selected
  useEffect(() => {
    if (selected && trRef.current && imageRef.current) {
      trRef.current.nodes([imageRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selected]);

  // Deselect on outside click
  useEffect(() => {
    if (!selected) return;
    const handler = () => setSelected(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selected]);

  if (!img) return null;

  const paperH = PAPER_SIZES_MM[paperSize].h * SHEET_PX_PER_MM;
  const size   = titleBlock.lpStampSize ?? DEFAULT_SIZE;

  // Default position: bottom-left of paper area, above the bottom margin
  const x = titleBlock.lpStampX ?? AXIS_WIDTH + 20;
  const y = titleBlock.lpStampY ?? paperH - size - 20;

  const saveTransform = () => {
    const node = imageRef.current;
    if (!node) return;
    const newSize = Math.round(Math.max(node.width() * node.scaleX(), node.height() * node.scaleY()));
    node.scaleX(1);
    node.scaleY(1);
    setSheetConfig({
      ...sheetConfig,
      titleBlock: {
        ...titleBlock,
        lpStampX:    Math.round(node.x()),
        lpStampY:    Math.round(node.y()),
        lpStampSize: newSize,
      },
    });
  };

  return (
    <Layer>
      <KonvaImage
        ref={imageRef}
        image={img}
        x={x}
        y={y}
        width={size}
        height={size}
        draggable
        onClick={(e) => { e.cancelBubble = true; setSelected(true); }}
        onTap={(e)   => { e.cancelBubble = true; setSelected(true); }}
        onDragEnd={saveTransform}
        onTransformEnd={saveTransform}
      />
      {selected && (
        <Transformer
          ref={trRef}
          keepRatio
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          rotateEnabled={false}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 30 || newBox.height < 30) return oldBox;
            return newBox;
          }}
        />
      )}
    </Layer>
  );
}

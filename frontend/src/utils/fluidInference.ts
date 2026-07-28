import { getElementPorts, getEffectivePortRole, getPortPosition } from './symbolPorts';
import type { PipeElement, CanvasElement } from '../types';

/**
 * Returns the fluid type at canvas point (x, y) by finding which pipe endpoint
 * the point touches, then following that pipe's upstream connection if generic.
 *
 * Closest-wins: at a busy junction with several pipe stubs within matchRadius,
 * the nearest endpoint decides the result rather than array/insertion order.
 */
export function inferFluidAtPoint(
  pipes: PipeElement[],
  x: number,
  y: number,
  allElements: CanvasElement[],
  matchRadius = 5,
): 'cold' | 'hot' | undefined {
  let bestDist = matchRadius;
  let bestResult: 'cold' | 'hot' | undefined;

  for (const pipe of pipes) {
    const distStart = Math.hypot(pipe.startX - x, pipe.startY - y);
    const distEnd = Math.hypot(pipe.endX - x, pipe.endY - y);
    const atStart = distStart < matchRadius;
    const atEnd = distEnd < matchRadius;
    if (!atStart && !atEnd) continue;
    const dist = atStart && atEnd ? Math.min(distStart, distEnd) : (atStart ? distStart : distEnd);
    if (dist >= bestDist) continue;

    let result: 'cold' | 'hot' | undefined;
    if (pipe.pipeType === 'cold' || pipe.pipeType === 'hot') {
      result = pipe.pipeType;
    } else {
      const otherX = atEnd ? pipe.startX : pipe.endX;
      const otherY = atEnd ? pipe.startY : pipe.endY;
      outer:
      for (const el of allElements) {
        const ports = getElementPorts(el);
        for (let i = 0; i < ports.length; i++) {
          if (getEffectivePortRole(el, i) !== 'downstream') continue;
          const pos = getPortPosition(el, ports[i]);
          if (Math.hypot(pos.x - otherX, pos.y - otherY) < matchRadius) {
            result = el.carriesFluid;
            break outer;
          }
        }
      }
    }

    if (result !== undefined) {
      bestDist = dist;
      bestResult = result;
    }
  }

  return bestResult;
}

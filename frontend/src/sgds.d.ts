// JSX typing for the SGDS web components used in this app (React 18 has no
// built-in support for custom elements in TSX).
import type { HTMLAttributes } from 'react';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'sgds-masthead': HTMLAttributes<HTMLElement> & { fluid?: boolean };
    }
  }
}

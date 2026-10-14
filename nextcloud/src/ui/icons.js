// A few inline icons (Tabler outlines), so the slots need no assets.

import { createElement as h } from 'react';

const PATHS = {
  folder: 'M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2',
  file: 'M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
  cloud: 'M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878',
  up: 'M12 5l0 14 M18 11l-6 -6 M6 11l6 -6',
  x: 'M18 6l-12 12 M6 6l12 12',
};

export function Icon({ name, size = 18, className = 'nc-icon', label }) {
  return h('svg', {
    className, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  }, h('path', { d: PATHS[name] ?? PATHS.file }));
}

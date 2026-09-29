import { raw, esc } from './dom.js';

// The kitsune spirit. States: idle | thinking | error | happy.
// Used sparingly: empty/setup states, the generation indicator, errors, the app icon.

const EYES = {
  idle: '<path class="eye" d="M41 64q7-5 13 0q-7 3.5-13 0Z M66 64q6-5 13 0q-6 3.5-13 0Z"/>',
  thinking: '<path class="eye" d="M42 61q7-5 13 0q-7 3.5-13 0Z M67 61q6-5 13 0q-6 3.5-13 0Z"/>',
  happy: '<path class="line" d="M41 66q6.5-7 13 0 M66 66q6.5-7 13 0"/>',
  error: '<path class="line" d="M41 62q6.5 5 13 3 M79 62q-6.5 5-13 3"/>',
};

export function mascot(state = 'idle', { size = 96, label = '' } = {}) {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return raw(`<svg class="mascot mascot-${state}" viewBox="0 0 128 112" width="${size}" height="${Math.round(size * 112 / 128)}" ${a11y}>
    <g class="mascot-head">
      <path class="fur" d="M24 50 L31 10 L50 34 Q60 30 70 34 L89 10 L96 50 L103 64 L91 69 L95 80 L78 82 L60 101 L42 82 L25 80 L29 69 L17 64 Z"/>
      <path class="ear-inner" d="M33 21 L46 35 L35 42 Z M87 21 L74 35 L85 42 Z"/>
      <path class="marking" d="M37 53q9-8 18-4 M83 53q-9-8-18-4"/>
      <g class="eyes">${EYES[state] ?? EYES.idle}</g>
      <path class="nose" d="M56 87 Q60 85 64 87 L60 92 Z"/>
    </g>
    <g class="foxfire">
      <path class="flame" d="M112 2 C108 10 116 13 115 21 C120 18 122 26 120 31 C117 38 107 40 102 34 C98 29 100 21 105 18 C106 24 109 24 110 21 C111 15 108 9 112 2 Z"/>
      <ellipse class="flame-core" cx="110" cy="31" rx="3.6" ry="4.6"/>
    </g>
  </svg>`);
}

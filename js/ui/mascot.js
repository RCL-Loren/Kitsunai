import { raw, esc } from './dom.js';

// The kitsune spirit. States: idle | thinking | error | happy.
// Used sparingly: empty/setup states, generation indicator, errors, app icon.

const EYES = {
  idle: '<ellipse cx="47" cy="65" rx="3.2" ry="4.2"/><ellipse cx="73" cy="65" rx="3.2" ry="4.2"/>',
  thinking: '<ellipse cx="49" cy="62" rx="3" ry="4"/><ellipse cx="75" cy="62" rx="3" ry="4"/>',
  happy: '<path class="line" d="M41 67q6-7 12 0M67 67q6-7 12 0"/>',
  error: '<path class="line" d="M41 63q6 6 12 2M79 63q-6 6-12 2"/>',
};

export function mascot(state = 'idle', { size = 96, label = '' } = {}) {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return raw(`<svg class="mascot mascot-${state}" viewBox="0 0 120 120" width="${size}" height="${size}" ${a11y}>
    <g class="mascot-head">
      <path class="fur" d="M28 14 L50 42 H70 L92 14 L97 56 Q97 73 82 83 L60 101 L38 83 Q23 73 23 56 Z"/>
      <path class="ear-inner" d="M32 25 L46 42 L33 48 Z M88 25 L74 42 L87 48 Z"/>
      <path class="marking" d="M40 55 l10-4 M80 55 l-10-4"/>
      <g class="eyes">${EYES[state] ?? EYES.idle}</g>
      <path class="nose" d="M56 85 H64 L60 90 Z"/>
    </g>
    <path class="foxfire" d="M104 4 C112 14 114 24 108 32 C104 37 95 35 95 27 C95 21 100 18 104 4 Z"/>
  </svg>`);
}

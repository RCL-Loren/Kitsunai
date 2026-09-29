// Small helpers for building UI with escaped template strings.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

// Marks a string as trusted HTML (not escaped when interpolated).
export const raw = (value) => new Raw(String(value));

const format = (v) =>
  v instanceof Raw ? v.value
  : Array.isArray(v) ? v.map(format).join('')
  : v === false || v === null || v === undefined ? ''
  : esc(v);

// Tagged template: interpolations are escaped unless wrapped with raw() or
// produced by another html`` call. Arrays are joined; false/null render nothing.
export function html(strings, ...values) {
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? format(values[i]) : ''), ''));
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

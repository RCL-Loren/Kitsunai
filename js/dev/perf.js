// Dev-only profiling for the streaming budgets (plan §6). Inert unless started
// from the console: kitsunai.debug.startProfile() … kitsunai.debug.stopProfile().

let session = null;

export function recordPaint(ms) {
  session?.paints.push(ms);
}

export function startProfile() {
  stopProfile();
  const s = { paints: [], longTasks: [], slowEvents: [], frameGaps: [], t0: performance.now(), observers: [] };
  const observe = (type, options, fn) => {
    try {
      const o = new PerformanceObserver((list) => list.getEntries().forEach(fn));
      o.observe({ type, ...options });
      s.observers.push(o);
    } catch { /* entry type unsupported */ }
  };
  observe('longtask', {}, (e) => s.longTasks.push({ at: Math.round(e.startTime - s.t0), duration: Math.round(e.duration) }));
  observe('event', { durationThreshold: 16 }, (e) => s.slowEvents.push({ name: e.name, duration: e.duration, delay: e.processingStart - e.startTime }));

  let last = performance.now();
  const loop = (t) => {
    s.frameGaps.push(t - last);
    last = t;
    s.raf = requestAnimationFrame(loop);
  };
  s.raf = requestAnimationFrame(loop);
  session = s;
  return 'profiling…';
}

const pct = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const r = (n) => Math.round(n * 100) / 100;

export function stopProfile() {
  if (!session) return null;
  const s = session;
  session = null;
  cancelAnimationFrame(s.raf);
  s.observers.forEach((o) => o.disconnect());
  return {
    seconds: r((performance.now() - s.t0) / 1000),
    paints: { count: s.paints.length, p50: r(pct(s.paints, 50)), p95: r(pct(s.paints, 95)), max: r(Math.max(0, ...s.paints)) },
    frames: { count: s.frameGaps.length, p95Gap: r(pct(s.frameGaps, 95)), over25ms: s.frameGaps.filter((g) => g > 25).length },
    longTasks: s.longTasks, // [{ at: ms since start, duration }]
    // Input delay is time from the event to its handler starting (main thread busy);
    // duration also includes rendering the next frame.
    input: {
      events: s.slowEvents.length,
      maxDelay: r(Math.max(0, ...s.slowEvents.map((e) => e.delay))),
      over50msDuration: s.slowEvents.filter((e) => e.duration > 50).map((e) => `${e.name}:${Math.round(e.duration)}`).slice(0, 12),
    },
  };
}

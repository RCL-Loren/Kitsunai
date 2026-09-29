// Tiny app-wide pub/sub. Events: models:changed, model-status:changed,
// conversations:changed, settings:changed.

const bus = new EventTarget();

export function on(type, fn) {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
}

export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

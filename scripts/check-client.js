/**
 * Render smoke test for the client half.
 *
 * `node --check` only proves the bundle parses; a component that reads an
 * undeclared identifier throws on every render and React swallows it, so the
 * feature silently disappears. That is exactly how 0.4.0 shipped with a dead
 * update toast. This runs the factory and every registered slot component
 * against a stub React, so a ReferenceError fails the build instead of the UI.
 *
 * Deliberately dependency-free: no jsdom, no test runner.
 */
import { readFileSync } from 'node:fs';

const noop = () => {};
const stubWindow = {
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  location: { search: '' },
  innerWidth: 1600,
  innerHeight: 900,
};
const stubElement = () => ({
  style: {},
  dataset: {},
  setAttribute: noop,
  append: noop,
  appendChild: noop,
  addEventListener: noop,
  removeEventListener: noop,
  remove: noop,
  getContext: () => null,
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  querySelector: () => null,
  querySelectorAll: () => [],
});

let registration = null;
globalThis.window = { ...stubWindow, __ModuleLoader__: { load: (r) => (registration = r) } };
globalThis.document = {
  documentElement: { style: { setProperty: noop, removeProperty: noop }, hasAttribute: () => false },
  body: { ...stubElement(), prepend: noop },
  head: { ...stubElement(), append: noop },
  createElement: stubElement,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
};
globalThis.localStorage = stubWindow.localStorage;
globalThis.CustomEvent = class {};
globalThis.StorageEvent = class {};
if (typeof globalThis.navigator === 'undefined') globalThis.navigator = { userAgent: 'node' };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', colorScheme: 'light', opacity: '1' });
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.HTMLCanvasElement = class {};

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
new Function(code)();

if (registration === null) {
  console.error('check-client: bundle did not call __ModuleLoader__.load');
  process.exit(1);
}

const failures = [];
/** Call a component so its body runs; a throw here is a real render error. */
const probe = (name, fn, props) => {
  try {
    fn(props ?? {});
  } catch (error) {
    failures.push(`${name}: ${error.constructor.name}: ${error.message}`);
  }
};

const React = {
  createElement: (type, props, ...children) => {
    if (typeof type === 'function') probe(type.name || 'anonymous component', type, props);
    return { type, props, children };
  },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
  useEffect: noop,
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  useSyncExternalStore: (_subscribe, get) => get(),
  Fragment: Symbol('Fragment'),
};

const exports_ = registration.factory((name) => (name === 'react' ? React : {}));
for (const key of ['apply', 'inject']) {
  if (!(key in exports_)) failures.push(`missing export: ${key}`);
}

const registered = [];
const ctx = {
  effect: (fn) => {
    try {
      fn();
    } catch {}
    return noop;
  },
  on: noop,
  get: () => undefined,
  timer: { timeout: noop, interval: noop },
  slots: {
    inject: (_slot, callback) => {
      try {
        callback();
      } catch {}
      return noop;
    },
    register: (spec, component) => {
      registered.push({ slot: spec.name, id: spec.id, component });
      return noop;
    },
    registerFactory: () => noop,
  },
  locale: { bind: () => (key) => key },
  connection: { requestRejection: () => undefined },
  webServer: { register: () => noop },
};

try {
  exports_.apply(ctx);
} catch (error) {
  failures.push(`apply(): ${error.constructor.name}: ${error.message}`);
}

if (registered.length === 0) failures.push('apply() registered no slots');
for (const entry of registered) {
  if (typeof entry.component === 'function') probe(`${entry.slot}/${entry.id}`, entry.component);
}

if (failures.length > 0) {
  console.error('check-client: client render smoke test failed');
  for (const line of failures) console.error('  - ' + line);
  process.exit(1);
}
console.log(`check-client: ${registered.length} slot component(s) rendered cleanly`);

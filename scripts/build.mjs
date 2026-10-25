#!/usr/bin/env node
/**
 * Copy the source tree into `lib/`.
 *
 * The plugin ships as plain ESM with no third-party imports, so "building" is a
 * copy plus a syntax check. Keeping it a real step means the published package
 * never depends on a `prepare` script running on the user's machine.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const from = join(root, 'src');
const to = join(root, 'lib');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });

/**
 * Fail the build on an obviously broken artifact rather than at install time.
 * Host files are ESM; the browser half registers itself with the module loader
 * instead of exporting, so it is checked for that registration.
 */
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.js')) {
      const source = readFileSync(path, 'utf8');
      const isBrowserModule = entry.name === 'client.js';
      const ok = isBrowserModule
        ? source.includes('__ModuleLoader__.load')
        : /export\s/.test(source);
      if (!ok) throw new Error(`${path} has no ${isBrowserModule ? 'module registration' : 'exports'}`);
    }
  }
};
walk(to);
console.log('built lib/ from src/');

// A bundle that parses can still throw on every render (an undeclared local
// reads as a ReferenceError that React swallows), so the smoke test runs as
// part of the build rather than as an optional extra.
await import('./check-client.js');

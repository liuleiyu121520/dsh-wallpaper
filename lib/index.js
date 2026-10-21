/**
 * Host half of the live wallpaper background plugin.
 *
 * Periodically captures the current desktop picture, then serves the newest
 * frame to the Web GUI behind a same-origin route. Capture itself lives in a
 * per-platform backend (`src/backends/`), so macOS, Windows and Linux differ
 * only in how the picture is read.
 *
 * Frames carry a content revision: an unchanged capture keeps its previous
 * revision, so the browser never repaints identical bytes.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendFor } from './capture.js';

const NAME = 'dsh-wallpaper';
const ROUTE_PREFIX = '/api/dsh-wallpaper/';
/** Longest edge of the frame served to the browser. */
const RESIZE_EDGE = 1600;
/** Perceptual change threshold, in mean absolute 8-bit channel difference. */
const CHANGED_THRESHOLD = 1.5;
/** Package root (this module ships in `lib/`), for reading the installed manifest at runtime. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Where a newer release is published; empty disables remote checking. */
const UPDATE_ENDPOINT = 'https://api.github.com/repos/liuleiyu121520/dsh-wallpaper/releases/latest';
/** Repository the in-place upgrade installs from. */
const UPDATE_REPOSITORY = 'github:liuleiyu121520/dsh-wallpaper';

/** Installed version, read from this package's own manifest. */
function installedVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Compare dotted numeric versions; true when `remote` is newer than `local`. */
function isNewer(remote, local) {
  const parse = (value) =>
    String(value ?? '')
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(remote);
  const right = parse(local);
  for (let index = 0; index < Math.max(left.length, right.length, 3); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

export const inject = ['webServer', 'timer', 'connection'];

export async function apply(ctx, config) {
  const numberIn = (value, fallback, min, max) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

  const intervalMs = numberIn(config?.intervalMs, 6000, 500, 600000);
  /** Look values: picture opacity, blur radius, scrim strength, saturation, panel opacity. */
  const look = {
    opacity: numberIn(config?.opacity, 1, 0.02, 1),
    blurPx: numberIn(config?.blurPx, 0, 0, 80),
    scrim: numberIn(config?.scrim, 0.35, 0, 1),
    saturate: numberIn(config?.saturate, 1, 0.2, 3),
    surface: numberIn(config?.surface, 0.5, 0.2, 1),
  };

  const backend = await backendFor(process.platform);
  const workDir = mkdtempSync(join(tmpdir(), 'dsh-wallpaper-frame-'));
  const framePath = join(workDir, 'frame.jpg');
  const probePath = join(workDir, 'probe.bmp');
  const token = randomUUID();

  /** Last published frame bytes. */
  let frameBytes = null;
  /** 32x32 grayscale probe of the last published frame. */
  let frameProbe = null;
  /** Monotonic revision the browser keys repaints on. */
  let revision = 0;
  /** Last capture failure reason, surfaced in the status payload. */
  let lastError = null;

  /**
   * Capture one frame and bump the revision when the picture visibly changed.
   * Aerial video and slideshows never repeat identical JPEG bytes, so change is
   * judged on a downsampled grayscale probe rather than on file equality.
   * @returns true when a new revision was published.
   */
  const capture = () => {
    if (backend === null) {
      lastError = `unsupported platform: ${process.platform}`;
      return false;
    }
    const raw = join(workDir, 'raw.png');
    try {
      if (!backend.captureRaw(raw)) {
        lastError = 'capture failed';
        return false;
      }
      if (!backend.toFrameJpeg(raw, framePath, RESIZE_EDGE)) {
        lastError = 'transcode failed';
        return false;
      }
      if (!backend.toProbe(raw, probePath)) {
        lastError = 'probe failed';
        return false;
      }
    } finally {
      try {
        rmSync(raw, { force: true });
      } catch {}
    }

    let next;
    let nextProbe;
    try {
      next = readFileSync(framePath);
      nextProbe = readFileSync(probePath).subarray(backend.PROBE_HEADER_BYTES);
    } catch {
      lastError = 'read failed';
      return false;
    }
    lastError = null;

    if (frameProbe !== null && nextProbe.length === frameProbe.length) {
      let total = 0;
      for (let index = 0; index < nextProbe.length; index += 1) {
        total += Math.abs(nextProbe[index] - frameProbe[index]);
      }
      if (total / nextProbe.length < CHANGED_THRESHOLD) return false;
    }

    frameBytes = next;
    frameProbe = nextProbe;
    revision += 1;
    return true;
  };

  ctx.effect(() => ctx.timer.interval(capture, intervalMs), `${NAME}: capture interval`);

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-wallpaper/discover',
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection(req);
          if (rejection !== undefined) {
            res.statusCode = rejection;
            res.end();
            return;
          }
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('allow', 'GET');
            res.end();
            return;
          }
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              frame: `${ROUTE_PREFIX}${token}/frame.jpg`,
              rev: `${revision}-${frameBytes === null ? 0 : frameBytes.length}`,
              refreshMs: Math.max(500, Math.min(intervalMs, 5000)),
              platform: process.platform,
              backend: backend?.backendName ?? null,
              error: lastError,
              ...look,
            }),
          );
        },
      }),
    `${NAME}: GET ${ROUTE_PREFIX}discover`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}${token}/frame.jpg`,
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection(req);
          if (rejection !== undefined) {
            res.statusCode = rejection;
            res.end();
            return;
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405;
            res.setHeader('allow', 'GET, HEAD');
            res.end();
            return;
          }
          const bytes = frameBytes;
          if (bytes === null) {
            res.statusCode = 503;
            res.end();
            return;
          }
          res.setHeader('content-type', 'image/jpeg');
          res.setHeader('cache-control', 'no-store');
          res.setHeader('etag', `"${revision}"`);
          if (req.headers['if-none-match'] === `"${revision}"`) {
            res.statusCode = 304;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-length', String(bytes.length));
          res.end(req.method === 'HEAD' ? undefined : bytes);
        },
      }),
    `${NAME}: GET ${ROUTE_PREFIX}<token>/frame.jpg`,
  );

  // ── update status ─────────────────────────────────────────────────────────
  let updateState = { checkedAt: null, latest: null, error: null, url: null };
  /** Version the user dismissed; the reminder stays quiet until a newer one ships. */
  let dismissedVersion = null;
  /** Set while a check is in flight, so the background timer cannot stack requests. */
  let checking = false;

  const fetchLatestRelease = async () => {
    if (UPDATE_ENDPOINT === '') return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(UPDATE_ENDPOINT, {
        headers: { accept: 'application/vnd.github+json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = await response.json();
      const tag = typeof body?.tag_name === 'string' ? body.tag_name : '';
      const url = typeof body?.html_url === 'string' ? body.html_url : null;
      return tag === '' ? null : { latest: tag.replace(/^v/i, ''), url };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  /** Run one remote check and fold the result into the shared status. */
  const runUpdateCheck = async () => {
    if (checking) return updateState;
    checking = true;
    try {
      const found = await fetchLatestRelease();
      updateState = {
        checkedAt: new Date().toISOString(),
        latest: found?.latest ?? null,
        url: found?.url ?? null,
        error: found === null ? 'unreachable' : null,
      };
      return updateState;
    } finally {
      checking = false;
    }
  };

  /** The status payload every client surface reads. */
  const updatePayload = () => {
    const current = installedVersion();
    const latest = updateState.latest;
    return {
      version: current,
      latest,
      updateAvailable: latest !== null && isNewer(latest, current),
      checkedAt: updateState.checkedAt,
      url: updateState.url,
      error: updateState.error,
      dismissed: latest !== null && dismissedVersion === latest,
    };
  };

  // Check once shortly after activation, then every six hours. A failed check
  // leaves `latest` null, so an offline machine never shows a stale reminder.
  const startUpdateTimer = () => {
    ctx.timer.timeout(() => {
      void runUpdateCheck();
    }, 15000);
    return ctx.timer.interval(() => {
      void runUpdateCheck();
    }, 6 * 60 * 60 * 1000);
  };
  ctx.effect(startUpdateTimer, `${NAME}: release check timer`);

  /** One upgrade at a time; the UI polls this while it runs. */
  let upgradeState = { running: false, startedAt: null, finishedAt: null, result: null, error: null };

  /**
   * Install the newest published version in place.
   *
   * Goes through `pluginManager.installBundle`, the same pnpm path `dsh plugin`
   * uses, so the profile's `package.json` and lockfile stay consistent and the
   * Manager applies its own reload lifecycle. A live profile reports
   * `application: 'applied'` and the new bundle swaps in without a restart;
   * otherwise the caller surfaces `restart-required`.
   */
  const runUpgrade = async () => {
    if (upgradeState.running) return upgradeState;
    const manager = ctx.get('pluginManager');
    if (manager === undefined || typeof manager.installBundle !== 'function') {
      upgradeState = {
        running: false,
        startedAt: upgradeState.startedAt,
        finishedAt: new Date().toISOString(),
        result: null,
        error: 'plugin-manager-unavailable',
      };
      return upgradeState;
    }
    const snapshot = await runUpdateCheck();
    if (snapshot.latest === null) {
      upgradeState = {
        running: false,
        startedAt: upgradeState.startedAt,
        finishedAt: new Date().toISOString(),
        result: null,
        error: 'unreachable',
      };
      return upgradeState;
    }
    upgradeState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, result: null, error: null };
    try {
      // Pin the exact tag so a moving branch cannot swap in something else
      // between the check and the install.
      const spec = `${UPDATE_REPOSITORY}#v${snapshot.latest}`;
      const outcome = await manager.installBundle(spec, { enabled: true });
      upgradeState = {
        running: false,
        startedAt: upgradeState.startedAt,
        finishedAt: new Date().toISOString(),
        result: {
          changed: outcome?.changed === true,
          application: outcome?.application ?? 'failed',
          version: outcome?.version ?? null,
          restartReason: outcome?.restartReason ?? null,
          error: outcome?.error?.code ?? null,
        },
        error: null,
      };
      // A successful install makes the reminder moot; clear the shared status.
      await runUpdateCheck();
      dismissedVersion = null;
    } catch (error) {
      upgradeState = {
        running: false,
        startedAt: upgradeState.startedAt,
        finishedAt: new Date().toISOString(),
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return upgradeState;
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-wallpaper/upgrade',
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection(req);
          if (rejection !== undefined) {
            res.statusCode = rejection;
            res.end();
            return;
          }
          if (req.method !== 'GET' && req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'GET, POST');
            res.end();
            return;
          }
          // GET reports progress; POST starts the install and resolves when it settles.
          const state = req.method === 'POST' ? await runUpgrade() : upgradeState;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.statusCode = 200;
          res.end(JSON.stringify({ ...state, installed: installedVersion(), update: updatePayload() }));
        },
      }),
    `${NAME}: /api/dsh-wallpaper/upgrade`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-wallpaper/update',
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection(req);
          if (rejection !== undefined) {
            res.statusCode = rejection;
            res.end();
            return;
          }
          if (req.method !== 'GET' && req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'GET, POST');
            res.end();
            return;
          }
          if (req.method === 'POST') {
            // A dismiss from the reminder overlay silences this one version only.
            const snapshot = await runUpdateCheck();
            if (snapshot.latest !== null && isNewer(snapshot.latest, installedVersion())) {
              dismissedVersion = snapshot.latest;
            }
          }
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.statusCode = 200;
          res.end(JSON.stringify(updatePayload()));
        },
      }),
    `${NAME}: /api/dsh-wallpaper/update`,
  );

  // A second route so the settings button keeps re-checking while the overlay
  // only ever acknowledges: reusing the GET for both would fight the cache.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-wallpaper/update/check',
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection(req);
          if (rejection !== undefined) {
            res.statusCode = rejection;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'POST');
            res.end();
            return;
          }
          await runUpdateCheck();
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.statusCode = 200;
          res.end(JSON.stringify(updatePayload()));
        },
      }),
    `${NAME}: /api/dsh-wallpaper/update/check`,
  );

  // Capture once at activation so the first page load has a picture.
  capture();

  return async () => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
  };
}

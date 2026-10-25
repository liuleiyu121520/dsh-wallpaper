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
 *
 * The same half also owns the weather pipeline (`src/weather.js`): the browser
 * only ever sees a normalized kind enum, and while the weather background is
 * active the frame capture is paused — the picture would never be shown.
 *
 * 注：本文件新增区块的注释使用简体中文，与 docs/ 及团队约定一致；既有注释保持原样。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendFor } from './capture.js';
import { createWeatherService } from './weather.js';

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
/** Mode card artwork, served read-only from `PACKAGE_DIR/assets/`. */
const CARD_ASSETS = ['card-system.jpg', 'card-weather-wallpaper.jpg'];
/** 效果预览 icon（AI 生成、白底已抠透明），同样只读下发。 */
const PREVIEW_ASSETS = [
  'preview/evolve.png',
  'preview/auto.png',
  'preview/clear.png',
  'preview/cloudy.png',
  'preview/drizzle.png',
  'preview/rain.png',
  'preview/heavyRain.png',
  'preview/wind.png',
  'preview/snow.png',
  'preview/fog.png',
  'preview/haze.png',
  'preview/thunderstorm.png',
  'preview/hail.png',
  'preview/dust.png',
];

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
  /** 经 discover 下发给浏览器的默认背景模式。 */
  const configMode = config?.mode === 'weather' ? 'weather' : 'system';
  /** 天气刷新周期；PRD 定为 1h，下限 10 分钟，上限 24h 防止误配成永久。 */
  const weatherIntervalMs = numberIn(config?.weatherIntervalMs, 3600000, 600000, 86400000);
  const fixedCoord = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const weather = createWeatherService({
    fixedLat: fixedCoord(config?.weatherLat),
    fixedLon: fixedCoord(config?.weatherLon),
  });
  /**
   * 浏览器最近上报的运行模式。只存 Host 内存：插件重载后复位为 'system'，
   * 由客户端 start 时重报恢复（降级矩阵第 10 条）。
   */
  let clientMode = 'system';

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
    // 天气背景下双图层整体隐藏，此时抓帧只会白白烧 CPU——没有人会取这些字节。
    // 守卫放在 capture 内而不是定时器回调里：capture 还有激活时首帧与切回
    // system 的补帧两个调用点，统一在函数入口拦截才对每个调用点都诚实。
    if (clientMode === 'weather') return false;
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

  /**
   * 读取 JSON 请求体，不假设宿主已经解析过。
   *
   * 宿主可能直接给到已解析的 `req.body`；给不到时回退到读流，并加 2s 上限与
   * 4KB 容量封顶——防止只发了请求头的客户端把处理器挂在永不结束的请求上。
   * @returns 解析后的对象；缺失、非法或超限时返回 null。
   */
  const readBodyText = async (req) => {
    if (req.body !== undefined && req.body !== null) {
      return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    if (typeof req.on !== 'function') return null;
    return await new Promise((done) => {
      let settled = false;
      let size = 0;
      const chunks = [];
      const timer = setTimeout(() => finish(null), 2000);
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
        done(value);
      };
      const onData = (chunk) => {
        size += chunk.length;
        if (size > 4096) {
          finish(null);
          return;
        }
        chunks.push(chunk);
      };
      const onEnd = () => finish(Buffer.concat(chunks.map((chunk) => (typeof chunk === 'string' ? Buffer.from(chunk) : chunk))).toString('utf8'));
      const onError = () => finish(null);
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
    });
  };

  const readJsonBody = async (req) => {
    const raw = await readBodyText(req);
    if (raw === null || raw === '') return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  /** 连接层已决定拒绝时尽早返回，与其余路由一致。 */
  const guard = (req, res) => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection !== undefined) {
      res.statusCode = rejection;
      res.end();
      return false;
    }
    return true;
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-wallpaper/discover',
        handler: async (req, res) => {
          if (!guard(req, res)) return;
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
              // 天气模式接管画面时为 null：浏览器随即停止拉取帧，抓帧定时器空转。
              frame: clientMode === 'weather' ? null : `${ROUTE_PREFIX}${token}/frame.jpg`,
              rev: `${revision}-${frameBytes === null ? 0 : frameBytes.length}`,
              refreshMs: Math.max(500, Math.min(intervalMs, 5000)),
              platform: process.platform,
              backend: backend?.backendName ?? null,
              error: lastError,
              mode: configMode,
              weather: weather.payload(),
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
          if (!guard(req, res)) return;
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

  // ── weather mode ─────────────────────────────────────────────────────────
  // 激活后约 15s 完成第一次天气获取，随后按配置周期刷新。仿 startUpdateTimer：
  // 一次 timeout 打底，再加一个普通 interval。
  ctx.effect(
    () => {
      ctx.timer.timeout(() => {
        void weather.refresh();
      }, 15000);
      return ctx.timer.interval(() => {
        void weather.refresh();
      }, weatherIntervalMs);
    },
    `${NAME}: weather refresh timer`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-wallpaper/mode',
        handler: async (req, res) => {
          if (!guard(req, res)) return;
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'POST');
            res.end();
            return;
          }
          const body = await readJsonBody(req);
          const next = body?.mode;
          if (next !== 'system' && next !== 'weather') {
            res.statusCode = 400;
            res.end();
            return;
          }
          const previous = clientMode;
          clientMode = next;
          // 从天气模式切回时必须立即补帧：天气期间 capture 被守卫跳过，不补帧
          // 的话浏览器会一直拿着切走前那张旧帧，用户回来看到「壁纸没更新」。
          if (previous === 'weather' && next === 'system') capture();
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.statusCode = 200;
          res.end(JSON.stringify({ mode: clientMode }));
        },
      }),
    `${NAME}: POST ${ROUTE_PREFIX}mode`,
  );

  // 卡片配图与预览 icon：每个白名单名注册一条 exact 路由。按名注册而非路径参数，
  // 从构造上杜绝路径穿越——没有注册的路由就不存在可拼接的路径，读盘之前已经 404。
  for (const name of [...CARD_ASSETS, ...PREVIEW_ASSETS]) {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}assets/${name}`,
          handler: async (req, res) => {
            if (!guard(req, res)) return;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.statusCode = 405;
              res.setHeader('allow', 'GET, HEAD');
              res.end();
              return;
            }
            let bytes = null;
            try {
              bytes = readFileSync(join(PACKAGE_DIR, 'assets', name));
            } catch {
              // 文件缺失是配图落盘前的正常状态；客户端有渐变兜底，安静回 404。
              bytes = null;
            }
            if (bytes === null) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.setHeader('content-type', name.endsWith('.png') ? 'image/png' : 'image/jpeg');
            res.setHeader('cache-control', 'no-store');
            res.statusCode = 200;
            res.setHeader('content-length', String(bytes.length));
            res.end(req.method === 'HEAD' ? undefined : bytes);
          },
        }),
      `${NAME}: GET ${ROUTE_PREFIX}assets/${name}`,
    );
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-wallpaper/weather/refresh',
        handler: async (req, res) => {
          if (!guard(req, res)) return;
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'POST');
            res.end();
            return;
          }
          // 手动刷新不重置 1h 定时器：自动节奏与按需刷新互不干扰，service 内部
          // 的 fetching 守卫会让撞上周期中的调用直接返回当前载荷。
          const snapshot = await weather.refresh();
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.statusCode = 200;
          res.end(JSON.stringify({ weather: snapshot }));
        },
      }),
    `${NAME}: POST ${ROUTE_PREFIX}weather/refresh`,
  );

  // ── update status ────────────────────────────────────────────────────────
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
          if (!guard(req, res)) return;
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
          if (!guard(req, res)) return;
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
          if (!guard(req, res)) return;
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

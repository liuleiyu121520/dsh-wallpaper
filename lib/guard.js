/**
 * 请求准入守卫：`/api/dsh-wallpaper/*` 路由的第一道闸（index.js 的 `guard()`）。
 *
 * 为什么需要这个模块（0.4.7 修复的根因）：dsh 0.2.2-rc.3 的 connection 服务
 * **移除了 `requestRejection(req)`**，换成 `admit(request)` ——返回值从裸状态
 * 码变成 `{rejection: number}` 信封（rpc-host.ts：来源不可信 403、服务已
 * disposed 401、authenticate 的结论 401/503、放行无字段）。旧守卫直接调旧
 * 方法且在 try-catch 之外——每个请求都抛 `TypeError`，宿主 webserver 兜底
 * 转成 HTTP 400 空 body，前端 `response.json()` 解析失败，壁纸设置面板整块
 * 报「服务端返回了无法解析的响应」。
 *
 * 本模块移植 dsh-mcpserver-manager/src/guard.js（0.4.6 已验证、已发布）的
 * 兼容逻辑，后者源自 dsh-our-free-model/src/trust.js 处理 issue #89 同款
 * API 更名的实现。三条承诺：
 *
 * 1. **双 API 适配**：`admit`（新）优先，`requestRejection`（旧）兜底；
 * 2. **任何路径都不抛异常**：connection 服务缺席、方法缺失、方法抛错、
 *    `ctx.connection` 本身读不出来（cordis Proxy 形状再变），一律视为
 *    「无决策」——守卫绝不能自己成为故障源；
 * 3. **匿名路由语义**：本插件路由全部声明 `auth: 'anonymous'`，宿主对匿名路由
 *    在「无人作出准入决策」时本就只保留来源检查。因此 connection 回 503
 *    （含 provider 抛错）视为「无决策」而不是硬拒——硬拒等于给匿名路由强加
 *    required 语义，把壁纸面板全部打成 admission unavailable——落回结构性来源
 *    围栏；401/403 这类明确拒绝仍然硬拒。
 *
 * 决策表（输入情形 → 输出）：
 *
 * | 输入情形                                              | 输出                |
 * | ----------------------------------------------------- | ------------------- |
 * | admit / requestRejection 给出 401/403 等明确拒绝       | 原状态码硬拒        |
 * | 给出 503（admission unavailable）                      | 无决策 → 结构性围栏 |
 * | 给出 undefined / 信封无 rejection 字段                 | 放行                |
 * | 服务缺席 / 方法缺失 / 方法抛错 / ctx 读取抛错          | 无决策 → 结构性围栏 |
 * | 结构性围栏通过（回环 Host、无跨站、来源 authority 一致）| 放行                |
 * | 结构性围栏不过                                         | 403 硬拒            |
 *
 * @module src/guard.js
 */

/** Hostnames a same-machine caller can legitimately use. */
const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost']);

/**
 * 判断一个地址是否是「同机调用者」可用的回环地址。
 *
 * 结构性围栏的判定基础：路由前缀比宿主的 `/api` 长，webServer 最长前缀优先
 * dispatch，本插件的路由会**先于**宿主自己的准入检查执行——没有这道围栏，
 * 任何能连上端口的人都能拿到屏幕画面与改写壁纸配置。
 *
 * @param {unknown} value Host/绑定地址。
 * @returns {boolean} 是否回环。
 */
export function isLoopbackHost(value) {
  const raw = String(value ?? '').trim();
  // URL 的 authority 解析要求 IPv6 字面量带方括号，但裸 `::1` 也是合法拼写
  // （监听器与 URL 格式化器都会产出它），在进 URL 之前单独认掉。
  if (raw === '::1') return true;
  const authority = authorityOf(raw, 'http');
  return authority !== null && LOOPBACK_NAMES.has(authority.hostname);
}

/**
 * 把一次宿主咨询的返回值翻成状态码。
 *
 * 新 API 是 `{rejection}` 信封、旧 API 是裸数字；其余形状（undefined、null、
 * 字符串、无 rejection 字段的对象）都不是合同内的拒绝信号，按「无决策」处理
 * ——宁可交给结构性围栏补判，也不把形状异常放大成 5xx。
 *
 * @param {unknown} admission `admit(req)` / `requestRejection(req)` 的返回值。
 * @returns {number|undefined} 拒绝状态码；undefined 表示没有可执行的拒绝。
 */
function statusOf(admission) {
  const value = typeof admission === 'number' ? admission : (admission !== null && typeof admission === 'object' ? admission.rejection : undefined);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 读取 ctx 上的 connection 服务。**每个请求现取**：cordis 服务可以晚于本插件
 * provide，注册时取一次存下来就会永久过期；读取本身也可能抛错（cordis 的服务
 * Proxy 在服务缺席时可能直接抛）——守卫不能比业务代码先倒下，抛了就当没有
 * 这个服务。
 *
 * @param {unknown} ctx cordis 上下文（或任何将来形状的 ctx）。
 * @returns {object|undefined} connection 服务；取不到为 undefined。
 */
function readConnection(ctx) {
  try {
    const connection = ctx !== null && typeof ctx === 'object' ? ctx.connection : undefined;
    return connection !== null && typeof connection === 'object' ? connection : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 对一个请求作出准入决策。返回应拒绝的 HTTP 状态码，undefined 表示放行。
 *
 * 咨询到宿主自己的 admission 服务（`admit` 存在）且它明确放行（无 rejection
 * 字段）时直接放行、不再重复结构性检查——宿主在 `admit` 里已经跑过它自己的
 * 来源检查，它的答案最权威；只有「无决策」（服务缺席/抛错/503）才落到下面的
 * 结构性围栏。
 *
 * @param {object} ctx cordis 上下文（`ctx.connection` 每请求现取，读不到不抛）。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {(decision: {status: number, source: string, reason: string}) => void} [onRejection]
 *   硬拒时的诊断回调。参数是**固定字段**（status/source/reason），永不携带请求头
 *   或调用方可控字符串——日志纪律（不回显输入）在守卫层就开始执行。
 * @returns {number|undefined} 拒绝状态码；undefined 表示放行。
 */
export function rejectionFor(ctx, req, onRejection) {
  const connection = readConnection(ctx);
  /** @type {{status: number, source: string, reason: string}|undefined} */
  let decision;
  try {
    // dsh 0.2.2-rc.3 起 publish 的是 `admit`；更早的宿主只有 `requestRejection`
    //（同一个决策的两个名字）。整个咨询包在 try 里：方法抛错 = 无决策。
    const admit = connection?.admit;
    if (typeof admit === 'function') {
      const status = statusOf(admit.call(connection, req));
      if (status === undefined) return undefined;
      decision = status === 503 ? undefined : { status, source: 'connection', reason: 'host-rejected' };
    } else {
      const reject = connection?.requestRejection;
      if (typeof reject === 'function') {
        const status = statusOf(reject.call(connection, req));
        if (status === undefined) return undefined;
        decision = status === 503 ? undefined : { status, source: 'connection', reason: 'host-rejected' };
      }
    }
  } catch {
    // 挂载了的宿主服务自己抛错，构不成准入决策；对本插件声明的匿名路由，这
    // 意味着「无决策」而不是「拒绝」——下面的结构性围栏仍然会做来源检查。
    decision = undefined;
  }
  if (decision === undefined) {
    const reason = structuralReason(req);
    if (reason === undefined) return undefined;
    decision = { status: 403, source: 'structural', reason };
  }
  try {
    if (typeof onRejection === 'function') onRejection({ ...decision });
  } catch {
    // 诊断是观测性的：logger 抛错不能改变 HTTP 决策。
  }
  return decision.status;
}

/**
 * 结构性围栏（只看请求本身，不咨询任何服务）。复刻宿主 `isTrustedApiRequest`
 * 的判定：Host 必须回环（DNS rebinding 防御）、拒绝跨站 fetch、Origin/Referer
 * 存在时 authority 必须与 Host 一致。
 *
 * 导出给测试用：测试打真实实现，而不是一个会漂移的复制品。
 *
 * @param {object} req 请求。
 * @returns {number|undefined} 403 或 undefined（放行）。
 */
export function structuralRejection(req) {
  return structuralReason(req) === undefined ? undefined : 403;
}

/**
 * 结构性围栏的判定，返回**固定的**原因码（不回显任何调用方字符串）。
 *
 * @param {object} req 请求。
 * @returns {string|undefined} 原因码；undefined 表示通过。
 */
function structuralReason(req) {
  const host = authorityOf(req.headers?.host, 'http');
  if (host === null || !LOOPBACK_NAMES.has(host.hostname)) return 'host-not-loopback';
  const site = String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase();
  if (site === 'cross-site') return 'cross-site';
  for (const header of ['origin', 'referer']) {
    const raw = req.headers?.[header];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    if (header === 'referer' && isDesktopRelayReferer(raw)) {
      // 桌面端 forwardWebRequest 把浏览器的来源标记剥掉后才转发到本机回环，
      // 但保留了这条 Referer。它不是 Origin 授权，也永不推翻宿主服务的准入
      // 决策；反而，若它与浏览器标记（Origin / sec-fetch-site）同时出现，
      // 说明这不是转发请求——是有人拿着这个特例当通行证。
      if (req.headers?.origin !== undefined || req.headers?.['sec-fetch-site'] !== undefined) {
        return 'desktop-relay-markers';
      }
      continue;
    }
    const authority = authorityOf(raw.trim());
    if (authority === null) return `${header}-invalid`;
    // webServer 在回环绑定上说的是纯 http，Origin 自称 https——或任何其它
    // scheme——都不是本页面。
    if (authority.scheme !== host.scheme || authority.hostname !== host.hostname || authority.port !== host.port) {
      return `${header}-mismatch`;
    }
  }
  return undefined;
}

/**
 * desktop-relay Referer 特例：只认本应用自己的页面，不认任意自定义协议页。
 *
 * @param {string} value Referer 原文。
 * @returns {boolean} 是否为 `dsh-app://app` 转发请求的 Referer。
 */
function isDesktopRelayReferer(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.port === ''
      && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/**
 * 把 Host / Origin / Referer 的值拆成 {scheme, hostname, port}，端口缺省补全
 * （http:80 / https:443）——否则 `http://127.0.0.1` 与 `http://127.0.0.1:80`
 * 会被误判成不同来源。
 *
 * @param {unknown} value 头字段原文。
 * @param {string} [defaultScheme] 无 scheme 时的缺省（Host 头用 'http'）。
 * @returns {{scheme: string, hostname: string, port: string}|null} authority；解析失败为 null。
 */
function authorityOf(value, defaultScheme) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let url;
  try {
    url = new URL(value.includes('://') ? value.trim() : `${defaultScheme ?? 'http'}://${value.trim()}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
  return { scheme: url.protocol.replace(':', ''), hostname: url.hostname.toLowerCase(), port };
}

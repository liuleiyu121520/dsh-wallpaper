/**
 * Host 半区的天气服务。
 *
 * 为什么整条天气链路必须落在 Node 侧：ipwho.is / ip-api.com / Open-Meteo 由
 * 浏览器直连会撞 CORS 或混合内容（ip-api.com 免费端点仅 HTTP），Node 的 fetch
 * 没有这些限制；更重要的是「1h 缓存 + 8s 超时 + 静默降级」需要在唯一一处收敛，
 * 客户端只认归一化后的 kind 枚举，不感知 WMO 码与阈值——否则两端规则漂移，
 * 会出现「Host 说暴雨、客户端画晴」。
 *
 * 运行时只依赖 Node 18+ 的全局 fetch / AbortController（与既有 update 检查一致）。
 *
 * 对外只有两个成员：
 *   payload()  → 当前载荷（discover 原样下发，同步、无副作用）
 *   refresh()  → 执行一次「定位 + 预报 + 空气质量」周期，返回最新载荷
 */

/** kind 枚举的唯一事实来源（顺序即设计文档 §3.1 文档序；客户端 KIND_PRESETS 必须一一对应）。 */
export const WEATHER_KINDS = [
  'clear',
  'cloudy',
  'drizzle',
  'rain',
  'heavyRain',
  'wind',
  'snow',
  'fog',
  'haze',
  'thunderstorm',
  'hail',
  'dust',
];

const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEO_PRIMARY_ENDPOINT = 'https://ipwho.is/';
const GEO_FALLBACK_ENDPOINT = 'http://ip-api.com/json';
/** 单个外部请求的超时：定位与天气都按 8s 封顶，避免拖住后续周期。 */
const REQUEST_TIMEOUT_MS = 8000;
/** 预报失败时沿用上次成功数据的窗口；超过则回落到默认多云。 */
const STALE_WINDOW_MS = 6 * 60 * 60 * 1000;
/** 定位彻底失败时的默认坐标（北京）。 */
const DEFAULT_COORDS = { lat: 39.9042, lon: 116.4074 };

/** 有限数字或 null；阈值比较遇 null 一律视为不命中。 */
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** 非空字符串或 null。 */
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const above = (value, limit) => value !== null && value > limit;

const atLeast = (value, limit) => value !== null && value >= limit;

const oneOf = (code, list) => code !== null && list.includes(code);

/** 本地 6–18 时视为白天，仅用于首次成功前的初始 isDay。 */
const localIsDay = () => {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18;
};

/** 带超时的 JSON GET；任何失败都归拢成 null，由调用方决定降级路径。 */
const fetchJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const forecastUrl = ({ lat, lon }) =>
  `${FORECAST_ENDPOINT}?latitude=${lat}&longitude=${lon}` +
  '&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,relative_humidity_2m,is_day' +
  // 日出日落给客户端的太阳模型定位：一天的光线方向/色温全靠这两个锚点插值。
  '&daily=sunrise,sunset&forecast_days=1' +
  '&timezone=auto';

const airQualityUrl = ({ lat, lon }) =>
  `${AIR_QUALITY_ENDPOINT}?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10&timezone=auto`;

/**
 * 把一次观测归一化成 12 值 kind 枚举。
 *
 * 顺序即优先级，实现不得重排：前 7 行按 WMO 码直接定性；8–10 行兜住「晴但有
 * 阵雨」与纯降水读数；11–12 行只在无降水命中后才看空气质量；13 行把 45/48 落成
 * 雾（AQ 失败致 pm2p5 = null 时同样走这里，即「失败降级为雾」）；14 行狂风只在
 * 无降水之后生效，天然满足 PRD「无强降水时」；未知码与全 null 落 cloudy，与
 * PRD「多云为默认降级效果」一致。
 *
 * @param sample { weatherCode, temperature, windSpeed, windGusts, precipitation, pm2p5, pm10 }
 *   weatherCode 须为整数，其余字段允许 null。
 * @returns WEATHER_KINDS 中的一员。
 */
export function normalizeWeatherKind(sample) {
  const code = Number.isInteger(sample?.weatherCode) ? sample.weatherCode : null;
  const temperature = finite(sample?.temperature);
  const windSpeed = finite(sample?.windSpeed);
  const windGusts = finite(sample?.windGusts);
  const precipitation = finite(sample?.precipitation);
  const pm2p5 = finite(sample?.pm2p5);
  const pm10 = finite(sample?.pm10);

  if (code === 95) return 'thunderstorm';
  if (oneOf(code, [96, 99]) && ((temperature !== null && temperature < 2) || above(precipitation, 10))) return 'hail';
  if (oneOf(code, [96, 99])) return 'thunderstorm';
  if (oneOf(code, [71, 73, 75, 77, 85, 86])) return 'snow';
  if (oneOf(code, [65, 82])) return 'heavyRain';
  if (oneOf(code, [63, 80, 81, 66, 67])) return 'rain';
  if (oneOf(code, [51, 53, 55, 56, 57, 61])) return 'drizzle';
  if (above(precipitation, 10)) return 'heavyRain';
  if (atLeast(precipitation, 2.5)) return 'rain';
  if (above(precipitation, 0)) return 'drizzle';
  if (atLeast(pm10, 200) && atLeast(windSpeed, 30)) return 'dust';
  if (atLeast(pm2p5, 150)) return 'haze';
  if (oneOf(code, [45, 48])) return 'fog';
  if (atLeast(windSpeed, 50) || atLeast(windGusts, 75)) return 'wind';
  if (code === 0) return 'clear';
  return 'cloudy';
}

/** 从定位响应里取坐标；缺一半视为失败，交由下一个定位源。 */
const pickGeo = (body, latKey, lonKey) => {
  const lat = finite(body?.[latKey]);
  const lon = finite(body?.[lonKey]);
  if (lat === null || lon === null) return null;
  return { lat, lon, city: text(body?.city) };
};

/**
 * 创建天气服务实例。
 *
 * @param options.fixedLat 可选固定纬度（config `weatherLat`），定位失败时兜底。
 * @param options.fixedLon 可选固定经度（config `weatherLon`），定位失败时兜底。
 * @returns {{ payload: () => object, refresh: () => Promise<object> }}
 */
export function createWeatherService({ fixedLat = null, fixedLon = null } = {}) {
  /** 最近一次成功样本，供预报失败时的 6h 陈旧沿用。 */
  let lastSample = null;
  let lastSuccessAt = 0;
  /** 定位缓存：只有定位成功才写；失败不缓存，下周期重试。 */
  let geo = null;
  /** 周期进行中标记，防止定时器与手动刷新叠加请求。 */
  let fetching = false;
  /** 当前下发载荷；首次成功前是 cloudy + pending 占位。 */
  let sample = {
    kind: 'cloudy',
    temperature: null,
    city: null,
    isDay: localIsDay(),
    updatedAt: null,
    error: 'pending',
    geoFallback: false,
    sunrise: null,
    sunset: null,
    utcOffset: null,
  };

  const resolveGeo = async () => {
    if (geo !== null) return { location: geo, degraded: false };
    // ipwho.is（HTTPS 无 key）为主，ip-api.com（HTTP，仅 Host 可达）为备。
    const found =
      pickGeo(await fetchJson(GEO_PRIMARY_ENDPOINT), 'latitude', 'longitude') ??
      pickGeo(await fetchJson(GEO_FALLBACK_ENDPOINT), 'lat', 'lon');
    if (found !== null) {
      geo = found;
      return { location: geo, degraded: false };
    }
    // 两个定位服务都不可用：先用 config 固定坐标，再退化默认北京；城市名留空
    // （浮层退化为两段文案），且不写缓存，下一个周期继续重试定位。
    const fallback =
      fixedLat !== null && fixedLon !== null
        ? { lat: fixedLat, lon: fixedLon, city: null }
        : { lat: DEFAULT_COORDS.lat, lon: DEFAULT_COORDS.lon, city: null };
    return { location: fallback, degraded: true };
  };

  const refresh = async () => {
    // 周期进行中（手动刷新撞上定时器）时直接返回当前载荷，不叠加请求。
    if (fetching) return { ...sample };
    fetching = true;
    try {
      const { location, degraded } = await resolveGeo();
      // 预报与空气质量并行发出，各自独立 8s 超时；AQ 失败只记 null——跳过
      // haze/dust 判定、WMO 45/48 落 fog，不阻塞主流程。
      const [forecast, air] = await Promise.all([
        fetchJson(forecastUrl(location)),
        fetchJson(airQualityUrl(location)),
      ]);
      const current = forecast?.current;
      if (current !== null && current !== undefined && typeof current === 'object') {
        const observed = {
          weatherCode: Number.isInteger(current.weather_code) ? current.weather_code : null,
          temperature: finite(current.temperature_2m),
          windSpeed: finite(current.wind_speed_10m),
          windGusts: finite(current.wind_gusts_10m),
          precipitation: finite(current.precipitation),
          pm2p5: finite(air?.current?.pm2_5),
          pm10: finite(air?.current?.pm10),
        };
        const isDayReading = current.is_day;
        // 日出/日落是「当地墙上时间」的 ISO 串（timezone=auto），客户端用同一
        // 基准比较即可，不依赖浏览器时区；utcOffset 供客户端把 Date.now() 折算
        // 成当地墙上时间。
        const sunriseRaw = forecast?.daily?.sunrise?.[0];
        const sunsetRaw = forecast?.daily?.sunset?.[0];
        sample = {
          kind: normalizeWeatherKind(observed),
          temperature: observed.temperature,
          city: location.city,
          isDay:
            isDayReading === 1 || isDayReading === true
              ? true
              : isDayReading === 0 || isDayReading === false
                ? false
                : localIsDay(),
          updatedAt: new Date().toISOString(),
          error: null,
          geoFallback: degraded,
          sunrise: text(sunriseRaw),
          sunset: text(sunsetRaw),
          utcOffset: finite(forecast?.utc_offset_seconds),
        };
        lastSample = sample;
        lastSuccessAt = Date.now();
      } else if (lastSample !== null && Date.now() - lastSuccessAt <= STALE_WINDOW_MS) {
        // 预报失败但上次成功不久：沿用陈旧数据，只把 error 点亮——客户端照常
        // 渲染真实天气，设置页多一行灰色提示。
        sample = { ...lastSample, error: 'unreachable' };
      } else {
        sample = {
          kind: 'cloudy',
          temperature: null,
          city: location.city,
          isDay: localIsDay(),
          updatedAt: null,
          error: 'unreachable',
          geoFallback: degraded,
          sunrise: null,
          sunset: null,
          utcOffset: null,
        };
      }
    } catch {
      // 兜底：任何未预期异常都不得逃逸到定时器回调里，载荷维持上一状态。
    } finally {
      fetching = false;
    }
    return { ...sample };
  };

  return {
    payload: () => ({ ...sample }),
    refresh,
  };
}

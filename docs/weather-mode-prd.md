# 增量 PRD：天气壁纸模式（Weather Wallpaper Mode）

## 0. 项目信息

- **Language**: 简体中文（与用户需求语言一致）
- **Programming Language**: Vite + React + MUI + Tailwind CSS 约定不适用于本插件；本插件为**零第三方依赖的纯 ESM**（Host 半区 Node.js + 浏览器半区 `window.__ModuleLoader__.load` 注册，`scripts/build.mjs` 直接拷贝 `src/` 到 `lib/`，无打包步骤）
- **Project Name**: `weather_wallpaper_mode`
- **原始需求复述**：
  > 「我还想做个功能，比如在设置里面可以设置一种 天气/跟随系统壁纸，两个图片卡片，字在图上，至于最后文案你可以定，生图可以用 sharesai-imagegen，跟随系统壁纸就是现在当前，天气是要去开开源或者百度等天气获取当前的天气，可以1h更新一次（位置应该查询的站点可以根据ip获取吧），然后天气背景就是需要可能使用threejs或者其他库？要区分天气，小雨，中雨，暴雨，狂风，雾霾，下雪等等？然后以可视化效果做出来应用到背景里面，这样才有可玩性」

## 1. 产品目标

**一句话目标**：在设置页新增「跟随系统壁纸 / 天气壁纸」双模式切换，天气模式下根据 IP 定位获取当地实时天气，用全屏 Canvas 粒子动画把天气「演」成动态背景。

- **G1 可玩性**：至少 6 种天气各有辨识度高的粒子特效（雨丝/风速/雪片/雾团在密度、速度、色调上可感知区分），天气切换有平滑过渡。
- **G2 零负担**：天气数据 Host 半区获取 + 1 小时缓存，浏览器半区零新增网络依赖；渲染引擎零第三方依赖（Canvas 2D）。
- **G3 不破坏现状**：现有「跟随系统壁纸」为默认模式，五个外观参数与所有既有行为在两种模式下都继续生效；天气获取失败时有明确降级路径，不黑屏、不报错弹窗。

## 2. 用户故事

1. 作为用户，我想在「设置 → 实时壁纸外观」顶部用两张图文卡片选择「跟随系统壁纸」或「天气壁纸」，以便一眼看懂两种模式的区别并随时切换。
2. 作为用户，选择天气壁纸后，我想看到背景自动变成我所在城市当前天气的动画（小雨就是细雨、下雪就是飘雪），以便桌面氛围与真实天气同步。
3. 作为用户，我想让天气每 1 小时自动更新一次且不用手动操作，以便长时间挂着 Harness 时背景始终贴近真实天气。
4. 作为用户，我在断网或天气服务不可用时仍想有一个正常、好看的背景（降级为默认效果而不是黑屏或报错），以便不影响正常使用。
5. 作为用户，我想在天气模式下继续调节模糊 / 压暗 / 强度 / 饱和度 / 面板不透明度，以便天气特效与现有外观参数叠加使用。

## 3. 需求池

### P0（必须）

| # | 需求 | 验收标准 |
|---|---|---|
| P0-1 | **双模式卡片 UI**：设置页现有滑块面板上方新增「背景模式」卡片组，两张图片卡片（图 + 图上文字），点击即切换，选中态有明显视觉区分（描边 + 角标） | ① 两张卡片并排（宽屏）或上下堆叠（窄屏 ≤ 640px）；② 选中卡有主题色 2px 描边、右上角「使用中」角标、未选中卡 hover 有反馈；③ 切换后立即生效，无需重启；④ 键盘可聚焦、Enter/Space 可切换 |
| P0-2 | **模式持久化**：`localStorage` 键 `dsh.wallpaper.mode`（值 `system` / `weather`）+ 自定义事件 `dsh-wallpaper:mode`；`cordis.patch.yml` 新增 config 默认值 `mode: 'system'`，经 discover 接口下发 | ① 刷新页面后模式保持；② 清掉 localStorage 后回落到 config 默认值；③ 写入/清除 localStorage 与现有 `dsh.wallpaper.look` 同模式（try/catch 包裹） |
| P0-3 | **IP 定位 + 天气获取 + 1h 更新**（Host 半区）：新增 `weatherIntervalMs`（默认 3600000，最小 600000）；首次激活后约 15s 内完成第一次获取，随后每 1h 一次；定位与天气请求均有 AbortController 超时（8s） | ① 正常情况下 discover 响应体新增 `weather` 字段（kind/temperature/city/isDay/updatedAt/error）；② 连续两次请求间隔 ≥ 配置值；③ 单次定位/天气请求失败不影响 capture 主循环与其它接口 |
| P0-4 | **discover 接口扩展**：天气数据随现有 `/api/dsh-wallpaper/discover` 轮询（客户端 POLL_MS=2000 不变）下发，天气 kind 变化时客户端才重渲染特效 | ① 客户端无需新增轮询接口；② kind 未变时不重建粒子系统（仅 overlay 文案可刷新）；③ 载荷新增字段对旧版本客户端向后兼容（缺失字段时按 system 模式处理） |
| P0-5 | **天气模式背景渲染**（浏览器半区）：新建全屏 `<canvas>` 层（复用现有 `data-dsh-wallpaper` 容器，z-index -1），天气模式下隐藏双图层 img、显示特效画布；Canvas 2D 粒子引擎，零第三方依赖 | ① 天气模式下壁纸 img 图层 opacity 归零且不再发起 frame 请求；② 画布铺满视口、`pointer-events: none`、随窗口 resize 重建；③ `prefers-reduced-motion: reduce` 时降级为静态渐变（无粒子动画） |
| P0-6 | **至少 6 种天气效果**：小雨 / 中雨 / 暴雨 / 狂风 / 雾霾 / 下雪，各自粒子特征、色调、动态强度见 §5 映射表 | ① 每种效果粒子数、速度、色相三项中至少两项可感知区别于其它类型；② 1080p 下帧率 ≥ 30fps（中端机型），空闲时 CPU 占用增幅 < 15%；③ 天气 kind 切换 1.5s 内完成交叉过渡，无黑屏、无闪烁 |
| P0-7 | **外观参数在天气模式继续生效**：模糊（CSS filter 作用于 canvas）、强度（canvas 不透明度）、压暗（scrim 层不变）、饱和度（filter）、面板不透明度（token 不变） | ① 天气模式下拖动 5 个滑块，画面即时变化；② 压暗层与面板半透明逻辑与 system 模式完全一致；③ 「恢复默认」对两种模式都生效 |
| P0-8 | **i18n**：`locale/zh.json` / `locale/en.json` 新增模式卡片、天气类型名、降级提示等键（见 §4 文案表） | ① 中英文界面无 fallback 文案露出（未命中 key 时显示中文）；② 新增键不影响既有键 |
| P0-9 | **降级策略**：① IP 定位失败 → 使用 config 固定坐标（`weatherLat`/`weatherLon`，可选）→ 再失败则用默认坐标（北京）并标记 `geoFallback: true`；② 天气请求失败 → 沿用上次成功数据（≤ 6h）→ 超过则渲染默认「多云」效果；③ discover 的 `weather.error` 非空时，设置页天气卡片内显示一行灰色小字提示（不弹窗、不阻塞） | ① 拔网线重启 Harness：背景为默认多云效果，设置页有提示行，其它功能正常；② 网络恢复后 1h 内自动恢复真实天气；③ 任何失败路径都不出现白屏/黑屏/未捕获异常 |

### P1（应该）

| # | 需求 | 验收标准 |
|---|---|---|
| P1-1 | **昼夜色调**：Open-Meteo `current=is_day` 为 0 时整体压暗、降饱和、粒子亮度下调（夜晚更暗更沉） | ① 同一天气在昼/夜有明显色温差异；② 昼夜判定来自天气数据而非本地时间，跨时区 IP 也正确 |
| P1-2 | **天气文字浮层**：右下角半透明小卡片显示「城市 · 温度 · 天气名」，6s 淡出、hover/新天气时重现；可关闭（localStorage 记忆） | ① 文案走 i18n 与天气类型名；② 不遮挡输入区主要操作；③ 关闭后不再出现直到手动开启 |
| P1-3 | **更多天气类型**：晴 / 多云 / 雷暴 / 冰雹 / 沙尘（映射见 §5） | ① WMO 码与阈值覆盖 §5 全部类型；② 每种有独立粒子配置；③ 雷暴含全屏闪电（1.5–4s 随机间隔，不频闪到不适） |

### P2（可选）

| # | 需求 | 验收标准 |
|---|---|---|
| P2-1 | **特效强度滑块**：设置页新增「特效强度」（0.5–1.5，默认 1），乘在粒子密度上 | ① 实时生效；② 持久化到 `dsh.wallpaper.look` 覆盖值（键名 `effectScale`） |
| P2-2 | **手动刷新天气**：设置页天气卡片内「立即刷新」按钮，POST 新接口 `/api/dsh-wallpaper/weather/refresh` 触发即时获取 | ① 按钮 loading 态；② 刷新失败显示错误文案；③ 不破坏 1h 自动节奏（手动刷新不重置定时器） |
| P2-3 | **天气切换过渡动效**：kind 变化时旧粒子淡出 / 新粒子淡入（约 800ms），而非硬切 | ① 过渡期间帧率不掉出 24fps；② 暴雨 → 小雪这类强对比切换同样平滑 |
| P2-4 | **天气模式暂停抓帧**：客户端切换模式时上报（POST `/api/dsh-wallpaper/mode`），Host 在 weather 模式下暂停 `ctx.timer.interval(capture)`，切回时恢复 | ① weather 模式下 discover 的 `frame` 为 null；② system 模式恢复后 6s 内出图；③ 接口幂等，重复上报无副作用 |

## 4. UI 设计稿描述

### 4.1 布局

设置页结构变为（自上而下）：

```
┌─────────────────────────────────────────────┐
│ 背景模式                              ← 新增卡片组 │
│ ┌───────────────┐  ┌───────────────┐        │
│ │  [缩略场景图]  │  │  [缩略场景图]  │        │
│ │  跟随系统壁纸  │  │   天气壁纸     │        │
│ │  一句话描述…  │  │  一句话描述…  │        │
│ └───────────────┘  └───────────────┘        │
├─────────────────────────────────────────────┤
│ 外观（现有 5 滑块 + 恢复默认）                │
├─────────────────────────────────────────────┤
│ 插件更新（现有）                              │
└─────────────────────────────────────────────┘
```

- **卡片尺寸**：单卡宽 `min(280px, 100%)`，两卡间距 12px；容器 `display:flex; flex-wrap:wrap; gap:12px`，窄屏（≤640px）自动换行堆叠。
- **图片区**：高 132px，圆角 10px，`object-fit: cover` 满铺；图上文字区叠在图片下半部（渐变遮罩保证可读）。
- **图上文字排布**：左上角模式名（14px/600），其下一句描述（12px，opacity .75）；右上角选中角标「使用中 ✓」。
- **选中态**：主题色 2px 描边（`var(--dsw-alias-border-l1, #4d6bfe)`）+ 卡片右上角实心角标 + 轻微 `box-shadow`；未选中：0.5px 中性描边、无角标、hover 时描边加深。
- **交互**：整卡可点（cursor: pointer）、可键盘聚焦（`tabindex=0` + `role="radio"` + `aria-checked`）、Enter/Space 切换；切换立即写 localStorage 并派发 `dsh-wallpaper:mode` 事件。

### 4.2 卡片缩略图方案（重要决策）

卡片配图**不使用 sharesai-imagegen 联网生图**，改为**纯 CSS/SVG 内嵌微缩场景**（零网络依赖、离线可用、随主题自适应）：

- 「跟随系统壁纸」卡：CSS 渐变模拟的桌面+壁纸缩略（借鉴现有截图布局：桌面渐变底 + 一个半透明面板轮廓）。
- 「天气壁纸」卡：SVG 微缩天气场景（雨丝线条 + 云 + 月亮/太阳轮廓，深蓝灰基调）。

> 备注：若后续想要更精致的美术图，可用 sharesai-imagegen 生成两张 560×264 PNG 放进 `docs/` 或插件包内以 base64 内联，运行时仍零网络请求。此为实现细节，架构师可定。

### 4.3 文案（中英双语，PM 定稿）

| 位置 | 中文 | English |
|---|---|---|
| 分组标题 | 背景模式 | Background mode |
| 卡1 名称 | 跟随系统壁纸 | System wallpaper |
| 卡1 描述 | 把当前桌面壁纸作为半透明背景，每几秒自动同步 | Your current desktop wallpaper, synced every few seconds |
| 卡2 名称 | 天气壁纸 | Weather wallpaper |
| 卡2 描述 | 本地实时天气化作流动的背景，雨雪风雾各有意境 | Your local weather, animated — rain, snow, wind and fog |
| 选中角标 | 使用中 | Active |
| 天气浮层 | `{city} · {temp}° · {kind}` | `{city} · {temp}° · {kind}` |
| 天气失败提示 | 天气数据暂不可用，已使用默认效果 | Weather data unavailable — showing the default effect |
| 天气更新时间 | 更新于 {time} | Updated {time} |

i18n 键命名（沿用 `update.*` 的点号风格）：

```
mode.title / mode.system / mode.system.desc / mode.weather / mode.weather.desc / mode.active
weather.kind.clear / .cloudy / .drizzle / .rain / .heavyRain / .thunderstorm / .snow / .fog / .haze / .wind / .hail / .dust
weather.overlay / weather.unavailable / weather.updatedAt / weather.refresh / weather.refreshing
```

天气类型名：晴 / 多云 / 小雨 / 中雨 / 暴雨 / 雷暴 / 下雪 / 雾 / 雾霾 / 狂风 / 冰雹 / 沙尘
（Clear / Cloudy / Light rain / Rain / Heavy rain / Thunderstorm / Snow / Fog / Haze / Windy / Hail / Dust）

## 5. 天气类型 → 视觉效果映射表

内部 kind 由 Host 归一化后下发（WMO weather_code + 风速/降水阈值 + is_day），客户端只认 kind 枚举，不感知 WMO。

| kind | 触发条件（Host 侧归一化） | 粒子特征 | 色调（昼 / 夜） | 动态强度 |
|---|---|---|---|---|
| `drizzle` 小雨 | WMO 51/61，或降水 < 2.5 mm/h | 细短雨丝 40–70 条/屏，速度 4–6 px/帧，8–12° 斜角 | 冷灰蓝 #6b7d95 / 深蓝灰 #3e4a5c | 低 |
| `rain` 中雨 | WMO 63/80，降水 2.5–10 mm/h | 中等雨丝 90–140 条，速度 7–9 px/帧，12–18° 斜角 | 蓝灰 #5a6b85 / 深青灰 #34404f | 中 |
| `heavyRain` 暴雨 | WMO 65/82，降水 > 10 mm/h | 粗长雨丝 160–240 条，速度 12–16 px/帧，20–30° 斜角；地面溅落涟漪；偶发闪电（亮度脉冲 8%） | 深蓝灰 #3d4a5f / 近黑蓝 #232c3a | 高 |
| `wind` 狂风 | wind_speed_10m ≥ 50 km/h 或 gusts ≥ 75 km/h（无强降水时） | 横向高速粒子流（细长线 + 少量叶片/尘点），阵风扰动（速度周期性 ±30%），15–25° 上扬 | 灰绿 #5f6b63 / 墨绿灰 #39423d | 高 |
| `haze` 雾霾 | WMO 45/48（雾）或 PM2.5 ≥ 150（接 Air Quality API 时） | 大团半透明雾团 8–14 团，半径 120–260px，极慢漂移 + 呼吸缩放；低对比、低饱和 | 土黄灰 #8a8272 / 褐灰 #4f4a40 | 低 |
| `snow` 下雪 | WMO 71–77/85/86，或 snowfall > 0 | 雪花 120–200 片，半径 1–3.5px，正弦摇摆下落（水平振幅 ±14px），速度 1–2.5 px/帧；近景大雪花加微模糊 | 冷白蓝灰 #9aa8b8 / 蓝灰 #5c6878 | 中 |
| `clear` 晴（P1） | WMO 0 且 is_day=1 | 蓝天 + 烈日（核心 + 四级日晕 + 放射光柱，随时刻走弧线）+ 阳光浮尘 20–40 颗缓慢上浮；地平线只有 4° 薄雾 | 浮尘近白暖 #fff6e2 / 冷白 #dbe6f5（夜间并入 clear 暗调） | 低 |
| `cloudy` 多云（P1/默认降级） | WMO 1–3 | 缓慢飘移的云影（大面积柔边暗斑，3–5 组，横向移动） | 中性灰蓝 #8b95a3 / 深灰蓝 #4a525f | 低 |
| `thunderstorm` 雷暴（P1） | WMO 95/96/99 | 暴雨粒子 + 闪电：1.5–4s 随机间隔，先照亮云底再全屏微亮，300–500ms 衰减；禁止高频频闪 | 深紫灰 #3a3d52 / 暗紫 #232535 | 高 |
| `hail` 冰雹（P1） | WMO 96/99 + 降水突增，或 temperature < 2 且降水 > 10 | 大颗粒（半径 2.5–4px）+ 触底反弹一次；密度低于暴雨 | 冷灰 #7d8794 / 深灰 #454d58 | 中高 |
| `dust` 沙尘（P1） | AQI/PM10 ≥ 200 且风速 ≥ 30 km/h（接 Air Quality API 时） | 橙褐色颗粒横飞，密度随风速阵变，视野轻微泛橙 | 土橙 #a0805a / 暗褐 #5c4a38 | 中 |

**昼夜规则（P1）**：`is_day=0` 时，所有 kind 的底色整体乘 0.55 亮度、粒子亮度上限下调 30%、雨丝/雪片颜色向冷蓝偏移；闪电/光尘类「发光粒子」保持原样（夜晚更显眼）。

**公共验收标准（可玩性）**：
1. 六个 P0 kind 跨类别（雨 / 雪 / 风 / 雾霾）以「粒子形状（线/点/团）× 运动方向（下落/横飞/摇摆/漂移）」区分；类别内分档（雨系三档：小雨/中雨/暴雨）以「密度 / 速度 / 色相」区分，暴雨另附涟漪与闪电。任一 kind 与其它 kind 并排或前后切换时可被无提示识别；
2. 天气切换 1.5s 内可感知变化（P2 提供 800ms 淡入淡出过渡）；
3. `prefers-reduced-motion: reduce` 时全部 kind 降级为对应静态渐变（取该 kind 夜/昼底色），不保留任何动画。

## 6. 数据流说明（文字）

```
┌─────────────┐  每 1h（weatherIntervalMs，默认 3600000）  ┌──────────────┐
│  Host 半区   │ ────────────────────────────────────────> │  IP 定位服务  │
│  (Node.js)  │  ipwho.is（HTTPS 无 key）失败则 ip-api.com  │  返回 lat/lon │
└─────┬───────┘                                            └──────────────┘
      │ 定位结果内存缓存（同 IP 不重复请求；失败走 config 坐标/默认北京）
      ▼
┌─────────────┐  Open-Meteo current 请求（temperature_2m, weather_code,      ┌──────────────┐
│  Host 半区   │ ───────────────────────────────────────────────────────────> │  api.open-   │
│             │  wind_speed_10m, wind_gusts_10m, precipitation, is_day,      │  meteo.com   │
│             │  可选 air-quality-api 的 pm2_5/pm10/european_aqi）           │              │
└─────┬───────┘ <─────────────────────────────────────────────────────────── └──────────────┘
      │ 归一化：WMO 码 + 风速/降水阈值 + is_day → kind 枚举（§5）
      │ 缓存：内存 + updatedAt 时间戳；失败沿用上次成功数据（≤6h）
      ▼
┌─────────────┐  GET /api/dsh-wallpaper/discover（客户端现有 2s 轮询不变）
│  discover   │  载荷新增 weather: { kind, temperature, city, isDay, updatedAt, error, geoFallback }
└─────┬───────┘
      ▼
┌─────────────┐  kind 变化才重建粒子系统；look 变化只改 CSS filter/透明度
│ 浏览器半区   │  Canvas 2D 全屏粒子渲染 + scrim 层 + 面板 token（与 system 模式共用）
└─────────────┘
```

要点：
- **定位与天气只在 Host 半区发生**：浏览器直连 ipwho.is/ip-api.com 会被 CORS 或混合内容（HTTP）拦截，Host 侧 Node fetch 无此限制，且天然集中做 1h 缓存与超时。
- 天气数据是 discover 响应体的一个附加字段，不新增客户端轮询接口；`kind` 未变时客户端不做任何重渲染。
- mode 本身不经过 Host 判定：config 默认值经 discover 下发，localStorage 覆盖值优先，两者合并逻辑与现有 `look` 完全一致。

## 7. 待确认问题（需架构师定夺）

1. **Three.js vs Canvas 2D（倾向：Canvas 2D）**。插件当前是「零依赖、拷贝即构建」（`scripts/build.mjs` 只做 `cpSync` + 语法检查）。引入 Three.js（约 600KB）必须改为打包构建（esbuild/rollup），与现有架构冲突，且 2D 粒子（雨丝/雪片/雾团）用 Canvas 2D 完全足够。**建议 Canvas 2D**；若坚持 3D 质感，需同步改造 build 流程并评估产物体积，建议另立专项。
2. **天气 API 选型（倾向：Open-Meteo）**。已核实（2026-10）：Open-Meteo 非商用免费、每日约 10,000 次、无需 key、CORS 开放、提供 WMO weather_code，与「1h 一次」的用量（24 次/日）差 3 个数量级。百度天气 API 需申请 key，适合作为可配置备选（P2，新增 `weatherApiKey` 配置项）。
3. **IP 定位服务（倾向：ipwho.is 主 + ip-api.com 备）**。已核实：ipwho.is 免费无 key、HTTPS、约 1k 次/日（本场景 24 次/日足够）；ip-api.com 免费 45 次/分钟但免费端点仅 HTTP 且禁商用——仅作 Host 侧兜底。因浏览器 CORS 限制，**必须 Host 侧调用**，这一点同时决定了「天气获取放 Host 半区」。
4. **雾霾/沙尘判定来源**：WMO 45/48 只能给出「雾」。要区分「雾霾」需要 Open-Meteo Air Quality API（PM2.5 ≥ 150）的额外一次请求。倾向前者先用雾码出「雾/雾霾」合并效果，P1 再接空气质量 API 拆细。请架构师评估多一次外部依赖的成本。
5. **外观参数适用范围**：倾向 blur/opacity/scrim/saturate 对 weather 模式全部生效（blur 与 saturate 用 CSS `filter` 作用于 canvas 元素，scrim 层与面板 token 逻辑不变）；若架构师认为天气特效被模糊后失去细节，可改为 blur/saturate 仅作用于 system 模式，请在实现时明确。
6. **天气模式是否暂停壁纸抓帧**（P2-4）：需要客户端向 Host 上报模式（新 POST 接口）。能省掉无用的截屏/转码开销，但引入「Host 状态依赖客户端上报」的耦合。请定夺是否值得。
7. **卡片缩略图**：PM 方案为纯 CSS/SVG 内嵌微缩场景（零网络依赖）。若团队希望用 sharesai-imagegen 产出 560×264 图片资源本地化内联（base64 或随包分发），请在任务分解时指派。

---

*本文档为简单档 PRD（不含竞品分析）。技术选型结论以架构师评审为准。*

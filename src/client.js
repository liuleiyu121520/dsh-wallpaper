window.__ModuleLoader__.load({
  id: 'dsh-wallpaper',
  factory(require) {
    const React = require('react');
    const POLL_MS = 2000;
    const FADE_MS = 900;
    const STORAGE_KEY = 'dsh.wallpaper.look';
    const CHANGE_EVENT = 'dsh-wallpaper:look';
    const MODE_STORAGE_KEY = 'dsh.wallpaper.mode';
    const MODE_EVENT = 'dsh-wallpaper:mode';
    /** 效果预览覆盖：非空时强制渲染该 kind，测试阶段看全天气形态用。 */
    const PREVIEW_STORAGE_KEY = 'dsh.wallpaper.preview';
    /** 预览下拉的选项顺序（与 KIND_PRESETS 的键集合一致，晴天→极端天气）。 */
    const PREVIEW_KINDS = [
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
    /** 天气中文名兜底：locale 未命中时（t 返回键名）下拉也显示中文。 */
    const KIND_LABELS = {
      clear: '晴',
      cloudy: '多云',
      drizzle: '小雨',
      rain: '中雨',
      heavyRain: '暴雨',
      wind: '狂风',
      snow: '下雪',
      fog: '雾',
      haze: '雾霾',
      thunderstorm: '雷暴',
      hail: '冰雹',
      dust: '沙尘',
    };
    /** 模式卡片配图：经 Host 白名单路由下发，文件缺失时 404 走渐变兜底。 */
    const CARD_ASSET_URLS = {
      system: '/api/dsh-wallpaper/assets/card-system.jpg',
      weather: '/api/dsh-wallpaper/assets/card-weather-wallpaper.jpg',
    };
    /** 效果预览 icon：AI 生成位图（assets/preview/，白底已抠透明），经白名单路由下发。 */
    const PREVIEW_ICON_URLS = {
      evolve: '/api/dsh-wallpaper/assets/preview/evolve.png',
      auto: '/api/dsh-wallpaper/assets/preview/auto.png',
    };
    for (const kind of PREVIEW_KINDS) PREVIEW_ICON_URLS[kind] = `/api/dsh-wallpaper/assets/preview/${kind}.png`;
    const DEFAULT_LOOK = { opacity: 1, blurPx: 0, scrim: 0.35, saturate: 1, surface: 0.5, effectScale: 1 };
    /**
     * A light theme paints a white scrim, which washes the picture out far
     * faster than the dark equivalent; light and dark therefore start from
     * different defaults, and only the ones present in DEFAULT_LOOK apply.
     */
    const LIGHT_LOOK = { opacity: 1, blurPx: 0, scrim: 0.1, saturate: 1, surface: 0.62 };
    const defaultsForCurrentTheme = () => (isDarkTheme() ? DEFAULT_LOOK : { ...DEFAULT_LOOK, ...LIGHT_LOOK });

    /** Slider definitions shown in the panel, in display order. */
    const SLIDERS = [
      { key: 'blurPx', label: '模糊', min: 0, max: 40, step: 1, unit: 'px', hint: '0 最清晰' },
      { key: 'opacity', label: '壁纸强度', min: 0.2, max: 1, step: 0.01, unit: '', hint: '背景明暗' },
      { key: 'surface', label: '面板不透明度', min: 0.2, max: 1, step: 0.01, unit: '', hint: '越大文字越清楚' },
      { key: 'scrim', label: '压暗', min: 0, max: 0.8, step: 0.01, unit: '', hint: '减弱亮部干扰' },
      { key: 'saturate', label: '饱和度', min: 0.4, max: 2, step: 0.01, unit: '', hint: '画面鲜艳程度' },
      // 既有滑块标签是写死的中文；新增键改走 labelKey/hintKey，让英文界面也正确。
      {
        key: 'effectScale',
        label: '特效强度',
        labelKey: 'look.effectScale',
        min: 0.5,
        max: 1.5,
        step: 0.05,
        unit: '×',
        hint: '天气粒子密度倍率',
        hintKey: 'look.effectScaleHint',
      },
    ];

    const readOverrides = () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    };

    const writeOverrides = (value) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {}
    };

    const merged = (base) => ({ ...defaultsForCurrentTheme(), ...base, ...(readOverrides() ?? {}) });

    /** Notify the background layer that the local overrides changed. */
    const announce = () => window.dispatchEvent(new CustomEvent(CHANGE_EVENT));

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    /** True when the app currently renders its dark palette. */
    const isDarkTheme = () => {
      const doc = document;
      const root = doc.documentElement;
      for (const target of [root, doc.body, doc.getElementById('root')]) {
        if (target && target.hasAttribute('data-ds-dark-theme')) return true;
      }
      const scheme = getComputedStyle(root).colorScheme || '';
      if (scheme.includes('dark')) return true;
      if (scheme.includes('light')) return false;
      const label = getComputedStyle(root).getPropertyValue('--dsw-alias-label-primary').trim();
      const match = /^#([0-9a-f]{6})$/i.exec(label);
      if (match) {
        const value = Number.parseInt(match[1], 16);
        const luminance = ((value >> 16 & 0xff) + (value >> 8 & 0xff) + (value & 0xff)) / 3;
        return luminance > 128;
      }
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
    };

    /**
     * Own palette for the control chrome. This plugin rewrites the app's
     * background tokens to translucent values, so reading those tokens here
     * would leave the panel washed out and the handle unreadable.
     */
    const palette = () => {
      const dark = isDarkTheme();
      return {
        surface: dark ? 'rgba(22, 25, 31, 0.97)' : 'rgba(250, 251, 253, 0.98)',
        text: dark ? '#e9ecf2' : '#12151b',
        border: dark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.14)',
        track: dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.16)',
        accent: dark ? '#7d95ff' : '#3d5afe',
        accentText: '#ffffff',
        shadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
      };
    };

    // ── weather mode: stores ─────────────────────────────────────────────────

    /** 用户开启「减少动态效果」时，天气引擎只绘静态渐变（PRD P0-5 ③）。 */
    const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    /**
     * 模式覆盖的读写与 look 完全同构：隐私模式下 localStorage 抛异常时静默
     * 回落，由 discover 下发的 config 默认值接管（降级矩阵第 9 条）。
     */
    const readMode = () => {
      try {
        const value = window.localStorage.getItem(MODE_STORAGE_KEY);
        return value === 'weather' || value === 'system' ? value : null;
      } catch {
        return null;
      }
    };

    const writeMode = (mode) => {
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, mode);
      } catch {}
    };

    /** 生效模式的共享状态：localStorage 覆盖 ?? config 默认 ?? system。 */
    const modeStore = (() => {
      let mode = readMode() ?? 'system';
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {}
        }
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        get() {
          return mode;
        },
        publish(next) {
          mode = next === 'weather' ? 'weather' : 'system';
          emit();
        },
      };
    })();

    /**
     * 系统壁纸最近一次换帧的墙钟时刻（只服务于卡片上的「更新于」展示）。
     */
    const frameTimeStore = (() => {
      let at = null;
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {}
        }
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        get() {
          return at;
        },
        touch() {
          at = Date.now();
          emit();
        },
      };
    })();

    /** 预览覆盖的读写：与 mode/look 同模式，隐私模式下静默回落 null（跟随真实天气）。 */
    const readPreview = () => {
      try {
        const value = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
        return value === null || value === '' || value === 'auto' ? null : value;
      } catch {
        return null;
      }
    };

    const writePreview = (kind) => {
      try {
        if (kind === null) window.localStorage.removeItem(PREVIEW_STORAGE_KEY);
        else window.localStorage.setItem(PREVIEW_STORAGE_KEY, kind);
      } catch {}
    };

    /**
     * 效果预览的共享状态（null = 跟随真实天气）。
     *
     * 测试阶段的调试口：真实天气是晴/多云时背景变化极淡，靠它强制渲染任意
     * kind 才能验证渲染链路。publish 写存储并广播；apply 只同步内存——storage
     * 事件入口不能回写，否则两个文档会互相触发形成事件回环。
     */
    const previewStore = (() => {
      let preview = readPreview();
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {}
        }
      };
      const assign = (next) => {
        preview = typeof next === 'string' && next !== '' && next !== 'auto' ? next : null;
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        get() {
          return preview;
        },
        publish(next) {
          assign(next);
          writePreview(preview);
          emit();
        },
        apply(next) {
          assign(next);
          emit();
        },
      };
    })();

    /** 天气载荷的共享状态：poll 每次发布，浮层与设置页据此刷新文案。 */
    const weatherStore = (() => {
      let weather = null;
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {}
        }
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        get() {
          return weather;
        },
        publish(next) {
          weather = next !== null && typeof next === 'object' ? next : null;
          emit();
        },
      };
    })();

    /**
     * 把生效模式上报给 Host，让它暂停/恢复抓帧（PRD P2-4）。
     *
     * 幂等：重复上报同一模式没有副作用；失败静默——Host 侧状态只影响是否白抓帧，
     * 不值得为一次网络抖动打扰用户。
     */
    const reportMode = async (mode) => {
      try {
        await fetch('/api/dsh-wallpaper/mode', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode }),
          cache: 'no-store',
        });
      } catch {}
    };

    /**
     * 切换模式：写存储 → 通知背景层与各界面 → 派发事件。
     *
     * 上报 Host 不放在这里而放在 renderMode：那是「模式真正切换」的唯一收口，
     * config 默认值与 localStorage 不一致时的被动切换同样会经过它（见其注释）。
     */
    const setMode = (next) => {
      const mode = next === 'weather' ? 'weather' : 'system';
      if (mode === modeStore.get()) return;
      writeMode(mode);
      modeStore.publish(mode);
      window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: { mode } }));
    };

    /**
     * 跨文档同步桥：同 origin 的其它文档（设置页 iframe / 独立窗口）写入
     * localStorage 时，立即同步本文档的 modeStore。
     *
     * 为什么需要：设置页与背景层可能分属两个浏览上下文，两个 modeStore 是
     * 独立实例，publish 互不触达；storage 事件是浏览器原生唯一能跨文档通知
     * localStorage 变化的机制。同文档内的写入不会触发 storage 事件，所以
     * poll 里的 readMode 兜底与焦点桥（见 start）都不能省。
     *
     * 模块级注册而非挂到 start 的 dispose 上：插件没有卸载入口，而监听器
     * 只做 store 同步，即使模块被加载两份也各自作用于各自实例，无泄漏面。
     */
    const onStorage = (event) => {
      try {
        if (event.key === MODE_STORAGE_KEY) {
          const next = event.newValue === 'weather' ? 'weather' : event.newValue === 'system' ? 'system' : null;
          if (next !== null && next !== modeStore.get()) modeStore.publish(next);
          return;
        }
        if (event.key === STORAGE_KEY) {
          // look 覆盖变化复用现有 CHANGE_EVENT 通道：背景层的 onLookChange
          // 会重读合并并 applyLook，无需在这里展开逻辑。
          announce();
          return;
        }
        if (event.key === PREVIEW_STORAGE_KEY) {
          previewStore.apply(event.newValue);
          return;
        }
      } catch {}
    };
    window.addEventListener('storage', onStorage);

    /**
     * Paints the wallpaper *behind* the application instead of on top of it,
     * then makes the app's opaque surfaces translucent so the picture shows
     * through while text keeps its contrast.
     */
    function start(ctx) {
      const doc = document;
      const root = doc.documentElement;
      const previousSurface = root.style.getPropertyValue('--dsh-wallpaper-surface');

      /**
       * Keeps dialogs and floating layers opaque. They inherit the base surface
       * this plugin makes translucent, so without this rule their content would
       * sit directly on the wallpaper.
       */
      const overlayRule = doc.createElement('style');
      overlayRule.setAttribute('data-dsh-wallpaper-dialog-opacity', '');
      doc.head.append(overlayRule);

      const container = doc.createElement('div');
      container.setAttribute('data-dsh-wallpaper', '');
      container.setAttribute('aria-hidden', 'true');
      Object.assign(container.style, {
        position: 'fixed',
        left: '0',
        right: '0',
        top: '0',
        bottom: '0',
        zIndex: '-1',
        overflow: 'hidden',
        pointerEvents: 'none',
      });

      const layer = (key) => {
        const img = doc.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.dataset.layer = key;
        Object.assign(img.style, {
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: '0',
          transition: `opacity ${FADE_MS}ms ease-in-out`,
          willChange: 'opacity',
        });
        container.append(img);
        return img;
      };

      const images = { a: layer('a'), b: layer('b') };

      // 天气画布夹在双图层与压暗层之间：system 模式下 img 淡入、canvas 透明，
      // weather 模式反之；压暗层与面板 token 两种模式共用，不做任何分支。
      const canvas = doc.createElement('canvas');
      Object.assign(canvas.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        opacity: '0',
        transition: `opacity ${FADE_MS}ms ease-in-out`,
        pointerEvents: 'none',
        willChange: 'opacity',
      });
      canvas.setAttribute('aria-hidden', 'true');
      container.append(canvas);

      const scrim = doc.createElement('div');
      Object.assign(scrim.style, { position: 'absolute', inset: '0' });
      container.append(scrim);
      doc.body.prepend(container);

      // WebGL2 优先：真 3D 场景（地面透视 / 立体雪堆 / 雨丝拉伸）。它返回 null 表示
      // 环境不支持（无 webgl2、着色器编不过、?renderer=canvas 强制），此时画布还
      // 没被绑定过上下文，Canvas 2D 引擎可以原样接管——回退路径逐字未改。
      const engine = createWebglWeatherEngine(canvas) ?? createWeatherEngine(canvas);

      /**
       * Concrete surface colours per theme mode.
       *
       * The app's own `--dsw-alias-bg-*` values cannot be reused here: this
       * plugin overwrites them with `color-mix(...)` translucency, and a dialog
       * painted with such a value keeps showing the wallpaper through it. Fixed
       * opaque colours keyed on the mode are deterministic and always readable.
       */
      const THEME_SURFACE = {
        dark: { base: '#12151b', layer: '#1a1e26' },
        light: { base: '#ffffff', layer: '#f6f7f9' },
      };

      /** Palette for the current mode, re-read on every apply. */
      const readTheme = () => {
        const surface = THEME_SURFACE[isDarkTheme() ? 'dark' : 'light'];
        return { base: surface.base, layer1: surface.layer, layer2: surface.layer, dark: isDarkTheme() };
      };

      let hostLook = { ...DEFAULT_LOOK };
      let look = merged(hostLook);
      let front = 'a';
      let revision = null;
      let disposed = false;
      let timer;
      /** 背景层当前模式（设计 §4.4）：weather 与 degraded 的渲染完全相同。 */
      let currentMode = 'system';
      /** 最近一次 poll 拿到的天气载荷；null 表示尚未收到或载荷缺失。 */
      let weatherPayload = null;
      let unsubscribeMode = null;

      const mix = (color, alpha) =>
        `color-mix(in srgb, ${color} ${Math.round(Math.min(1, Math.max(0, alpha)) * 100)}%, transparent)`;

      /**
       * 浅色主题的「生效值」换算——主题维度映射补偿（分两层）。
       *
       * 面板（卡片）与页面底色要分开对待：卡片是文字的载体，浅色下半透明白
       * 叠深色壁纸会合成灰泥，必须抬进近不透明区间；而页面底色（bg-base，
       * 会话主内容列就是它）是壁纸的展示面，抬太高壁纸就整体消失（实测
       * `.OuKnBG_centerCol` 用 bg-base，冲到 80% 时会话区看不见任何壁纸）。
       * 因此：底色维持低透明度（≈ 侧栏 40% 的观感），卡片保持干净。
       * 深色主题走恒等换算，输出 CSS 与改前逐字节一致。
       */
      /**
       * 页面底色 base: [0.2,1] → [0.42,0.90]，默认 0.5 → 0.66。
       *
       * 这个值决定「宿主浅色文字落在一个多亮的底上」：0.41 实测页面亮度
       * ≈164/255，正文与灰字（#5x）压在中灰底上对比度只剩 ~2.5:1，整体发灰；
       * 0.80 壁纸几乎看不见。0.66 让页面落在 ≈210/255 的可读区间，壁纸仍以
       * 柔和底纹透出——想更透或更实，用户可以拉「面板不透明度」滑块。
       */
      const lightBaseAlpha = (surface) => clamp(0.42 + 0.48 * clamp(surface, 0, 1), 0, 1);
      /** 卡片 surface: [0.2,1] → [0.72,0.96]，默认 0.5 → 0.84（文字干净可读）。 */
      const lightSurfaceAlpha = (surface) => clamp(0.70 + 0.26 * clamp(surface, 0, 1), 0, 1);
      /** scrim: [0,0.8] → [0.45,0.81]，默认 0.35 → 0.61；0 也保留 0.45 白纱压住壁纸。 */
      const lightScrimAlpha = (scrim) => clamp(0.45 + 0.45 * clamp(scrim, 0, 1), 0, 0.88);

      /**
       * The theme declares its tokens on the app root, so overriding only
       * `html` loses to the nearer declaration. Write the tokens onto every
       * level between `html` and the rendered app so the last one wins.
       */
      const overrideTargets = () => {
        const targets = [root];
        if (doc.body) targets.push(doc.body);
        const app = doc.getElementById('root');
        if (app) targets.push(app);
        return targets;
      };

      const setTokens = (name, value) => {
        for (const target of overrideTargets()) target.style.setProperty(name, value);
      };

      const clearTokens = (name) => {
        for (const target of [root, doc.body, doc.getElementById('root')]) {
          if (target) target.style.removeProperty(name);
        }
      };

      const applyLook = () => {
        for (const key of ['a', 'b']) {
          const img = images[key];
          img.style.filter = `blur(${look.blurPx}px) saturate(${look.saturate})`;
          // Overscan so a blur never reveals an edge.
          const bleed = Math.ceil(look.blurPx * 2);
          img.style.inset = `-${bleed}px`;
          img.style.width = `calc(100% + ${bleed * 2}px)`;
          img.style.height = `calc(100% + ${bleed * 2}px)`;
          // 天气模式下 img 图层整体退场，把背景让给 canvas。
          img.style.opacity = currentMode === 'weather' ? '0' : front === key ? String(look.opacity) : '0';
        }
        // 画布复用同一套 filter 与 overscan：CSS filter 在元素边缘会采样透明区，
        // 随模糊半径一起放大铺满，视口边才不会露出毛边。
        const bleed = Math.ceil(look.blurPx * 2);
        canvas.style.filter = `blur(${look.blurPx}px) saturate(${look.saturate})`;
        canvas.style.inset = `-${bleed}px`;
        canvas.style.width = `calc(100% + ${bleed * 2}px)`;
        canvas.style.height = `calc(100% + ${bleed * 2}px)`;
        canvas.style.opacity = currentMode === 'weather' ? String(look.opacity) : '0';
        // Panels above the picture become frosted instead of opaque; nested
        // surfaces stay a little denser so cards keep their own separation.
        //
        // These values apply to the whole document (the app frame's own CSS
        // reads them), so a dialog that inherits them would float its text over
        // the wallpaper. Every dialog and floating overlay is therefore forced
        // back to the original opaque theme colour below.
        // Re-read the palette every time: a theme switch (light/dark) changes
        // the scrim hue and the text colours, and keeping values captured at
        // startup left a dark scrim over a light UI.
        const theme = readTheme();
        // 主题维度映射补偿：滑块存的是用户值（量程/语义/持久化不动），渲染时
        // 按主题换算生效值——浅色下白面板半透明叠深壁纸是灰泥，换算把面板抬进
        // 近不透明区间、压暗层换成带下限的白纱（见 lightSurfaceAlpha 注释）。
        // 深色主题恒等换算，下面输出的 CSS 与映射前逐字节一致。
        const surfaceAlpha = theme.dark ? look.surface : lightSurfaceAlpha(look.surface);
        // 页面底色单独换算：浅色下刻意压住（壁纸要看得见），深色恒等。
        const baseAlpha = theme.dark ? look.surface : lightBaseAlpha(look.surface);
        const scrimUser = theme.dark ? look.scrim : lightScrimAlpha(look.scrim);
        // 天气模式的底色本身就是为文字可读性设计的深色渐变；再套一层为亮色
        // 照片准备的压暗，会把整个画面压成和默认深色主题无法区分的近黑色
        // （实测 cloudy 底色 + 0.46 压暗 + 0.37 面板 ≈ RGB(28,30,34)）。
        // 按比例削弱而非禁用：滑块在天气模式仍有效，只是不再吃掉特效。
        // 浅色主题还要再削一档：它的压暗层是「白纱」，0.18 的白盖在晴空上会把
        // 蓝天洗成灰蓝，正是「看着像有雾霾遮住」的来源（晴天实测）。
        const scrimAlpha = currentMode === 'weather' ? scrimUser * (theme.dark ? 0.3 : 0.12) : scrimUser;
        scrim.style.background = mix(theme.base, scrimAlpha);

        setTokens('--dsh-wallpaper-surface', mix(theme.base, baseAlpha));
        setTokens('--dsw-alias-bg-base', 'var(--dsh-wallpaper-surface)');
        setTokens('--dsw-alias-bg-layer-1', mix(theme.layer1, surfaceAlpha + 0.08));
        setTokens('--dsw-alias-bg-layer-2', mix(theme.layer2, surfaceAlpha + 0.16));

        // Re-declare the palette inside any dialog/overlay subtree, so their
        // descendants resolve the opaque originals rather than the translucent
        // values set on `html`/`body`/`#root`.
        overlayRule.textContent =
          `[role="dialog"], [aria-modal="true"] {` +
          `--dsh-wallpaper-surface:${theme.base};` +
          `--dsw-alias-bg-base:${theme.base};` +
          `--dsw-alias-bg-layer-1:${theme.layer1};` +
          `--dsw-alias-bg-layer-2:${theme.layer2};` +
          `--dsw-alias-bg-overlay:${theme.layer1};` +
          `--dsw-alias-bg-layer-3:${theme.layer1};}` +
          `:is([role="dialog"], [aria-modal="true"]):not([data-dsh-wallpaper-dialog]) {` +
          `background-color:${theme.base} !important;}` +
          // 「换景」弹窗是壁纸体验的一部分：它的背板必须透出壁纸，否则整屏被
          // 刷成不透明的 theme.base（深色主题下就是全黑）。不透明强制只作用于
          // 宿主弹窗；令牌仍传进它的子树，卡片照常拿到不透明主题色。
          ``;
      };

      /** 引擎环境快照：昼夜与强度来自当前 look / 天气载荷，尺寸随画布元素。 */
    /**
     * 太阳状态（当地时间驱动）。
       *
       * 以日出/日落为锚把一天映射成 p∈[0,1]：0=日出（东，屏幕左侧），
       * 1=日落（西，屏幕右侧），0.5=正午。所有时间量（高度角、方位、暖色、
       * 日长）都从 p 推出，因此「早/中/晚」不是三个硬切档，而是连续插值，
       * 时段切换不会有跳变。
       *
       * 调试覆盖：`?solarHour=8` 或 localStorage `dsh.wallpaper.solarHour`
       * 可以把时间钉在某个整点，用于截图核对早/中/晚的光照。
       */
      const solarOverride = (() => {
        try {
          const fromQuery = new URLSearchParams(window.location.search).get('solarHour');
          if (fromQuery !== null && Number.isFinite(Number(fromQuery))) return Number(fromQuery);
        } catch {}
        try {
          const fromStore = window.localStorage.getItem('dsh.wallpaper.solarHour');
          if (fromStore !== null && Number.isFinite(Number(fromStore))) return Number(fromStore);
        } catch {}
        return null;
      })();

      const solarState = () => {
        const offsetSec =
          typeof weatherPayload?.utcOffset === 'number'
            ? weatherPayload.utcOffset
            : -new Date().getTimezoneOffset() * 60;
        // 当地「墙上时间」的毫秒数（用 UTC 字段承载，便于与 ISO 串直接相减）。
        const wall = Date.now() + offsetSec * 1000;
        const parseWall = (iso) => {
          if (typeof iso !== 'string') return null;
          const ms = Date.parse(`${iso}Z`);
          return Number.isFinite(ms) ? ms : null;
        };
        const midnight = (() => {
          const d = new Date(wall);
          d.setUTCHours(0, 0, 0, 0);
          return d.getTime();
        })();
        // 没有日出日落（定位/预报失败）时按 06:00–18:00 的常识值兜底。
        const sunrise = parseWall(weatherPayload?.sunrise) ?? midnight + 6 * 3600e3;
        const sunset = parseWall(weatherPayload?.sunset) ?? midnight + 18 * 3600e3;
        const dayMs = Math.max(3600e3, sunset - sunrise);

        let p;
        if (solarOverride !== null) {
          // 覆盖值按「当地整点」解释，再折算到同一条 p 轴。
          p = ((midnight + solarOverride * 3600e3) - sunrise) / dayMs;
        } else {
          p = (wall - sunrise) / dayMs;
        }

        // 高度角：正弦拱（日出/日落为 0，正午为 1）。
        const elevation = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
        // 日长系数：日出前/日落后 6% 的窗口内平滑收敛到 0。
        const daylight =
          Math.max(0, Math.min(1, (p + 0.06) / 0.16)) * Math.max(0, Math.min(1, (1.06 - p) / 0.16));
        // 暖色：越靠近日出/日落越强（1=最暖，0=正午中性）。日长归零时一并归零，
        // 否则夜间 p>1 会让 min(p,1-p) 变负、warmth 被放大成 2（21 点比黄昏还暖）。
        const warmthRaw = Math.max(0, Math.min(1, 1 - Math.min(p, 1 - p) / 0.32));
        const warmth = warmthRaw * Math.min(1, daylight * 1.6);
        // 方位：0=东（屏幕左），1=西（屏幕右）——东升西落。
        const azimuth = Math.max(0, Math.min(1, p));
        const phase = p < -0.06 ? 'night' : p < 0.16 ? 'dawn' : p < 0.44 ? 'morning' : p < 0.58 ? 'noon' : p < 0.86 ? 'afternoon' : p < 1.06 ? 'dusk' : 'night';
        return { p, elevation, daylight, warmth, azimuth, phase };
      };

      const weatherEnv = () => ({
        isDay: weatherPayload === null ? true : weatherPayload.isDay !== false,
        effectScale: typeof look.effectScale === 'number' && look.effectScale > 0 ? look.effectScale : 1,
        reducedMotion: prefersReducedMotion(),
        width: Math.max(1, canvas.clientWidth),
        height: Math.max(1, canvas.clientHeight),
        solar: solarState(),
      });

      /**
       * 动态演化的导演：规则约束的马尔可夫链。
       *
       * 只在预览选「动态演化」且处于天气模式时运行；每次到达停留时长后按
       * DIRECTOR_RULES 的权重抽下一个 kind，因此序列既不是固定循环，也不会
       * 出现「晴 → 暴雪」这种物理上不可能的跃迁。
       */
      let directorKind = null;
      let directorUntil = 0;
      const directorActive = () => previewStore.get() === 'evolve' && currentMode === 'weather';

      /** 停留时长：均值 × (0.5 + rand)，避免每次长度都一样。 */
      const dwellMs = (next) => (DIRECTOR_DWELL_SEC[next] ?? 70) * 1000 * (0.5 + Math.random());

      /** 推进导演；返回是否发生了 kind 变化。 */
      const advanceDirector = (now) => {
        if (!directorActive()) {
          directorKind = null;
          directorUntil = 0;
          return false;
        }
        if (directorKind === null) {
          directorKind = 'cloudy';
          directorUntil = now + dwellMs(directorKind);
          return true;
        }
        if (now < directorUntil) return false;
        const options = DIRECTOR_RULES[directorKind] ?? DIRECTOR_RULES.cloudy;
        let roll = Math.random();
        let next = options[0][0];
        for (const [candidate, weight] of options) {
          if (roll < weight) {
            next = candidate;
            break;
          }
          roll -= weight;
        }
        directorKind = next;
        directorUntil = now + dwellMs(next);
        return true;
      };

      /**
       * 把渲染侧诊断快照写进容器 dataset（devtools 与设置页调试行都读它）。
       *
       * 调用点必须在「会改动引擎状态的调用」之后：stop()/setWeather() 都会改内部
       * state，先取快照会把切换前的状态留在 dataset 上（system 模式仍显示 running）。
       */
      const publishStats = (kindLabel) => {
        const stats = engine.stats();
        container.dataset.kind = kindLabel;
        container.dataset.ctx = stats.ctx ? 'ok' : 'null';
        container.dataset.size = `${stats.width}x${stats.height}`;
        container.dataset.state = stats.state;
        container.dataset.snow = String(stats.snow);
        container.dataset.splash = String(stats.splash);
      };

      /**
       * 把当前模式 / 天气 / 外观同步给引擎。
       *
       * kind 未变时引擎只替换环境快照、不重建粒子（PRD P0-4 ②）；system 模式直接
       * 停掉循环并保留最后一帧，切回来时由新 rev 触发 img 淡入。instant 为手动
       * 切换（预览下拉）：清空地面积累、立即换场，不做交叉过渡。
       */
      const syncEngine = (instant = false) => {
        if (currentMode !== 'weather') {
          engine.stop();
          // stop() 之后才取快照：dataset 必须跟着说「停了」，否则 devtools 与
          // 调试行在 system 模式下会一直显示 running（P2）。
          publishStats('');
          return;
        }
        // 预览覆盖优先：动态演化由导演决定，指定 kind 则强制渲染该效果；
        // 都没选时跟随真实天气，载荷缺失/非法则占位 cloudy。
        const preview = previewStore.get();
        let kind;
        if (preview === 'evolve') {
          if (directorKind === null) advanceDirector(performance.now());
          kind = directorKind ?? 'cloudy';
        } else if (preview !== null && KIND_PRESETS[preview]) {
          kind = preview;
        } else {
          kind = weatherPayload !== null && KIND_PRESETS[weatherPayload.kind] ? weatherPayload.kind : 'cloudy';
        }
        engine.setWeather(kind, weatherEnv(), instant);
        publishStats(kind);
      };

      /**
       * 模式真正切换时的一切副作用：图层互斥、引擎起停、上报 Host。
       *
       * 上报放在这里而不是 setMode 里：config 默认模式与 localStorage 不一致时
       * （例如配置默认 weather、用户没选过），poll 也会走到这条路径——只挂在
       * setMode 上会让这种「被动切换」漏报，Host 继续白抓帧。start 时的首次
       * 调用同时承担插件重载后的重同步（降级矩阵第 10 条）。
       */
      const renderMode = (mode) => {
        currentMode = mode;
        // 当前模式暴露到容器 dataset：devtools 里可直接检查背景层状态，
        // 排查「点了卡片没反应」时不必先翻状态机。
        container.dataset.mode = mode;
        applyLook();
        syncEngine();
        void reportMode(mode);
      };

      const commit = (rev, url) => {
        const back = front === 'a' ? 'b' : 'a';
        const previous = images[front].dataset.objectUrl;
        images[back].src = url;
        images[back].dataset.objectUrl = url;
        front = back;
        revision = rev;
        applyLook();
        if (previous) {
          window.setTimeout(() => {
            if (!disposed) URL.revokeObjectURL(previous);
          }, FADE_MS + 300);
        }
      };

      const load = async (frameUrl, rev) => {
        const res = await fetch(`${frameUrl}?rev=${encodeURIComponent(rev)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const objectUrl = URL.createObjectURL(await res.blob());
        const probe = new Image();
        probe.src = objectUrl;
        try {
          await probe.decode();
        } catch {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (disposed) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        commit(rev, objectUrl);
      };

      const poll = async () => {
        let data = null;
        try {
          const res = await fetch('/api/dsh-wallpaper/discover', { cache: 'no-store' });
          if (res.ok) data = await res.json();
        } catch {}
        const discovered = data !== null && typeof data === 'object';

        // ── 跨实例同步桥：不依赖 discover 成败 ────────────────────────────
        // 设置页（ctx.slots.inject 'settings.section'）与背景层（ctx.effect）
        // 可能作为两个模块实例加载（分属不同浏览上下文，或模块被加载两份），
        // modeStore 的 publish 不跨实例；用户点击后若这一轮 discover 恰好
        // 失败，下面这次 readMode 同步就是背景层切换的唯一通路，因此不能
        // 藏在 res.ok 里。读不到用户选择（localStorage 无覆盖）时不动
        // modeStore：否则一次 discover 抖动就会把 config 默认模式打回
        // system，让背景无故闪回桌面壁纸。
        const storedMode = readMode();
        if (storedMode !== null && storedMode !== modeStore.get()) modeStore.publish(storedMode);
        // 预览同理由 poll 兜底同步：同文档双实例里 storage 事件不会触发，
        // 没有这条兜底就要等一次页面重载才能看到手动选择。
        const storedPreview = readPreview();
        if (storedPreview !== previewStore.get()) previewStore.apply(storedPreview);

        if (discovered) {
          hostLook = {
            opacity: typeof data.opacity === 'number' ? data.opacity : hostLook.opacity,
            blurPx: typeof data.blurPx === 'number' ? data.blurPx : hostLook.blurPx,
            scrim: typeof data.scrim === 'number' ? data.scrim : hostLook.scrim,
            saturate: typeof data.saturate === 'number' ? data.saturate : hostLook.saturate,
            surface: typeof data.surface === 'number' ? data.surface : hostLook.surface,
          };
        }
        // look 的 localStorage 覆盖同样可能来自另一个实例的滑块：每轮重读
        // 合并，discover 失败时也不断链（同文档写入不触发 storage 事件，
        // 见模块级 storage 监听与焦点桥的注释）。
        look = merged(hostLook);
        applyLook();

        if (discovered) {
          // 模式解析与 look 同构：localStorage 覆盖 ?? config 默认 ?? system。
          // 只有解析结果变化才 publish，避免用户刚选完就被 config 默认值顶掉。
          const resolved =
            readMode() ?? (data.mode === 'weather' || data.mode === 'system' ? data.mode : null) ?? 'system';
          if (resolved !== modeStore.get()) modeStore.publish(resolved);
          const weather = data.weather !== null && typeof data.weather === 'object' ? data.weather : null;
          weatherPayload = weather;
          weatherStore.publish(weather);
          applyLook();
          syncEngine();
          // 天气模式下 Host 不再给 frame；即使拿到旧帧也不加载，避免闪回系统壁纸。
          if (currentMode !== 'weather' && data.frame && data.rev && data.rev !== revision) {
            await load(data.frame, data.rev);
          frameTimeStore.touch();
          }
        }
        if (!disposed) timer = window.setTimeout(poll, POLL_MS);
      };

      const onLookChange = () => {
        look = merged(hostLook);
        applyLook();
        syncEngine();
      };
      window.addEventListener(CHANGE_EVENT, onLookChange);

      // 视口变化时画布按新尺寸重建粒子；引擎内部把 devicePixelRatio 收到 2 以下。
      const onResize = () => {
        engine.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
      };
      window.addEventListener('resize', onResize);

      // 焦点/可见性桥：storage 事件只覆盖跨文档写入；同文档双实例（设置页与
      // 背景层在同一文档各加载一份）里写入不触发 storage，用户切回窗口时
      // 重读 mode 兜底——与 poll 的 readMode 同步互为冗余，任一桥都在
      // POLL_MS 内生效。
      const onVisibleSync = () => {
        const storedMode = readMode();
        if (storedMode !== null && storedMode !== modeStore.get()) modeStore.publish(storedMode);
        const storedPreview = readPreview();
        if (storedPreview !== previewStore.get()) previewStore.apply(storedPreview);
      };
      window.addEventListener('focus', onVisibleSync);
      document.addEventListener('visibilitychange', onVisibleSync);

      unsubscribeMode = modeStore.subscribe(() => {
        const mode = modeStore.get();
        if (mode !== currentMode) renderMode(mode);
      });

      // 预览切换立即重绘：手动选一种效果就马上换场（instant：清空旧积累）。
      const unsubscribePreview = previewStore.subscribe(() => syncEngine(true));

      // 动态演化的时钟：每秒检查一次是否到达停留时长，到点抽下一个 kind。
      // 1s 粒度足够（停留时长以几十秒计），不会给主线程添负担。
      const directorTimer = window.setInterval(() => {
        if (advanceDirector(performance.now())) syncEngine(false);
      }, 1000);

      // A light/dark switch swaps the theme palette; re-apply so the scrim and
      // panel tints use the new colours instead of the previous theme's.
      const themeObserver = new MutationObserver(() => applyLook());
      for (const target of [root, doc.body, doc.getElementById('root')]) {
        if (target) {
          // Only the theme marker: watching `style` would retrigger this
          // observer from applyLook's own token writes.
          themeObserver.observe(target, {
            attributes: true,
            attributeFilter: ['data-ds-dark-theme', 'class'],
          });
        }
      }

      applyLook();
      // 先定尺寸再渲染：画布带着模糊 overscan，引擎按元素实际大小铺满。
      engine.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
      // renderMode 内部会上报当前模式：插件重载后 Host 的 clientMode 复位为
      // system，这一次上报让抓帧暂停状态与界面重新保持一致。
      renderMode(modeStore.get());

      poll();

      return () => {
        disposed = true;
        window.removeEventListener(CHANGE_EVENT, onLookChange);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('focus', onVisibleSync);
        document.removeEventListener('visibilitychange', onVisibleSync);
        if (unsubscribeMode) unsubscribeMode();
        unsubscribePreview();
        window.clearInterval(directorTimer);
        themeObserver.disconnect();
        engine.dispose();
        if (timer) window.clearTimeout(timer);
        for (const key of ['a', 'b']) {
          const url = images[key].dataset.objectUrl;
          if (url) URL.revokeObjectURL(url);
        }
        container.remove();
        overlayRule.remove();
        for (const name of [
          '--dsh-wallpaper-surface',
          '--dsw-alias-bg-base',
          '--dsw-alias-bg-layer-1',
          '--dsw-alias-bg-layer-2',
        ]) {
          clearTokens(name);
        }
        if (previousSurface !== '') root.style.setProperty('--dsh-wallpaper-surface', previousSurface);
      };
    }

    // ── weather mode: particle engine ────────────────────────────────────────

    /**
     * 每种 kind 一条粒子预设，键集合与 src/weather.js 的 WEATHER_KINDS 一一
     * 对应（新增 kind 必须同时改两处与两个 locale 文件）。
     *
     * count 是 1920×1080 基准粒子数，实际数量再按视口面积与 effectScale 缩放并
     * 封顶 280；speed 是 60fps 基准的 px/帧。backdrop 是画布竖向渐变——天气模式
     * 下 img 图层已隐藏，画布必须自己铺满背景，取该 kind 色调的同族深色；
     * reduced-motion 的静态渐变直接用同一组值。
     */
    const KIND_PRESETS = {
      clear: {
        // 晴天的粒子是「阳光里的浮尘」：近白的暖色、极小、几乎只在近景闪一下。
        // 原来的琥珀色大颗光点读起来像萤火虫/霾里的颗粒，是「晴天看着像雾霾」的
        // 主要来源之一，所以尺寸与不透明度都压到原来的三分之一量级。
        shape: 'dot',
        motion: 'rise',
        count: 34,
        speed: 0.4,
        size: [0.7, 1.6],
        tint: ['#fff6e2', '#dbe6f5'],
        alpha: 0.3,
        backdrop: { day: ['#2f66a8', '#a9c9e2'], night: ['#1c1a12', '#14120d'] },
        // 显式地面色：晴天从亮蓝天空推出来的「同族深色」是灰蓝，像水面。
        ground: { day: '#3a3228', night: '#161310' },
        fx: { twinkle: true },
      },
      cloudy: {
        shape: 'blob',
        motion: 'drift',
        count: 5,
        speed: 0.25,
        size: [180, 320],
        tint: ['#8b95a3', '#4a525f'],
        alpha: 0.3,
        backdrop: { day: ['#454e5c', '#343c48'], night: ['#252c38', '#1a2028'] },
        fx: {},
      },
      drizzle: {
        shape: 'line',
        motion: 'fall',
        count: 150,
        speed: 5,
        size: [8, 14],
        width: 1,
        tint: ['#a9bdd6', '#7d8ea6'],
        alpha: 0.6,
        backdrop: { day: ['#3e4959', '#2e3745'], night: ['#222a36', '#171d26'] },
        fx: { slant: [8, 12] },
      },
      rain: {
        shape: 'line',
        motion: 'fall',
        count: 280,
        speed: 8,
        size: [12, 20],
        width: 1.2,
        tint: ['#c2d3ea', '#93a5bd'],
        alpha: 0.6,
        backdrop: { day: ['#3a4657', '#2c3543'], night: ['#222b37', '#171e28'] },
        fx: { slant: [12, 18] },
      },
      heavyRain: {
        shape: 'line',
        motion: 'fall',
        count: 520,
        speed: 14,
        size: [22, 34],
        width: 1.6,
        tint: ['#d8e6f7', '#aabdd6'],
        alpha: 0.62,
        backdrop: { day: ['#313b4a', '#232c38'], night: ['#1b2430', '#131922'] },
        fx: { slant: [20, 30], splash: true },
      },
      wind: {
        shape: 'line',
        motion: 'fly',
        count: 70,
        speed: 16,
        size: [30, 60],
        width: 1,
        tint: ['#5f6b63', '#39423d'],
        alpha: 0.4,
        backdrop: { day: ['#2f3530', '#252b27'], night: ['#1a201d', '#131714'] },
        fx: { gust: true, lift: [15, 25] },
      },
      snow: {
        shape: 'dot',
        motion: 'sway',
        count: 520,
        speed: 1.8,
        size: [1.2, 4],
        tint: ['#ffffff', '#d3e0ef'],
        alpha: 0.9,
        backdrop: { day: ['#4e5a68', '#3a4453'], night: ['#2c3644', '#1f2833'] },
        fx: { sway: 14 },
      },
      fog: {
        // 雾：冷白的大团雾堤，呼吸起伏、层次分明——「看得见水汽」。
        shape: 'blob',
        motion: 'drift',
        count: 15,
        speed: 0.16,
        size: [140, 300],
        tint: ['#c3ceda', '#7d8b9a'],
        alpha: 0.3,
        // 雾的天空是冷灰蓝：霾保持暖褐，两者在色调上就已经分开了。
        backdrop: { day: ['#4a5058', '#383e46'], night: ['#252a30', '#1b1f24'] },
        fx: { breathe: true },
      },
      haze: {
        // 霾的辨识点是「颗粒感」：细小的暖色浮尘缓慢横漂，而不是大团雾。
        shape: 'dot',
        motion: 'fly',
        count: 320,
        speed: 2.6,
        size: [0.5, 1.5],
        tint: ['#d9c69c', '#8a7752'],
        alpha: 0.4,
        backdrop: { day: ['#3b372e', '#2d2922'], night: ['#201e18', '#171511'] },
        fx: { desaturate: true },
      },
      thunderstorm: {
        shape: 'line',
        motion: 'fall',
        count: 560,
        speed: 13,
        size: [22, 34],
        width: 2,
        tint: ['#3a3d52', '#232535'],
        alpha: 0.55,
        backdrop: { day: ['#24263a', '#1a1c28'], night: ['#15161f', '#0f1016'] },
        fx: { slant: [25, 25], lightning: true },
      },
      hail: {
        shape: 'dot',
        motion: 'fall',
        count: 100,
        speed: 10,
        size: [2.6, 4.6],
        // 冰不是灰石子：偏冷的亮白，落地才有「冰粒」的硬质感。
        tint: ['#dce9f7', '#9db4cc'],
        alpha: 0.85,
        backdrop: { day: ['#343b45', '#272e37'], night: ['#1d222a', '#151920'] },
        fx: { bounce: true },
      },
      dust: {
        shape: 'dot',
        motion: 'fly',
        count: 110,
        speed: 9,
        size: [1, 2.5],
        tint: ['#a0805a', '#5c4a38'],
        alpha: 0.5,
        backdrop: { day: ['#3e3526', '#2f281b'], night: ['#221d14', '#181510'] },
        fx: { gust: true, wash: 'rgba(160, 128, 90, 0.055)' },
      },
    };

    /** 过渡期旧粒子的淡出时长；新粒子同帧长淡入，合计 800ms 交叉过渡。 */
    const ENGINE_DYING_MS = 400;
    /** kind 切换的过渡总时长（设计 §3.7 / PRD P2-3）。 */
    const ENGINE_TRANSITION_MS = 800;
    /** dt 截断：切标签回来不跳帧（设计 §3.7）。 */
    const ENGINE_DT_CAP_MS = 50;
    /** 粒子上限：1080p 满配也是 Canvas 2D 可承受的量级。 */
    const ENGINE_MAX_PARTICLES = 280;
    /** count 的基准视口面积。 */
    const ENGINE_BASE_AREA = 1920 * 1080;
    /** 出屏回收的外边距，避免粒子在边缘突然消失。 */
    const ENGINE_MARGIN = 60;

    // ── 伪 3D 地面 ────────────────────────────────────────────────────────────
    /** 屏幕底部 1/5 是透视地面区：粒子按深度落在不同远近，雪按透视堆积。 */
    const GROUND_RATIO = 0.2;
    /** 地面网格：横向列 × 纵深行（世界格，渲染时投影到屏幕）。 */
    const GROUND_COLS = 64;
    const GROUND_ROWS = 9;
    /** 单格积雪高度上限（屏幕像素），防止长时间运行堆满画面。 */
    const SNOW_MAX_PX = 26;
    /** 溅射液滴池上限：暴雨下落点密集，封顶防止内存与绘制开销失控。 */
    const SPLASH_MAX = 160;

    /**
     * 每种 kind 的地面物理参数。
     *
     * deposit 为单次落点沉积量（雪/冰雹堆高），splash 为落点溅射液滴数，
     * splashSize 为液滴尺寸系数，wet 为湿润度增量（雨），melt 为积雪融化速率
     * （px/s）。与 KIND_PRESETS 分离：视觉参数和物理参数各自演进，互不牵制。
     */
    const KIND_PHYSICS = {
      clear: { deposit: 0, splash: 0, splashSize: 0, wet: 0, melt: 1.2 },
      cloudy: { deposit: 0, splash: 0, splashSize: 0, wet: 0, melt: 0.45 },
      drizzle: { deposit: 0, splash: 2, splashSize: 0.95, wet: 0.45, melt: 1.6 },
      rain: { deposit: 0, splash: 3, splashSize: 1.3, wet: 0.55, melt: 2.2 },
      heavyRain: { deposit: 0, splash: 4, splashSize: 1.7, wet: 0.7, melt: 2.6 },
      thunderstorm: { deposit: 0, splash: 4, splashSize: 1.7, wet: 0.75, melt: 2.6 },
      hail: { deposit: 3, splash: 2, splashSize: 0.85, wet: 0.2, melt: 3.5 },
      snow: { deposit: 16, splash: 0, splashSize: 0, wet: 0, melt: 0.3 },
      fog: { deposit: 0, splash: 0, splashSize: 0, wet: 0.01, melt: 0.25 },
      haze: { deposit: 0, splash: 0, splashSize: 0, wet: 0, melt: 0.3 },
      wind: { deposit: 0, splash: 0, splashSize: 0, wet: 0, melt: 0.5 },
      dust: { deposit: 1.5, splash: 0, splashSize: 0, wet: 0, melt: 0.2 },
    };

    /**
     * 动态演化的马尔可夫跃迁表：规则约束的邻居集合 + 权重。
     *
     * 只允许物理上合理的相邻跃迁（晴不能直接到暴雪/雷暴，雨族只能逐档升降），
     * 因此随机采样出来的序列不会出现「固定顺序循环」，也不会出现天气瞬移。
     */
    const DIRECTOR_RULES = {
      clear: [['cloudy', 0.58], ['wind', 0.14], ['haze', 0.12], ['dust', 0.1], ['fog', 0.06]],
      cloudy: [['clear', 0.3], ['drizzle', 0.24], ['fog', 0.14], ['wind', 0.12], ['snow', 0.12], ['haze', 0.08]],
      drizzle: [['rain', 0.5], ['cloudy', 0.34], ['fog', 0.16]],
      rain: [['heavyRain', 0.4], ['drizzle', 0.3], ['cloudy', 0.3]],
      heavyRain: [['thunderstorm', 0.35], ['rain', 0.45], ['cloudy', 0.2]],
      thunderstorm: [['heavyRain', 0.55], ['rain', 0.3], ['cloudy', 0.15]],
      snow: [['cloudy', 0.55], ['snow', 0.45]],
      fog: [['cloudy', 0.55], ['clear', 0.3], ['haze', 0.15]],
      haze: [['clear', 0.45], ['cloudy', 0.55]],
      wind: [['clear', 0.45], ['cloudy', 0.4], ['dust', 0.15]],
      hail: [['snow', 0.45], ['thunderstorm', 0.35], ['cloudy', 0.2]],
      dust: [['clear', 0.5], ['wind', 0.5]],
    };

    /** 动态演化的平均停留时长（秒）：演示节奏，能在一两分钟内看到变化。 */
    const DIRECTOR_DWELL_SEC = {
      clear: 95,
      cloudy: 75,
      drizzle: 60,
      rain: 70,
      heavyRain: 55,
      thunderstorm: 42,
      snow: 85,
      fog: 65,
      haze: 75,
      wind: 50,
      hail: 35,
      dust: 55,
    };

    /** hex 色到 rgb 三元组的小缓存，避免每帧重复解析。 */
    const rgbCache = new Map();
    const toRgb = (hex) => {
      const cached = rgbCache.get(hex);
      if (cached !== undefined) return cached;
      const match = /^#([0-9a-f]{6})$/i.exec(hex);
      const value = match ? Number.parseInt(match[1], 16) : 0;
      const rgb = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
      rgbCache.set(hex, rgb);
      return rgb;
    };

    const rgba = (rgb, alpha) =>
      `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;

    /** 低饱和混合：把颜色拉向自身亮度（雾霾的「发闷」感）。 */
    const desaturate = (rgb) => {
      const luma = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
      return [rgb[0] * 0.35 + luma * 0.65, rgb[1] * 0.35 + luma * 0.65, rgb[2] * 0.35 + luma * 0.65];
    };

    /**
     * 天气粒子引擎（Canvas 2D，零依赖）。
     *
     * 状态机（设计 §4.5）：idle（无动画）→ running（rAF 循环）→ transition
     * （kind 交叉过渡）→ running。粒子在 CSS 像素坐标系里运动，画布 resize 时
     * 整体重建；页面隐藏时停掉 rAF 省电，回来后续跑（dt 已截断，不会跳帧）。
     *
     * @param canvas 背景层创建的全屏画布元素。
     */
    const createWeatherEngine = (canvas) => {
      const context = canvas.getContext('2d');
      /** 引擎状态：idle / running / transition。 */
      let state = 'idle';
      let kind = null;
      let preset = null;
      let env = { isDay: true, effectScale: 1, reducedMotion: false, width: 0, height: 0 };
      let particles = [];
      let ripples = [];
      /** 溅射液滴池：落点向斜上方抛出的小水珠，重力回落。 */
      let splashes = [];
      /**
       * 地面状态（世界网格，渲染时投影）：
       * snow 积雪高度、wet 湿润度。跨 kind 切换保留，靠融化慢慢消退——
       * 这是「雨雪随时间在地面形成可见堆积」的核心状态。
       */
      let ground = { snow: new Float32Array(0), wet: new Float32Array(0) };
      /** 雷电活动包络（非齐次泊松的时变强度）：慢变双正弦 + 随机游走。 */
      let activity = 0.45;
      let frameHandle = 0;
      let lastFrameAt = 0;
      /** 后台恢复后第一帧 dt 强制 0（与 WebGL 引擎同语义，防跳帧）。 */
      let skipDtOnce = false;
      let transitionStart = 0;
      /** 雷暴闪电：一次雷击的形状只生成一次，避免高频频闪（PRD P1-3 ③）。 */
      let strike = null;
      /** 暴雨的偶发亮度脉冲。 */
      let flashPulse = null;

      const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

      /** 目标粒子数：基准值 × 面积比 × 强度，封顶 280。 */
      const targetCount = () => {
        if (preset === null) return 0;
        const scaled = Math.round(preset.count * ((env.width * env.height) / ENGINE_BASE_AREA) * env.effectScale);
        return Math.max(1, Math.min(ENGINE_MAX_PARTICLES, scaled));
      };

      const applySize = (width, height) => {
        if (context === null) return;
        // 高分屏按 dpr 扩 backing store，但绘制坐标系保持 CSS 像素；dpr 收到 2
        // 以上收益锐减、开销翻倍，不值得。
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      // ── 伪 3D 地面：投影、沉积、渲染 ─────────────────────────────────────────

      /** 地平线：地面区从这条线开始向下铺开。 */
      const horizonY = () => env.height * (1 - GROUND_RATIO);
      /** 深度 d∈(0,1] → 屏幕 y（d 越大越近）。 */
      const depthToY = (d) => horizonY() + (env.height - horizonY()) * d;
      /** 近大远小：d 处的缩放系数。 */
      const depthScale = (d) => 0.35 + 0.65 * d;
      /** 世界横坐标 worldX∈[-1,1] → 屏幕 x（带透视缩放）。 */
      const projectX = (worldX, d) => env.width / 2 + worldX * (env.width / 2) * depthScale(d);

      /** 首次分配地面网格；视口变化时网格保留，积累不因 resize 丢失。 */
      const ensureGround = () => {
        const cells = GROUND_COLS * GROUND_ROWS;
        if (ground.snow.length !== cells) {
          ground = { snow: new Float32Array(cells), wet: new Float32Array(cells) };
          splashes = [];
        }
      };

      /** 清空地面状态：手动切换天气时让场景立即从零开始。 */
      const resetGround = () => {
        ground.snow.fill(0);
        ground.wet.fill(0);
        splashes = [];
        ripples = [];
      };

      /** 落点沉积：雪/冰雹堆高并在离屏图层盖一个柔边雪印，雨只记湿润度。 */
      const deposit = (particle, physics) => {
        const col = Math.min(GROUND_COLS - 1, Math.max(0, Math.floor(((particle.worldX + 1) / 2) * GROUND_COLS)));
        const row = Math.min(GROUND_ROWS - 1, Math.max(0, Math.floor(particle.d * GROUND_ROWS)));
        const index = row * GROUND_COLS + col;
        if (physics.deposit > 0) {
          // 近处颗粒贡献略大：视觉上近处的堆积更实。
          const gain = physics.deposit * (0.6 + 0.5 * particle.d) * (0.75 + Math.random() * 0.5);
          ground.snow[index] = Math.min(SNOW_MAX_PX, ground.snow[index] + gain);
        }
        if (physics.wet > 0) ground.wet[index] = Math.min(1, ground.wet[index] + physics.wet);
      };

      /** 休止角松弛：相邻格高差超过阈值时横向摊一点，避免出现针状尖刺。 */
      const relaxGround = () => {
        const snow = ground.snow;
        for (let row = 0; row < GROUND_ROWS; row += 1) {
          const base = row * GROUND_COLS;
          for (let col = 0; col < GROUND_COLS - 1; col += 1) {
            const left = base + col;
            const right = left + 1;
            const diff = snow[left] - snow[right];
            if (diff > 1.6) {
              const move = diff * 0.16;
              snow[left] -= move;
              snow[right] += move;
            } else if (diff < -1.6) {
              const move = -diff * 0.16;
              snow[left] += move;
              snow[right] -= move;
            }
          }
        }
      };

      /** 落点溅射：大小与初速由冲击速度和雨点尺寸决定（lite-rain 的 splash 变形）。 */
      const spawnSplash = (particle, physics) => {
        if (splashes.length >= SPLASH_MAX) return;
        const scale = depthScale(particle.d);
        const impact = Math.abs(particle.vy);
        // 半径 = 深度 × (1.2 + 冲击速度/2000) × 雨点尺寸系数。
        const base = scale * (1.2 + impact / 2000) * (0.7 + particle.size / 40) * physics.splashSize;
        for (let index = 0; index < physics.splash; index += 1) {
          splashes.push({
            x: particle.x + (Math.random() - 0.5) * 6 * scale,
            y: particle.landY - 1,
            vx: (Math.random() - 0.5) * 110 * scale,
            vy: -impact * (0.12 + Math.random() * 0.1),
            r: base * (0.7 + Math.random() * 0.6),
            life: 0,
            ttl: 140 + Math.random() * 160,
            d: particle.d,
          });
        }
      };

      /**
       * 柔边光点精灵（按颜色缓存）。
       *
       * 雪片/光尘必须用径向渐变画：硬边圆点在粒子尺寸下就是「噪点」，
       * 成熟实现（CSDN/Cesium/react-cinematic-snow）都走柔边路线。预渲染成
       * sprite 后每帧只做 drawImage，比逐粒子 createRadialGradient 便宜一个量级。
       */
      const spriteCache = new Map();
      const glowSprite = (hex) => {
        const cached = spriteCache.get(hex);
        if (cached !== undefined) return cached;
        const size = 64;
        const sprite = document.createElement('canvas');
        sprite.width = size;
        sprite.height = size;
        const sctx = sprite.getContext('2d');
        const gradient = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        // 紧一点的衰减：中心实、边缘快速消失。太长的尾巴会让雪花变成「光斑」。
        gradient.addColorStop(0, `${hex}ff`);
        gradient.addColorStop(0.32, `${hex}d9`);
        gradient.addColorStop(0.62, `${hex}59`);
        gradient.addColorStop(1, `${hex}00`);
        sctx.fillStyle = gradient;
        sctx.fillRect(0, 0, size, size);
        spriteCache.set(hex, sprite);
        return sprite;
      };

      /** rgb 三元组 → #rrggbb（精灵缓存键）。 */
      const rgbHex = (rgb) =>
        `#${((1 << 24) + (Math.round(rgb[0]) << 16) + (Math.round(rgb[1]) << 8) + Math.round(rgb[2]))
          .toString(16)
          .slice(1)}`;

      /**
       * 积雪渲染：沿屏幕底边画一条连续的「雪岸」轮廓。
       *
       * 高度来自地面网格（近排为主、中排补一点），顶边按列插值成平滑折线，
       * 填充竖向白色渐变（顶部亮白、底部略灰）。这比逐行带或离散印章都更
       * 接近真实积雪：一片连续的白色覆盖，边缘有起伏，没有一条条硬带。
       */
      const drawAccum = () => {
        const cols = GROUND_COLS;
        const rows = GROUND_ROWS;
        const snow = ground.snow;
        const nearRow = (rows - 1) * cols;
        const midRow = (rows - 2) * cols;
        const h = env.height;
        let any = false;
        for (let col = 0; col < cols; col += 1) {
          if (snow[nearRow + col] > 0.2 || snow[midRow + col] > 0.4) {
            any = true;
            break;
          }
        }
        if (!any) return;

        const heightAt = (col) => {
          const idx = Math.min(cols - 1, Math.max(0, col));
          return Math.min(SNOW_MAX_PX * 1.5, Math.max(snow[nearRow + idx], snow[midRow + idx] * 0.72));
        };

        context.beginPath();
        context.moveTo(0, h);
        for (let col = 0; col <= cols; col += 1) {
          const x = (col / cols) * env.width;
          context.lineTo(x, h - heightAt(col));
        }
        context.lineTo(env.width, h);
        context.closePath();
        const top = h - SNOW_MAX_PX * 1.5;
        const gradient = context.createLinearGradient(0, top, 0, h);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.94)');
        gradient.addColorStop(0.45, 'rgba(242, 248, 255, 0.86)');
        gradient.addColorStop(1, 'rgba(205, 218, 235, 0.92)');
        context.fillStyle = gradient;
        context.fill();

        // 远排积雪：地平线附近一条极淡的雪线，提示远处也被覆盖。
        let farTotal = 0;
        for (let col = 0; col < cols; col += 1) farTotal += snow[col];
        if (farTotal > 1) {
          const hz = horizonY();
          context.fillStyle = `rgba(240, 246, 255, ${Math.min(0.3, farTotal / 400).toFixed(3)})`;
          context.fillRect(0, hz, env.width, 1.5);
        }
      };

      /** 雨后的地面湿痕：底部一条由浅入深的暗带 + 一线反光。 */
      const drawWet = (tint) => {
        let total = 0;
        for (let index = 0; index < ground.wet.length; index += 1) total += ground.wet[index];
        const strength = Math.min(1, (total / (GROUND_COLS * GROUND_ROWS)) * 2.2);
        if (strength <= 0.03) return;
        const hz = horizonY();
        const wetGradient = context.createLinearGradient(0, hz, 0, env.height);
        wetGradient.addColorStop(0, rgba(tint, 0));
        wetGradient.addColorStop(0.55, rgba(tint, 0.1 * strength));
        wetGradient.addColorStop(1, rgba(tint, 0.22 * strength));
        context.fillStyle = wetGradient;
        context.fillRect(0, hz, env.width, env.height - hz);
        context.fillStyle = `rgba(226, 236, 250, ${(0.05 * strength).toFixed(3)})`;
        context.fillRect(0, env.height - 2, env.width, 1.5);
      };

      /** 地平线雾带 + 地面空气透视：给地面一条可读的纵深起点。 */
      const drawHorizonHaze = () => {
        const hz = horizonY();
        const band = context.createLinearGradient(0, hz - 16, 0, hz + 26);
        band.addColorStop(0, 'rgba(255, 255, 255, 0)');
        band.addColorStop(0.5, 'rgba(226, 234, 246, 0.08)');
        band.addColorStop(1, 'rgba(255, 255, 255, 0)');
        context.fillStyle = band;
        context.fillRect(0, hz - 16, env.width, 42);
        // 地面从地平线向下略微压暗，远处更闷、近处更亮，形成空气透视。
        const floor = context.createLinearGradient(0, hz, 0, env.height);
        floor.addColorStop(0, 'rgba(0, 0, 0, 0.12)');
        floor.addColorStop(0.55, 'rgba(0, 0, 0, 0.03)');
        floor.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = floor;
        context.fillRect(0, hz, env.width, env.height - hz);
      };

      /** 按当前预设把一个粒子放到随机初始状态；运动参数当场烘焙，过渡期旧粒子靠它保持原样。 */
      const spawnParticle = (fadeIn) => {
        // 每个落下的粒子带一个「深度」：决定它落在透视地面哪一档、近大远小的尺寸。
        // 横坐标先取世界坐标再投影，保证同一深度的粒子间距符合透视收敛。
        const d = 0.12 + Math.random() * 0.88;
        const worldX = Math.random() * 2 - 1;
        const particle = {
          x: projectX(worldX, d),
          y: Math.random() * depthToY(d),
          d,
          worldX,
          landY: depthToY(d),
          vx: 0,
          vy: 0,
          size: 0,
          lineWidth: preset.width ?? 1,
          alpha: preset.alpha,
          phase: Math.random() * Math.PI * 2,
          age: 0,
          dying: false,
          dieAt: 0,
          fadeIn,
          bounced: false,
          baseX: 0,
          swayAmp: 0,
          swayFreq: 0,
          dirX: 0,
          dirY: 1,
          motion: preset.motion,
          bounce: preset.fx.bounce === true,
          splash: preset.fx.splash === true,
          // 形状与各项 fx 标志同样当场烘焙：kind 切换的 400ms 过渡期里，旧粒子
          // 必须按自己 kind 的方式绘制（暴雨的雨丝不会变成雪花的圆点），否则
          // 强对比切换（如暴雨 → 小雪）会出现约 400ms 的形状失真。
          shape: preset.shape,
          breathe: preset.fx.breathe === true,
          twinkle: preset.fx.twinkle === true,
          desaturate: preset.fx.desaturate === true,
          gust: preset.fx.gust === true,
        };
        const [minSize, maxSize] = preset.size;
        particle.size = minSize + Math.random() * (maxSize - minSize);
        const speed = preset.speed;
        switch (preset.motion) {
          case 'fall': {
            // 物理量换成 px/s：重力持续加速到终端速度（lite-rain 的做法）。
            // 预设的 speed 是 60fps 基准的 px/帧，×60 得到观测单位下的终端速度。
            const slant = preset.fx.slant;
            const angle = slant
              ? ((slant[0] + Math.random() * (slant[1] - slant[0])) * Math.PI) / 180
              : 0;
            particle.terminal = preset.terminal ?? speed * 60;
            particle.gravity = preset.gravity ?? particle.terminal * 1.9;
            // 从 3 成速度起步：入画即有速度，又保留可见的加速段。
            particle.vy = particle.terminal * (0.3 + Math.random() * 0.22);
            particle.vx = particle.terminal * Math.tan(angle) * (0.6 + Math.random() * 0.8);
            break;
          }
          case 'fly': {
            // 狂风/沙尘横飞并微微上扬，角度从水平方向算起。
            const lift = preset.fx.lift;
            const angle = lift ? ((lift[0] + Math.random() * (lift[1] - lift[0])) * Math.PI) / 180 : 0;
            particle.vx = speed * Math.cos(angle);
            particle.vy = -speed * Math.sin(angle);
            break;
          }
          case 'sway':
            // 雪也受重力，但终端速度极低（空气阻力大），所以是飘落而非坠落。
            particle.terminal = preset.terminal ?? speed * 60;
            particle.gravity = preset.gravity ?? particle.terminal * 1.6;
            particle.vy = particle.terminal * 0.55;
            particle.swayAmp = preset.fx.sway ?? 10;
            particle.swayFreq = 0.0012 + Math.random() * 0.0016;
            particle.baseX = particle.x;
            break;
          case 'drift':
            particle.vx = speed * (0.6 + Math.random() * 0.8);
            break;
          default:
            particle.vy = speed;
            break;
        }
        const length = Math.hypot(particle.vx, particle.vy) || 1;
        particle.dirX = particle.vx / length;
        particle.dirY = particle.vy / length;
        // 近大远小 + 空气透视：远处粒子更小更淡，与地面的透视尺度一致。
        const near = depthScale(d);
        if (particle.shape === 'dot') particle.size *= near;
        else if (particle.shape === 'line') particle.size *= 0.75 + 0.35 * d;
        particle.alpha *= 0.55 + 0.45 * d;
        return particle;
      };

      const spawnBatch = (count, fadeIn) => {
        const batch = [];
        for (let index = 0; index < count; index += 1) batch.push(spawnParticle(fadeIn));
        return batch;
      };

      /** 出屏回收：下落类回到同一列的天空顶部，横向类从对侧重新进场。 */
      const recycle = (particle) => {
        if (particle.motion === 'rise') {
          particle.y = depthToY(particle.d) + 8;
          particle.x = projectX(particle.worldX, particle.d);
        } else if (particle.motion === 'fly' || particle.motion === 'drift') {
          // 风/云/雾换一个深度重新进场，层次的远近不会长时间固定。
          particle.d = 0.12 + Math.random() * 0.88;
          particle.worldX = Math.random() * 2 - 1;
          particle.x = -ENGINE_MARGIN;
          particle.y = Math.random() * depthToY(particle.d);
          particle.landY = depthToY(particle.d);
        } else {
          particle.y = -ENGINE_MARGIN;
          particle.x = projectX(particle.worldX, particle.d);
        }
        if (particle.motion === 'sway') particle.baseX = particle.x;
        particle.bounced = false;
      };

      /** 落点涟漪：存屏幕坐标与深度，绘制时按透视压扁。 */
      const addRipple = (x, y, d) => {
        if (ripples.length > 40) return;
        ripples.push({
          x,
          y,
          d,
          r: 1,
          life: 0,
          ttl: 320 + Math.random() * 160,
          maxR: (5 + Math.random() * 6) * depthScale(d),
        });
      };

      const step = (dt, now) => {
        // 速度基准是 60fps 的 px/帧，这里换算成毫秒当量。
        const k = dt / (1000 / 60);
        // 阵风是一个平滑包络，按粒子自己的预设取用：狂风按 ±30% 调制横向速度，
        // 沙尘按同一包络调制可见密度（透过度）；两种语义都用 fx.gust 标记、
        // 按形状区分，过渡期旧粒子也因此保持原样。
        const gustWave = 0.5 + 0.5 * Math.sin(now * 0.0011);
        const gustSpeed = 1 + 0.3 * (gustWave * 2 - 1);
        const gustDensity = 0.55 + 0.45 * gustWave;
        const { width: w, height: h } = env;
        const physics = KIND_PHYSICS[kind] ?? KIND_PHYSICS.cloudy;

        // 地面：积雪融化（无雪天更快）、湿度挥发、休止角松弛。O(格数)，可忽略。
        const melt = physics.melt * (dt / 1000);
        const snow = ground.snow;
        for (let index = 0; index < snow.length; index += 1) {
          if (snow[index] > 0) snow[index] = Math.max(0, snow[index] - melt);
        }
        const wet = ground.wet;
        const dry = (dt / 1000) * 0.05;
        for (let index = 0; index < wet.length; index += 1) {
          if (wet[index] > 0) wet[index] = Math.max(0, wet[index] - dry);
        }
        relaxGround();

        for (const particle of particles) {
          particle.age += dt;
          switch (particle.motion) {
            case 'fall':
              particle.vy = Math.min(particle.terminal, particle.vy + particle.gravity * (dt / 1000));
              particle.y += particle.vy * (dt / 1000);
              particle.x += particle.vx * (dt / 1000);
              break;
            case 'fly':
              particle.x += particle.vx * k * (particle.gust && particle.shape === 'line' ? gustSpeed : 1);
              particle.y += particle.vy * k;
              break;
            case 'sway':
              particle.vy = Math.min(particle.terminal, particle.vy + particle.gravity * (dt / 1000));
              particle.y += particle.vy * (dt / 1000);
              particle.x = particle.baseX + Math.sin(particle.phase + now * particle.swayFreq) * particle.swayAmp;
              break;
            case 'drift':
              particle.x += particle.vx * k;
              break;
            default:
              particle.y -= particle.vy * k;
              break;
          }
          // 落地判定按各自深度对应的透视地面线，而不是屏幕底边。
          if ((particle.motion === 'fall' || particle.motion === 'sway') && particle.y >= particle.landY) {
            if (particle.bounce && !particle.bounced) {
              // 冰雹触底反弹一次，二次落地直接沉积/回收。
              particle.y = particle.landY;
              particle.vy = -particle.vy * 0.42;
              particle.bounced = true;
            } else {
              if (!particle.dying) {
                deposit(particle, physics);
                if (physics.splash > 0) {
                  spawnSplash(particle, physics);
                  addRipple(particle.x, particle.landY, particle.d);
                }
              }
              recycle(particle);
            }
          }
          if (particle.x > w + ENGINE_MARGIN) recycle(particle);
          if (particle.y < -ENGINE_MARGIN && particle.motion === 'rise') recycle(particle);
        }
        // 溅射液滴：重力抛物线（px/s 单位），寿命到或落回地面即回收。
        for (const splash of splashes) {
          splash.vy += 1400 * (dt / 1000);
          splash.x += splash.vx * (dt / 1000);
          splash.y += splash.vy * (dt / 1000);
          splash.life += dt;
        }
        splashes = splashes.filter((splash) => splash.life < splash.ttl && splash.y < env.height + 2);

        particles = particles.filter((particle) => !(particle.dying && particle.age - particle.dieAt >= ENGINE_DYING_MS));
        for (const ripple of ripples) {
          ripple.r += ripple.maxR * (dt / ripple.ttl);
          ripple.life += dt;
        }
        ripples = ripples.filter((ripple) => ripple.life < ripple.ttl);

        // 雷电：非齐次泊松。活动包络慢变（双正弦 + 随机游走），到达率随包络起伏，
        // 自然形成「连闪簇 + 长静默」，没有固定间隔的节拍感。
        if (preset.fx.lightning === true) {
          activity = Math.max(
            0,
            Math.min(
              1,
              0.4 +
                0.22 * Math.sin(now * 0.00021) +
                0.12 * Math.sin(now * 0.00057 + 1.7) +
                (activity - 0.45) * 0.94 +
                (Math.random() - 0.5) * 0.02,
            ),
          );
          if (strike === null) {
            // 基础率约 0.35 次/秒 × 活动强度：强活动期密集，低谷期长静默。
            if (Math.random() < 0.35 * activity * (dt / 1000)) {
              strike = {
                start: now,
                path: buildBoltPath(w, h),
                remaining: 1 + (Math.random() < 0.4 ? 1 : 0) + (Math.random() < 0.12 ? 1 : 0),
              };
            }
          } else if (strike.remaining > 0 && now - strike.start > 170 + Math.random() * 90) {
            // 一次雷击可含 1–3 次回击：重画折线并重置计时，形成「连闪」。
            strike = { start: now, path: buildBoltPath(w, h), remaining: strike.remaining - 1 };
          } else if (strike.remaining === 0 && now - strike.start > 700) {
            strike = null;
          }
        } else {
          strike = null;
          activity = 0.45;
        }
        if (preset.fx.flash === true && flashPulse === null && Math.random() < dt * 0.00025) {
          flashPulse = { start: now };
        }
        if (flashPulse !== null && now - flashPulse.start > 350) flashPulse = null;
      };

      /** 生成一道自上而下的折线闪电路径；一次雷击只生成一条，避免抖动画屑。 */
      const buildBoltPath = (w, h) => {
        const points = [];
        let x = w * (0.2 + Math.random() * 0.6);
        const bottom = h * (0.55 + Math.random() * 0.2);
        const segments = 9;
        for (let index = 0; index <= segments; index += 1) {
          points.push({ x, y: (bottom * index) / segments });
          x += (Math.random() - 0.5) * w * 0.09;
        }
        return points;
      };

      /** hex 变暗/提亮：地面色从天空底色推出来，保证同一套配色语言。 */
      const shade = (hex, factor) => {
        const rgb = toRgb(hex);
        return `rgb(${Math.round(rgb[0] * factor)}, ${Math.round(rgb[1] * factor)}, ${Math.round(rgb[2] * factor)})`;
      };

      /**
       * 天空 + 地面。
       *
       * 原来整屏一条渐变，天空和地面糊在一起，雪堆在 80% 高度上看着像悬空；
       * 现在天空只画到地平线，地面用更暗的同族色铺开，并在交界处画一条极淡的
       * 亮线——「地面」从此是可读的实体平面。
       */
      const drawBackdrop = () => {
        const stops = preset.backdrop[env.isDay ? 'day' : 'night'];
        const hz = horizonY();
        const sky = context.createLinearGradient(0, 0, 0, hz);
        sky.addColorStop(0, stops[0]);
        sky.addColorStop(1, stops[1]);
        context.fillStyle = sky;
        context.fillRect(0, 0, env.width, hz);

        // 地面色默认由天空底色推出来；晴天给了显式的暖土色——从亮蓝天空推出来的
        // 「同族深色」是一层灰蓝，看着像水面而不是地面。
        const floorBase = preset.ground?.[env.isDay ? 'day' : 'night'] ?? stops[1];
        const floor = context.createLinearGradient(0, hz, 0, env.height);
        floor.addColorStop(0, shade(floorBase, 1.02));
        floor.addColorStop(0.42, shade(floorBase, 0.82));
        floor.addColorStop(1, shade(floorBase, 0.62));
        context.fillStyle = floor;
        context.fillRect(0, hz, env.width, env.height - hz);

        // 雪/冰雹场景：地面本身就覆着一层雪，给一层极淡的白，配合底边的雪岸。
        if (kind === 'snow' || kind === 'hail') {
          const snowFloor = context.createLinearGradient(0, hz, 0, env.height);
          snowFloor.addColorStop(0, 'rgba(255, 255, 255, 0.035)');
          snowFloor.addColorStop(1, 'rgba(255, 255, 255, 0.14)');
          context.fillStyle = snowFloor;
          context.fillRect(0, hz, env.width, env.height - hz);
        }

        context.fillStyle = 'rgba(255, 255, 255, 0.085)';
        context.fillRect(0, hz - 0.5, env.width, 1);
      };

      /**
       * 晴天太阳：核心 + 日晕 + 放射光柱，位置跟着 env.solar 走。
       *
       * 原来只有一层 0.14 的暖晕，在亮蓝天空上等于不存在——WebGL 不可用时的
       * 降级路径看起来就是「一片蓝，没有太阳」。光柱用 'lighter' 叠加一圈楔形
       * 径向渐变，长度与张角按序号错开，避免画成一枚规整的齿轮。
       */
      const drawSun = () => {
        if (kind !== 'clear' || !env.isDay) return;
        const { width: w, height: h } = env;
        const sun = env.solar ?? { azimuth: 0.5, elevation: 1 };
        const sx = w * (0.12 + 0.76 * clamp(sun.azimuth ?? 0.5, 0, 1));
        const sy = h * (0.42 - 0.34 * clamp(sun.elevation ?? 1, 0, 1));
        const reach = Math.min(w, h) * 0.55;
        context.save();
        context.globalCompositeOperation = 'lighter';
        for (let index = 0; index < 13; index += 1) {
          const angle = (index / 13) * Math.PI * 2 + 0.3;
          const len = reach * (0.5 + 0.5 * Math.abs(Math.sin(index * 2.7)));
          const spread = 0.022 + 0.016 * Math.abs(Math.cos(index * 1.9));
          const beam = context.createRadialGradient(sx, sy, 0, sx, sy, len);
          beam.addColorStop(0, 'rgba(255, 246, 220, 0.18)');
          beam.addColorStop(0.4, 'rgba(255, 240, 205, 0.06)');
          beam.addColorStop(1, 'rgba(255, 238, 200, 0)');
          context.fillStyle = beam;
          context.beginPath();
          context.moveTo(sx, sy);
          context.arc(sx, sy, len, angle - spread, angle + spread);
          context.closePath();
          context.fill();
        }
        context.restore();
        const halo = context.createRadialGradient(sx, sy, 0, sx, sy, Math.min(w, h) * 0.62);
        halo.addColorStop(0, 'rgba(255, 250, 236, 0.6)');
        halo.addColorStop(0.09, 'rgba(255, 244, 214, 0.28)');
        halo.addColorStop(0.3, 'rgba(255, 236, 198, 0.1)');
        halo.addColorStop(1, 'rgba(255, 232, 190, 0)');
        context.fillStyle = halo;
        context.fillRect(0, 0, w, h);
        const coreRadius = Math.max(16, h * 0.042);
        const core = context.createRadialGradient(sx, sy, 0, sx, sy, coreRadius);
        core.addColorStop(0, 'rgba(255, 255, 255, 1)');
        core.addColorStop(0.55, 'rgba(255, 252, 240, 0.92)');
        core.addColorStop(1, 'rgba(255, 244, 214, 0)');
        context.fillStyle = core;
        context.beginPath();
        context.arc(sx, sy, coreRadius, 0, Math.PI * 2);
        context.fill();
      };

      /** 单个粒子的最终不透明度：过渡淡入淡出 × 昼夜衰减 × 各 fx 调制（全部按粒子自己的预设）。 */
      const particleAlpha = (particle, now, gustDensity) => {
        let alpha = particle.alpha;
        if (particle.dying) {
          alpha *= Math.max(0, 1 - (particle.age - particle.dieAt) / ENGINE_DYING_MS);
        } else if (particle.fadeIn) {
          alpha *= Math.min(1, particle.age / ENGINE_DYING_MS);
        }
        // 夜间整体压暗 30%；光尘（twinkle）这类发光粒子不衰减，夜晚更显眼。
        if (!env.isDay && !particle.twinkle) alpha *= 0.7;
        if (particle.twinkle) alpha *= 0.5 + 0.5 * Math.sin(particle.phase + now * 0.004);
        if (particle.gust && particle.shape === 'dot') alpha *= gustDensity;
        if (particle.desaturate) alpha *= 0.85;
        return alpha;
      };

      const draw = (now) => {
        const { width: w, height: h } = env;
        context.clearRect(0, 0, w, h);
        drawBackdrop();
        const tint = toRgb(preset.tint[env.isDay ? 0 : 1]);
        // 雾霾的低饱和混合每帧只算一次，供带 desaturate 标志的粒子取用。
        const tintMuted = desaturate(tint);
        const gustDensity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now * 0.0011));

        // 地面：地平线柔光 → 雨湿痕迹 → 积雪图层（离屏印章累积，柔边有机形状）。
        drawHorizonHaze();
        drawWet(tint);
        drawAccum();

        // 溅射液滴画在雪/湿面之上、下落粒子之下：视觉上属于地面事件。
        for (const splash of splashes) {
          const fade = 1 - splash.life / splash.ttl;
          if (fade <= 0) continue;
          context.fillStyle = `rgba(222, 236, 250, ${(0.5 * fade).toFixed(3)})`;
          context.beginPath();
          context.ellipse(splash.x, splash.y, splash.r, splash.r * 1.4, 0, 0, Math.PI * 2);
          context.fill();
        }

        // 涟漪画在粒子之下：落点就是该粒子深度对应的地面线。
        for (const ripple of ripples) {
          const fade = 1 - ripple.life / ripple.ttl;
          if (fade <= 0) continue;
          context.strokeStyle = rgba(tint, 0.22 * fade);
          context.lineWidth = 1;
          context.beginPath();
          context.ellipse(ripple.x, ripple.y, ripple.r, ripple.r * 0.32, 0, 0, Math.PI * 2);
          context.stroke();
        }

        // 晴天：太阳本体（核心 + 日晕 + 放射光柱），画在粒子之下。
        drawSun();

        context.lineCap = 'round';
        for (const particle of particles) {
          const alpha = particleAlpha(particle, now, gustDensity);
          if (alpha <= 0.01) continue;
          // 形状、色调、呼吸、闪烁一律按粒子自己的预设取：过渡期的旧粒子保持
          // 原 kind 的绘制方式，新粒子按新 kind，两者交叉淡化而不互相串味。
          const particleTint = particle.desaturate ? tintMuted : tint;
          if (particle.shape === 'line') {
            // 雨痕长度取「当前速度一帧的位移」：加速中的雨滴自然拉长，形成运动模糊。
            const speedNow = Math.hypot(particle.vx, particle.vy) || 1;
            const dirX = particle.vx / speedNow;
            const dirY = particle.vy / speedNow;
            const streak = Math.max(particle.size, particle.vy * 0.05);
            context.strokeStyle = rgba(particleTint, alpha);
            context.lineWidth = particle.lineWidth;
            context.beginPath();
            context.moveTo(particle.x, particle.y);
            context.lineTo(particle.x - dirX * streak, particle.y - dirY * streak);
            context.stroke();
          } else if (particle.shape === 'dot') {
            // 柔边光点：预渲染径向渐变精灵。近处的雪片略大略虚（景深），
            // 远处的更小更实，配合深度透明度形成层次。
            const depthBlur = 1 + Math.max(0, particle.d - 0.55) * 0.9;
            const radius = particle.size * 1.25 * depthBlur;
            context.globalAlpha = Math.min(1, alpha / depthBlur);
            context.drawImage(
              glowSprite(rgbHex(particleTint)),
              particle.x - radius,
              particle.y - radius,
              radius * 2,
              radius * 2,
            );
            context.globalAlpha = 1;
          } else {
            // 雾团/云影：柔边径向渐变，呼吸缩放让边界缓慢起伏。
            const scale = particle.breathe ? 1 + 0.12 * Math.sin(particle.phase + now * 0.0005) : 1;
            const radius = particle.size * scale;
            const blob = context.createRadialGradient(particle.x, particle.y, radius * 0.2, particle.x, particle.y, radius);
            blob.addColorStop(0, rgba(particleTint, alpha));
            blob.addColorStop(1, rgba(particleTint, 0));
            context.fillStyle = blob;
            context.beginPath();
            context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
            context.fill();
          }
        }

        // 沙尘的视野泛橙：一层极淡的全屏暖色罩。
        if (preset.fx.wash !== undefined) {
          context.fillStyle = preset.fx.wash;
          context.fillRect(0, 0, w, h);
        }

        // 暗角：把注意力收到画面中心，也是「镜头感」最便宜的一招。
        const vignette = context.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.38, w / 2, h * 0.42, Math.max(w, h) * 0.78);
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
        context.fillStyle = vignette;
        context.fillRect(0, 0, w, h);

        if (flashPulse !== null) {
          // 暴雨偶发闪电：约 8% 亮度脉冲，350ms 内衰减。
          const strength = Math.max(0, 1 - (now - flashPulse.start) / 350);
          context.fillStyle = `rgba(235, 240, 255, ${(0.08 * strength).toFixed(3)})`;
          context.fillRect(0, 0, w, h);
        }

        if (strike !== null) {
          const elapsed = now - strike.start;
          // 先照亮云底（画面上部渐变），再全屏微亮；峰值 alpha ≤ 0.15。
          const cloudGlow = Math.max(0, 1 - elapsed / 140);
          if (cloudGlow > 0) {
            const glow = context.createLinearGradient(0, 0, 0, h * 0.6);
            glow.addColorStop(0, `rgba(214, 222, 255, ${(0.15 * cloudGlow).toFixed(3)})`);
            glow.addColorStop(1, 'rgba(214, 222, 255, 0)');
            context.fillStyle = glow;
            context.fillRect(0, 0, w, h * 0.6);
          }
          if (elapsed < 130) {
            const strength = Math.max(0, 1 - elapsed / 130);
            context.save();
            context.strokeStyle = `rgba(235, 240, 255, ${(0.85 * strength).toFixed(3)})`;
            context.lineWidth = 2.2;
            context.shadowColor = 'rgba(200, 214, 255, 0.9)';
            context.shadowBlur = 12;
            context.beginPath();
            for (let index = 0; index < strike.path.length; index += 1) {
              const point = strike.path[index];
              if (index === 0) context.moveTo(point.x, point.y);
              else context.lineTo(point.x, point.y);
            }
            context.stroke();
            context.restore();
          }
          if (elapsed >= 140) {
            const strength = Math.max(0, 1 - (elapsed - 140) / 420);
            context.fillStyle = `rgba(226, 231, 255, ${(0.09 * strength).toFixed(3)})`;
            context.fillRect(0, 0, w, h);
          }
        }
      };

      /** reduced-motion：只绘一帧静态渐变与当前地面状态，没有任何粒子动画。 */
      const drawStatic = () => {
        if (preset === null || context === null) return;
        const { width: w, height: h } = env;
        context.clearRect(0, 0, w, h);
        drawBackdrop();
        drawSun();
        const tint = toRgb(preset.tint[env.isDay ? 0 : 1]);
        drawHorizonHaze();
        drawWet(tint);
        drawAccum();
      };

      const startLoop = () => {
        if (frameHandle !== 0 || context === null) return;
        lastFrameAt = performance.now();
        frameHandle = requestAnimationFrame(frame);
      };

      const stopLoop = () => {
        if (frameHandle !== 0) {
          cancelAnimationFrame(frameHandle);
          frameHandle = 0;
        }
      };

      const frame = (now) => {
        frameHandle = requestAnimationFrame(frame);
        // 后台恢复后第一帧 dt 归零 + 50ms 截断：与 WebGL 引擎同一套防跳帧规则。
        const dt = skipDtOnce ? 0 : Math.min(Math.max(0, now - lastFrameAt), ENGINE_DT_CAP_MS);
        skipDtOnce = false;
        lastFrameAt = now;
        if (state === 'transition' && now - transitionStart >= ENGINE_TRANSITION_MS) {
          state = 'running';
        }
        step(dt, now);
        draw(now);
      };

      const adjustCount = () => {
        if (preset === null) return;
        const target = targetCount();
        // 只增删差额，不让整屏粒子在拖动强度滑块时集体跳位。
        while (particles.length > target) particles.pop();
        while (particles.length < target) particles.push(spawnParticle(false));
      };

      const setEnv = (nextEnv) => {
        const previous = env;
        env = { ...env, ...nextEnv };
        if (env.width !== previous.width || env.height !== previous.height) {
          applySize(env.width, env.height);
          ensureGround();
          particles = spawnBatch(targetCount(), false);
        } else if (env.effectScale !== previous.effectScale) {
          adjustCount();
        }
        if (env.reducedMotion !== previous.reducedMotion) {
          if (env.reducedMotion) {
            state = 'idle';
            stopLoop();
          } else if (kind !== null) {
            state = 'running';
            startLoop();
          }
        }
        if (state === 'idle') drawStatic();
        // 从 system 切回 weather 且 kind 未变时，setWeather 在早退分支里直接落到这里；
        // 而切到 system 时 syncEngine 已经 stop() 掉 rAF，不在这里把循环拉回来，
        // 画面就会永远停在最后一帧（P1：weather→system→weather 动画冻结）。
        // 只在 weather 模式可达（system 模式下 syncEngine 在 stop() 处就返回了），
        // reducedMotion 也不能重启，所以两个条件都要显式排除。
        if (!env.reducedMotion && kind !== null && state === 'idle') {
          state = 'running';
          startLoop();
        }
      };

      const onMotionChange = () => {
        const reduced = motionQuery?.matches ?? false;
        if (reduced === env.reducedMotion) return;
        env = { ...env, reducedMotion: reduced };
        if (reduced) {
          state = 'idle';
          stopLoop();
          drawStatic();
        } else if (kind !== null) {
          state = 'running';
          startLoop();
        }
      };

      const onVisibilityChange = () => {
        // 隐藏时停循环省电（PRD G2）；回来后续跑，第一帧 dt 归零 + 截断保证不跳帧。
        if (document.hidden) {
          stopLoop();
        } else if (state === 'running' || state === 'transition') {
          skipDtOnce = true;
          startLoop();
        }
      };

      if (motionQuery !== null && typeof motionQuery.addEventListener === 'function') {
        motionQuery.addEventListener('change', onMotionChange);
      }
      document.addEventListener('visibilitychange', onVisibilityChange);

      return {
        /** kind 变 → 800ms 交叉过渡；instant 为手动切换：清场立即生效；kind 相同 → 仅换环境快照。 */
        setWeather(nextKind, nextEnv, instant = false) {
          const resolved = KIND_PRESETS[nextKind] ? nextKind : 'cloudy';
          if (resolved === kind) {
            setEnv(nextEnv);
            return;
          }
          kind = resolved;
          preset = KIND_PRESETS[kind];
          env = { ...env, ...nextEnv };
          applySize(env.width, env.height);
          ensureGround();
          if (instant) {
            // 手动切换：清空地面积累与旧粒子，立即换场，不做 800ms 交叉淡化。
            resetGround();
            particles = spawnBatch(targetCount(), false);
            strike = null;
            flashPulse = null;
            if (env.reducedMotion || context === null) {
              state = 'idle';
              stopLoop();
              drawStatic();
            } else {
              state = 'running';
              startLoop();
            }
            return;
          }
          // 旧粒子标记 dying 并原样保留（运动参数已烘焙，过渡期不会串味），
          // 新预设的粒子同帧长淡入；背景渐变全程绘制，不会黑屏。
          const survivors = particles.map((particle) => ({ ...particle, dying: true, dieAt: particle.age }));
          particles = survivors.concat(spawnBatch(targetCount(), true));
          ripples = [];
          strike = null;
          flashPulse = null;
          if (env.reducedMotion || context === null) {
            state = 'idle';
            stopLoop();
            drawStatic();
            return;
          }
          state = 'transition';
          transitionStart = performance.now();
          startLoop();
        },
        setEnv,
        resize(width, height) {
          const w = Math.max(1, Math.round(width));
          const h = Math.max(1, Math.round(height));
          if (env.width === w && env.height === h) return;
          env = { ...env, width: w, height: h };
          applySize(w, h);
          ensureGround();
          if (preset !== null) particles = spawnBatch(targetCount(), false);
          if (state === 'idle') drawStatic();
        },
        /** 停 rAF，保留最后一帧。 */
        stop() {
          state = 'idle';
          stopLoop();
        },
        /** 渲染侧诊断快照：设置页调试行与 devtools 都读它。 */
        stats() {
          // 积雪总量取网格平均高度，溅射数直接给池长度——两者都是物理状态的
          // 直接证据，排查「雪没堆起来 / 没有溅射」时一眼可见。
          let snowTotal = 0;
          for (let index = 0; index < ground.snow.length; index += 1) snowTotal += ground.snow[index];
          const snowAvg = ground.snow.length > 0 ? snowTotal / ground.snow.length : 0;
          return {
            ctx: context !== null,
            width: env.width,
            height: env.height,
            state,
            kind,
            snow: Math.round(snowAvg * 10) / 10,
            splash: splashes.length,
            renderer: 'canvas',
            /** 回退引擎不做 DRS，恒为满档（与 WebGL 口径对齐，供调试行统一读取）。 */
            quality: 2,
          };
        },
        dispose() {
          stopLoop();
          particles = [];
          ripples = [];
          if (motionQuery !== null && typeof motionQuery.removeEventListener === 'function') {
            motionQuery.removeEventListener('change', onMotionChange);
          }
          document.removeEventListener('visibilitychange', onVisibilityChange);
        },
      };
    };

    // ── WebGL2 真 3D 渲染器 ──────────────────────────────────────────────────
    /**
     * 世界约定（右手系，单位≈米）：地面 y=0，相机站在 (0, 2.2, 4.5) 朝 -Z 看。
     *
     * 俯仰角不是随手给的：它由 GROUND_RATIO 反解，让地平线仍然落在屏幕高度的
     * 80%（即地面占下方 20%）。整块 UI 的压暗层、面板透明度都是按这条线调的，
     * 3D 化不能把地平线顶到画面上半部分去——那是视觉契约，不是审美偏好。
     */
    const GL_FOV_DEG = 45;
    const GL_NEAR = 0.1;
    const GL_FAR = 120;
    const GL_EYE = [0, 2.2, 4.5];
    const GL_TAN_HALF = Math.tan((GL_FOV_DEG * Math.PI) / 360);
    /** 地平线在屏幕上的目标高度（0=顶边，1=底边）。 */
    const GL_HORIZON_Y = 1 - GROUND_RATIO;
    /** 反解俯仰：视线方向上仰，地平线才会下移到底部 20% 处。 */
    const GL_PITCH = Math.atan((1 - 2 * GL_HORIZON_Y) * -GL_TAN_HALF);
    /**
     * 地面几何矩形（世界 x/z）：远大于可视区，让四边永远落在视锥外、
     * 或被雾吃掉——否则会在地平线附近看到一条「地面边缘」的暗带。
     */
    const GL_GROUND = { x0: -90, x1: 90, z0: -110, z1: 8 };
    /**
     * 积雪/湿润的「有效区」（世界 x/z）：纹理与物理网格只覆盖这一块，
     * 近中景的雪堆才够细（约 0.4×0.9 世界单位一格），更远的地方反正被雾糊住。
     */
    const GL_FIELD = { x0: -26, x1: 26, z0: -80, z1: 6 };
    /** 地面物理网格：积雪/湿润按格累积，再重采样成 128² 纹理喂给着色器。 */
    const GL_FIELD_COLS = 128;
    const GL_FIELD_ROWS = 96;
    const GL_TEX_SIZE = 128;
    const GL_TEX_INTERVAL_MS = 100;
    /**
     * KIND_PRESETS 里的 size 是「10 单位距离、fov 45、900px 高」基准下的像素尺寸。
     * 换算回世界单位：900px 覆盖 2×10×tan(22.5°)=8.28 单位，故 1px ≈ 0.0092 单位。
     * 3D 场景里尺寸必须用世界单位，否则透视会把它放大到荒唐的地步。
     */
    const GL_PX2W = 0.0092;
    const GL_DOT_CAP = 3600;
    const GL_LINE_CAP = 3600;
    const GL_SPLASH_CAP = 400;
    const GL_RIPPLE_CAP = 96;
    /**
     * KIND_PRESETS.count 原是 Canvas 2D 的「基准视口粒子数」，2D 时封顶 280。
     * 3D 场景的可见体积大得多（纵深 40 单位），密度要乘一个系数才等价；
     * 云团是巨型 billboard，按另一套更小的系数走，否则一屏几百个雾团。
     */
    const GL_COUNT_SCALE = 5.5;
    const GL_BLOB_SCALE = 2.4;
    /** 单次落地沉积的增益：KIND_PHYSICS.deposit 是 0..26 的「像素高度」语义。 */
    const GL_DEPOSIT_GAIN = 0.7;
    /** 拉伸长度系数：|vel| × 系数 = 雨丝长度（世界单位）。 */
    const GL_STREAK_SCALE = 0.035;
    /** kind 切换的参数插值时长（手动切换直接跳变）。 */
    const GL_BLEND_MS = 400;
    /** 粒子重生淡入时长（秒）：0 → 满不透明度，消除重生/环绕回收的「闪现」。 */
    const GL_FADE_IN_SEC = 0.45;
    /** 自适应质量（DRS）三档的 dpr 上限：索引即 quality（2=满档、0=最低档）。 */
    const GL_QUALITY_DPR = [1, 1.25, 2];
    /** 自适应质量三档的粒子数系数：每降一档 ×0.72（最低档累计 ≈0.52）。 */
    const GL_QUALITY_COUNT = [0.72 * 0.72, 0.72, 1];
    /** 帧成本采样环容量：120fps≈2s、60fps≈4s 的窗口，足够算稳定 p95。 */
    const DRS_RING_CAP = 240;
    /** p95 评估节流：每 250ms 评一次，避免每帧排序。 */
    const DRS_EVAL_MS = 250;
    /** 过载阈值：p95 持续超过 11ms 判定为超出 8ms 帧预算（留 37% 余量）。 */
    const DRS_OVER_P95 = 11;
    /** 恢复阈值：p95 持续低于 7ms 才允许升档，与过载阈值形成迟滞带。 */
    const DRS_UNDER_P95 = 7;
    /** 过载持续 2s → 降一档；健康持续 12s → 升一档（不对称迟滞防振荡）。 */
    const DRS_OVER_MS = 2000;
    const DRS_UNDER_MS = 12000;
    /** 估计显示器刷新周期的钳位范围（ms），用于把「掉帧」折算成帧成本。 */
    const DRS_VSYNC_MIN_MS = 4;
    const DRS_VSYNC_MAX_MS = 25;
    const GL_CONTEXT_ATTRS = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      // stop()/reduced-motion 只画一帧后停 rAF：没有 preserveDrawingBuffer，
      // 合成器读走一帧后缓冲会被清空，画面变黑。
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    };
    /** 定点参数表的槽位：参数整体是 Float32Array，插值就是一个 for 循环。 */
    const P_SKY_TOP = 0;
    const P_SKY_MID = 3;
    const P_HORIZON = 6;
    const P_FOG = 9;
    const P_GROUND = 12;
    const P_SNOW = 15;
    const P_FOG_DENSITY = 18;
    const P_CLOUD = 19;
    const P_SUN = 20;
    const P_VIGNETTE = 21;
    const P_WASH = 22;
    const P_WASH_ALPHA = 25;
    const P_SPEC = 26;
    /** 地平线雾带的厚度（elevation 单位）：晴天是一条细线，雾天铺满下半空。 */
    const P_HAZE_BAND = 27;
    /** 太阳放射光柱的强度（0 = 不画）：只有晴/风/霾这类看得见太阳的天气才开。 */
    const P_RAY = 28;
    /** 地面直射光的额外增益：晴天要让地面「被晒到」，阴雨天保持原样。 */
    const P_SUN_GAIN = 29;
    const P_LEN = 30;

    /**
     * 天气 × 时段的太阳可见度：晴 1，阴天/雨雾按云层厚度衰减，雷暴最低。
     * 太阳盘、地面直射项、粒子投影都乘这个系数——同一个数贯穿三种表现，
     * 不同天气下的光照才不会互相打架。
     */
    const GL_SUN_VISIBILITY = {
      clear: 1.0,
      cloudy: 0.26,
      drizzle: 0.13,
      rain: 0.08,
      heavyRain: 0.04,
      thunderstorm: 0.03,
      wind: 0.42,
      snow: 0.3,
      fog: 0.05,
      haze: 0.11,
      hail: 0.18,
      dust: 0.16,
    };

    /**
     * 太阳**本体**（圆盘 + 紧贴的光晕）的可见度，与上面的「照度」分开建模。
     *
     * 两者不是一回事：阴天仍然有大量漫射光（照度 0.26），但太阳盘早被云吃掉了。
     * 只用一个系数时，雨天的 `0.08 × 2.4` 加法项在暗天空里是一颗清晰的白点——
     * 雨丝加上那颗白点就是「太阳雨」（用户实测反馈）。云层消光是乘性的，所以
     * 这里比照度衰减得狠得多：雨族 0.01 量级，几乎不可见；霾里仍是一个淡盘。
     */
    const GL_SUN_DISK = {
      clear: 1.0,
      cloudy: 0.02,
      drizzle: 0.02,
      rain: 0.012,
      heavyRain: 0.008,
      thunderstorm: 0.006,
      wind: 0.12,
      snow: 0.02,
      fog: 0.008,
      // 霾里仍要看得到一个「昏黄的盘」，但它是淡的：0.35 会烧成一颗白热点。
      haze: 0.12,
      hail: 0.015,
      dust: 0.06,
    };

    /**
     * 天气 × 时段的阴影参数：alpha 是投影浓度，soft 是边缘扩散（越大越糊），
     * cloud 是地面云影强度。晴天硬朗，阴雨天几乎没有可辨影子。
     */
    const GL_SHADOW = {
      clear: { alpha: 0.42, soft: 0.25, cloud: 0.18 },
      cloudy: { alpha: 0.2, soft: 0.75, cloud: 0.55 },
      drizzle: { alpha: 0.12, soft: 0.9, cloud: 0.7 },
      rain: { alpha: 0.1, soft: 0.95, cloud: 0.78 },
      heavyRain: { alpha: 0.06, soft: 1, cloud: 0.85 },
      thunderstorm: { alpha: 0.04, soft: 1, cloud: 0.9 },
      wind: { alpha: 0.26, soft: 0.5, cloud: 0.3 },
      snow: { alpha: 0.24, soft: 0.6, cloud: 0.5 },
      fog: { alpha: 0.02, soft: 1, cloud: 0.35 },
      haze: { alpha: 0.06, soft: 1, cloud: 0.3 },
      hail: { alpha: 0.14, soft: 0.8, cloud: 0.8 },
      dust: { alpha: 0.08, soft: 0.9, cloud: 0.4 },
    };

    /** 天气的环境光强度：阴雨天环境光占主导，晴天靠直射光。夜里整体压到 0.42 倍。 */
    const GL_AMBIENT = {
      clear: 0.62,
      cloudy: 0.85,
      drizzle: 0.9,
      rain: 0.92,
      heavyRain: 0.95,
      thunderstorm: 0.9,
      wind: 0.8,
      snow: 0.95,
      fog: 0.95,
      haze: 0.88,
      hail: 0.9,
      dust: 0.82,
    };

    /**
     * 每种 kind 的 3D 场景质感参数（与 KIND_PRESETS 分离，理由同 KIND_PHYSICS）。
     *
     * ground 是裸地颜色（雪靠 uSnow 纹理盖白），fog 是雾密度（1/世界单位），
     * cloud 是云量 0..1，horizonLift 是地平线向白抬升的幅度（越亮越「通透」）。
     */
    const GL_KIND_LOOK = {
      clear: {
        ground: [0.24, 0.22, 0.18],
        // 晴天的空气也要有「厚度」：远场地面靠这条雾收进天空，地平线才不会是一道
        // 亮蓝对灰褐的硬切边。但密度不能大——0.022 会把整片地面洗成灰白（实测），
        // 所以主要靠下面那条「强制并入雾色」的距离带在 70m 外收口。
        fog: 0.012,
        cloud: 0.05,
        sun: 1.0,
        horizonLift: 0.18,
        vignette: 0.1,
        // 晴天的光尘是本场景唯一的粒子内容，但只能是「阳光里的浮尘」：
        // 尺寸压到 0.55 倍、不透明度 0.5 倍，大颗粒会变成萤火虫。
        dotScale: 0.55,
        dotAlpha: 0.5,
        // 晴天用真正的「白天蓝」：预设里的 backdrop 是为文字可读性调的暖深棕，
        // 拿来当白昼天空会像沙暴。天顶保持较深的蓝（文字仍可读），越靠地平线
        // 越亮越白——真实的晴空就是「上深下浅」，不是一条均匀的灰。
        sky: { top: [0.075, 0.235, 0.475], mid: [0.19, 0.44, 0.72], horizon: [0.66, 0.78, 0.87] },
        // 地平线雾带：晴天只有 4° 左右的薄雾，0.30 会让半个天空糊成乳白（原值）。
        hazeBand: 0.07,
        // 放射光柱：晴天的辨识点，没有它太阳只是一颗白点（像月亮）。
        ray: 1.0,
        // 地面直射增益：晒得到的地面才像正午，否则永远是一条灰褐带。
        sunGain: 1.7,
      },
      cloudy: { ground: [0.13, 0.14, 0.16], fog: 0.015, cloud: 0.78, sun: 0.0, horizonLift: 0.13, vignette: 0.24, hazeBand: 0.24 },
      drizzle: { ground: [0.09, 0.10, 0.12], fog: 0.017, cloud: 0.64, sun: 0.0, horizonLift: 0.11, vignette: 0.26, hazeBand: 0.22 },
      rain: { ground: [0.075, 0.085, 0.105], fog: 0.019, cloud: 0.72, sun: 0.0, horizonLift: 0.10, vignette: 0.27, hazeBand: 0.2 },
      heavyRain: { ground: [0.06, 0.07, 0.09], fog: 0.022, cloud: 0.84, sun: 0.0, horizonLift: 0.08, vignette: 0.30, hazeBand: 0.18 },
      thunderstorm: {
        ground: [0.05, 0.055, 0.08],
        fog: 0.024,
        cloud: 0.92,
        sun: 0.0,
        horizonLift: 0.07,
        vignette: 0.32,
        hazeBand: 0.18,
        tint: [0.62, 0.66, 0.82],
        lineBoost: 1.5,
      },
      hail: { ground: [0.24, 0.28, 0.34], fog: 0.021, cloud: 0.74, sun: 0.0, horizonLift: 0.14, vignette: 0.26, hazeBand: 0.2 },
      snow: { ground: [0.28, 0.32, 0.39], fog: 0.022, cloud: 0.62, sun: 0.0, horizonLift: 0.16, vignette: 0.24, hazeBand: 0.2 },
      fog: {
        // 雾：冷灰蓝、能见度低（密度最高）、对比度低、无颗粒感——「一片乳白」。
        ground: [0.155, 0.175, 0.205],
        fog: 0.082,
        cloud: 0.5,
        sun: 0.0,
        horizonLift: 0.26,
        vignette: 0.2,
        // 雾天的雾带本来就该吃掉大半个天空，这是它唯一的辨识点。
        hazeBand: 0.5,
      },
      haze: {
        // 霾：暖土黄、能见度中等、太阳是个昏黄的盘、**有细颗粒**——「闷但不糊」。
        ground: [0.2, 0.18, 0.13],
        fog: 0.034,
        cloud: 0.28,
        sun: 0.3,
        horizonLift: 0.16,
        vignette: 0.22,
        hazeBand: 0.32,
        // 霾里不画光柱：太阳盘只有几十像素，一道光柱会变成一根「毛刺」。
        ray: 0,
      },
      wind: {
        ground: [0.13, 0.14, 0.12],
        fog: 0.013,
        cloud: 0.42,
        sun: 0.15,
        horizonLift: 0.13,
        vignette: 0.24,
        hazeBand: 0.16,
        ray: 0.3,
        // 狂风是「横向划过的空气」：深绿灰在深色天空上等于没有，必须提亮 + 加宽 + 拉长
        tint: [0.70, 0.76, 0.70],
        lineBoost: 3.2,
        lineWidth: 1.6,
      },
      dust: {
        ground: [0.24, 0.20, 0.15],
        fog: 0.062,
        cloud: 0.30,
        sun: 0.35,
        horizonLift: 0.22,
        vignette: 0.26,
        hazeBand: 0.3,
        ray: 0.2,
        wash: [0.63, 0.50, 0.35],
        // 沙尘粒径在近中景必须读得出来：尺寸 ×2.2、透明度 ×1.5，
        // 并横向拉成 1.9 倍——风携沙的条痕感，而不是一颗颗圆点。
        dotScale: 2.2,
        dotAlpha: 1.5,
        dotStretch: 1.5,
        dotCountScale: 1.8,
      },
    };

    /** 廉价 value noise：云与地面伪法线都靠它，2 octave 起、3 octave 止。 */
    const GL_NOISE_GLSL = `
float glHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float glNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = glHash(i);
  float b = glHash(i + vec2(1.0, 0.0));
  float c = glHash(i + vec2(0.0, 1.0));
  float d = glHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float glFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i += 1) {
    sum += amp * glNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
`;

    /**
     * 全屏三角形的顶点着色器：三个顶点（-1,-1）(3,-1) (-1,3) 裁出整个视口，
     * 比 quad 少一次顶点、也不需要任何顶点缓冲（gl_VertexID 就是坐标）。
     */
    const GL_FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vNdc = p * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 1.0, 1.0);
}
`;

    /**
     * 天空：按像素反算视线方向，三段竖渐变（天顶/中层/地平线）+ 3 octave 云 +
     * 地平线向雾色收敛 + 晴天日晕 + 闪电整体提亮。
     *
     * 用方向而不是屏幕坐标做云，云才会在相机「转头」时跟着走；这里虽然固定机位，
     * 但云的透视压缩（远处密、天顶疏）必须由 dir.y 驱动才自然。
     */
    const GL_SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uTanHalf;
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSun;
uniform float uSunDisk;
uniform float uWarm;
uniform float uDaylight;
uniform float uCloud;
uniform float uTime;
uniform float uFlash;
uniform float uHazeBand;
uniform float uRay;
out vec4 fragColor;
${GL_NOISE_GLSL}
void main() {
  vec3 dir = normalize(uCamFwd + uCamRight * (vNdc.x * uTanHalf.x) + uCamUp * (vNdc.y * uTanHalf.y));
  float elev = dir.y;
  float t = clamp(elev / 0.55, 0.0, 1.0);
  vec3 col = mix(uHorizon, uSkyMid, smoothstep(0.0, 0.42, t));
  col = mix(col, uSkyTop, smoothstep(0.32, 1.0, t));
  // 天空随日长整体压暗：清晨/黄昏不是「同一片天换个色」，而是亮度也在降。
  col *= mix(0.66, 1.0, uDaylight);

  // 云层：把视线投影到一张水平面上（elev 越小摊得越远），再取低频 fbm。
  vec2 cuv = dir.xz / max(0.09, elev + 0.15);
  float n = glFbm(cuv * 0.5 + vec2(uTime * 0.0055, uTime * 0.0028));
  float n2 = glFbm(cuv * 1.65 - vec2(uTime * 0.011, 0.0));
  float cover = smoothstep(0.40, 0.80, n * 0.78 + n2 * 0.34);
  float above = smoothstep(-0.03, 0.15, elev);
  vec3 cloudTint = mix(uSkyMid, vec3(1.0), 0.22);
  col = mix(col, cloudTint, cover * cover * uCloud * above * 0.9);

  // 地平线雾化：不画一条硬边，让天空自己溶进雾里，地面才有「无限远」的收口。
  // 雾带厚度按天气给：晴天是一条 4° 的薄线，雾天要吃掉大半个天空。固定 0.30
  // 会让晴天的下半空糊成一片乳白，看起来和多云/雾霾没有区别。
  float haze = 1.0 - smoothstep(-0.02, uHazeBand, elev);
  col = mix(col, uFogColor, haze * 0.99);
  // 地平线亮边：一条极窄的高光。8% 的高度差里，全靠这条线告诉眼睛「地在那里」。
  col += vec3(0.028, 0.032, 0.038) * exp(-pow(elev / 0.018, 2.0));

  // 晨昏暖色：太阳压低时，地平线附近的天空被它的长波光染暖；正午中性。
  float warmBand = (1.0 - smoothstep(0.0, 0.46, elev)) * uWarm;
  col = mix(col, col * vec3(1.30, 0.97, 0.74) + vec3(0.05, 0.012, 0.0), warmBand * 0.8);

  if (uSun > 0.001) {
    float sun = max(dot(dir, uSunDir), 0.0);
    // 四级日晕：核心盘（≈1.2°）、近晕（≈6°）、中层光晕（≈15°）、大气泛光（≈28°）。
    // 指数按角度反解——pow(cosθ, n)=0.5 时 n≈3000 对应 1.2° 半径；700 会画成
    // 90px 的大光球。原来只有核心 + 一层弱晕，读起来是「月亮」不是「太阳」：
    // 烈日的高光必须一路衰减到二十几度，眼睛才认得出「光在空气里散开」。
    // 核心盘与近晕走 uSunDisk（被云吃掉就真的没有），中层光晕与大气泛光走 uSun
    // （漫射光还在，只是太阳不在了）——这正是「阴天」与「晴天」的区别所在。
    col += uSunColor * pow(sun, 4200.0) * uSunDisk * 2.4;
    col += uSunColor * pow(sun, 300.0) * uSunDisk * 0.30;
    col += uSunColor * pow(sun, 48.0) * uSun * 0.18;
    col += uSunColor * pow(sun, 7.0) * uSun * (0.06 + 0.14 * uWarm);

    // 放射光柱：把太阳投到屏幕空间，按极角调制一圈长短不一的条痕。
    // 这是「烈日高照」最便宜也最有效的信号——没有它，太阳永远只是一个白点。
    // 掩膜用 pow(sun, 5)（≈±45°），只在太阳周围可见，远处交还给天空本身。
    float zc = dot(uSunDir, uCamFwd);
    if (zc > 0.02 && uRay > 0.001) {
      vec2 sp = vec2(
        dot(uSunDir, uCamRight) / (zc * uTanHalf.x),
        dot(uSunDir, uCamUp) / (zc * uTanHalf.y)
      );
      // NDC 是横向拉伸的，先按宽高比还原成正圆再取极角，光柱才不会变成椭圆。
      vec2 q = (vNdc - sp) * vec2(uTanHalf.x / uTanHalf.y, 1.0);
      float ang = atan(q.y, q.x);
      // 三组无理倍频的正弦叠加：单一频率会画成「八角星」，是图标不是阳光。
      // 每组取幂把波峰收窄，再垫 0.3 的底光——条痕要「亮得不均匀」而不是「一刀
      // 一刀的尖刺」，否则整颗太阳像卡通里的闪光符号。
      float a1 = 0.5 + 0.5 * sin(ang * 7.0 + 1.7);
      float a2 = 0.5 + 0.5 * sin(ang * 13.0 - 0.6);
      float a3 = 0.5 + 0.5 * sin(ang * 29.0 + 2.4);
      float streak = 0.3 + 0.7 * (a1 * a1 * 0.5 + a2 * a2 * a2 * 0.35 + a3 * a3 * a3 * a3 * 0.15);
      float reach = pow(sun, 5.0) * (1.0 - smoothstep(0.0, 1.1, length(q)));
      col += uSunColor * streak * reach * uSunDisk * uRay * 0.16;
    }
  }
  // 闪电：整片天空被照亮，云越厚的地方亮得越多（云是发光体，不是玻璃）。
  col += vec3(0.74, 0.79, 1.0) * uFlash * (0.30 + 0.70 * cover);
  // interleaved gradient noise 抖动：±0.5/255 打散 8bit 渐变的条带（Jimenez 2014）。
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (dither - 0.5) / 255.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

    const GL_GROUND_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aXZ;
uniform mat4 uViewProj;
out vec3 vWorld;
void main() {
  vWorld = vec3(aXZ.x, 0.0, aXZ.y);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`;

    /**
     * 地面：基色 + 雪纹理盖白 + 湿纹理压暗/高光 + 距离雾。
     *
     * 雪不是「一层白漆」：用雪深在 uv 上的中心差分当伪法线，参与一次定向光，
     * 雪堆才有明暗面；否则 3D 地面会退化成一张贴纸。
     */
    const GL_GROUND_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform sampler2D uSnow;
uniform sampler2D uWet;
uniform vec2 uGroundOrigin;
uniform vec2 uGroundSpan;
uniform vec3 uBase;
uniform vec3 uSnowColor;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform vec3 uSunColor;
uniform float uSunI;
uniform float uAmbient;
uniform float uSunGain;
uniform float uWarm;
uniform float uCloudShadow;
uniform vec2 uShadowOffset;
uniform float uFlash;
uniform float uFogDensity;
uniform float uSnowGain;
uniform float uSpec;
uniform float uTime;
out vec4 fragColor;
${GL_NOISE_GLSL}
void main() {
  vec2 uv = (vWorld.xz - uGroundOrigin) / uGroundSpan;
  float h = texture(uSnow, uv).r;
  float wet = texture(uWet, uv).r;

  float e = 1.0 / ${GL_TEX_SIZE}.0;
  float hx = texture(uSnow, uv + vec2(e, 0.0)).r - texture(uSnow, uv - vec2(e, 0.0)).r;
  float hz = texture(uSnow, uv + vec2(0.0, e)).r - texture(uSnow, uv - vec2(0.0, e)).r;
  vec3 normal = normalize(vec3(-hx * 9.0, 1.0, -hz * 9.0));

  float cover = smoothstep(0.04, 0.45, h * uSnowGain);
  // 雪与水膜互斥：被雪盖住的地方不是水面，湿润压暗与镜面高光都必须退出，
  // 否则雪面会被打上一条水膜高光，看起来像冰湖/水银（P4）。
  // 湿度的视觉映射做一次 gamma 提升：轻雨的单格湿度只有 0.05 量级，线性映射
  // 几乎看不出「地面湿了」；pow(wet,0.55) 让 0.05 → 0.2，观感立刻成立。
  float wetness = pow(clamp(wet, 0.0, 1.0), 0.55) * (1.0 - cover);
  // 裸地不是一块纯色：极低频的颗粒让它有「地面」的质感，而不是一条平滑渐变带。
  // 幅度不能大：地面底色一亮，0.42 的颗粒就会变成一层沙丘纹理（晴天实测）。
  float grain = glFbm(vWorld.xz * 0.85) - 0.5;
  vec3 col = mix(uBase * (1.0 + grain * 0.26), uBase * vec3(0.70, 0.75, 0.84), wetness * 0.8);
  // 雪是漫反射体，不是抛光面：加一层高频颗粒，配合伪法线的明暗才有「雪粒」质感。
  float sparkle = glFbm(vWorld.xz * 5.5 + vec2(uTime * 0.02, 0.0)) - 0.5;
  col = mix(col, uSnowColor * (0.94 + sparkle * 0.13), cover);

  // 积水：低频噪声决定「哪儿是水洼」，只出现在湿区——比整片压暗更像下过雨。
  float puddle = smoothstep(0.52, 0.74, glFbm(vWorld.xz * 0.055 + uShadowOffset * 0.35)) * wetness;
  col = mix(col, col * vec3(0.70, 0.75, 0.86), puddle * 0.6);

  // 云影：低频 fbm 漂移，压出「大片云影扫过地面」的明暗块。阴雨天最强，
  // 晴天只剩很淡的一层——同一个噪声场也让影子随太阳方位移动。
  float cs = glFbm(vWorld.xz * 0.016 + uShadowOffset);
  float cloudMask = smoothstep(0.36, 0.88, cs) * uCloudShadow;
  col *= 1.0 - cloudMask * 0.55;

  // 天气 × 时段的光照：直射项由太阳强度驱动，环境项负责阴雨天与夜间兜底。
  // 云越厚 → uSunI 越小 → 画面越靠环境光，对比度自然下降，不需要额外分支。
  // uSunGain 是「晴天专属」的直射增益：没有它，正午的地面永远是一条灰褐带，
  // 天空再蓝也不像被晒到。
  vec3 lightDir = normalize(uLightDir);
  float diff = max(dot(normal, lightDir), 0.0);
  float lit = uAmbient * (1.0 - 0.30 * uSunI) + uSunI * diff * 0.80 * uSunGain;
  col *= mix(1.0, lit, 0.85);
  col += uSunColor * uSunI * diff * 0.06 * uSunGain;

  vec3 viewDir = normalize(uCamPos - vWorld);
  vec3 halfDir = normalize(lightDir + viewDir);
  float gloss = pow(max(dot(normal, halfDir), 0.0), 42.0);
  // 水膜的横向反光：极低频 fbm 沿 z 压扁，看起来像地面上一条条被拉长的天光。
  float sheen = smoothstep(0.42, 0.92, glFbm(vec2(vWorld.x * 0.55, vWorld.z * 0.08) + vec2(uTime * 0.02, 0.0)));
  col += uSunColor * gloss * wetness * uSpec * (0.18 + 0.85 * uSunI);
  col += uSunColor * sheen * wetness * 0.18 * (0.25 + 0.75 * uSunI);
  // 积水面的整体泛光：水洼比周围湿地更「亮一层」。
  col += uSunColor * puddle * 0.12 * (0.2 + 0.8 * uSunI);
  // 闪电照亮地面：雷暴时地面不是干等天空变亮，它自己也会被打亮一瞬。
  col += vec3(0.62, 0.70, 0.92) * uFlash * 0.11 * (0.35 + 0.65 * diff);

  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-uFogDensity * dist);
  // 远场强制并入雾色：地面几何的远端边界正好等于地平线色，接缝不可见。
  // 收口距离从 50–96m 前移到 34–72m：原来的窗口把「地面到天空」的过渡全挤在
  // 地平线附近十几行像素里，远看就是一条硬边；提前收口才有真正的空气透视。
  fog = max(fog, smoothstep(34.0, 72.0, dist));
  vec3 toFrag = normalize(vWorld - uCamPos);
  // 雾色必须和天空用同一条公式：天空那边是「雾色 + 晨昏暖带 + 日晕」，地面这边
  // 原来只混了裸雾色，于是日落时天空是暖灰、地面是一条冷蓝，接缝读起来像一片
  // 湖（实测 197,195,192 → 165,195,217）。这里把后两项补回来。
  vec3 fogColor = uFogColor;
  float warmBand = (1.0 - smoothstep(0.0, 0.46, toFrag.y)) * uWarm;
  fogColor = mix(fogColor, fogColor * vec3(1.30, 0.97, 0.74) + vec3(0.05, 0.012, 0.0), warmBand * 0.8);
  float sunGlow = pow(max(dot(toFrag, lightDir), 0.0), 8.0);
  fogColor += uSunColor * sunGlow * uSunI * (0.06 + 0.14 * uWarm);
  col = mix(col, fogColor, clamp(fog, 0.0, 1.0));
  // 与天空共用同一条地平线亮边：远场地面被雾饱和成纯雾色后，天空那边还挂着
  // 这条高光的尾巴，两者会差出 2–3/255 的一条细线（QA 实测）。这里按同一个
  // elev 公式补回去，接缝两端逐像素同色。* fog 保证只作用在远场。
  col += vec3(0.028, 0.032, 0.038) * exp(-pow(toFrag.y / 0.018, 2.0)) * fog;
  // 与天空同款 interleaved gradient noise 抖动：地面渐变（雾/雪面）同样会出条带。
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (dither - 0.5) / 255.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

    /**
     * 点粒子（雪/冰雹/光尘/雾团）：CAMERA-FACING billboard。
     *
     * 摆动在顶点着色器里算（sin(time*0.8+phase)），CPU 只管重力下落——省一路
     * 逐帧写回，也避免「摆动」这种纯视觉量和物理量混在一个数组里。
     */
    const GL_DOT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aPos;
layout(location = 2) in float aSize;
layout(location = 3) in float aPhase;
layout(location = 4) in float aAlpha;
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uSway;
uniform float uStretch;
uniform float uFogDensity;
uniform float uSoft;
out vec2 vLocal;
out float vAlpha;
out float vFog;
out float vPhase;
void main() {
  vec3 world = aPos;
  world.x += sin(uTime * 0.8 + aPhase) * uSway;
  world.z += cos(uTime * 0.63 + aPhase * 1.7) * uSway * 0.6;
  vLocal = aCorner;
  vPhase = aPhase;
  // 雾团横向拉伸成扁云：正圆的 billboard 在天空里就是一团「雾斑」，不像云。
  vec3 offset = (uCamRight * aCorner.x * uStretch + uCamUp * aCorner.y) * aSize;
  gl_Position = uViewProj * vec4(world + offset, 1.0);
  float dist = length(uCamPos - world);
  // 雾团不在乎雾，只有真正的粒子才按距离淡出。
  // 雾对粒子的吞噬要封顶：沙尘/狂风本来就是低能见度场景，若让雾按物理值
  // 走到 0.9，近中景的颗粒会被直接抹掉（P5）。0.6 是「看得见但发闷」的折中。
  vFog = min(clamp(1.0 - exp(-uFogDensity * dist * (1.0 - uSoft * 0.85)), 0.0, 1.0), 0.6);
  vAlpha = aAlpha;
}
`;

    /**
     * 粒子投影：把每个点粒子的位置沿「背光方向」投到地面，画成一枚柔边暗斑。
     *
     * 没有实体几何的场景里，这是让观众看出「光从哪来」的唯一手段：太阳越低，
     * uShadowStretch 越大、影子越长；阴雨天 shadowAlpha→0，影子自然消失。
     */
    const GL_SHADOW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aPos;
layout(location = 2) in float aSize;
layout(location = 4) in float aAlpha;
uniform mat4 uViewProj;
uniform vec3 uShadowDir;
uniform float uShadowStretch;
uniform float uSizeScale;
out vec2 vLocal;
out float vAlpha;
void main() {
  vLocal = aCorner;
  vAlpha = aAlpha;
  vec2 offset = uShadowDir.xz * aPos.y * uShadowStretch;
  vec3 base = vec3(aPos.x + offset.x, 0.02, aPos.z + offset.y);
  vec3 world = base + vec3(aCorner.x, 0.0, aCorner.y) * aSize * uSizeScale;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

    const GL_SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vAlpha;
uniform float uShadowAlpha;
uniform float uSoft;
out vec4 fragColor;
void main() {
  float r = length(vLocal);
  // soft 越大边缘越糊：晴天 0.25 是硬边小影，阴天 1.0 是一团几乎看不见的灰。
  float core = 1.0 - smoothstep(mix(0.30, 0.82, uSoft), 1.0, r);
  float alpha = core * vAlpha * uShadowAlpha;
  if (alpha <= 0.004) discard;
  fragColor = vec4(0.02, 0.022, 0.03, alpha);
}
`;

    const GL_DOT_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vAlpha;
in float vFog;
in float vPhase;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uTwinkle;
uniform float uSoft;
uniform float uTime;
uniform float uAlphaMul;
uniform float uLightMul;
uniform float uHard;
out vec4 fragColor;
void main() {
  float r = length(vLocal);
  // 径向柔边：硬边圆点在粒子尺度下就是噪点，成熟实现一律走柔边（1-smoothstep）。
  // uHard=1（冰雹）例外：边缘收到 0.86 再把衰减指数压平，得到「硬质冰粒」的实心圆盘，
  // 与雪花的柔光点在质感上彻底分开。
  float edge = mix(0.2, 0.86, uHard);
  float core = 1.0 - smoothstep(edge, 1.0, r);
  float shape = pow(core, mix(1.0, 4.4, uSoft) * (1.0 - 0.85 * uHard));
  float twinkle = mix(1.0, 0.42 + 0.58 * (0.5 + 0.5 * sin(vPhase * 3.1 + uTime * 3.4)), uTwinkle);
  float alpha = shape * vAlpha * twinkle * uAlphaMul * (1.0 - vFog * 0.55);
  if (alpha <= 0.004) discard;
  vec3 col = mix(uColor, uFogColor, vFog * 0.85) * uLightMul;
  // 冰的材质：硬边（uHard）+ 一枚高光 + 边缘压暗，读起来是「硬质球体」；
  // 少了这三样，纯色实心圆会被看成棉花团（用户反馈）。
  if (uHard > 0.5) {
    vec2 hl = vLocal - vec2(-0.34, 0.34);
    float spec = 1.0 - smoothstep(0.0, 0.4, length(hl));
    col += vec3(0.92, 0.96, 1.0) * spec * 0.6;
    col *= 1.0 - smoothstep(0.62, 1.0, r) * 0.45;
    col *= 0.82 + 0.18 * (1.0 - r);
  }
  fragColor = vec4(col, alpha);
}
`;

    /**
     * 雨丝：实例化 quad 沿速度方向拉伸。
     *
     * 长度 = |vel| × 系数（快了自然更长，形成运动模糊），宽度是固定的世界尺寸，
     * 侧向用 cross(dir, toCamera) 展开，任何角度都不会退化成零宽。
     */
    const GL_LINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aPos;
layout(location = 2) in vec3 aVel;
layout(location = 3) in float aWidth;
layout(location = 4) in float aAlpha;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uStreak;
uniform float uFogDensity;
out float vT;
out float vSide;
out float vAlpha;
out float vFog;
void main() {
  float speed = length(aVel);
  vec3 dir = speed > 0.0001 ? aVel / speed : vec3(0.0, -1.0, 0.0);
  vec3 toCam = normalize(uCamPos - aPos);
  vec3 side = cross(dir, toCam);
  float sideLen = length(side);
  side = sideLen > 0.0001 ? side / sideLen : vec3(1.0, 0.0, 0.0);
  float len = clamp(speed * uStreak, 0.05, 0.85);
  // aCorner.y: 1 = 头部（当前落点），0 = 尾部（沿运动反方向拉开）
  vec3 world = aPos - dir * (len * (1.0 - aCorner.y)) + side * (aCorner.x * aWidth);
  vT = aCorner.y;
  vSide = aCorner.x;
  vAlpha = aAlpha;
  float dist = length(uCamPos - aPos);
  vFog = min(clamp(1.0 - exp(-uFogDensity * dist * 0.8), 0.0, 1.0), 0.6);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

    const GL_LINE_FS = `#version 300 es
precision highp float;
in float vT;
in float vSide;
in float vAlpha;
in float vFog;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uAlphaMul;
uniform float uLightMul;
out vec4 fragColor;
void main() {
  // 横向柔边 + 纵向渐隐：头亮尾淡，雨丝才像「一条被拉快的线」而不是一根棍子。
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
  float along = mix(0.06, 1.0, vT);
  float alpha = edge * along * vAlpha * uAlphaMul * (1.0 - vFog * 0.6);
  if (alpha <= 0.004) discard;
  vec3 col = mix(uColor, uFogColor, vFog * 0.8) * uLightMul;
  fragColor = vec4(col, alpha);
}
`;

    /** 涟漪：贴地（y≈0）的环形 quad，随寿命扩张并淡出。 */
    const GL_RIPPLE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aInst;
layout(location = 2) in float aAlpha;
uniform mat4 uViewProj;
out vec2 vLocal;
out float vAlpha;
void main() {
  vec3 world = vec3(aInst.x + aCorner.x * aInst.z, 0.004, aInst.y + aCorner.y * aInst.z);
  vLocal = aCorner;
  vAlpha = aAlpha;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

    const GL_RIPPLE_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vAlpha;
uniform vec3 uColor;
uniform float uAlphaMul;
out vec4 fragColor;
void main() {
  float r = length(vLocal);
  float ring = smoothstep(0.66, 0.94, r) * (1.0 - smoothstep(0.94, 1.0, r));
  float alpha = ring * vAlpha * uAlphaMul;
  if (alpha <= 0.004) discard;
  fragColor = vec4(uColor, alpha);
}
`;

    /** 闪电：CPU 侧把世界折线投影成裁空间三角带，直接以加法混合打上去。 */
    const GL_BOLT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aClip;
layout(location = 1) in float aAlpha;
out float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = vec4(aClip, 0.0, 1.0);
}
`;

    const GL_BOLT_FS = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(uColor * vAlpha, vAlpha);
}
`;

    /**
     * 收尾合成：暗角 / 闪电加亮 / 沙尘暖罩共用一次全屏绘制，靠 uMode 分支。
     * 0=暗角（黑色径向 alpha）1=竖向渐变叠色（云底闪光）2=纯色叠加（沙尘）。
     */
    const GL_COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform int uMode;
uniform vec4 uTint;
uniform float uVignette;
out vec4 fragColor;
void main() {
  if (uMode == 0) {
    float d = length((vNdc - vec2(0.0, 0.10)) * vec2(0.90, 1.0));
    fragColor = vec4(0.0, 0.0, 0.0, smoothstep(0.55, 1.45, d) * uVignette);
  } else if (uMode == 1) {
    float g = smoothstep(-0.9, 0.7, vNdc.y);
    fragColor = vec4(uTint.rgb, uTint.a * (0.25 + 0.75 * g));
  } else {
    fragColor = vec4(uTint.rgb, uTint.a);
  }
}
`;

    /** 着色器编译：失败要抛可读错误（上层据此回退 Canvas 2D）。 */
    const glCompileShader = (gl, type, source, label) => {
      const shader = gl.createShader(type);
      if (shader === null) throw new Error(`[dsh-wallpaper] 无法创建着色器：${label}`);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
        const log = gl.getShaderInfoLog(shader) ?? '(no log)';
        gl.deleteShader(shader);
        throw new Error(`[dsh-wallpaper] 着色器编译失败（${label}）：${log}`);
      }
      return shader;
    };

    /** 编译 + 链接一个程序，并把所有 uniform location 收集成扁平表。 */
    const glBuildProgram = (gl, vsSource, fsSource, label) => {
      const vs = glCompileShader(gl, gl.VERTEX_SHADER, vsSource, `${label}.vs`);
      const fs = glCompileShader(gl, gl.FRAGMENT_SHADER, fsSource, `${label}.fs`);
      const program = gl.createProgram();
      if (program === null) throw new Error(`[dsh-wallpaper] 无法创建程序：${label}`);
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
        const log = gl.getProgramInfoLog(program) ?? '(no log)';
        gl.deleteProgram(program);
        throw new Error(`[dsh-wallpaper] 程序链接失败（${label}）：${log}`);
      }
      const uniforms = Object.create(null);
      const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let index = 0; index < total; index += 1) {
        const info = gl.getActiveUniform(program, index);
        if (info === null || info === undefined) continue;
        const name = info.name.replace(/\[0\]$/, '');
        uniforms[name] = gl.getUniformLocation(program, info.name);
      }
      return { program, uniforms, label };
    };

    /** 编译全部程序；任何一步失败都抛错，由调用方决定回退。 */
    const glBuildAllPrograms = (gl) => ({
      sky: glBuildProgram(gl, GL_FULLSCREEN_VS, GL_SKY_FS, 'sky'),
      ground: glBuildProgram(gl, GL_GROUND_VS, GL_GROUND_FS, 'ground'),
      dot: glBuildProgram(gl, GL_DOT_VS, GL_DOT_FS, 'dot'),
      shadow: glBuildProgram(gl, GL_SHADOW_VS, GL_SHADOW_FS, 'shadow'),
      line: glBuildProgram(gl, GL_LINE_VS, GL_LINE_FS, 'line'),
      ripple: glBuildProgram(gl, GL_RIPPLE_VS, GL_RIPPLE_FS, 'ripple'),
      bolt: glBuildProgram(gl, GL_BOLT_VS, GL_BOLT_FS, 'bolt'),
      composite: glBuildProgram(gl, GL_FULLSCREEN_VS, GL_COMPOSITE_FS, 'composite'),
    });

    // ── 4×4 矩阵（列主序，直接喂 uniformMatrix4fv） ───────────────────────────
    const mat4Perspective = (out, fovyRad, aspect, near, far) => {
      const f = 1 / Math.tan(fovyRad / 2);
      const nf = 1 / (near - far);
      out[0] = f / aspect;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = f;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[14] = 2 * far * near * nf;
      out[15] = 0;
      return out;
    };

    const mat4LookAt = (out, eye, target, up) => {
      let zx = eye[0] - target[0];
      let zy = eye[1] - target[1];
      let zz = eye[2] - target[2];
      let len = Math.hypot(zx, zy, zz) || 1;
      zx /= len;
      zy /= len;
      zz /= len;
      let xx = up[1] * zz - up[2] * zy;
      let xy = up[2] * zx - up[0] * zz;
      let xz = up[0] * zy - up[1] * zx;
      len = Math.hypot(xx, xy, xz) || 1;
      xx /= len;
      xy /= len;
      xz /= len;
      const yx = zy * xz - zz * xy;
      const yy = zz * xx - zx * xz;
      const yz = zx * xy - zy * xx;
      out[0] = xx;
      out[1] = yx;
      out[2] = zx;
      out[3] = 0;
      out[4] = xy;
      out[5] = yy;
      out[6] = zy;
      out[7] = 0;
      out[8] = xz;
      out[9] = yz;
      out[10] = zz;
      out[11] = 0;
      out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      out[15] = 1;
      return out;
    };

    const mat4Multiply = (out, a, b) => {
      for (let col = 0; col < 4; col += 1) {
        const b0 = b[col * 4];
        const b1 = b[col * 4 + 1];
        const b2 = b[col * 4 + 2];
        const b3 = b[col * 4 + 3];
        out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
      }
      return out;
    };

    /**
     * 天气粒子引擎（WebGL2 真 3D，零依赖，自写着色器）。
     *
     * 为什么不用 three.js：插件要求「拷即构建」——构建脚本只做语法检查、没有打包器，
     * 所有代码必须内联进 client.js；three.js 本体 600KB+，塞进来既拖慢加载又要改
     * 构建链。这个场景只有 7 个着色器程序、两种实例化批次，原生 WebGL2 完全够用，
     * 而且能把每一个视觉参数（雾、雪深、闪电）直接摊在代码里，不用穿过一层抽象。
     *
     * 接口与 Canvas 2D 引擎逐字一致（setWeather/setEnv/resize/stop/dispose/stats），
     * 所以 renderMode / syncEngine / 导演 / 调试行一行都不用改。
     *
     * 任何一步失败（无 webgl2、着色器编不过、?renderer=canvas）都返回 null，
     * 调用方据此回退 Canvas 2D。
     *
     * @param canvas 背景层创建的全屏画布元素。
     * @param options.forceCanvas 显式禁用 WebGL（测试与降级用）。
     */
    const createWebglWeatherEngine = (canvas, options = {}) => {
      if (options.forceCanvas === true) return null;
      // 查询参数强制回退：QA 用 ?renderer=canvas 跑既有 Canvas 断言。
      if (/[?&]renderer=canvas(&|=|$)/.test(window.location.search)) return null;

      /**
       * 先在一张临时画布上把 7 个程序全部编译链接一遍。
       *
       * 这不是保险，是必须的：真实画布一旦成功拿过 'webgl2' 上下文就永远拿不到
       * '2d'，如果先占住再编译失败，回退路径会拿到 null 上下文变成一块死画布。
       * 探测全部通过后再去真实画布取上下文，失败概率等于 0。
       */
      const probe = document.createElement('canvas');
      probe.width = 4;
      probe.height = 4;
      let probeGl = null;
      try {
        probeGl = probe.getContext('webgl2', GL_CONTEXT_ATTRS);
      } catch {
        probeGl = null;
      }
      if (probeGl === null) return null;
      try {
        const probePrograms = glBuildAllPrograms(probeGl);
        for (const program of Object.values(probePrograms)) probeGl.deleteProgram(program.program);
        probeGl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch (error) {
        // 可读错误 + 回退：既让控制台留下证据，也不让用户看到黑屏。
        console.warn(`[dsh-wallpaper] WebGL2 不可用，回退 Canvas 2D：${error.message}`);
        probeGl.getExtension('WEBGL_lose_context')?.loseContext();
        return null;
      }

      const gl = canvas.getContext('webgl2', GL_CONTEXT_ATTRS);
      if (gl === null) return null;

      let programs;
      try {
        programs = glBuildAllPrograms(gl);
      } catch (error) {
        console.error(`[dsh-wallpaper] WebGL2 程序构建失败：${error.message}`);
        return null;
      }

      /** 调试期每帧 gl.getError() 检查（?gldebug=1 打开，结果挂到 window）。 */
      const debugGl = /[?&]gldebug=1/.test(window.location.search);
      if (debugGl) window.__dshGlErrors = [];
      const checkGl = (where) => {
        if (!debugGl) return;
        const code = gl.getError();
        if (code !== gl.NO_ERROR) {
          window.__dshGlErrors.push(`${where}:0x${code.toString(16)}`);
          if (window.__dshGlErrors.length <= 12) console.warn('[dsh-wallpaper] GL error', where, code);
        }
      };

      // 让 devtools 一眼看出这条画布走的是哪条渲染路径。
      canvas.dataset.renderer = 'webgl2';

      // ── 引擎状态（与 Canvas 引擎同名同义） ─────────────────────────────────
      let state = 'idle';
      let kind = null;
      let preset = null;
      let env = { isDay: true, effectScale: 1, reducedMotion: false, width: 0, height: 0 };
      let frameHandle = 0;
      let lastFrameAt = 0;
      /** 着色器用的累计时间（秒）：暂停时不推进，恢复后从原处继续。 */
      let clock = 0;
      /** kind 切换后粒子池的淡入系数（0→1，400ms）。 */
      let particleRamp = 1;
      /** 自适应质量档位：2=满档、1=中档、0=最低档（DRS，带迟滞）。 */
      let quality = 2;
      /** 后台恢复后的第一帧 dt 强制归零，防止隐藏期积压的时长一次跳完。 */
      let skipDtOnce = false;
      let blendAt = 0;
      let blendFromValid = false;
      let cssWidth = 1;
      let cssHeight = 1;

      /** 参数三缓冲：live 是当前实际用的值，from→target 由插值推进。 */
      const live = new Float32Array(P_LEN);
      const fromParams = new Float32Array(P_LEN);
      const targetParams = new Float32Array(P_LEN);

      // ── 相机与矩阵 ────────────────────────────────────────────────────────
      const projection = new Float32Array(16);
      const viewMatrix = new Float32Array(16);
      const viewProj = new Float32Array(16);
      const camFwd = new Float32Array([0, 0, -1]);
      const camRight = new Float32Array([1, 0, 0]);
      const camUp = new Float32Array([0, 1, 0]);
      const tanHalf = new Float32Array([GL_TAN_HALF, GL_TAN_HALF]);
      /** 定向光：略偏右上，雪堆的明暗面才看得出来。 */
      const LIGHT_DIR = new Float32Array([0.42, 0.78, 0.46]);
      const SUN_DIR = new Float32Array([0.30, 0.31, -0.90]);
      {
        const len = Math.hypot(LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2]);
        LIGHT_DIR[0] /= len;
        LIGHT_DIR[1] /= len;
        LIGHT_DIR[2] /= len;
        const sunLen = Math.hypot(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
        SUN_DIR[0] /= sunLen;
        SUN_DIR[1] /= sunLen;
        SUN_DIR[2] /= sunLen;
      }

      /** 重算投影/视图矩阵与相机基向量：resize 与初始化都要走一遍。 */
      const updateCamera = () => {
        const cosPitch = Math.cos(GL_PITCH);
        const sinPitch = Math.sin(GL_PITCH);
        camFwd[0] = 0;
        camFwd[1] = sinPitch;
        camFwd[2] = -cosPitch;
        camRight[0] = 1;
        camRight[1] = 0;
        camRight[2] = 0;
        camUp[0] = 0;
        camUp[1] = cosPitch;
        camUp[2] = sinPitch;
        const aspect = cssWidth / Math.max(1, cssHeight);
        mat4Perspective(projection, (GL_FOV_DEG * Math.PI) / 180, aspect, GL_NEAR, GL_FAR);
        mat4LookAt(
          viewMatrix,
          GL_EYE,
          [GL_EYE[0] + camFwd[0], GL_EYE[1] + camFwd[1], GL_EYE[2] + camFwd[2]],
          [0, 1, 0],
        );
        mat4Multiply(viewProj, projection, viewMatrix);
        tanHalf[0] = GL_TAN_HALF * aspect;
        tanHalf[1] = GL_TAN_HALF;
      };

      // ── GL 资源：缓冲、VAO、纹理 ──────────────────────────────────────────
      const emptyVao = gl.createVertexArray();
      const quadBuffer = gl.createBuffer();
      const streakBuffer = gl.createBuffer();
      const groundBuffer = gl.createBuffer();
      const dotBuffer = gl.createBuffer();
      const lineBuffer = gl.createBuffer();
      const splashBuffer = gl.createBuffer();
      const rippleBuffer = gl.createBuffer();
      const boltBuffer = gl.createBuffer();

      // 点/涟漪共用的 [-1,1]² 单位四边形（两个三角形，TRIANGLE_STRIP 顺序）。
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      // 雨丝：x∈[-1,1] 横向、y∈{0,1} 沿速度方向（0=尾 1=头）。
      gl.bindBuffer(gl.ARRAY_BUFFER, streakBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);
      // 地面：一整块矩形，只有 4 个顶点——世界坐标靠插值，雾与伪法线全在片元里算。
      gl.bindBuffer(gl.ARRAY_BUFFER, groundBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          GL_GROUND.x0, GL_GROUND.z0,
          GL_GROUND.x1, GL_GROUND.z0,
          GL_GROUND.x0, GL_GROUND.z1,
          GL_GROUND.x1, GL_GROUND.z1,
        ]),
        gl.STATIC_DRAW,
      );

      // 实例缓冲先按上限一次性分配：之后每帧只做 bufferSubData，不再触碰显存分配。
      const allocateDynamic = (buffer, bytes) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
      };
      allocateDynamic(dotBuffer, GL_DOT_CAP * 6 * 4);
      allocateDynamic(lineBuffer, GL_LINE_CAP * 8 * 4);
      allocateDynamic(splashBuffer, GL_SPLASH_CAP * 6 * 4);
      allocateDynamic(rippleBuffer, GL_RIPPLE_CAP * 4 * 4);
      allocateDynamic(boltBuffer, 16 * 2 * 3 * 4);

      /** 配置「角点缓冲 + 实例缓冲」的 VAO；步长与偏移必须和 CPU 侧打包顺序一致。 */
      const buildDotVao = (instanceBuffer) => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
        // [x,y,z,size,phase,alpha] = 6 float = 24 byte
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 12);
        gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 16);
        gl.vertexAttribDivisor(3, 1);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 24, 20);
        gl.vertexAttribDivisor(4, 1);
        gl.bindVertexArray(null);
        return vao;
      };

      const dotVao = buildDotVao(dotBuffer);
      const splashVao = buildDotVao(splashBuffer);
      const lineVao = (() => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, streakBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        // [x,y,z, vx,vy,vz, width, alpha] = 8 float = 32 byte
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 12);
        gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 32, 24);
        gl.vertexAttribDivisor(3, 1);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 32, 28);
        gl.vertexAttribDivisor(4, 1);
        gl.bindVertexArray(null);
        return vao;
      })();
      const groundVao = (() => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, groundBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        return vao;
      })();
      const rippleVao = (() => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, rippleBuffer);
        // [x, z, radius, alpha] = 4 float = 16 byte
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 16, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 16, 12);
        gl.vertexAttribDivisor(2, 1);
        gl.bindVertexArray(null);
        return vao;
      })();
      const boltVao = (() => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, boltBuffer);
        // [clipX, clipY, alpha] = 3 float = 12 byte
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
        gl.bindVertexArray(null);
        return vao;
      })();

      // 地面纹理：R8 单通道，128² 对 112×72 的物理网格足够（重采样时做双线性）。
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const snowPixels = new Uint8Array(GL_TEX_SIZE * GL_TEX_SIZE);
      const wetPixels = new Uint8Array(GL_TEX_SIZE * GL_TEX_SIZE);
      const makeTexture = () => {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, GL_TEX_SIZE, GL_TEX_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // 初始 0 = 裸地：第一帧不该先闪一层白。
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GL_TEX_SIZE, GL_TEX_SIZE, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(GL_TEX_SIZE * GL_TEX_SIZE));
        return texture;
      };
      const snowTexture = makeTexture();
      const wetTexture = makeTexture();

      // ── 地面状态（跨 kind 保留，只靠融化消退） ─────────────────────────────
      const cellCount = GL_FIELD_COLS * GL_FIELD_ROWS;
      const snowGrid = new Float32Array(cellCount);
      const wetGrid = new Float32Array(cellCount);
      let groundHasContent = false;
      let texLastAt = 0;

      const resetGround = () => {
        snowGrid.fill(0);
        wetGrid.fill(0);
        groundHasContent = true; // 逼一次上传，把纹理也清零
        texLastAt = 0;
      };

      // ── 粒子池（CPU 物理 + 实例缓冲） ──────────────────────────────────────
      /** 当前 kind 的粒子颜色（0..1）：每次重铺时刷新一次，热路径不做解析与分配。 */
      const tintRgb = new Float32Array([1, 1, 1]);
      const splashTint = new Float32Array([0.86, 0.92, 1.0]);
      const refreshTint = () => {
        const override = (GL_KIND_LOOK[kind] ?? {}).tint;
        if (override !== undefined) {
          tintRgb[0] = override[0];
          tintRgb[1] = override[1];
          tintRgb[2] = override[2];
          return;
        }
        const rgb = toRgb((preset ?? KIND_PRESETS.cloudy).tint[env.isDay ? 0 : 1]);
        tintRgb[0] = rgb[0] / 255;
        tintRgb[1] = rgb[1] / 255;
        tintRgb[2] = rgb[2] / 255;
      };
      /** 点粒子：[x,y,z,size,phase,alpha] × N */
      const dotData = new Float32Array(GL_DOT_CAP * 6);
      /** 速度：[vx,vy,vz] × N */
      const dotVel = new Float32Array(GL_DOT_CAP * 3);
      /** 冰雹的剩余弹跳次数：硬质体「弹一下再碎」需要独立计数（phase 槽被摆动占用）。 */
      const dotBounce = new Float32Array(GL_DOT_CAP);
      /** 每粒子年龄（秒）：重生归零，驱动淡入，消除重生「闪现」。 */
      const dotAge = new Float32Array(GL_DOT_CAP);
      /** 每粒子基准不透明度：输出 alpha = 基准 × min(1, age/淡入时长)。 */
      const dotAlpha0 = new Float32Array(GL_DOT_CAP);
      let dotCount = 0;
      /** 点粒子的行为模式（整池同一种，来自当前 kind）。 */
      let dotMode = 'sway';
      let dotSway = 0.2;
      let dotSoft = 0;
      let dotTwinkle = 0;
      /** billboard 的横向拉伸比：1=正圆，>1=横向拉长（雾团/沙尘）。 */
      let dotStretch = 1;

      /** 雨丝：[x,y,z, vx,vy,vz, width, alpha] × N */
      const lineData = new Float32Array(GL_LINE_CAP * 8);
      /** 每条雨丝年龄（秒）与基准不透明度：同点粒子的淡入语义。 */
      const lineAge = new Float32Array(GL_LINE_CAP);
      const lineAlpha0 = new Float32Array(GL_LINE_CAP);
      let lineCount = 0;
      let lineGravity = 0;
      let lineTerminal = 0;

      /** 溅射液滴复用点着色器，但物理独立（重力抛物线 + 寿命）。 */
      const splashData = new Float32Array(GL_SPLASH_CAP * 6);
      const splashVel = new Float32Array(GL_SPLASH_CAP * 3);
      const splashLife = new Float32Array(GL_SPLASH_CAP);
      const splashTtl = new Float32Array(GL_SPLASH_CAP);
      let splashCount = 0;

      /** 涟漪：[x, z, radius, alpha] × N */
      const rippleData = new Float32Array(GL_RIPPLE_CAP * 4);
      const rippleLife = new Float32Array(GL_RIPPLE_CAP);
      const rippleTtl = new Float32Array(GL_RIPPLE_CAP);
      const rippleMax = new Float32Array(GL_RIPPLE_CAP);
      let rippleCount = 0;

      /** 视口面积比 × 强度 × 质量档系数：与 Canvas 引擎的 targetCount 同一套缩放语义。 */
      const scaleCount = (base, factor) => {
        if (base <= 0) return 0;
        const area = (env.width * env.height) / ENGINE_BASE_AREA;
        const scaled = Math.round(base * factor * area * env.effectScale * GL_QUALITY_COUNT[quality]);
        return Math.max(1, Math.min(GL_DOT_CAP, scaled));
      };

      const randomRange = (min, max) => min + Math.random() * (max - min);

      /** 落点世界坐标 → 网格索引；越界返回 -1（粒子落在矩形外，直接丢弃沉积）。 */
      const cellIndex = (worldX, worldZ) => {
        const u = (worldX - GL_FIELD.x0) / (GL_FIELD.x1 - GL_FIELD.x0);
        const v = (worldZ - GL_FIELD.z0) / (GL_FIELD.z1 - GL_FIELD.z0);
        if (u < 0 || u > 0.999 || v < 0 || v > 0.999) return -1;
        return Math.floor(v * GL_FIELD_ROWS) * GL_FIELD_COLS + Math.floor(u * GL_FIELD_COLS);
      };

      /**
       * 雪/冰雹沉积：单格加上去，同时往 3×3 邻域摊一点。
       * 只写单格会在 112×72 的网格上留下针状尖刺，雪面看起来像噪点而不是雪堆。
       */
      const depositSnow = (worldX, worldZ, amount) => {
        const index = cellIndex(worldX, worldZ);
        if (index < 0) return;
        snowGrid[index] = Math.min(SNOW_MAX_PX, snowGrid[index] + amount);
        const row = Math.floor(index / GL_FIELD_COLS);
        const col = index - row * GL_FIELD_COLS;
        const share = amount * 0.3;
        for (let dr = -1; dr <= 1; dr += 1) {
          const r = row + dr;
          if (r < 0 || r >= GL_FIELD_ROWS) continue;
          for (let dc = -1; dc <= 1; dc += 1) {
            if (dr === 0 && dc === 0) continue;
            const c = col + dc;
            if (c < 0 || c >= GL_FIELD_COLS) continue;
            const target = r * GL_FIELD_COLS + c;
            snowGrid[target] = Math.min(SNOW_MAX_PX, snowGrid[target] + share);
          }
        }
        groundHasContent = true;
      };

      const depositWet = (worldX, worldZ, amount) => {
        const index = cellIndex(worldX, worldZ);
        if (index < 0) return;
        wetGrid[index] = Math.min(1, wetGrid[index] + amount);
        groundHasContent = true;
      };

      /** 溅射液滴：向上初速由冲击速度决定，重力回落；池满则丢弃（不影响主循环）。 */
      const spawnSplash = (worldX, worldY, worldZ, physics, impact) => {
        if (physics.splash <= 0 || splashCount >= GL_SPLASH_CAP) return;
        const burst = Math.min(physics.splash, GL_SPLASH_CAP - splashCount);
        for (let n = 0; n < burst; n += 1) {
          const index = splashCount;
          splashCount += 1;
          splashData[index * 6] = worldX + randomRange(-0.12, 0.12);
          splashData[index * 6 + 1] = Math.max(0.01, worldY);
          splashData[index * 6 + 2] = worldZ + randomRange(-0.12, 0.12);
          splashData[index * 6 + 3] = randomRange(0.018, 0.042) * physics.splashSize;
          splashData[index * 6 + 4] = Math.random() * Math.PI * 2;
          splashData[index * 6 + 5] = 0.85;
          splashVel[index * 3] = randomRange(-1.1, 1.1);
          splashVel[index * 3 + 1] = 1.1 + Math.min(2.4, impact * 0.09) * randomRange(0.5, 1.0);
          splashVel[index * 3 + 2] = randomRange(-0.6, 0.6);
          splashLife[index] = 0;
          splashTtl[index] = randomRange(0.28, 0.52);
        }
      };

      const spawnRipple = (worldX, worldZ) => {
        if (rippleCount >= GL_RIPPLE_CAP) return;
        const index = rippleCount;
        rippleCount += 1;
        rippleData[index * 4] = worldX;
        rippleData[index * 4 + 1] = worldZ;
        rippleData[index * 4 + 2] = 0.05;
        rippleData[index * 4 + 3] = 0.5;
        rippleLife[index] = 0;
        rippleTtl[index] = randomRange(0.42, 0.68);
        rippleMax[index] = randomRange(0.26, 0.55);
      };

      /** 池内删除用「末尾搬过来」代替 splice：热路径零分配、零搬移。 */
      const compactSplash = (index) => {
        const last = splashCount - 1;
        if (index !== last) {
          splashData.copyWithin(index * 6, last * 6, last * 6 + 6);
          splashVel.copyWithin(index * 3, last * 3, last * 3 + 3);
          splashLife[index] = splashLife[last];
          splashTtl[index] = splashTtl[last];
        }
        splashCount = last;
      };

      const compactRipple = (index) => {
        const last = rippleCount - 1;
        if (index !== last) {
          rippleData.copyWithin(index * 4, last * 4, last * 4 + 4);
          rippleLife[index] = rippleLife[last];
          rippleTtl[index] = rippleTtl[last];
          rippleMax[index] = rippleMax[last];
        }
        rippleCount = last;
      };

      /** 点粒子按当前 kind 重新铺满整池（位置、速度、尺寸一次成型）。 */
      const respawnDots = (nextKind) => {
        const p = KIND_PRESETS[nextKind];
        const look = GL_KIND_LOOK[nextKind] ?? {};
        const isBlob = p.shape === 'blob';
        // 逐 kind 的可见度修正：沙尘这类「底色与粒子同色系」的场景必须单独放大，
        // 不能动全局，否则雪/雨会一起变糊。
        const sizeScale = look.dotScale ?? 1;
        const alphaScale = look.dotAlpha ?? 1;
        dotStretch = look.dotStretch ?? (isBlob ? 2.6 : 1);
        dotCount = scaleCount(p.count, (isBlob ? GL_BLOB_SCALE : GL_COUNT_SCALE) * (look.dotCountScale ?? 1));
        dotSoft = isBlob ? 1 : 0;
        dotTwinkle = p.fx.twinkle === true ? 1 : 0;
        if (isBlob) {
          dotMode = 'drift';
          dotSway = 0;
        } else if (p.motion === 'sway') {
          dotMode = 'sway';
          dotSway = (p.fx.sway ?? 10) * 0.02; // px → 世界单位
        } else if (p.motion === 'fall') {
          dotMode = 'fall';
          dotSway = 0;
        } else if (p.motion === 'rise') {
          dotMode = 'rise';
          dotSway = 0.05;
        } else {
          dotMode = 'fly';
          dotSway = 0.02;
        }
        const alphaBase = Math.min(1, p.alpha * alphaScale) * (env.isDay ? 1 : 0.75);
        for (let index = 0; index < dotCount; index += 1) {
          const o = index * 6;
          const v = index * 3;
          if (isBlob) {
            // 雾团/云影：巨型 billboard 铺在远处低空，横向缓慢漂移。
            dotData[o] = randomRange(-20, 20);
            dotData[o + 1] = randomRange(0.8, 5.5);
            dotData[o + 2] = randomRange(-38, -8);
            dotData[o + 3] = randomRange(p.size[0], p.size[1]) * GL_PX2W * 1.6;
            dotVel[v] = p.speed * randomRange(0.4, 1.1);
            dotVel[v + 1] = 0;
            dotVel[v + 2] = 0;
            // 雾团是「一层薄雾」，不是一颗颗球：把不透明度压到原来四成
            dotData[o + 5] = alphaBase * randomRange(0.34, 0.62);
          } else if (p.shape === 'dot' && p.motion === 'sway') {
            // 雪花同样要从画面上沿之上进来：按深度反解高度（同冰雹的斜率 0.78），
            // 否则远处的雪花会在半空里凭空出现。
            const z = randomRange(-30, -1);
            dotData[o] = randomRange(-11, 11);
            dotData[o + 2] = z;
            dotData[o + 1] = 2.2 + Math.abs(z) * 0.74 + randomRange(1, 6);
            dotData[o + 3] = randomRange(0.035, 0.085) * sizeScale;
            dotVel[v] = randomRange(-0.15, 0.15);
            dotVel[v + 1] = -p.speed * 0.75 * randomRange(0.8, 1.25);
            dotVel[v + 2] = 0;
            dotData[o + 5] = alphaBase * randomRange(0.7, 1.0);
          } else if (p.shape === 'dot' && p.motion === 'fall') {
            // 冰雹：从天而降。起点必须落在「画面上沿之上」——按深度反解高度
            // （相机高 2.2、仰角 14°、垂直半视场 22.5° → 斜率约 0.78），
            // 否则近处的冰雹会凭空出现在半空里。
            const z = randomRange(-28, -1);
            dotData[o] = randomRange(-11, 11);
            dotData[o + 2] = z;
            dotData[o + 1] = 2.2 + Math.abs(z) * 0.78 + randomRange(1.5, 7);
            dotData[o + 3] = randomRange(0.07, 0.14) * sizeScale;
            // 垂直下落：冰雹是致密硬质体，不受雪那样的大气横向摆动。
            dotVel[v] = 0;
            dotVel[v + 1] = -p.speed * 1.4 * randomRange(0.85, 1.2);
            dotVel[v + 2] = 0;
            dotData[o + 5] = alphaBase;
            dotBounce[index] = Math.random() < 0.3 ? 1 : 0;
          } else if (p.motion === 'rise' || p.motion === 'fly') {
            // 光尘/沙尘：随风横飞，或极慢上浮
            dotData[o] = randomRange(-13, 13);
            dotData[o + 1] = randomRange(0.3, 8);
            dotData[o + 2] = randomRange(-26, -1);
            const grain = Math.random();
            dotData[o + 3] = randomRange(0.018, 0.05) * (grain < 0.14 ? 3.0 : 1) * sizeScale;
            dotVel[v] = p.motion === 'rise' ? randomRange(-0.05, 0.05) : p.speed * randomRange(0.22, 0.8);
            dotVel[v + 1] = p.motion === 'rise' ? randomRange(0.05, 0.18) : randomRange(-0.25, 0.25);
            dotVel[v + 2] = 0;
            dotData[o + 5] = alphaBase * randomRange(0.45, 1.0);
          } else {
            dotData[o] = randomRange(-12, 12);
            dotData[o + 1] = randomRange(0.4, 10);
            dotData[o + 2] = randomRange(-26, -1);
            dotData[o + 3] = randomRange(0.04, 0.08) * sizeScale;
            dotVel[v] = 0;
            dotVel[v + 1] = -1;
            dotVel[v + 2] = 0;
            dotData[o + 5] = alphaBase;
          }
          dotData[o + 4] = Math.random() * Math.PI * 2;
          // 基准不透明度单独存一份：输出槽每帧会被淡入系数改写，不能再当基准用。
          dotAlpha0[index] = dotData[o + 5];
          dotAge[index] = 0;
        }
      };

      /** 雨丝池：速度方向决定拉伸方向，宽度是世界尺寸（换算后约 1–2px）。 */
      const respawnLines = (nextKind) => {
        const p = KIND_PRESETS[nextKind];
        const look = GL_KIND_LOOK[nextKind] ?? {};
        const boost = look.lineBoost ?? 1;
        const widthScale = look.lineWidth ?? 1;
        const alphaLine = Math.min(1, p.alpha * boost) * (env.isDay ? 1 : 0.72);
        lineCount = scaleCount(p.count, GL_COUNT_SCALE);
        lineGravity = 0;
        if (p.motion === 'fall') {
          const slant = p.fx.slant;
          const angle = slant ? ((slant[0] + slant[1]) / 2) * (Math.PI / 180) : 0;
          lineTerminal = p.speed * 1.65;
          for (let index = 0; index < lineCount; index += 1) {
            const o = index * 8;
            const speed = lineTerminal * randomRange(0.85, 1.15);
            const z = randomRange(-32, 1);
            lineData[o] = randomRange(-13, 13);
            lineData[o + 2] = z;
            // 雨丝也从画面上沿之上开始：否则肉眼会在天空中间看到雨「冒出来」。
            lineData[o + 1] = 2.2 + Math.abs(z) * 0.74 + randomRange(1, 6);
            lineData[o + 3] = Math.tan(angle) * speed * randomRange(0.7, 1.3);
            lineData[o + 4] = -speed;
            lineData[o + 5] = 0;
            lineData[o + 6] = p.width * 0.011 * widthScale * randomRange(0.8, 1.3);
            lineData[o + 7] = alphaLine;
            lineAlpha0[index] = alphaLine;
            lineAge[index] = 0;
          }
        } else {
          // 狂风：横飞，速度作为水平分量
          lineTerminal = p.speed * 1.65;
          for (let index = 0; index < lineCount; index += 1) {
            const o = index * 8;
            // 横飞类（狂风）速度差拉大：快的那条拉得更长，层次才出来
            const speed = lineTerminal * randomRange(0.5, 1.6);
            lineData[o] = randomRange(-16, 16);
            lineData[o + 1] = randomRange(0.3, 9);
            lineData[o + 2] = randomRange(-28, -1);
            lineData[o + 3] = speed;
            lineData[o + 4] = randomRange(-1.2, 1.2);
            lineData[o + 5] = 0;
            lineData[o + 6] = p.width * 0.011 * widthScale * randomRange(0.8, 1.3);
            lineData[o + 7] = alphaLine;
            lineAlpha0[index] = alphaLine;
            lineAge[index] = 0;
          }
        }
      };

      /** kind 变化后两个池都按新预设重铺（交叉淡化由 particleRamp 负责）。 */
      const respawnPools = (nextKind) => {
        const shape = KIND_PRESETS[nextKind]?.shape;
        refreshTint();
        if (shape === 'line') {
          respawnLines(nextKind);
          dotCount = 0;
        } else {
          respawnDots(nextKind);
          lineCount = 0;
        }
        splashCount = 0;
        rippleCount = 0;
        // 新一批冰雹最多弹一次（冰是脆的，弹起来就该碎）。
        dotBounce.fill(0);
      };

      /** 只按 effectScale 微调数量：拖动强度滑块时按新数量重铺，位置重置可接受。 */
      const adjustCounts = () => {
        if (kind === null) return;
        respawnPools(kind);
      };

      // ── 参数推导与插值 ────────────────────────────────────────────────────
      const lift = (color, amount) => [
        color[0] + (1 - color[0]) * amount,
        color[1] + (1 - color[1]) * amount,
        color[2] + (1 - color[2]) * amount,
      ];

      /** 把 kind 的预设 + 昼夜 + 质感表压成 27 个浮点，供插值与上传使用。 */
      const deriveParams = (nextKind, out) => {
        const p = KIND_PRESETS[nextKind] ?? KIND_PRESETS.cloudy;
        const look = GL_KIND_LOOK[nextKind] ?? GL_KIND_LOOK.cloudy;
        const day = env.isDay !== false;
        const stops = p.backdrop[day ? 'day' : 'night'];
        const top = toRgb(stops[0]);
        const mid = toRgb(stops[1]);
        const topF = [top[0] / 255, top[1] / 255, top[2] / 255];
        const midF = [mid[0] / 255, mid[1] / 255, mid[2] / 255];
        const horizon = lift(midF, look.horizonLift);
        const fogColor = lift(midF, look.horizonLift * 0.8);
        const dim = day ? 1 : 0.7;
        const snowColor = day ? [0.88, 0.92, 0.97] : [0.70, 0.76, 0.87];
        // 个别 kind 自带天空色（晴天用真正的白天蓝）；夜间仍走预设的夜色，不然天亮着。
        if (look.sky !== undefined && day) {
          topF[0] = look.sky.top[0];
          topF[1] = look.sky.top[1];
          topF[2] = look.sky.top[2];
          midF[0] = look.sky.mid[0];
          midF[1] = look.sky.mid[1];
          midF[2] = look.sky.mid[2];
          horizon[0] = look.sky.horizon[0];
          horizon[1] = look.sky.horizon[1];
          horizon[2] = look.sky.horizon[2];
          fogColor[0] = look.sky.horizon[0];
          fogColor[1] = look.sky.horizon[1];
          fogColor[2] = look.sky.horizon[2];
        }
        const wash = look.wash ?? [0, 0, 0];
        out[P_SKY_TOP] = topF[0];
        out[P_SKY_TOP + 1] = topF[1];
        out[P_SKY_TOP + 2] = topF[2];
        out[P_SKY_MID] = midF[0];
        out[P_SKY_MID + 1] = midF[1];
        out[P_SKY_MID + 2] = midF[2];
        out[P_HORIZON] = horizon[0];
        out[P_HORIZON + 1] = horizon[1];
        out[P_HORIZON + 2] = horizon[2];
        out[P_FOG] = fogColor[0];
        out[P_FOG + 1] = fogColor[1];
        out[P_FOG + 2] = fogColor[2];
        out[P_GROUND] = look.ground[0] * dim;
        out[P_GROUND + 1] = look.ground[1] * dim;
        out[P_GROUND + 2] = look.ground[2] * dim;
        out[P_SNOW] = snowColor[0];
        out[P_SNOW + 1] = snowColor[1];
        out[P_SNOW + 2] = snowColor[2];
        out[P_FOG_DENSITY] = look.fog;
        out[P_CLOUD] = look.cloud;
        out[P_SUN] = look.sun * (day ? 1 : 0.1);
        out[P_VIGNETTE] = look.vignette;
        out[P_WASH] = wash[0];
        out[P_WASH + 1] = wash[1];
        out[P_WASH + 2] = wash[2];
        out[P_WASH_ALPHA] = look.wash ? (day ? 0.06 : 0.04) : 0;
        out[P_SPEC] = 1;
        // 三个新增槽位都有兜底值：没写 hazeBand/ray/sunGain 的 kind 保持旧观感。
        out[P_HAZE_BAND] = look.hazeBand ?? 0.24;
        out[P_RAY] = look.ray ?? 0;
        out[P_SUN_GAIN] = look.sunGain ?? 1;
        return out;
      };

      /**
       * 推进 400ms 参数插值。
       *
       * 手动切换（instant）根本不进这里：upper 层要的是「立刻换场」，插值反而是延迟。
       */
      const stepParams = (now) => {
        if (!blendFromValid) {
          live.set(targetParams);
          return;
        }
        const t = Math.min(1, (now - blendAt) / GL_BLEND_MS);
        // ease-out cubic：起步快、收尾稳（Material Motion / react-spring 的标准出线），
        // 线性/对称 smoothstep 在起点的拖沓正是「机械感」的来源。
        const u = 1 - t;
        const k = 1 - u * u * u;
        for (let index = 0; index < P_LEN; index += 1) {
          live[index] = fromParams[index] + (targetParams[index] - fromParams[index]) * k;
        }
        particleRamp = k;
        if (t >= 1) blendFromValid = false;
      };

      // ── 地面物理 ──────────────────────────────────────────────────────────
      /** 休止角松弛：相邻格高差过大时往低处摊，雪面才是一条平缓的岸线而不是尖刺。 */
      const relaxGround = () => {
        for (let row = 0; row < GL_FIELD_ROWS; row += 1) {
          const base = row * GL_FIELD_COLS;
          for (let col = 0; col < GL_FIELD_COLS - 1; col += 1) {
            const left = base + col;
            const right = left + 1;
            const diff = snowGrid[left] - snowGrid[right];
            if (diff > 1.2) {
              const move = diff * 0.14;
              snowGrid[left] -= move;
              snowGrid[right] += move;
            } else if (diff < -1.2) {
              const move = -diff * 0.14;
              snowGrid[left] += move;
              snowGrid[right] -= move;
            }
          }
        }
      };

      /** 网格 → 128² 纹理（双线性），10Hz 上传；没有内容时干脆跳过。 */
      const uploadGroundTextures = (now) => {
        if (!groundHasContent) return;
        if (now - texLastAt < GL_TEX_INTERVAL_MS) return;
        texLastAt = now;
        let snowSum = 0;
        let wetSum = 0;
        for (let index = 0; index < cellCount; index += 1) {
          snowSum += snowGrid[index];
          wetSum += wetGrid[index];
        }
        if (snowSum <= 0.01 && wetSum <= 0.001) {
          // 全干全净：只需要清一次纹理，然后不再上传
          if (groundHasContent === true) {
            snowPixels.fill(0);
            wetPixels.fill(0);
            gl.bindTexture(gl.TEXTURE_2D, snowTexture);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GL_TEX_SIZE, GL_TEX_SIZE, gl.RED, gl.UNSIGNED_BYTE, snowPixels);
            gl.bindTexture(gl.TEXTURE_2D, wetTexture);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GL_TEX_SIZE, GL_TEX_SIZE, gl.RED, gl.UNSIGNED_BYTE, wetPixels);
            groundHasContent = false;
          }
          return;
        }
        const cols = GL_FIELD_COLS;
        const rows = GL_FIELD_ROWS;
        for (let py = 0; py < GL_TEX_SIZE; py += 1) {
          const v = ((py + 0.5) / GL_TEX_SIZE) * (rows - 1);
          const y0 = Math.floor(v);
          const y1 = Math.min(rows - 1, y0 + 1);
          const ty = v - y0;
          for (let px = 0; px < GL_TEX_SIZE; px += 1) {
            const u = ((px + 0.5) / GL_TEX_SIZE) * (cols - 1);
            const x0 = Math.floor(u);
            const x1 = Math.min(cols - 1, x0 + 1);
            const tx = u - x0;
            const i00 = y0 * cols + x0;
            const i10 = y0 * cols + x1;
            const i01 = y1 * cols + x0;
            const i11 = y1 * cols + x1;
            const snow =
              (snowGrid[i00] * (1 - tx) + snowGrid[i10] * tx) * (1 - ty) +
              (snowGrid[i01] * (1 - tx) + snowGrid[i11] * tx) * ty;
            const wet =
              (wetGrid[i00] * (1 - tx) + wetGrid[i10] * tx) * (1 - ty) +
              (wetGrid[i01] * (1 - tx) + wetGrid[i11] * tx) * ty;
            const offset = py * GL_TEX_SIZE + px;
            snowPixels[offset] = Math.min(255, Math.round((snow / SNOW_MAX_PX) * 255));
            wetPixels[offset] = Math.min(255, Math.round(wet * 255));
          }
        }
        gl.bindTexture(gl.TEXTURE_2D, snowTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GL_TEX_SIZE, GL_TEX_SIZE, gl.RED, gl.UNSIGNED_BYTE, snowPixels);
        gl.bindTexture(gl.TEXTURE_2D, wetTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GL_TEX_SIZE, GL_TEX_SIZE, gl.RED, gl.UNSIGNED_BYTE, wetPixels);
        checkGl('ground-texture');
      };

      // ── 闪电 ──────────────────────────────────────────────────────────────
      /**
       * 一次雷击的世界坐标折线。与 Canvas 版同一套节奏（非齐次泊松 + 1–3 次回击），
       * 只是坐标换到世界空间：从云底（y≈11）劈到地平线附近的地面。
       */
      let strike = null;
      let boltPoints = new Float32Array(3 * 16);
      let boltAlpha = 0;
      const boltStrip = new Float32Array(16 * 2 * 3);
      const boltProjected = new Float32Array(16 * 2);

      const buildBoltPoints = () => {
        // 14 段：主干抖动更细，才不像一根被折弯的铁丝。
        const segments = 14;
        if (boltPoints.length < (segments + 1) * 3) boltPoints = new Float32Array((segments + 1) * 3);
        let x = randomRange(-9, 7);
        const z = randomRange(-26, -12);
        const top = randomRange(10, 13);
        const bottom = 0.35;
        for (let index = 0; index <= segments; index += 1) {
          const t = index / segments;
          const o = index * 3;
          boltPoints[o] = x;
          boltPoints[o + 1] = top + (bottom - top) * t;
          boltPoints[o + 2] = z + randomRange(-0.5, 0.5);
          // 越接近地面抖动越小：闪电的主干是上粗下细的。
          x += randomRange(-1, 1) * 1.85 * (1 - t * 0.5);
        }
        return segments + 1;
      };

      let boltPointTotal = 0;

      const startStrike = (now, remaining) => {
        boltPointTotal = buildBoltPoints();
        strike = { start: now, remaining };
        boltAlpha = 1;
      };

      const projectPoint = (x, y, z, out, offset) => {
        const m = viewProj;
        const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        const w = Math.abs(cw) < 1e-4 ? 1e-4 : cw;
        out[offset] = cx / w;
        out[offset + 1] = cy / w;
      };

      /** 把折线扩成屏幕空间等宽的三角带（NDC 里按像素宽度反算偏移）。 */
      const buildBoltStrip = (halfWidthPx, alpha) => {
        const count = boltPointTotal;
        if (count < 2) return 0;
        for (let index = 0; index < count; index += 1) {
          projectPoint(
            boltPoints[index * 3],
            boltPoints[index * 3 + 1],
            boltPoints[index * 3 + 2],
            boltProjected,
            index * 2,
          );
        }
        const pxToNdcX = 2 / Math.max(1, cssWidth);
        const pxToNdcY = 2 / Math.max(1, cssHeight);
        for (let index = 0; index < count; index += 1) {
          const prev = Math.max(0, index - 1);
          const next = Math.min(count - 1, index + 1);
          // 切线在像素空间取，横向偏移才不会被宽高比拉歪
          const dx = (boltProjected[next * 2] - boltProjected[prev * 2]) * cssWidth * 0.5;
          const dy = (boltProjected[next * 2 + 1] - boltProjected[prev * 2 + 1]) * cssHeight * 0.5;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const offX = nx * halfWidthPx * pxToNdcX;
          const offY = ny * halfWidthPx * pxToNdcY;
          const base = index * 6;
          boltStrip[base] = boltProjected[index * 2] + offX;
          boltStrip[base + 1] = boltProjected[index * 2 + 1] + offY;
          boltStrip[base + 2] = alpha;
          boltStrip[base + 3] = boltProjected[index * 2] - offX;
          boltStrip[base + 4] = boltProjected[index * 2 + 1] - offY;
          boltStrip[base + 5] = alpha;
        }
        return count * 2;
      };

      /** 雷电活动包络（非齐次泊松的时变强度），与 Canvas 版同源。 */
      let activity = 0.45;
      let flashPulse = null;

      // ── 物理推进 ──────────────────────────────────────────────────────────
      const stepDots = (dt) => {
        const physics = KIND_PHYSICS[kind] ?? KIND_PHYSICS.cloudy;
        for (let index = 0; index < dotCount; index += 1) {
          const o = index * 6;
          const v = index * 3;
          const vy = dotVel[v + 1];
          dotAge[index] += dt;
          if (dotMode === 'sway') {
            // 雪：终端速度极低 + 顶点着色器里的横向摆动
            dotData[o + 1] += vy * dt;
            dotData[o] += dotVel[v] * dt;
            if (dotData[o + 1] <= 0.02) {
              depositSnow(dotData[o], dotData[o + 2], physics.deposit * GL_DEPOSIT_GAIN * randomRange(0.7, 1.3));
              const z = randomRange(-30, -1);
              dotData[o] = randomRange(-11, 11);
              dotData[o + 2] = z;
              dotData[o + 1] = 2.2 + Math.abs(z) * 0.74 + randomRange(1, 5);
              dotData[o + 4] = Math.random() * Math.PI * 2;
              dotAge[index] = 0;
            }
          } else if (dotMode === 'fall') {
            // 点池的速度是常量，没有重力——冰雹弹起后会一直向上飞、永不落地。
            // 这里给 fall 模式补一条重力与终端速度，弹跳才是抛物线。
            dotVel[v + 1] = Math.max(-14, dotVel[v + 1] - 14 * dt);
            dotData[o + 1] += dotVel[v + 1] * dt;
            dotData[o] += dotVel[v] * dt;
            if (dotData[o + 1] <= 0.02) {
              // 冰雹是硬质体：先弹跳（能量保留 45%），弹完才碎或完整沉积。
              const bounces = dotBounce[index];
              if (bounces > 0.5) {
                dotBounce[index] = bounces - 1;
                dotData[o + 1] = 0.03;
                // 只弹起很小一段（保留 22% 能量），弹完下一次必碎。
                dotVel[v + 1] = Math.abs(vy) * 0.22;
                dotVel[v] = 0;
              } else {
                // 冰是脆的：落地就碎。约七成直接炸成冰屑，其余弹一下再碎。
                const shatter = Math.random() < 0.7;
                depositSnow(dotData[o], dotData[o + 2], physics.deposit * GL_DEPOSIT_GAIN);
                if (physics.splash > 0) {
                  spawnSplash(dotData[o], 0.02, dotData[o + 2], physics, Math.abs(vy));
                  if (shatter) spawnSplash(dotData[o], 0.02, dotData[o + 2], physics, Math.abs(vy) * 1.6);
                }
                // 回到「画面上沿之上」的同一条竖线，继续下一颗。
                const z = randomRange(-28, -1);
                dotData[o] = randomRange(-11, 11);
                dotData[o + 2] = z;
                dotData[o + 1] = 2.2 + Math.abs(z) * 0.78 + randomRange(1.5, 6);
                dotVel[v] = 0;
                dotVel[v + 1] = -14 * randomRange(0.9, 1.3);
                dotBounce[index] = Math.random() < 0.3 ? 1 : 0;
                dotAge[index] = 0;
              }
            }
          } else if (dotMode === 'rise') {
            dotData[o + 1] += vy * dt;
            dotData[o] += dotVel[v] * dt;
            if (dotData[o + 1] > 13) {
              dotData[o + 1] = 0.2;
              dotData[o] = randomRange(-13, 13);
              dotData[o + 2] = randomRange(-26, -1);
              dotAge[index] = 0;
            }
          } else {
            // drift（雾团）/ fly（沙尘）：横向漂移，出界从对侧回来
            dotData[o] += dotVel[v] * dt;
            dotData[o + 1] += dotVel[v + 1] * dt;
            if (dotData[o] > 17) {
              dotData[o] = -17;
              dotData[o + 1] = randomRange(0.4, dotMode === 'drift' ? 7.5 : 8);
              dotData[o + 2] = randomRange(-30, -1);
              dotAge[index] = 0;
            }
            if (dotData[o + 1] > 13) {
              dotData[o + 1] = 0.3;
              dotAge[index] = 0;
            }
          }
          // 重生淡入：0.45s 内从 0 升到基准不透明度，消除重生「闪现」。
          dotData[o + 5] = dotAlpha0[index] * Math.min(1, dotAge[index] / GL_FADE_IN_SEC);
        }
      };

      const stepLines = (dt) => {
        const physics = KIND_PHYSICS[kind] ?? KIND_PHYSICS.cloudy;
        for (let index = 0; index < lineCount; index += 1) {
          const o = index * 8;
          const vx = lineData[o + 3];
          const vy = lineData[o + 4];
          lineAge[index] += dt;
          lineData[o] += vx * dt;
          lineData[o + 1] += vy * dt;
          if (lineData[o + 1] <= 0.02) {
            depositWet(lineData[o], lineData[o + 2], physics.wet);
            if (physics.splash > 0) {
              spawnSplash(lineData[o], 0.02, lineData[o + 2], physics, Math.abs(vy));
              spawnRipple(lineData[o], lineData[o + 2]);
            }
            const z = randomRange(-32, 1);
            lineData[o] = randomRange(-13, 13);
            lineData[o + 2] = z;
            lineData[o + 1] = 2.2 + Math.abs(z) * 0.74 + randomRange(1, 5);
            lineAge[index] = 0;
          }
          if (lineData[o] > 17) {
            lineData[o] = -17;
            lineAge[index] = 0;
          }
          if (lineData[o] < -18) {
            lineData[o] = 16;
            lineAge[index] = 0;
          }
          // 与点粒子同款重生淡入：雨丝也不能从全透明「啪」地跳到满亮度。
          lineData[o + 7] = lineAlpha0[index] * Math.min(1, lineAge[index] / GL_FADE_IN_SEC);
        }
      };

      const stepSplash = (dt) => {
        for (let index = splashCount - 1; index >= 0; index -= 1) {
          const o = index * 6;
          const v = index * 3;
          splashVel[v + 1] -= 11 * dt;
          splashData[o] += splashVel[v] * dt;
          splashData[o + 1] += splashVel[v + 1] * dt;
          splashData[o + 2] += splashVel[v + 2] * dt;
          splashLife[index] += dt;
          if (splashData[o + 1] <= 0.005) splashData[o + 1] = 0.005;
          const k = 1 - splashLife[index] / splashTtl[index];
          splashData[o + 5] = Math.max(0, k) * 0.85;
          if (splashLife[index] >= splashTtl[index]) compactSplash(index);
        }
      };

      const stepRipple = (dt) => {
        for (let index = rippleCount - 1; index >= 0; index -= 1) {
          rippleLife[index] += dt;
          const t = rippleLife[index] / rippleTtl[index];
          if (t >= 1) {
            compactRipple(index);
            continue;
          }
          const o = index * 4;
          rippleData[o + 2] = 0.05 + rippleMax[index] * t;
          rippleData[o + 3] = 0.55 * (1 - t);
        }
      };

      const stepGround = (dt) => {
        const physics = KIND_PHYSICS[kind] ?? KIND_PHYSICS.cloudy;
        const melt = physics.melt * (dt / 1000);
        if (melt > 0) {
          for (let index = 0; index < cellCount; index += 1) {
            if (snowGrid[index] > 0) snowGrid[index] = Math.max(0, snowGrid[index] - melt);
          }
        }
        const dry = (dt / 1000) * 0.035;
        for (let index = 0; index < cellCount; index += 1) {
          if (wetGrid[index] > 0) wetGrid[index] = Math.max(0, wetGrid[index] - dry);
        }
        relaxGround();
      };

      const stepLightning = (dt, now) => {
        if (preset !== null && preset.fx.lightning === true) {
          activity = Math.max(
            0,
            Math.min(
              1,
              0.4 +
                0.22 * Math.sin(now * 0.00021) +
                0.12 * Math.sin(now * 0.00057 + 1.7) +
                (activity - 0.45) * 0.94 +
                (Math.random() - 0.5) * 0.02,
            ),
          );
          if (strike === null) {
            if (Math.random() < 0.32 * activity * (dt / 1000)) {
              startStrike(now, 1 + (Math.random() < 0.4 ? 1 : 0) + (Math.random() < 0.12 ? 1 : 0));
            }
          } else if (strike.remaining > 0 && now - strike.start > 170 + Math.random() * 90) {
            startStrike(now, strike.remaining - 1);
          } else if (strike.remaining === 0 && now - strike.start > 760) {
            strike = null;
            boltAlpha = 0;
          }
        } else {
          strike = null;
          boltAlpha = 0;
          activity = 0.45;
        }
        // 折线本身也随时间衰减：真实雷光是指数衰减（陡降 + 长尾），
        // exp(-t/0.22s) 形状比 560ms 线性归零更接近人眼看到的雷击余晖。
        if (strike !== null) boltAlpha = Math.exp(-Math.max(0, now - strike.start) / 220);
        // 暴雨的偶发亮度脉冲（预设里有 flash 标志的 kind 才触发）
        if (preset !== null && preset.fx.flash === true && flashPulse === null && Math.random() < dt * 0.00025) {
          flashPulse = { start: now };
        }
        if (flashPulse !== null && now - flashPulse.start > 350) flashPulse = null;
      };

      /** 当前闪电亮度（0..1）：照亮的持续时间与 Canvas 版一致，峰值更低以免过曝。 */
      const flashLevel = (now) => {
        let level = 0;
        if (strike !== null) {
          const elapsed = now - strike.start;
          if (elapsed < 150) level = Math.max(level, 0.5 * Math.max(0, 1 - elapsed / 150));
          else level = Math.max(level, 0.18 * Math.max(0, 1 - (elapsed - 150) / 420));
        }
        if (flashPulse !== null) {
          level = Math.max(level, 0.16 * Math.max(0, 1 - (now - flashPulse.start) / 350));
        }
        return Math.min(0.75, level);
      };

      // ── 绘制 ──────────────────────────────────────────────────────────────
      const beginAlphaBlend = () => {
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      };

      const drawSky = (seconds, flash) => {
        const u = programs.sky.uniforms;
        gl.useProgram(programs.sky.program);
        gl.disable(gl.BLEND);
        gl.uniform3f(u.uCamRight, camRight[0], camRight[1], camRight[2]);
        gl.uniform3f(u.uCamUp, camUp[0], camUp[1], camUp[2]);
        gl.uniform3f(u.uCamFwd, camFwd[0], camFwd[1], camFwd[2]);
        gl.uniform2f(u.uTanHalf, tanHalf[0], tanHalf[1]);
        gl.uniform3f(u.uSkyTop, live[P_SKY_TOP], live[P_SKY_TOP + 1], live[P_SKY_TOP + 2]);
        gl.uniform3f(u.uSkyMid, live[P_SKY_MID], live[P_SKY_MID + 1], live[P_SKY_MID + 2]);
        gl.uniform3f(u.uHorizon, live[P_HORIZON], live[P_HORIZON + 1], live[P_HORIZON + 2]);
        gl.uniform3f(u.uFogColor, live[P_FOG], live[P_FOG + 1], live[P_FOG + 2]);
        const sf = solarFrame();
        gl.uniform3f(u.uSunDir, sf.dir[0], sf.dir[1], sf.dir[2]);
        gl.uniform1f(u.uSun, sf.sunI);
        gl.uniform1f(u.uSunDisk, sf.diskI);
        gl.uniform3f(u.uSunColor, sf.color[0], sf.color[1], sf.color[2]);
        gl.uniform1f(u.uWarm, sf.warmth);
        gl.uniform1f(u.uDaylight, solar?.daylight ?? 1);
        gl.uniform1f(u.uCloud, live[P_CLOUD]);
        gl.uniform1f(u.uHazeBand, live[P_HAZE_BAND]);
        gl.uniform1f(u.uRay, live[P_RAY]);
        gl.uniform1f(u.uTime, seconds);
        gl.uniform1f(u.uFlash, flash * 0.85);
        gl.bindVertexArray(emptyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        checkGl('sky');
      };

      const drawGround = (seconds, flash) => {
        const u = programs.ground.uniforms;
        gl.useProgram(programs.ground.program);
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, snowTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, wetTexture);
        gl.uniform1i(u.uSnow, 0);
        gl.uniform1i(u.uWet, 1);
        gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
        gl.uniform2f(u.uGroundOrigin, GL_FIELD.x0, GL_FIELD.z0);
        gl.uniform2f(u.uGroundSpan, GL_FIELD.x1 - GL_FIELD.x0, GL_FIELD.z1 - GL_FIELD.z0);
        gl.uniform3f(u.uBase, live[P_GROUND], live[P_GROUND + 1], live[P_GROUND + 2]);
        gl.uniform3f(u.uSnowColor, live[P_SNOW], live[P_SNOW + 1], live[P_SNOW + 2]);
        gl.uniform3f(u.uFogColor, live[P_FOG], live[P_FOG + 1], live[P_FOG + 2]);
        const sf = solarFrame();
        gl.uniform3f(u.uCamPos, GL_EYE[0], GL_EYE[1], GL_EYE[2]);
        gl.uniform3f(u.uLightDir, sf.dir[0], sf.dir[1], sf.dir[2]);
        gl.uniform3f(u.uSunColor, sf.color[0], sf.color[1], sf.color[2]);
        gl.uniform1f(u.uSunI, sf.sunI);
        gl.uniform1f(u.uAmbient, sf.ambient);
        gl.uniform1f(u.uSunGain, live[P_SUN_GAIN]);
        gl.uniform1f(u.uWarm, sf.warmth);
        gl.uniform1f(u.uCloudShadow, sf.cloud);
        gl.uniform1f(u.uFlash, flash);
        // 云影随时间漂移：叠上太阳方位的地面投影，太阳移动时影子跟着走。
        gl.uniform2f(u.uShadowOffset, seconds * 0.011 + sf.dir[0] * 0.6, seconds * 0.007 + sf.dir[2] * 0.6);
        gl.uniform1f(u.uFogDensity, live[P_FOG_DENSITY]);
        gl.uniform1f(u.uSnowGain, 1);
        gl.uniform1f(u.uSpec, live[P_SPEC]);
        gl.uniform1f(u.uTime, seconds);
        gl.bindVertexArray(groundVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        checkGl('ground');
      };

      const drawDotPool = (vao, buffer, count, data, tint, soft, twinkle, sway, alphaMul) => {
        if (count <= 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 6);
        // 先画影子再画粒子：影子贴地、在粒子下方，顺序反了会盖住粒子本体。
        const shadowFrame = solarFrame();
        if (shadowFrame.shadowAlpha > 0.03) {
          const su = programs.shadow.uniforms;
          gl.useProgram(programs.shadow.program);
          beginAlphaBlend();
          gl.uniformMatrix4fv(su.uViewProj, false, viewProj);
          const flat = Math.hypot(shadowFrame.dir[0], shadowFrame.dir[2]) || 1;
          // 背光方向（太阳方向的地面投影反向）。
          gl.uniform3f(su.uShadowDir, -shadowFrame.dir[0] / flat, 0, -shadowFrame.dir[2] / flat);
          gl.uniform1f(su.uShadowStretch, 1 / Math.max(0.22, shadowFrame.dir[1]));
          gl.uniform1f(su.uSizeScale, 3.8);
          gl.uniform1f(su.uShadowAlpha, shadowFrame.shadowAlpha * 0.85);
          gl.uniform1f(su.uSoft, shadowFrame.shadowSoft);
          gl.bindVertexArray(vao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
          checkGl('shadows');
        }
        const u = programs.dot.uniforms;
        gl.useProgram(programs.dot.program);
        beginAlphaBlend();
        gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
        gl.uniform3f(u.uCamRight, camRight[0], camRight[1], camRight[2]);
        gl.uniform3f(u.uCamUp, camUp[0], camUp[1], camUp[2]);
        gl.uniform3f(u.uCamPos, GL_EYE[0], GL_EYE[1], GL_EYE[2]);
        gl.uniform1f(u.uTime, clock);
        gl.uniform1f(u.uSway, sway);
        gl.uniform1f(u.uFogDensity, live[P_FOG_DENSITY]);
        gl.uniform1f(u.uSoft, soft);
        gl.uniform1f(u.uStretch, dotStretch);
        gl.uniform1f(u.uTwinkle, twinkle);
        gl.uniform1f(u.uAlphaMul, alphaMul);
        gl.uniform1f(u.uLightMul, solarFrame().lightMul);
        // 冰雹用硬边圆盘；其余（雪花/冰屑）保持柔边。按当前 kind 判定而不是
        // dotMode——溅射池复用同一个程序，dotMode 会在切换天气后残留（冰雹→雨
        // 会让雨滴也变成硬冰屑）。
        gl.uniform1f(u.uHard, kind === 'hail' ? 1 : 0);
        gl.uniform3f(u.uColor, tint[0], tint[1], tint[2]);
        gl.uniform3f(u.uFogColor, live[P_FOG], live[P_FOG + 1], live[P_FOG + 2]);
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        checkGl('dots');
      };

      const drawLines = (tint) => {
        if (lineCount <= 0) return;
        const u = programs.line.uniforms;
        gl.useProgram(programs.line.program);
        beginAlphaBlend();
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData, 0, lineCount * 8);
        gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
        gl.uniform3f(u.uCamPos, GL_EYE[0], GL_EYE[1], GL_EYE[2]);
        gl.uniform1f(u.uStreak, GL_STREAK_SCALE);
        gl.uniform1f(u.uFogDensity, live[P_FOG_DENSITY]);
        gl.uniform1f(u.uAlphaMul, particleRamp);
        gl.uniform1f(u.uLightMul, solarFrame().lightMul);
        gl.uniform3f(u.uColor, tint[0], tint[1], tint[2]);
        gl.uniform3f(u.uFogColor, live[P_FOG], live[P_FOG + 1], live[P_FOG + 2]);
        gl.bindVertexArray(lineVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lineCount);
        checkGl('lines');
      };

      const drawRipples = () => {
        if (rippleCount <= 0) return;
        const u = programs.ripple.uniforms;
        gl.useProgram(programs.ripple.program);
        beginAlphaBlend();
        gl.bindBuffer(gl.ARRAY_BUFFER, rippleBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, rippleData, 0, rippleCount * 4);
        gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
        gl.uniform3f(u.uColor, 0.68, 0.78, 0.92);
        gl.uniform1f(u.uAlphaMul, 1);
        gl.bindVertexArray(rippleVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, rippleCount);
        checkGl('ripples');
      };

      const drawBolt = () => {
        if (strike === null || boltPointTotal < 2) return;
        const u = programs.bolt.uniforms;
        gl.useProgram(programs.bolt.program);
        gl.enable(gl.BLEND);
        // 加法混合：闪电是发光体，叠在天空上是「照亮」而不是「盖一层白」。
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.uniform3f(u.uColor, 0.86, 0.90, 1.0);
        gl.bindVertexArray(boltVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, boltBuffer);
        // 内核（细、亮）+ 光晕（粗、淡）两遍，廉价版的辉光
        const core = buildBoltStrip(1.5, boltAlpha);
        if (core > 0) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, boltStrip, 0, core * 3);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, core);
          checkGl('bolt-core');
        }
        const glow = buildBoltStrip(5.5, boltAlpha * 0.22);
        if (glow > 0) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, boltStrip, 0, glow * 3);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, glow);
          checkGl('bolt-glow');
        }
      };

      const drawComposite = (flash) => {
        const u = programs.composite.uniforms;
        gl.useProgram(programs.composite.program);
        gl.bindVertexArray(emptyVao);
        // 1) 暗角
        if (live[P_VIGNETTE] > 0.001) {
          beginAlphaBlend();
          gl.uniform1i(u.uMode, 0);
          gl.uniform1f(u.uVignette, live[P_VIGNETTE]);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        // 2) 沙尘暖罩
        if (live[P_WASH_ALPHA] > 0.002) {
          beginAlphaBlend();
          gl.uniform1i(u.uMode, 2);
          gl.uniform4f(u.uTint, live[P_WASH], live[P_WASH + 1], live[P_WASH + 2], live[P_WASH_ALPHA]);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        // 3) 闪电：竖向渐变 + 全屏提亮，两遍都是加法
        if (flash > 0.004) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          gl.uniform1i(u.uMode, 1);
          gl.uniform4f(u.uTint, 0.72, 0.78, 1.0, flash * 0.5);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.uniform1i(u.uMode, 2);
          gl.uniform4f(u.uTint, 0.78, 0.82, 1.0, flash * 0.16);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        checkGl('composite');
      };

      /** 单帧耗时的滑动平均（毫秒）；只在 ?gldebug=1 下统计，靠 gl.finish 把 GPU 时间也算进来。 */
      let frameCost = 0;

      /** 调试快照（?gldebug=1）：把决定画面的关键量摊出来，排查「为什么这么亮」用。 */
      const publishDebug = () => {
        if (!debugGl) return;
        let snowSum = 0;
        let wetSum = 0;
        for (let index = 0; index < cellCount; index += 1) {
          snowSum += snowGrid[index];
          wetSum += wetGrid[index];
        }
        // 粒子淡入观测：平均淡入系数与「尚在淡入中」的比例（探针验证无闪现用）。
        let fadeSum = 0;
        let young = 0;
        const poolN = dotCount + lineCount;
        for (let index = 0; index < dotCount; index += 1) {
          const fade = Math.min(1, dotAge[index] / GL_FADE_IN_SEC);
          fadeSum += fade;
          if (fade < 0.999) young += 1;
        }
        for (let index = 0; index < lineCount; index += 1) {
          const fade = Math.min(1, lineAge[index] / GL_FADE_IN_SEC);
          fadeSum += fade;
          if (fade < 0.999) young += 1;
        }
        window.__dshGlInfo = {
          kind,
          pitchDeg: (GL_PITCH * 180) / Math.PI,
          css: [cssWidth, cssHeight],
          fog: live[P_FOG_DENSITY],
          groundBase: [live[P_GROUND], live[P_GROUND + 1], live[P_GROUND + 2]],
          horizon: [live[P_HORIZON], live[P_HORIZON + 1], live[P_HORIZON + 2]],
          skyTop: [live[P_SKY_TOP], live[P_SKY_TOP + 1], live[P_SKY_TOP + 2]],
          snowAvg: snowSum / cellCount,
          wetAvg: wetSum / cellCount,
          dots: dotCount,
          lines: lineCount,
          splash: splashCount,
          frameMs: Number(frameCost.toFixed(2)),
          /** 常驻低成本统计（rAF 时间戳差，无 gl.finish）：与 frameMs 对拍验证。 */
          frameMsRaf: Number(frameMsEma.toFixed(2)),
          frameIntervalMs: Number(frameIntervalEma.toFixed(2)),
          quality,
          /** 粒子淡入：平均淡入系数（0..1）与仍在淡入的粒子占比。 */
          fadeAvg: poolN > 0 ? Number((fadeSum / poolN).toFixed(3)) : 1,
          fadeYoung: poolN > 0 ? Number((young / poolN).toFixed(3)) : 0,
          strike: strike !== null,
          flash: Number(flashLevel(performance.now()).toFixed(3)),
        };
      };

      /** 一帧：清屏 → 天空 → 地面 → 溅射/涟漪 → 粒子 → 闪电 → 收尾。 */
      const render = (now, flash) => {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawSky(clock, flash);
        drawGround(clock, flash);
        drawRipples();
        drawDotPool(dotVao, dotBuffer, dotCount, dotData, tintRgb, dotSoft, dotTwinkle, dotSway, particleRamp);
        drawLines(tintRgb);
        // 溅射液滴：偏白的冷色，比雨丝亮一档才看得出是「水花」
        drawDotPool(splashVao, splashBuffer, splashCount, splashData, splashTint, 0, 0, 0, 1);
        drawBolt();
        drawComposite(flash);
        publishDebug();
        void now;
      };

      // ── 尺寸与循环 ────────────────────────────────────────────────────────
      const applySize = (width, height) => {
        cssWidth = Math.max(1, width);
        cssHeight = Math.max(1, height);
        // dpr 策略：设备上限收到 2（收益锐减、开销翻倍），DRS 降档时再往下压。
        const dpr = Math.min(window.devicePixelRatio || 1, GL_QUALITY_DPR[quality]);
        const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
        const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        gl.viewport(0, 0, pixelWidth, pixelHeight);
        updateCamera();
      };

      const stopLoop = () => {
        if (frameHandle !== 0) {
          cancelAnimationFrame(frameHandle);
          frameHandle = 0;
        }
      };

      const drawOnce = (now) => {
        if (preset === null) return;
        render(now, flashLevel(now));
      };

      const startLoop = () => {
        if (frameHandle !== 0) return;
        lastFrameAt = performance.now();
        frameHandle = requestAnimationFrame(frame);
      };

      // ── 帧时间监控（EMA）与自适应质量（DRS） ─────────────────────────────
      /**
       * 帧耗时采样（毫秒）= CPU 提交耗时 + 掉帧超额，全部用时间戳差得到，绝不 gl.finish。
       * - CPU 提交耗时 = 帧体终点 − rAF 时间戳（对齐 gldebug frameMs 的 CPU 半边）。
       * - 掉帧超额 = 帧间隔 − 估计刷新周期：GPU 顶不住时（大视口×高 dpr×重粒子）
       *   CPU 侧看不到成本，但 rAF 时间戳会拉开——超额部分计入，DRS 才能覆盖 GPU 瓶颈。
       * 当前基准1.5–2.5ms、预算 8ms；p95 用环形缓冲，EMA 供 stats() 展示。
       */
      let frameMsEma = 0;
      /** 帧间隔（rAF 时间戳差）EMA：诊断用，验证监控自身未引入掉帧。 */
      let frameIntervalEma = 0;
      /** 估计刷新周期（ms）：连续 12 帧落在 ±1.2ms 内才认定为刷新周期，单帧毛刺不采信。 */
      let vsyncEstMs = 16.7;
      let vsyncCandMs = 0;
      let vsyncCandStreak = 0;
      let vsyncKnown = false;
      /** p95 用的原始采样环（DRS_RING_CAP 帧）。 */
      const frameMsRing = new Float32Array(DRS_RING_CAP);
      let frameMsRingAt = 0;
      let frameMsRingLen = 0;
      /** 迟滞状态机的两个计时起点（0 = 未处于该状态）。 */
      let overBudgetSince = 0;
      let underBudgetSince = 0;
      let lastDrsEvalAt = 0;

      /** 环内 p95（复制排序，240 个浮点每 250ms 一次，开销可忽略）。 */
      const frameMsP95 = () => {
        const n = frameMsRingLen;
        if (n <= 0) return 0;
        const sorted = Float32Array.from(frameMsRing.subarray(0, n));
        sorted.sort();
        const index = Math.min(n - 1, Math.floor(n * 0.95));
        return sorted[index];
      };

      /**
       * 每帧记账 + 每 250ms 评估一次 p95，驱动 DRS 迟滞状态机：
       * 连续 2s p95 > 11ms → 降一档；连续 12s p95 < 7ms → 升一档（防振荡）。
       * 降/升档：粒子数走 adjustCounts()（现有重铺路径），dpr 走 applySize()。
       */
      const noteFrameCost = (now, workMs, intervalMs) => {
        if (intervalMs <= 0) return; // 循环首帧无真实间隔，不采样
        frameIntervalEma += (intervalMs - frameIntervalEma) * 0.1;
        // 刷新周期估计：只信「持续更快」的帧（连续 12 帧 ±1.2ms 内）下调估计；
        // 上调只做每帧 0.02ms 的慢爬——持续过载会让帧间隔变大，估计若跟着跳，
        // 掉帧超额就会被吞掉、DRS 永远不触发（过载与「换低刷屏」在此区分）。
        if (intervalMs >= DRS_VSYNC_MIN_MS && intervalMs <= DRS_VSYNC_MAX_MS && Math.abs(intervalMs - vsyncCandMs) <= 1.2) {
          vsyncCandStreak += 1;
        } else {
          vsyncCandMs = intervalMs;
          vsyncCandStreak = 1;
        }
        if (vsyncCandStreak >= 12) {
          // 连续 12 帧同周期 → 刷新周期已确认；只在「更快」时下调估计。
          vsyncKnown = true;
          if (vsyncCandMs < vsyncEstMs) vsyncEstMs = Math.max(DRS_VSYNC_MIN_MS, vsyncCandMs);
        } else if (vsyncCandStreak >= 4 && vsyncCandMs > vsyncEstMs) {
          // 未收敛期间向观察到的候选值缓慢靠拢（而非无界上浮）：防估计粘死在
          // 异常小值虚增掉帧超额，也防长时间过载把 gpuOver 项完全吞掉。
          vsyncEstMs += (vsyncCandMs - vsyncEstMs) * 0.02;
        }
        // 估计未收敛前不计掉帧超额，避免启动瞬间的抖动误报。
        const gpuOverMs = vsyncKnown ? Math.max(0, intervalMs - vsyncEstMs) : 0;
        const sampleMs = workMs + gpuOverMs;
        frameMsEma += (sampleMs - frameMsEma) * 0.1;
        frameMsRing[frameMsRingAt] = sampleMs;
        frameMsRingAt = (frameMsRingAt + 1) % DRS_RING_CAP;
        if (frameMsRingLen < DRS_RING_CAP) frameMsRingLen += 1;
        if (now - lastDrsEvalAt < DRS_EVAL_MS) return;
        lastDrsEvalAt = now;
        const p95 = frameMsP95();
        if (p95 > DRS_OVER_P95) {
          underBudgetSince = 0;
          if (overBudgetSince === 0) overBudgetSince = now;
          else if (now - overBudgetSince >= DRS_OVER_MS && quality > 0) {
            quality -= 1;
            overBudgetSince = 0;
            applySize(env.width, env.height);
            adjustCounts();
          }
        } else if (p95 < DRS_UNDER_P95) {
          overBudgetSince = 0;
          if (underBudgetSince === 0) underBudgetSince = now;
          else if (now - underBudgetSince >= DRS_UNDER_MS && quality < 2) {
            quality += 1;
            underBudgetSince = 0;
            applySize(env.width, env.height);
            adjustCounts();
          }
        } else {
          // p95 落在 7–11 的迟滞带内：两个计时器都清零，不降也不升。
          overBudgetSince = 0;
          underBudgetSince = 0;
        }
      };

      const frame = (now) => {
        frameHandle = requestAnimationFrame(frame);
        const startedAt = debugGl ? performance.now() : 0;
        // 帧间隔（rAF 时间戳差）：含 vsync 等待，只做诊断展示，不进 DRS 判定。
        const intervalMs = Math.min(Math.max(0, now - lastFrameAt), ENGINE_DT_CAP_MS * 4);
        // 后台/调试暂停恢复后第一帧 dt 强制 0：否则会把积压的时长一次走完（跳帧）。
        const dtMs = skipDtOnce ? 0 : Math.min(intervalMs, ENGINE_DT_CAP_MS);
        skipDtOnce = false;
        lastFrameAt = now;
        const dt = dtMs / 1000;
        clock += dt;
        stepParams(now);
        stepGround(dtMs);
        stepDots(dt);
        stepLines(dt);
        stepSplash(dt);
        stepRipple(dt);
        stepLightning(dtMs, now);
        uploadGroundTextures(now);
        render(now, flashLevel(now));
        // rAF 时间戳差口径的帧耗时：帧体终点 − rAF 时间戳，无 gl.finish。
        noteFrameCost(now, performance.now() - now, intervalMs);
        if (debugGl) {
          // gl.finish 强制把这一帧的 GPU 工作做完，测出来的才是「真帧耗时」。
          gl.finish();
          frameCost += (performance.now() - startedAt - frameCost) * 0.12;
        }
      };

      /** 太阳状态（由上层 weatherEnv().solar 注入；缺省时按正午处理）。 */
      let solar = null;

      /**
       * 把太阳状态折算成渲染用的几何与光照量。
       *
       * 方位：东（屏幕左）= -x、西（屏幕右）= +x，遵循东升西落；高度角抬 y。
       * 直射强度 = 天气可见度 × 日长系数；环境光随日长衰减，夜里靠环境光兜底。
       * 阴影方向取太阳方向的地面投影反向（影子永远背光），拉伸量 1/高度角——
       * 太阳越低，影子越长。
       */
      const solarFrame = () => {
        const s = solar ?? { elevation: 0.55, daylight: 1, warmth: 0.1, azimuth: 0.55, phase: 'noon' };
        const visibility = GL_SUN_VISIBILITY[kind] ?? 0.3;
        const sunI = visibility * s.daylight;
        // 太阳盘：云层消光比照度衰减得狠得多，且日落时只按日照时长线性收一点
        // （傍晚的太阳仍是亮盘，不该被当成「阴天的太阳」一起抹掉）。
        const diskI = (GL_SUN_DISK[kind] ?? 0.05) * (0.3 + 0.7 * s.daylight);
        // 方位压缩到 ±0.42：不压缩时日出/日落的太阳落在水平 33° 半视场之外，
        // 画面上永远看不到太阳。压缩后太阳从左边框升起、右边框落下，
        // 「左东右西」的读法成立，弧线也在画面内。
        const sx = (s.azimuth * 2 - 1) * 0.42;
        // 高度角同样压缩：正午 31.5° 仰角在 22.5° 半视场之上，会跑出画面顶部。
        // 但零点必须落在「地平线」而不是 +9°：原来的 0.16 偏移让太阳永远悬在
        // 半空，日出日落时看着像月亮停在山上。现在 elevation=0 时略低于地平线，
        // 太阳是真的从地面升起、落进地面。
        const sy = -0.005 + s.elevation * 0.52;
        const sz = -0.85;
        const len = Math.hypot(sx, sy, sz) || 1;
        const dir = [sx / len, sy / len, sz / len];
        const w = s.warmth;
        // 晨昏偏橙、正午偏中性白：两个通道的差值就是色温。
        const color = [1.0, 0.96 - 0.22 * w, 0.9 - 0.42 * w];
        const ambient = (GL_AMBIENT[kind] ?? 0.85) * (0.42 + 0.58 * s.daylight);
        const shadow = GL_SHADOW[kind] ?? GL_SHADOW.cloudy;
        return {
          dir,
          color,
          sunI,
          diskI,
          ambient,
          warmth: w,
          shadowAlpha: shadow.alpha * s.daylight * (0.35 + 0.65 * visibility),
          shadowSoft: shadow.soft,
          cloud: shadow.cloud * Math.max(0.15, s.daylight),
          lightMul: Math.max(0.5, Math.min(1.35, 0.55 + 0.55 * ambient + 0.35 * sunI)),
        };
      };

      const applyEnv = (nextEnv) => {
        const previous = env;
        env = { ...env, ...nextEnv };
        // 太阳状态不是插值量：它每帧连续变化，直接覆盖（时段推进不需要过渡）。
        if (nextEnv.solar !== undefined) solar = nextEnv.solar;
        if (env.width !== previous.width || env.height !== previous.height) {
          applySize(env.width, env.height);
          deriveParams(kind ?? 'cloudy', targetParams);
          live.set(targetParams);
          blendFromValid = false;
          respawnPools(kind ?? 'cloudy');
        } else if (env.effectScale !== previous.effectScale) {
          adjustCounts();
        }
        if (env.isDay !== previous.isDay) {
          deriveParams(kind ?? 'cloudy', targetParams);
          if (env.reducedMotion) {
            // 减少动态模式下没有动画循环，过渡永远走不完——直接跳变。
            live.set(targetParams);
            blendFromValid = false;
          } else {
            // 昼夜切换与 kind 切换共用同一条 ease-out 插值路径（stepParams），
            // 不再「未在过渡中就直接跳变」。
            fromParams.set(live);
            blendAt = performance.now();
            blendFromValid = true;
          }
          if (kind !== null) respawnPools(kind);
        }
        if (env.reducedMotion !== previous.reducedMotion) {
          if (env.reducedMotion) {
            state = 'idle';
            stopLoop();
            drawOnce(performance.now());
          } else if (kind !== null) {
            state = 'running';
            startLoop();
          }
        } else if (state === 'idle') {
          drawOnce(performance.now());
        }
        // 与 Canvas 引擎同一条修复：system→weather 且 kind 未变时早退到这里，
        // 必须自己把 rAF 拉起来，否则雪/雨会定格（P1）。
        if (!env.reducedMotion && kind !== null && state === 'idle') {
          state = 'running';
          startLoop();
        }
      };

      const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

      const onMotionChange = () => {
        const reduced = motionQuery?.matches ?? false;
        if (reduced === env.reducedMotion) return;
        env = { ...env, reducedMotion: reduced };
        if (reduced) {
          state = 'idle';
          stopLoop();
          drawOnce(performance.now());
        } else if (kind !== null) {
          state = 'running';
          startLoop();
        }
      };

      const onVisibilityChange = () => {
        // 隐藏时停 rAF 省电；回来续跑，第一帧 dt 归零（skipDtOnce）+ 截断，不跳帧。
        if (document.hidden) {
          stopLoop();
        } else if (state === 'running' || state === 'transition') {
          skipDtOnce = true;
          startLoop();
        }
      };

      if (motionQuery !== null && typeof motionQuery.addEventListener === 'function') {
        motionQuery.addEventListener('change', onMotionChange);
      }
      document.addEventListener('visibilitychange', onVisibilityChange);

      // 初始化：先把画布尺寸与相机摆好，否则第一帧的视口是 1×1。
      applySize(env.width, env.height);
      deriveParams('cloudy', live);
      deriveParams('cloudy', targetParams);
      checkGl('init');

      return {
        /** kind 变 → 400ms 参数插值 + 粒子重铺；instant 为手动切换：清场立即生效。 */
        setWeather(nextKind, nextEnv, instant = false) {
          const resolved = KIND_PRESETS[nextKind] ? nextKind : 'cloudy';
          if (resolved === kind) {
            applyEnv(nextEnv);
            return;
          }
          const previousKind = kind;
          kind = resolved;
          preset = KIND_PRESETS[kind];
          env = { ...env, ...nextEnv };
          applySize(env.width, env.height);
          const now = performance.now();
          if (previousKind !== null && instant !== true) {
            fromParams.set(live);
            blendAt = now;
            blendFromValid = true;
            particleRamp = 0;
          } else {
            blendFromValid = false;
            particleRamp = 1;
          }
          deriveParams(kind, targetParams);
          if (!blendFromValid) live.set(targetParams);
          if (instant === true) {
            // 手动切换：地面清零、粒子立刻重铺、闪电重置
            resetGround();
            strike = null;
            boltAlpha = 0;
            flashPulse = null;
          }
          respawnPools(kind);
          if (env.reducedMotion) {
            state = 'idle';
            stopLoop();
            drawOnce(now);
          } else {
            state = 'running';
            startLoop();
          }
        },
        setEnv: applyEnv,
        resize(width, height) {
          const w = Math.max(1, Math.round(width));
          const h = Math.max(1, Math.round(height));
          if (env.width === w && env.height === h) return;
          env = { ...env, width: w, height: h };
          applySize(w, h);
          if (kind !== null) respawnPools(kind);
          if (state === 'idle') drawOnce(performance.now());
        },
        /** 停 rAF，保留最后一帧（preserveDrawingBuffer 保证这一帧不会被清掉）。 */
        stop() {
          state = 'idle';
          stopLoop();
        },
        stats() {
          let snowTotal = 0;
          for (let index = 0; index < cellCount; index += 1) snowTotal += snowGrid[index];
          const snowAvg = cellCount > 0 ? snowTotal / cellCount : 0;
          return {
            ctx: gl.isContextLost() !== true,
            width: env.width,
            height: env.height,
            state,
            kind,
            snow: Math.round(snowAvg * 10) / 10,
            splash: splashCount,
            renderer: 'webgl2',
            /** 自适应质量档位：2=满档、1=中档、0=最低档（DRS）。 */
            quality,
            /** 帧耗时 EMA（ms，rAF 时间戳差口径，无 gl.finish）。 */
            frameMs: Math.round(frameMsEma * 100) / 100,
            /** 帧间隔 EMA（ms）：验证监控自身未引入掉帧。 */
            frameIntervalMs: Math.round(frameIntervalEma * 100) / 100,
          };
        },
        dispose() {
          stopLoop();
          if (motionQuery !== null && typeof motionQuery.removeEventListener === 'function') {
            motionQuery.removeEventListener('change', onMotionChange);
          }
          document.removeEventListener('visibilitychange', onVisibilityChange);
          for (const buffer of [quadBuffer, streakBuffer, groundBuffer, dotBuffer, lineBuffer, splashBuffer, rippleBuffer, boltBuffer]) {
            gl.deleteBuffer(buffer);
          }
          for (const vao of [emptyVao, dotVao, splashVao, lineVao, groundVao, rippleVao, boltVao]) {
            gl.deleteVertexArray(vao);
          }
          gl.deleteTexture(snowTexture);
          gl.deleteTexture(wetTexture);
          for (const program of Object.values(programs)) gl.deleteProgram(program.program);
          // 主动释放上下文：浏览器同时在世的 WebGL 上下文有上限（约 16 个），
          // 插件热重载时泄漏几个就会把后续实例挤到回退路径去。
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        },
      };
    };

    /**
     * Read the installed plugin's version and update status from the Host. */
    const fetchUpdateStatus = async (check) => {
      try {
        const endpoint = check ? '/api/dsh-wallpaper/update/check' : '/api/dsh-wallpaper/update';
        const response = await fetch(endpoint, { method: check ? 'POST' : 'GET', cache: 'no-store' });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    };

    /**
     * One shared update snapshot for the settings page and the overlay.
     *
     * Both surfaces read the same Host status, so a check triggered from either
     * one lights up the other (and the nav dot) without a second request. The
     * overlay only renders on `updateAvailable && !dismissed`.
     */
    const updateStore = (() => {
      let snapshot = { status: null, loaded: false };
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {}
        }
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        get() {
          return snapshot;
        },
        publish(status) {
          if (status === null) return;
          snapshot = { status, loaded: true };
          emit();
        },
        /** Check once per page load so a refreshed tab learns about a release. */
        async refresh(check) {
          const status = await fetchUpdateStatus(check);
          if (status !== null) updateStore.publish(status);
          return status;
        },
      };
    })();

    /**
     * Auto-expiring update notice, registered in the shell's overlay list.
     *
     * Mirrors the Our Free Model toast: bottom-right, a short body that points
     * at the settings page, and it clears itself. Unlike that one it offers no
     * in-toast action — the settings page owns the actual upgrade, so the
     * notice only has to say where to look.
     *
     * Lives in `shell.overlay` rather than `workspace.toast`: that keyed slot's
     * key domain belongs to the workspace owner, while the overlay list is the
     * documented seat for a toast stack or a badge.
     */
    const UPDATE_TOAST_MS = 14000;

    function WallpaperUpdateOverlay({ t }) {
      // The notice needs the shared snapshot: 0.4.0 dropped this subscription
      // while rewriting the component and kept reading `status`, so the whole
      // toast threw on every render and never appeared.
      const snapshot = React.useSyncExternalStore(
        updateStore.subscribe,
        updateStore.get,
        updateStore.get,
      );
      const status = snapshot.status;
      const [dismissedHere, setDismissedHere] = React.useState(null);
      const [visible, setVisible] = React.useState(false);

      React.useEffect(() => {
        void updateStore.refresh(false);
      }, []);

      const label = (key, fallback, vars) => {
        let text = fallback;
        try {
          const value = typeof t === 'function' ? t(key, vars) : undefined;
          if (typeof value === 'string' && value !== '' && value !== key) text = value;
        } catch {}
        return text;
      };

      const version = status?.latest ?? null;
      const settled =
        status !== null &&
        status.updateAvailable === true &&
        status.dismissed !== true &&
        version !== null &&
        dismissedHere !== version;

      // Restart the countdown whenever a different version shows up, so a new
      // release is never hidden behind an old notice's timer.
      React.useEffect(() => {
        if (!settled) {
          setVisible(false);
          return undefined;
        }
        setVisible(true);
        const timer = setTimeout(() => {
          setVisible(false);
          setDismissedHere(version);
        }, UPDATE_TOAST_MS);
        return () => clearTimeout(timer);
      }, [settled, version]);

      if (!settled || !visible) return null;

      const current = status.version ?? '—';
      const close = () => {
        setVisible(false);
        setDismissedHere(version);
      };

      const card = {
        position: 'fixed',
        right: '18px',
        bottom: '76px',
        zIndex: 1200,
        boxSizing: 'border-box',
        width: 'min(340px, calc(100vw - 36px))',
        padding: '12px 14px 12px 16px',
        borderRadius: '13px',
        border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #f0a441) 42%, var(--dsw-alias-border-l2, rgba(127,127,127,.3)))',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2, #1f232b) 94%, transparent)',
        backdropFilter: 'blur(14px) saturate(150%)',
        WebkitBackdropFilter: 'blur(14px) saturate(150%)',
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 7%), 0 14px 40px rgb(0 0 0 / 26%)',
        color: 'var(--dsw-alias-label-primary, inherit)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        pointerEvents: 'auto',
        fontFamily: 'inherit',
        fontSize: '12.5px',
        lineHeight: 1.5,
        overflow: 'hidden',
        animation: 'dsh-wallpaper-toast-rise .32s cubic-bezier(.16,1,.3,1)',
      };
      const accent = {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '3px',
        background: 'var(--dsw-alias-state-warning-primary, #f0a441)',
      };
      const closeStyle = {
        marginLeft: 'auto',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        opacity: '.55',
        font: 'inherit',
        lineHeight: 1,
        padding: '2px 4px',
      };

      return React.createElement(
        'div',
        { style: card, role: 'status', 'aria-live': 'polite', 'data-dsh-wallpaper-update': '' },
        React.createElement('span', { style: accent, 'aria-hidden': 'true' }),
        // One-shot keyframe: injected on first render and left in place, since a
        // duplicate <style> would be inert but a missing one kills the entrance.
        React.createElement('style', null, '@keyframes dsh-wallpaper-toast-rise{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'),
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 600 } },
          label('update.reminderTitle', '插件可升级'),
          React.createElement(
            'button',
            { type: 'button', style: closeStyle, onClick: close, 'aria-label': label('update.close', '关闭') },
            '×',
          ),
        ),
        React.createElement(
          'div',
          { style: { color: 'var(--dsw-alias-label-secondary, inherit)' } },
          label(
            'update.reminderBody',
            `发现新版本 ${version}（当前 ${current}），在账号菜单点「换景」即可升级。`,
            { current, version },
          ),
        ),
      );
    }

    /**
     * 模式选择卡：图 + 图上文字，整卡可点、可键盘聚焦（role=radio + Enter/Space）。
     *
     * 配图经 Host 白名单路由加载；加载失败（404 或解码失败）时移除 <img>，露出
     * 容器自带的 CSS 渐变兜底——assets 落盘前也不是破图。
     */
    function ModeCard({ mode, title, desc, active, onSelect, t, timeText, metaText }) {
      const [broken, setBroken] = React.useState(false);
      const [hovered, setHovered] = React.useState(false);

      /** 角标文案可能来自 locale 缺键/载荷缺字段，统一按「有没有可用字符串」判断。 */
      const hasText = (value) => typeof value === 'string' && value !== '';

      /** 左上角角标的胶囊样式：两行（时间 / 城市·天气）共用同一套。 */
      const badge = {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        maxWidth: '100%',
        padding: '3px 8px',
        borderRadius: '999px',
        background: 'rgba(8, 10, 14, 0.55)',
        color: '#fff',
        fontSize: '11px',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        backdropFilter: 'blur(2px)',
      };

      const label = (key, fallback) => {
        try {
          const value = typeof t === 'function' ? t(key) : undefined;
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        } catch {}
        return fallback;
      };

      const select = () => onSelect(mode);

      // 选中态用 2px 主题色描边由 box-shadow 环完成：border 宽度保持不变，
      // 两张卡并排时不会因为选中而位移。
      const shell = {
        // 宽度交给外层两列网格：每张卡恰好占一半，不固定像素上限。
        minWidth: 0,
        boxSizing: 'border-box',
        cursor: 'pointer',
        borderRadius: 'var(--dsw-radius-lg, 12px)',
        border: active === true
          ? '0.5px solid var(--dsw-alias-border-l1, #4d6bfe)'
          : hovered
            ? '0.5px solid var(--dsw-alias-border-l1, #4d6bfe)'
            : '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
        boxShadow:
          active === true
            ? '0 0 0 2px var(--dsw-alias-border-l1, #4d6bfe), 0 8px 20px rgba(0, 0, 0, 0.16)'
            : 'none',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        overflow: 'hidden',
      };

      return React.createElement(
        'div',
        {
          role: 'radio',
          tabIndex: 0,
          'aria-checked': active === true,
          'aria-label': title,
          className: 'wb-mode-card',
          style: shell,
          onClick: select,
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              select();
            }
          },
        },
        React.createElement(
          'div',
          {
            style: {
              position: 'relative',
              height: '132px',
              // 渐变兜底：图片 404 或被移除时直接可见，两种模式各一套色调。
              background:
                mode === 'weather'
                  ? 'linear-gradient(135deg, #31405a 0%, #232f42 55%, #16202e 100%)'
                  : 'linear-gradient(135deg, #46536a 0%, #2d3748 60%, #1f2733 100%)',
            },
          },
          broken
            ? null
            : React.createElement('img', {
                src: CARD_ASSET_URLS[mode],
                alt: '',
                draggable: false,
                onError: () => setBroken(true),
                style: {
                  position: 'absolute',
                  inset: '0',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                },
              }),
          // 图上文字的可读性靠底部渐变遮罩，不依赖图片本身的明暗。
          React.createElement('div', {
            'aria-hidden': 'true',
            style: {
              position: 'absolute',
              inset: '0',
              background: 'linear-gradient(to top, rgba(8, 10, 14, 0.78) 0%, rgba(8, 10, 14, 0.25) 46%, rgba(8, 10, 14, 0) 72%)',
            },
          }),
          React.createElement(
            'div',
            {
              style: {
                position: 'absolute',
                left: '12px',
                right: '12px',
                bottom: '10px',
                color: '#fff',
                textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
              },
            },
            React.createElement('div', { style: { fontSize: '14px', fontWeight: 600, lineHeight: '20px' } }, title),
            React.createElement('div', { style: { fontSize: '12px', opacity: '.78', lineHeight: '17px', marginTop: '2px' } }, desc),
          ),
          // 左上角角标：第一行「更新于」，第二行「城市 · 天气 温度」。
          // 两行都只在卡片选中时出现——未选中的卡保持干净。
          active === true && (hasText(timeText) || hasText(metaText))
            ? React.createElement(
                'div',
                {
                  style: {
                    position: 'absolute',
                    top: '8px',
                    left: '8px',
                    right: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '4px',
                  },
                },
                hasText(timeText)
                  ? React.createElement(
                      'div',
                      { style: badge },
                      React.createElement(
                        'span',
                        { 'aria-hidden': 'true', style: { display: 'inline-flex', opacity: '.85' } },
                        React.createElement(
                          'svg',
                          { width: 11, height: 11, viewBox: '0 0 12 12', fill: 'none' },
                          React.createElement('circle', { cx: 6, cy: 6, r: 4.6, stroke: '#fff', strokeWidth: 1.3 }),
                          React.createElement('path', { d: 'M6 3.4V6l1.8 1.2', stroke: '#fff', strokeWidth: 1.3, strokeLinecap: 'round' }),
                        ),
                      ),
                      timeText,
                    )
                  : null,
                hasText(metaText) ? React.createElement('div', { style: badge }, metaText) : null,
              )
            : null,
          active === true
            ? React.createElement(
                'div',
                {
                  style: {
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 9px 3px 5px',
                    borderRadius: '999px',
                    background: 'var(--dsw-alias-border-l1, #4d6bfe)',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 600,
                    lineHeight: '16px',
                    // 光环 + 投影把「正在生效」从背景里顶出来，一眼可辨。
                    boxShadow: '0 0 0 2px rgba(255,255,255,.5), 0 4px 12px rgba(37,99,235,.5)',
                  },
                },
                // 白圆蓝勾：比裸的 ✓ 对比度高一档，缩小后仍然认得出是「已生效」。
                React.createElement(
                  'span',
                  { 'aria-hidden': 'true', style: { display: 'inline-flex' } },
                  React.createElement(
                    'svg',
                    { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none' },
                    React.createElement('circle', { cx: 8, cy: 8, r: 8, fill: '#fff' }),
                    React.createElement('path', {
                      d: 'M4.6 8.2l2.2 2.2 4.5-4.6',
                      stroke: 'var(--dsw-alias-border-l1, #4d6bfe)',
                      strokeWidth: 1.9,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                    }),
                  ),
                ),
                label('mode.active', '使用中'),
              )
            : null,
        ),
      );
    }

    /**
     * 天气状态行：错误提示 + 调试状态。
     *
     * 错误判定以 Host 载荷的 weather.error 为准（pending / unreachable），刷新
     * 失败时本地也置同样的提示——对用户来说都是同一句话，不区分原因。
     * 刷新按钮位于「背景模式」卡片标题行右端，效果预览由 PreviewStrip 承担。
     */
    function WeatherStatusRow({ t }) {
      const weather = React.useSyncExternalStore(weatherStore.subscribe, weatherStore.get, weatherStore.get);

      const label = (key, fallback) => {
        try {
          const value = typeof t === 'function' ? t(key) : undefined;
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        } catch {}
        return fallback;
      };

      const unavailable = weather?.error !== null && weather?.error !== undefined;

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        unavailable
          ? React.createElement(
              'div',
              { style: { fontSize: '12px', lineHeight: '16px', opacity: '.55' } },
              label('weather.unavailable', '天气数据暂不可用，已使用默认效果'),
            )
          : null,
      );
    }

    /**
     * 效果预览：标题独行 + icon 平铺（可折行）+ 说明文案，仅天气模式显示。
     * 每个 icon 是生成的位图；点击即预览该天气，选中态用描边 + 浅底标出。
     *
     * 悬停说明用自绘气泡，不再挂原生 `title`：原生 tooltip 由系统绘制，
     * 首个提示有 1s 左右的滞后、窗口失焦时干脆不出现，样式也不跟主题走；
     * 宿主自己的控件也一律用自绘 tooltip（插件不能 import 宿主的
     * ui-primitives，所以在本地实现一份）。气泡 `position: fixed` 挂在弹窗
     * 卡片里也能浮到正文之上——fixed 的包含块是视口，不受祖先 overflow 裁剪。
     *
     * 选中判定与 previewStore 语义对齐：'evolve' = 动态演化、null = 跟随真实
     * 天气、其余字符串 = 具体 kind。旧判定 `(preview ?? 'evolve') === opt.key`
     * 把 null 误判成 evolve 选中（点「跟随真实天气」第一个图标反而亮起）。
     */
    function PreviewStrip({ t }) {
      const preview = React.useSyncExternalStore(previewStore.subscribe, previewStore.get, previewStore.get);
      /** 悬停气泡：`null` 不显示，否则带文案与视口坐标。 */
      const [tip, setTip] = React.useState(null);
      const tipTimer = React.useRef(0);

      const clearTipTimer = () => {
        if (tipTimer.current) {
          clearTimeout(tipTimer.current);
          tipTimer.current = 0;
        }
      };
      const hideTip = () => {
        clearTipTimer();
        setTip(null);
      };
      React.useEffect(() => clearTipTimer, []);

      const label = (key, fallback) => {
        try {
          const value = typeof t === 'function' ? t(key) : undefined;
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        } catch {}
        return fallback;
      };

      // 悬停 tip：名称 + 含义。12 个天气形态的说明是同一句通用话，逐个重复
      // 只是噪声，所以它们只显示名称（tip 置空即不渲染第二行）。
      const options = [
        {
          key: 'evolve',
          icon: 'evolve',
          name: label('weather.preview.evolve', '动态演化'),
          tip: label('weather.preview.evolveTip', '随时间自动轮换天气效果'),
        },
        {
          key: 'auto',
          icon: 'auto',
          name: label('weather.preview.auto', '跟随真实天气'),
          tip: label('weather.preview.autoTip', '按定位实时同步'),
        },
        ...PREVIEW_KINDS.map((kind) => ({
          key: kind,
          icon: kind,
          name: label(`weather.kind.${kind}`, KIND_LABELS[kind] ?? kind),
          tip: '',
        })),
      ];

      /**
       * 悬停 120ms 后弹出气泡。
       *
       * 坐标必须在事件回调里同步量好：回调返回后 `event.currentTarget` 已被
       * React 置空，定时器里再读只会拿到 null。气泡默认贴按钮上沿居中；
       * 上方空间不够（窗口很矮、正文滚到顶）时翻到按钮下方，避免被视口切掉。
       */
      const scheduleTip = (event, opt) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const above = rect.top > 56;
        clearTipTimer();
        tipTimer.current = setTimeout(() => {
          tipTimer.current = 0;
          setTip({
            name: opt.name,
            text: opt.tip,
            x: rect.left + rect.width / 2,
            y: above ? rect.top - 6 : rect.bottom + 6,
            transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          });
        }, 120);
      };

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        // 标题独立一行：小号加粗 + 轻微弱化，不再与图标同行挤在左侧。
        React.createElement(
          'div',
          { style: { fontSize: '12px', lineHeight: '16px', fontWeight: 600, opacity: '.62', flex: 'none' } },
          label('weather.preview', '效果预览'),
        ),
        // icon 另起一行平铺：按钮 38px / 图 29px，一行放不下自动折行，间距均匀。
        React.createElement(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', minWidth: 0 } },
          options.map((opt) => {
            // auto 对应 preview === null（跟随真实天气），其余键与 preview 一一对应。
            const selected = opt.key === 'auto' ? preview === null : preview === opt.key;
            return React.createElement(
              'button',
              {
                key: opt.key,
                type: 'button',
                'aria-label': opt.tip === '' ? opt.name : `${opt.name} · ${opt.tip}`,
                'aria-pressed': selected,
                onMouseEnter: (event) => scheduleTip(event, opt),
                onMouseLeave: hideTip,
                // 按下即收气泡：选中动作不该被一个还没消失的提示挡着。
                onPointerDown: hideTip,
                onClick: () => {
                  const next = opt.key === 'auto' ? null : opt.key;
                  previewStore.publish(next);
                  // 选具体效果时确保处于天气模式：预览需要一个可见的载体。
                  if (next !== null && modeStore.get() !== 'weather') setMode('weather');
                },
                style: {
                  width: '38px',
                  height: '38px',
                  padding: '4px',
                  borderRadius: '10px',
                  border: selected
                    ? '1.5px solid var(--dsw-alias-border-l1, #4d6bfe)'
                    : '1px solid transparent',
                  background: selected ? 'rgba(77,107,254,.16)' : 'transparent',
                  cursor: 'pointer',
                  lineHeight: 0,
                  flex: 'none',
                },
              },
              React.createElement('img', {
                src: PREVIEW_ICON_URLS[opt.icon],
                alt: '',
                draggable: false,
                style: { width: '29px', height: '29px', display: 'block' },
              }),
            );
          }),
        ),
        // 气泡与图标行同级但脱离文档流，不参与 flex 排布。
        tip === null
          ? null
          : React.createElement(
              'div',
              {
                role: 'tooltip',
                style: {
                  position: 'fixed',
                  left: `${tip.x}px`,
                  top: `${tip.y}px`,
                  transform: tip.transform,
                  zIndex: 1400,
                  pointerEvents: 'none',
                  maxWidth: '240px',
                  padding: '6px 9px',
                  borderRadius: '8px',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))',
                  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2, #1f232b) 96%, transparent)',
                  boxShadow: '0 8px 20px rgb(0 0 0 / 26%)',
                  color: 'var(--dsw-alias-label-primary, inherit)',
                  fontSize: '12px',
                  lineHeight: '16px',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                },
              },
              React.createElement('div', { style: { fontWeight: 600 } }, tip.name),
              tip.text === ''
                ? null
                : React.createElement('div', { style: { marginTop: '2px', opacity: '.62' } }, tip.text),
            ),
      );
    }

    /**
     * Settings page for the wallpaper background.
     *
     * Styled to match the app's own settings pages: 14px body text, 12px hints,
     * 8px rhythm, and a slim custom track instead of the browser's full-width
     * default range, which reads as a bright bar against a dark panel.
     */
    function WallpaperSettingsPage({ t }) {
      const hostRef = React.useRef(null);
      const snapshot = React.useSyncExternalStore(
        updateStore.subscribe,
        updateStore.get,
        updateStore.get,
      );
      const mode = React.useSyncExternalStore(modeStore.subscribe, modeStore.get, modeStore.get);
      // 卡片上的「更新于」：天气卡取天气载荷时间，系统卡取最近换帧时刻。
      const weather = React.useSyncExternalStore(weatherStore.subscribe, weatherStore.get, weatherStore.get);
      const weatherAt = weather?.updatedAt ?? null;
      const frameAt = React.useSyncExternalStore(frameTimeStore.subscribe, frameTimeStore.get, frameTimeStore.get);
      const status = snapshot.status;
      const valuesRef = React.useRef(merged({}));

      const label = (key, fallback) => {
        try {
          const value = typeof t === 'function' ? t(key) : undefined;
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        } catch {}
        return fallback;
      };

      /** 卡片角标文案：`更新于 {time}`；拿不到时间返回 null（角标不显示）。 */
      const timeTextFor = (cardMode) => {
        const at = cardMode === 'weather' ? weatherAt : frameAt;
        const ms = typeof at === 'number' ? at : Date.parse(at ?? '');
        if (!Number.isFinite(ms)) return null;
        return label('weather.updatedAt', '更新于 {time}').replace('{time}', new Date(ms).toLocaleTimeString());
      };

      /**
       * 天气卡的实况角标：`城市 · 天气 温度`（例：`北京 · 晴 24°`）。
       *
       * 定位失败时 Host 的 city 是 null（走固定坐标/默认坐标），此时退化成
       * `晴 24°`；温度缺失时只剩 `北京 · 晴`。三者都没有就返回 null，不占位置。
       */
      const weatherMeta = (() => {
        if (weather === null || weather === undefined) return null;
        // 一次都没成功取到过数据时，kind 是占位的 cloudy——显示「多云」会误导，
        // 不如不显示（此时卡片上只有「更新于」缺失，错误行另有提示）。
        if (weather.updatedAt === null || weather.updatedAt === undefined) return null;
        const parts = [];
        if (typeof weather.city === 'string' && weather.city.trim() !== '') parts.push(weather.city.trim());
        const kindLabel = label(`weather.kind.${weather.kind}`, KIND_LABELS[weather.kind] ?? weather.kind);
        if (typeof kindLabel === 'string' && kindLabel !== '') parts.push(kindLabel);
        const head = parts.join(' · ');
        const temperature = typeof weather.temperature === 'number' && Number.isFinite(weather.temperature)
          ? `${Math.round(weather.temperature)}°`
          : '';
        const text = [head, temperature].filter((part) => part !== '').join(' ');
        return text === '' ? null : text;
      })();

      React.useEffect(() => {
        void updateStore.refresh(false);
      }, []);

      // Built once. Rebuilding on every input replaced the element under the
      // pointer mid-drag, so the slider could only be clicked.
      React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        host.textContent = '';

        const style = document.createElement('style');
        style.textContent =
          '.wb-slider{-webkit-appearance:none;appearance:none;width:100%;height:18px;' +
          'background:transparent;cursor:pointer;margin:0;display:block}' +
          '.wb-slider::-webkit-slider-runnable-track{height:3px;border-radius:2px;' +
          'background:rgba(127,127,127,.28)}' +
          '.wb-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;' +
          'width:12px;height:12px;margin-top:-4.5px;border-radius:50%;background:#4d6bfe;' +
          'border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .12s ease}' +
          '.wb-slider:hover::-webkit-slider-thumb{transform:scale(1.12)}' +
          '.wb-slider::-moz-range-track{height:3px;border-radius:2px;background:rgba(127,127,127,.28)}' +
          '.wb-slider::-moz-range-progress{height:3px;border-radius:2px;background:#4d6bfe}' +
          '.wb-slider::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#4d6bfe;' +
          'border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)}' +
          // 一行两个：标签/读数一行、滑轨一行、提示一行，网格排布提升密度。
          '.wb-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 22px}' +
          '.wb-block{display:flex;flex-direction:column;gap:4px;min-width:0}' +
          '.wb-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}' +
          '.wb-name{font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '.wb-track{position:relative}' +
          '.wb-value{flex:none;font-size:13px;line-height:18px;' +
          'opacity:.6;font-variant-numeric:tabular-nums}' +
          '.wb-hint{margin:0;font-size:11px;line-height:15px;opacity:.42}' +
          // 模式卡的键盘焦点环：整卡可聚焦，没有可见焦点环键盘用户就盲了。
          '.wb-mode-card:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}';
        host.append(style);

        const wrap = document.createElement('div');
        wrap.className = 'wb-grid';

        // 读数格式：px 取整，带单位的追加单位，其余两位小数（与既有行为一致）。
        const readoutText = (spec, value) => {
          if (spec.unit === 'px') return String(Math.round(value));
          return spec.unit === '' ? value.toFixed(2) : `${value.toFixed(2)}${spec.unit}`;
        };

        for (const spec of SLIDERS) {
          const block = document.createElement('div');
          block.className = 'wb-block';

          const head = document.createElement('div');
          head.className = 'wb-head';

          const name = document.createElement('span');
          name.className = 'wb-name';
          name.textContent = spec.labelKey ? label(spec.labelKey, spec.label) : spec.label;

          const track = document.createElement('div');
          track.className = 'wb-track';

          const input = document.createElement('input');
          input.type = 'range';
          input.className = 'wb-slider';
          input.dataset.key = spec.key;
          input.min = String(spec.min);
          input.max = String(spec.max);
          input.step = String(spec.step);
          input.value = String(valuesRef.current[spec.key]);
          input.setAttribute('aria-label', name.textContent);
          track.append(input);

          const readout = document.createElement('span');
          readout.className = 'wb-value';
          readout.dataset.readout = spec.key;
          readout.textContent = readoutText(spec, valuesRef.current[spec.key]);

          input.addEventListener('input', () => {
            const raw = Number(input.value);
            writeOverrides({ ...(readOverrides() ?? {}), [spec.key]: raw });
            readout.textContent = readoutText(spec, raw);
            announce();
          });

          head.append(name, readout);
          block.append(head, track);

          const hint = document.createElement('div');
          hint.className = 'wb-hint';
          hint.textContent = spec.hintKey ? label(spec.hintKey, spec.hint) : spec.hint;
          block.append(hint);

          wrap.append(block);
        }

        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = label('reset', '恢复默认');
        Object.assign(reset.style, {
          gridColumn: '1 / -1',
          alignSelf: 'flex-start',
          padding: '7px 16px',
          marginTop: '2px',
          borderRadius: 'var(--dsw-radius-md, 8px)',
          cursor: 'pointer',
          color: 'inherit',
          background: 'transparent',
          border: '.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
          fontFamily: 'inherit',
          fontSize: '13px',
          opacity: '.85',
        });
        reset.addEventListener('click', () => {
          try {
            window.localStorage.removeItem(STORAGE_KEY);
          } catch {}
          const defaults = merged({});
          valuesRef.current = defaults;
          announce();
          for (const input of wrap.querySelectorAll('input[type="range"]')) {
            const spec = SLIDERS.find((entry) => entry.key === input.dataset.key);
            if (spec) input.value = String(defaults[spec.key]);
          }
          for (const out of wrap.querySelectorAll('[data-readout]')) {
            const spec = SLIDERS.find((entry) => entry.key === out.dataset.readout);
            if (!spec) continue;
            out.textContent = readoutText(spec, defaults[spec.key]);
          }
        });
        wrap.append(reset);

        host.append(wrap);
      }, []);

      const textStyle = { fontSize: '13px', lineHeight: '18px', opacity: '.65' };
      // Mirrors the app's own settings cards: hairline themed stroke, the shared
      // xl radius, and the themed card fill so it reads as the same surface.
      const card = {
        boxSizing: 'border-box',
        border: '.5px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.25))',
        borderRadius: 'var(--dsw-radius-xl, 16px)',
        background: 'var(--dsw-alias-settings-card-fill, transparent)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      };

      return React.createElement(
        'div',
        {
          // 用户名弹窗快捷入口滚到这里用的定位标记。
          'data-dsh-wallpaper-settings': '',
          style: { display: 'flex', flexDirection: 'column' },
        },
        // 背景模式卡片组放在外观滑块之前：两种模式一眼可选，选中态即时生效。
        React.createElement(
          'div',
          { style: { ...card, marginBottom: '14px' } },
          // 标题行：左标题、右刷新按钮（从弹窗头部迁来，与标题同排右对齐）。
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
            React.createElement('div', { style: { fontSize: '14px', fontWeight: 600 } }, label('mode.title', '背景模式')),
            React.createElement(WeatherRefreshButton, { t }),
          ),
          React.createElement(
            'div',
            {
              role: 'radiogroup',
              'aria-label': label('mode.title', '背景模式'),
              // 固定两列：一排放下两张卡，窄屏也不换行成单列（用户要求默认一排两个）。
              style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' },
            },
            React.createElement(ModeCard, {
              mode: 'system',
              t,
              title: label('mode.system', '跟随系统壁纸'),
              desc: label('mode.system.desc', '把当前桌面壁纸作为半透明背景，每几秒自动同步'),
              active: mode === 'system',
              onSelect: setMode,
              timeText: timeTextFor('system'),
            }),
            React.createElement(ModeCard, {
              mode: 'weather',
              t,
              title: label('mode.weather', '天气壁纸'),
              desc: label('mode.weather.desc', '本地实时天气化作流动的背景，雨雪风雾各有意境'),
              active: mode === 'weather',
              onSelect: setMode,
              timeText: timeTextFor('weather'),
              metaText: weatherMeta,
            }),
          ),
          // 效果预览只在「天气壁纸」下出现：系统壁纸没有可预览的天气形态。
          mode === 'weather' ? React.createElement(PreviewStrip, { t }) : null,
          React.createElement(WeatherStatusRow, { t }),
        ),
        React.createElement(
          'div',
          { style: { ...card, marginBottom: '14px' } },
          React.createElement('div', { ref: hostRef }),
        ),
      );
    }

    /** 「换景」弹窗的开关状态（用户名弹窗入口写它，shell.overlay 插槽读它）。 */
    const sceneryDialogStore = (() => {
      let open = false;
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {}
        }
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        get() {
          return open;
        },
        setOpen(next) {
          const value = next === true;
          if (value === open) return;
          open = value;
          emit();
        },
      };
    })();

    /**
     * 「换景」弹窗：完整设置面板直接弹出（不再进设置页挂 tab）。
     * 渲染进 shell.overlay：overlay 层本身 click-through，背板自己 opt-in
     * 吃掉点击，ESC 与点背板关闭。
     */
    /** 「背景模式」卡片标题行右端的天气刷新 icon：tooltip「立即刷新天气」。 */
    function WeatherRefreshButton({ t }) {
      const [refreshing, setRefreshing] = React.useState(false);

      const label = (key, fallback) => {
        try {
          const value = typeof t === 'function' ? t(key) : undefined;
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        } catch {}
        return fallback;
      };

      const refresh = async () => {
        if (refreshing) return;
        setRefreshing(true);
        try {
          const response = await fetch('/api/dsh-wallpaper/weather/refresh', { method: 'POST', cache: 'no-store' });
          if (!response.ok) return;
          const body = await response.json();
          // 手动刷新的结果立即广播，不必等下一个 2s 轮询；Host 的 1h 节奏不受影响。
          if (body?.weather !== null && body?.weather !== undefined && typeof body.weather === 'object') {
            weatherStore.publish(body.weather);
          }
        } catch {
        } finally {
          setRefreshing(false);
        }
      };

      return React.createElement(
        'button',
        {
          type: 'button',
          onClick: refresh,
          disabled: refreshing,
          title: label('weather.refreshTip', '立即刷新天气'),
          'aria-label': label('weather.refresh', '立即刷新'),
          style: {
            width: '26px',
            height: '26px',
            padding: 0,
            border: 'none',
            borderRadius: '6px',
            background: 'transparent',
            color: 'inherit',
            cursor: refreshing ? 'progress' : 'pointer',
            opacity: refreshing ? 0.45 : 0.72,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          },
        },
        React.createElement(
          'svg',
          { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          React.createElement('path', {
            d: 'M13.2 8a5.2 5.2 0 1 1-1.5-3.7M13.2 2.6v3h-3',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ),
      );
    }

    /**
     * 「⭐ 点个 Star」胶囊的样式：深色 pill、金色星星，hover 时星星放大轻旋、
     * 星芒迸发、胶囊描边微亮/背景微提（0.2s 缓动）。样式放类里而不是行内：
     * 行内样式会盖掉 :hover 规则。
     */
    const STAR_PILL_CSS =
      '.dsw-star-btn{display:inline-flex;align-items:center;gap:5px;flex:none;' +
      'padding:3px 11px 3px 9px;border-radius:999px;text-decoration:none;' +
      'background:rgba(22,25,32,.92);border:1px solid rgba(255,255,255,.2);' +
      'color:rgba(255,255,255,.92);font-size:12px;line-height:16px;font-weight:500;' +
      'font-family:inherit;cursor:pointer;white-space:nowrap;' +
      'transition:background .2s ease,border-color .2s ease,transform .2s ease}' +
      '.dsw-star-btn:hover{background:rgba(42,47,60,.96);border-color:rgba(247,201,72,.55)}' +
      '.dsw-star-ico{flex:none;transition:transform .2s ease;transform-origin:50% 55%}' +
      '.dsw-star-btn:hover .dsw-star-ico{transform:scale(1.18) rotate(18deg)}' +
      '.dsw-star-spark{opacity:0;transform-origin:50% 50%}' +
      '.dsw-star-btn:hover .dsw-star-spark{animation:dsw-star-burst .45s ease}' +
      '@keyframes dsw-star-burst{0%{opacity:0;transform:scale(.4)}' +
      '55%{opacity:.95;transform:scale(1.3)}100%{opacity:0;transform:scale(1.6)}}';

    /**
     * 更新状态条：版本 chip + 上次检查 + 「检测更新」文字按钮 + 「⭐ 点个 Star」。
     * 原本是设置页底部的「插件更新」卡片，按需求收进弹窗头部，按钮改图标。
     */
    function UpdateControls({ t }) {
      const snapshot = React.useSyncExternalStore(updateStore.subscribe, updateStore.get, updateStore.get);
      const status = snapshot.status;
      const [checking, setChecking] = React.useState(false);
      const [upgrading, setUpgrading] = React.useState(false);
      const [upgradeNote, setUpgradeNote] = React.useState(null);

      const label = (key, fallback) => {
        try {
          const value = typeof t === 'function' ? t(key) : undefined;
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        } catch {}
        return fallback;
      };

      React.useEffect(() => {
        void updateStore.refresh(false);
      }, []);

      const runCheck = async () => {
        setChecking(true);
        try {
          await updateStore.refresh(true);
        } finally {
          setChecking(false);
        }
      };

      const runUpgrade = async () => {
        setUpgrading(true);
        setUpgradeNote(null);
        try {
          const response = await fetch('/api/dsh-wallpaper/upgrade', { method: 'POST', cache: 'no-store' });
          const body = await response.json();
          const result = body?.result;
          const installed = body?.installed ?? '—';
          if (body?.error !== null && body?.error !== undefined) {
            setUpgradeNote({ ok: false, text: label('update.upgradeFailed', `升级失败：${body.error}`) });
            return;
          }
          if (result?.application === 'applied') {
            setUpgradeNote({
              ok: true,
              text: label('update.upgraded', `已升级到 ${result.version ?? installed}，无需重启`),
            });
            await updateStore.refresh(false);
            return;
          }
          if (result?.error === 'already-installed') {
            setUpgradeNote({
              ok: true,
              text: label('update.alreadyLatest', `已是最新版本 ${installed}`),
            });
            await updateStore.refresh(false);
            return;
          }
          if (result?.application === 'restart-required') {
            setUpgradeNote({
              ok: false,
              text: label('update.upgradeNeedsRestart', '已安装新版本，重启 Harness 后生效'),
            });
            return;
          }
          setUpgradeNote({
            ok: false,
            text: label('update.upgradeFailed', `升级失败：${result?.error ?? result?.application ?? '未知错误'}`),
          });
        } catch (error) {
          setUpgradeNote({
            ok: false,
            text: label('update.upgradeFailed', `升级失败：${error instanceof Error ? error.message : String(error)}`),
          });
        } finally {
          setUpgrading(false);
        }
      };

      const iconButton = (onClick, disabled, title, child) =>
        React.createElement(
          'button',
          {
            type: 'button',
            onClick,
            disabled: disabled === true,
            title,
            'aria-label': title,
            style: {
              width: '26px',
              height: '26px',
              padding: 0,
              border: 'none',
              borderRadius: '6px',
              background: 'transparent',
              color: 'inherit',
              cursor: disabled === true ? 'progress' : 'pointer',
              opacity: disabled === true ? 0.45 : 0.72,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            },
          },
          child,
        );

      const icon = (path) =>
        React.createElement(
          'svg',
          { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          path,
        );

      return React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flex: '1 1 auto',
            justifyContent: 'flex-end',
            minWidth: 0,
          },
        },
        // ⭐ 按钮的悬停动画样式（深色胶囊 hover：星星放大轻旋 + 星芒迸发 + 描边提亮）。
        React.createElement('style', { 'data-dsw-star-style': '' }, STAR_PILL_CSS),
        // 版本 chip：有新版本时用警示色标出目标版本。
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 9px',
              borderRadius: '999px',
              background: 'rgba(127,127,127,.16)',
              fontSize: '11px',
              lineHeight: '16px',
              whiteSpace: 'nowrap',
              flex: 'none',
            },
          },
          `v${status?.version ?? '—'}`,
          status?.updateAvailable
            ? React.createElement(
                'span',
                { style: { color: 'var(--dsw-alias-state-warning-primary, #f0a441)', fontWeight: 600 } },
                `→ ${status?.latest ?? ''}`,
              )
            : null,
        ),
        // 升级结果提示（成功/失败一句话），过长省略。
        upgradeNote !== null
          ? React.createElement(
              'span',
              {
                title: upgradeNote.text,
                style: {
                  fontSize: '11px',
                  maxWidth: '210px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: upgradeNote.ok === true ? '#3fa66b' : 'var(--dsw-alias-state-error-primary, #d05a5a)',
                  flex: 'none',
                },
              },
              upgradeNote.text,
            )
          : null,
        status?.checkedAt
          ? React.createElement(
              'span',
              { style: { fontSize: '11px', opacity: '.45', whiteSpace: 'nowrap', flex: 'none' } },
              `${label('update.checkedAt', '上次检查')} ${new Date(status.checkedAt).toLocaleTimeString()}`,
            )
          : null,
        // 「检测更新」用文字按钮：头部的 ↻ 已属于天气刷新，两个同形圆箭头会混淆。
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: runCheck,
            disabled: checking,
            title: label('update.checkTip', '检查插件新版本'),
            'aria-label': label('update.check', '检测更新'),
            style: {
              padding: '3px 10px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))',
              background: 'transparent',
              color: 'inherit',
              fontSize: '11px',
              lineHeight: '16px',
              whiteSpace: 'nowrap',
              cursor: checking ? 'progress' : 'pointer',
              opacity: checking ? 0.5 : 0.8,
              flex: 'none',
            },
          },
          checking ? label('update.checking', '检查中…') : label('update.checkShort', '检测更新'),
        ),
        // 「⭐ 点个 Star」：深色胶囊 + 星星 + 文字，点击新标签页打开 GitHub 仓库。
        // 原「↗ 查看发布页」图标位；hover 动画见 STAR_PILL_CSS。
        React.createElement(
          'a',
          {
            href: 'https://github.com/liuleiyu121520/dsh-wallpaper',
            target: '_blank',
            rel: 'noreferrer',
            title: label('update.starTip', '给插件点个 Star'),
            'aria-label': label('update.starTip', '给插件点个 Star'),
            className: 'dsw-star-btn',
            style: { flex: 'none' },
          },
          React.createElement(
            'svg',
            {
              className: 'dsw-star-ico',
              width: 14,
              height: 14,
              viewBox: '0 0 16 16',
              fill: 'none',
              'aria-hidden': 'true',
            },
            React.createElement('path', {
              d: 'M8 1.7l1.85 3.75 4.15.6-3 2.93.7 4.12L8 11.15 4.3 13.1l.7-4.12-3-2.93 4.15-.6z',
              fill: '#f7c948',
            }),
            React.createElement('path', {
              className: 'dsw-star-spark',
              d: 'M13.1 2.2l.55 1.35 1.35.55-1.35.55-.55 1.35-.55-1.35-1.35-.55 1.35-.55z',
              fill: '#ffe08a',
            }),
          ),
          React.createElement('span', null, label('update.star', '点个 Star')),
        ),
        status?.updateAvailable
          ? iconButton(runUpgrade, upgrading, label('update.available', '有新版本可用'),
              icon(React.createElement('path', {
                d: 'M8 2.6v7M5 7.2l3 3 3-3M3 12.8h10',
                stroke: 'currentColor',
                strokeWidth: 1.4,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              })))
          : null,
      );
    }

    function SceneryDialog({ t }) {
      const open = React.useSyncExternalStore(
        sceneryDialogStore.subscribe,
        sceneryDialogStore.get,
        sceneryDialogStore.get,
      );
      React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') sceneryDialogStore.setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open]);
      if (!open) return null;
      const text = (key, fallback) => {
        try {
          const value = typeof t === 'function' ? t(key) : undefined;
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        } catch {}
        return fallback;
      };
      return React.createElement(
        'div',
        {
          'data-dsh-wallpaper-dialog': '',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': text('menu.entry', '换景'),
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 1300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // 背板不能用 backdrop-filter：它采样不到 WebGL 画布（壁纸就是），
              // 采样结果按透明合成到黑底上 → 整屏发黑。也不用 color-mix+var：
              // scrim 变量在浅色主题下是白色，解析出来会变成不透明白。固定 24%
              // 暗蒙层在两种主题下都只是轻轻压暗，壁纸始终透出来。
              backgroundColor: 'rgb(12 16 22 / 24%)',
              pointerEvents: 'auto',
              fontFamily: 'inherit',
            },
          onClick: (event) => {
            if (event.target === event.currentTarget) sceneryDialogStore.setOpen(false);
          },
        },
        React.createElement(
          'div',
          {
            style: {
              boxSizing: 'border-box',
              width: 'min(720px, calc(100vw - 48px))',
              maxHeight: 'min(78vh, 780px)',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: '16px',
                border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))',
                // 卡片同样不做 backdrop-filter（同背板的采样问题）：半透明主题底
                // 色足以与全局面板统一，壁纸隐约透出。
                background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2, #1f232b) 92%, transparent)',
              boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 7%), 0 24px 64px rgb(0 0 0 / 40%)',
              color: 'var(--dsw-alias-label-primary, inherit)',
              fontSize: '13px',
              overflow: 'hidden',
            },
          },
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '14px 18px',
                borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22))',
                flex: '0 0 auto',
              },
            },
            React.createElement('div', { style: { fontWeight: 600, fontSize: '14px', flex: 'none' } }, text('menu.entry', '换景')),
            React.createElement(UpdateControls, { t }),
            React.createElement(
              'button',
              {
                type: 'button',
                'aria-label': text('dialog.close', '关闭'),
                onClick: () => sceneryDialogStore.setOpen(false),
                style: {
                  marginLeft: 'auto',
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  opacity: '.55',
                  font: 'inherit',
                  fontSize: '16px',
                  lineHeight: 1,
                  padding: '2px 6px',
                },
              },
              '✕',
            ),
          ),
          React.createElement(
            'div',
            { style: { overflowY: 'auto', padding: '18px', flex: '1 1 auto' } },
            React.createElement(WallpaperSettingsPage, { t }),
          ),
        ),
      );
    }

    /**
     * 账号菜单的「换景」快捷入口。
     *
     * 宿主没有给账号菜单提供官方插槽（只有 shell.overlay / settings.section），
     * 这里用「文本匹配 + 克隆既有菜单行」注入：找到同时含「设置 / 意见反馈 /
     * 退出登录」的弹层后，克隆「设置」那一行（自动继承宿主配色、圆角、hover），
     * 文案换成「换景」、图标换成风景线性图标，点击收起宿主菜单并打开换景弹窗。
     * 找不到就静默不动——宿主自己的菜单项完全不受影响。
     */
    const mountUserMenuShortcut = (ctx) => {
      const t = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind('dsh-wallpaper') : undefined;
      const text = (key, fallback) => {
        try {
          const value = t ? t(key) : undefined;
          return typeof value === 'string' && value !== '' && value !== key ? value : fallback;
        } catch {
          return fallback;
        }
      };
      // 菜单文案随宿主语言走，中英两套都认；三件套同框才判定为账号菜单。
      const SETTINGS = ['设置', 'Settings'];
      const ANCHOR = ['意见反馈', '帮助与反馈', 'Feedback'];
      const LOGOUT = ['退出登录', '退出登录/注销', 'Log out', 'Log Out', 'Logout'];
      const MARK = 'data-dsh-wallpaper-menu';
      const entryLabel = text('menu.entry', '换景');

      /** 深度优先找「包含全部三个菜单项文案」的最小容器。 */
      const findMenuRoot = () => {
        const all = document.querySelectorAll('div,ul,section,nav');
        let best = null;
        for (const node of all) {
          const own = node.textContent ?? '';
          if (!SETTINGS.some((s) => own.includes(s))) continue;
          if (!ANCHOR.some((s) => own.includes(s))) continue;
          if (!LOGOUT.some((s) => own.includes(s))) continue;
          // 面积更小 = 更贴近菜单本体，避开整个弹层/页面容器。
          if (best === null || best.contains(node)) best = node;
        }
        return best;
      };

      /** 找「直接文本恰好等于标签」的最小元素（用于换文案）。 */
      const findLabelElement = (root, labels) => {
        for (const node of root.querySelectorAll('div,li,button,a,span')) {
          const direct = Array.from(node.childNodes)
            .filter((child) => child.nodeType === 3)
            .map((child) => (child.textContent ?? '').trim())
            .join('')
            .trim();
          if (direct === '') continue;
          if (labels.some((s) => direct === s)) return node;
        }
        return null;
      };

      /**
       * 从命中的文字元素向上爬到「菜单行」：
       * 父级若已经包含别的菜单项文案，说明当前就是一整行；否则还在行内部。
       */
      const rowFor = (element, root) => {
        let row = element;
        while (row && row.parentNode && row.parentNode !== root) {
          const parentText = row.parentNode.textContent ?? '';
          const hasOtherItem = ANCHOR.some((s) => parentText.includes(s)) || LOGOUT.some((s) => parentText.includes(s));
          if (hasOtherItem) break;
          row = row.parentNode;
        }
        return row;
      };

      const inject = () => {
        const root = findMenuRoot();
        if (!root) return;
        const labelElement = findLabelElement(root, SETTINGS);
        if (!labelElement) return;
        const settingsRow = rowFor(labelElement, root);
        if (!settingsRow || !settingsRow.parentNode) return;
        if (settingsRow.parentNode.querySelector(`[${MARK}]`)) return;
        const row = settingsRow.cloneNode(true);
        row.setAttribute(MARK, '1');
        // 克隆件上换文案、去掉快捷键提示（⌘,），保留其余结构以继承样式。
        for (const node of Array.from(row.querySelectorAll('kbd,span,div,p'))) {
          const direct = Array.from(node.childNodes)
            .filter((child) => child.nodeType === 3)
            .map((child) => (child.textContent ?? '').trim())
            .join('');
          if (/^[⌘⌃⌥⇧]|Ctrl|Cmd/i.test(direct)) node.remove();
        }
        const clonedLabel = findLabelElement(row, SETTINGS);
        if (clonedLabel) clonedLabel.textContent = entryLabel;
        else row.textContent = entryLabel;
        // 图标换成「风景/壁纸」线性图标，避免和「设置」的齿轮混淆。
        const iconHost = row.querySelector('.icon, svg, [class*="icon"]');
        if (iconHost) {
          iconHost.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5-9 8"/></svg>';
        }
        row.setAttribute('role', 'menuitem');
        row.setAttribute('aria-label', entryLabel);
        // 宿主菜单常在 pointerdown 就关闭并重渲染，click 来不及派发——这是
        // 「入口看得见但点不动」的根因。三个事件都听、先到先开，后续 400ms 内去重。
        row.style.pointerEvents = 'auto';
        row.style.cursor = 'pointer';
        /**
         * 收起宿主菜单。
         *
         * 宿主有两套关闭路径，克隆行一套都走不到：
         * 1. 每个菜单项自己的 React onClick → `onSelect(id)` → `setOpen(false)`。
         *    克隆件是 raw DOM，没有 React props，这条路径永远不触发；
         * 2. ui-primitives 的 `useDismissOnOutsidePointer`：document 上监听
         *    pointerdown，目标不在「触发按钮 + 菜单面板」内才关闭。克隆行本身
         *    就在面板里，点它不算「外面」。
         *
         * 所以这里替用户补一次第 2 条路径：在面板之外（body）派发一次
         * pointerdown，宿主的监听会判定为外部点击并收起菜单。事件直接派发在
         * body 上，不会经过 React 根容器，因此不会顺带触发表单聚焦或其他面板。
         */
        const dismissHostMenu = () => {
          const init = {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            pointerType: 'mouse',
          };
          try {
            const target = document.body;
            const event =
              typeof PointerEvent === 'function'
                ? new PointerEvent('pointerdown', init)
                : new MouseEvent('pointerdown', init);
            target.dispatchEvent(event);
          } catch {}
        };
        let lastOpenedAt = 0;
        const openDialog = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const now = Date.now();
          if (now - lastOpenedAt < 400) return;
          lastOpenedAt = now;
          // 先收菜单再开弹窗：菜单收起可能把焦点还给账号入口，这个顺序下
          // 弹窗最后挂载，不会被它的焦点归还抢走。
          dismissHostMenu();
          sceneryDialogStore.setOpen(true);
        };
        for (const type of ['pointerdown', 'mousedown', 'click']) {
          row.addEventListener(type, openDialog, true);
        }
        settingsRow.insertAdjacentElement('afterend', row);
      };

      let pending = 0;
      const schedule = () => {
        if (pending) return;
        pending = requestAnimationFrame(() => {
          pending = 0;
          try {
            inject();
          } catch {}
        });
      };

      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      schedule();
      return () => {
        observer.disconnect();
        for (const node of document.querySelectorAll(`[${MARK}]`)) node.remove();
      };
    };

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => start(ctx), 'dsh-wallpaper: background layer');
        // 「换景」弹窗的程序化开关：与 CHANGE_EVENT / MODE_EVENT 同一模式的自定义
        // 事件，快捷入口、QA、将来的快捷键都走它（detail.open 默认 true）。
        const onSceneryToggle = (event) => {
          sceneryDialogStore.setOpen(event?.detail?.open !== false);
        };
        window.addEventListener('dsh-wallpaper:scenery', onSceneryToggle);
        ctx.effect(
          () => () => window.removeEventListener('dsh-wallpaper:scenery', onSceneryToggle),
          'dsh-wallpaper: scenery dialog toggle',
        );
        // 用户名弹窗的快捷入口与渲染层独立挂载/清理。
        ctx.effect(() => mountUserMenuShortcut(ctx), 'dsh-wallpaper: menu shortcut');


        const t = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind('dsh-wallpaper') : undefined;

        // 「换景」弹窗与更新提示都挂在 shell.overlay：overlay 层 click-through，
        // 卡片自己 opt-in。设置页不再挂 tab——用户名弹窗的「换景」入口直接弹出
        // 完整设置面板（用户要求的交互）。
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-wallpaper-update', order: 42, locale: 'dsh-wallpaper' },
            (props) =>
              React.createElement(
                React.Fragment,
                null,
                React.createElement(WallpaperUpdateOverlay, { ...props, t: props.t ?? t }),
                React.createElement(SceneryDialog, { ...props, t: props.t ?? t }),
              ),
          ),
        );
      },
    };
  },
});

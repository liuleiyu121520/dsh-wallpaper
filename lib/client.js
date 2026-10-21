window.__ModuleLoader__.load({
  id: 'dsh-wallpaper',
  factory(require) {
    const React = require('react');
    const POLL_MS = 2000;
    const FADE_MS = 900;
    const STORAGE_KEY = 'dsh.wallpaper.look';
    const CHANGE_EVENT = 'dsh-wallpaper:look';
    const DEFAULT_LOOK = { opacity: 1, blurPx: 0, scrim: 0.35, saturate: 1, surface: 0.5 };
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
      const scrim = doc.createElement('div');
      Object.assign(scrim.style, { position: 'absolute', inset: '0' });
      container.append(scrim);
      doc.body.prepend(container);

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

      const mix = (color, alpha) =>
        `color-mix(in srgb, ${color} ${Math.round(Math.min(1, Math.max(0, alpha)) * 100)}%, transparent)`;

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
          img.style.opacity = front === key ? String(look.opacity) : '0';
        }
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
        scrim.style.background = mix(theme.base, look.scrim);

        setTokens('--dsh-wallpaper-surface', mix(theme.base, look.surface));
        setTokens('--dsw-alias-bg-base', 'var(--dsh-wallpaper-surface)');
        setTokens('--dsw-alias-bg-layer-1', mix(theme.layer1, look.surface + 0.08));
        setTokens('--dsw-alias-bg-layer-2', mix(theme.layer2, look.surface + 0.16));

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
          `--dsw-alias-bg-layer-3:${theme.layer1};` +
          `background-color:${theme.base} !important;}`;
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
        try {
          const res = await fetch('/api/dsh-wallpaper/discover', { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            hostLook = {
              opacity: typeof data.opacity === 'number' ? data.opacity : hostLook.opacity,
              blurPx: typeof data.blurPx === 'number' ? data.blurPx : hostLook.blurPx,
              scrim: typeof data.scrim === 'number' ? data.scrim : hostLook.scrim,
              saturate: typeof data.saturate === 'number' ? data.saturate : hostLook.saturate,
              surface: typeof data.surface === 'number' ? data.surface : hostLook.surface,
            };
            look = merged(hostLook);
            applyLook();
            if (data.frame && data.rev && data.rev !== revision) await load(data.frame, data.rev);
          }
        } catch {}
        if (!disposed) timer = window.setTimeout(poll, POLL_MS);
      };

      const onLookChange = () => {
        look = merged(hostLook);
        applyLook();
      };
      window.addEventListener(CHANGE_EVENT, onLookChange);

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

      poll();

      return () => {
        disposed = true;
        window.removeEventListener(CHANGE_EVENT, onLookChange);
        themeObserver.disconnect();
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

    /** Read the installed plugin's version and update status from the Host. */
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
        bottom: '18px',
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
            `发现新版本 ${version}（当前 ${current}），可到设置页升级。`,
            { current, version },
          ),
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
      const status = snapshot.status;
      const [checking, setChecking] = React.useState(false);
      const [upgrading, setUpgrading] = React.useState(false);
      const [upgradeNote, setUpgradeNote] = React.useState(null);
      const valuesRef = React.useRef(merged({}));

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
          '.wb-row{display:flex;align-items:center;gap:14px;min-height:26px}' +
          '.wb-name{width:112px;flex:none;font-size:14px;line-height:18px}' +
          '.wb-track{flex:1;min-width:0;position:relative}' +
          '.wb-value{width:52px;flex:none;text-align:right;font-size:14px;line-height:18px;' +
          'opacity:.6;font-variant-numeric:tabular-nums}' +
          '.wb-hint{margin:0 0 0 126px;font-size:12px;line-height:16px;opacity:.42}' +'.wb-block{display:flex;flex-direction:column;gap:1px}';
        host.append(style);

        const wrap = document.createElement('div');
        Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '9px' });

        for (const spec of SLIDERS) {
          const block = document.createElement('div');
          block.className = 'wb-block';

          const row = document.createElement('div');
          row.className = 'wb-row';

          const name = document.createElement('span');
          name.className = 'wb-name';
          name.textContent = spec.label;

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
          input.setAttribute('aria-label', spec.label);
          track.append(input);

          const readout = document.createElement('span');
          readout.className = 'wb-value';
          readout.dataset.readout = spec.key;
          readout.textContent = spec.unit === 'px' ? String(Math.round(valuesRef.current[spec.key])) : valuesRef.current[spec.key].toFixed(2);

          input.addEventListener('input', () => {
            const raw = Number(input.value);
            writeOverrides({ ...(readOverrides() ?? {}), [spec.key]: raw });
            readout.textContent = spec.unit === 'px' ? String(Math.round(raw)) : raw.toFixed(2);
            announce();
          });

          row.append(name, track, readout);
          block.append(row);

          const hint = document.createElement('div');
          hint.className = 'wb-hint';
          hint.textContent = spec.hint;
          block.append(hint);

          wrap.append(block);
        }

        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = label('reset', '恢复默认');
        Object.assign(reset.style, {
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
            const current = defaults[spec.key];
            out.textContent = spec.unit === 'px' ? String(Math.round(current)) : current.toFixed(2);
          }
        });
        wrap.append(reset);

        host.append(wrap);
      }, []);

      const runCheck = async () => {
        setChecking(true);
        try {
          await updateStore.refresh(true);
        } finally {
          setChecking(false);
        }
      };

      /**
       * Install the newest release in place.
       *
       * The Host runs `pluginManager.installBundle`, which applies its own
       * reload lifecycle: a live profile hot-swaps the bundle, and only a
       * profile that needs a restart reports `restart-required` — surfaced here
       * as an instruction rather than silently claiming success.
       */
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
            // The Host re-checked after installing; mirror it so the nav mark clears.
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
        { style: { display: 'flex', flexDirection: 'column' } },
        React.createElement(
          'div',
          { style: { ...card, marginBottom: '14px' } },
          React.createElement('div', { ref: hostRef }),
        ),
        React.createElement(
          'div',
          { style: card },
          React.createElement('div', { style: { fontSize: '14px', fontWeight: 600 } }, label('update.title', '插件更新')),
          React.createElement(
            'div',
            { style: { ...textStyle, display: 'flex', flexWrap: 'wrap', gap: '18px' } },
            React.createElement('span', null, `${label('update.current', '当前版本')} ${status?.version ?? '—'}`),
            React.createElement(
              'span',
              null,
              `${label('update.latest', '最新版本')} ${status?.latest ?? label('update.unknown', '未检查')}`,
            ),
            status?.updateAvailable
              ? React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: runUpgrade,
                    disabled: upgrading,
                    title: label('update.upgradeHint', '直接安装最新版本，无需手动执行命令'),
                    style: {
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      color: '#4d6bfe',
                      fontWeight: 600,
                      font: 'inherit',
                      fontSize: '13px',
                      cursor: upgrading ? 'progress' : 'pointer',
                      opacity: upgrading ? 0.7 : 1,
                      textDecoration: 'underline',
                      textUnderlineOffset: '2px',
                    },
                  },
                  upgrading
                    ? label('update.upgrading', '正在升级…')
                    : label('update.available', '有新版本可用'),
                )
              : null,
            upgradeNote !== null
              ? React.createElement(
                  'span',
                  {
                    style: {
                      fontSize: '12px',
                      color: upgradeNote.ok === true ? '#3fa66b' : 'var(--dsw-alias-state-error-primary, #d05a5a)',
                    },
                  },
                  upgradeNote.text,
                )
              : null,
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: runCheck,
                disabled: checking,
                style: {
                  padding: '7px 16px',
                  borderRadius: 'var(--dsw-radius-md, 8px)',
                  cursor: checking ? 'progress' : 'pointer',
                  color: '#fff',
                  background: '#4d6bfe',
                  border: 'none',
                  fontFamily: 'inherit',
                  fontSize: '13px',
                  opacity: checking ? 0.7 : 1,
                },
              },
              checking ? label('update.checking', '检查中…') : label('update.check', '检查更新'),
            ),
            status?.url
              ? React.createElement(
                  'a',
                  { href: status.url, target: '_blank', rel: 'noreferrer', style: { fontSize: '13px', opacity: '.75' } },
                  label('update.release', '查看发布页'),
                )
              : null,
            status?.checkedAt
              ? React.createElement(
                  'span',
                  { style: { ...textStyle, opacity: '.45' } },
                  `${label('update.checkedAt', '上次检查')} ${new Date(status.checkedAt).toLocaleTimeString()}`,
                )
              : null,
          ),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => start(ctx), 'dsh-wallpaper: background layer');

        const t = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind('dsh-wallpaper') : undefined;

        // Frame-wide reminder. `shell.overlay` is the documented additive seat
        // for a toast or badge; the layer is click-through, the card opts in.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-wallpaper-update', order: 42, locale: 'dsh-wallpaper' },
            (props) => React.createElement(WallpaperUpdateOverlay, { ...props, t: props.t ?? t }),
          ),
        );

        // One settings page holds every parameter plus the update check, so the
        // floating panel that used to cover the composer is gone.
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-wallpaper',
              order: 40,
              label: () => {
                const base = (() => {
                  try {
                    const translated = ctx.locale?.bind?.('dsh-wallpaper')?.('nav');
                    if (typeof translated === 'string' && translated !== '' && translated !== 'nav') return translated;
                  } catch {}
                  return '实时壁纸外观';
                })();
                // A trailing dot marks a pending update without adding a second
                // nav row or reaching into another plugin's DOM.
                const current = updateStore.get().status;
                return current?.updateAvailable === true && current.dismissed !== true ? `${base} ·` : base;
              },
              locale: 'dsh-wallpaper',
            },
            (props) => React.createElement(WallpaperSettingsPage, { ...props, t: props.t ?? t }),
          ),
        );
      },
    };
  },
});

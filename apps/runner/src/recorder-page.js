/**
 * Recorder script, injected into every document of the recorder browser with addInitScript
 * (PROJECT_RULES §8). Plain JavaScript without imports: it runs inside the tested page.
 *
 * It only reports what the tester does; the runner validates every event (the page is untrusted)
 * and stores it. Locators are chosen from stable to fragile and checked to match exactly one
 * element on this page at the moment of the action; the final check is the run itself.
 *
 * `config` is injected by the runner: { binding, roles: string[], looksGeneratedId(id) }.
 */
// biome-ignore lint/correctness/noUnusedVariables: called by the injected bootstrap in recorder.ts
function flowcheckRecorder(config) {
  if (window.__flowcheckRecorderInstalled) return;
  window.__flowcheckRecorderInstalled = true;

  const MAX_NAME = 80;
  const MAX_VALUE = 500;
  const FILL_DEBOUNCE_MS = 700;
  const ROLES = new Set(config.roles);
  const TEST_ID_ATTRIBUTES = ['data-test', 'data-qa', 'data-cy', 'data-test-id'];
  const TEXT_TYPES = new Set([
    'text',
    'email',
    'password',
    'search',
    'tel',
    'url',
    'number',
    'date',
    'time',
    'datetime-local',
    'month',
    'week',
  ]);
  const CLICKABLE =
    'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [onclick]';
  /** Elements that may carry a role, so the uniqueness check does not scan the whole page. */
  const ROLE_POOL = {
    button: 'button, input, summary',
    link: 'a, area',
    textbox: 'input, textarea',
    searchbox: 'input',
    spinbutton: 'input',
    slider: 'input',
    checkbox: 'input',
    radio: 'input',
    combobox: 'select, input',
    listbox: 'select',
    option: 'option',
    heading: 'h1, h2, h3, h4, h5, h6',
    img: 'img, svg',
  };

  // ---- Sending ----

  const uuid = () => {
    // crypto.randomUUID needs a secure context; test sites are often plain http.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const send = (event) => {
    const binding = window[config.binding];
    if (typeof binding !== 'function') return;
    Promise.resolve(binding({ clientEventId: uuid(), ...event })).catch(() => undefined);
  };
  const warned = new Set();
  const warnOnce = (what) => {
    if (warned.has(what)) return;
    warned.add(what);
    send({ kind: 'unsupported', what });
  };

  const isMainFrame = (() => {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  })();
  if (!isMainFrame) {
    // Frames are not supported by the recorder: report the first interaction instead of recording it.
    for (const type of ['pointerdown', 'keydown', 'input']) {
      addEventListener(type, (e) => e.isTrusted && warnOnce('iframe'), true);
    }
    return;
  }

  // ---- Text helpers ----

  const collapse = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const clean = (s) => ![...s].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
  const usableName = (s) => s.length > 0 && s.length <= MAX_NAME && clean(s);
  const usableValue = (s) => s.length > 0 && s.length <= MAX_VALUE && clean(s);
  const attr = (el, name) => collapse(el.getAttribute(name));
  const q = (v) => `"${CSS.escape(v)}"`;

  // ---- Roles and names (Chromium's own accessibility values when available) ----

  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'a' || tag === 'area') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'img') return el.getAttribute('alt') ? 'img' : null;
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'option') return 'option';
    if (tag === 'input') {
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'search') return 'searchbox';
      if (type === 'number') return 'spinbutton';
      if (type === 'range') return 'slider';
      if (type === 'hidden') return null;
      return 'textbox';
    }
    return null;
  }
  function roleOf(el) {
    const explicit = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0];
    const role = explicit || (typeof el.computedRole === 'string' && el.computedRole) || implicitRole(el);
    return role && ROLES.has(role) ? role : null;
  }
  function nameOf(el) {
    if (typeof el.computedName === 'string') return collapse(el.computedName);
    const label = attr(el, 'aria-label');
    if (label) return label;
    if (el.labels?.length) return collapse(Array.from(el.labels, (l) => l.textContent).join(' '));
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return attr(el, 'alt');
    if (tag === 'input') return attr(el, 'value');
    return collapse(el.textContent);
  }
  /** Hidden from the accessibility tree: getByRole does not match it. */
  const a11yHidden = (el) =>
    !!el.closest('[aria-hidden="true"]') || (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true }));

  function labelTexts(el) {
    const out = [];
    const aria = attr(el, 'aria-label');
    if (aria) out.push(aria);
    const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    if (ids.length) out.push(collapse(ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')));
    for (const l of el.labels ?? []) out.push(collapse(l.textContent));
    return out;
  }

  // ---- Candidates: each knows how to find its matches under a root ----

  const all = (root, selector) => Array.from(root.querySelectorAll(selector));
  const byAttr = (name, value) => (root) => all(root, `[${name}=${q(value)}]`);
  /** Like getByText(exact): the smallest elements whose whole text is the value. */
  const byText = (value) => (root) =>
    all(root, '*').filter(
      (e) => collapse(e.textContent) === value && !Array.from(e.children).some((c) => collapse(c.textContent) === value),
    );
  const byRole = (role, name) => (root) =>
    all(root, `${ROLE_POOL[role] ? `${ROLE_POOL[role]}, ` : ''}[role=${q(role)}]`).filter(
      (e) => roleOf(e) === role && !a11yHidden(e) && nameOf(e) === name,
    );
  const byLabel = (value) => (root) =>
    all(root, 'input, textarea, select, button, [aria-label], [aria-labelledby]').filter((e) => labelTexts(e).includes(value));

  function candidates(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const field = tag === 'input' || tag === 'textarea' || tag === 'select';
    const testId = el.getAttribute('data-testid');
    if (testId && usableValue(testId)) out.push({ locator: { kind: 'testId', value: testId }, find: byAttr('data-testid', testId) });
    for (const name of TEST_ID_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value && usableValue(value)) out.push({ locator: { kind: 'attribute', name, value }, find: byAttr(name, value) });
    }
    const role = roleOf(el);
    const name = role ? nameOf(el) : '';
    const hasRoleLocator = role !== null && usableName(name);
    if (hasRoleLocator) out.push({ locator: { kind: 'role', role, name }, find: byRole(role, name), scopable: true });
    if (field) {
      for (const label of labelTexts(el)) {
        if (usableName(label)) out.push({ locator: { kind: 'label', value: label, exact: true }, find: byLabel(label) });
      }
      const placeholder = el.getAttribute('placeholder') ?? '';
      if (usableName(placeholder) && placeholder === collapse(placeholder)) {
        out.push({ locator: { kind: 'placeholder', value: placeholder, exact: true }, find: byAttr('placeholder', placeholder) });
      }
    }
    const nameAttr = el.getAttribute('name');
    if (nameAttr && usableValue(nameAttr) && (field || tag === 'button')) {
      out.push({ locator: { kind: 'attribute', name: 'name', value: nameAttr }, find: byAttr('name', nameAttr) });
    }
    const alt = el.getAttribute('alt');
    if (tag === 'img' && alt && usableName(alt))
      out.push({ locator: { kind: 'altText', value: alt, exact: true }, find: byAttr('alt', alt) });
    const title = el.getAttribute('title');
    if (title && usableName(title)) out.push({ locator: { kind: 'title', value: title, exact: true }, find: byAttr('title', title) });
    if (!hasRoleLocator && !field) {
      const text = collapse(el.textContent);
      if (usableName(text)) out.push({ locator: { kind: 'text', value: text, exact: true }, find: byText(text), scopable: true });
    }
    const id = el.getAttribute('id');
    if (id && usableValue(id) && !config.looksGeneratedId(id)) out.push({ locator: { kind: 'id', value: id }, find: byAttr('id', id) });
    return out;
  }

  const uniqueIn = (root, candidate, el) => {
    const found = candidate.find(root);
    return found.length === 1 && found[0] === el;
  };

  /** Nearest ancestor with a stable, unique handle, to scope an ambiguous role/text locator. */
  function containerFor(el, candidate) {
    for (let node = el.parentElement, depth = 0; node && node !== document.body && depth < 10; node = node.parentElement, depth++) {
      const handles = candidates(node).filter((c) => ['testId', 'attribute', 'id'].includes(c.locator.kind));
      for (const handle of handles) {
        if (uniqueIn(document, handle, node) && uniqueIn(node, candidate, el)) return handle.locator;
      }
    }
    return null;
  }

  function cssPath(el) {
    const parts = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const id = node.getAttribute('id');
      if (node !== el && id && !config.looksGeneratedId(id) && all(document, `[id=${q(id)}]`).length === 1) {
        parts.unshift(`#${CSS.escape(id)}`);
        break;
      }
      const tag = node.tagName.toLowerCase();
      const same = node.parentElement ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName) : [node];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
    }
    return parts.join(' > ');
  }

  /** The most stable locator that matches exactly this element; css paths are marked fragile. */
  function describe(el) {
    const list = candidates(el);
    for (const c of list) {
      if (uniqueIn(document, c, el)) return { locator: c.locator, fragile: false };
    }
    for (const c of list) {
      if (!c.scopable) continue;
      const within = containerFor(el, c);
      if (within) return { locator: { ...c.locator, within }, fragile: false };
    }
    const id = el.getAttribute('id');
    if (id && usableValue(id) && all(document, `[id=${q(id)}]`).length === 1) return { locator: { kind: 'id', value: id }, fragile: true };
    const path = cssPath(el);
    return { locator: { kind: 'css', value: path.length <= MAX_VALUE ? path : path.slice(-MAX_VALUE) }, fragile: true };
  }

  // ---- Overlay (shadow root, never recorded) ----

  const OVERLAY_CSS = `
    .bar{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;
      border-radius:999px;background:#111827;color:#fff;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)}
    .dot{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:p 1.2s infinite}
    @keyframes p{50%{opacity:.35}}
    button{all:unset;cursor:pointer;padding:6px 12px;border-radius:999px;background:#ef4444;color:#fff}
    button:focus-visible{outline:2px solid #fff}`;
  let overlayHost = null;
  /** Built with DOM APIs and a constructed stylesheet so strict CSP / Trusted Types pages still work. */
  function mountOverlay() {
    if (overlayHost || !document.documentElement) return;
    try {
      const host = document.createElement('flowcheck-recorder');
      host.setAttribute('data-flowcheck-recorder', '');
      const root = host.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(OVERLAY_CSS);
      root.adoptedStyleSheets = [sheet];
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.setAttribute('role', 'status');
      const dot = document.createElement('span');
      dot.className = 'dot';
      const text = document.createElement('span');
      text.textContent = 'FlowCheck is recording';
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.textContent = 'Stop';
      stop.addEventListener('click', () => {
        flushPending();
        send({ kind: 'stop' });
      });
      bar.append(dot, text, stop);
      root.append(bar);
      document.documentElement.appendChild(host);
      overlayHost = host;
    } catch {
      // The overlay is a convenience; recording works without it (stop from FlowCheck).
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountOverlay, { once: true });
  else mountOverlay();

  const fromOverlay = (e) => overlayHost !== null && e.composedPath().includes(overlayHost);
  /** Events from inside a shadow root are retargeted; such targets are not supported. */
  const inShadow = (e) => e.composedPath()[0] !== e.target;

  // ---- Typing: one fill per field, sent after a pause and before any other action ----

  let pending = null;
  let timer = 0;
  function flushPending() {
    clearTimeout(timer);
    if (!pending) return;
    const value = pending.password ? '' : pending.el.value;
    if (value === pending.lastSent) return;
    pending.lastSent = value;
    send({ kind: 'fill', locator: pending.locator, fragile: pending.fragile, value: value.slice(0, 2000), password: pending.password });
  }
  window.__flowcheckRecorderFlush = flushPending;

  const isTextField = (el) => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type));

  addEventListener(
    'input',
    (e) => {
      if (!e.isTrusted || fromOverlay(e)) return;
      if (inShadow(e)) return warnOnce('shadowDom');
      const el = e.target;
      if (isTextField(el)) {
        if (pending?.el !== el) {
          flushPending();
          pending = { el, ...describe(el), password: el.type === 'password', lastSent: undefined };
        }
        clearTimeout(timer);
        timer = setTimeout(flushPending, FILL_DEBOUNCE_MS);
      } else if (el instanceof HTMLElement && el.isContentEditable) {
        warnOnce('unsupportedField');
      } else if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'file'].includes(el.type)) {
        warnOnce('unsupportedField');
      }
    },
    true,
  );

  addEventListener(
    'change',
    (e) => {
      if (!e.isTrusted || fromOverlay(e) || inShadow(e)) return;
      const el = e.target;
      if (el instanceof HTMLSelectElement) {
        flushPending();
        if (el.multiple) return warnOnce('unsupportedField');
        const option = el.selectedOptions[0];
        if (!option) return;
        const label = collapse(option.label || option.textContent);
        const sameLabel = Array.from(el.options).filter((o) => collapse(o.label || o.textContent) === label).length;
        const by = usableValue(label) && sameLabel === 1 ? { by: 'label', value: label } : { by: 'value', value: option.value };
        if (!usableValue(by.value)) return warnOnce('unsupportedField');
        send({ kind: 'select', ...describe(el), option: by });
      } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
        flushPending();
        send({ kind: el.checked ? 'check' : 'uncheck', ...describe(el) });
      } else if (el instanceof HTMLInputElement && el.type === 'radio') {
        flushPending();
        if (el.checked) send({ kind: 'check', ...describe(el) });
      } else if (el instanceof HTMLInputElement && el.type === 'file') {
        warnOnce('fileInput');
      } else if (pending?.el === el) {
        flushPending();
      }
    },
    true,
  );

  // ---- Clicks ----

  let lastEnterAt = 0;
  addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || fromOverlay(e)) return;
      if (inShadow(e)) return warnOnce('shadowDom');
      if (!(e.target instanceof Element)) return;
      const el = e.target.closest(CLICKABLE) ?? e.target;
      if (el === document.body || el === document.documentElement) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' && el.type === 'file') return warnOnce('fileInput');
      // Fields, checkboxes and selects are recorded from their input/change events.
      if (tag === 'select' || tag === 'textarea' || tag === 'option') return;
      if (tag === 'input' && !['button', 'submit', 'reset', 'image'].includes(el.type)) return;
      if (tag === 'label' && el.control) return;
      // Enter on a button or in a form also fires a click; the recorded key press already does it.
      if (e.detail === 0 && Date.now() - lastEnterAt < 500) return;
      flushPending();
      send({ kind: 'click', ...describe(el) });
    },
    true,
  );

  // ---- Keys: Enter, Tab and Escape ----

  addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted || fromOverlay(e) || e.isComposing) return;
      if (!['Enter', 'Tab', 'Escape'].includes(e.key) || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const el = document.activeElement;
      if (e.key === 'Enter' && el instanceof HTMLTextAreaElement) return; // a new line is part of the typed text
      flushPending();
      if (e.key === 'Enter') lastEnterAt = Date.now();
      const onElement = el && el !== document.body && el !== document.documentElement && !(overlayHost && el === overlayHost);
      send({ kind: 'press', key: e.key, ...(onElement ? describe(el) : { fragile: false }) });
    },
    true,
  );

  addEventListener('drop', (e) => e.isTrusted && warnOnce('dragAndDrop'), true);
  addEventListener('pagehide', flushPending, true);
}

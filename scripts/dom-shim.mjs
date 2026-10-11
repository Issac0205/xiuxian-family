/**
 * 最小 DOM 垫片：让 src 下的界面代码能在 Node 里跑起来，用于自动化冒烟测试。
 * 只实现本项目实际用到的那部分 DOM。
 */

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * dataset 必须真实指向 data-* 属性，否则「JS 里写 dataset、选择器里读属性」就对不上了。
 * 这里用 Proxy 做成 attrs 的视图，语义与浏览器一致。
 */
function createDataset(el) {
  return new Proxy({}, {
    get: (_t, k) => (typeof k === 'string' ? el.attrs[`data-${kebab(k)}`] : undefined),
    set: (_t, k, v) => { el.attrs[`data-${kebab(k)}`] = String(v); return true; },
    has: (_t, k) => typeof k === 'string' && `data-${kebab(k)}` in el.attrs,
    deleteProperty: (_t, k) => { delete el.attrs[`data-${kebab(k)}`]; return true; },
  });
}

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  sync() { this.set = new Set(String(this.el._className || '').split(/\s+/).filter(Boolean)); }
  flush() { this.el._className = [...this.set].join(' '); }
  add(...c) { c.forEach((x) => this.set.add(x)); this.flush(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this.flush(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : Boolean(force);
    if (on) this.set.add(c); else this.set.delete(c);
    this.flush();
    return on;
  }
}

export class Element {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.dataset = createDataset(this);
    this.style = {};
    this._text = '';
    this._className = '';
    this.disabled = false;
    this._listeners = {};
    this._classList = new ClassList(this);
  }

  get classList() { return this._classList; }
  get className() { return this._className; }
  set className(v) { this._className = String(v); this._classList.sync(); }

  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parent; }

  appendChild(child) { child.parent = this; this.children.push(child); return child; }

  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }

  set textContent(v) { this._text = String(v); this.children.length = 0; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }

  /** 真 DOM 上很常用，垫片也得有。 */
  replaceChildren(...nodes) {
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
    this._text = '';
    for (const n of nodes) {
      if (!n) continue;
      n.parent = this;
      this.children.push(n);
    }
  }

  /** 同样常用。 */
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const n of nodes) {
      if (n == null) continue;
      if (typeof n === 'string') { this._text += n; continue; }
      n.parent = this;
      this.children.push(n);
    }
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
    return child;
  }

  set innerHTML(html) {
    this.children.length = 0;
    this._text = '';
    // 顶层文本（标签与标签之间的那部分）也要收下。
    // 早先这里是直接丢掉的，于是 `a <b>x</b> c` 只读得出 "x"。
    for (const node of parseHTML(String(html), (t) => { this._text += t; })) {
      node.parent = this;
      this.children.push(node);
    }
  }
  get innerHTML() { return this.children.map(serialize).join(''); }

  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = v;
    // 真浏览器里这些布尔属性会反射到同名 property 上；
    // 垫片不补这一步的话，`<button disabled>` 读出来永远是 false。
    if (REFLECTED_BOOL.has(k)) this[k] = v !== null && v !== undefined && v !== 'false';
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) {
    delete this.attrs[k];
    if (REFLECTED_BOOL.has(k)) this[k] = false;
  }
  hasAttribute(k) { return k in this.attrs; }

  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  dispatch(type, ev = {}) {
    for (const fn of this._listeners[type] || []) fn({ target: this, ...ev });
  }

  matches(sel) { return matchesSelector(this, sel); }

  querySelector(sel) {
    let found = null;
    walk(this, (n) => { if (!found && n !== this && n.matches(sel)) found = n; });
    return found;
  }

  querySelectorAll(sel) {
    const out = [];
    walk(this, (n) => { if (n !== this && n.matches(sel)) out.push(n); });
    return out;
  }

  closest(sel) {
    let n = this;
    while (n) { if (n.matches && n.matches(sel)) return n; n = n.parent; }
    return null;
  }
}

/** 会反射到同名 property 的布尔属性。 */
const REFLECTED_BOOL = new Set(['disabled', 'checked', 'selected', 'hidden', 'readonly', 'multiple']);

export function walk(node, fn) {  for (const c of node.children) { fn(c); walk(c, fn); }
}

function serialize(el) {
  const attrs = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${el.tagName.toLowerCase()}${attrs}>${el.textContent}</${el.tagName.toLowerCase()}>`;
}

/** 匹配单一复合选择器：tag / #id / .cls / [attr] / [attr="v"] 的组合。 */
function matchesCompound(el, sel) {
  const parts = String(sel).trim().match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/);
  if (!parts) return false;
  if (parts[1] && el.tagName !== parts[1].toUpperCase()) return false;

  for (const token of parts[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
    if (token[0] === '.') {
      if (!el.classList.contains(token.slice(1))) return false;
    } else if (token[0] === '#') {
      if (el.attrs.id !== token.slice(1)) return false;
    } else {
      const m = token.slice(1, -1).match(/^([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?$/);
      if (!m) return false;
      const key = m[1];
      const want = m[2] ?? m[3];
      if (!(key in el.attrs)) return false;
      if (want !== undefined && el.attrs[key] !== want) return false;
    }
  }
  return true;
}

/**
 * 支持后代选择器：`.a .b` / `div.foo span[data-role="x"]`。
 * 用空格切开，最后一节匹配元素本身，其余各节依次向上找祖先。
 *
 * ⚠【修复 t4 缺陷⑦ 的前提】原来**不支持逗号选择器**（`a, b`）。
 *   后果不是「报错」而是**静默不匹配**：`matchesCompound` 对整串
 *   `[data-errand],[data-recall]` 直接返回 false，于是
 *   `src/main.js` 里 `closest('[data-errand],[data-recall]')` 在无头环境
 *   **恒返回 null**、那个处理器**永远不会被触发**。
 *   任何「点一下按钮」的断言都会**静默通过**（真浏览器里却是好的），
 *   这正是「投帖没有入口」那个阻断缺陷能活下来的机制。
 *   ⇒ 逗号先在**顶层**切开：任一分支命中即为命中。
 *   注意切分必须避开 `[]` 与引号内部（属性值里可以有逗号）。
 */
export function matchesSelector(el, sel) {
  const branches = splitSelectorList(sel);
  if (branches.length > 1) return branches.some((b) => matchesSelector(el, b));
  const parts = String(sel).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (!matchesCompound(el, parts[parts.length - 1])) return false;

  let i = parts.length - 2;
  let node = el.parent;
  while (i >= 0 && node) {
    if (matchesCompound(node, parts[i])) i -= 1;
    node = node.parent;
  }
  return i < 0;
}

/**
 * 把 `a, b[x="1,2"], c` 按顶层逗号切开。
 * 括号/引号内部的逗号不切 —— `[data-x="a,b"]` 是一个选择器，不是两个。
 */
export function splitSelectorList(sel) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (const ch of String(sel)) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const TAG_RE = /<!--[\s\S]*?-->|<!(?:DOCTYPE|doctype)[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

export function parseHTML(html, onTopText) {
  const root = [];
  const stack = [{ node: null, list: root }];
  let last = 0;
  let m;

  const pushText = (frame, text) => {
    const t = text.trim();
    if (!t) return;
    // frame.node 为 null 表示这段文本在最外层，没有归属元素
    if (!frame.node) {
      if (onTopText) onTopText(t);
      return;
    }
    frame.node._text += t;
  };

  while ((m = TAG_RE.exec(html))) {
    pushText(stack[stack.length - 1], html.slice(last, m.index));
    last = TAG_RE.lastIndex;

    if (m[0].startsWith('<!')) continue;

    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].node && stack[i].node.tagName === m[1].toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }

    const el = new Element(m[2]);
    for (const a of (m[3] || '').matchAll(/([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '');
    }
    const frame = stack[stack.length - 1];
    frame.list.push(el);
    el.parent = frame.node;

    if (!VOID_TAGS.has(m[2].toLowerCase()) && !m[4]) {
      stack.push({ node: el, list: el.children });
    }
  }
  pushText(stack[stack.length - 1], html.slice(last));
  return root;
}

/**
 * 把垫片装到全局，返回可用的 document / window / localStorage。
 * @param {string} html index.html 的内容
 * @param {{ store?: Map<string,string> }} [opts]
 *        store：复用一份已有的 localStorage。想测「刷新页面」时必须传，
 *        否则每次 installDOM 都会拿到一个空的 localStorage，读不到存档。
 */
export function installDOM(html, opts = {}) {
  const domRoot = new Element('html');
  domRoot.innerHTML = html;

  const byId = new Map();
  walk(domRoot, (n) => { if (n.attrs.id) byId.set(n.attrs.id, n); });

  const docListeners = {};
  // 真浏览器一定有 documentElement / body（主题切换会往它们身上写 data-theme）
  const htmlEl = new Element('html');
  const bodyEl = new Element('body');
  walk(domRoot, (n) => {
    if (n.tagName === 'BODY' && !bodyEl.attrs.id) bodyEl.attrs = { ...n.attrs };
  });

  const document = {
    createElement: (tag) => new Element(tag),
    getElementById: (id) => byId.get(id) || null,
    addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
    querySelectorAll: (sel) => {
      const out = [];
      walk(domRoot, (n) => { if (n.matches(sel)) out.push(n); });
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    documentElement: htmlEl,
    body: bodyEl,
    hidden: false,
  };

  const store = opts.store || new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const winListeners = {};
  const scrolls = [];
  const window = {
    confirm: () => true,
    addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
    /** 切页时会滚回顶部；垫片里记下来，顺便能断言。 */
    scrollTo: (...args) => { scrolls.push(args); },
    scrollY: 0,
  };

  globalThis.document = document;
  globalThis.window = window;
  globalThis.localStorage = localStorage;
  // 【修复 t4 缺陷⑦ 的前提】浏览器里 `confirm()` 是**全局**函数，
  //   而垫片原来只把它挂在 `window` 上 ⇒ `src/main.js` 里 12 处裸 `confirm(`
  //   在 Node 下抛 ReferenceError，被 `dom.click()` 的循环安静吞掉，
  //   于是**一次都没有点击测试真的跑过**（这正是「项目里一条点击测试都没有」的原因）。
  //   挂到 globalThis 上，与真浏览器语义一致；返回值仍由 opts.confirm 控制，
  //   默认 true（放行），需要拒绝的用例可以自己覆盖 `window.confirm`。
  if (!('confirm' in globalThis)) {
    globalThis.confirm = (...args) => window.confirm(...args);
  }

  /** 模拟用户点击（走真实的事件委托链）。 */
  const click = (el) => { for (const fn of docListeners.click || []) fn({ target: el }); };

  return { document, window, localStorage, store, docListeners, winListeners, byId, click, scrolls };
}

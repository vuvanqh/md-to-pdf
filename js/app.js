(() => {
  'use strict';

  const CDN = {
    paged: 'https://cdn.jsdelivr.net/npm/pagedjs@0.4.3/dist/paged.js',
    mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js',
    katex: 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js',
    katexAuto: 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js',
    katexCss: 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css',
  };

  // Page sizes in CSS px (96 dpi), used for "fit to width".
  const PAPER = { A4: [794, 1123], Letter: [816, 1056], A5: [559, 794], Legal: [816, 1344] };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const loaded = {};
  function loadScript(src) {
    return loaded[src] || (loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    }));
  }

  // ---------------------------------------------------------------------------
  // Settings — kept in memory only, nothing is persisted.
  // ---------------------------------------------------------------------------
  const SLOT_OPTIONS = [
    ['none', 'Nothing'],
    ['filename', 'File name'],
    ['title', 'First heading'],
    ['date', 'Date'],
    ['pageTotal', '1 / 5'],
    ['pageOf', 'Page 1 of 5'],
    ['page', 'Page number'],
    ['custom', 'Custom text…'],
  ];

  // Mirrors yzane's defaults: header = title (file name) left + ISO date right, footer = "page / total" centred.
  const defaults = () => ({
    header: { on: true, slots: { left: 'filename', center: 'none', right: 'date' }, custom: { left: '', center: '', right: '' } },
    footer: { on: true, slots: { left: 'none', center: 'pageTotal', right: 'none' }, custom: { left: '', center: '', right: '' } },
    skipFirst: false,
    dateFormat: 'iso',
    size: 'A4',
    orientation: 'portrait',
    margin: { top: '1.5cm', right: '1cm', bottom: '1cm', left: '1cm' },
  });
  let settings = defaults();

  function formatDate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    switch (settings.dateFormat) {
      case 'long': return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      case 'dmy': return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
      case 'mdy': return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
      default: return d.toISOString().substr(0, 10); // same as yzane's %%ISO-DATE%%
    }
  }

  // ---------------------------------------------------------------------------
  // Markdown → HTML, configured like yzane (html on, breaks off, hljs, mermaid fences, GitHub slugs).
  // ---------------------------------------------------------------------------
  let mermaidSources = [];

  const md = window.markdownit({
    html: true,
    breaks: false,
    highlight(str, lang) {
      if (lang && lang.match(/\bmermaid\b/i)) {
        mermaidSources.push(str);
        return `<div class="mermaid" data-mermaid="${mermaidSources.length - 1}"></div>`;
      }
      if (lang && hljs.getLanguage(lang)) {
        try {
          str = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        } catch (e) {
          str = md.utils.escapeHtml(str);
        }
      } else {
        str = md.utils.escapeHtml(str);
      }
      return '<pre class="hljs"><code><div>' + str + '</div></code></pre>';
    },
  });

  function tokenToPlainText(token) {
    if (token.children) return token.children.map(tokenToPlainText).join('');
    return ['text', 'emoji', 'code_inline'].includes(token.type) ? token.content : '';
  }

  // Heading ids (deduplicated like yzane), source-line markers for click-to-jump, and the outline.
  md.core.ruler.push('md_to_pdf_meta', (state) => {
    const counts = new Map();
    const outline = [];
    state.tokens.forEach((t, i) => {
      if (t.map && t.nesting === 1) t.attrSet('data-line', String(t.map[0]));
      if (t.type !== 'heading_open') return;
      const text = tokenToPlainText(state.tokens[i + 1]);
      const base = githubSlugify(text);
      let slug = base;
      if (counts.has(base)) {
        const n = counts.get(base) + 1;
        counts.set(base, n);
        slug = `${base}-${n}`;
      } else {
        counts.set(base, 0);
      }
      t.attrSet('id', slug);
      outline.push({ level: Number(t.tag.slice(1)), text, id: slug, line: t.map ? t.map[0] : 0 });
    });
    state.env.outline = outline;
  });

  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const out = defaultFence(tokens, idx, options, env, self);
    return tokens[idx].map ? out.replace(/^<pre/, `<pre data-line="${tokens[idx].map[0]}"`) : out;
  };

  // ---------------------------------------------------------------------------
  // Images: relative paths can't be fetched from a pasted document, so the user hands us the files.
  // ---------------------------------------------------------------------------
  const images = new Map(); // lower-cased basename -> object URL
  let missingImages = [];

  const baseName = (src) => {
    const clean = src.split(/[?#]/)[0];
    try { return decodeURIComponent(clean.split(/[\\/]/).pop()).toLowerCase(); } catch (e) { return clean.split(/[\\/]/).pop().toLowerCase(); }
  };

  function addImages(files) {
    let n = 0;
    for (const f of files) {
      if (!f.type.startsWith('image/') && !/\.(svg|png|jpe?g|gif|webp|bmp)$/i.test(f.name)) continue;
      const key = f.name.toLowerCase();
      if (images.has(key)) URL.revokeObjectURL(images.get(key));
      images.set(key, URL.createObjectURL(f));
      n++;
    }
    if (n) {
      toast(`Added ${n} image${n === 1 ? '' : 's'}.`);
      schedule(0);
    }
  }

  // ---------------------------------------------------------------------------
  // Build the final HTML that goes into the paged preview.
  // ---------------------------------------------------------------------------
  const mermaidCache = new Map();
  let mermaidSeq = 0;

  async function renderMermaid(code) {
    if (mermaidCache.has(code)) return mermaidCache.get(code);
    await loadScript(CDN.mermaid);
    if (!renderMermaid.ready) {
      window.mermaid.initialize({ startOnLoad: false, theme: 'default' });
      renderMermaid.ready = true;
    }
    const id = 'mmd' + (++mermaidSeq);
    let out;
    try {
      out = (await window.mermaid.render(id, code)).svg;
    } catch (e) {
      out = `<span class="mermaid-error">Mermaid error: ${esc(e.message || e)}</span>`;
      document.getElementById('d' + id)?.remove();
    }
    mermaidCache.set(code, out);
    return out;
  }

  async function buildHtml(src) {
    mermaidSources = [];
    const env = {};
    const raw = md.render(src, env);
    // yzane's default "gfm" sanitising drops <style>, <script>, <iframe> & co.
    const clean = DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'], ADD_ATTR: ['target'] });

    const tpl = document.createElement('template'); // inert: images don't load while we work on it
    tpl.innerHTML = `<div class="markdown-body">${clean}</div>`;
    const root = tpl.content.firstElementChild;

    // Page breaks written as inline styles (<div style="page-break-after: always;">) become classes,
    // because Paged.js only reads breaks from stylesheets.
    root.querySelectorAll('[style]').forEach((el) => {
      const st = el.style;
      if (st.pageBreakAfter === 'always' || st.breakAfter === 'page') {
        el.classList.add('pb-after');
        st.removeProperty('page-break-after');
        st.removeProperty('break-after');
      }
      if (st.pageBreakBefore === 'always' || st.breakBefore === 'page') {
        el.classList.add('pb-before');
        st.removeProperty('page-break-before');
        st.removeProperty('break-before');
      }
      if (!el.getAttribute('style').trim()) el.removeAttribute('style');
    });

    missingImages = [];
    root.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      const name = baseName(src);
      if (images.has(name)) {
        img.setAttribute('src', images.get(name));
      } else {
        missingImages.push(name);
        const ph = document.createElement('span');
        ph.className = 'img-missing';
        ph.textContent = `Image not loaded: ${name}`;
        img.replaceWith(ph);
      }
    });
    updateImageBadge();

    for (const el of root.querySelectorAll('[data-mermaid]')) {
      el.innerHTML = await renderMermaid(mermaidSources[Number(el.dataset.mermaid)]);
      el.removeAttribute('data-mermaid');
    }

    if (/\$|\\\(|\\\[/.test(src)) {
      try {
        await loadScript(CDN.katex);
        await loadScript(CDN.katexAuto);
        window.renderMathInElement(root, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
          ],
          throwOnError: false,
        });
      } catch (e) { /* math is optional */ }
    }

    return { html: root.outerHTML, outline: env.outline || [] };
  }

  const UNIT_PX = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72 };
  const toPx = (v) => {
    const m = /^([\d.]+)(px|in|cm|mm|pt)$/.exec(v);
    return m ? parseFloat(m[1]) * UNIT_PX[m[2]] : 0;
  };

  const cssString = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';

  function slotContent(band, side, ctx) {
    const counters = {
      page: 'counter(page)',
      pages: 'counter(pages)',
      date: cssString(formatDate()),
      file: cssString(ctx.filename),
      title: cssString(ctx.title),
    };
    switch (band.slots[side]) {
      case 'filename': return counters.file;
      case 'title': return counters.title;
      case 'date': return counters.date;
      case 'pageTotal': return 'counter(page) " / " counter(pages)';
      case 'pageOf': return '"Page " counter(page) " of " counter(pages)';
      case 'page': return counters.page;
      case 'custom': {
        const text = band.custom[side];
        if (!text) return '';
        // {page} {pages} {date} {file} {title} placeholders
        return text.split(/(\{(?:page|pages|date|file|title)\})/)
          .filter(Boolean)
          .map((part) => counters[part.slice(1, -1)] && /^\{\w+\}$/.test(part) ? counters[part.slice(1, -1)] : cssString(part))
          .join(' ');
      }
      default: return '';
    }
  }

  function docCss(outline) {
    const s = settings;
    const m = s.margin;
    const ctx = { filename: filenameEl.value || 'document.md', title: outline[0]?.text || filenameEl.value };
    let boxes = '';
    const firstOff = [];
    for (const [pos, band] of [['top', s.header], ['bottom', s.footer]]) {
      if (!band.on) continue;
      // Chromium draws yzane's header/footer templates in Arial, ~20px from the paper edge.
      const room = toPx(pos === 'top' ? m.top : m.bottom);
      const place = room >= 34
        ? `vertical-align: ${pos === 'top' ? 'top; padding-top' : 'bottom; padding-bottom'}: 19px;`
        : 'vertical-align: middle;';
      for (const side of ['left', 'center', 'right']) {
        const content = slotContent(band, side, ctx);
        if (!content) continue;
        boxes += `@${pos}-${side} { content: ${content}; font-family: Arial, Helvetica, sans-serif; font-size: 9px; line-height: 1.15; color: #000; text-align: ${side}; ${place} }\n`;
        firstOff.push(`@${pos}-${side} { content: none; }`);
      }
    }
    return [
      window.YZANE_CSS,
      // Chromium's default 8px body margin, which yzane's printed HTML keeps.
      '.markdown-body { margin: 0 8px; }',
      '.pb-after { break-after: page; } .pb-before { break-before: page; }',
      '.img-missing { display: inline-block; padding: 10px 14px; border: 1px dashed #d14343; border-radius: 4px; color: #d14343; font-size: 12px; }',
      '.mermaid-error { color: #d14343; font-size: 12px; white-space: pre-wrap; }',
      `@page { size: ${s.size} ${s.orientation}; margin: ${m.top} ${m.right} ${m.bottom} ${m.left};\n${boxes}}`,
      s.skipFirst && firstOff.length ? `@page :first { ${firstOff.join(' ')} }` : '',
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Preview: two iframes, rendered alternately so the visible one never flickers.
  // ---------------------------------------------------------------------------
  function frameMain() {
    window.renderDoc = async (html, css) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      // Give every image its intrinsic size up front: Paged.js measures pages before images finish
      // loading, and a 0px-tall image makes it overfill (and clip) the page.
      await Promise.all([...tpl.content.querySelectorAll('img')].map((img) => new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => {
          if (!img.hasAttribute('width') && !img.hasAttribute('height')) {
            img.setAttribute('width', probe.naturalWidth);
            img.setAttribute('height', probe.naturalHeight);
            img.style.height = 'auto';
          }
          resolve();
        };
        probe.onerror = resolve;
        probe.src = img.getAttribute('src');
      })));
      const flow = await new Paged.Previewer().preview(tpl.content, [{ 'https://md-to-pdf.local/document.css': css }], document.getElementById('out'));
      const pages = {};
      document.querySelectorAll('#out :is(h1,h2,h3,h4,h5,h6)[id]').forEach((h) => {
        const page = h.closest('.pagedjs_page');
        if (page && !(h.id in pages)) pages[h.id] = Number(page.dataset.pageNumber);
      });
      return { total: flow.total, pages };
    };

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a) {
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href.startsWith('#')) {
          const target = document.getElementById(decodeURIComponent(href.slice(1)));
          if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else if (/^https?:/i.test(a.href)) {
          window.open(a.href, '_blank', 'noopener');
        }
        return;
      }
      const el = e.target.closest('[data-line]');
      if (el && parent.mdToPdfJump) parent.mdToPdfJump(Number(el.dataset.line));
    });
  }

  const FRAME_DOC = `<!doctype html><html><head><meta charset="utf-8"><title>document</title>
<link rel="stylesheet" href="${CDN.katexCss}">
<style media="screen">
  html { background: var(--canvas, #e7e7ec); }
  body { margin: 0; }
  .pagedjs_pages { zoom: var(--zoom, 1); padding: 24px 0; width: max-content; margin: 0 auto; }
  .pagedjs_page { background: #fff; margin: 0 auto 24px; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 10px 30px rgba(0,0,0,.10); }
  [data-line] { cursor: pointer; }
  .md-flash { animation: md-flash 1.4s ease-out; }
  @keyframes md-flash { from { background: rgba(91,91,214,.22); } to { background: transparent; } }
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-thumb { background: rgba(127,127,140,.35); border-radius: 6px; border: 3px solid transparent; background-clip: padding-box; }
</style>
<script src="${CDN.paged}"><\/script>
</head><body><div id="out"></div><script>(${frameMain.toString()})();<\/script></body></html>`;

  const host = $('#preview-host');
  const frames = [document.createElement('iframe'), document.createElement('iframe')];
  frames.forEach((f, i) => {
    f.title = 'PDF preview';
    if (i) f.className = 'back';
    host.appendChild(f);
  });
  let front = 0;
  let zoom = 'fit';

  function loadFrame(f) {
    return new Promise((resolve) => {
      f.onload = () => resolve();
      f.srcdoc = FRAME_DOC;
    });
  }

  function currentZoom() {
    if (zoom !== 'fit') return zoom;
    const [w, h] = PAPER[settings.size] || PAPER.A4;
    const pageW = settings.orientation === 'landscape' ? h : w;
    return Math.max(0.25, Math.min(2, (host.clientWidth - 48) / pageW));
  }

  function applyZoom(f) {
    const doc = f.contentDocument;
    if (!doc) return;
    const z = currentZoom();
    doc.documentElement.style.setProperty('--zoom', z);
    doc.documentElement.style.setProperty('--canvas', getComputedStyle(document.documentElement).getPropertyValue('--canvas'));
    $('#zoom-label').textContent = (zoom === 'fit' ? 'Fit · ' : '') + Math.round(z * 100) + '%';
  }

  function pagesOf(f) {
    return f.contentDocument ? [...f.contentDocument.querySelectorAll('.pagedjs_page')] : [];
  }

  function getAnchor(f) {
    const win = f.contentWindow;
    const pages = pagesOf(f);
    if (!pages.length) return null;
    let index = 0;
    pages.forEach((p, i) => { if (p.getBoundingClientRect().top <= 1) index = i; });
    const r = pages[index].getBoundingClientRect();
    return { index, ratio: r.height ? -r.top / r.height : 0, atTop: win.scrollY === 0 };
  }

  function restoreAnchor(f, a) {
    if (!a || a.atTop) return;
    const pages = pagesOf(f);
    const p = pages[Math.min(a.index, pages.length - 1)];
    if (!p) return;
    const r = p.getBoundingClientRect();
    f.contentWindow.scrollTo(0, f.contentWindow.scrollY + r.top + a.ratio * r.height);
  }

  function setZoom(z) {
    const f = frames[front];
    const a = getAnchor(f);
    zoom = z;
    applyZoom(f);
    restoreAnchor(f, a);
  }

  let busy = false;
  let queued = false;
  let timer = null;
  let outline = [];

  function schedule(delay = 350) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; render(); }, delay);
  }

  async function render() {
    if (busy) { queued = true; return; }
    busy = true;
    setStatus('Rendering', true);
    try {
      const { html, outline: items } = await buildHtml(cm.getValue());
      const css = docCss(items);
      const back = frames[1 - front];
      await loadFrame(back);
      // Lay out at 100%: CSS zoom during layout skews Paged.js's overflow measurements.
      const result = await back.contentWindow.renderDoc(html, css);
      applyZoom(back);
      restoreAnchor(back, getAnchor(frames[front]));
      back.classList.remove('back');
      frames[front].classList.add('back');
      front = 1 - front;
      outline = items.map((h) => ({ ...h, page: result.pages[h.id] }));
      renderOutline();
      $('#page-count').textContent = `· ${result.total} page${result.total === 1 ? '' : 's'}`;
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus('Render failed');
      toast('Preview failed: ' + (e.message || e));
    }
    busy = false;
    if (queued) { queued = false; render(); }
  }

  function whenIdle() {
    if (timer) { clearTimeout(timer); timer = null; render(); }
    return new Promise((resolve) => {
      const check = () => (!busy && !timer && !queued ? resolve() : setTimeout(check, 60));
      check();
    });
  }

  function flash(el) {
    el.classList.remove('md-flash');
    void el.offsetWidth;
    el.classList.add('md-flash');
  }

  function scrollPreviewTo(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    flash(el);
  }

  function previewElementForLine(line) {
    const doc = frames[front].contentDocument;
    if (!doc) return null;
    let best = null;
    let bestLine = -1;
    doc.querySelectorAll('#out [data-line]').forEach((el) => {
      const l = Number(el.dataset.line);
      if (l <= line && l > bestLine) { best = el; bestLine = l; }
    });
    return best;
  }

  // ---------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------
  const SAMPLE = `# My Document

Paste or open your Markdown on the left. The preview on the right is paginated exactly like
**yzane Markdown PDF** prints it — A4, same fonts, same CSS, same page breaks.

- Click a heading in the **Outline** to jump to it
- Click anything in the preview to jump to its source line
- Open **Page setup** to choose what goes in the header and footer

<div style="page-break-after: always;"></div>

## A second page

The \`<div style="page-break-after: always;"></div>\` above starts a new page, just like in the real PDF.

\`\`\`python
def hello():
    print("syntax highlighting uses the Tomorrow theme")
\`\`\`

| Column | Value |
| ------ | ----- |
| A      | 1     |
| B      | 2     |

> When it looks right, press **Download PDF** and pick "Save as PDF".
`;

  const filenameEl = $('#filename');
  const cm = CodeMirror.fromTextArea($('#editor'), {
    mode: { name: 'markdown', highlightFormatting: true },
    lineNumbers: true,
    lineWrapping: true,
    indentUnit: 2,
    tabSize: 4,
    extraKeys: {
      Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('  ')),
      'Ctrl-J': () => syncToPreview(),
      'Cmd-J': () => syncToPreview(),
    },
  });
  cm.setValue(SAMPLE);
  cm.on('change', () => schedule());
  cm.on('cursorActivity', () => highlightOutline());

  function jumpEditor(line) {
    cm.focus();
    cm.setCursor({ line, ch: 0 });
    const top = cm.charCoords({ line, ch: 0 }, 'local').top;
    cm.scrollTo(null, top - cm.getScrollInfo().clientHeight / 3);
    cm.addLineClass(line, 'background', 'cm-flash');
    setTimeout(() => cm.removeLineClass(line, 'background', 'cm-flash'), 1200);
  }
  window.mdToPdfJump = jumpEditor;

  function syncToPreview() {
    const el = previewElementForLine(cm.getCursor().line);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      flash(el);
    }
  }

  // ---------------------------------------------------------------------------
  // Outline
  // ---------------------------------------------------------------------------
  const outlineEl = $('#outline');

  function renderOutline() {
    if (!outline.length) {
      outlineEl.innerHTML = '<p class="muted">Headings appear here.</p>';
      return;
    }
    outlineEl.innerHTML = outline.map((h, i) =>
      `<button class="outline-item l${h.level}" data-i="${i}" title="${esc(h.text)}"><span class="t">${esc(h.text || '(untitled)')}</span>${h.page ? `<span class="p">${h.page}</span>` : ''}</button>`
    ).join('');
    highlightOutline();
  }

  function highlightOutline() {
    const line = cm.getCursor().line;
    let cur = -1;
    outline.forEach((h, i) => { if (h.line <= line) cur = i; });
    outlineEl.querySelectorAll('.outline-item').forEach((b) => b.classList.toggle('current', Number(b.dataset.i) === cur));
  }

  outlineEl.addEventListener('click', (e) => {
    const b = e.target.closest('.outline-item');
    if (!b) return;
    const h = outline[Number(b.dataset.i)];
    jumpEditor(h.line);
    scrollPreviewTo(frames[front].contentDocument?.getElementById(h.id));
  });

  // ---------------------------------------------------------------------------
  // Settings drawer
  // ---------------------------------------------------------------------------
  const drawer = $('#drawer');
  const settingsEl = $('#settings');

  const options = (list, value) => list.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('');

  function bandHtml(key, label) {
    const band = settings[key];
    const slots = ['left', 'center', 'right'].map((side) => `
      <label class="field">
        <span>${side[0].toUpperCase() + side.slice(1)}</span>
        <select data-k="${key}.slots.${side}">${options(SLOT_OPTIONS, band.slots[side])}</select>
        ${band.slots[side] === 'custom' ? `<input class="input custom" data-k="${key}.custom.${side}" value="${esc(band.custom[side])}" placeholder="Text">` : ''}
      </label>`).join('');
    return `
      <div class="group${band.on ? '' : ' off'}">
        <div class="group-head">
          <h3>${label}</h3>
          <label class="switch" title="Show ${label.toLowerCase()}"><input type="checkbox" data-k="${key}.on"${band.on ? ' checked' : ''}><span></span></label>
        </div>
        <div class="slots">${slots}</div>
      </div>`;
  }

  function renderSettings() {
    const s = settings;
    settingsEl.innerHTML = `
      ${bandHtml('header', 'Header')}
      ${bandHtml('footer', 'Footer')}
      <div class="group">
        <div class="group-head"><h3>Options</h3></div>
        <label class="field">
          <span>Date format</span>
          <select data-k="dateFormat">${options([['iso', formatIso() + ' (yzane)'], ['long', 'Long — 27 October 2026'], ['dmy', 'DD.MM.YYYY'], ['mdy', 'MM/DD/YYYY']], s.dateFormat)}</select>
        </label>
        <label class="check" style="margin-top:12px"><input type="checkbox" data-k="skipFirst"${s.skipFirst ? ' checked' : ''}> Hide header &amp; footer on the first page</label>
        <p class="hint">Custom text can include {page}, {pages}, {date}, {file} and {title}.</p>
      </div>
      <div class="group">
        <div class="group-head"><h3>Paper</h3></div>
        <div class="row">
          <label class="field"><span>Size</span><select data-k="size">${options(Object.keys(PAPER).map((k) => [k, k]), s.size)}</select></label>
          <label class="field"><span>Orientation</span><select data-k="orientation">${options([['portrait', 'Portrait'], ['landscape', 'Landscape']], s.orientation)}</select></label>
        </div>
        <div class="row four">
          ${['top', 'right', 'bottom', 'left'].map((k) => `<label class="field"><span>${k[0].toUpperCase() + k.slice(1)}</span><input class="input" data-k="margin.${k}" value="${esc(s.margin[k])}" spellcheck="false"></label>`).join('')}
        </div>
        <p class="hint">Margins accept mm, cm, in, pt or px. Defaults match yzane Markdown PDF.</p>
      </div>
      <div class="group"><button class="link-btn" id="reset-settings">Reset to yzane defaults</button></div>`;
  }

  function formatIso() { return new Date().toISOString().substr(0, 10); }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  }

  settingsEl.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    if (k.startsWith('margin.')) return; // handled on input
    setPath(settings, k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') renderSettings();
    schedule(100);
  });

  settingsEl.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || e.target.tagName === 'SELECT' || e.target.type === 'checkbox') return;
    if (k.startsWith('margin.')) {
      const ok = /^\s*\d+(\.\d+)?\s*(mm|cm|in|pt|px)\s*$/.test(e.target.value);
      e.target.style.borderColor = ok ? '' : '#e5484d';
      if (!ok) return;
      setPath(settings, k, e.target.value.replace(/\s+/g, ''));
    } else {
      setPath(settings, k, e.target.value);
    }
    schedule(250);
  });

  settingsEl.addEventListener('click', (e) => {
    if (e.target.id !== 'reset-settings') return;
    settings = defaults();
    renderSettings();
    schedule(0);
  });

  function toggleDrawer(open = !drawer.classList.contains('open')) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    $('#btn-settings').classList.toggle('active', open);
  }
  $('#btn-settings').addEventListener('click', () => toggleDrawer());
  $('#drawer-close').addEventListener('click', () => toggleDrawer(false));

  // ---------------------------------------------------------------------------
  // Files: open .md, add images, drag & drop
  // ---------------------------------------------------------------------------
  function loadMarkdownFile(file) {
    file.text().then((text) => {
      cm.setValue(text);
      cm.clearHistory();
      filenameEl.value = file.name;
      frames.forEach((f) => f.contentWindow?.scrollTo(0, 0));
      schedule(0);
    });
  }

  $('#btn-open').addEventListener('click', () => $('#file-md').click());
  $('#file-md').addEventListener('change', (e) => {
    if (e.target.files[0]) loadMarkdownFile(e.target.files[0]);
    e.target.value = '';
  });

  // Images popover: choose a folder (most common: a diagrams/ folder) or individual files.
  const imgBtn = $('#btn-images');
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.hidden = true;
  document.body.appendChild(pop);

  function renderPopover() {
    const missing = [...new Set(missingImages)];
    pop.innerHTML = `
      <p class="pop-title">Images used by your document</p>
      <p class="hint" style="margin:0 0 10px">Pick the folder your images live in — they're matched by file name and never leave your browser.</p>
      <div class="pop-actions">
        <button class="btn primary" data-act="dir">Choose folder…</button>
        <button class="btn ghost" data-act="files">Choose files…</button>
      </div>
      <p class="hint">${images.size} loaded${missing.length ? ` · <b style="color:#e5484d">${missing.length} missing</b>` : ''}</p>
      ${missing.length ? `<ul class="missing">${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}`;
  }

  imgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!pop.hidden) { pop.hidden = true; return; }
    renderPopover();
    const r = imgBtn.getBoundingClientRect();
    pop.style.top = r.bottom + 8 + 'px';
    pop.style.left = Math.max(16, Math.min(r.left, window.innerWidth - 336)) + 'px';
    pop.hidden = false;
  });
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'dir') $('#file-img-dir').click();
    if (act === 'files') $('#file-img').click();
  });
  document.addEventListener('click', () => { pop.hidden = true; });

  for (const id of ['#file-img', '#file-img-dir']) {
    $(id).addEventListener('change', (e) => {
      addImages([...e.target.files]);
      e.target.value = '';
      pop.hidden = true;
    });
  }

  function updateImageBadge() {
    const n = new Set(missingImages).size;
    const badge = $('#img-badge');
    badge.hidden = !n;
    badge.textContent = n;
    imgBtn.title = n ? `${n} image${n === 1 ? '' : 's'} not loaded — click to add` : 'Add the images your Markdown references';
  }

  const dropzone = $('#dropzone');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    dragDepth++;
    dropzone.classList.add('show');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; dropzone.classList.remove('show'); }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('show');
    const files = [...e.dataTransfer.files];
    const mdFile = files.find((f) => /\.(md|markdown|txt)$/i.test(f.name));
    if (mdFile) loadMarkdownFile(mdFile);
    addImages(files.filter((f) => f !== mdFile));
  });

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------
  async function download() {
    setStatus('Preparing', true);
    await whenIdle();
    setStatus('');
    const f = frames[front];
    const name = (filenameEl.value || 'document').replace(/\.(md|markdown|txt)$/i, '') || 'document';
    const prevTitle = document.title;
    document.title = name;
    f.contentDocument.title = name;
    toast('In the print dialog choose “Save as PDF”. Keep margins on Default and “Headers and footers” unticked.', 6000);
    f.contentWindow.focus();
    f.contentWindow.print();
    document.title = prevTitle;
  }
  $('#btn-download').addEventListener('click', download);

  // ---------------------------------------------------------------------------
  // Chrome: zoom, splitter, shortcuts, toast, status
  // ---------------------------------------------------------------------------
  $('#zoom-in').addEventListener('click', () => setZoom(Math.min(2.5, Math.round((currentZoom() + 0.1) * 10) / 10)));
  $('#zoom-out').addEventListener('click', () => setZoom(Math.max(0.25, Math.round((currentZoom() - 0.1) * 10) / 10)));
  $('#zoom-label').addEventListener('click', () => setZoom('fit'));
  $('#btn-sync').addEventListener('click', syncToPreview);
  filenameEl.addEventListener('input', () => schedule(250));

  new ResizeObserver(() => { if (zoom === 'fit') setZoom('fit'); }).observe(host);

  const splitter = $('#splitter');
  const workspace = $('#workspace');
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    frames.forEach((f) => { f.style.pointerEvents = 'none'; });
    const left = $('#editor-pane').getBoundingClientRect().left;
    const move = (ev) => {
      const w = Math.max(260, Math.min(ev.clientX - left, workspace.clientWidth - 220 - 320));
      workspace.style.setProperty('--editor-w', w + 'px');
    };
    const up = () => {
      splitter.classList.remove('dragging');
      frames.forEach((f) => { f.style.pointerEvents = ''; });
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      cm.refresh();
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });

  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'p' || e.key === 's')) { e.preventDefault(); download(); }
    if (e.key === 'Escape') { toggleDrawer(false); pop.hidden = true; }
  });

  const statusEl = $('#status');
  function setStatus(text, spinning) {
    statusEl.textContent = text;
    statusEl.classList.toggle('busy', !!spinning);
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  renderSettings();
  render();
})();

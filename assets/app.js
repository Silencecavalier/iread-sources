/* iread 书源库 —— 前端逻辑（无依赖） */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    manifest: null,
    query: '',
    group: '',
    sort: 'default'
  };

  /* ------------------------------------------------------------ 主题 */

  var THEME_KEY = 'iread-sources-theme';

  function applyTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem(THEME_KEY, name); } catch (e) { }
  }

  function initTheme() {
    var forced = null;
    try { forced = new URL(location.href).searchParams.get('theme'); } catch (e) { }
    if (forced === 'light' || forced === 'dark') { applyTheme(forced); return; }
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { }
    if (saved === 'light' || saved === 'dark') { applyTheme(saved); return; }
    var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(light ? 'light' : 'dark');
  }

  $('themeBtn').addEventListener('click', function () {
    var now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(now);
  });

  /* ------------------------------------------------------------ 小工具 */

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.setAttribute('data-show', '1');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.removeAttribute('data-show'); }, 1800);
  }

  function copy(text, label) {
    var done = function () { toast(label || '已复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选中'); }
      document.body.removeChild(ta);
    }
  }

  function fmtSize(bytes) {
    if (!bytes) return '–';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function absUrl(rel) {
    try { return new URL(rel, location.href).href; } catch (e) { return rel; }
  }

  var baseUrl = (function () {
    var href = location.href.split('#')[0].split('?')[0];
    if (/\/[^/]*\.[a-z]+$/i.test(href)) return href.replace(/[^/]*$/, '');
    return href.replace(/\/?$/, '/');
  })();

  var feedUrl = baseUrl + 'manifest.json';

  var jsdelivrUrl = (function () {
    try {
      var u = new URL(baseUrl);
      if (!/(^|\.)github\.io$/i.test(u.hostname)) return '';
      var owner = u.hostname.split('.')[0];
      var seg = u.pathname.split('/').filter(Boolean);
      var repo = seg.length ? seg[0] : owner + '.github.io';
      return 'https://cdn.jsdelivr.net/gh/' + owner + '/' + repo + '@main/manifest.json';
    } catch (e) { return ''; }
  })();

  /* ------------------------------------------------------------ 渲染 */

  function groupList(m) {
    var out = [];
    (m.sources || []).forEach(function (s) {
      if (out.indexOf(s.group) < 0) out.push(s.group);
    });
    return out;
  }

  function renderChips() {
    var m = state.manifest;
    var box = $('chips');
    box.textContent = '';
    var list = ['', ].concat(groupList(m));
    list.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.group === g ? 'true' : 'false');
      var name = g === '' ? '全部' : g;
      var n = g === '' ? (m.sources || []).length : (m.sources || []).filter(function (s) { return s.group === g; }).length;
      b.textContent = name + ' ' + n;
      b.addEventListener('click', function () {
        state.group = g;
        renderChips();
        renderCards();
      });
      box.appendChild(b);
    });
  }

  function matches(s) {
    if (state.group && s.group !== state.group) return false;
    if (!state.query) return true;
    var q = state.query.toLowerCase();
    var hay = [s.name, s.title, s.desc, s.group, s.site, (s.tags || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function sortList(list) {
    var copyList = list.slice();
    if (state.sort === 'name') {
      copyList.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    } else if (state.sort === 'group') {
      copyList.sort(function (a, b) {
        return a.group.localeCompare(b.group, 'zh') || a.name.localeCompare(b.name, 'zh');
      });
    } else if (state.sort === 'size') {
      copyList.sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
    } else {
      copyList.sort(function (a, b) {
        if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
        return 0;
      });
    }
    return copyList;
  }

  function card(s) {
    var el = document.createElement('article');
    el.className = 'card';

    var head = document.createElement('div');
    head.className = 'card__head';
    var h = document.createElement('h2');
    h.className = 'card__name';
    h.textContent = s.title || s.name;
    head.appendChild(h);
    if (s.group) {
      var badge = document.createElement('span');
      badge.className = 'card__badge';
      badge.textContent = s.group;
      head.appendChild(badge);
    }
    el.appendChild(head);

    if (s.desc) {
      var p = document.createElement('p');
      p.className = 'card__desc';
      p.textContent = s.desc;
      el.appendChild(p);
    }

    if (s.tags && s.tags.length) {
      var tags = document.createElement('div');
      tags.className = 'card__tags';
      s.tags.forEach(function (t) {
        if (!t || t === s.group) return;
        var sp = document.createElement('span');
        sp.className = 'tag';
        sp.textContent = t;
        tags.appendChild(sp);
      });
      if (tags.children.length) el.appendChild(tags);
    }

    var meta = document.createElement('div');
    meta.className = 'card__meta';
    [s.site, 'v' + s.version, fmtSize(s.size), s.updatedAt ? fmtDate(s.updatedAt) : ''].forEach(function (v) {
      if (!v) return;
      var sp = document.createElement('span');
      sp.textContent = v;
      meta.appendChild(sp);
    });
    el.appendChild(meta);

    var foot = document.createElement('div');
    foot.className = 'card__foot';

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn--primary';
    copyBtn.textContent = '复制地址';
    copyBtn.addEventListener('click', function () {
      copy(absUrl(s.path), '已复制「' + (s.title || s.name) + '」的地址');
    });
    foot.appendChild(copyBtn);

    var dl = document.createElement('a');
    dl.className = 'btn';
    dl.href = absUrl(s.path);
    dl.setAttribute('download', '');
    dl.textContent = '下载';
    foot.appendChild(dl);

    var view = document.createElement('a');
    view.className = 'card__link';
    view.href = absUrl(s.path);
    view.target = '_blank';
    view.rel = 'noopener';
    view.textContent = '看 JSON';
    foot.appendChild(view);

    el.appendChild(foot);
    return el;
  }

  function renderCards() {
    var m = state.manifest;
    var grid = $('grid');
    grid.textContent = '';
    var list = sortList((m.sources || []).filter(matches));
    list.forEach(function (s) { grid.appendChild(card(s)); });
    $('empty').hidden = list.length > 0;
  }

  function renderAll(m) {
    $('statCount').textContent = m.count != null ? m.count : (m.sources || []).length;
    $('statSize').textContent = fmtSize(m.totalSize);
    $('statLib').textContent = m.libraryHash || '–';
    $('statTime').textContent = fmtDate(m.generatedAt);
    $('footLib').textContent = m.libraryHash || '–';
    $('feedUrl').value = feedUrl;

    $('feedMirror').hidden = !jsdelivrUrl;

    renderChips();
    renderCards();
  }

  /* ------------------------------------------------------------ 交互 */

  $('copyFeed').addEventListener('click', function () {
    copy(feedUrl, '订阅地址已复制');
  });

  $('copyPages').addEventListener('click', function () {
    copy(feedUrl, 'GitHub Pages 地址已复制');
  });

  $('copyJsdelivr').addEventListener('click', function () {
    copy(jsdelivrUrl, 'jsDelivr 镜像地址已复制');
  });

  $('q').addEventListener('input', function (e) {
    state.query = e.target.value.trim();
    renderCards();
  });

  $('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    renderCards();
  });

  $('resetFilter').addEventListener('click', function () {
    state.query = '';
    state.group = '';
    $('q').value = '';
    renderChips();
    renderCards();
  });

  /* ------------------------------------------------------------ 启动 */

  function fail(msg) {
    var box = $('error');
    box.hidden = false;
    box.textContent = msg;
    $('statCount').textContent = '0';
  }

  function boot() {
    initTheme();

    if (location.protocol === 'file:') {
      fail('这个页面需要用 http 打开（浏览器直接双击文件会拦掉读清单）。\n在仓库目录跑一句：npx serve . 或者 python -m http.server 8000，然后访问 http://localhost:8000/');
      return;
    }

    fetch('manifest.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (m) {
        state.manifest = m;
        if (!m || !Array.isArray(m.sources)) throw new Error('manifest.json 结构不对：没有 sources 数组');
        renderAll(m);
      })
      .catch(function (err) {
        fail('读不到 manifest.json（' + err.message + '）。\n如果你的 sources/ 已经改过，先跑一句：node scripts/build-manifest.js');
      });
  }

  boot();
})();

/* iread 书源库 · 本地管理后台
 * 零依赖 Node 服务，只监听 127.0.0.1，带一次性令牌。
 * 启动：node admin/server.js  （或双击「启动管理后台.cmd」）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ADMIN_DIR = __dirname;
const REPO = path.resolve(ADMIN_DIR, '..');
const SOURCES_DIR = path.join(REPO, 'sources');
const CATALOG = path.join(REPO, 'catalog.json');
const MANIFEST = path.join(REPO, 'manifest.json');
const PORT = Number(process.env.PORT || 8131);
const TOKEN = crypto.randomBytes(9).toString('hex');

/* ---------- 小工具 ---------- */
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8');
const exists = (p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } };
const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, Object.assign({ cwd: REPO, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, opts || {}), (err, stdout, stderr) => {
      resolve({ code: err ? (err.code == null ? 1 : err.code) : 0, out: String(stdout || ''), err: String(stderr || ''), msg: err ? String(err.message) : '' });
    });
  });
}
const git = (args) => run('git', args);
const node = (args) => run(process.execPath, args);

/* ---------- 书源读写 ---------- */
function listSourceFiles() {
  if (!exists(SOURCES_DIR)) return [];
  return fs.readdirSync(SOURCES_DIR).filter((f) => f.toLowerCase().endsWith('.json')).sort().map((f) => ({
    file: f, id: f.replace(/\.json$/i, ''), path: path.join(SOURCES_DIR, f)
  }));
}

function readSource(item) {
  const raw = fs.readFileSync(item.path, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { return { item, error: 'JSON 解析失败：' + e.message, raw }; }
  const arr = Array.isArray(data) ? data : [data];
  return { item, raw, data, list: arr, first: arr[0] || {} };
}

function sourceView(item, cat) {
  const r = readSource(item);
  const c = (cat && cat.sources && cat.sources[item.id]) || {};
  const s = r.first || {};
  const base = {
    id: item.id,
    file: item.file,
    name: s.bookSourceName || c.title || item.id,
    group: String(s.bookSourceGroup || '').split(',')[0] || c.group || '',
    groups: String(s.bookSourceGroup || '').split(',').map((x) => x.trim()).filter(Boolean),
    url: s.bookSourceUrl || '',
    version: c.version || s.bookSourceVersion || '',
    type: s.bookSourceType == null ? 0 : s.bookSourceType,
    hasSearch: !!(s.ruleSearch && (s.ruleSearch.bookList || s.ruleSearch.bookUrl)),
    hasExplore: !!s.ruleExplore,
    hash: sha16(canonical(r.data)),
    size: Buffer.byteLength(r.raw, 'utf8'),
    count: r.list.length,
    featured: !!c.featured,
    desc: c.desc || '',
    tags: c.tags || [],
    site: c.site || hostOf(s.bookSourceUrl || ''),
    updatedAt: c.updatedAt || '',
    error: r.error || ''
  };
  return base;
}

function allViews() {
  const cat = readJson(CATALOG, { sources: {} });
  return listSourceFiles().map((it) => sourceView(it, cat));
}

function updateCatalog(id, patch) {
  const cat = readJson(CATALOG, { name: 'iread 书源库', sources: {} });
  if (!cat.sources) cat.sources = {};
  const cur = cat.sources[id] || {};
  const next = Object.assign({}, cur);
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v === '' || v == null || (Array.isArray(v) && !v.length)) delete next[k];
    else next[k] = v;
  }
  cat.sources[id] = next;
  if (!Object.keys(next).length) delete cat.sources[id];
  writeJson(CATALOG, cat);
}

function slugify(name, url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
  const ascii = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let base = (host ? host.split('.')[0] : '') || ascii || 'source';
  base = base.replace(/[^a-z0-9-]/g, '');
  if (!base) base = 'source';
  const taken = new Set(listSourceFiles().map((x) => x.id));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 999; i++) if (!taken.has(base + '-' + i)) return base + '-' + i;
  return base + '-' + Date.now().toString(36);
}

function hostOf(u) {
  try { return new URL(String(u)).host.replace(/^www./, ''); } catch (e) { return ''; }
}

function pickString(obj, keys) {
  for (const k of keys) if (obj && typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  return '';
}

/* ---------- 校验：直接问 build-manifest.js，口径只有一份 ---------- */
async function checkManifest() {
  const r = await node([path.join(REPO, 'scripts', 'build-manifest.js'), '--check']);
  const log = (r.out + r.err).trim();
  const problems = [];
  if (r.code !== 0) {
    for (const line of log.split(/\r?\n/)) {
      const m = line.match(/^\s*✗\s*(.+)$/);
      if (m) problems.push({ text: m[1], level: 'error' });
    }
  }
  return { ok: r.code === 0, log, problems };
}

/* ---------- HTTP ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function text(res, code, s, type) {
  res.writeHead(code, { 'Content-Type': (type || 'text/plain') + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({ __bad: e.message }); } });
  });
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  /* 静态文件（管理界面本身） */
  if (req.method === 'GET' && !p.startsWith('/api/')) {
    const rel = p === '/' ? '/ui.html' : p;
    const f = path.join(ADMIN_DIR, rel.replace(/^\/+/, ''));
    if (!f.startsWith(ADMIN_DIR) || !exists(f)) return text(res, 404, 'not found');
    return text(res, 200, fs.readFileSync(f, 'utf8'), MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
  }

  /* 健康检查不需要令牌，方便界面判断"服务在不在" */
  if (p === '/api/health') return json(res, 200, { ok: true, repo: REPO, pageTokenHint: '见启动窗口里的地址' });

  if (u.searchParams.get('t') !== TOKEN && req.headers['x-admin-token'] !== TOKEN) {
    return json(res, 401, { ok: false, error: '令牌不对，请用启动窗口里打印的完整地址打开（带 ?t=…）' });
  }

  try {
    if (p === '/api/state') {
      const v = await checkManifest();
      const st = await git(['status', '--porcelain']);
      const last = await git(['log', '-1', '--pretty=%h %s (%cr)']);
      const remote = await git(['rev-list', '--count', 'origin/main..HEAD']);
      return json(res, 200, {
        ok: true,
        repo: REPO,
        sources: allViews(),
        validate: v,
        dirty: st.out.trim().split('\n').filter(Boolean),
        lastCommit: last.out.trim(),
        ahead: Number(remote.out.trim() || 0),
        manifest: readJson(MANIFEST, null)
      });
    }

    if (p === '/api/source') {
      const item = listSourceFiles().find((x) => x.id === u.searchParams.get('id'));
      if (!item) return json(res, 404, { ok: false, error: '没有这个书源' });
      return json(res, 200, { ok: true, id: item.id, raw: fs.readFileSync(item.path, 'utf8') });
    }

    if (p === '/api/update' && req.method === 'POST') {
      const body = await readBody(req);
      const item = listSourceFiles().find((x) => x.id === body.id);
      if (!item) return json(res, 404, { ok: false, error: '没有这个书源' });
      const f = body.fields || {};
      /* 名称/分组写进书源本体（插件按 bookSourceName 显示，改名也算一次内容更新） */
      if (f.name !== undefined || f.group !== undefined) {
        const r = readSource(item);
        if (r.error) return json(res, 400, { ok: false, error: r.error });
        const apply = (one) => {
          if (f.name !== undefined) one.bookSourceName = String(f.name).trim();
          if (f.group !== undefined) {
            const g = String(f.group).trim();
            if (g) one.bookSourceGroup = g; else delete one.bookSourceGroup;
          }
        };
        if (Array.isArray(r.data)) r.data.forEach(apply); else apply(r.data);
        writeJson(item.path, r.data);
      }
      const patch = {};
      for (const k of ['group', 'desc', 'site', 'version']) if (f[k] !== undefined) patch[k] = f[k];
      if (f.tags !== undefined) patch.tags = Array.isArray(f.tags) ? f.tags : String(f.tags).split(/[,\s]+/).filter(Boolean);
      if (f.featured !== undefined) patch.featured = !!f.featured;
      if (f.name !== undefined) patch.title = String(f.name).trim();
      patch.updatedAt = new Date().toISOString().slice(0, 10);
      updateCatalog(item.id, patch);
      return json(res, 200, { ok: true, id: item.id });
    }

    if (p === '/api/add' && req.method === 'POST') {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(String(body.text || '')); } catch (e) { return json(res, 400, { ok: false, error: 'JSON 解析失败：' + e.message }); }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const bad = list.filter((x) => !x || typeof x !== 'object' || !x.bookSourceUrl);
      if (bad.length) return json(res, 400, { ok: false, error: '有 ' + bad.length + ' 条缺 bookSourceUrl（书源必须有 bookSourceUrl 才能被识别）' });
      const made = [];
      for (const one of list) {
        const id = body.id && list.length === 1 ? String(body.id).replace(/[^a-z0-9-]/gi, '') : slugify(one.bookSourceName, one.bookSourceUrl);
        const file = path.join(SOURCES_DIR, id + '.json');
        if (exists(file)) return json(res, 409, { ok: false, error: 'sources/' + id + '.json 已经存在，换一个 id 或先删掉旧的' });
        writeJson(file, one);
        updateCatalog(id, {
          title: one.bookSourceName || id,
          group: String(one.bookSourceGroup || '').split(',')[0] || '',
          version: one.bookSourceVersion || '1.0.0',
          desc: '',
          updatedAt: new Date().toISOString().slice(0, 10)
        });
        made.push({ id, name: one.bookSourceName || id });
      }
      return json(res, 200, { ok: true, made });
    }

    if (p === '/api/delete' && req.method === 'POST') {
      const body = await readBody(req);
      const item = listSourceFiles().find((x) => x.id === body.id);
      if (!item) return json(res, 404, { ok: false, error: '没有这个书源' });
      fs.unlinkSync(item.path);
      const cat = readJson(CATALOG, { sources: {} });
      if (cat.sources && cat.sources[body.id]) { delete cat.sources[body.id]; writeJson(CATALOG, cat); }
      return json(res, 200, { ok: true, id: body.id });
    }

    if (p === '/api/build' && req.method === 'POST') {
      const r = await node([path.join(REPO, 'scripts', 'build-manifest.js')]);
      return json(res, 200, { ok: r.code === 0, code: r.code, log: (r.out + r.err).trim() });
    }

    if (p === '/api/publish' && req.method === 'POST') {
      const body = await readBody(req);
      const msg = String(body.message || '').trim() || 'chore: 更新书源库';
      const b = await node([path.join(REPO, 'scripts', 'build-manifest.js')]);
      if (b.code !== 0) return json(res, 200, { ok: false, step: 'build', log: (b.out + b.err).trim() });
      const add = await git(['add', '-A']);
      const st = await git(['status', '--porcelain']);
      if (!st.out.trim()) return json(res, 200, { ok: true, step: 'nochange', log: '没有改动需要提交' });
      const c = await git(['-c', 'user.name=Silencecavalier', '-c', 'user.email=Silencecavalier@users.noreply.github.com', 'commit', '-m', msg]);
      if (c.code !== 0) return json(res, 200, { ok: false, step: 'commit', log: (c.out + c.err + c.msg).trim() });
      const push = await git(['push', 'origin', 'main']);
      return json(res, 200, {
        ok: push.code === 0, step: push.code === 0 ? 'pushed' : 'push',
        log: [(add.out + add.err).trim(), (c.out + c.err).trim().slice(-800), (push.out + push.err).trim().slice(-800)].filter(Boolean).join('\n---\n')
      });
    }

    return json(res, 404, { ok: false, error: 'no route ' + p });
  } catch (e) {
    return json(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/?t=' + TOKEN;
  console.log('');
  console.log('  iread 书源库 · 管理后台已启动');
  console.log('  仓库：' + REPO);
  console.log('  地址：' + url);
  console.log('  （只监听本机 127.0.0.1；关掉这个窗口就停止）');
  console.log('');
  if (process.platform === 'win32' && !process.env.NO_OPEN) {
    run('cmd', ['/c', 'start', '', url]).catch(() => {});
  }
});

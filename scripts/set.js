#!/usr/bin/env node
/**
 * 改书源的名字 / 分组 / 描述 —— 书源库的「管理后台」命令行版
 *
 * 用法：
 *   node scripts/set.js --list
 *   node scripts/set.js uukan --name "UU看书（备用）"
 *   node scripts/set.js uukan --name "UU看书" --group "主力" --desc "一句话介绍" --tags 综合,搜索可用
 *   node scripts/set.js qbxs --version 1.0.2
 *   node scripts/set.js qbxs --name "全本小说网" --index 1     # 一个文件里有多条时改第几条（0 起始）
 *
 * 说明：
 *   --name   直接写进书源 JSON 的 bookSourceName，所以装进 iread 后显示的就是新名字。
 *            改名会让文件 hash 变化，客户端正好会提示「更新」，更新一次名字即生效。
 *   --group / --desc / --tags / --version / --site 写进 catalog.json（人工元数据）。
 *   改完自动重建 manifest.json（manifest 就是客户端读取的清单）。
 *   --no-build  只改文件，不重建清单。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'sources');
const CATALOG = path.join(ROOT, 'catalog.json');

/* ---------------------------------------------------------------- 参数 */
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') { out.flags.list = true; continue; }
    if (a === '--no-build') { out.flags['no-build'] = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        out.flags[key] = true;
      } else {
        out.flags[key] = val;
        i++;
      }
      continue;
    }
    out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/* ---------------------------------------------------------------- 工具 */
function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(path.relative(ROOT, file) + ' 不是合法 JSON：' + err.message);
  }
}

function readLoose(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function readSourcesFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const text = raw.trim();
  if (!text) return [];
  if (text[0] === '[') return JSON.parse(text);
  if (text[0] === '{') {
    try {
      const one = JSON.parse(text);
      if (one && Array.isArray(one.sources)) return one.sources;
      return [one];
    } catch (e) {
      /* JSONL */
    }
  }
  return text.split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); });
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function today() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ---------------------------------------------------------------- 列表 */
if (args.flags.list || args._.length === 0) {
  const files = fs.existsSync(SRC_DIR)
    ? fs.readdirSync(SRC_DIR).filter(function (f) { return f.endsWith('.json'); })
    : [];
  console.log('sources/ 下的书源：');
  files.forEach(function (f) {
    const id = f.replace(/\.json$/, '');
    let names = [];
    try {
      names = readSourcesFile(path.join(SRC_DIR, f)).map(function (r) { return r && r.bookSourceName; }).filter(Boolean);
    } catch (e) {
      names = ['（读取失败：' + e.message + '）'];
    }
    console.log('  · ' + id.padEnd(18) + names.join(' / '));
  });
  console.log('\n改名字：node scripts/set.js <id> --name "新名字"');
  console.log('改分组：node scripts/set.js <id> --group "分组名"');
  console.log('改描述：node scripts/set.js <id> --desc "一句话介绍"');
  process.exit(0);
}

/* ---------------------------------------------------------------- 定位文件 */
const id = String(args._[0]).replace(/\.json$/i, '');
const file = path.join(SRC_DIR, id + '.json');
if (!fs.existsSync(file)) {
  console.error('找不到 sources/' + id + '.json');
  const files = fs.existsSync(SRC_DIR) ? fs.readdirSync(SRC_DIR).filter(function (f) { return f.endsWith('.json'); }) : [];
  console.error('现有 id：' + files.map(function (f) { return f.replace(/\.json$/, ''); }).join(', '));
  process.exit(1);
}

const index = args.flags.index === undefined ? 0 : Number(args.flags.index);
let list = readSourcesFile(file);
if (!Array.isArray(list) || !list.length) {
  console.error('sources/' + id + '.json 里没有书源对象');
  process.exit(1);
}
if (!(index >= 0 && index < list.length)) {
  console.error('--index 超出范围：文件里有 ' + list.length + ' 条');
  process.exit(1);
}

const target = list[index];
if (!target || typeof target !== 'object') {
  console.error('第 ' + index + ' 条不是对象');
  process.exit(1);
}

/* ---------------------------------------------------------------- 改书源 */
const changes = [];
const oldName = String(target.bookSourceName || target.name || '');
if (typeof args.flags.name === 'string') {
  target.bookSourceName = args.flags.name;
  changes.push('bookSourceName: ' + (oldName || '（空）') + ' → ' + target.bookSourceName);
}

/* 写回：单对象与数组保持原样形状 */
const outText = list.length === 1
  ? JSON.stringify(target, null, 2) + '\n'
  : JSON.stringify(list, null, 2) + '\n';
fs.writeFileSync(file, outText, 'utf8');

/* ---------------------------------------------------------------- 改元数据 */
let catalog = null;
if (fs.existsSync(CATALOG)) {
  try {
    catalog = readLoose(CATALOG);
  } catch (e) {
    console.error('catalog.json 读不出来，跳过元数据：' + e.message);
    catalog = null;
  }
}
if (catalog) {
  if (!catalog.sources || typeof catalog.sources !== 'object') catalog.sources = {};
  const meta = catalog.sources[id] || (catalog.sources[id] = {});
  if (typeof args.flags.name === 'string') meta.title = args.flags.name;
  if (typeof args.flags.group === 'string') meta.group = args.flags.group;
  if (typeof args.flags.desc === 'string') meta.desc = args.flags.desc;
  if (typeof args.flags.version === 'string') meta.version = args.flags.version;
  if (typeof args.flags.site === 'string') meta.site = args.flags.site;
  if (typeof args.flags.tags === 'string') {
    meta.tags = args.flags.tags.split(/[,，\s]+/).filter(Boolean);
  }
  if (changes.length || typeof args.flags.group === 'string' || typeof args.flags.desc === 'string' ||
      typeof args.flags.tags === 'string' || typeof args.flags.version === 'string') {
    meta.updatedAt = today();
  }
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

/* ---------------------------------------------------------------- 报告 */
console.log('已更新 sources/' + id + '.json' + (list.length > 1 ? '（第 ' + index + ' 条）' : ''));
if (typeof args.flags.name === 'string') console.log('  名称：' + (oldName || '（空）') + ' → ' + args.flags.name);
['group', 'desc', 'tags', 'version'].forEach(function (k) {
  if (typeof args.flags[k] === 'string') console.log('  ' + k + '：' + args.flags[k]);
});
if (!changes.length && !['group', 'desc', 'tags', 'version', 'site'].some(function (k) { return typeof args.flags[k] === 'string'; })) {
  console.log('  （没给任何 --name/--group/--desc/--tags，文件内容未变）');
}

/* ---------------------------------------------------------------- 重建清单 */
if (!args.flags['no-build']) {
  console.log('\n重建 manifest.json …');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build-manifest.js')], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('清单重建失败（退出码 ' + r.status + '）');
    process.exit(r.status || 1);
  }
} else {
  console.log('\n（--no-build：没有重建 manifest.json）');
}

#!/usr/bin/env node
/**
 * 生成 manifest.json —— 书源库清单
 *
 * 用法：
 *   node scripts/build-manifest.js          生成清单
 *   node scripts/build-manifest.js --check  只检查、不写文件（CI 里用来发现未提交的清单）
 *
 * 规则（尽量让你少手动维护）：
 *   1. sources/ 下的每个 .json 都是一个书源（可以是单个对象、数组、或 JSONL）；
 *   2. id 默认取文件名，条目名取 bookSourceName；
 *   3. hash 取书源内容的规范化 sha256（前 16 位）——你改一个字 hash 就变，
 *      客户端靠 hash 判断「有没有更新」；version 只在你想给个人类版本号时才填；
 *   4. catalog.json 可选：用来补标题、描述、分组、版本号、更新日期；
 *   5. 校验：没有 bookSourceUrl、或者既没有 ruleSearch 也没有 ruleExplore 的源会被拒绝，
 *      并且整个脚本以退出码 1 结束（CI 会红），避免把坏书源发出去。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'sources');
const MANIFEST = path.join(ROOT, 'manifest.json');
const CATALOG = path.join(ROOT, 'catalog.json');

const SCHEMA = 1;
const MIN_APP_VERSION = '1.0.0';
const SITE_NAME = 'iread 书源库';

const CHECK_ONLY = process.argv.includes('--check');

/* ---------------------------------------------------------------- 工具 */

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(path.relative(ROOT, file) + ' 不是合法 JSON：' + err.message);
  }
}

/** 键名排序后再序列化：同一个书源重排字段不会导致 hash 变化 */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonical(value[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'source';
}

function pickString() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function splitGroups(raw) {
  return String(raw || '')
    .split(/[,，&|、;；]+/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function hostOf(url) {
  try {
    return new URL(String(url)).host.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

/** 把一个文件拆成若干书源对象；支持单对象 / 数组 / JSONL */
function loadSourcesFromFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // JSONL：一行一个书源
    const lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    const out = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch (e2) {
        throw new Error(path.relative(ROOT, file) + ' 既不是 JSON，也不是合法的 JSONL（第一行：' + line.slice(0, 60) + '）');
      }
    }
    parsed = out;
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];
  throw new Error(path.relative(ROOT, file) + ' 里没有书源对象');
}

/* ---------------------------------------------------------------- 主流程 */

function main() {
  if (!fs.existsSync(SRC_DIR)) throw new Error('找不到 sources/ 目录');

  let catalog = {};
  if (fs.existsSync(CATALOG)) {
    const raw = readJson(CATALOG);
    // catalog.json 支持 {"sources": {...}} 或直接 {"id": {...}}
    catalog = raw && raw.sources ? raw.sources : (raw || {});
  }

  const files = fs.readdirSync(SRC_DIR)
    .filter(function (f) { return /\.json$/i.test(f); })
    .sort();

  if (!files.length) throw new Error('sources/ 里一个 .json 都没有');

  const entries = [];
  const problems = [];
  const seenHash = Object.create(null);

  for (const file of files) {
    const abs = path.join(SRC_DIR, file);
    const base = file.replace(/\.json$/i, '');
    let list;
    try {
      list = loadSourcesFromFile(abs);
    } catch (err) {
      problems.push(err.message);
      continue;
    }

    list.forEach(function (src, index) {
      const rel = 'sources/' + file;
      const label = base + (list.length > 1 ? '#' + (index + 1) : '');

      if (!src || typeof src !== 'object') {
        problems.push(rel + ' 第 ' + (index + 1) + ' 项不是对象');
        return;
      }
      const url = pickString(src.bookSourceUrl, src.sourceUrl, src.url);
      const name = pickString(src.bookSourceName, src.sourceName, src.name);
      if (!url) problems.push(label + '：缺 bookSourceUrl');
      if (!name) problems.push(label + '：缺 bookSourceName');
      if (!src.ruleSearch && !src.ruleExplore) problems.push(label + '：既没有 ruleSearch 也没有 ruleExplore，装了也搜不到书');

      const id = list.length > 1 ? base + '-' + (index + 1) : base;
      const meta = catalog[id] || catalog[base] || {};
      const text = canonical(src);
      const hash = sha256(text).slice(0, 16);
      const size = Buffer.byteLength(JSON.stringify(src, null, 2) + '\n', 'utf8');

      if (seenHash[hash]) problems.push(label + '：与 ' + seenHash[hash] + ' 内容完全相同（重复书源）');
      else seenHash[hash] = label;

      const groups = splitGroups(src.bookSourceGroup);
      if (meta.group) groups.unshift(meta.group);

      entries.push({
        id: id,
        name: name || base,
        title: pickString(meta.title, name),
        desc: pickString(meta.desc, src.bookSourceComment, src.bookSourceIntro),
        group: groups.length ? groups[0] : '未分组',
        tags: Array.from(new Set(groups.concat(meta.tags || []))).slice(0, 6),
        site: hostOf(url),
        url: url,
        path: rel,
        hash: hash,
        version: pickString(meta.version, src.bookSourceVersion) || hash.slice(0, 8),
        size: size,
        updatedAt: pickString(meta.updatedAt) || null,
        minAppVersion: pickString(meta.minAppVersion) || MIN_APP_VERSION,
        featured: meta.featured === true
      });
    });
  }

  entries.sort(function (a, b) {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.group.localeCompare(b.group, 'zh') || a.name.localeCompare(b.name, 'zh');
  });

  const groups = [];
  entries.forEach(function (e) {
    if (groups.indexOf(e.group) < 0) groups.push(e.group);
  });

  // 库版本：所有书源 hash 的汇总，客户端可以用它判断「整库有没有变」
  const libraryHash = sha256(entries.map(function (e) { return e.id + ':' + e.hash; }).join('|')).slice(0, 16);

  const manifest = {
    schema: SCHEMA,
    name: SITE_NAME,
    libraryHash: libraryHash,
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    count: entries.length,
    totalSize: entries.reduce(function (n, e) { return n + e.size; }, 0),
    groups: groups,
    sources: entries
  };

  if (problems.length) {
    console.error('\n发现 ' + problems.length + ' 个问题：');
    problems.forEach(function (p) { console.error('  ✗ ' + p); });
    console.error('\n没有生成 manifest.json（这些源装上也是坏的，先修好再发）。');
    process.exit(1);
  }

  const json = JSON.stringify(manifest, null, 2) + '\n';

  if (CHECK_ONLY) {
    // 只比内容，不比生成时间：generatedAt 每次都会变，拿它比永远不相等
    const stable = function (m) {
      const copyM = Object.assign({}, m);
      delete copyM.generatedAt;
      return canonical(copyM);
    };
    let current = null;
    try { current = readJson(MANIFEST); } catch (e) { current = null; }
    if (!current || stable(current) !== stable(manifest)) {
      console.error('manifest.json 与 sources/ 不一致，请重新跑 node scripts/build-manifest.js');
      process.exit(1);
    }
    console.log('OK 清单已是最新（' + entries.length + ' 个书源，库版本 ' + libraryHash + '）');
    return;
  }

  fs.writeFileSync(MANIFEST, json, 'utf8');

  console.log('清单已生成：' + entries.length + ' 个书源，库版本 ' + libraryHash);
  entries.forEach(function (e) {
    console.log('  · [' + e.group + '] ' + e.name + '  v' + e.version + '  ' + e.hash + '  ' + (e.size / 1024).toFixed(1) + 'KB  ' + e.site);
  });
}

try {
  main();
} catch (err) {
  console.error('失败：' + (err && err.message ? err.message : err));
  process.exit(1);
}

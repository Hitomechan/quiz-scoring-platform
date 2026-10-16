#!/usr/bin/env node
/**
 * 在线答题系统（多套试卷版）—— 零依赖后端
 * 运行: node server.js   (默认 http://127.0.0.1:3210)
 * 环境变量: PORT / HOST / ADMIN_PASSWORD
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3210);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 小时

/* ------------------------------------------------------------------ */
/* 密码 / 会话                                                         */
/* ------------------------------------------------------------------ */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: sha256(salt + ':' + pw) };
};
const verifyPassword = (pw, rec) => {
  if (!rec || !rec.salt || !rec.hash) return false;
  const a = Buffer.from(sha256(rec.salt + ':' + pw), 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/* 会话持久化在 db.json 里，重启服务不会把管理员踢下线 */
function newSession() {
  const token = crypto.randomBytes(24).toString('hex');
  DB.sessions[token] = Date.now() + SESSION_TTL;
  saveDB();
  return token;
}
function checkSession(token) {
  if (!token || !DB.sessions) return false;
  const exp = DB.sessions[token];
  if (!exp) return false;
  if (exp < Date.now()) { delete DB.sessions[token]; saveDB(); return false; }
  return true;
}
function dropSession(token) {
  if (token && DB.sessions && DB.sessions[token]) { delete DB.sessions[token]; saveDB(); }
}

/* ------------------------------------------------------------------ */
/* 数据库                                                              */
/* ------------------------------------------------------------------ */
const DEFAULT_SETTINGS = {
  title: '在线答题系统',
  subtitle: '',
  passPercent: 60,
  partialCredit: true
};

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let s = '';
    const buf = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    if (!DB || !DB.papers.some((p) => p.code === s)) return s;
  }
}
const uid = () => crypto.randomUUID();

function defaultDB() {
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  return {
    version: 2,
    settings: Object.assign({}, DEFAULT_SETTINGS, {
      admin: hashPassword(pw),
      usingDefaultPassword: !process.env.ADMIN_PASSWORD
    }),
    papers: [],
    submissions: [],
    sessions: {}
  };
}

let DB = null;

function loadDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      const bak = DB_FILE + '.broken-' + Date.now();
      fs.renameSync(DB_FILE, bak);
      console.error('[warn] db.json 解析失败，已备份到', bak);
      DB = defaultDB();
    }
  } else {
    DB = defaultDB();
  }
  migrate();
  saveDB();
}

function migrate() {
  DB.settings = Object.assign({}, DEFAULT_SETTINGS, DB.settings || {});
  if (!DB.settings.admin) DB.settings.admin = hashPassword('admin123');
  DB.submissions = Array.isArray(DB.submissions) ? DB.submissions : [];

  // 登录会话持久化 + 清理过期
  if (!DB.sessions || typeof DB.sessions !== 'object' || Array.isArray(DB.sessions)) DB.sessions = {};
  const now = Date.now();
  Object.keys(DB.sessions).forEach((t) => { if (!(DB.sessions[t] > now)) delete DB.sessions[t]; });

  // v1 -> v2：单一题库升级为“试卷”
  if (!Array.isArray(DB.papers)) {
    const legacyQuestions = Array.isArray(DB.questions) ? DB.questions : [];
    const paper = {
      id: uid(),
      code: null,
      title: DB.settings.title || '默认试卷',
      desc: DB.settings.subtitle || '',
      status: 'published',
      accessCode: '',
      passPercent: null,
      partialCredit: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      questions: legacyQuestions
    };
    DB.papers = legacyQuestions.length ? [paper] : [];
    if (paper.code === null) paper.code = newCode();
    DB.submissions.forEach((s) => {
      s.paperId = s.paperId || paper.id;
      s.paperCode = s.paperCode || paper.code;
      s.paperTitle = s.paperTitle || paper.title;
    });
    delete DB.questions;
    if (legacyQuestions.length) console.log('[migrate] 已把原题库迁移为试卷「' + paper.title + '」');
  }

  // v2 内部字段补全
  DB.papers.forEach((p) => {
    if (!p.id) p.id = uid();
    if (!p.code) p.code = newCode();
    if (!Array.isArray(p.questions)) p.questions = [];
    if (!p.status) p.status = 'draft';
    if (p.accessCode === undefined) p.accessCode = '';
    if (p.passPercent === undefined) p.passPercent = null;
    if (p.partialCredit === undefined) p.partialCredit = null;
    if (!p.createdAt) p.createdAt = new Date().toISOString();
  });
  DB.submissions.forEach((s) => {
    if (!s.paperId) {
      const p = DB.papers.find((x) => x.code === s.paperCode);
      if (p) { s.paperId = p.id; s.paperTitle = s.paperTitle || p.title; }
    }
  });
  DB.version = 2;
}

function saveDB() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

const findPaper = (id) => DB.papers.find((p) => p.id === id);
const findPaperByCode = (code) =>
  DB.papers.find((p) => p.code === String(code || '').toUpperCase());

/* ------------------------------------------------------------------ */
/* 判分                                                                */
/* ------------------------------------------------------------------ */
const stripKey = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();

function parseShortInput(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v == null ? '' : v)
    .split(/[、,，;；\n\r\t]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
function dedupe(arr) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = stripKey(x); if (!k || seen.has(k)) continue; seen.add(k); out.push(x); }
  return out;
}

function gradeOne(q, raw, partialCredit) {
  const full = Number(q.points) > 0 ? Number(q.points) : 1;

  if (q.type === 'single') {
    const chosen = raw === '' || raw == null ? null : Number(raw);
    const correct = chosen === Number(q.correctIndex);
    return {
      earned: correct ? full : 0,
      full,
      status: correct ? 'correct' : (chosen === null || Number.isNaN(chosen) ? 'blank' : 'wrong'),
      userDisplay: chosen == null || Number.isNaN(chosen) ? '' : String.fromCharCode(65 + chosen)
    };
  }

  const expected = dedupe((q.answers || []).map(String).filter((x) => x.trim()));
  const userArr = dedupe(parseShortInput(raw));
  if (!expected.length) return { earned: 0, full, status: 'blank', userDisplay: userArr.join('、') };

  const expKeys = new Set(expected.map(stripKey));
  const matched = userArr.filter((u) => expKeys.has(stripKey(u))).length;
  const denom = Math.max(expected.length, userArr.length);
  let earned = 0, status = 'wrong';
  if (userArr.length === 0) status = 'blank';
  else if (matched === expected.length && userArr.length === expected.length) { earned = full; status = 'correct'; }
  else if (matched > 0 && partialCredit) {
    earned = Math.round((full * matched / denom) * 100) / 100;
    status = 'partial';
  }
  return { earned, full, status, userDisplay: userArr.join('、'), matched, expectedCount: expected.length };
}

function effectiveSettings(paper) {
  return {
    passPercent: paper.passPercent === null || paper.passPercent === undefined
      ? Number(DB.settings.passPercent) : Number(paper.passPercent),
    partialCredit: paper.partialCredit === null || paper.partialCredit === undefined
      ? !!DB.settings.partialCredit : !!paper.partialCredit
  };
}

function buildDetails(paper, answers) {
  const answersMap = answers && typeof answers === 'object' ? answers : {};
  const eff = effectiveSettings(paper);
  const details = [];
  let earnedSum = 0, fullSum = 0;
  for (const q of paper.questions) {
    const g = gradeOne(q, answersMap[q.id], eff.partialCredit);
    earnedSum += g.earned; fullSum += g.full;
    details.push({
      qid: q.id,
      type: q.type,
      title: q.title,
      options: q.type === 'single' ? (q.options || []) : [],
      correctIndex: q.type === 'single' ? Number(q.correctIndex) : undefined,
      correctLetters: q.type === 'single' ? String.fromCharCode(65 + Number(q.correctIndex)) : undefined,
      correctAnswers: q.type === 'single' ? [] : (q.answers || []),
      userAnswer: answersMap[q.id] === undefined ? '' : answersMap[q.id],
      userDisplay: g.userDisplay,
      earned: g.earned,
      full: g.full,
      status: g.status,
      matched: g.matched,
      expectedCount: g.expectedCount
    });
  }
  const percent = fullSum > 0 ? Math.round((earnedSum / fullSum) * 10000) / 100 : 0;
  return { details, earnedSum, fullSum, percent, eff };
}

/* ------------------------------------------------------------------ */
/* 批量文本 -> 题库 解析器                                             */
/* ------------------------------------------------------------------ */
const TYPE_ALIAS = {
  '单选': 'single', '单选题': 'single', 'single': 'single', 'choice': 'single',
  '简答': 'short', '简答题': 'short', '填空': 'short', 'short': 'short'
};

function extractMeta(title) {
  let t = String(title).trim();
  let points = null;
  const m = t.match(/[（(\[【]\s*(\d+(?:\.\d+)?)\s*分\s*[)）\]】]\s*$/);
  if (m) { points = Number(m[1]); t = t.slice(0, m.index).trim(); }
  let typeHint = null;
  t = t.replace(/^\s*[（(\[【]?\s*(单选题?|简答题?|填空题?)\s*[)）\]】]?\s*[.、．:：]?\s*/,
    (s, g) => { typeHint = TYPE_ALIAS[g.replace(/题$/, '')] || TYPE_ALIAS[g] || null; return ''; });
  return { title: t.trim(), points, typeHint };
}

function finalizeDraft(cur) {
  const meta = extractMeta(cur.title || '');
  const options = cur.options.map((o) => o.text);
  const at = String(cur.answerText || '').trim();
  const type = meta.typeHint || cur.typeHint || (options.length ? 'single' : 'short');
  const points = cur.points || meta.points || 1;

  if (type === 'single' && options.length) {
    let idx = -1;
    const letter = at.match(/^[A-Za-z]$/);
    if (letter) idx = letter[0].toUpperCase().charCodeAt(0) - 65;
    if (idx < 0 || idx >= options.length) idx = options.findIndex((o) => stripKey(o) === stripKey(at));
    return { type: 'single', title: meta.title, options, correctIndex: idx < 0 ? 0 : idx, points, _unresolved: idx < 0 };
  }
  const answers = parseShortInput(at);
  return { type: 'short', title: meta.title, answers, points, _unresolved: answers.length === 0 };
}

function parseQuestionText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const drafts = [];
  let cur = null;
  const blank = () => ({ title: '', options: [], answerText: '', points: null, typeHint: null });
  const flush = () => { if (cur && (cur.title.trim() || cur.options.length)) drafts.push(finalizeDraft(cur)); cur = null; };

  const OPT_RE = /^[（(\[【]?\s*([A-Za-z])\s*[)）\]】.、．:：,]\s*(.+)$/;
  const ANS_RE = /^(?:正确)?答案\s*[：:]\s*(.*)$/;
  const NO_RE = /^(?:第\s*)?(\d+)\s*[.、．)）:：]\s*(.*)$/;
  const PTS_RE = /^[（(\[【]?\s*(\d+(?:\.\d+)?)\s*分\s*[)）\]】]?$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.includes('|')) {
      const f = line.split('|').map((x) => x.trim());
      const t = TYPE_ALIAS[f[0].replace(/题$/, '')] || TYPE_ALIAS[f[0]];
      if (t && f.length >= 3) {
        flush();
        const title = f[1];
        if (t === 'single') {
          const answerStr = f[f.length - 1];
          const options = f.slice(2, f.length - 1).map((x, i) => ({ letter: String.fromCharCode(65 + i), text: x }));
          drafts.push(finalizeDraft({ title, options, answerText: answerStr, points: null, typeHint: 'single' }));
        } else {
          drafts.push(finalizeDraft({ title, options: [], answerText: f.slice(2).join('、'), points: null, typeHint: 'short' }));
        }
        continue;
      }
    }

    let m = line.match(ANS_RE);
    if (m) { if (!cur) cur = blank(); cur.answerText = m[1].trim(); continue; }

    m = line.match(PTS_RE);
    if (m) { if (!cur) cur = blank(); cur.points = Number(m[1]); continue; }

    m = line.match(OPT_RE);
    if (m) {
      const letter = m[1].toUpperCase();
      const text = m[2].trim();
      const startsNew = !cur || (cur.options.length > 0 &&
        letter <= (cur.options[cur.options.length - 1].letter || ''));
      if (startsNew && cur && (cur.options.length || cur.answerText)) flush();
      if (!cur) cur = blank();
      cur.options.push({ letter, text });
      continue;
    }

    m = line.match(NO_RE);
    const isNumbered = !!m;
    const content = isNumbered ? m[2].trim() : line;

    if (cur && (cur.options.length || cur.answerText)) {
      flush(); cur = blank(); cur.title = content;
    } else if (cur && cur.title) {
      if (isNumbered) { flush(); cur = blank(); cur.title = content; }
      else cur.title += ' ' + content;
    } else {
      if (!cur) cur = blank();
      cur.title = cur.title ? cur.title + ' ' + content : content;
    }
  }
  flush();
  return drafts.filter((d) => d.title && (d.type === 'short' ? true : d.options.length >= 2));
}

/* ------------------------------------------------------------------ */
/* 校验 / 规范化                                                       */
/* ------------------------------------------------------------------ */
function validateQuestion(q) {
  if (!q || typeof q !== 'object') return '题目格式错误';
  if (!String(q.title || '').trim()) return '题干不能为空';
  const type = q.type === 'short' ? 'short' : 'single';
  if (type === 'single') {
    const opts = Array.isArray(q.options) ? q.options.filter((o) => String(o).trim()) : [];
    if (opts.length < 2) return '单选题至少需要 2 个选项';
    const ci = Number(q.correctIndex);
    if (!Number.isInteger(ci) || ci < 0 || ci >= opts.length) return '正确答案未设置或超出选项范围';
  } else {
    const ans = Array.isArray(q.answers) ? q.answers.filter((a) => String(a).trim()) : [];
    if (!ans.length) return '简答题至少需要 1 个正确答案';
  }
  return null;
}
function normalizeQuestion(q) {
  const type = q.type === 'short' ? 'short' : 'single';
  const points = Number(q.points) > 0 ? Number(q.points) : 1;
  if (type === 'single') {
    return {
      type, title: String(q.title).trim(),
      options: q.options.map((o) => String(o).trim()).filter(Boolean),
      correctIndex: Number(q.correctIndex), points
    };
  }
  return { type, title: String(q.title).trim(), answers: parseShortInput(q.answers), points };
}

const paperQuestionCount = (p) => p.questions.length;
const paperTotalPoints = (p) =>
  p.questions.reduce((a, q) => a + (Number(q.points) > 0 ? Number(q.points) : 1), 0);

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */
function computeStats(paper) {
  const subs = DB.submissions.filter((s) => s.paperId === paper.id);
  const n = subs.length;
  const percents = subs.map((s) => s.percent).slice().sort((a, b) => a - b);
  const durations = subs.map((s) => s.durationMs || 0).filter((x) => x > 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const passCount = subs.filter((s) => s.pass).length;
  const median = n === 0 ? 0
    : (n % 2 ? percents[(n - 1) / 2]
      : Math.round((percents[n / 2 - 1] + percents[n / 2]) / 2 * 100) / 100);

  const overview = {
    submissions: n,
    students: new Set(subs.map((s) => s.name)).size,
    avgPercent: n ? Math.round(sum(percents) / n * 100) / 100 : 0,
    medianPercent: median,
    maxPercent: n ? percents[n - 1] : 0,
    minPercent: n ? percents[0] : 0,
    passCount,
    passRate: n ? Math.round(passCount / n * 1000) / 10 : 0,
    avgDurationMs: durations.length ? Math.round(sum(durations) / durations.length) : 0,
    totalPoints: paperTotalPoints(paper),
    questionCount: paper.questions.length
  };

  const distribution = [];
  for (let i = 0; i < 10; i++) {
    const lo = i * 10, hi = lo + 10;
    distribution.push({
      label: lo + '-' + hi,
      count: subs.filter((s) => (i === 9
        ? s.percent >= lo && s.percent <= 100
        : s.percent >= lo && s.percent < hi)).length
    });
  }

  const questions = paper.questions.map((q, idx) => {
    const full = Number(q.points) > 0 ? Number(q.points) : 1;
    let correct = 0, partial = 0, wrong = 0, blank = 0, earned = 0, scored = 0;
    const optCount = q.type === 'single' ? (q.options || []).length : 0;
    const choiceCounts = new Array(optCount).fill(0);
    const wrongValues = new Map();

    for (const s of subs) {
      const d = (s.details || []).find((x) => x.qid === q.id);
      if (!d) continue;
      scored++;
      earned += d.earned;
      if (d.status === 'correct') correct++;
      else if (d.status === 'partial') partial++;
      else if (d.status === 'blank') blank++;
      else wrong++;

      if (q.type === 'single') {
        const ci = Number(d.userAnswer);
        if (d.userAnswer !== '' && d.userAnswer !== null && d.userAnswer !== undefined &&
            Number.isInteger(ci) && ci >= 0 && ci < optCount) choiceCounts[ci]++;
      } else if (d.status !== 'correct' && d.status !== 'blank') {
        const keys = new Set((q.answers || []).map(stripKey));
        for (const v of String(d.userDisplay || '').split('、').map((x) => x.trim()).filter(Boolean)) {
          if (!keys.has(stripKey(v))) wrongValues.set(v, (wrongValues.get(v) || 0) + 1);
        }
      }
    }

    const options = q.type === 'single'
      ? (q.options || []).map((text, i) => ({
          index: i, letter: String.fromCharCode(65 + i), text,
          count: choiceCounts[i],
          percent: scored ? Math.round(choiceCounts[i] / scored * 1000) / 10 : 0,
          isCorrect: i === Number(q.correctIndex)
        }))
      : [];

    const topWrong = q.type === 'single' ? []
      : Array.from(wrongValues.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
          .slice(0, 6)
          .map(([value, count]) => ({ value, count }));

    return {
      qid: q.id, index: idx + 1, type: q.type, title: q.title, points: full,
      scored, answered: scored - blank, correct, partial, wrong, blank,
      correctRate: scored ? Math.round(correct / scored * 1000) / 10 : 0,
      avgEarned: scored ? Math.round(earned / scored * 100) / 100 : 0,
      earnedRate: scored ? Math.round(earned / scored / full * 1000) / 10 : 0,
      options, topWrong,
      correctAnswers: q.type === 'single' ? [] : (q.answers || []),
      correctLetters: q.type === 'single' ? String.fromCharCode(65 + Number(q.correctIndex)) : ''
    };
  });

  const byStudent = new Map();
  for (const s of subs) {
    if (!byStudent.has(s.name)) {
      byStudent.set(s.name, { name: s.name, attempts: 0, bestPercent: 0, sum: 0, lastAt: '', lastPercent: 0, lastId: '', firstAt: s.createdAt });
    }
    const st = byStudent.get(s.name);
    st.attempts++;
    st.sum += s.percent;
    if (s.percent > st.bestPercent) st.bestPercent = s.percent;
    if (!st.lastAt || s.createdAt > st.lastAt) { st.lastAt = s.createdAt; st.lastPercent = s.percent; st.lastId = s.id; }
    if (s.createdAt < st.firstAt) st.firstAt = s.createdAt;
  }
  const students = Array.from(byStudent.values()).map((st) => ({
    name: st.name, attempts: st.attempts, bestPercent: st.bestPercent,
    lastPercent: st.lastPercent, avgPercent: Math.round(st.sum / st.attempts * 100) / 100,
    lastAt: st.lastAt, firstAt: st.firstAt, lastId: st.lastId,
    pass: st.bestPercent >= effectiveSettings(paper).passPercent
  }));

  return { overview, distribution, questions, students };
}


/* ------------------------------------------------------------------ */
/* HTTP 工具                                                           */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length, 'Cache-Control': 'no-store'
  });
  res.end(body);
}
const fail = (res, code, msg) => sendJSON(res, code, { ok: false, error: msg });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJSON(req) {
  const t = await readBody(req);
  if (!t) return {};
  try { return JSON.parse(t); } catch (e) { throw new Error('JSON 格式错误'); }
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<meta charset="utf-8"><h1>404 页面不存在</h1><p><a href="/">返回答题首页</a> · <a href="/admin">管理后台</a></p>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  if (rel === '/result' || rel === '/result/') rel = '/result.html';
  if (rel === '/exam' || rel === '/exam/') rel = '/exam.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { fail(res, 403, 'forbidden'); return; }
  sendFile(res, filePath);
}

function requireAdmin(req, res) {
  if (checkSession(req.headers['x-admin-token'] || '')) return true;
  fail(res, 401, '未登录或登录已过期，请重新登录');
  return false;
}

/* ------------------------------------------------------------------ */
/* 试卷序列化                                                          */
/* ------------------------------------------------------------------ */
function publicSettings() {
  const s = DB.settings;
  return {
    title: s.title, subtitle: s.subtitle, passPercent: s.passPercent,
    partialCredit: s.partialCredit, usingDefaultPassword: !!s.usingDefaultPassword
  };
}
function paperSummary(p, origin) {
  const eff = effectiveSettings(p);
  return {
    id: p.id, code: p.code, title: p.title, desc: p.desc, status: p.status,
    accessCode: p.accessCode, needAccessCode: !!p.accessCode,
    passPercent: eff.passPercent, partialCredit: eff.partialCredit,
    questionCount: paperQuestionCount(p), totalPoints: paperTotalPoints(p),
    createdAt: p.createdAt, updatedAt: p.updatedAt, publishedAt: p.publishedAt,
    submissionCount: DB.submissions.filter((s) => s.paperId === p.id).length,
    url: origin + '/p/' + p.code
  };
}
function originOf(req) {
  const host = req.headers.host || (HOST + ':' + PORT);
  return 'http://' + host;
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = parsed.pathname;
  const method = req.method.toUpperCase();

  // 短链答题页
  if (p.startsWith('/p/')) { sendFile(res, path.join(PUBLIC_DIR, 'exam.html')); return; }
  if (!p.startsWith('/api/')) { serveStatic(res, req.url); return; }

  try {
    /* ================= 公开接口 ================= */
    if (p === '/api/config' && method === 'GET') {
      return sendJSON(res, 200, {
        ok: true, title: DB.settings.title, subtitle: DB.settings.subtitle,
        passPercent: DB.settings.passPercent, partialCredit: DB.settings.partialCredit,
        paperCount: DB.papers.filter((x) => x.status === 'published').length
      });
    }

    // 已发布试卷列表（首页用）
    if (p === '/api/papers' && method === 'GET') {
      const list = DB.papers
        .filter((x) => x.status === 'published')
        .map((x) => ({
          code: x.code, title: x.title, desc: x.desc,
          questionCount: paperQuestionCount(x), totalPoints: paperTotalPoints(x),
          needAccessCode: !!x.accessCode, publishedAt: x.publishedAt
        }));
      return sendJSON(res, 200, { ok: true, title: DB.settings.title, papers: list });
    }

    // 单份试卷信息
    let m = p.match(/^\/api\/papers\/([A-Za-z0-9]+)$/);
    if (m && method === 'GET') {
      const paper = findPaperByCode(m[1]);
      if (!paper || paper.status !== 'published') return fail(res, 404, '试卷不存在或尚未发布');
      const eff = effectiveSettings(paper);
      return sendJSON(res, 200, {
        ok: true,
        paper: {
          code: paper.code, title: paper.title, desc: paper.desc,
          needAccessCode: !!paper.accessCode,
          questionCount: paperQuestionCount(paper), totalPoints: paperTotalPoints(paper),
          passPercent: eff.passPercent
        }
      });
    }

    // 取题目（若设了口令需先校验）
    m = p.match(/^\/api\/papers\/([A-Za-z0-9]+)\/questions$/);
    if (m && method === 'POST') {
      const paper = findPaperByCode(m[1]);
      if (!paper || paper.status !== 'published') return fail(res, 404, '试卷不存在或尚未发布');
      const body = await readJSON(req);
      if (paper.accessCode && String(body.accessCode || '') !== paper.accessCode) {
        return fail(res, 403, '答题口令不正确');
      }
      if (!paper.questions.length) return fail(res, 400, '这份试卷还没有题目，请联系出题人');
      const questions = paper.questions.map((q, i) => ({
        id: q.id, index: i + 1, type: q.type, title: q.title,
        options: q.type === 'single' ? (q.options || []) : [],
        points: Number(q.points) > 0 ? Number(q.points) : 1
      }));
      return sendJSON(res, 200, { ok: true, questions, title: paper.title, desc: paper.desc });
    }

    // 提交答卷
    m = p.match(/^\/api\/papers\/([A-Za-z0-9]+)\/submit$/);
    if (m && method === 'POST') {
      const paper = findPaperByCode(m[1]);
      if (!paper || paper.status !== 'published') return fail(res, 404, '试卷不存在或尚未发布');
      const body = await readJSON(req);
      if (paper.accessCode && String(body.accessCode || '') !== paper.accessCode) {
        return fail(res, 403, '答题口令不正确');
      }
      const name = String(body.name || '').trim();
      if (!name) return fail(res, 400, '请填写姓名');
      if (name.length > 40) return fail(res, 400, '姓名过长');
      if (!paper.questions.length) return fail(res, 400, '这份试卷还没有题目');

      const { details, earnedSum, fullSum, percent } = buildDetails(paper, body.answers);
      const record = {
        id: uid(),
        paperId: paper.id, paperCode: paper.code, paperTitle: paper.title,
        name,
        createdAt: new Date().toISOString(),
        durationMs: Number(body.durationMs) || 0,
        earnedSum, fullSum, percent,
        pass: percent >= effectiveSettings(paper).passPercent,
        correctCount: details.filter((d) => d.status === 'correct').length,
        partialCount: details.filter((d) => d.status === 'partial').length,
        wrongCount: details.filter((d) => d.status === 'wrong' || d.status === 'blank').length,
        totalCount: details.length,
        details
      };
      DB.submissions.unshift(record);
      saveDB();
      return sendJSON(res, 200, { ok: true, id: record.id, percent: record.percent });
    }

    if (p.startsWith('/api/result/') && method === 'GET') {
      const id = p.slice('/api/result/'.length);
      const rec = DB.submissions.find((s) => s.id === id);
      if (!rec) return fail(res, 404, '找不到这份答卷');
      return sendJSON(res, 200, {
        ok: true, result: rec,
        settings: { title: DB.settings.title, siteTitle: DB.settings.title, passPercent: DB.settings.passPercent }
      });
    }

    /* ================= 管理员 ================= */
    if (p === '/api/admin/login' && method === 'POST') {
      const body = await readJSON(req);
      if (!verifyPassword(String(body.password || ''), DB.settings.admin)) return fail(res, 401, '密码错误');
      return sendJSON(res, 200, { ok: true, token: newSession(), ttl: SESSION_TTL });
    }
    if (p === '/api/admin/logout' && method === 'POST') {
      dropSession(req.headers['x-admin-token']);
      return sendJSON(res, 200, { ok: true });
    }

    // 仅 /api/admin/* 需要鉴权；其余未知接口直接 404
    if (p.startsWith('/api/admin/') && !requireAdmin(req, res)) return;

    if (p === '/api/admin/check' && method === 'GET') return sendJSON(res, 200, { ok: true });

    /* ---- 试卷管理 ---- */
    if (p === '/api/admin/papers' && method === 'GET') {
      const origin = originOf(req);
      return sendJSON(res, 200, {
        ok: true,
        settings: publicSettings(),
        papers: DB.papers.map((x) => paperSummary(x, origin))
      });
    }

    if (p === '/api/admin/papers' && method === 'POST') {
      const body = await readJSON(req);
      const title = String(body.title || '').trim() || '未命名试卷';
      const paper = {
        id: uid(), code: newCode(), title,
        desc: String(body.desc || '').trim(),
        status: 'draft', accessCode: '',
        passPercent: null, partialCredit: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        publishedAt: null, questions: []
      };
      DB.papers.push(paper);
      saveDB();
      return sendJSON(res, 200, { ok: true, paper: paperSummary(paper, originOf(req)) });
    }

    m = p.match(/^\/api\/admin\/papers\/([^/]+)$/);
    if (m && method === 'GET') {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      return sendJSON(res, 200, {
        ok: true,
        paper: paperSummary(paper, originOf(req)),
        questions: paper.questions,
        settings: publicSettings()
      });
    }

    if (m && (method === 'PUT' || method === 'PATCH')) {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const body = await readJSON(req);
      if (typeof body.title === 'string') paper.title = body.title.trim() || paper.title;
      if (typeof body.desc === 'string') paper.desc = body.desc.trim();
      if (typeof body.accessCode === 'string') paper.accessCode = body.accessCode.trim();
      if (body.passPercent !== undefined) {
        if (body.passPercent === null || body.passPercent === '') paper.passPercent = null;
        else {
          const n = Number(body.passPercent);
          if (!Number.isFinite(n) || n < 0 || n > 100) return fail(res, 400, '及格线需在 0-100 之间');
          paper.passPercent = n;
        }
      }
      if (body.partialCredit !== undefined) {
        paper.partialCredit = body.partialCredit === null ? null : !!body.partialCredit;
      }
      paper.updatedAt = new Date().toISOString();
      saveDB();
      return sendJSON(res, 200, { ok: true, paper: paperSummary(paper, originOf(req)) });
    }

    if (m && method === 'DELETE') {
      const idx = DB.papers.findIndex((x) => x.id === m[1]);
      if (idx < 0) return fail(res, 404, '试卷不存在');
      const removed = DB.papers.splice(idx, 1)[0];
      const before = DB.submissions.length;
      DB.submissions = DB.submissions.filter((s) => s.paperId !== removed.id);
      saveDB();
      return sendJSON(res, 200, { ok: true, removedSubmissions: before - DB.submissions.length });
    }

    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/duplicate$/);
    if (m && method === 'POST') {
      const src = findPaper(m[1]);
      if (!src) return fail(res, 404, '试卷不存在');
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = uid();
      copy.code = newCode();
      copy.title = src.title + ' 副本';
      copy.status = 'draft';
      copy.publishedAt = null;
      copy.createdAt = new Date().toISOString();
      copy.updatedAt = copy.createdAt;
      copy.questions.forEach((q) => { q.id = uid(); });
      DB.papers.push(copy);
      saveDB();
      return sendJSON(res, 200, { ok: true, paper: paperSummary(copy, originOf(req)) });
    }

    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/publish$/);
    if (m && method === 'POST') {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const body = await readJSON(req);
      const publish = body.published !== false;
      if (publish && !paper.questions.length) return fail(res, 400, '试卷还没有题目，无法发布');
      paper.status = publish ? 'published' : 'draft';
      if (publish && !paper.publishedAt) paper.publishedAt = new Date().toISOString();
      paper.updatedAt = new Date().toISOString();
      saveDB();
      return sendJSON(res, 200, { ok: true, paper: paperSummary(paper, originOf(req)) });
    }

    /* ---- 统计分析 ---- */
    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/stats$/);
    if (m && method === 'GET') {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const stats = computeStats(paper);
      stats.paper = { id: paper.id, title: paper.title, code: paper.code, status: paper.status };
      return sendJSON(res, 200, Object.assign({ ok: true }, stats));
    }

    /* ---- 题目（限定在某套试卷内） ---- */
    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/questions$/);
    if (m && method === 'POST') {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const body = await readJSON(req);
      const err = validateQuestion(body);
      if (err) return fail(res, 400, err);
      const q = normalizeQuestion(body);
      q.id = uid();
      paper.questions.push(q);
      paper.updatedAt = new Date().toISOString();
      saveDB();
      return sendJSON(res, 200, { ok: true, question: q, index: paper.questions.length });
    }

    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/questions\/reorder$/);
    if (m && method === 'POST') {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const body = await readJSON(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const map = new Map(paper.questions.map((q) => [q.id, q]));
      const out = [];
      for (const id of ids) { const q = map.get(id); if (q) { out.push(q); map.delete(id); } }
      for (const q of map.values()) out.push(q);
      paper.questions = out;
      paper.updatedAt = new Date().toISOString();
      saveDB();
      return sendJSON(res, 200, { ok: true, count: out.length });
    }

    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/questions\/clear$/);
    if (m && method === 'POST') {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const body = await readJSON(req);
      if (String(body.confirm || '') !== 'DELETE') return fail(res, 400, '请输入 DELETE 确认');
      paper.questions = [];
      paper.updatedAt = new Date().toISOString();
      saveDB();
      return sendJSON(res, 200, { ok: true });
    }

    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/questions\/([^/]+)$/);
    if (m && (method === 'PUT' || method === 'PATCH')) {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const qi = paper.questions.findIndex((q) => q.id === m[2]);
      if (qi < 0) return fail(res, 404, '题目不存在');
      const body = await readJSON(req);
      const err = validateQuestion(body);
      if (err) return fail(res, 400, err);
      const q = normalizeQuestion(body);
      q.id = m[2];
      paper.questions[qi] = q;
      paper.updatedAt = new Date().toISOString();
      saveDB();
      return sendJSON(res, 200, { ok: true, question: q });
    }

    if (m && method === 'DELETE') {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const before = paper.questions.length;
      paper.questions = paper.questions.filter((q) => q.id !== m[2]);
      if (paper.questions.length === before) return fail(res, 404, '题目不存在');
      paper.updatedAt = new Date().toISOString();
      saveDB();
      return sendJSON(res, 200, { ok: true });
    }

    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/preview$/);
    if (m && method === 'POST') {
      const body = await readJSON(req);
      const drafts = parseQuestionText(body.text || '');
      return sendJSON(res, 200, { ok: true, count: drafts.length, questions: drafts });
    }

    m = p.match(/^\/api\/admin\/papers\/([^/]+)\/import$/);
    if (m && method === 'POST') {
      const paper = findPaper(m[1]);
      if (!paper) return fail(res, 404, '试卷不存在');
      const body = await readJSON(req);
      let drafts = [];
      if (Array.isArray(body.questions)) drafts = body.questions;
      else if (body.text) drafts = parseQuestionText(body.text);
      if (!drafts.length) return fail(res, 400, '没有解析出任何题目，请检查格式');
      const cleaned = [], problems = [];
      drafts.forEach((d, i) => {
        const err = validateQuestion(d);
        if (err) { problems.push(`第 ${i + 1} 条：${err}`); return; }
        if (d._unresolved) problems.push(`第 ${i + 1} 条：未识别到正确答案，已默认选 A / 空答案`);
        const q = normalizeQuestion(d);
        q.id = uid();
        cleaned.push(q);
      });
      if (body.replace) paper.questions = [];
      paper.questions.push(...cleaned);
      paper.updatedAt = new Date().toISOString();
      saveDB();
      return sendJSON(res, 200, { ok: true, added: cleaned.length, problems, total: paper.questions.length });
    }

    /* ---- 成绩 ---- */
    if (p === '/api/admin/submissions' && method === 'GET') {
      const pid = parsed.searchParams.get('paperId');
      const qid = parsed.searchParams.get('qid') || '';
      const qstatus = parsed.searchParams.get('qstatus') || 'any';
      const nameKw = (parsed.searchParams.get('name') || '').trim().toLowerCase();
      const pass = parsed.searchParams.get('pass') || '';
      const minP = parsed.searchParams.get('minPercent');
      const maxP = parsed.searchParams.get('maxPercent');
      const from = parsed.searchParams.get('from') || '';
      const to = parsed.searchParams.get('to') || '';

      let list = DB.submissions.filter((s) => !pid || s.paperId === pid);
      if (nameKw) list = list.filter((s) => s.name.toLowerCase().includes(nameKw));
      if (pass === 'true') list = list.filter((s) => s.pass);
      if (pass === 'false') list = list.filter((s) => !s.pass);
      if (minP !== null && minP !== '') list = list.filter((s) => s.percent >= Number(minP));
      if (maxP !== null && maxP !== '') list = list.filter((s) => s.percent <= Number(maxP));
      if (from) { const d = new Date(from + 'T00:00:00'); list = list.filter((s) => new Date(s.createdAt) >= d); }
      if (to) { const d = new Date(to + 'T23:59:59.999'); list = list.filter((s) => new Date(s.createdAt) <= d); }
      if (qid) {
        list = list.filter((s) => {
          const d = (s.details || []).find((x) => x.qid === qid);
          if (!d) return false;
          return qstatus === 'any' ? true : d.status === qstatus;
        });
      }

      const submissions = list.map((s) => {
        const row = {
          id: s.id, paperId: s.paperId, paperTitle: s.paperTitle, paperCode: s.paperCode,
          name: s.name, createdAt: s.createdAt, durationMs: s.durationMs,
          percent: s.percent, earnedSum: s.earnedSum, fullSum: s.fullSum, pass: s.pass,
          correctCount: s.correctCount, wrongCount: s.wrongCount,
          partialCount: s.partialCount, totalCount: s.totalCount
        };
        if (qid) {
          const d = (s.details || []).find((x) => x.qid === qid);
          row.qStatus = d ? d.status : '';
          row.qUserDisplay = d ? d.userDisplay : '';
          row.qEarned = d ? d.earned : 0;
          row.qFull = d ? d.full : 0;
        }
        return row;
      });
      return sendJSON(res, 200, { ok: true, submissions, total: submissions.length });
    }

    if (p === '/api/admin/submissions' && method === 'DELETE') {
      const body = await readJSON(req);
      if (String(body.confirm || '') !== 'DELETE') return fail(res, 400, '请输入 DELETE 确认');
      const pid = body.paperId;
      const before = DB.submissions.length;
      DB.submissions = pid ? DB.submissions.filter((s) => s.paperId !== pid) : [];
      saveDB();
      return sendJSON(res, 200, { ok: true, removed: before - DB.submissions.length });
    }

    m = p.match(/^\/api\/admin\/submissions\/([^/]+)$/);
    if (m && method === 'GET') {
      const rec = DB.submissions.find((s) => s.id === m[1]);
      if (!rec) return fail(res, 404, '找不到该答卷');
      return sendJSON(res, 200, { ok: true, result: rec });
    }
    if (m && method === 'DELETE') {
      const before = DB.submissions.length;
      DB.submissions = DB.submissions.filter((s) => s.id !== m[1]);
      if (DB.submissions.length === before) return fail(res, 404, '找不到该答卷');
      saveDB();
      return sendJSON(res, 200, { ok: true });
    }

    /* ---- 导出 ---- */
    if (p === '/api/admin/export' && method === 'GET') {
      const fmt = parsed.searchParams.get('format') || 'json';
      const pid = parsed.searchParams.get('paperId');
      const type = parsed.searchParams.get('type') || 'submissions';
      const paper = pid ? findPaper(pid) : null;

      if (fmt === 'csv') {
        let csv, name = 'submissions.csv';
        if (type === 'questions' || type === 'students') {
          if (!paper) return fail(res, 400, '导出统计需要指定 paperId');
          const st = computeStats(paper);
          if (type === 'questions') { csv = questionStatsCSV(paper, st); name = paper.title + '-题目统计.csv'; }
          else { csv = studentStatsCSV(paper, st); name = paper.title + '-人员成绩.csv'; }
        } else {
          csv = submissionsCSV(pid);
          name = (paper ? paper.title + '-' : '') + '成绩明细.csv';
        }
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name)
        });
        return res.end('\uFEFF' + csv);
      }

      const payload = paper
        ? { title: paper.title, desc: paper.desc, questions: paper.questions }
        : { papers: DB.papers.map((x) => ({ title: x.title, desc: x.desc, code: x.code, status: x.status, questions: x.questions })) };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="questions.json"'
      });
      return res.end(JSON.stringify(payload, null, 2));
    }

    /* ---- 全局设置 ---- */
    if (p === '/api/admin/settings' && method === 'POST') {
      const body = await readJSON(req);
      const s = DB.settings;
      if (typeof body.title === 'string') s.title = body.title.trim() || '在线答题系统';
      if (typeof body.subtitle === 'string') s.subtitle = body.subtitle.trim();
      if (body.passPercent !== undefined) {
        const n = Number(body.passPercent);
        if (!Number.isFinite(n) || n < 0 || n > 100) return fail(res, 400, '及格百分比需在 0-100 之间');
        s.passPercent = n;
      }
      if (body.partialCredit !== undefined) s.partialCredit = !!body.partialCredit;
      if (body.newPassword) {
        if (String(body.newPassword).length < 4) return fail(res, 400, '密码至少 4 位');
        s.admin = hashPassword(String(body.newPassword));
        s.usingDefaultPassword = false;
        DB.sessions = {};
        saveDB();
        return sendJSON(res, 200, { ok: true, passwordChanged: true });
      }
      saveDB();
      return sendJSON(res, 200, { ok: true, settings: publicSettings() });
    }

    return fail(res, 404, '接口不存在: ' + method + ' ' + p);
  } catch (e) {
    console.error('[error]', e);
    return fail(res, 500, e.message || '服务器内部错误');
  }
});

function csvEscape(v) {
  const t = String(v == null ? '' : v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
const toCSV = (rows) => rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');

function submissionsCSV(paperId) {
  const head = ['试卷', '姓名', '提交时间', '用时(秒)', '得分', '满分', '得分率(%)', '是否及格',
    '答对', '部分正确', '答错/未答', '总题数', '答卷链接'];
  const rows = DB.submissions
    .filter((s) => !paperId || s.paperId === paperId)
    .map((s) => [
      s.paperTitle || '', s.name, new Date(s.createdAt).toLocaleString('zh-CN'),
      Math.round((s.durationMs || 0) / 1000), s.earnedSum, s.fullSum, s.percent, s.pass ? '是' : '否',
      s.correctCount, s.partialCount || 0, s.wrongCount, s.totalCount, '/result.html?id=' + s.id
    ]);
  return toCSV([head, ...rows]);
}

function questionStatsCSV(paper, stats) {
  const head = ['题号', '题型', '题干', '分值', '标准答案', '答卷数', '答对', '部分正确',
    '答错', '未作答', '正确率(%)', '平均得分'];
  const rows = stats.questions.slice().sort((a, b) => a.index - b.index).map((q) => [
    q.index, q.type === 'single' ? '单选题' : '简答题', q.title, q.points,
    q.type === 'single'
      ? q.correctLetters + '. ' + ((paper.questions[q.index - 1].options || [])[Number(paper.questions[q.index - 1].correctIndex)] || '')
      : (q.correctAnswers || []).join('、'),
    q.scored, q.correct, q.partial, q.wrong, q.blank, q.correctRate, q.avgEarned
  ]);
  return toCSV([head, ...rows]);
}

function studentStatsCSV(paper, stats) {
  const head = ['姓名', '提交次数', '最高得分率(%)', '最近得分率(%)', '平均得分率(%)', '是否及格', '最近提交时间'];
  const rows = stats.students.slice().sort((a, b) => b.bestPercent - a.bestPercent).map((s) => [
    s.name, s.attempts, s.bestPercent, s.lastPercent, s.avgPercent,
    s.pass ? '是' : '否', new Date(s.lastAt).toLocaleString('zh-CN')
  ]);
  return toCSV([head, ...rows]);
}


/* ------------------------------------------------------------------ */
loadDB();
server.listen(PORT, HOST, () => {
  const url = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
  const published = DB.papers.filter((x) => x.status === 'published').length;
  console.log('==============================================');
  console.log('  在线答题系统已启动（多套试卷）');
  console.log('  答题首页: ' + url + '/');
  console.log('  管理后台: ' + url + '/admin');
  console.log('  试卷数量: ' + DB.papers.length + ' 套（已发布 ' + published + ' 套）');
  if (DB.settings.usingDefaultPassword) {
    console.log('  管理密码: ' + (process.env.ADMIN_PASSWORD || 'admin123') + '  (请登录后尽快修改)');
  }
  console.log('==============================================');
});

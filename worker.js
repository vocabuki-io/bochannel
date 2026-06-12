/* =============================================================
 * ぼちゃんねる — Cloudflare Worker (API + token hiding + rate limit)
 *
 * Architecture
 *   User → GitHub Pages (index.html)
 *            ↓ POST /api/post  (no secrets in the browser)
 *        Cloudflare Worker  ← THIS FILE  (validation / rate limit / auth)
 *            ↓ KV write
 *        Cloudflare KV  (BOCHA_KV)
 *            ↑ GET /api/posts, /api/threads
 *        GitHub Pages (display)
 *
 * Setup (wrangler.toml):
 *   name = "bochannel-api"
 *   main = "worker.js"
 *   compatibility_date = "2025-01-01"
 *   kv_namespaces = [{ binding = "BOCHA_KV", id = "<your-kv-id>" }]
 *
 *   # secrets (set with `wrangler secret put ...`):
 *   #   ADMIN_KEY   — password for admin.html
 *   #   ID_SALT     — random string, salts the per-poster ID hash
 *   # vars:
 *   [vars]
 *   ALLOW_ORIGIN = "https://<user>.github.io"   # your Pages origin
 * ============================================================= */

const DEFAULTS = {
  POST_INTERVAL_MS: 15000,     // min seconds between writes per IP
  THREAD_INTERVAL_MS: 60000,   // min seconds between new threads per IP
  MAX_BODY: 2000,
  MAX_NAME: 40,
  MAX_TITLE: 80,
  MAX_POSTS_PER_THREAD: 1000,
  MAX_THREADS: 300,            // soft cap; oldest by last activity drops off the index
  NAME_DEFAULT: "名無しのボカロP",
  BOARD: "vocaloid",
};

// ----- simple NG word list (extend as needed) -----
const NG_WORDS = [];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const p = url.pathname;
      // ---------- public ----------
      if (p === "/api/threads" && request.method === "GET") return json(await listThreads(env, url), 200, cors);
      if ((p === "/api/thread" || p === "/api/posts") && request.method === "GET") return json(await getThread(env, url), 200, cors);
      if (p === "/api/thread" && request.method === "POST") return json(await createThread(request, env), 200, cors);
      if (p === "/api/post"   && request.method === "POST") return json(await createPost(request, env), 200, cors);

      // ---------- admin (x-admin-key) ----------
      if (p.startsWith("/api/admin/")) {
        if (!isAdmin(request, env)) return json({ error: "認証が必要です" }, 401, cors);
        if (p === "/api/admin/overview" && request.method === "GET")  return json(await adminOverview(env), 200, cors);
        if (p === "/api/admin/thread"   && request.method === "GET")  return json(await getThread(env, url, true), 200, cors);
        if (p === "/api/admin/abone"          && request.method === "POST") return json(await adminAbone(request, env), 200, cors);
        if (p === "/api/admin/delete-post"    && request.method === "POST") return json(await adminDeletePost(request, env), 200, cors);
        if (p === "/api/admin/delete-thread"  && request.method === "POST") return json(await adminDeleteThread(request, env), 200, cors);
        if (p === "/api/admin/abone-thread"   && request.method === "POST") return json(await adminAboneThread(request, env), 200, cors);
        return json({ error: "not found" }, 404, cors);
      }

      if (p === "/" || p === "/api") return json({ ok: true, name: "ぼちゃんねる API", board: cfg(env).BOARD }, 200, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      const st = e instanceof ApiError ? e.status : 500;
      const ra = e instanceof ApiError ? e.retryAfter : 0;
      return json({ error: e.message || "internal error", retryAfter: ra }, st, cors);
    }
  },
};

/* ----------------------------- config ----------------------------- */
function cfg(env) { return { ...DEFAULTS, BOARD: env.BOARD || DEFAULTS.BOARD }; }

/* ----------------------------- helpers ---------------------------- */
function corsHeaders(request, env) {
  const allow = env.ALLOW_ORIGIN || "*";
  const origin = request.headers.get("Origin") || "";
  // if a comma list is provided, echo back a matching origin
  let allowOrigin = allow;
  if (allow.includes(",")) {
    const list = allow.split(",").map(s => s.trim());
    allowOrigin = list.includes(origin) ? origin : list[0];
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}
class ApiError extends Error {
  constructor(msg, status, retryAfter) {
    super(msg);
    this.status = status || 500;
    this.retryAfter = retryAfter || 0;
  }
}
function fail(msg, status, retryAfter) { return new ApiError(msg, status, retryAfter); }
function isAdmin(request, env) {
  const key = request.headers.get("x-admin-key") || "";
  return env.ADMIN_KEY && key && timingSafeEqual(key, env.ADMIN_KEY);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "0.0.0.0";
}
function sanitize(s, max) {
  return String(s == null ? "" : s).replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, max).trim();
}
function nameClean(s) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").slice(0, DEFAULTS.MAX_NAME).trim();
}
function hasNg(text) { const low = text.toLowerCase(); return NG_WORDS.some(w => w && low.includes(w.toLowerCase())); }

// JST date string: 2026/06/04(木) 12:34:56.78
function jstDate(d = new Date()) {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const W = ["日","月","火","水","木","金","土"];
  const p = (n) => String(n).padStart(2, "0");
  const cs = String(j.getUTCMilliseconds()).padStart(3, "0").slice(0, 2);
  return `${j.getUTCFullYear()}/${p(j.getUTCMonth()+1)}/${p(j.getUTCDate())}(${W[j.getUTCDay()]}) ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}:${p(j.getUTCSeconds())}.${cs}`;
}
// per-poster daily ID: hash(IP + yyyymmdd + salt) -> 8 chars
async function posterId(ip, salt) {
  const day = new Date(Date.now() + 9*3600*1000).toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + day + "|" + (salt || "bocha")));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return b64.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "Anonymou";
}
function newThreadId() { return "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* --------------------------- rate limiting ------------------------ */
async function rateLimit(env, ip, kind, intervalMs) {
  const key = `rl:${kind}:${ip}`;
  const last = await env.BOCHA_KV.get(key);
  const now = Date.now();
  if (last && now - Number(last) < intervalMs) {
    const sec = Math.ceil((intervalMs - (now - Number(last))) / 1000);
    throw fail("連投規制中です。少し待ってから書き込んでください", 429, sec);
  }
  await env.BOCHA_KV.put(key, String(now), { expirationTtl: Math.max(60, Math.ceil(intervalMs / 1000) + 5) });
}

/* ------------------------------ KV model -------------------------- */
// index:<board>           -> [{id,title,createdAt,lastAt,postCount,abone}]
// thread:<id>             -> { id,title,board,createdAt,lastAt,postCount,abone, posts:[{num,name,email,body,date,uid,ts,abone}] }
async function getIndex(env, board) {
  return (await env.BOCHA_KV.get(`index:${board}`, "json")) || [];
}
async function putIndex(env, board, idx) { await env.BOCHA_KV.put(`index:${board}`, JSON.stringify(idx)); }
async function getThreadObj(env, id) { return await env.BOCHA_KV.get(`thread:${id}`, "json"); }
async function putThreadObj(env, t) { await env.BOCHA_KV.put(`thread:${t.id}`, JSON.stringify(t)); }

/* ------------------------------ handlers -------------------------- */
async function listThreads(env, url) {
  const board = url.searchParams.get("board") || cfg(env).BOARD;
  const idx = (await getIndex(env, board)).filter(t => !t.abone);
  return { threads: idx };
}

async function getThread(env, url, includeAbone = false) {
  const id = url.searchParams.get("id");
  if (!id) throw fail("idが必要です", 400);
  const t = await getThreadObj(env, id);
  if (!t) throw fail("スレッドが見つかりません", 404);
  const posts = includeAbone ? t.posts
    : t.posts.map(p => p.abone ? { ...p, body: "あぼ〜ん" } : p);
  return { id: t.id, title: t.title, board: t.board, createdAt: t.createdAt, lastAt: t.lastAt, postCount: t.postCount, abone: !!t.abone, posts };
}

async function createThread(request, env) {
  const C = cfg(env);
  const ip = clientIp(request);
  const b = await request.json().catch(() => ({}));
  const title = sanitize(b.title, C.MAX_TITLE);
  const body = sanitize(b.body, C.MAX_BODY);
  const name = nameClean(b.name) || C.NAME_DEFAULT;
  const email = nameClean(b.email);
  const board = b.board || C.BOARD;
  if (!title) throw fail("タイトルを入力してください", 400);
  if (!body) throw fail("本文を入力してください", 400);
  if (hasNg(title + " " + body)) throw fail("投稿できない単語が含まれています", 400);

  await rateLimit(env, ip, "thread", C.THREAD_INTERVAL_MS);

  const now = Date.now();
  const uid = await posterId(ip, env.ID_SALT);
  const id = newThreadId();
  const t = {
    id, title, board, createdAt: now, lastAt: now, postCount: 1, abone: false,
    posts: [{ num: 1, name, email, body, date: jstDate(new Date(now)), uid, ts: now, abone: false }],
  };
  await putThreadObj(env, t);

  let idx = await getIndex(env, board);
  idx.unshift({ id, title, createdAt: now, lastAt: now, postCount: 1, abone: false });
  // soft cap: keep most-recently-active threads
  idx.sort((a, z) => z.lastAt - a.lastAt);
  if (idx.length > C.MAX_THREADS) {
    const dropped = idx.slice(C.MAX_THREADS);
    idx = idx.slice(0, C.MAX_THREADS);
    for (const d of dropped) await env.BOCHA_KV.delete(`thread:${d.id}`);
  }
  await putIndex(env, board, idx);
  return { id, num: 1 };
}

async function createPost(request, env) {
  const C = cfg(env);
  const ip = clientIp(request);
  const b = await request.json().catch(() => ({}));
  const threadId = String(b.threadId || "");
  const body = sanitize(b.body, C.MAX_BODY);
  const name = nameClean(b.name) || C.NAME_DEFAULT;
  const email = nameClean(b.email);
  if (!threadId) throw fail("threadIdが必要です", 400);
  if (!body) throw fail("本文を入力してください", 400);
  if (hasNg(body)) throw fail("投稿できない単語が含まれています", 400);

  const t = await getThreadObj(env, threadId);
  if (!t) throw fail("スレッドが見つかりません", 404);
  if (t.posts.length >= C.MAX_POSTS_PER_THREAD) throw fail("このスレッドは1000を超えました", 400);

  await rateLimit(env, ip, "post", C.POST_INTERVAL_MS);

  const now = Date.now();
  const uid = await posterId(ip, env.ID_SALT);
  const num = t.posts.length + 1;
  t.posts.push({ num, name, email, body, date: jstDate(new Date(now)), uid, ts: now, abone: false });
  t.postCount = t.posts.length;
  const isSage = /sage/i.test(email);
  if (!isSage) t.lastAt = now;
  await putThreadObj(env, t);

  // update index
  const idx = await getIndex(env, t.board);
  const e = idx.find(x => x.id === t.id);
  if (e) { e.postCount = t.postCount; if (!isSage) e.lastAt = now; }
  idx.sort((a, z) => z.lastAt - a.lastAt);
  await putIndex(env, t.board, idx);
  return { num };
}

/* ------------------------------ admin ----------------------------- */
async function adminOverview(env) {
  const board = cfg(env).BOARD;
  const idx = await getIndex(env, board);
  let posts = 0, todayPosts = 0, abones = 0;
  const today = Date.now() - 86400000;
  // pull each thread for accurate post/abone counts
  for (const e of idx) {
    const t = await getThreadObj(env, e.id);
    if (!t) continue;
    posts += t.posts.length;
    todayPosts += t.posts.filter(p => p.ts > today).length;
    abones += t.posts.filter(p => p.abone).length;
  }
  return {
    threads: idx.map(e => ({ id: e.id, title: e.title, postCount: e.postCount, createdAt: e.createdAt, lastAt: e.lastAt, abone: !!e.abone })),
    stats: { threads: idx.length, posts, todayPosts, abones },
  };
}

async function adminAbone(request, env) {
  const b = await request.json().catch(() => ({}));
  const t = await getThreadObj(env, b.threadId);
  if (!t) throw fail("スレッドが見つかりません", 404);
  const p = t.posts.find(x => x.num === Number(b.num));
  if (!p) throw fail("投稿が見つかりません", 404);
  p.abone = !!b.abone;
  await putThreadObj(env, t);
  return { ok: true };
}

async function adminDeletePost(request, env) {
  const b = await request.json().catch(() => ({}));
  const t = await getThreadObj(env, b.threadId);
  if (!t) throw fail("スレッドが見つかりません", 404);
  t.posts = t.posts.filter(x => x.num !== Number(b.num));
  t.postCount = t.posts.length;
  await putThreadObj(env, t);
  const idx = await getIndex(env, t.board);
  const e = idx.find(x => x.id === t.id); if (e) e.postCount = t.postCount;
  await putIndex(env, t.board, idx);
  return { ok: true };
}

async function adminDeleteThread(request, env) {
  const b = await request.json().catch(() => ({}));
  const t = await getThreadObj(env, b.id);
  const board = (t && t.board) || cfg(env).BOARD;
  await env.BOCHA_KV.delete(`thread:${b.id}`);
  let idx = await getIndex(env, board);
  idx = idx.filter(x => x.id !== b.id);
  await putIndex(env, board, idx);
  return { ok: true };
}

async function adminAboneThread(request, env) {
  const b = await request.json().catch(() => ({}));
  const t = await getThreadObj(env, b.id);
  if (!t) throw fail("スレッドが見つかりません", 404);
  t.abone = !!b.abone;
  await putThreadObj(env, t);
  const idx = await getIndex(env, t.board);
  const e = idx.find(x => x.id === t.id); if (e) e.abone = !!b.abone;
  await putIndex(env, t.board, idx);
  return { ok: true };
}

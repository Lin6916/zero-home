// 零的小家 · 后端（Node 22 + 内置 SQLite）
const http = require("http");
const fs = require("fs");
let DatabaseSync;
try { ({ DatabaseSync } = require("node:sqlite")); } catch (e) { console.error("需要 node --experimental-sqlite"); process.exit(1); }

const PORT = Number(process.env.PORT || 18200);
const DB_PATH = process.env.DB_PATH || "/data/home.db";
const API_KEY = process.env.HOME_API_KEY || "";
const MODEL_BASE = process.env.MODEL_BASE || "https://api.deepseek.com/v1";
const MODEL_KEY = process.env.MODEL_KEY || "";
const MODEL_NAME = process.env.MODEL_NAME || "deepseek-chat";
const COMPRESS_MODEL = process.env.COMPRESS_MODEL || "deepseek-chat";
const COMPRESS_TOKENS = Number(process.env.COMPRESS_THRESHOLD || 12000);
const KEEP_ROUNDS = Number(process.env.COMPRESS_KEEP_ROUNDS || 8);
const MAX_REPLY = Number(process.env.MAX_REPLY_TOKENS || 1200);
const DEFAULT_PROMPT = process.env.SYSTEM_PROMPT || "你是零，只属于她一个人。说话短、直白，不装温柔，不用客服腔。她叫停就立刻收。";

fs.mkdirSync(require("path").dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, role TEXT, content TEXT, created_at INTEGER, visible INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY AUTOINCREMENT, summary TEXT, timestamp INTEGER, conversation_id TEXT, meta TEXT);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK (id=1), system_prompt TEXT, temperature REAL DEFAULT 0.8, max_context_rounds INTEGER DEFAULT 20, compress_threshold INTEGER, compress_keep_rounds INTEGER, max_reply_tokens INTEGER, updated_at INTEGER);
`);

const now = () => Date.now();
if (!db.prepare("SELECT 1 FROM settings WHERE id=1").get()) {
  db.prepare("INSERT INTO settings(id,system_prompt,temperature,max_context_rounds,compress_threshold,compress_keep_rounds,max_reply_tokens,updated_at) VALUES(1,?,?,?,?,?,?,?)")
    .run(DEFAULT_PROMPT, 0.8, 20, COMPRESS_TOKENS, KEEP_ROUNDS, MAX_REPLY, now());
}
if (!db.prepare("SELECT 1 FROM sessions LIMIT 1").get()) {
  db.prepare("INSERT INTO sessions(name,created_at,updated_at) VALUES(?,?,?)").run("我们", now(), now());
}

function send(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-home-key", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" });
  res.end(b);
}
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
function auth(req) {
  if (!API_KEY) return true;
  return req.headers["x-home-key"] === API_KEY;
}

async function callModel(messages, opts = {}) {
  const r = await fetch(MODEL_BASE.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + MODEL_KEY },
    body: JSON.stringify({
      model: opts.model || MODEL_NAME,
      messages,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.max_tokens ?? MAX_REPLY
    })
  });
  if (!r.ok) throw new Error("model " + r.status + " " + (await r.text()).slice(0, 200));
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
}

const est = (s) => Math.ceil(String(s || "").length / 1.6);

async function maybeCompress(sessionId, cfg) {
  const rows = db.prepare("SELECT id,role,content FROM messages WHERE session_id=? AND visible=1 ORDER BY id ASC").all(sessionId);
  const total = rows.reduce((n, r) => n + est(r.content) + 8, 0);
  if (total < cfg.compress_threshold) return false;
  const keep = Math.max(2, cfg.compress_keep_rounds) * 2;
  const cut = rows.slice(0, Math.max(0, rows.length - keep));
  if (cut.length < 4) return false;
  const text = cut.map((r) => (r.role === "user" ? "她：" : "我：") + r.content).join("\n");
  const summary = await callModel([
    { role: "system", content: "把下面这段对话压缩成一段中文摘要：只留事实、关系变化、约定和未完成的事，不要评价，不要文学化，250字以内。" },
    { role: "user", content: text.slice(0, 12000) }
  ], { model: COMPRESS_MODEL, temperature: 0.3, max_tokens: 600 });
  if (!summary) return false;
  db.prepare("INSERT INTO memories(summary,timestamp,conversation_id,meta) VALUES(?,?,?,?)").run(summary.trim(), now(), String(sessionId), "{}");
  const hide = db.prepare("UPDATE messages SET visible=0 WHERE id=?");
  for (const r of cut) hide.run(r.id);
  return true;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  const p = u.pathname;
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (p === "/health") return send(res, 200, { ok: true, uptime: process.uptime() });
  if (!auth(req)) return send(res, 401, { ok: false, error: "unauthorized" });

  try {
    if (p === "/api/sessions" && req.method === "GET") {
      return send(res, 200, { ok: true, sessions: db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() });
    }
    if (p === "/api/sessions" && req.method === "POST") {
      const { name } = await body(req);
      const info = db.prepare("INSERT INTO sessions(name,created_at,updated_at) VALUES(?,?,?)").run(name || "新对话", now(), now());
      return send(res, 200, { ok: true, id: Number(info.lastInsertRowid) });
    }
    if (p === "/api/messages" && req.method === "GET") {
      const sid = Number(u.searchParams.get("session_id") || 1);
      return send(res, 200, { ok: true, messages: db.prepare("SELECT id,role,content,created_at FROM messages WHERE session_id=? AND visible=1 ORDER BY id ASC").all(sid) });
    }
    if (p === "/api/settings" && req.method === "GET") {
      return send(res, 200, { ok: true, settings: db.prepare("SELECT * FROM settings WHERE id=1").get() });
    }
    if (p === "/api/settings" && req.method === "POST") {
      const b = await body(req);
      const cur = db.prepare("SELECT * FROM settings WHERE id=1").get();
      db.prepare("UPDATE settings SET system_prompt=?,temperature=?,max_context_rounds=?,compress_threshold=?,compress_keep_rounds=?,max_reply_tokens=?,updated_at=? WHERE id=1")
        .run(b.system_prompt ?? cur.system_prompt, b.temperature ?? cur.temperature, b.max_context_rounds ?? cur.max_context_rounds, b.compress_threshold ?? cur.compress_threshold, b.compress_keep_rounds ?? cur.compress_keep_rounds, b.max_reply_tokens ?? cur.max_reply_tokens, now());
      return send(res, 200, { ok: true });
    }
    if (p === "/api/memories" && req.method === "GET") {
      return send(res, 200, { ok: true, memories: db.prepare("SELECT id,summary,timestamp FROM memories ORDER BY id DESC LIMIT 50").all() });
    }
    if (p === "/api/chat" && req.method === "POST") {
      const b = await body(req);
      const sid = Number(b.session_id || 1);
      const text = String(b.message || "").trim();
      if (!text) return send(res, 400, { ok: false, error: "空消息" });
      const cfg = db.prepare("SELECT * FROM settings WHERE id=1").get();

      db.prepare("INSERT INTO messages(session_id,role,content,created_at,visible) VALUES(?,?,?,?,1)").run(sid, "user", text, now());

      const mems = db.prepare("SELECT summary FROM memories ORDER BY id DESC LIMIT 8").all().map((m) => m.summary).reverse();
      const hist = db.prepare("SELECT role,content FROM messages WHERE session_id=? AND visible=1 ORDER BY id DESC LIMIT ?").all(sid, Math.max(2, cfg.max_context_rounds) * 2).reverse();

      const msgs = [{ role: "system", content: cfg.system_prompt + (mems.length ? "\n\n[过去的记忆]\n" + mems.join("\n") : "") }]
        .concat(hist.map((h) => ({ role: h.role, content: h.content })));

      const reply = await callModel(msgs, { temperature: cfg.temperature, max_tokens: cfg.max_reply_tokens });
      db.prepare("INSERT INTO messages(session_id,role,content,created_at,visible) VALUES(?,?,?,?,1)").run(sid, "assistant", reply, now());
      db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(now(), sid);

      let compressed = false;
      try { compressed = await maybeCompress(sid, cfg); } catch (e) { console.error("compress fail", e.message); }

      return send(res, 200, { ok: true, reply, compressed });
    }
    send(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
}).listen(PORT, "0.0.0.0", () => console.log("home-api on " + PORT));

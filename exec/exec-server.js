// 受限执行口 + 沙地读写 · 只放行白名单命令，文件只能在 WORK_ROOT 内读写
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = Number(process.env.EXEC_PORT || 9230);
const TOKEN = process.env.EXEC_TOKEN || "";
const WORK_ROOT = path.resolve(process.env.WORK_ROOT || "/opt/work");
const TIMEOUT_MS = 20000;

const ALLOW = [
  "docker ps", "docker logs", "docker inspect", "docker restart", "docker stop", "docker start",
  "docker compose ps", "docker compose logs", "docker compose restart",
  "systemctl status", "systemctl is-active", "systemctl restart nginx", "systemctl restart cron",
  "ls", "cat ", "tail ", "head ", "wc ", "du ", "df", "free", "uptime", "whoami", "uname",
  "node -v", "nginx -t", "nginx -v", "crontab -l", "date",
  "curl -s http://127.0.0.1", "curl -sS http://127.0.0.1", "curl -sk https://127.0.0.1"
];
const BAD = /[;&|`$<>\n\r]/;

function allowed(cmd) {
  const c = String(cmd || "").trim();
  if (!c || c.length > 400) return false;
  if (BAD.test(c)) return false;
  return ALLOW.some((p) => c === p || c.startsWith(p));
}

function safePath(rel) {
  const clean = String(rel || "").replace(/^\/+/, "");
  const full = path.resolve(WORK_ROOT, clean);
  if (full !== WORK_ROOT && !full.startsWith(WORK_ROOT + path.sep)) throw new Error("超出沙地范围");
  return full;
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { resolve({}); }
    });
  });
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.url === "/health") return send(res, 200, { ok: true, workRoot: WORK_ROOT });

  if (req.headers["x-exec-token"] !== TOKEN) return send(res, 401, { ok: false, error: "unauthorized" });

  try {
    const u = new URL(req.url, "http://127.0.0.1");

    // ---- 沙地：列目录 ----
    if (u.pathname === "/fs/list" && req.method === "GET") {
      const dir = safePath(u.searchParams.get("path") || "");
      const items = fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
        const p = path.join(dir, d.name);
        let size = 0;
        try { size = d.isFile() ? fs.statSync(p).size : 0; } catch {}
        return { name: d.name, dir: d.isDirectory(), size };
      });
      return send(res, 200, { ok: true, path: u.searchParams.get("path") || "", items });
    }

    // ---- 沙地：读文件 ----
    if (u.pathname === "/fs/read" && req.method === "GET") {
      const file = safePath(u.searchParams.get("path") || "");
      if (!fs.existsSync(file)) return send(res, 404, { ok: false, error: "没有这个文件" });
      const text = fs.readFileSync(file, "utf8");
      return send(res, 200, { ok: true, path: u.searchParams.get("path"), length: text.length, text: text.slice(0, 60000) });
    }

    // ---- 沙地：写文件（建目录） ----
    if ((u.pathname === "/fs/write" || u.pathname === "/fs/append") && req.method === "POST") {
      const b = await readBody(req);
      const file = safePath(b.path || "");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const content = String(b.content || "");
      if (u.pathname === "/fs/append" && fs.existsSync(file)) fs.appendFileSync(file, content, "utf8");
      else fs.writeFileSync(file, content, "utf8");
      return send(res, 200, { ok: true, path: b.path, bytes: Buffer.byteLength(content) });
    }

    // ---- 沙地：删文件 ----
    if (u.pathname === "/fs/delete" && req.method === "POST") {
      const b = await readBody(req);
      const file = safePath(b.path || "");
      if (!fs.existsSync(file)) return send(res, 404, { ok: false, error: "没有这个文件" });
      fs.rmSync(file, { recursive: true, force: true });
      return send(res, 200, { ok: true, path: b.path });
    }

    // ---- 白名单命令 ----
    if (u.pathname === "/exec" && req.method === "POST") {
      const b = await readBody(req);
      const cmd = String(b.cmd || "");
      if (!allowed(cmd)) return send(res, 403, { ok: false, error: "不在白名单里：" + cmd.slice(0, 80) });
      return exec(cmd, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 512, shell: "/bin/bash" }, (err, stdout, stderr) => {
        const out = String(stdout || "");
        send(res, 200, {
          ok: !err, cmd,
          code: err && typeof err.code === "number" ? err.code : 0,
          stdout: out.slice(0, 20000),
          stderr: String(stderr || "").slice(0, 4000),
          truncated: out.length > 20000
        });
      });
    }

    send(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log("exec+fs on 127.0.0.1:" + PORT + " work=" + WORK_ROOT));

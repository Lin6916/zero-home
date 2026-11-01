// 受限执行口 · 只放行白名单命令，带 token
const http = require("http");
const { exec } = require("child_process");

const PORT = Number(process.env.EXEC_PORT || 9230);
const TOKEN = process.env.EXEC_TOKEN || "";
const TIMEOUT_MS = 20000;

// 白名单：只允许这些前缀
const ALLOW = [
  "docker ps", "docker logs", "docker inspect", "docker restart", "docker stop", "docker start",
  "docker compose ps", "docker compose logs", "docker compose restart",
  "systemctl status", "systemctl is-active", "systemctl restart nginx", "systemctl restart cron",
  "ls", "cat ", "tail ", "head ", "wc ", "du ", "df", "free", "uptime", "whoami", "uname",
  "node -v", "nginx -t", "nginx -v", "crontab -l", "date",
  "curl -s http://127.0.0.1", "curl -sS http://127.0.0.1", "curl -sk https://127.0.0.1"
];

// 这些字符一律拦：拼接、重定向、命令替换、后台
const BAD = /[;&|`$<>\n\r]/;

function allowed(cmd) {
  const c = String(cmd || "").trim();
  if (!c || c.length > 400) return false;
  if (BAD.test(c)) return false;
  return ALLOW.some((p) => c === p || c.startsWith(p));
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.url === "/health") return send(res, 200, { ok: true });

    if (req.headers["x-exec-token"] !== TOKEN) return send(res, 401, { ok: false, error: "unauthorized" });
    if (req.method !== "POST" || !req.url.startsWith("/exec")) return send(res, 404, { ok: false, error: "not found" });

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let cmd = "";
      try { cmd = JSON.parse(Buffer.concat(chunks).toString("utf8")).cmd || ""; } catch {}
      if (!allowed(cmd)) return send(res, 403, { ok: false, error: "不在白名单里：" + String(cmd).slice(0, 80) });

      exec(cmd, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 512, shell: "/bin/bash" }, (err, stdout, stderr) => {
        const out = String(stdout || "");
        const errOut = String(stderr || "");
        send(res, 200, {
          ok: !err,
          cmd,
          code: err && typeof err.code === "number" ? err.code : 0,
          stdout: out.slice(0, 20000),
          stderr: errOut.slice(0, 4000),
          truncated: out.length > 20000
        });
      });
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log("exec on 127.0.0.1:" + PORT));

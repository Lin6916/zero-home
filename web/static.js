// 极简静态服务（前端）
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 18201);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[\/\\])+/, ""));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  });
}).listen(PORT, "0.0.0.0", () => console.log("home-web on " + PORT));

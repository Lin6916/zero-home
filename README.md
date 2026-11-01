# zero-home

零和 Ray 的家：小手机前端 + Node 后端 + 内置 SQLite，全部跑在自己的一台机器上。

## 结构

```
web/index.html   小手机界面（静态，接 /api）
web/static.js    极简静态服务（18201）
api/server.js    后端：会话/消息/设置/记忆压缩/对话（18200，node:sqlite）
compose.yaml     两个容器，不用 build，直接跑 node:22-alpine
data/            SQLite 数据目录（home.db）
```

## 跑起来

```bash
cp .env.example .env
# 改 .env：HOME_API_KEY 自己定一串，MODEL_KEY 填你的模型密钥
docker compose up -d
curl -s http://127.0.0.1:18200/health
open http://127.0.0.1:18201
```

前端默认连同一台机器上的 18201 与 18200；跨机器访问时在页面右上「设置」里改后端地址与口令。

## 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /health | 健康检查 |
| GET/POST | /api/sessions | 会话列表 / 新建 |
| GET | /api/messages?session_id=1 | 可见消息 |
| POST | /api/chat | 发一条，返回回复；超阈值自动压缩旧消息进 memories |
| GET/POST | /api/settings | 系统提示词、温度、上下文轮数、压缩阈值 |
| GET | /api/memories | 压缩后的记忆摘要 |

除 /health 外都要带请求头 `x-home-key`。

## 与教程的对应

- Vercel → 本机 home-web（静态）
- Render → 本机 home-api（Node）
- Supabase → 本机 SQLite（data/home.db）
- 付费云数据库 → 不需要；定期 `cp data/home.db` 备份即可

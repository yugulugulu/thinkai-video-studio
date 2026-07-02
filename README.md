# ThinkAI CH3 Video Studio

本地 React + Express 前后端分离视频生成控制台，支持配置 Base URL、API Key、模型、分辨率、素材 URL，并通过 CH3 `/v1/videos` 创建、轮询和下载视频。

## 本地数据库

项目使用本地 PostgreSQL，默认连接如下：

- Host: `localhost`
- Port: `5432`
- Database: `thinkai_video_studio`
- User: `postgres`
- Password: `postgres`

启动数据库：

```bash
npm run db:start
```

停止数据库：

```bash
npm run db:stop
```

## 使用

```bash
npm install
npm run db:start
npm run dev
```

- 前端: http://localhost:5173
- 后端: http://localhost:8787

API Key 保存在 `server/data/config.json`，该文件已加入 `.gitignore`。

## 认证

后端已提供注册和登录接口：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

登录后前端会保存 JWT，并用它访问受保护的配置、任务历史和视频任务接口。

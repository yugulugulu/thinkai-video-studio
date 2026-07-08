import cors from "cors";
import express from "express";
import multer from "multer";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { createVideoDownloadToken, getApiKeyByUserId, loginUser, registerUser, requireAuth, saveApiKeyForUser, verifyVideoDownloadToken } from "./auth.js";
import { initDatabase } from "./db.js";
import { envNumber } from "./env.js";
import { createMediaAsset, listMediaAssetsByUserId, normalizeUploadedFilename, repairMediaAssetFilenames, validateUploadInput } from "./media.js";
import { CH3_MODELS } from "./models.js";
import { getVideoObjectAccessUrls, isOssPublicReadEnabled, uploadBufferToOss, uploadVideoStreamToOss } from "./oss.js";
import { buildReferences, createVideoTask, getVideoContentStream, getVideoTask } from "./thinkaiClient.js";
import { ensureStorage, getTaskRecord, migrateTasksFromFile, publicConfig, readConfig, readTasks, upsertTaskRecord, writeConfig } from "./storage.js";
import { validateCreatePayload } from "./validation.js";

const app = express();
const port = envNumber("PORT", 8787);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 300 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const archiveLocks = new Map();
const UPLOAD_RATE_WINDOW_MS = 60 * 1000;
const MAX_UPLOADS_PER_USER_WINDOW = 20;
const MAX_UPLOAD_CONCURRENCY_PER_USER = 3;
const MAX_GLOBAL_UPLOAD_CONCURRENCY = 10;
const uploadRateBuckets = new Map();
const uploadConcurrencyByUser = new Map();
let globalUploadConcurrency = 0;

function createUploadRateKey(req) {
  return `${req.user.id}::${req.ip || "unknown"}`;
}

function getUploadRateBucket(key) {
  const now = Date.now();
  const bucket = uploadRateBuckets.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    const freshBucket = { count: 0, expiresAt: now + UPLOAD_RATE_WINDOW_MS };
    uploadRateBuckets.set(key, freshBucket);
    return freshBucket;
  }
  return bucket;
}

function uploadLimitError(message, status = 429) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function enforceUploadRate(req) {
  const bucket = getUploadRateBucket(createUploadRateKey(req));
  if (bucket.count >= MAX_UPLOADS_PER_USER_WINDOW) {
    throw uploadLimitError("上传过于频繁，请稍后再试");
  }
  bucket.count += 1;
}

function acquireUploadSlot(req) {
  const userId = String(req.user.id);
  const userConcurrency = uploadConcurrencyByUser.get(userId) || 0;
  if (userConcurrency >= MAX_UPLOAD_CONCURRENCY_PER_USER) {
    throw uploadLimitError("当前上传任务较多，请等待已有上传完成后再试");
  }
  if (globalUploadConcurrency >= MAX_GLOBAL_UPLOAD_CONCURRENCY) {
    throw uploadLimitError("当前上传任务较多，请稍后再试");
  }

  uploadConcurrencyByUser.set(userId, userConcurrency + 1);
  globalUploadConcurrency += 1;
}

function releaseUploadSlot(req) {
  const userId = String(req.user?.id || "");
  if (!userId) return;

  const nextUserConcurrency = Math.max(0, (uploadConcurrencyByUser.get(userId) || 0) - 1);
  if (nextUserConcurrency) {
    uploadConcurrencyByUser.set(userId, nextUserConcurrency);
  } else {
    uploadConcurrencyByUser.delete(userId);
  }
  globalUploadConcurrency = Math.max(0, globalUploadConcurrency - 1);
}

function limitUpload(req, res, next) {
  try {
    enforceUploadRate(req);
    acquireUploadSlot(req);
  } catch (error) {
    next(error);
    return;
  }

  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    releaseUploadSlot(req);
  };

  res.once("finish", releaseOnce);
  res.once("close", releaseOnce);
  next();
}

function maskError(error) {
  const upstreamMessage = error.body?.error?.message || error.body?.message || error.message;
  const message = error.status === 401
    ? `API Key 无效或不属于 ThinkAI 当前接口，请重新保存 ThinkAI API Key。上游返回：${upstreamMessage}`
    : error.message || "请求失败";

  return {
    error: message,
    status: error.status,
    detail: error.body || undefined
  };
}

function inferVideoExtension(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("quicktime")) return ".mov";
  if (normalized.includes("webm")) return ".webm";
  if (normalized.includes("ogg")) return ".ogv";
  return ".mp4";
}

function buildArchivedFilePayload(asset) {
  return {
    id: asset.id,
    storage: "oss",
    kind: asset.kind,
    filename: asset.filename,
    objectKey: asset.objectKey,
    url: asset.url,
    sizeBytes: asset.sizeBytes,
    mimeType: asset.mimeType,
    createdAt: asset.createdAt
  };
}

async function ensureArchivedVideoAsset({ userId, taskId, config, apiKey, taskRecord, task }) {
  if (taskRecord?.file?.objectKey) {
    return taskRecord.file;
  }

  if (archiveLocks.has(taskId)) {
    return archiveLocks.get(taskId);
  }

  const work = (async () => {
    const latestRecord = await getTaskRecord(taskId, userId);
    if (latestRecord?.file?.objectKey) {
      return latestRecord.file;
    }

    const upstream = await getVideoContentStream(
      { ...config, apiKey },
      taskId
    );
    const mimeType = upstream.headers.get("content-type") || "video/mp4";
    const extension = inferVideoExtension(mimeType);
    const uploaded = await uploadVideoStreamToOss({
      userId,
      taskId,
      stream: Readable.fromWeb(upstream.body),
      mimeType
    });

    const asset = await createMediaAsset({
      userId,
      kind: "video",
      filename: `${taskId}${extension || path.extname(uploaded.filename) || ".mp4"}`,
      objectKey: uploaded.objectKey,
      url: uploaded.url,
      sizeBytes: uploaded.sizeBytes,
      mimeType: uploaded.mimeType
    });

    const file = buildArchivedFilePayload(asset);
    await upsertTaskRecord({
      userId,
      taskId,
      clientTaskId: latestRecord?.clientTaskId || taskRecord?.clientTaskId || task?.client_task_id,
      status: "downloaded",
      progress: 100,
      model: task?.model || latestRecord?.model || taskRecord?.model,
      payload: latestRecord?.payload || taskRecord?.payload || null,
      task,
      file
    });

    return file;
  })();

  archiveLocks.set(taskId, work);
  try {
    return await work;
  } finally {
    archiveLocks.delete(taskId);
  }
}

async function buildTaskAccessPayload(file) {
  const access = await getVideoObjectAccessUrls(file.objectKey, {
    filename: file.filename,
    mimeType: file.mimeType
  });

  return {
    storage: "oss",
    isSigned: access.isSigned,
    expiresAt: access.expiresAt,
    previewUrl: access.previewUrl,
    downloadUrl: access.downloadUrl,
    publicUrl: isOssPublicReadEnabled() ? file.url : null,
    file
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/models", (_req, res) => {
  res.json({ models: CH3_MODELS });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    res.status(201).json(await registerUser(req.body));
  } catch (error) {
    res.status(400).json(maskError(error));
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    res.json(await loginUser(req.body, { ip: req.ip }));
  } catch (error) {
    res.status(error.status || 400).json(maskError(error));
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/config", requireAuth, async (req, res, next) => {
  try {
    const [config, latestApiKey] = await Promise.all([
      readConfig(),
      getApiKeyByUserId(req.user.id)
    ]);
    res.json(publicConfig(config, latestApiKey?.apiKey));
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    res.json({ tasks: await readTasks(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/uploads", requireAuth, async (req, res, next) => {
  try {
    res.json({ assets: await listMediaAssetsByUserId(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/config", requireAuth, async (req, res, next) => {
  try {
    const current = await readConfig();
    if (typeof req.body.apiKey === "string" && req.body.apiKey.trim()) {
      await saveApiKeyForUser(req.user.id, req.body.apiKey);
    }

    const saved = await writeConfig({
      ...current,
      pollIntervalMs: Number(req.body.pollIntervalMs || current.pollIntervalMs),
      pollTimeoutMs: Number(req.body.pollTimeoutMs || current.pollTimeoutMs)
    });

    const latestApiKey = await getApiKeyByUserId(req.user.id);
    res.json(publicConfig(saved, latestApiKey?.apiKey));
  } catch (error) {
    next(error);
  }
});

app.post("/api/uploads", requireAuth, limitUpload, upload.single("file"), async (req, res, next) => {
  try {
    const kind = validateUploadInput(req.body.kind, req.file);
    req.file.originalname = normalizeUploadedFilename(req.file.originalname);
    const uploaded = await uploadBufferToOss({
      userId: req.user.id,
      kind,
      file: req.file
    });

    const asset = await createMediaAsset({
      userId: req.user.id,
      kind,
      filename: req.file.originalname,
      objectKey: uploaded.objectKey,
      url: uploaded.url,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype
    });

    res.status(201).json({ asset });
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos", requireAuth, async (req, res) => {
  try {
    const [config, latestApiKey] = await Promise.all([
      readConfig(),
      getApiKeyByUserId(req.user.id)
    ]);
    if (!latestApiKey?.apiKey) {
      res.status(400).json({ error: "请先配置 API Key" });
      return;
    }

    const input = validateCreatePayload(req.body);
    const references = buildReferences(input);
    const clientTaskId = input.clientTaskId || `local_${Date.now()}_${nanoid(6)}`;
    const payload = {
      model: input.model.id,
      prompt: input.prompt,
      mode: "references",
      client_task_id: clientTaskId,
      aspect_ratio: input.aspectRatio,
      duration: input.duration,
      resolution: input.resolution,
      ...(references ? { references } : {})
    };

    const task = await createVideoTask({ ...config, apiKey: latestApiKey.apiKey }, payload);
    await upsertTaskRecord({
      userId: req.user.id,
      taskId: task.id,
      clientTaskId,
      status: task.status,
      progress: task.progress,
      model: payload.model,
      payload,
      task
    });
    res.json({ task, payload });
  } catch (error) {
    res.status(error.status || 400).json(maskError(error));
  }
});

app.get("/api/videos/:taskId", requireAuth, async (req, res) => {
  try {
    const [config, latestApiKey] = await Promise.all([
      readConfig(),
      getApiKeyByUserId(req.user.id)
    ]);
    if (!latestApiKey?.apiKey) {
      res.status(400).json({ error: "请先配置 API Key" });
      return;
    }

    const currentRecord = await getTaskRecord(req.params.taskId, req.user.id);
    if (!currentRecord) {
      res.status(404).json({ error: "任务不存在" });
      return;
    }

    const task = await getVideoTask({ ...config, apiKey: latestApiKey.apiKey }, req.params.taskId);
    let nextStatus = task.status;
    let nextProgress = task.progress;
    let file = currentRecord?.file || null;

    if (task.status === "completed") {
      file = await ensureArchivedVideoAsset({
        userId: req.user.id,
        taskId: req.params.taskId,
        config,
        apiKey: latestApiKey.apiKey,
        taskRecord: currentRecord,
        task
      });
      nextStatus = "downloaded";
      nextProgress = 100;
    }

    const saved = await upsertTaskRecord({
      userId: req.user.id,
      taskId: req.params.taskId,
      clientTaskId: currentRecord?.clientTaskId || task.client_task_id,
      status: nextStatus,
      progress: nextProgress,
      model: task.model,
      payload: currentRecord?.payload || null,
      task,
      file
    });
    res.json({
      task: {
        ...(saved.task || task),
        status: nextStatus,
        progress: nextProgress
      },
      record: saved
    });
  } catch (error) {
    res.status(error.status || 400).json(maskError(error));
  }
});

app.post("/api/videos/:taskId/access", requireAuth, async (req, res) => {
  try {
    const [config, latestApiKey, taskRecord] = await Promise.all([
      readConfig(),
      getApiKeyByUserId(req.user.id),
      getTaskRecord(req.params.taskId, req.user.id)
    ]);

    if (!taskRecord) {
      res.status(404).json({ error: "任务不存在" });
      return;
    }

    let file = taskRecord.file || null;
    if (!file) {
      if (!latestApiKey?.apiKey) {
        res.status(400).json({ error: "当前用户未配置 API Key" });
        return;
      }

      const task = await getVideoTask({ ...config, apiKey: latestApiKey.apiKey }, req.params.taskId);
      if (!["completed", "downloaded"].includes(task.status)) {
        res.status(409).json({ error: "视频尚未生成完成" });
        return;
      }

      file = await ensureArchivedVideoAsset({
        userId: req.user.id,
        taskId: req.params.taskId,
        config,
        apiKey: latestApiKey.apiKey,
        taskRecord,
        task
      });
    }

    res.json(await buildTaskAccessPayload(file));
  } catch (error) {
    res.status(error.status || 400).json(maskError(error));
  }
});

app.get("/api/videos/:taskId/content", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) {
      res.status(401).json({ error: "缺少下载凭证" });
      return;
    }

    const payload = verifyVideoDownloadToken(token, req.params.taskId);
    const [config, latestApiKey] = await Promise.all([
      readConfig(),
      getApiKeyByUserId(payload.userId)
    ]);
    if (!latestApiKey?.apiKey) {
      res.status(400).json({ error: "当前用户未配置 API Key" });
      return;
    }

    const upstream = await getVideoContentStream(
      { ...config, apiKey: latestApiKey.apiKey },
      req.params.taskId,
      { range: req.headers.range }
    );
    const disposition = String(req.query.disposition || "inline") === "attachment" ? "attachment" : "inline";
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    res.setHeader("Content-Disposition", `${disposition}; filename=\"${req.params.taskId}.mp4\"`);
    const passthroughHeaders = ["content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"];
    for (const headerName of passthroughHeaders) {
      const value = upstream.headers.get(headerName);
      if (value) {
        res.setHeader(headerName, value);
      }
    }

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(error.status || 400).json(maskError(error));
    } else {
      res.end();
    }
  }
});

app.use((error, _req, res, _next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "上传文件过大，请压缩后重试" });
    return;
  }
  res.status(error.status || 500).json(maskError(error));
});

await ensureStorage();
await initDatabase();
const migratedTaskCount = await migrateTasksFromFile();
if (migratedTaskCount > 0) {
  console.log(`Migrated ${migratedTaskCount} task history records into PostgreSQL`);
}
const repairedFilenameCount = await repairMediaAssetFilenames();
if (repairedFilenameCount > 0) {
  console.log(`Repaired ${repairedFilenameCount} media asset filenames`);
}
app.listen(port, () => {
  console.log(`ThinkAI CH3 server listening on http://localhost:${port}`);
});

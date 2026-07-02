import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { getLatestApiKeyByUserId, listApiKeysByUserId, loginUser, registerUser, requireAuth, saveApiKeyForUser } from "./auth.js";
import { initDatabase } from "./db.js";
import { CH3_MODELS } from "./models.js";
import { buildReferences, createVideoTask, downloadVideo, getVideoTask } from "./thinkaiClient.js";
import { ensureStorage, generatedDir, publicConfig, readConfig, readTasks, upsertTaskRecord, writeConfig } from "./storage.js";
import { validateCreatePayload } from "./validation.js";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/videos", express.static(generatedDir));

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
    res.json(await loginUser(req.body));
  } catch (error) {
    res.status(400).json(maskError(error));
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/config", requireAuth, async (req, res, next) => {
  try {
    const [config, latestApiKey, apiKeys] = await Promise.all([
      readConfig(),
      getLatestApiKeyByUserId(req.user.id),
      listApiKeysByUserId(req.user.id)
    ]);
    res.json(publicConfig(config, latestApiKey?.apiKey, apiKeys));
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

    const [latestApiKey, apiKeys] = await Promise.all([
      getLatestApiKeyByUserId(req.user.id),
      listApiKeysByUserId(req.user.id)
    ]);
    res.json(publicConfig(saved, latestApiKey?.apiKey, apiKeys));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos", requireAuth, async (req, res) => {
  try {
    const [config, latestApiKey] = await Promise.all([
      readConfig(),
      getLatestApiKeyByUserId(req.user.id)
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
      getLatestApiKeyByUserId(req.user.id)
    ]);
    if (!latestApiKey?.apiKey) {
      res.status(400).json({ error: "请先配置 API Key" });
      return;
    }

    const task = await getVideoTask({ ...config, apiKey: latestApiKey.apiKey }, req.params.taskId);
    await upsertTaskRecord({
      userId: req.user.id,
      taskId: req.params.taskId,
      status: task.status,
      progress: task.progress,
      model: task.model,
      task
    });
    res.json({ task });
  } catch (error) {
    res.status(error.status || 400).json(maskError(error));
  }
});

app.post("/api/videos/:taskId/download", requireAuth, async (req, res) => {
  try {
    const [config, latestApiKey] = await Promise.all([
      readConfig(),
      getLatestApiKeyByUserId(req.user.id)
    ]);
    if (!latestApiKey?.apiKey) {
      res.status(400).json({ error: "请先配置 API Key" });
      return;
    }

    const file = await downloadVideo({ ...config, apiKey: latestApiKey.apiKey }, req.params.taskId);
    await upsertTaskRecord({
      userId: req.user.id,
      taskId: req.params.taskId,
      status: "downloaded",
      progress: 100,
      file
    });
    res.json({ file });
  } catch (error) {
    res.status(error.status || 400).json(maskError(error));
  }
});

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json(maskError(error));
});

await ensureStorage();
await initDatabase();
app.listen(port, () => {
  console.log(`ThinkAI CH3 server listening on http://localhost:${port}`);
});

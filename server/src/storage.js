import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(__dirname, "..");
export const dataDir = path.join(serverRoot, "data");
export const configPath = path.join(dataDir, "config.json");
export const tasksPath = path.join(dataDir, "tasks.json");
export const migratedTasksPath = path.join(dataDir, "tasks.migrated.json");
export const THINKAI_BASE_URL = "https://www.thinkai.tv";

const defaultConfig = {
  baseUrl: THINKAI_BASE_URL,
  pollIntervalMs: 5000,
  pollTimeoutMs: 900000
};

export async function ensureStorage() {
  await mkdir(dataDir, { recursive: true });
}

export async function readConfig() {
  await ensureStorage();
  try {
    const raw = await readFile(configPath, "utf8");
    return { ...defaultConfig, ...JSON.parse(raw), baseUrl: THINKAI_BASE_URL };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeConfig(defaultConfig);
    return defaultConfig;
  }
}

export async function writeConfig(nextConfig) {
  await ensureStorage();
  const merged = { ...defaultConfig, ...nextConfig, baseUrl: THINKAI_BASE_URL };
  await writeFile(
    configPath,
    `${JSON.stringify({
      pollIntervalMs: merged.pollIntervalMs,
      pollTimeoutMs: merged.pollTimeoutMs
    }, null, 2)}\n`,
    "utf8"
  );
  return merged;
}

export function publicConfig(config, latestApiKey) {
  return {
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(latestApiKey),
    apiKey: latestApiKey || "",
    pollIntervalMs: config.pollIntervalMs,
    pollTimeoutMs: config.pollTimeoutMs
  };
}

function sanitizeTaskRow(row) {
  return {
    userId: String(row.user_id),
    taskId: row.task_id,
    clientTaskId: row.client_task_id || "",
    status: row.status,
    progress: Number(row.progress || 0),
    model: row.model || "",
    payload: row.payload || null,
    memory: row.memory || null,
    task: row.task || null,
    file: row.file || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function readTasks(userId) {
  const params = [];
  let whereClause = "";

  if (userId) {
    params.push(userId);
    whereClause = `WHERE user_id = $${params.length}`;
  }

  params.push(100);
  const result = await query(
    `SELECT user_id, task_id, client_task_id, status, progress, model, payload, memory, task, file, created_at, updated_at
     FROM video_tasks
     ${whereClause}
     ORDER BY updated_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(sanitizeTaskRow);
}

export async function getTaskRecord(taskId, userId) {
  const params = [taskId];
  let userClause = "";

  if (userId) {
    params.push(userId);
    userClause = `AND user_id = $${params.length}`;
  }

  const result = await query(
    `SELECT user_id, task_id, client_task_id, status, progress, model, payload, memory, task, file, created_at, updated_at
     FROM video_tasks
     WHERE task_id = $1
     ${userClause}
     LIMIT 1`,
    params
  );

  return result.rows[0] ? sanitizeTaskRow(result.rows[0]) : null;
}

export async function upsertTaskRecord(record) {
  const existing = await query(
    `SELECT user_id, task_id, client_task_id, status, progress, model, payload, memory, task, file, created_at, updated_at
     FROM video_tasks
     WHERE task_id = $1`,
    [record.taskId]
  );

  if (existing.rows[0] && String(existing.rows[0].user_id) !== String(record.userId)) {
    const error = new Error("任务不属于当前用户");
    error.status = 403;
    throw error;
  }

  const now = new Date().toISOString();
  const current = existing.rows[0] ? sanitizeTaskRow(existing.rows[0]) : { createdAt: now };
  const nextRecord = {
    ...current,
    ...record,
    userId: String(record.userId || current.userId),
    taskId: record.taskId,
    updatedAt: now
  };

  const result = await query(
    `INSERT INTO video_tasks (user_id, task_id, client_task_id, status, progress, model, payload, memory, task, file, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::timestamptz, $12::timestamptz)
     ON CONFLICT (task_id)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       client_task_id = EXCLUDED.client_task_id,
       status = EXCLUDED.status,
       progress = EXCLUDED.progress,
       model = EXCLUDED.model,
       payload = EXCLUDED.payload,
       memory = EXCLUDED.memory,
       task = EXCLUDED.task,
       file = EXCLUDED.file,
       updated_at = EXCLUDED.updated_at
     RETURNING user_id, task_id, client_task_id, status, progress, model, payload, memory, task, file, created_at, updated_at`,
    [
      nextRecord.userId,
      nextRecord.taskId,
      nextRecord.clientTaskId || null,
      nextRecord.status || "queued",
      Number(nextRecord.progress || 0),
      nextRecord.model || null,
      JSON.stringify(nextRecord.payload || null),
      JSON.stringify(nextRecord.memory || null),
      JSON.stringify(nextRecord.task || null),
      JSON.stringify(nextRecord.file || null),
      nextRecord.createdAt,
      nextRecord.updatedAt
    ]
  );

  await query(
    `DELETE FROM video_tasks
     WHERE id IN (
       SELECT id
       FROM video_tasks
       WHERE user_id = $1
       ORDER BY updated_at DESC
       OFFSET 100
     )`,
    [nextRecord.userId]
  );

  return sanitizeTaskRow(result.rows[0]);
}

export async function migrateTasksFromFile() {
  await ensureStorage();
  try {
    await access(tasksPath);
  } catch {
    return 0;
  }

  const raw = await readFile(tasksPath, "utf8");
  const tasks = JSON.parse(raw);
  const list = Array.isArray(tasks) ? tasks : [];
  let migratedCount = 0;

  for (const item of list) {
    if (!item?.taskId || !item?.userId) continue;
    await upsertTaskRecord(item);
    migratedCount += 1;
  }

  await rename(tasksPath, migratedTasksPath).catch(async (error) => {
    if (error.code === "EEXIST") {
      await writeFile(migratedTasksPath, raw, "utf8");
      await rm(tasksPath, { force: true });
      return;
    }
    throw error;
  });

  return migratedCount;
}

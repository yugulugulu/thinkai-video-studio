import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(__dirname, "..");
export const dataDir = path.join(serverRoot, "data");
export const generatedDir = path.join(serverRoot, "generated");
export const configPath = path.join(dataDir, "config.json");
export const tasksPath = path.join(dataDir, "tasks.json");
export const THINKAI_BASE_URL = "https://www.thinkai.tv";

const defaultConfig = {
  baseUrl: THINKAI_BASE_URL,
  pollIntervalMs: 5000,
  pollTimeoutMs: 900000
};

export async function ensureStorage() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(generatedDir, { recursive: true });
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

export function publicConfig(config, latestApiKey, apiKeys = []) {
  return {
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(latestApiKey),
    apiKey: latestApiKey || "",
    apiKeys,
    pollIntervalMs: config.pollIntervalMs,
    pollTimeoutMs: config.pollTimeoutMs
  };
}

export async function readTasks(userId) {
  await ensureStorage();
  try {
    const raw = await readFile(tasksPath, "utf8");
    const tasks = JSON.parse(raw);
    const list = Array.isArray(tasks) ? tasks : [];
    return userId ? list.filter((item) => String(item.userId) === String(userId)) : list;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

export async function writeTasks(tasks) {
  await ensureStorage();
  await writeFile(tasksPath, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
  return tasks;
}

export async function upsertTaskRecord(record) {
  const tasks = await readTasks();
  const now = new Date().toISOString();
  const index = tasks.findIndex((item) => item.taskId === record.taskId);
  const nextRecord = {
    ...(index >= 0 ? tasks[index] : { createdAt: now }),
    ...record,
    updatedAt: now
  };

  if (index >= 0) {
    tasks[index] = nextRecord;
  } else {
    tasks.unshift(nextRecord);
  }

  await writeTasks(tasks.slice(0, 100));
  return nextRecord;
}

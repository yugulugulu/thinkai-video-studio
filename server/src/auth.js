import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { envString } from "./env.js";
import { query } from "./db.js";

const JWT_SECRET = envString("JWT_SECRET", "thinkai-video-studio-dev-secret");
const LOGIN_FAILURE_WINDOW_MS = 60 * 1000;
const MAX_LOGIN_FAILURES_PER_WINDOW = 5;
const loginFailureBuckets = new Map();

function createLoginFailureKey(email, ip) {
  return `${String(email || "").trim().toLowerCase()}::${String(ip || "unknown")}`;
}

function getLoginFailureBucket(key) {
  const now = Date.now();
  const bucket = loginFailureBuckets.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    const freshBucket = { count: 0, expiresAt: now + LOGIN_FAILURE_WINDOW_MS };
    loginFailureBuckets.set(key, freshBucket);
    return freshBucket;
  }
  return bucket;
}

function assertLoginAllowed(key) {
  const bucket = getLoginFailureBucket(key);
  if (bucket.count >= MAX_LOGIN_FAILURES_PER_WINDOW) {
    const error = new Error("错误次数过多，一分钟后再试");
    error.status = 429;
    throw error;
  }
}

function recordLoginFailure(key) {
  const bucket = getLoginFailureBucket(key);
  bucket.count += 1;
}

function clearLoginFailures(key) {
  loginFailureBuckets.delete(key);
}

function sanitizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at
  };
}

function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

export function createVideoDownloadToken(userId, taskId) {
  return jwt.sign(
    { userId: String(userId), taskId: String(taskId), type: "video-download" },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

export function verifyVideoDownloadToken(token, taskId) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.type !== "video-download" || String(payload.taskId) !== String(taskId)) {
    const error = new Error("下载链接无效");
    error.status = 401;
    throw error;
  }
  return payload;
}

export async function registerUser({ email, password, name }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim();

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("请输入有效邮箱");
  }
  if (!normalizedName) {
    throw new Error("请输入用户名");
  }
  if (String(password || "").length < 8) {
    throw new Error("密码至少需要 8 位");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, created_at`,
      [normalizedEmail, passwordHash, normalizedName]
    );
    const user = sanitizeUser(result.rows[0]);
    return { user, token: signToken(user) };
  } catch (error) {
    if (error.code === "23505") {
      throw new Error("该邮箱已注册");
    }
    throw error;
  }
}

export async function loginUser({ email, password }, options = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const failureKey = createLoginFailureKey(normalizedEmail, options.ip);

  if (!normalizedEmail || !password) {
    throw new Error("请输入邮箱和密码");
  }

  assertLoginAllowed(failureKey);

  const result = await query(
    `SELECT id, email, name, created_at, password_hash
     FROM users
     WHERE email = $1`,
    [normalizedEmail]
  );

  if (!result.rows.length) {
    throw new Error("邮箱或密码错误");
  }

  const row = result.rows[0];
  const matched = await bcrypt.compare(password, row.password_hash);
  if (!matched) {
    recordLoginFailure(failureKey);
    throw new Error("邮箱或密码错误");
  }

  clearLoginFailures(failureKey);
  const user = sanitizeUser(row);
  return { user, token: signToken(user) };
}

export async function getUserById(id) {
  const result = await query(
    `SELECT id, email, name, created_at
     FROM users
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] ? sanitizeUser(result.rows[0]) : null;
}

export async function getApiKeyByUserId(userId) {
  const result = await query(
    `SELECT id, api_key, created_at
     FROM api_keys
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    apiKey: row.api_key,
    createdAt: row.created_at
  } : null;
}

export async function saveApiKeyForUser(userId, apiKey) {
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new Error("API Key 不能为空");
  }

  const existing = await getApiKeyByUserId(userId);
  if (existing?.apiKey === normalizedApiKey) {
    return existing;
  }

  const reused = await query(
    `SELECT id, api_key, created_at, user_id
     FROM api_keys
     WHERE api_key = $1`,
    [normalizedApiKey]
  );

  if (reused.rows.length) {
    const row = reused.rows[0];
    if (String(row.user_id) === String(userId)) {
      return {
        id: row.id,
        apiKey: row.api_key,
        createdAt: row.created_at
      };
    }
    throw new Error("该 API Key 已被其他用户使用");
  }

  const result = await query(
    `INSERT INTO api_keys (user_id, api_key)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET api_key = EXCLUDED.api_key, created_at = NOW()
     RETURNING id, api_key, created_at`,
    [userId, normalizedApiKey]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    apiKey: row.api_key,
    createdAt: row.created_at
  };
}

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    res.status(401).json({ error: "请先登录" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: "登录已失效，请重新登录" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "登录已失效，请重新登录" });
  }
}

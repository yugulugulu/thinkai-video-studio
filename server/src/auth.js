import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "thinkai-video-studio-dev-secret";

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

export async function loginUser({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail || !password) {
    throw new Error("请输入邮箱和密码");
  }

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
    throw new Error("邮箱或密码错误");
  }

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

export async function listApiKeysByUserId(userId) {
  const result = await query(
    `SELECT id, api_key, created_at
     FROM api_keys
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    apiKey: row.api_key,
    createdAt: row.created_at
  }));
}

export async function getLatestApiKeyByUserId(userId) {
  const keys = await listApiKeysByUserId(userId);
  return keys[0] || null;
}

export async function saveApiKeyForUser(userId, apiKey) {
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new Error("API Key 不能为空");
  }

  const existing = await getLatestApiKeyByUserId(userId);
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

  try {
    const result = await query(
      `INSERT INTO api_keys (user_id, api_key)
       VALUES ($1, $2)
       RETURNING id, api_key, created_at`,
      [userId, normalizedApiKey]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      apiKey: row.api_key,
      createdAt: row.created_at
    };
  } catch (error) {
    throw error;
  }
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

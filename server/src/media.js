import path from "node:path";
import { nanoid } from "nanoid";
import { query } from "./db.js";
import { envString } from "./env.js";

const ALLOWED_KINDS = new Set(["image", "video", "audio"]);

const MIME_PREFIX = {
  image: "image/",
  video: "video/",
  audio: "audio/"
};

const MAX_BYTES = {
  image: 50 * 1024 * 1024,
  video: 300 * 1024 * 1024,
  audio: 50 * 1024 * 1024
};

function decodeMultipartFilename(filename) {
  const raw = String(filename || "").trim();
  if (!raw) return "file";

  try {
    const decoded = Buffer.from(raw, "latin1").toString("utf8");
    if (!decoded || decoded.includes("\uFFFD")) {
      return raw;
    }
    if (Buffer.from(decoded, "utf8").toString("latin1") === raw) {
      return decoded;
    }
    return raw;
  } catch {
    return raw;
  }
}

function normalizeKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!ALLOWED_KINDS.has(normalized)) {
    throw new Error("仅支持 image、video、audio 三种素材类型");
  }
  return normalized;
}

export function validateUploadInput(kind, file) {
  const normalizedKind = normalizeKind(kind);
  if (!file) {
    throw new Error("请选择要上传的本地文件");
  }

  const expectedMimePrefix = MIME_PREFIX[normalizedKind];
  if (!String(file.mimetype || "").startsWith(expectedMimePrefix)) {
    throw new Error(`${normalizedKind} 素材类型不匹配，请上传正确的本地文件`);
  }

  if (Number(file.size || 0) > MAX_BYTES[normalizedKind]) {
    throw new Error(`${normalizedKind} 文件过大，当前上限 ${Math.floor(MAX_BYTES[normalizedKind] / 1024 / 1024)}MB`);
  }

  return normalizedKind;
}

export function normalizeUploadedFilename(filename) {
  return decodeMultipartFilename(filename);
}

function sanitizeFilename(filename) {
  const extension = path.extname(filename || "").toLowerCase().slice(0, 12);
  const basename = path.basename(filename || "file", extension)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "file";

  return { basename, extension: extension || "" };
}

export function buildObjectKey(userId, kind, filename) {
  const { basename, extension } = sanitizeFilename(filename);
  const date = new Date().toISOString().slice(0, 10);
  return `thinkai-video-studio/user-${userId}/${kind}/${date}/${basename}-${nanoid(10)}${extension}`;
}

export function buildGeneratedVideoObjectKey(userId, taskId, extension = ".mp4") {
  const date = new Date().toISOString().slice(0, 10);
  const safeTaskId = String(taskId || "task")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "task";

  const normalizedExtension = String(extension || ".mp4").startsWith(".")
    ? String(extension || ".mp4").slice(0, 12)
    : `.${String(extension || "mp4").slice(0, 11)}`;

  return `thinkai-video-studio/user-${userId}/generated-video/${date}/${safeTaskId}${normalizedExtension}`;
}

function sanitizeRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    filename: row.filename,
    objectKey: row.object_key,
    url: row.url,
    sizeBytes: Number(row.size_bytes || 0),
    mimeType: row.mime_type,
    createdAt: row.created_at
  };
}

export async function createMediaAsset({
  userId,
  kind,
  filename,
  objectKey,
  url,
  sizeBytes,
  mimeType
}) {
  const normalizedKind = normalizeKind(kind);
  const result = await query(
    `INSERT INTO media_assets (user_id, kind, filename, object_key, url, size_bytes, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (object_key)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       kind = EXCLUDED.kind,
       filename = EXCLUDED.filename,
       url = EXCLUDED.url,
       size_bytes = EXCLUDED.size_bytes,
       mime_type = EXCLUDED.mime_type
     RETURNING id, user_id, kind, filename, object_key, url, size_bytes, mime_type, created_at`,
    [userId, normalizedKind, filename, objectKey, url, sizeBytes, mimeType]
  );

  return sanitizeRow(result.rows[0]);
}

export async function repairMediaAssetFilenames() {
  const result = await query(
    `SELECT id, filename
     FROM media_assets
     ORDER BY id ASC`
  );

  let repaired = 0;
  for (const row of result.rows) {
    const normalized = normalizeUploadedFilename(row.filename);
    if (normalized !== row.filename) {
      await query(
        `UPDATE media_assets
         SET filename = $2
         WHERE id = $1`,
        [row.id, normalized]
      );
      repaired += 1;
    }
  }

  return repaired;
}

export async function listMediaAssetsByUserId(userId, limit = 60) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 200));
  const result = await query(
    `SELECT id, user_id, kind, filename, object_key, url, size_bytes, mime_type, created_at
     FROM media_assets
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );

  return result.rows.map(sanitizeRow);
}

export function getOssConfig() {
  return {
    region: envString("OSS_REGION", ""),
    bucket: envString("OSS_BUCKET", ""),
    accessKeyId: envString("OSS_ACCESS_KEY_ID", ""),
    accessKeySecret: envString("OSS_ACCESS_KEY_SECRET", ""),
    endpoint: envString("OSS_ENDPOINT", ""),
    publicBaseUrl: envString("OSS_PUBLIC_BASE_URL", "")
  };
}

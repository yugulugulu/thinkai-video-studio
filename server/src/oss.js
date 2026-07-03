import path from "node:path";
import OSS from "ali-oss";
import { Readable } from "node:stream";
import { envNumber, envString } from "./env.js";
import { buildGeneratedVideoObjectKey, buildObjectKey, getOssConfig } from "./media.js";

function stripProtocol(value) {
  return String(value || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function ensureOssConfig(config) {
  if (!config.region || !config.bucket || !config.accessKeyId || !config.accessKeySecret) {
    const error = new Error("OSS 未配置完成，请先在服务端环境变量中补齐 OSS_REGION、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET");
    error.status = 500;
    throw error;
  }
}

function buildPublicUrl(config, objectKey) {
  if (config.publicBaseUrl) {
    return `${String(config.publicBaseUrl).replace(/\/+$/, "")}/${objectKey}`;
  }

  if (config.endpoint) {
    return `https://${config.bucket}.${stripProtocol(config.endpoint)}/${objectKey}`;
  }

  return `https://${config.bucket}.${config.region}.aliyuncs.com/${objectKey}`;
}

export function isOssPublicReadEnabled() {
  return envString("OSS_USE_PUBLIC_URL", "false").toLowerCase() === "true";
}

export function getSignedUrlExpiresSeconds() {
  return Math.max(60, envNumber("OSS_SIGNED_URL_EXPIRES_SECONDS", 3600));
}

export function createOssClient() {
  const config = getOssConfig();
  ensureOssConfig(config);

  return new OSS({
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    ...(config.endpoint ? { endpoint: config.endpoint } : {})
  });
}

function normalizeDispositionFilename(filename) {
  return String(filename || "video.mp4").replace(/["\\\r\n]/g, "_");
}

export function buildOssObjectUrl(objectKey) {
  const config = getOssConfig();
  ensureOssConfig(config);
  return buildPublicUrl(config, objectKey);
}

export async function uploadBufferToOss({ userId, kind, file }) {
  const config = getOssConfig();
  ensureOssConfig(config);

  const client = createOssClient();
  const objectKey = buildObjectKey(userId, kind, file.originalname);
  await client.put(objectKey, file.buffer, {
    headers: {
      "Content-Type": file.mimetype,
      "Cache-Control": "public, max-age=31536000"
    }
  });

  return {
    objectKey,
    url: buildPublicUrl(config, objectKey)
  };
}

export async function uploadVideoStreamToOss({ userId, taskId, stream, mimeType = "video/mp4" }) {
  const config = getOssConfig();
  ensureOssConfig(config);

  const client = createOssClient();
  let extension = ".mp4";
  if (String(mimeType).includes("quicktime")) extension = ".mov";
  if (String(mimeType).includes("webm")) extension = ".webm";
  if (String(mimeType).includes("ogg")) extension = ".ogv";
  const objectKey = buildGeneratedVideoObjectKey(userId, taskId, extension);
  const filename = `${taskId}${extension}`;

  await client.putStream(objectKey, stream instanceof Readable ? stream : Readable.fromWeb(stream), {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "private, max-age=31536000"
    }
  });

  const head = await client.head(objectKey);
  const sizeBytes = Number(head.res.headers["content-length"] || 0);

  return {
    objectKey,
    url: buildPublicUrl(config, objectKey),
    filename,
    sizeBytes,
    mimeType
  };
}

export async function getVideoObjectAccessUrls(objectKey, options = {}) {
  const publicUrl = buildOssObjectUrl(objectKey);
  if (isOssPublicReadEnabled()) {
    return {
      previewUrl: publicUrl,
      downloadUrl: publicUrl,
      expiresAt: null,
      isSigned: false
    };
  }

  const client = createOssClient();
  const expiresSeconds = Math.max(60, Number(options.expiresSeconds || getSignedUrlExpiresSeconds()));
  const filename = normalizeDispositionFilename(options.filename || path.basename(objectKey));

  const previewUrl = client.signatureUrl(objectKey, {
    expires: expiresSeconds,
    response: {
      "content-disposition": `inline; filename="${filename}"`
    }
  });

  const downloadUrl = client.signatureUrl(objectKey, {
    expires: expiresSeconds,
    response: {
      "content-disposition": `attachment; filename="${filename}"`
    }
  });

  return {
    previewUrl,
    downloadUrl,
    expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString(),
    isSigned: true
  };
}

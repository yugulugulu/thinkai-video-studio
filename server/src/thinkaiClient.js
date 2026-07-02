import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import { generatedDir } from "./storage.js";

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message = body?.error?.message || body?.message || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

export function buildReferences({ images = [], videos = [], audios = [] }) {
  const references = {};
  if (images.length === 1) references.image = images[0];
  if (images.length > 1) references.images = images;
  if (videos.length === 1) references.video = videos[0];
  if (videos.length > 1) references.videos = videos;
  if (audios.length === 1) references.audio = audios[0];
  if (audios.length > 1) references.audios = audios;
  return Object.keys(references).length ? references : undefined;
}

export async function createVideoTask(config, payload) {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/v1/videos`, {
    method: "POST",
    headers: headers(config.apiKey),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300000)
  });
  return parseJsonResponse(response);
}

export async function getVideoTask(config, taskId) {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/v1/videos/${taskId}`, {
    headers: headers(config.apiKey),
    signal: AbortSignal.timeout(60000)
  });
  return parseJsonResponse(response);
}

export async function downloadVideo(config, taskId) {
  await mkdir(generatedDir, { recursive: true });
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/v1/videos/${taskId}/content`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`
    },
    signal: AbortSignal.timeout(300000)
  });

  if (!response.ok || !response.body) {
    const body = await response.text();
    const error = new Error(body || response.statusText);
    error.status = response.status;
    throw error;
  }

  const filename = `${taskId}-${nanoid(8)}.mp4`;
  const outputPath = path.join(generatedDir, filename);
  await pipeline(response.body, createWriteStream(outputPath));
  return { filename, outputPath, url: `/videos/${filename}` };
}

import { getModel } from "./models.js";

const HTTPS_URL = /^https:\/\/.+/i;
const CLIENT_TASK_ID = /^[A-Za-z0-9_.-]{1,128}$/;

function cleanUrlList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function assertPublicHttps(urls, label) {
  for (const url of urls) {
    if (!HTTPS_URL.test(url)) {
      throw new Error(`${label} 必须是公网 HTTPS URL: ${url}`);
    }
  }
}

export function validateCreatePayload(body) {
  const model = getModel(body.model);
  if (!model) throw new Error("请选择有效的视频模型");

  const prompt = String(body.prompt || "")
    .trim()
    .replace(/@参考图(\d+)/g, "@图片$1");
  if (!prompt) throw new Error("请输入提示词");
  if (prompt.length < (model.promptMinLength || 1)) {
    throw new Error(`${model.id} 提示词最少 ${model.promptMinLength} 字符`);
  }
  if (prompt.length > (model.promptMaxLength || 4000)) {
    throw new Error(`${model.id} 提示词最长 ${model.promptMaxLength || 4000} 字符`);
  }

  const aspectRatio = body.aspect_ratio || "16:9";
  const aspectRatios = model.aspectRatios || ["16:9", "9:16"];
  if (!aspectRatios.includes(aspectRatio)) {
    throw new Error(`${model.id} 画幅仅支持 ${aspectRatios.join(" / ")}`);
  }

  const duration = Number(body.duration || model.defaultDuration || 10);
  const durationIsValid = model.allowedDurations
    ? model.allowedDurations.includes(duration)
    : Number.isFinite(duration) && duration >= (model.minDuration || 4) && duration <= (model.maxDuration || 15);
  if (!Number.isFinite(duration) || !durationIsValid) {
    const durationLabel = model.allowedDurations?.join(" / ") || `${model.minDuration || 4}-${model.maxDuration || 15}`;
    throw new Error(`${model.id} 时长仅支持 ${durationLabel} 秒`);
  }

  const resolution = body.resolution || model.resolutions[0];
  if (!model.resolutions.includes(resolution)) {
    throw new Error(`${model.id} 仅支持 ${model.resolutions.join(" / ")}`);
  }

  const images = cleanUrlList(body.images);
  const videos = cleanUrlList(body.videos);
  const audios = cleanUrlList(body.audios);
  assertPublicHttps(images, "参考图片");
  assertPublicHttps(videos, "参考视频");
  assertPublicHttps(audios, "参考音频");

  if (images.length > 9) throw new Error("参考图片最多 9 张");
  if (videos.length > 3) throw new Error("参考视频最多 3 条");
  if (audios.length > 3) throw new Error("参考音频最多 3 条");
  if (images.length + videos.length + audios.length > (model.maxReferences || 15)) {
    throw new Error(`${model.id} 参考素材总数最多 ${model.maxReferences || 15} 个`);
  }
  if (videos.length && !model.supportsVideoReference) {
    throw new Error(`${model.id} 不支持参考视频`);
  }
  if (model.requiresReference && images.length === 0) {
    throw new Error(`${model.id} 不支持纯文本生视频，至少需要 1 张参考图片 URL`);
  }

  const clientTaskId = String(body.client_task_id || "").trim();
  if (clientTaskId && !CLIENT_TASK_ID.test(clientTaskId)) {
    throw new Error("client_task_id 最多 128 字符，且只能包含字母、数字、下划线、短横线和点");
  }

  return {
    model,
    prompt,
    aspectRatio,
    duration,
    resolution,
    images,
    videos,
    audios,
    clientTaskId
  };
}

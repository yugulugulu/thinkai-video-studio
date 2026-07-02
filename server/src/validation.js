import { getModel } from "./models.js";

const HTTPS_URL = /^https:\/\/.+/i;

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
  if (!model) throw new Error("请选择有效的 CH3 模型");

  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new Error("请输入提示词");
  if (prompt.length > 6000) throw new Error("提示词最长 6000 字符");

  const aspectRatio = body.aspect_ratio || "16:9";
  if (!["16:9", "9:16"].includes(aspectRatio)) throw new Error("画幅只支持 16:9 或 9:16");

  const duration = Number(body.duration || 10);
  if (!Number.isFinite(duration) || duration < 4 || duration > 15) {
    throw new Error("视频时长必须在 4-15 秒之间");
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
  if (videos.length && !model.supportsVideoReference) {
    throw new Error(`${model.id} 不支持参考视频`);
  }
  if (model.requiresReference && images.length === 0) {
    throw new Error(`${model.id} 不支持纯文本生视频，至少需要 1 张参考图片 URL`);
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
    clientTaskId: String(body.client_task_id || "").trim()
  };
}

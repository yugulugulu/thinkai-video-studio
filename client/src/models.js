export const CH3_MODELS = [
  {
    id: "ch3-sd-2.0-xh",
    name: "SD2 XH",
    priceLabel: "单次11元",
    description: "XH 质量优先，支持纯文本和多素材参考",
    tooltipTitle: "SD2-9图-满血-XH，质量优先",
    tooltipBody: "720p 版本，支持纯文本生视频，也支持图片、视频、音频混合参考。适合大多数正式生成场景，质量和灵活性比较均衡。",
    resolutions: ["720p"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true
  },
  {
    id: "ch3-sd-2.0-xh-1080p",
    name: "SD2 XH 1080p",
    priceLabel: "单次22元",
    description: "XH 高清版本，支持纯文本和多素材参考",
    tooltipTitle: "SD2-9图-满血-XH，1080p 输出",
    tooltipBody: "支持纯文本和多素材参考，分辨率提升到 1080p。适合对清晰度要求更高的成片，生成耗时通常也会更长。",
    resolutions: ["1080p"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true
  },
  {
    id: "ch3-sd-2.0-xh-4k",
    name: "SD2 XH 4K",
    priceLabel: "单次42元",
    description: "XH 4K 版本，支持纯文本和多素材参考",
    tooltipTitle: "SD2-9图-满血-XH，4K 输出",
    tooltipBody: "支持纯文本和多素材参考，输出 4K。适合高分辨率成片和后续剪辑需求，耗时和资源消耗都会更高。",
    resolutions: ["4k"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true
  }
];

export const ENABLED_MODEL_IDS = new Set(CH3_MODELS.map((model) => model.id));
const MODEL_META_MAP = new Map(CH3_MODELS.map((model) => [model.id, model]));

export function filterEnabledModels(models) {
  return (models || [])
    .filter((model) => ENABLED_MODEL_IDS.has(model.id))
    .map((model) => ({
      ...model,
      ...MODEL_META_MAP.get(model.id)
    }));
}

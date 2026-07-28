const CH3_RULES = {
  group: "ch3",
  promptMinLength: 1,
  promptMaxLength: 4000,
  minDuration: 4,
  maxDuration: 15,
  defaultDuration: 10,
  maxReferences: 15
};

const CH1_RULES = {
  group: "ch1",
  aspectRatios: ["16:9", "9:16", "1:1", "3:4", "4:3", "21:9"],
  promptMinLength: 1,
  promptMaxLength: 5000,
  minDuration: 4,
  maxDuration: 15,
  defaultDuration: 10,
  maxReferences: 15,
  textToVideo: true,
  requiresReference: false,
  supportsVideoReference: true
};

export const VIDEO_MODELS = [
  {
    id: "ch1-sd-2.0-720p",
    name: "SD2 720p",
    priceLabel: "单次9.35元",
    description: "CH1 SD2 满血版，支持纯文本和多素材参考",
    tooltipTitle: "CH1 SD2 满血版，720p 输出",
    tooltipBody: "支持纯文本生成，以及最多 9 张图片、3 条视频和 3 条音频参考。适合常规清晰度的视频生成。",
    resolutions: ["720p"],
    ...CH1_RULES
  },
  {
    id: "ch1-sd-2.0-1080p",
    name: "SD2 1080p",
    priceLabel: "单次23.375元",
    description: "CH1 SD2 满血高清版，支持纯文本和多素材参考",
    tooltipTitle: "CH1 SD2 满血版，1080p 输出",
    tooltipBody: "支持纯文本生成，以及最多 9 张图片、3 条视频和 3 条音频参考。适合对成片清晰度要求更高的场景。",
    resolutions: ["1080p"],
    ...CH1_RULES
  },
  {
    id: "ch0102-sd-2.0-1080p",
    name: "SD2 1080p 0102",
    priceLabel: "单次23.375元",
    description: "CH1 SD2 0102 1080p 通用视频生成模型",
    tooltipTitle: "CH1 SD2 0102，1080p 输出",
    tooltipBody: "支持纯文本，以及最多 9 张图片、3 条视频和 3 条音频参考。图片、视频和音频参考总数最多 12 个，输出 1080p，时长支持 4-15 秒。",
    resolutions: ["1080p"],
    ...CH1_RULES,
    aspectRatios: ["16:9", "9:16", "1:1", "3:4", "4:3", "21:9"],
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 10,
    maxReferences: 12
  },
  {
    id: "ch1-sd-2.0-4k",
    name: "SD2 4K",
    priceLabel: "单次42.5元",
    description: "CH1 SD2 满血 4K 版，支持纯文本和多素材参考",
    tooltipTitle: "CH1 SD2 满血版，4K 输出",
    tooltipBody: "支持纯文本生成，以及最多 9 张图片、3 条视频和 3 条音频参考。适合高分辨率成片和后续剪辑。",
    resolutions: ["4k"],
    ...CH1_RULES
  },
  {
    id: "ch3-sd-2.0-fast",
    name: "SD2 Fast",
    description: "速度优先的参考素材生成模型",
    tooltipTitle: "SD2-9图-Fast，速度优先",
    tooltipBody: "适合先快速试风格、试动作和试镜头。仅支持 720p，不支持纯文本生视频，至少需要上传 1 张参考图片。",
    resolutions: ["720p"],
    textToVideo: false,
    requiresReference: true,
    supportsVideoReference: false,
    ...CH3_RULES
  },
  {
    id: "ch3-sd-2.0",
    name: "SD2 Quality",
    description: "质量优先的参考素材生成模型",
    tooltipTitle: "SD2-9图-满血，质量优先",
    tooltipBody: "适合对主体细节、风格稳定性要求更高的场景。仅支持 720p，不支持纯文本生视频，至少需要上传 1 张参考图片。",
    resolutions: ["720p"],
    textToVideo: false,
    requiresReference: true,
    supportsVideoReference: false,
    ...CH3_RULES
  },
  {
    id: "ch3-sd-2.0-xh",
    name: "SD2 XH",
    description: "XH 质量优先，支持纯文本和多素材参考",
    tooltipTitle: "SD2-9图-满血-XH，质量优先",
    tooltipBody: "720p 版本，支持纯文本生视频，也支持图片、视频、音频混合参考。适合大多数正式生成场景，质量和灵活性比较均衡。",
    resolutions: ["720p"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true,
    ...CH3_RULES
  },
  {
    id: "ch3-sd-2.0-xh-1080p",
    name: "SD2 XH 1080p",
    description: "XH 高清版本，支持纯文本和多素材参考",
    tooltipTitle: "SD2-9图-满血-XH，1080p 输出",
    tooltipBody: "支持纯文本和多素材参考，分辨率提升到 1080p。适合对清晰度要求更高的成片，生成耗时通常也会更长。",
    resolutions: ["1080p"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true,
    ...CH3_RULES
  },
  {
    id: "ch3-sd-2.0-xh-4k",
    name: "SD2 XH 4K",
    description: "XH 4K 版本，支持纯文本和多素材参考",
    tooltipTitle: "SD2-9图-满血-XH，4K 输出",
    tooltipBody: "支持纯文本和多素材参考，输出 4K。适合高分辨率成片和后续剪辑需求，耗时和资源消耗都会更高。",
    resolutions: ["4k"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true,
    ...CH3_RULES
  },
  {
    id: "ch3-sd-2.0-fast-xh",
    name: "SD2 Fast XH",
    description: "速度优先的 XH 参考素材生成模型",
    tooltipTitle: "SD2-9图-Fast-XH，速度优先",
    tooltipBody: "更偏向快速出结果的 XH 变体。仅支持 720p，不支持纯文本生视频，至少需要上传 1 张参考图片，适合快速迭代参考素材方案。",
    resolutions: ["720p"],
    textToVideo: false,
    requiresReference: true,
    supportsVideoReference: false,
    ...CH3_RULES
  },
  {
    id: "ch9-sd-2.0-ck2-720p",
    group: "ch9",
    name: "SD2 CK2 720p",
    priceLabel: "单次9.35元",
    description: "CH9 CK2 通用视频生成模型",
    tooltipTitle: "CH9 SD2 CK2，通用多素材生成",
    tooltipBody: "支持纯文本，以及图片、视频、音频混合参考。输出 720p，时长支持 10-15 秒。",
    resolutions: ["720p"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true,
    promptMinLength: 10,
    promptMaxLength: 5000,
    minDuration: 10,
    maxDuration: 15,
    defaultDuration: 10,
    maxReferences: 12
  },
  {
    id: "ch0904-sd-2.0-720p",
    group: "ch9",
    name: "SD2 720p",
    priceLabel: "单次9.35元",
    description: "CH9 SD2 720p 通用视频生成模型",
    tooltipTitle: "CH9 SD2 720p，多素材生成",
    tooltipBody: "支持纯文本，以及最多 9 张图片、3 条视频和 3 条音频参考。图片、视频和音频参考总数最多 12 个，输出 720p，时长支持 5-15 秒。",
    aspectRatios: ["16:9", "9:16"],
    resolutions: ["720p"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true,
    promptMinLength: 10,
    promptMaxLength: 5000,
    minDuration: 5,
    maxDuration: 15,
    defaultDuration: 10,
    maxReferences: 12
  }
];

export function getModel(modelId) {
  return VIDEO_MODELS.find((model) => model.id === modelId);
}

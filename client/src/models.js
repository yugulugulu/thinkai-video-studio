export const CH3_MODELS = [
  {
    id: "ch3-sd-2.0-fast",
    name: "SD2 Fast",
    description: "速度优先的参考素材生成模型",
    tooltipTitle: "SD2-9图-Fast，速度优先",
    tooltipBody: "适合先快速试风格、试动作和试镜头。仅支持 720p，不支持纯文本生视频，至少需要上传 1 张参考图片。",
    resolutions: ["720p"],
    textToVideo: false,
    requiresReference: true,
    supportsVideoReference: false
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
    supportsVideoReference: false
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
    supportsVideoReference: true
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
    supportsVideoReference: true
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
    supportsVideoReference: true
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
    supportsVideoReference: false
  }
];

export const CH3_MODELS = [
  {
    id: "ch3-sd-2.0-fast",
    name: "SD2 Fast",
    description: "速度优先的参考素材生成模型",
    resolutions: ["720p"],
    textToVideo: false,
    requiresReference: true,
    supportsVideoReference: false
  },
  {
    id: "ch3-sd-2.0",
    name: "SD2 Quality",
    description: "质量优先的参考素材生成模型",
    resolutions: ["720p"],
    textToVideo: false,
    requiresReference: true,
    supportsVideoReference: false
  },
  {
    id: "ch3-sd-2.0-xh",
    name: "SD2 XH",
    description: "XH 质量优先，支持纯文本和多素材参考",
    resolutions: ["720p"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true
  },
  {
    id: "ch3-sd-2.0-xh-1080p",
    name: "SD2 XH 1080p",
    description: "XH 高清版本，支持纯文本和多素材参考",
    resolutions: ["1080p"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true
  },
  {
    id: "ch3-sd-2.0-xh-4k",
    name: "SD2 XH 4K",
    description: "XH 4K 版本，支持纯文本和多素材参考",
    resolutions: ["4k"],
    textToVideo: true,
    requiresReference: false,
    supportsVideoReference: true
  },
  {
    id: "ch3-sd-2.0-fast-xh",
    name: "SD2 Fast XH",
    description: "速度优先的 XH 参考素材生成模型",
    resolutions: ["720p"],
    textToVideo: false,
    requiresReference: true,
    supportsVideoReference: false
  }
];

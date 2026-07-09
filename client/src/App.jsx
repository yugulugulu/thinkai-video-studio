import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { CH3_MODELS, filterEnabledModels } from "./models.js";
import weblogo from "./weblogo.png";

const defaultForm = {
  model: "ch3-sd-2.0-xh",
  prompt: "一位穿浅色风衣的年轻女性在雨后的城市街道自然向前走，镜头缓慢推进，路面有柔和倒影，电影感，动作自然稳定",
  aspect_ratio: "16:9",
  duration: 8,
  resolution: "720p",
  images: [],
  videos: [],
  audios: [],
  client_task_id: ""
};

const defaultAuthForm = {
  name: "",
  email: "",
  password: ""
};

const PROMPT_MAX_LENGTH = 6000;
const IMAGE_MAX_COUNT = 9;
const VIDEO_MAX_COUNT = 3;
const AUDIO_MAX_COUNT = 3;
const MIN_DURATION = 4;
const MAX_DURATION = 15;
const ACTIVE_TASK_STORAGE_KEY_PREFIX = "thinkai_video_studio_active_task_id";
const POLL_ERROR_RETRY_LIMIT = 6;

const FIELD_CONFIG = {
  image: {
    field: "images",
    referenceLabel: "参考图",
    label: "参考图片",
    uploadLabel: "上传图片",
    accept: "image/*",
    maxCount: IMAGE_MAX_COUNT,
    emptyHint: "支持 JPG、PNG、WEBP 等图片文件，最多 9 张。",
    requiredHint: "当前模型不支持纯文本，至少要上传或选择 1 张参考图片。",
    optionalHint: "XH 系列可留空做纯文本生成，也可以上传图片增强稳定性和风格一致性。"
  },
  video: {
    field: "videos",
    referenceLabel: "参考视频",
    label: "参考视频",
    uploadLabel: "上传视频",
    accept: "video/*",
    maxCount: VIDEO_MAX_COUNT,
    emptyHint: "仅 XH / XH 1080p / XH 4K 支持，最多 3 条。",
    optionalHint: "可选。建议上传短视频片段作为运动参考。"
  },
  audio: {
    field: "audios",
    referenceLabel: "音频",
    label: "参考音频",
    uploadLabel: "上传音频",
    accept: "audio/*",
    maxCount: AUDIO_MAX_COUNT,
    emptyHint: "可选，最多 3 条。",
    optionalHint: "可选。适合语音、环境声或节奏参考。"
  }
};

function Icon({ name, size = 18, className = "" }) {
  return <span className={`icon ${className}`} style={{ "--icon-size": `${size}px` }}>{name}</span>;
}

function statusText(status) {
  const map = {
    queued: "排队中",
    running: "生成中",
    processing: "处理中",
    completed: "已完成",
    downloaded: "已下载",
    failed: "失败"
  };
  return map[status] || status || "待提交";
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function dedupeAssets(items) {
  const map = new Map();
  for (const item of items) {
    if (item?.id) {
      map.set(String(item.id), item);
    } else if (item?.url) {
      map.set(item.url, item);
    }
  }
  return Array.from(map.values());
}

function mergeAssets(current, next) {
  return dedupeAssets([...next, ...current]).sort((a, b) => {
    const left = new Date(b.createdAt || 0).getTime();
    const right = new Date(a.createdAt || 0).getTime();
    return left - right;
  });
}

function isPollingStatus(status) {
  return ["queued", "running", "processing"].includes(status);
}

function canPreviewStatus(status) {
  return ["completed", "downloaded"].includes(status);
}

function toAbsoluteUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${api.base}${url}`;
}

function isVideoAccessExpired(file) {
  if (!file?.isSigned || !file?.expiresAt) return false;
  const expiresAt = new Date(file.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now() + 60 * 1000;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAssetKey(asset) {
  return String(asset?.id || asset?.url || "");
}

function getReferenceLabel(kind, index) {
  return `${FIELD_CONFIG[kind].referenceLabel}${index}`;
}

function getReferenceToken(kind, index) {
  return `@${getReferenceLabel(kind, index)}`;
}

function createReferenceBindings(formValue) {
  return ["image", "video", "audio"].flatMap((kind) => {
    const fieldName = FIELD_CONFIG[kind].field;
    return formValue[fieldName].map((asset, index) => ({
      kind,
      asset,
      index: index + 1,
      label: getReferenceLabel(kind, index + 1),
      token: getReferenceToken(kind, index + 1)
    }));
  });
}

function cloneMemoryAsset(asset, kind) {
  return {
    id: asset?.id || null,
    kind,
    filename: asset?.filename || asset?.url || `${kind} reference`,
    url: asset?.url || "",
    sizeBytes: Number(asset?.sizeBytes || 0),
    mimeType: asset?.mimeType || "",
    createdAt: asset?.createdAt || null
  };
}

function buildTaskMemory(formValue, submittedPrompt) {
  return {
    editorPrompt: formValue.prompt,
    submittedPrompt,
    model: formValue.model,
    aspect_ratio: formValue.aspect_ratio,
    duration: Number(formValue.duration),
    resolution: formValue.resolution,
    references: {
      images: formValue.images.map((asset) => cloneMemoryAsset(asset, "image")),
      videos: formValue.videos.map((asset) => cloneMemoryAsset(asset, "video")),
      audios: formValue.audios.map((asset) => cloneMemoryAsset(asset, "audio"))
    }
  };
}

function assetsFromPayloadUrls(urls, kind) {
  if (!Array.isArray(urls)) return [];
  return urls.filter(Boolean).map((url, index) => ({
    id: null,
    kind,
    filename: `${FIELD_CONFIG[kind].referenceLabel}${index + 1}`,
    url,
    sizeBytes: 0,
    mimeType: "",
    createdAt: null
  }));
}

function getReusableTaskMemory(record) {
  if (record?.memory) return record.memory;

  const payload = record?.payload || {};
  const references = payload.references || {};
  const images = references.images || (references.image ? [references.image] : payload.images || []);
  const videos = references.videos || (references.video ? [references.video] : payload.videos || []);
  const audios = references.audios || (references.audio ? [references.audio] : payload.audios || []);

  return {
    editorPrompt: payload.prompt || "",
    submittedPrompt: payload.prompt || "",
    model: payload.model || record?.model || defaultForm.model,
    aspect_ratio: payload.aspect_ratio || defaultForm.aspect_ratio,
    duration: Number(payload.duration || defaultForm.duration),
    resolution: payload.resolution || defaultForm.resolution,
    references: {
      images: assetsFromPayloadUrls(images, "image"),
      videos: assetsFromPayloadUrls(videos, "video"),
      audios: assetsFromPayloadUrls(audios, "audio")
    }
  };
}

function countMemoryReferences(memory) {
  return ["images", "videos", "audios"].reduce((count, key) => (
    count + (Array.isArray(memory?.references?.[key]) ? memory.references[key].length : 0)
  ), 0);
}

function buildPromptWithReferenceTokens(formValue) {
  return createReferenceBindings(formValue).reduce((prompt, binding) => (
    prompt.replace(new RegExp(escapeRegExp(binding.token), "g"), `[${binding.label}]`)
  ), formValue.prompt.trim());
}

function insertTextAtSelection(source, insertion, selection) {
  const start = Number.isInteger(selection?.start) ? selection.start : source.length;
  const end = Number.isInteger(selection?.end) ? selection.end : start;
  const needsLeadingSpace = start > 0 && !/\s/.test(source[start - 1]);
  const needsTrailingSpace = end < source.length && !/\s/.test(source[end]);
  const text = `${needsLeadingSpace ? " " : ""}${insertion}${needsTrailingSpace ? " " : ""}`;
  return {
    value: `${source.slice(0, start)}${text}${source.slice(end)}`,
    caret: start + text.length
  };
}

function getActiveMention(value, caret) {
  const beforeCaret = value.slice(0, caret);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0) return null;

  const query = beforeCaret.slice(atIndex + 1);
  if (/\s/.test(query)) return null;

  return {
    query,
    range: {
      start: atIndex,
      end: caret
    }
  };
}

function ReferencePanel({
  config,
  kind,
  selected,
  library,
  disabled,
  invalid,
  loading,
  modelWarning,
  onUpload,
  onAdd,
  onMention,
  onRemove
}) {
  const showImagePreview = config.field === "images";
  const [libraryOpen, setLibraryOpen] = useState(false);
  const title = `${config.label}最近上传`;

  return (
    <>
      <section className={`asset-panel ${invalid ? "invalid" : ""}`}>
        <span className="field-top">
          <span>{config.label}</span>
          <span className={`counter ${invalid ? "invalid" : ""}`}>{selected.length}/{config.maxCount}</span>
        </span>

        <div className="asset-tool-row">
          <label className={`asset-tool-button upload-action ${disabled || loading ? "disabled" : ""}`}>
            <input
              type="file"
              multiple
              accept={config.accept}
              disabled={disabled || loading}
              onChange={(event) => {
                onUpload(event.target.files);
                event.target.value = "";
              }}
            />
            <span>{loading ? "上传中..." : config.uploadLabel}</span>
            <small>{config.emptyHint}</small>
          </label>
          <button
            type="button"
            className={`asset-tool-button recent-action ${libraryOpen ? "active" : ""}`}
            onClick={() => setLibraryOpen(true)}
          >
            <span>最近上传</span>
            <small>{library.length} 个素材</small>
          </button>
        </div>

        <span className="field-hint">
          {modelWarning || config.optionalHint}
        </span>

        <div className="asset-group">
          <div className="asset-group-head">
            <strong>当前任务已选</strong>
            <span>{selected.length}</span>
          </div>
          {selected.length === 0 ? (
            <p className="empty-history">还没有选择素材。</p>
          ) : (
            <div className="asset-list">
              {selected.map((asset, index) => (
                <div className="asset-item" key={`selected-${asset.id || asset.url}`}>
                  <div className="asset-meta">
                    <strong>
                      <span className="reference-token">{getReferenceToken(kind, index + 1)}</span>
                      {asset.filename}
                    </strong>
                    <small>{formatBytes(asset.sizeBytes)} · {formatTime(asset.createdAt)}</small>
                  </div>
                  <div className="asset-actions">
                    <button
                      type="button"
                      className="mini-button mention-button"
                      onClick={(event) => {
                        event.preventDefault();
                        onMention(asset);
                      }}
                    >
                      @
                    </button>
                    <button
                      type="button"
                      className="mini-button"
                      onClick={(event) => {
                        event.preventDefault();
                        onRemove(asset);
                      }}
                    >
                      移除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {libraryOpen && (
        <div className="asset-library-backdrop" onClick={() => setLibraryOpen(false)}>
          <section className="asset-library-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="asset-library-head">
              <div>
                <p className="eyebrow"><Icon name="▦" size={14} /> Library</p>
                <h2>{title}</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setLibraryOpen(false)} aria-label="关闭">
                <Icon name="×" size={18} />
              </button>
            </div>
            <p className="asset-library-summary">{library.length} 个素材 · 选择素材后会加入当前任务</p>
            {library.length === 0 ? (
              <p className="empty-history">还没有上传过这类素材。</p>
            ) : (
              <div className={`asset-library-grid ${showImagePreview ? "image-grid" : ""}`}>
                {library.map((asset) => {
                  const active = selected.some((item) => String(item.id) === String(asset.id));
                  return (
                    <div className="asset-library-card" key={`library-${asset.id}`}>
                      {showImagePreview && asset.url ? (
                        <div className="asset-library-thumb">
                          <img src={asset.url} alt={asset.filename} loading="lazy" />
                        </div>
                      ) : (
                        <div className="asset-library-kind">
                          <Icon name={kind === "video" ? "▶" : "♪"} size={22} />
                        </div>
                      )}
                      <div className="asset-meta">
                        <strong>{asset.filename}</strong>
                        <small>{formatBytes(asset.sizeBytes)} · {formatTime(asset.createdAt)}</small>
                      </div>
                      <div className="asset-actions">
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() => {
                            onAdd(asset);
                            setLibraryOpen(false);
                          }}
                          disabled={disabled || active}
                        >
                          {active ? "已使用" : "加入"}
                        </button>
                        <button
                          type="button"
                          className="mini-button mention-button"
                          onClick={() => {
                            onMention(asset);
                            setLibraryOpen(false);
                          }}
                          disabled={disabled}
                        >
                          @
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function ModelTooltip({ model }) {
  if (!model) return null;

  return (
    <div className="model-tooltip" role="tooltip">
      <strong>{model.tooltipTitle || model.description}</strong>
      <p>{model.tooltipBody || model.description}</p>
      <div className="model-tooltip-meta">
        <span>{model.resolutions?.join(" / ") || "-"}</span>
        <span>{model.textToVideo ? "支持纯文本" : "需参考图片"}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [models, setModels] = useState(CH3_MODELS);
  const [config, setConfig] = useState({ baseUrl: "https://www.thinkai.tv", apiKey: "", hasApiKey: false });
  const [configOpen, setConfigOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(defaultAuthForm);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [task, setTask] = useState(null);
  const [submittedPayload, setSubmittedPayload] = useState(null);
  const [submittedMemory, setSubmittedMemory] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [message, setMessage] = useState("");
  const [taskHistory, setTaskHistory] = useState([]);
  const [assets, setAssets] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState({ image: false, video: false, audio: false });
  const [mentionMenu, setMentionMenu] = useState({ open: false, query: "", range: null });
  const pollRefs = useRef(new Map());
  const pollErrorCountsRef = useRef(new Map());
  const videoAccessRef = useRef({ taskId: "", file: null });
  const activeUserIdRef = useRef("");
  const promptInputRef = useRef(null);
  const lastPromptSelectionRef = useRef(null);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === form.model) || models[0],
    [models, form.model]
  );
  const promptLength = form.prompt.length;
  const promptForSubmit = useMemo(() => buildPromptWithReferenceTokens(form), [form]);
  const referenceBindings = useMemo(() => createReferenceBindings(form), [form]);
  const promptForSubmitTooLong = promptForSubmit.length > PROMPT_MAX_LENGTH;
  const durationNumber = Number(form.duration);
  const durationInvalid = !Number.isFinite(durationNumber) || durationNumber < MIN_DURATION || durationNumber > MAX_DURATION;
  const promptTooLong = promptLength > PROMPT_MAX_LENGTH;
  const referencesMissing = Boolean(selectedModel?.requiresReference && form.images.length === 0);
  const referencesOverLimit =
    form.images.length > IMAGE_MAX_COUNT ||
    form.videos.length > VIDEO_MAX_COUNT ||
    form.audios.length > AUDIO_MAX_COUNT;
  const unsupportedVideoReference = Boolean(form.videos.length && selectedModel && !selectedModel.supportsVideoReference);
  const isGenerating = busy || isPollingStatus(task?.status);
  const canSubmit =
    Boolean(form.prompt.trim()) &&
    !busy &&
    !promptTooLong &&
    !promptForSubmitTooLong &&
    !durationInvalid &&
    !referencesMissing &&
    !referencesOverLimit &&
    !unsupportedVideoReference &&
    !uploading.image &&
    !uploading.video &&
    !uploading.audio;
  const canSubmitAuth = authMode === "register"
    ? Boolean(authForm.name.trim() && authForm.email.trim() && authForm.password.length >= 8)
    : Boolean(authForm.email.trim() && authForm.password);

  const libraryByKind = useMemo(() => ({
    image: assets.filter((item) => item.kind === "image"),
    video: assets.filter((item) => item.kind === "video"),
    audio: assets.filter((item) => item.kind === "audio")
  }), [assets]);

  const mentionOptions = useMemo(() => {
    const query = mentionMenu.query.trim().toLowerCase();
    return ["image", "video", "audio"].flatMap((kind) => {
      const fieldName = FIELD_CONFIG[kind].field;
      return form[fieldName].map((asset, index) => ({
        kind,
        asset,
        token: getReferenceToken(kind, index + 1)
      }));
    })
      .filter(({ asset, token }) => {
        const filename = String(asset.filename || "").toLowerCase();
        return !query || filename.includes(query) || token.toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [form.images, form.videos, form.audios, mentionMenu.query]);

  useEffect(() => {
    if (!selectedModel) return;
    setForm((current) => {
      const next = { ...current };
      if (!selectedModel.resolutions.includes(current.resolution)) {
        next.resolution = selectedModel.resolutions[0];
      }
      if (!selectedModel.supportsVideoReference && current.videos.length) {
        next.videos = [];
      }
      return next;
    });
  }, [selectedModel]);

  useEffect(() => {
    return () => {
      stopPolling("", false);
    };
  }, []);

  function getActiveTaskStorageKey(userId = currentUser?.id) {
    return userId ? `${ACTIVE_TASK_STORAGE_KEY_PREFIX}:${userId}` : ACTIVE_TASK_STORAGE_KEY_PREFIX;
  }

  function clearTaskViewState() {
    setTask(null);
    setSubmittedPayload(null);
    setSubmittedMemory(null);
    setVideoFile(null);
    setTaskHistory([]);
    setAssets([]);
    videoAccessRef.current = { taskId: "", file: null };
  }

  function getActiveTaskIds(userId = currentUser?.id) {
    const storageKey = getActiveTaskStorageKey(userId);
    const raw = window.localStorage.getItem(storageKey) || "";
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return raw ? [raw] : [];
    }
  }

  function setActiveTaskIds(taskIds, userId = currentUser?.id) {
    const storageKey = getActiveTaskStorageKey(userId);
    const uniqueTaskIds = Array.from(new Set((taskIds || []).filter(Boolean)));
    if (uniqueTaskIds.length) {
      window.localStorage.setItem(storageKey, JSON.stringify(uniqueTaskIds));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  }

  function addActiveTaskId(taskId) {
    if (!taskId) return;
    setActiveTaskIds([...getActiveTaskIds(), taskId]);
  }

  function removeActiveTaskId(taskId) {
    if (!taskId) return;
    setActiveTaskIds(getActiveTaskIds().filter((item) => item !== taskId));
  }

  function stopPolling(taskId = "", clearActiveTask = true) {
    if (taskId) {
      const pollRef = pollRefs.current.get(taskId);
      if (pollRef) window.clearInterval(pollRef);
      pollRefs.current.delete(taskId);
      pollErrorCountsRef.current.delete(taskId);
      if (clearActiveTask) removeActiveTaskId(taskId);
      return;
    }

    for (const pollRef of pollRefs.current.values()) {
      window.clearInterval(pollRef);
    }
    pollRefs.current.clear();
    pollErrorCountsRef.current.clear();
    if (clearActiveTask) {
      setActiveTaskIds([]);
    }
  }

  function isCurrentUserRequest(userId) {
    return !userId || activeUserIdRef.current === String(userId);
  }

  async function loadAppData(userId = currentUser?.id) {
    const [modelResult, configResult, taskResult, uploadResult] = await Promise.allSettled([
      api.models(),
      api.config(),
      api.tasks(),
      api.uploads()
    ]);

    if (!isCurrentUserRequest(userId)) return;

    if (modelResult.status === "fulfilled") {
      setModels(filterEnabledModels(modelResult.value.models));
    }

    if (configResult.status === "fulfilled") {
      setConfig((current) => ({ ...current, ...configResult.value }));
    } else {
      setMessage(`后端连接失败：${configResult.reason.message}`);
    }

    if (taskResult.status === "fulfilled") {
      setTaskHistory(taskResult.value.tasks);
    }

    if (uploadResult.status === "fulfilled") {
      setAssets(uploadResult.value.assets);
    }
  }

  useEffect(() => {
    Promise.allSettled([api.models(), api.me()]).then(async ([modelResult, meResult]) => {
      if (modelResult.status === "fulfilled") {
        setModels(filterEnabledModels(modelResult.value.models));
      }

      if (meResult.status === "fulfilled") {
        activeUserIdRef.current = String(meResult.value.user.id);
        setCurrentUser(meResult.value.user);
        await loadAppData(meResult.value.user.id);
      }

      setAuthLoading(false);
    });
  }, []);

  function getFormError() {
    if (!form.prompt.trim()) return "请输入 prompt";
    if (promptTooLong) return `Prompt 最长 ${PROMPT_MAX_LENGTH} 字符`;
    if (promptForSubmitTooLong) return `注入引用后的 Prompt 最长 ${PROMPT_MAX_LENGTH} 字符`;
    if (durationInvalid) return `时长必须在 ${MIN_DURATION}-${MAX_DURATION} 秒之间`;
    if (referencesMissing) return `${selectedModel.id} 不支持纯文本生成，至少需要 1 张参考图片`;
    if (form.images.length > IMAGE_MAX_COUNT) return `参考图片最多 ${IMAGE_MAX_COUNT} 张`;
    if (form.videos.length > VIDEO_MAX_COUNT) return `参考视频最多 ${VIDEO_MAX_COUNT} 条`;
    if (form.audios.length > AUDIO_MAX_COUNT) return `参考音频最多 ${AUDIO_MAX_COUNT} 条`;
    if (unsupportedVideoReference) return `${selectedModel.id} 不支持参考视频`;
    if (uploading.image || uploading.video || uploading.audio) return "素材还在上传中，请稍后再提交";
    return "";
  }

  async function loadTasks() {
    const requestUserId = currentUser?.id;
    setHistoryLoading(true);
    try {
      const data = await api.tasks();
      if (!isCurrentUserRequest(requestUserId)) return [];
      setTaskHistory(data.tasks);
      return data.tasks;
    } catch (error) {
      if (!isCurrentUserRequest(requestUserId)) return [];
      setMessage(error.message);
      return [];
    } finally {
      if (isCurrentUserRequest(requestUserId)) {
        setHistoryLoading(false);
      }
    }
  }

  async function submitAuth() {
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const result = authMode === "register"
        ? await api.register(authForm)
        : await api.login({ email: authForm.email, password: authForm.password });
      stopPolling();
      clearTaskViewState();
      api.setToken(result.token);
      activeUserIdRef.current = String(result.user.id);
      setCurrentUser(result.user);
      setAuthForm(defaultAuthForm);
      await loadAppData(result.user.id);
    } catch (error) {
      setAuthMessage(error.message);
    } finally {
      setAuthBusy(false);
      setAuthLoading(false);
    }
  }

  function logout() {
    stopPolling();
    api.clearToken();
    activeUserIdRef.current = "";
    setCurrentUser(null);
    clearTaskViewState();
    setAuthMessage("");
    setMessage("");
  }

  async function saveConfig() {
    setSaving(true);
    setMessage("");
    try {
      const saved = await api.saveConfig({ apiKey: config.apiKey });
      setConfig((current) => ({ ...current, ...saved }));
      setMessage("配置已保存");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function loadVideoAccess(taskId) {
    if (
      videoAccessRef.current.taskId === taskId &&
      videoAccessRef.current.file &&
      !isVideoAccessExpired(videoAccessRef.current.file)
    ) {
      setVideoFile(videoAccessRef.current.file);
      return videoAccessRef.current.file;
    }
    const access = await api.getVideoAccess(taskId);
    const file = {
      url: toAbsoluteUrl(access.previewUrl),
      downloadUrl: toAbsoluteUrl(access.downloadUrl),
      expiresAt: access.expiresAt || null,
      isSigned: Boolean(access.isSigned)
    };
    videoAccessRef.current = { taskId, file };
    setVideoFile(file);
    return file;
  }

  async function refreshTask(taskId, shouldDownload = true, updateCurrentTask = true) {
    const requestUserId = currentUser?.id;
    const data = await api.getTask(taskId);
    if (!isCurrentUserRequest(requestUserId)) return { task: null, record: null };
    if (updateCurrentTask) {
      setTask(data.task);
    }
    const tasks = await loadTasks();
    if (!isCurrentUserRequest(requestUserId)) return { task: null, record: null };
    const currentRecord = tasks.find((item) => item.taskId === taskId);
    if (data.task.status === "completed" && shouldDownload) {
      stopPolling(taskId);
      if (updateCurrentTask) {
        await loadVideoAccess(taskId);
      }
    }
    if (data.task.status === "failed") {
      stopPolling(taskId);
    }
    if (data.task.status === "downloaded" || currentRecord?.file) {
      stopPolling(taskId);
    }
    if (updateCurrentTask && canPreviewStatus(data.task.status)) {
      await loadVideoAccess(taskId);
    }
    return { task: data.task, record: currentRecord || null };
  }

  async function tickPolling(taskId, shouldDownload = true, updateCurrentTask = true) {
    try {
      await refreshTask(taskId, shouldDownload, updateCurrentTask);
      pollErrorCountsRef.current.set(taskId, 0);
    } catch (error) {
      const nextErrorCount = (pollErrorCountsRef.current.get(taskId) || 0) + 1;
      pollErrorCountsRef.current.set(taskId, nextErrorCount);
      if (nextErrorCount >= POLL_ERROR_RETRY_LIMIT) {
        stopPolling(taskId, false);
        if (updateCurrentTask) {
          setMessage(`任务轮询暂时中断，但上游任务可能仍在继续。稍后会自动恢复，或在任务历史中手动打开该任务。原因：${error.message}`);
        }
      }
    }
  }

  function startPolling(taskId, shouldDownload = true, updateCurrentTask = true) {
    if (!taskId) return;
    stopPolling(taskId, false);
    pollErrorCountsRef.current.set(taskId, 0);
    addActiveTaskId(taskId);
    tickPolling(taskId, shouldDownload, updateCurrentTask);
    const pollRef = window.setInterval(() => {
      tickPolling(taskId, shouldDownload, updateCurrentTask);
    }, Number(config.pollIntervalMs || 5000));
    pollRefs.current.set(taskId, pollRef);
  }

  async function handleUpload(kind, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const fieldConfig = FIELD_CONFIG[kind];
    const fieldName = fieldConfig.field;
    const selected = form[fieldName];
    if (selected.length + files.length > fieldConfig.maxCount) {
      setMessage(`${fieldConfig.label} 当前任务最多 ${fieldConfig.maxCount} 条`);
      return;
    }
    if (kind === "video" && !selectedModel?.supportsVideoReference) {
      setMessage(`${selectedModel.id} 不支持参考视频`);
      return;
    }

    setUploading((current) => ({ ...current, [kind]: true }));
    setMessage("");
    try {
      for (const file of files) {
        const result = await api.uploadFile(kind, file);
        setAssets((current) => mergeAssets(current, [result.asset]));
        setForm((current) => ({
          ...current,
          [fieldName]: dedupeAssets([...current[fieldName], result.asset]).slice(0, fieldConfig.maxCount)
        }));
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading((current) => ({ ...current, [kind]: false }));
    }
  }

  function addAssetToForm(kind, asset) {
    const fieldConfig = FIELD_CONFIG[kind];
    const fieldName = fieldConfig.field;
    if (kind === "video" && !selectedModel?.supportsVideoReference) {
      setMessage(`${selectedModel.id} 不支持参考视频`);
      return;
    }

    setForm((current) => {
      const next = dedupeAssets([...current[fieldName], asset]);
      if (next.length > fieldConfig.maxCount) {
        setMessage(`${fieldConfig.label} 当前任务最多 ${fieldConfig.maxCount} 条`);
        return current;
      }
      return { ...current, [fieldName]: next };
    });
  }

  function removeAssetFromForm(kind, asset) {
    const fieldName = FIELD_CONFIG[kind].field;
    setForm((current) => ({
      ...current,
      [fieldName]: current[fieldName].filter((item) => String(item.id || item.url) !== String(asset.id || asset.url))
    }));
  }

  function getPromptSelection() {
    const input = promptInputRef.current;
    if (!input) return lastPromptSelectionRef.current;
    if (document.activeElement !== input) return lastPromptSelectionRef.current;
    return {
      start: input.selectionStart,
      end: input.selectionEnd
    };
  }

  function updateMentionMenuFromInput(input) {
    lastPromptSelectionRef.current = {
      start: input.selectionStart,
      end: input.selectionEnd
    };
    const activeMention = getActiveMention(input.value, input.selectionStart);
    setMentionMenu(activeMention
      ? { open: true, query: activeMention.query, range: activeMention.range }
      : { open: false, query: "", range: null });
  }

  function closeMentionMenu() {
    setMentionMenu({ open: false, query: "", range: null });
  }

  function insertAssetMention(kind, asset, options = {}) {
    const fieldConfig = FIELD_CONFIG[kind];
    const fieldName = fieldConfig.field;
    if (kind === "video" && !selectedModel?.supportsVideoReference) {
      setMessage(`${selectedModel.id} 不支持参考视频`);
      return;
    }

    const selection = options.selection || getPromptSelection();
    let nextCaret = null;
    setMessage("");
    closeMentionMenu();
    setForm((current) => {
      const nextAssets = dedupeAssets([...current[fieldName], asset]);
      if (nextAssets.length > fieldConfig.maxCount) {
        setMessage(`${fieldConfig.label} 当前任务最多 ${fieldConfig.maxCount} 条`);
        return current;
      }

      const assetIndex = nextAssets.findIndex((item) => getAssetKey(item) === getAssetKey(asset));
      const token = getReferenceToken(kind, assetIndex + 1);
      const inserted = insertTextAtSelection(current.prompt, token, selection);
      nextCaret = inserted.caret;
      return {
        ...current,
        [fieldName]: nextAssets,
        prompt: inserted.value
      };
    });

    window.requestAnimationFrame(() => {
      const input = promptInputRef.current;
      if (!input) return;
      input.focus();
      if (nextCaret !== null) {
        input.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  function selectMentionAsset(kind, asset) {
    insertAssetMention(kind, asset, { selection: mentionMenu.range });
  }

  async function createVideo() {
    const validationError = getFormError();
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setBusy(true);
    setMessage("");
    setVideoFile(null);
    setTask(null);
    setSubmittedPayload(null);
    setSubmittedMemory(null);

    try {
      const memory = buildTaskMemory(form, promptForSubmit);
      const payload = {
        ...form,
        prompt: promptForSubmit,
        duration: Number(form.duration),
        images: form.images.map((item) => item.url),
        videos: form.videos.map((item) => item.url),
        audios: form.audios.map((item) => item.url),
        memory
      };
      const data = await api.createVideo(payload);
      setTask(data.task);
      setSubmittedPayload(data.payload);
      setSubmittedMemory(memory);
      await loadTasks();
      startPolling(data.task.id, true);
      setBusy(false);
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  }

  async function openHistoryTask(record) {
    setMessage("");
    setVideoFile(null);
    setSubmittedPayload(record.payload || null);
    setSubmittedMemory(getReusableTaskMemory(record));
    try {
      await refreshTask(record.taskId, false, true);
      if (canPreviewStatus(record.status)) {
        await loadVideoAccess(record.taskId);
      }
      if (isPollingStatus(record.status)) {
        startPolling(record.taskId, true, true);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function downloadHistoryTask(record) {
    setMessage("");
    try {
      const access = await api.getVideoAccess(record.taskId);
      window.open(toAbsoluteUrl(access.downloadUrl), "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error.message);
    }
  }

  function reuseHistoryTask(record) {
    const memory = getReusableTaskMemory(record);
    const nextModel = models.some((model) => model.id === memory.model) ? memory.model : defaultForm.model;
    const modelConfig = models.find((model) => model.id === nextModel) || selectedModel;
    const nextImages = (memory.references?.images || []).filter((asset) => asset.url);
    const nextVideos = modelConfig?.supportsVideoReference
      ? (memory.references?.videos || []).filter((asset) => asset.url)
      : [];
    const nextAudios = (memory.references?.audios || []).filter((asset) => asset.url);
    const nextResolution = modelConfig?.resolutions?.includes(memory.resolution)
      ? memory.resolution
      : modelConfig?.resolutions?.[0] || defaultForm.resolution;
    const recalledAssets = [...nextImages, ...nextVideos, ...nextAudios];

    setForm({
      model: nextModel,
      prompt: memory.editorPrompt || memory.submittedPrompt || "",
      aspect_ratio: ["16:9", "9:16"].includes(memory.aspect_ratio) ? memory.aspect_ratio : defaultForm.aspect_ratio,
      duration: Number.isFinite(Number(memory.duration)) && Number(memory.duration) > 0 ? Number(memory.duration) : defaultForm.duration,
      resolution: nextResolution,
      images: nextImages,
      videos: nextVideos,
      audios: nextAudios,
      client_task_id: ""
    });
    setAssets((current) => mergeAssets(current, recalledAssets));
    setSubmittedPayload(record.payload || null);
    setSubmittedMemory(memory);
    setMessage("已复用历史任务的提示词和参考素材，可继续补镜头。");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (!currentUser || !taskHistory.length) return;

    const activeTaskIds = getActiveTaskIds(currentUser.id);
    const resumableTasks = taskHistory.filter((item) => (
      activeTaskIds.includes(item.taskId) || isPollingStatus(item.status)
    ));

    if (!resumableTasks.length) return;
    const visibleTask = task?.id ? null : resumableTasks[0];
    if (visibleTask) {
      setTask(visibleTask.task || { id: visibleTask.taskId, status: visibleTask.status, progress: visibleTask.progress });
      setSubmittedPayload(visibleTask.payload || null);
      setSubmittedMemory(getReusableTaskMemory(visibleTask));
      if (canPreviewStatus(visibleTask.status)) {
        loadVideoAccess(visibleTask.taskId).catch(() => {});
      } else {
        setVideoFile(null);
      }
    }

    const newlyResumed = [];
    for (const resumableTask of resumableTasks) {
      if (pollRefs.current.has(resumableTask.taskId)) continue;
      startPolling(resumableTask.taskId, true, visibleTask?.taskId === resumableTask.taskId);
      newlyResumed.push(resumableTask.taskId);
    }
    if (newlyResumed.length) {
      setMessage(`已恢复 ${newlyResumed.length} 个任务的轮询。`);
    }
  }, [currentUser, taskHistory, config.pollIntervalMs]);

  if (authLoading) {
    return <main className="auth-shell"><section className="auth-card"><h1>加载中</h1></section></main>;
  }

  if (!currentUser) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow"><Icon name="◌" size={14} /> Local Auth</p>
          <h1>{authMode === "register" ? "注册账户" : "登录控制台"}</h1>

          {authMode === "register" && (
            <label>
              用户名
              <input
                value={authForm.name}
                onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
                placeholder="输入显示名称"
              />
            </label>
          )}

          <label>
            邮箱
            <input
              type="email"
              value={authForm.email}
              onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
              placeholder="name@example.com"
            />
          </label>

          <label>
            密码
            <input
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
              placeholder={authMode === "register" ? "至少 8 位" : "输入密码"}
            />
          </label>

          {authMessage && <p className="message">{authMessage}</p>}

          <button className="primary-button" onClick={submitAuth} disabled={!canSubmitAuth || authBusy}>
            {authBusy ? "提交中" : authMode === "register" ? "注册并登录" : "登录"}
          </button>

          <button
            className="auth-switch"
            onClick={() => {
              setAuthMode(authMode === "register" ? "login" : "register");
              setAuthMessage("");
            }}
          >
            {authMode === "register" ? "已有账户，去登录" : "没有账户，先注册"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {configOpen && (
        <div className="dialog-backdrop" onClick={() => setConfigOpen(false)}>
          <section className="config-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="panel-title">
              <span>API Key 配置</span>
              <button type="button" className="icon-button" onClick={() => setConfigOpen(false)} aria-label="关闭">
                <Icon name="×" size={18} />
              </button>
            </div>
            <label>
              API Key
              <div className="secret-input">
                <Icon name="◆" size={16} />
                <input
                  type="text"
                  placeholder="输入 ThinkAI API Key"
                  value={config.apiKey}
                  onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
                />
              </div>
            </label>
            <button className="secondary-button" onClick={saveConfig} disabled={saving}>
              {saving ? <Icon name="◐" className="spin" size={17} /> : <Icon name="✓" size={17} />}
              保存配置
            </button>
            <div className="api-key-list">
              <div className="field-top">
                <span>当前 API Key</span>
                <span className="counter">{config.hasApiKey ? "已保存" : "未保存"}</span>
              </div>
              {config.hasApiKey ? (
                <div className="api-key-item">
                  <code>{config.apiKey}</code>
                  <small>重新保存会直接覆盖当前值。</small>
                </div>
              ) : (
                <p className="empty-history">当前用户还没有保存 API Key。</p>
              )}
            </div>
          </section>
        </div>
      )}

      <section className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src={weblogo} alt="ThinkAI News" />
        </div>
        <div className="topbar-actions">
          <button type="button" className="health api-config-trigger" onClick={() => setConfigOpen(true)}>
            <span className={config.hasApiKey ? "dot ready" : "dot"} />
            {config.hasApiKey ? "API Key 已配置" : "等待配置 API Key"}
          </button>
          <div className="user-pill">
            <span>{currentUser.name}</span>
            <button className="mini-button" onClick={logout}>退出</button>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="control-rail">
          <div className="model-list">
            <div className="panel-title">
              <Icon name="✦" />
              <span>模型选择</span>
            </div>
            {models.map((model) => (
              <div key={model.id} className="model-option-wrap">
                <button
                  className={`model-option ${form.model === model.id ? "active" : ""}`}
                  onClick={() => setForm((current) => ({
                    ...current,
                    model: model.id,
                    resolution: model.resolutions[0],
                    videos: model.supportsVideoReference ? current.videos : []
                  }))}
                >
                  <span className="model-option-head">
                    <span>{model.name}</span>
                    {model.priceLabel ? <em className="model-price">{model.priceLabel}</em> : null}
                  </span>
                  <small>{model.id}</small>
                </button>
                <ModelTooltip model={model} />
              </div>
            ))}
          </div>
          <aside className="result-panel">
            <div className="panel-title">
              <Icon name="⟲" />
              <span>任务状态</span>
            </div>
            <div className={`status-orb ${isGenerating ? "is-spinning" : ""}`}>
              <div />
              <span>{isGenerating ? "" : "✓"}</span>
            </div>
            <div className="status-line">
              {task?.status === "completed" || task?.status === "downloaded" ? <Icon name="✓" /> : task?.status === "failed" ? <Icon name="!" /> : <Icon name="⟲" />}
              {statusText(task?.status)}
            </div>
            {isGenerating && <p className="status-hint">视频正在生成中，大约需要几分钟。</p>}
            {task?.id && <code>{task.id}</code>}
            {message && <p className="message">{message}</p>}
            {videoFile && (
              <div className="video-output">
                <video controls src={videoFile.url} />
                <a className="secondary-button" href={videoFile.downloadUrl} download>
                  <Icon name="↓" size={17} />
                  下载视频
                </a>
              </div>
            )}
            {submittedPayload && <pre>{JSON.stringify(submittedPayload, null, 2)}</pre>}
            {submittedMemory && (
              <div className="memory-preview">
                <div className="asset-group-head">
                  <strong>任务记忆</strong>
                  <span>{countMemoryReferences(submittedMemory)} 个参考素材</span>
                </div>
                <p>{submittedMemory.editorPrompt || submittedMemory.submittedPrompt || "未保存提示词"}</p>
                <div className="memory-reference-list">
                  {["images", "videos", "audios"].flatMap((key) => (
                    (submittedMemory.references?.[key] || []).map((asset) => (
                      <span className="memory-reference-chip" key={`${key}-${asset.id || asset.url}`}>
                        {asset.filename || asset.url}
                      </span>
                    ))
                  ))}
                </div>
              </div>
            )}

            <div className="history-section">
              <div className="history-head">
                <div className="panel-title">
                  <Icon name="◷" />
                  <span>任务历史</span>
                </div>
                <button className="mini-button" onClick={loadTasks} disabled={historyLoading}>
                  {historyLoading ? "刷新中" : "刷新"}
                </button>
              </div>

              {taskHistory.length === 0 ? (
                <p className="empty-history">暂无历史任务。创建任务后会自动写入数据库。</p>
              ) : (
                <div className="history-list">
                  {taskHistory.map((record) => (
                    <div className="history-item" key={record.taskId}>
                      <button className="history-main" onClick={() => openHistoryTask(record)}>
                        <span className="history-row">
                          <strong>{statusText(record.status)}</strong>
                          <small>{formatTime(record.createdAt)}</small>
                        </span>
                        <span className="history-model">{record.model || record.task?.model || "-"}</span>
                        <code>{record.taskId}</code>
                      </button>
                      <div className="history-actions">
                        <button className="mini-link" onClick={() => reuseHistoryTask(record)}>
                          复用
                        </button>
                        <button className="mini-link" onClick={() => downloadHistoryTask(record)} disabled={!canPreviewStatus(record.status)}>
                          下载
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </aside>

        <section className="composer">
          <div className="composer-head">
            <div>
              <p className="eyebrow"><Icon name="▣" size={14} /> Prompt</p>
              <h2>提示词</h2>
            </div>
          </div>

          <label className="prompt-box">
            <span className="field-top">
              <span>Prompt</span>
              <span className={`counter ${promptTooLong ? "invalid" : ""}`}>{promptLength}/{PROMPT_MAX_LENGTH}</span>
            </span>
            <div className="prompt-editor">
              <textarea
                ref={promptInputRef}
                value={form.prompt}
                maxLength={PROMPT_MAX_LENGTH}
                aria-invalid={promptTooLong || promptForSubmitTooLong}
                placeholder="必填，最长 6000 字符。建议写清主体、动作、镜头运动、构图、光线、节奏和稳定性要求。"
                onChange={(event) => {
                  const nextPrompt = event.target.value;
                  setForm((current) => ({ ...current, prompt: nextPrompt }));
                  updateMentionMenuFromInput(event.target);
                }}
                onClick={(event) => updateMentionMenuFromInput(event.target)}
                onKeyUp={(event) => {
                  if (event.key !== "Escape") updateMentionMenuFromInput(event.target);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeMentionMenu();
                  }
                }}
              />
              {mentionMenu.open && (
                <div className="mention-menu">
                  <div className="mention-menu-head">
                    <strong>选择参考素材</strong>
                    <span>{mentionOptions.length ? "点击插入引用" : "暂无可引用素材"}</span>
                  </div>
                  {mentionOptions.length === 0 ? (
                    <p className="mention-empty">先在右侧参考图片、视频或音频里加入素材，或换一个关键词。</p>
                  ) : (
                    <div className="mention-list">
                      {mentionOptions.map(({ kind, asset, token }) => {
                        return (
                          <button
                            type="button"
                            className="mention-option"
                            key={`mention-${kind}-${asset.id || asset.url}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectMentionAsset(kind, asset)}
                          >
                            <span className="mention-thumb">
                              {kind === "image" && asset.url ? (
                                <img src={asset.url} alt={asset.filename} loading="lazy" />
                              ) : (
                                <Icon name={kind === "video" ? "▶" : "♪"} size={20} />
                              )}
                            </span>
                            <span className="mention-copy">
                              <strong>{token}</strong>
                              <small>{asset.filename}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            {referenceBindings.length > 0 && (
              <div className="reference-preview">
                <div className="asset-group-head">
                  <strong>@ 引用映射</strong>
                  <span>{referenceBindings.length} 个引用</span>
                </div>
                <div className="reference-token-list">
                  {referenceBindings.map((binding) => (
                    <button
                      type="button"
                      className="reference-chip"
                      key={`${binding.kind}-${binding.asset.id || binding.asset.url}`}
                      onClick={() => insertAssetMention(binding.kind, binding.asset)}
                    >
                      <span>{binding.token}</span>
                      <small>{binding.asset.filename}</small>
                    </button>
                  ))}
                </div>
                {promptForSubmit !== form.prompt.trim() && (
                  <div className="prompt-submit-preview">
                    <strong>提交给模型的 Prompt</strong>
                    <p>{promptForSubmit}</p>
                  </div>
                )}
              </div>
            )}
          </label>
        </section>

        <aside className="settings-panel">
          <div className="composer-head">
            <div>
              <p className="eyebrow"><Icon name="▤" size={14} /> Settings</p>
              <h2>生成配置</h2>
            </div>
            {selectedModel && (
              <div className="model-badge">
                <strong>{selectedModel.name}</strong>
                <span>{selectedModel.textToVideo ? "支持纯文本" : "需参考图片"}</span>
              </div>
            )}
          </div>
          <div className="param-grid">
            <label>
              画幅
              <select value={form.aspect_ratio} onChange={(event) => setForm({ ...form, aspect_ratio: event.target.value })}>
                <option value="16:9">16:9 横屏</option>
                <option value="9:16">9:16 竖屏</option>
              </select>
              <span className="field-hint">可选。默认 16:9，仅支持 16:9 / 9:16。</span>
            </label>
            <label>
              <span className="field-top">
                <span>时长</span>
                <span className={`counter ${durationInvalid ? "invalid" : ""}`}>4-15 秒</span>
              </span>
              <input
                type="number"
                min={MIN_DURATION}
                max={MAX_DURATION}
                step="1"
                aria-invalid={durationInvalid}
                value={form.duration}
                onChange={(event) => setForm({ ...form, duration: event.target.value })}
              />
              <span className="field-hint">可选。默认 10 秒，必须在 4-15 秒之间。</span>
            </label>
            <label>
              分辨率
              <select value={form.resolution} onChange={(event) => setForm({ ...form, resolution: event.target.value })}>
                {(selectedModel?.resolutions || ["720p"]).map((resolution) => (
                  <option key={resolution} value={resolution}>{resolution}</option>
                ))}
              </select>
              <span className="field-hint">跟随当前模型支持范围：{selectedModel?.resolutions?.join(" / ") || "720p"}。</span>
            </label>
            <label>
              幂等 ID
              <input
                placeholder="可选，留空自动生成"
                value={form.client_task_id}
                onChange={(event) => setForm({ ...form, client_task_id: event.target.value })}
              />
              <span className="field-hint">强烈建议。创建超时后用同一个 ID 重试，避免重复任务。</span>
            </label>
          </div>

          <div className="reference-grid">
            <ReferencePanel
              config={FIELD_CONFIG.image}
              kind="image"
              selected={form.images}
              library={libraryByKind.image}
              disabled={false}
              invalid={form.images.length > IMAGE_MAX_COUNT || referencesMissing}
              loading={uploading.image}
              modelWarning={selectedModel?.requiresReference ? FIELD_CONFIG.image.requiredHint : FIELD_CONFIG.image.optionalHint}
              onUpload={(files) => handleUpload("image", files)}
              onAdd={(asset) => addAssetToForm("image", asset)}
              onMention={(asset) => insertAssetMention("image", asset)}
              onRemove={(asset) => removeAssetFromForm("image", asset)}
            />
            <ReferencePanel
              config={FIELD_CONFIG.video}
              kind="video"
              selected={form.videos}
              library={libraryByKind.video}
              disabled={!selectedModel?.supportsVideoReference}
              invalid={form.videos.length > VIDEO_MAX_COUNT || unsupportedVideoReference}
              loading={uploading.video}
              modelWarning={selectedModel?.supportsVideoReference ? FIELD_CONFIG.video.optionalHint : "当前模型不支持参考视频，仅 XH / XH 1080p / XH 4K 可用。"}
              onUpload={(files) => handleUpload("video", files)}
              onAdd={(asset) => addAssetToForm("video", asset)}
              onMention={(asset) => insertAssetMention("video", asset)}
              onRemove={(asset) => removeAssetFromForm("video", asset)}
            />
            <ReferencePanel
              config={FIELD_CONFIG.audio}
              kind="audio"
              selected={form.audios}
              library={libraryByKind.audio}
              disabled={false}
              invalid={form.audios.length > AUDIO_MAX_COUNT}
              loading={uploading.audio}
              modelWarning={FIELD_CONFIG.audio.optionalHint}
              onUpload={(files) => handleUpload("audio", files)}
              onAdd={(asset) => addAssetToForm("audio", asset)}
              onMention={(asset) => insertAssetMention("audio", asset)}
              onRemove={(asset) => removeAssetFromForm("audio", asset)}
            />
          </div>

          <button className="primary-button" onClick={createVideo} disabled={!canSubmit}>
            {busy ? <Icon name="◐" className="spin" size={19} /> : <Icon name="▶" size={19} />}
            {busy ? "提交中" : "创建并轮询视频"}
          </button>
        </aside>
      </section>
    </main>
  );
}

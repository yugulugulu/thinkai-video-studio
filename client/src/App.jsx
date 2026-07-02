import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { CH3_MODELS } from "./models.js";

const defaultForm = {
  model: "ch3-sd-2.0-xh",
  prompt: "一位穿浅色风衣的年轻女性在雨后的城市街道自然向前走，镜头缓慢推进，路面有柔和倒影，电影感，动作自然稳定",
  aspect_ratio: "16:9",
  duration: 8,
  resolution: "720p",
  images: "",
  videos: "",
  audios: "",
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

function Icon({ name, size = 18, className = "" }) {
  return <span className={`icon ${className}`} style={{ "--icon-size": `${size}px` }}>{name}</span>;
}

function splitUrls(value) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
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

export default function App() {
  const [models, setModels] = useState(CH3_MODELS);
  const [config, setConfig] = useState({ baseUrl: "https://www.thinkai.tv", apiKey: "", apiKeys: [], hasApiKey: false });
  const [form, setForm] = useState(defaultForm);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(defaultAuthForm);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [task, setTask] = useState(null);
  const [submittedPayload, setSubmittedPayload] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [message, setMessage] = useState("");
  const [taskHistory, setTaskHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef(null);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === form.model) || models[0],
    [models, form.model]
  );
  const imageUrls = useMemo(() => splitUrls(form.images), [form.images]);
  const videoUrls = useMemo(() => splitUrls(form.videos), [form.videos]);
  const audioUrls = useMemo(() => splitUrls(form.audios), [form.audios]);
  const promptLength = form.prompt.length;
  const durationNumber = Number(form.duration);
  const durationInvalid = !Number.isFinite(durationNumber) || durationNumber < MIN_DURATION || durationNumber > MAX_DURATION;
  const promptTooLong = promptLength > PROMPT_MAX_LENGTH;
  const referencesMissing = Boolean(selectedModel?.requiresReference && imageUrls.length === 0);
  const referencesOverLimit =
    imageUrls.length > IMAGE_MAX_COUNT ||
    videoUrls.length > VIDEO_MAX_COUNT ||
    audioUrls.length > AUDIO_MAX_COUNT;
  const unsupportedVideoReference = Boolean(videoUrls.length && selectedModel && !selectedModel.supportsVideoReference);
  const invalidReferenceUrl = [...imageUrls, ...videoUrls, ...audioUrls].some((url) => !url.startsWith("https://"));
  const progress = Number(task?.progress || 0);
  const canSubmit =
    Boolean(form.prompt.trim()) &&
    !busy &&
    !promptTooLong &&
    !durationInvalid &&
    !referencesMissing &&
    !referencesOverLimit &&
    !unsupportedVideoReference &&
    !invalidReferenceUrl;
  const canSubmitAuth = authMode === "register"
    ? Boolean(authForm.name.trim() && authForm.email.trim() && authForm.password.length >= 8)
    : Boolean(authForm.email.trim() && authForm.password);

  useEffect(() => {
    if (!selectedModel) return;
    if (!selectedModel.resolutions.includes(form.resolution)) {
      setForm((current) => ({ ...current, resolution: selectedModel.resolutions[0] }));
    }
  }, [selectedModel, form.resolution]);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  async function loadAppData() {
    const [modelResult, configResult, taskResult] = await Promise.allSettled([api.models(), api.config(), api.tasks()]);

    if (modelResult.status === "fulfilled") {
      setModels(modelResult.value.models);
    }

    if (configResult.status === "fulfilled") {
      setConfig((current) => ({ ...current, ...configResult.value }));
    } else {
      setMessage(`后端连接失败：${configResult.reason.message}`);
    }

    if (taskResult.status === "fulfilled") {
      setTaskHistory(taskResult.value.tasks);
    }
  }

  useEffect(() => {
    Promise.allSettled([api.models(), api.me()]).then(async ([modelResult, meResult]) => {
      if (modelResult.status === "fulfilled") {
        setModels(modelResult.value.models);
      }

      if (meResult.status === "fulfilled") {
        setCurrentUser(meResult.value.user);
        await loadAppData();
      }

      setAuthLoading(false);
    });
  }, []);

  function getFormError() {
    if (!form.prompt.trim()) return "请输入 prompt";
    if (promptTooLong) return `Prompt 最长 ${PROMPT_MAX_LENGTH} 字符`;
    if (durationInvalid) return `时长必须在 ${MIN_DURATION}-${MAX_DURATION} 秒之间`;
    if (referencesMissing) return `${selectedModel.id} 不支持纯文本生成，至少需要 1 张公网 HTTPS 参考图片`;
    if (imageUrls.length > IMAGE_MAX_COUNT) return `参考图片最多 ${IMAGE_MAX_COUNT} 张`;
    if (videoUrls.length > VIDEO_MAX_COUNT) return `参考视频最多 ${VIDEO_MAX_COUNT} 条`;
    if (audioUrls.length > AUDIO_MAX_COUNT) return `参考音频最多 ${AUDIO_MAX_COUNT} 条`;
    if (unsupportedVideoReference) return `${selectedModel.id} 不支持参考视频`;
    if (invalidReferenceUrl) return "参考素材必须是公网 HTTPS URL，不能使用本地文件、base64 或 data URL";
    return "";
  }

  async function loadTasks() {
    setHistoryLoading(true);
    try {
      const data = await api.tasks();
      setTaskHistory(data.tasks);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function submitAuth() {
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const result = authMode === "register"
        ? await api.register(authForm)
        : await api.login({ email: authForm.email, password: authForm.password });
      api.setToken(result.token);
      setCurrentUser(result.user);
      setAuthForm(defaultAuthForm);
      await loadAppData();
    } catch (error) {
      setAuthMessage(error.message);
    } finally {
      setAuthBusy(false);
      setAuthLoading(false);
    }
  }

  function logout() {
    api.clearToken();
    setCurrentUser(null);
    setTask(null);
    setSubmittedPayload(null);
    setVideoFile(null);
    setTaskHistory([]);
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

  async function refreshTask(taskId, shouldDownload = true) {
    const data = await api.getTask(taskId);
    setTask(data.task);
    await loadTasks();
    if (data.task.status === "completed" && shouldDownload) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      const downloaded = await api.downloadVideo(taskId);
      setVideoFile(downloaded.file);
      await loadTasks();
      setBusy(false);
    }
    if (data.task.status === "failed") {
      if (pollRef.current) window.clearInterval(pollRef.current);
      setBusy(false);
    }
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
    if (pollRef.current) window.clearInterval(pollRef.current);

    try {
      const payload = {
        ...form,
        duration: Number(form.duration),
        images: imageUrls,
        videos: videoUrls,
        audios: audioUrls
      };
      const data = await api.createVideo(payload);
      setTask(data.task);
      setSubmittedPayload(data.payload);
      await loadTasks();
      pollRef.current = window.setInterval(() => {
        refreshTask(data.task.id).catch((error) => {
          setMessage(error.message);
          setBusy(false);
          window.clearInterval(pollRef.current);
        });
      }, 5000);
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  }

  async function openHistoryTask(record) {
    setMessage("");
    setVideoFile(record.file || null);
    setSubmittedPayload(record.payload || null);
    try {
      await refreshTask(record.taskId, false);
      if (record.file) {
        setVideoFile(record.file);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function downloadHistoryTask(record) {
    setMessage("");
    try {
      const downloaded = await api.downloadVideo(record.taskId);
      setVideoFile(downloaded.file);
      await loadTasks();
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (authLoading) {
    return <main className="auth-shell"><section className="auth-card"><h1>加载中</h1></section></main>;
  }

  if (!currentUser) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow"><Icon name="◌" size={14} /> Local Auth</p>
          <h1>{authMode === "register" ? "注册账户" : "登录控制台"}</h1>
          <p className="auth-copy">本地 PostgreSQL 已接入，先完成账户注册或登录，再使用视频生成控制台。</p>

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
      <section className="topbar">
        <div>
          <p className="eyebrow"><Icon name="◌" size={14} /> Local CH3 Gateway</p>
          <h1>ThinkAI Video Studio</h1>
        </div>
        <div className="topbar-actions">
          <div className="health">
            <span className={config.hasApiKey ? "dot ready" : "dot"} />
            {config.hasApiKey ? "API Key 已配置" : "等待配置 API Key"}
          </div>
          <div className="user-pill">
            <span>{currentUser.name}</span>
            <button className="mini-button" onClick={logout}>退出</button>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="control-rail">
          <div className="panel">
            <div className="panel-title">
              <Icon name="⚙" />
              <span>接口配置</span>
            </div>
            <label>
              Base URL
              <div className="fixed-base-url">{config.baseUrl}</div>
            </label>
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
                <span>已保存 API Keys</span>
                <span className="counter">{config.apiKeys.length}</span>
              </div>
              {config.apiKeys.length === 0 ? (
                <p className="empty-history">当前用户还没有保存过 API Key。</p>
              ) : (
                <div className="api-key-items">
                  {config.apiKeys.map((item) => (
                    <div className="api-key-item" key={item.id}>
                      <code>{item.apiKey}</code>
                      <small>{formatTime(item.createdAt)}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="model-list">
            <div className="panel-title">
              <Icon name="✦" />
              <span>模型选择</span>
            </div>
            {models.map((model) => (
              <button
                key={model.id}
                className={`model-option ${form.model === model.id ? "active" : ""}`}
                onClick={() => setForm({
                  ...form,
                  model: model.id,
                  resolution: model.resolutions[0],
                  videos: model.supportsVideoReference ? form.videos : ""
                })}
              >
                <span>{model.name}</span>
                <small>{model.id}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="composer">
          <div className="composer-head">
            <div>
              <p className="eyebrow"><Icon name="▣" size={14} /> Create Task</p>
              <h2>生成参数</h2>
            </div>
            {selectedModel && (
              <div className="model-badge">
                <strong>{selectedModel.name}</strong>
                <span>{selectedModel.textToVideo ? "支持纯文本" : "需参考图片"}</span>
              </div>
            )}
          </div>

          <label className="prompt-box">
            <span className="field-top">
              <span>Prompt</span>
              <span className={`counter ${promptTooLong ? "invalid" : ""}`}>{promptLength}/{PROMPT_MAX_LENGTH}</span>
            </span>
            <textarea
              value={form.prompt}
              maxLength={PROMPT_MAX_LENGTH}
              aria-invalid={promptTooLong}
              placeholder="必填，最长 6000 字符。描述主体、动作、镜头、氛围和稳定性要求。"
              onChange={(event) => setForm({ ...form, prompt: event.target.value })}
            />
            <span className="field-hint">必填。CH3 仅支持 references 模式，纯文本生成仅 XH 系列可用。</span>
          </label>

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
            <label>
              <span className="field-top">
                <span>图片 URL</span>
                <span className={`counter ${imageUrls.length > IMAGE_MAX_COUNT || referencesMissing ? "invalid" : ""}`}>{imageUrls.length}/{IMAGE_MAX_COUNT}</span>
              </span>
              <textarea
                placeholder={selectedModel?.requiresReference ? "必填至少 1 张公网 HTTPS 图片 URL" : "可选，最多 9 条，逗号或换行分隔"}
                aria-invalid={imageUrls.length > IMAGE_MAX_COUNT || referencesMissing}
                value={form.images}
                onChange={(event) => setForm({ ...form, images: event.target.value })}
              />
              <span className="field-hint">{selectedModel?.requiresReference ? "当前模型不支持纯文本，必须至少填 1 张参考图片。" : "XH 系列可留空做纯文本生成；填写时必须使用公网 HTTPS URL。"}</span>
            </label>
            <label>
              <span className="field-top">
                <span>视频 URL</span>
                <span className={`counter ${videoUrls.length > VIDEO_MAX_COUNT || unsupportedVideoReference ? "invalid" : ""}`}>{videoUrls.length}/{VIDEO_MAX_COUNT}</span>
              </span>
              <textarea
                placeholder={selectedModel?.supportsVideoReference ? "可选，最多 3 条公网 HTTPS 视频 URL" : "当前模型不支持参考视频"}
                aria-invalid={videoUrls.length > VIDEO_MAX_COUNT || unsupportedVideoReference}
                disabled={!selectedModel?.supportsVideoReference}
                value={form.videos}
                onChange={(event) => setForm({ ...form, videos: event.target.value })}
              />
              <span className="field-hint">仅 XH / XH 1080p / XH 4K 支持参考视频，最多 3 条。</span>
            </label>
            <label>
              <span className="field-top">
                <span>音频 URL</span>
                <span className={`counter ${audioUrls.length > AUDIO_MAX_COUNT ? "invalid" : ""}`}>{audioUrls.length}/{AUDIO_MAX_COUNT}</span>
              </span>
              <textarea
                placeholder="可选，最多 3 条公网 HTTPS 音频 URL"
                aria-invalid={audioUrls.length > AUDIO_MAX_COUNT}
                value={form.audios}
                onChange={(event) => setForm({ ...form, audios: event.target.value })}
              />
              <span className="field-hint">可选。最多 3 条，必须是公网 HTTPS URL。</span>
            </label>
          </div>

          <button className="primary-button" onClick={createVideo} disabled={!canSubmit}>
            {busy ? <Icon name="◐" className="spin" size={19} /> : <Icon name="▶" size={19} />}
            {busy ? "任务运行中" : "创建并轮询视频"}
          </button>
        </section>

        <aside className="result-panel">
          <div className="panel-title">
            <Icon name="⟲" />
            <span>任务状态</span>
          </div>
          <div className="status-orb" style={{ "--progress": `${progress}%` }}>
            <div />
            <span>{progress}%</span>
          </div>
          <div className="status-line">
            {task?.status === "completed" || task?.status === "downloaded" ? <Icon name="✓" /> : task?.status === "failed" ? <Icon name="!" /> : <Icon name="⟲" />}
            {statusText(task?.status)}
          </div>
          {task?.id && <code>{task.id}</code>}
          {message && <p className="message">{message}</p>}
          {videoFile && (
            <div className="video-output">
              <video controls src={`${api.base}${videoFile.url}`} />
              <a className="secondary-button" href={`${api.base}${videoFile.url}`} download>
                <Icon name="↓" size={17} />
                下载视频
              </a>
            </div>
          )}
          {submittedPayload && <pre>{JSON.stringify(submittedPayload, null, 2)}</pre>}

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
              <p className="empty-history">暂无历史任务。创建任务后会自动记录在本机。</p>
            ) : (
              <div className="history-list">
                {taskHistory.map((record) => (
                  <div className="history-item" key={record.taskId}>
                    <button className="history-main" onClick={() => openHistoryTask(record)}>
                      <span className="history-row">
                        <strong>{statusText(record.status)}</strong>
                        <small>{formatTime(record.updatedAt)}</small>
                      </span>
                      <span className="history-model">{record.model || record.task?.model || "-"}</span>
                      <code>{record.taskId}</code>
                    </button>
                    <div className="history-actions">
                      {record.file ? (
                        <a className="mini-link" href={`${api.base}${record.file.url}`} download>下载</a>
                      ) : (
                        <button className="mini-link" onClick={() => downloadHistoryTask(record)} disabled={record.status !== "completed"}>
                          下载
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

/**
 * 云端工作区共享逻辑（非 React 组件导出）。
 * 独立成模块是为了让 WorkspacePanel.tsx 保持"纯组件文件"，
 * 从而 Vite Fast Refresh 可以正常热更新而不触发 full reload。
 */

export const API_BASE = "/ws-api";
export const TOKEN_KEY = "excalidraw-ws-token";
export const USER_KEY = "excalidraw-ws-username";
export const CURRENT_KEY = "excalidraw-ws-current";

/**
 * 提取画布文本元素（去重保序），供 AI 场景命名使用。
 */
export const extractSceneTexts = (elements: readonly unknown[]): string[] => {
  const raw = (elements as Array<{ type?: string; text?: string }>)
    .filter((el) => el?.type === "text" && typeof el.text === "string")
    .map((el) => el!.text!.trim().replace(/\s+/g, " "))
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  return raw.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
};

// 存储名 = AI 总结名 + 时间戳（避免重名覆盖）；网站显示名 = 剥离时间戳
const SCENE_TIMESTAMP_RE = / \((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)$/;

export const formatTimestamp = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
};

/**
 * 保存时的初始存储名：纯时间戳。
 * 保存成功后由 renameSceneWithAI 异步总结并更新为「AI 名 (时间戳)」——
 * 保证保存主流程不阻塞（AI 失败时名字保持时间戳，依然可区分）。
 */
export const generateSceneStorageName = (): string =>
  formatTimestamp(new Date());

/** 网站展示用：剥离时间戳后缀，只显示 AI 总结名（旧数据无时间戳则原样返回） */
export const displaySceneName = (name: string): string =>
  name.replace(SCENE_TIMESTAMP_RE, "");

/**
 * 异步 AI 场景命名：根据画布文本总结简短名字（≤40 字符，语言跟随内容）。
 * 失败返回 null（名字保持时间戳，不阻塞、不打扰用户）。
 */
export const summarizeSceneName = async (
  elements: readonly unknown[],
): Promise<string | null> => {
  const texts = extractSceneTexts(elements);
  if (texts.length === 0) {
    return null; // 无文本 → 不调用 AI
  }
  try {
    const res = await fetch("/ai-proxy/v1/ai/scene-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) {
      return null;
    }
    const body = await res.json().catch(() => ({}));
    const name = typeof (body as any)?.name === "string" ? (body as any).name.trim() : "";
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
};

/**
 * 保存成功后调用：AI 总结 → 更新场景名为「AI 名 (时间戳)」。
 * fire-and-forget：失败静默（保持时间戳名）；成功后广播 ws:scene-renamed
 * 供 WorkspacePanel 刷新列表显示名。
 */
export const renameSceneWithAI = async (
  id: number,
  elements: readonly unknown[],
  timestamp: string,
): Promise<void> => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    return;
  }
  const aiName = await summarizeSceneName(elements);
  if (!aiName) {
    return;
  }
  const name = `${aiName} (${timestamp})`;
  try {
    const res = await fetch(`${API_BASE}/api/scenes/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      window.dispatchEvent(
        new CustomEvent("ws:scene-renamed", { detail: { id, name } }),
      );
    }
  } catch {
    // 静默：改名失败不打扰保存主流程
  }
};

// App.tsx onChange 挂载自动保存的全局 ref
export const workspaceAutoSaveRef: {
  current: {
    onSceneChange: (elements: readonly unknown[], appState: unknown) => void;
  } | null;
} = { current: null };

// Close 场景期间同步拦截自动保存：
// resetScene 清空画布会触发 onChange，若此时 currentSceneId 尚未解除绑定
// （React setState 异步），旧闭包会把空画布 PUT 覆盖云端——同步标志位杜绝竞态。
export const autoSaveBlockedRef: { current: boolean } = { current: false };

// 从原生菜单打开面板
export const openWorkspacePanel = () =>
  window.dispatchEvent(new CustomEvent("ws:open-panel"));

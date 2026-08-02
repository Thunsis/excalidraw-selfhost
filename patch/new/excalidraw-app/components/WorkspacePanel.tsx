import { useCallback, useEffect, useRef, useState } from "react";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { loadFromJSON } from "@excalidraw/excalidraw/data";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import DialogActionButton from "@excalidraw/excalidraw/components/DialogActionButton";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { removeIcon } from "@excalidraw/excalidraw/components/icons";

import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  API_BASE,
  CURRENT_KEY,
  TOKEN_KEY,
  USER_KEY,
  autoSaveBlockedRef,
  displaySceneName,
  workspaceAutoSaveRef,
} from "./workspaceCloud";

import "./WorkspacePanel.scss";

/**
 * Workspace 面板：登录 + 云场景（Open from cloud）
 * 全部用 Excalidraw 原生 Dialog 组件（风格与保存/导出对话框一致）
 * 后端: /ws-api → localhost:3020 (excalidraw-workspace-backend)
 */

type SceneMeta = {
  id: number;
  name: string;
  updated_at: string;
};

type SceneFull = SceneMeta & {
  elements: any[];
  appState: Record<string, unknown>;
};

async function api<T = unknown>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any).error || `Request failed (${res.status})`);
  }
  return body as T;
}

export const WorkspaceComponents = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  );
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  // 当前绑定的云端场景（自动保存目标），跨刷新持久化
  const [currentSceneId, setCurrentSceneId] = useState<number | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(CURRENT_KEY) || "null");
      return typeof v?.id === "number" ? v.id : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [userInput, setUserInput] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 最新画布内容缓存（Close 时立即保存用；onChange 同步更新）
  const lastElementsRef = useRef<{
    elements: readonly unknown[];
    appState: unknown;
  } | null>(null);

  // 绑定关系跨刷新持久化
  const persistCurrent = (id: number | null, name: string) => {
    if (id == null) {
      localStorage.removeItem(CURRENT_KEY);
    } else {
      localStorage.setItem(CURRENT_KEY, JSON.stringify({ id, name }));
    }
  };

  const loadScenes = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const data = await api<{ scenes: SceneMeta[] }>("/api/scenes", {
        token,
      });
      setScenes(data.scenes);
    } catch (e: any) {
      setError(e.message);
    }
  }, [token]);

  // 自动保存（App.tsx onChange 驱动，2s debounce）
  // 语义：只有「保存到云端过」的画布才自动保存 ——
  //   已绑定场景（手动另存为或打开过）→ 2s 后 PUT 更新；
  //   从未保存到云端的本地画布 → 不自动建档，仅浏览器本地兜底。
  useEffect(() => {
    workspaceAutoSaveRef.current = {
      onSceneChange: (elements, appState) => {
        lastElementsRef.current = { elements, appState };
        if (autoSaveBlockedRef.current) {
          return; // Close 场景期间：清空画布触发的 onChange 不得写云端
        }
        if (!token || currentSceneId == null) {
          return; // 未登录或未保存过：云端无从写入
        }
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
          api(`/api/scenes/${currentSceneId}`, {
            method: "PUT",
            token,
            body: JSON.stringify({
              elements,
              appState: {
                viewBackgroundColor: (appState as any)?.viewBackgroundColor,
              },
            }),
          })
            .then(loadScenes)
            .catch(() => {});
        }, 2000);
      },
    };
    return () => {
      workspaceAutoSaveRef.current = null;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [token, currentSceneId, loadScenes]);

  // 手动「另存为」（Save as new canvas）成功后绑定新场景并刷新列表
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: number; name: string }>).detail;
      if (detail && typeof detail.id === "number") {
        setCurrentSceneId(detail.id);
        persistCurrent(detail.id, displaySceneName(detail.name || ""));
        loadScenes();
      }
    };
    window.addEventListener("ws:scene-created", handler);
    return () => window.removeEventListener("ws:scene-created", handler);
  }, [loadScenes]);

  // 保存成功后 AI 总结更新了场景名 → 局部更新列表显示名（不整表刷新，避免闪烁）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: number; name: string }>).detail;
      if (
        detail &&
        typeof detail.id === "number" &&
        typeof detail.name === "string"
      ) {
        setScenes((prev) =>
          prev.map((s) =>
            s.id === detail.id ? { ...s, name: detail.name } : s,
          ),
        );
        // 若该场景正被绑定（current），同步持久化的显示名
        setCurrentSceneId((prev) => {
          if (prev === detail.id) {
            persistCurrent(detail.id, displaySceneName(detail.name));
          }
          return prev;
        });
      }
    };
    window.addEventListener("ws:scene-renamed", handler);
    return () => window.removeEventListener("ws:scene-renamed", handler);
  }, []);

  // Close（菜单「Close」/ 命令面板）：先立即保存当前内容 → 解除绑定 → 清空回欢迎
  // 语义：新开画板不破坏云端数据——保存的是 Close 时刻的完整内容，而非清空后的空画布
  useEffect(() => {
    const closeHandler = async () => {
      // 同步拦截自动保存，杜绝 resetScene 的 onChange 把空画布 PUT 覆盖云端
      autoSaveBlockedRef.current = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      // 1. 立即保存当前内容（仅当有绑定场景且有缓存数据）
      if (token && currentSceneId != null && lastElementsRef.current) {
        try {
          await api(`/api/scenes/${currentSceneId}`, {
            method: "PUT",
            token,
            body: JSON.stringify({
              elements: lastElementsRef.current.elements,
              appState: {
                viewBackgroundColor: (lastElementsRef.current.appState as any)
                  ?.viewBackgroundColor,
              },
            }),
          });
        } catch {
          // 保存失败不阻塞关闭（云端保留上次内容）
        }
      }
      // 2. 解除绑定
      setCurrentSceneId(null);
      persistCurrent(null, "");
      // 3. 清空画布回到初始欢迎（resetScene 的 onChange 已被拦截）
      try {
        excalidrawAPI.resetScene();
      } catch {
        excalidrawAPI.updateScene({ elements: [] });
      }
      // 4. 恢复拦截（新场景绑定前 currentSceneId 为 null 本来也不保存）
      setTimeout(() => {
        autoSaveBlockedRef.current = false;
      }, 500);
    };
    window.addEventListener("ws:scene-close", closeHandler);
    return () => window.removeEventListener("ws:scene-close", closeHandler);
  }, [token, currentSceneId, loadScenes, excalidrawAPI]);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("ws:open-panel", openHandler);
    return () => window.removeEventListener("ws:open-panel", openHandler);
  }, []);

  useEffect(() => {
    if (open && token) {
      loadScenes();
    }
  }, [open, token, loadScenes]);

  const login = async () => {
    setBusy(true);
    setError("");
    try {
      const usernameInput = userInput.trim();
      if (!usernameInput) {
        setError("Please enter your username");
        return;
      }
      const data = await api<{ token: string; user: { username: string } }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ username: usernameInput }),
        },
      );
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, data.user.username);
      setToken(data.token);
      window.dispatchEvent(new CustomEvent("ws:auth-changed"));
      loadScenes();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(CURRENT_KEY);
    setToken(null);
    setCurrentSceneId(null);
    setScenes([]);
    window.dispatchEvent(new CustomEvent("ws:auth-changed"));
  }, []);

  // Sign out 由主菜单触发（已从 Open 对话框移出）
  useEffect(() => {
    const signoutHandler = () => logout();
    window.addEventListener("ws:signout", signoutHandler);
    return () => window.removeEventListener("ws:signout", signoutHandler);
  }, [logout]);

  const openScene = async (scene: SceneMeta) => {
    setBusy(true);
    setError("");
    try {
      const data = await api<SceneFull>(`/api/scenes/${scene.id}`, { token });
      excalidrawAPI.updateScene({
        elements: restoreElements(data.elements, null) as any,
        appState: {
          viewBackgroundColor: (data.appState as any)?.viewBackgroundColor,
        },
      });
      setCurrentSceneId(scene.id);
      persistCurrent(scene.id, displaySceneName(data.name));
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteScene = async (id: number) => {
    try {
      await api(`/api/scenes/${id}`, { method: "DELETE", token });
      if (currentSceneId === id) {
        setCurrentSceneId(null);
        persistCurrent(null, "");
      }
      loadScenes();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const fmtTime = (s: string) => s.replace("T", " ").slice(0, 16);

  return (
    <>
      {open && (
        <Dialog
          onCloseRequest={() => setOpen(false)}
          title="Open"
          size="small"
          closeOnClickOutside
        >
          <div className="WorkspacePanel__section">
            <div className="WorkspacePanel__sectionHeader">Open from cloud</div>
            {!token ? (
              <div>
                <TextField
                  value={userInput}
                  onChange={setUserInput}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                    e.key === "Enter" && login()
                  }
                  placeholder="Username"
                  fullWidth
                />
                <div className="WorkspacePanel__actionsRow">
                  <DialogActionButton
                    label={busy ? "Signing in…" : "Sign in"}
                    isLoading={busy}
                    onClick={() => login()}
                  />
                </div>
              </div>
            ) : (
              <div>
                {scenes.length === 0 && (
                  <div className="WorkspacePanel__empty">
                    No cloud canvases yet
                  </div>
                )}
                {scenes.map((s) => (
                  <div
                    key={s.id}
                    className="WorkspacePanel__scene"
                    role="button"
                    tabIndex={0}
                    onClick={() => openScene(s)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openScene(s);
                      }
                    }}
                  >
                    <div className="WorkspacePanel__sceneInfo">
                      <div className="WorkspacePanel__sceneName">
                        {displaySceneName(s.name)}
                      </div>
                      <div className="WorkspacePanel__sceneMeta">
                        {fmtTime(s.updated_at)}
                        {currentSceneId === s.id && " · current"}
                      </div>
                    </div>
                    <div
                      className="WorkspacePanel__actions"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      <IconButton
                        type="icon"
                        icon={removeIcon}
                        aria-label="Remove"
                        title="Remove"
                        size="small"
                        className="WorkspacePanel__remove"
                        onClick={() => deleteScene(s.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="WorkspacePanel__section">
            <div className="WorkspacePanel__sectionHeader">Open from file</div>
            <DialogActionButton
              label="Open file…"
              onClick={() => {
                loadFromJSON(
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getSceneElements(),
                )
                  .then(({ elements, appState, files }) => {
                    excalidrawAPI.updateScene({ elements, appState });
                    if (files && Object.keys(files).length > 0) {
                      excalidrawAPI.addFiles(
                        Object.values(files) as BinaryFileData[],
                      );
                    }
                    setOpen(false);
                  })
                  .catch((e: any) => {
                    if (e?.name !== "AbortError") {
                      setError(e?.message || "Failed to open file");
                    }
                  });
              }}
            />
          </div>

          {error && <div className="WorkspacePanel__error">{error}</div>}
        </Dialog>
      )}
    </>
  );
};

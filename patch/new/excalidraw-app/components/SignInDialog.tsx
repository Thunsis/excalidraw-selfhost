import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import DialogActionButton from "@excalidraw/excalidraw/components/DialogActionButton";
import { TextField } from "@excalidraw/excalidraw/components/TextField";

import { API_BASE, setAuth } from "./workspaceCloud";

/**
 * Sign-in 对话框：只做登录（身份动作）。
 * 触发事件：ws:open-signin（顶栏 Sign in / 欢迎页 / Save to Cloud 未登录 / AI 门槛）
 * 登录成功 → setAuth()（写入 store + 广播 ws:auth-changed）→ 自动关闭。
 * 场景列表/素材库/AI 门槛各自订阅 ws:auth-changed 刷新，无需本对话框关心。
 */
export const SignInDialog = () => {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("ws:open-signin", handler);
    return () => window.removeEventListener("ws:open-signin", handler);
  }, []);

  const login = useCallback(async () => {
    const name = username.trim();
    if (!name) {
      setError("Please enter your username");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as any).error || "Sign in failed");
      }
      setAuth(body.token, body.user?.username || name);
      setOpen(false);
      setUsername("");
    } catch (e: any) {
      setError(e.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  }, [username]);

  return (
    <>
      {open && (
        <Dialog
          onCloseRequest={() => setOpen(false)}
          title="Sign in"
          size="small"
          closeOnClickOutside
        >
          <TextField
            value={username}
            onChange={setUsername}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                login();
              }
            }}
            placeholder="Username"
            fullWidth
          />
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "0.75rem",
            }}
          >
            <DialogActionButton
              label={busy ? "Signing in…" : "Sign in"}
              isLoading={busy}
              onClick={login}
            />
          </div>
          {error && (
            <div style={{ color: "#e03131", marginTop: "0.5rem", fontSize: 13 }}>
              {error}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
};

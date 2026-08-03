import React from "react";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";
import { exportToPlus } from "@excalidraw/excalidraw/components/icons";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { generateSceneStorageName, getToken, openSignIn, renameSceneWithAI } from "./workspaceCloud";

/**
 * "Save as new canvas" card: replaces the native "Export to Excalidraw+" card.
 * Manual save = Save As: always creates a NEW cloud canvas, then binds it so
 * subsequent edits are auto-saved (2s debounce) to that canvas.
 * Not signed in → opens the sign-in panel.
 * Naming: 先以时间戳为存储名立即保存 → 保存成功后异步 AI 总结更新名字（保留时间戳后缀）。
 */
export const SaveToCloud: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ elements, appState, onError, onSuccess }) => {
  const token = getToken();

  const handleClick = async () => {
    if (!token) {
      openSignIn();
      return;
    }
    try {
      const name = generateSceneStorageName();
      // 移动网络下大请求会拖慢连接：保存场景本身数据小，给 20s 超时，
      // 超时/失败时抛出带原因的 Error，让用户看到具体问题而非笼统的 failed。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch("/ws-api/api/scenes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          elements,
          appState: {
            viewBackgroundColor: (appState as any)?.viewBackgroundColor,
          },
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as any).error || `HTTP ${res.status}`);
      }
      // 绑定新场景：之后所有修改自动保存到它
      window.dispatchEvent(
        new CustomEvent("ws:scene-created", {
          detail: { id: body.id, name },
        }),
      );
      // 保存成功后异步 AI 总结更新名字（不阻塞，失败静默保持时间戳名）
      void renameSceneWithAI(body.id, elements, name);
      onSuccess();
    } catch (error: any) {
      console.error("Save as new canvas failed (v2)", error);
      const reason =
        error?.name === "AbortError"
          ? "Request timed out — weak network?"
          : error?.message || "unknown error";
      onError(new Error(`Save as new canvas failed (v2): ${reason}`));
    }
  };

  return (
    <Card color="primary">
      <div className="Card-icon">{exportToPlus}</div>
      <h2>Save as new canvas</h2>
      <div className="Card-details">
        Create a new cloud canvas from the current drawing
      </div>
      <IconButton
        className="Card-button"
        type="button"
        title={token ? "Save to Cloud" : "Sign in"}
        aria-label={token ? "Save to Cloud" : "Sign in"}
        showAriaLabel={true}
        onClick={handleClick}
      />
    </Card>
  );
};

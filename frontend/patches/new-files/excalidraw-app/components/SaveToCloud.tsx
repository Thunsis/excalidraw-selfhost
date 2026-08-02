import React from "react";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";
import { exportToPlus } from "@excalidraw/excalidraw/components/icons";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { generateSceneStorageName, renameSceneWithAI } from "./workspaceCloud";

/**
 * "Save as new canvas" card: replaces the native "Export to Excalidraw+" card.
 * Manual save = Save As: always creates a NEW cloud canvas, then binds it so
 * subsequent edits are auto-saved (2s debounce) to that canvas.
 * Not signed in → opens the sign-in panel.
 * Naming: 先以时间戳为存储名立即保存 → 保存成功后异步调 AI 总结更新名字（保留时间戳后缀）。
 */
export const SaveToCloud: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ elements, appState, onError, onSuccess }) => {
  const token = localStorage.getItem("excalidraw-ws-token");

  const handleClick = async () => {
    if (!token) {
      window.dispatchEvent(new CustomEvent("ws:open-panel"));
      return;
    }
    try {
      const name = generateSceneStorageName();
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
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as any).error || "Save failed");
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
      onError(new Error("Save as new canvas failed (v2)"));
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
        title={token ? "Save" : "Sign in"}
        aria-label={token ? "Save" : "Sign in"}
        showAriaLabel={true}
        onClick={handleClick}
      />
    </Card>
  );
};

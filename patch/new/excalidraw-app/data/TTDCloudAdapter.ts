import { createStore, get, set } from "idb-keyval";

import type { SavedChats } from "@excalidraw/excalidraw/components/TTDDialog/types";

import { STORAGE_KEYS } from "../app_constants";

/**
 * TTD 聊天历史账号化存储 adapter。
 *
 * 登录（有 excalidraw-ws-token）→ 云端 user-data（跨设备、跟账号走）；
 * 未登录 → 回退本地 IndexedDB（原行为）。
 *
 * 登录/登出切换由 AI.tsx 监听 ws:auth-changed 重置 TTD 全局状态触发重载。
 * 实现了 TTDPersistenceAdapter 接口（loadChats / saveChats 静态方法）。
 */
export class TTDCloudAdapter {
  private static idb_name = STORAGE_KEYS.IDB_TTD_CHATS;
  private static key = "ttdChats";

  private static store = createStore(
    `${TTDCloudAdapter.idb_name}-db`,
    `${TTDCloudAdapter.idb_name}-store`,
  );

  private static isSignedIn(): boolean {
    return !!localStorage.getItem("excalidraw-ws-token");
  }

  private static async loadFromCloud(): Promise<SavedChats> {
    const token = localStorage.getItem("excalidraw-ws-token");
    if (!token) {
      return [];
    }
    const res = await fetch("/ws-api/api/user-data/ttd_chats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return [];
    }
    const body = await res.json().catch(() => ({}));
    return Array.isArray(body?.value) ? (body.value as SavedChats) : [];
  }

  private static async saveToCloud(chats: SavedChats): Promise<void> {
    const token = localStorage.getItem("excalidraw-ws-token");
    if (!token) {
      throw new Error("Not signed in");
    }
    const res = await fetch("/ws-api/api/user-data/ttd_chats", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ value: chats }),
    });
    if (!res.ok) {
      throw new Error(`Failed to save chats (${res.status})`);
    }
  }

  static async loadChats(): Promise<SavedChats> {
    try {
      if (TTDCloudAdapter.isSignedIn()) {
        return await TTDCloudAdapter.loadFromCloud();
      }
      const data = await get<SavedChats>(
        TTDCloudAdapter.key,
        TTDCloudAdapter.store,
      );
      return data || [];
    } catch (error) {
      console.warn("Failed to load TTD chats:", error);
      return [];
    }
  }

  static async saveChats(chats: SavedChats): Promise<void> {
    // 双写：本地 IndexedDB 始终保留（离线兜底），登录时同时推云端
    try {
      await set(TTDCloudAdapter.key, chats, TTDCloudAdapter.store);
    } catch (error) {
      console.warn("Failed to save TTD chats locally:", error);
      throw error;
    }
    if (TTDCloudAdapter.isSignedIn()) {
      await TTDCloudAdapter.saveToCloud(chats);
    }
  }
}

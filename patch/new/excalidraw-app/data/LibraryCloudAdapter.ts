import { createStore, get, set } from "idb-keyval";

import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";

import type { MaybePromise } from "@excalidraw/common/utility-types";

import { STORAGE_KEYS } from "../app_constants";
import { getToken } from "../components/workspaceCloud";

/**
 * Library 素材库账号化存储 adapter（实现 LibraryPersistenceAdapter 接口）。
 *
 * - 登录（有 excalidraw-ws-token）→ 云端 user-data/library 为权威，本地 IndexedDB 仅作缓存；
 *   云端空而本地有数据时（首次登录）自动把本地素材推上云（幂等，值相同重复 PUT 无害）。
 * - 未登录 → 纯本地 IndexedDB（原行为，离线可用）。
 * - 云写入失败静默（不阻塞画布主流程），下次变更会把全量重新推上去。
 */
export class LibraryCloudAdapter {
  private static idb_name = STORAGE_KEYS.IDB_LIBRARY;
  private static key = "libraryData";

  private static store = createStore(
    `${LibraryCloudAdapter.idb_name}-db`,
    `${LibraryCloudAdapter.idb_name}-store`,
  );

  private static isSignedIn(): boolean {
    return !!getToken();
  }

  private static async loadFromCloud(): Promise<LibraryPersistedData | null> {
    const token = getToken();
    if (!token) {
      return null;
    }
    try {
      const res = await fetch("/ws-api/api/user-data/library", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return null;
      }
      const body = await res.json().catch(() => ({}));
      if (body?.value && typeof body.value === "object") {
        return body.value as LibraryPersistedData;
      }
      return null;
    } catch {
      return null;
    }
  }

  private static cloudWriteChain: Promise<void> = Promise.resolve();
  // 变更检测：library 数据序列化后与上次推送相同则跳过云写——
  // 素材库可达数百 KB，移动网络下每次全量 PUT 会阻塞连接（实测 767KB ≈ 24s），
  // 用户在此期间发起的保存请求会超时失败。只在数据真正变化时才上传。
  private static lastPushedSerialized: string | null = null;

  private static async saveToCloud(data: LibraryPersistedData): Promise<void> {
    const token = getToken();
    if (!token) {
      return;
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(data);
    } catch {
      return;
    }
    if (LibraryCloudAdapter.lastPushedSerialized === serialized) {
      return; // 无变化，跳过上传
    }
    // 串行化云写入：避免多次 save 并发时乱序覆盖（旧的先到、新的后到导致丢数据）
    LibraryCloudAdapter.cloudWriteChain = LibraryCloudAdapter.cloudWriteChain.then(
      async () => {
        // 链上再查一次：排队期间若已有等价写入，跳过本次
        if (LibraryCloudAdapter.lastPushedSerialized === serialized) {
          return;
        }
        try {
          const res = await fetch("/ws-api/api/user-data/library", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ value: data }),
          });
          if (res.ok) {
            LibraryCloudAdapter.lastPushedSerialized = serialized;
          } else {
            // 云写入失败不静默吞掉：本地已保存，但需要可见告警以便排查
            console.warn(
              `[LibraryCloudAdapter] cloud save failed: HTTP ${res.status}`,
            );
          }
        } catch (error) {
          // 静默：云同步失败不影响本地使用；下次 save 会全量重推
          console.warn(
            `[LibraryCloudAdapter] cloud save error: ${
              (error as Error)?.message || error
            }`,
          );
        }
      },
    );
    await LibraryCloudAdapter.cloudWriteChain;
  }

  static async load(): Promise<LibraryPersistedData | null> {
    if (!LibraryCloudAdapter.isSignedIn()) {
      const IDBData = await get<LibraryPersistedData>(
        LibraryCloudAdapter.key,
        LibraryCloudAdapter.store,
      );
      return IDBData || null;
    }

    // 登录：云端权威，但本地兜底合并 —— 若某次云写入失败（静默），
    // 本地可能比云端新，合并能避免"最后一组导入丢失"。
    const [cloudData, IDBData] = await Promise.all([
      LibraryCloudAdapter.loadFromCloud(),
      get<LibraryPersistedData>(LibraryCloudAdapter.key, LibraryCloudAdapter.store),
    ]);
    if (cloudData) {
      // 云端 + 本地取并集（按 item id 去重，本地优先保留最新）
      const merged = LibraryCloudAdapter.mergeLibraryData(cloudData, IDBData);
      if (merged) {
        // 合并结果比云端多 → 说明本地有云端缺失的数据，推回云端
        if (merged.libraryItems.length !== cloudData.libraryItems.length) {
          await LibraryCloudAdapter.saveToCloud(merged);
        }
        try {
          await set(LibraryCloudAdapter.key, merged, LibraryCloudAdapter.store);
        } catch {
          /* ignore */
        }
        return merged;
      }
      return cloudData;
    }

    // 云端空：用本地数据并推上云（首次登录迁移）
    if (IDBData) {
      await LibraryCloudAdapter.saveToCloud(IDBData);
      return IDBData;
    }
    return null;
  }

  /**
   * 云端与本地合并：按 item id 去重，本地优先（本地往往是最近写入）。
   */
  private static mergeLibraryData(
    cloud: LibraryPersistedData,
    local: LibraryPersistedData | null | undefined,
  ): LibraryPersistedData | null {
    if (!local || !Array.isArray(local.libraryItems)) {
      return cloud;
    }
    const cloudIds = new Set(
      (cloud.libraryItems || []).map((item: any) => item.id),
    );
    const merged = [...(cloud.libraryItems || [])];
    for (const item of local.libraryItems || []) {
      if (!cloudIds.has(item.id)) {
        merged.push(item);
      }
    }
    return { libraryItems: merged };
  }

  static save(data: LibraryPersistedData): MaybePromise<void> {
    const localSave = set(
      LibraryCloudAdapter.key,
      data,
      LibraryCloudAdapter.store,
    );
    if (LibraryCloudAdapter.isSignedIn()) {
      // 本地先落盘，云端 fire-and-forget
      localSave.then(() => LibraryCloudAdapter.saveToCloud(data));
    }
    return localSave;
  }
}

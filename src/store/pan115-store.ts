import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import { idbStorage } from "@/lib/storage-adapter";
import { storeKey } from "./store-keys";
import type { Pan115Account } from "@/types/pan115";

/** 待重命名任务：存到 115 时若重命名未完成（下载中/会话过期），先入队，登录有效后自动补做 */
export interface Pan115RenameTask {
  id: string;
  accountId: string;
  /** 目标目录 cid（音乐库） */
  cid: string;
  /** 网易云直链（用于提取 hash 文件名 / 预测 115 保存名） */
  url: string;
  /** 期望显示名（不含扩展名），如 "渡口 - 蔡琴" */
  displayBase: string;
  hashName: string;
  expectedName: string;
  createdAt: number;
}

interface Pan115State {
  accounts: Pan115Account[];
  renameQueue: Pan115RenameTask[];
  addAccount: (data: Omit<Pan115Account, "id" | "is_deleted" | "update_time">) => string;
  updateAccount: (
    id: string,
    data: Partial<Pick<Pan115Account, "name" | "uid" | "cid" | "seid" | "rootCid" | "downloadCid" | "accessToken" | "refreshToken">>
  ) => void;
  removeAccount: (id: string) => void;
  enqueueRename: (task: Omit<Pan115RenameTask, "id" | "createdAt">) => string;
  dequeueRename: (id: string) => void;
  /** 丢弃过期的待重命名任务（默认 7 天），避免队列无限增长 */
  clearExpiredRenames: (maxAgeMs?: number) => void;
}

const touch = (item: Pan115Account): Pan115Account => ({
  ...item,
  update_time: Date.now(),
});

export const usePan115Store = create<Pan115State>()(
  persist(
    (set) => ({
      accounts: [],
      renameQueue: [],
      addAccount: (data) => {
        const id = uuidv4();
        set((state) => ({
          accounts: [
            touch({ ...data, id, is_deleted: false }),
            ...state.accounts,
          ],
        }));
        return id;
      },
      updateAccount: (id, data) =>
        set((state) => ({
          accounts: state.accounts.map((item) =>
            item.id === id
              ? touch({ ...item, ...data, is_deleted: false })
              : item
          ),
        })),
      removeAccount: (id) =>
        set((state) => ({
          accounts: state.accounts.map((item) =>
            item.id === id ? touch({ ...item, is_deleted: true }) : item
          ),
        })),
      enqueueRename: (task) => {
        const id = uuidv4();
        set((state) => ({
          renameQueue: [
            { ...task, id, createdAt: Date.now() },
            ...state.renameQueue,
          ],
        }));
        return id;
      },
      dequeueRename: (id) =>
        set((state) => ({
          renameQueue: state.renameQueue.filter((t) => t.id !== id),
        })),
      clearExpiredRenames: (maxAgeMs = 7 * 24 * 60 * 60 * 1000) =>
        set((state) => ({
          renameQueue: state.renameQueue.filter(
            (t) => Date.now() - t.createdAt < maxAgeMs
          ),
        })),
    }),
    {
      name: storeKey.Pan115Store,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ accounts: state.accounts, renameQueue: state.renameQueue }),
    }
  )
);

/**
 * 115 网盘账号配置
 * - UID / CID / SEID：从浏览器 Cookie 中复制，是 115 Web 端的鉴权三件套（网页会话短效，约 10-15 分钟）
 * - rootCid：浏览起始目录，0 = 根目录
 * - downloadCid：离线下载默认存放目录，0 = 默认（云下载目录）
 * - accessToken / refreshToken：115 开放平台 Bearer token（授权码登录获得）。
 *   有 token 时所有请求走 proapi.115.com/open/* 接口（Bearer 鉴权），refresh_token 可自动续期，不受网页会话失效影响。
 */
export interface Pan115Account {
  id: string;
  /** 显示名，如"我的115" */
  name: string;
  uid: string;
  cid: string;
  seid: string;
  /** 浏览根目录 cid，默认 "0" */
  rootCid: string;
  /** 离线下载默认目录 cid，默认 "0" */
  downloadCid: string;
  /** 开放平台 access_token（有则优先走 open API） */
  accessToken?: string;
  /** 开放平台 refresh_token（用于自动续期） */
  refreshToken?: string;
  update_time?: number;
  is_deleted?: boolean;
}

/** 115 files 接口返回的目录项 */
export interface Pan115FsItem {
  /** 文件 fid。注意：目录项没有 fid，用 cid 表示自身 id（参考 115driver） */
  fid?: string;
  /** 目录项：自身 cid；文件项：父目录 cid */
  cid?: string;
  n: string;
  /** 注意：115 API 不返回 d 字段，判断目录请用 isDirItem()（有 cid 无 fid） */
  d?: number;
  /** 文件大小（字节） */
  s?: number;
  /** pickcode，文件下载直链换取凭证 */
  pc?: string;
  /** 文件扩展名，如 mp3/flac */
  ico?: string;
  /** 父目录 cid */
  pid?: string;
}

/** files/download 接口返回 */
export interface Pan115DownloadInfo {
  /** 真实下载直链 */
  url: string;
  /** 文件名 */
  file_name?: string;
  /** 文件大小 */
  file_size?: string;
}

/** 离线下载 add_task_urls 返回 */
export interface Pan115AddOfflineResult {
  state?: number;
  error_code?: number;
  error_msg?: string;
  hash?: string;
  /** 115 返回的任务明细（含 info_hash 用于 get_task_list 状态跟踪） */
  data?: Array<{
    info_hash?: string;
    url?: string;
    state?: boolean | number;
    code?: number;
    message?: string;
  }>;
  /**
   * 提交后的自动重命名结果：
   * - ok：下载完成并已重命名为「歌名 - 演唱者」
   * - login_expired：115 登录已过期（errNo 990001），未能重命名
   * - timeout：等待下载超时，未能重命名
   * - rename_failed：文件已落盘但重命名一直失败（保留队列，由定时器补改名）
   * - failed：离线任务本身失败（stat=-1），丢弃队列避免僵尸
   * - skipped：未传 displayBase，未尝试重命名
   */
  renameStatus?: "ok" | "login_expired" | "timeout" | "rename_failed" | "failed" | "skipped";
}

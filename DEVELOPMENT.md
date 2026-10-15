# Otter Music 开发文档

> 版本：v2.7.9（Android 交付基线）· 更新日期：2026-10-15
>
> Otter Music（水獭音乐）是一款基于 **React 19 + TypeScript + Vite + Capacitor** 的
> **多音源聚合音乐播放器**（Android 原生端），并深度集成了 **115 网盘**：浏览/搜索/
> 播放网盘音乐、把任意歌曲「存到 115 网盘」、自动刮削封面/歌词/专辑名。

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [总体架构](#3-总体架构)
4. [目录结构说明](#4-目录结构说明)
5. [多音源 Provider 体系](#5-多音源-provider-体系)
6. [115 网盘集成（核心）](#6-115-网盘集成核心)
7. [播放生态与 UI 交互](#7-播放生态与-ui-交互)
8. [状态管理（Zustand Store）](#8-状态管理zustand-store)
9. [日志系统](#9-日志系统)
10. [构建与发布流程](#10-构建与发布流程)
11. [测试](#11-测试)
12. [已知问题与注意事项](#12-已知问题与注意事项)

---

## 1. 项目概览

| 项 | 值 |
|---|---|
| 应用名 / 包名 | Otter Music / `com.otterhub.music` |
| 平台 | Android（minSdk 24 / Android 7.0+），Web 分支属历史遗留 |
| 核心能力 | 多音源搜索播放、歌单广场、下载管理、歌词/封面刮削、115 网盘存取 |
| 数据存储 | IndexedDB（Zustand persist）、localStorage（缓存/日志）、Cloudflare KV（可选同步） |
| 后端 | Cloudflare Workers（Hono），提供音乐 API 代理与 115 专用代理 |

### 功能速览

- **多音源聚合与回退**：网易云、Netease 官方、Joox、B站、酷我、咪咕、QQ、Higequ、Jamendo、酷狗（导入）、本地、播客、Alist、115 网盘。
- **115 网盘**：账号管理（Cookie / Open Authorize 登录）、目录浏览、音乐库整树平铺、全局搜索（本地音乐库 → 全盘扫描 → 服务端搜索三级兜底）、代理流播放（规避防盗链）、封面/歌词/专辑刮削、「存到 115」离线下载（提交定名 + 队列改名兜底）。
- **播放生态**：播放列表、最近播放、个人歌单、歌词面板、音质选择、倍速、睡眠定时、横屏播放、车载蓝牙歌词、全屏播放器、底部播放栏（左滑下一曲/右滑上一曲 + 跟随滑动动画）。
- **歌单广场**：网易云歌单、Billboard / 金曲奖 / 格莱美榜单、RSS 播客、Alist 站点。
- **下载管理**：可选音质、目标目录、嵌入歌词/封面。
- **数据备份**：JSON 导出/导入、WebDAV 同步。

---

## 2. 技术栈与依赖

### 前端

| 技术 | 版本 | 说明 |
|---|---|---|
| React | 19.2 | UI 框架 |
| TypeScript | 5.9 | 全量类型检查（`tsc -b`） |
| Vite | 7.3 | 构建（含 PWA 插件） |
| Tailwind CSS | 4.1 | 样式（PostCSS 插件），`tw-animate-css` 动画 |
| Zustand | 5.0 | 状态管理 + `partialize` 选择性持久化 |
| react-router-dom | 7.13 | 路由 |
| SWR | 2.4 | 数据请求缓存 |
| lucide-react | 0.563 | 图标 |
| radix-ui / vaul | 1.x | 弹层 / Drawer 组件 |
| @dnd-kit | 6/9/10 | 歌单拖拽排序 |
| idb-keyval | 6.2 | IndexedDB 读写 |
| browser-id3-writer | 6.3 | 写 ID3 标签（下载嵌入） |

### 原生（Capacitor 8）

| 插件 | 说明 |
|---|---|
| @capacitor/android / core / app | 容器与生命周期 |
| @capacitor/filesystem | 本地音乐、下载目录 |
| @capacitor/network | 网络状态 |
| @capacitor/status-bar / screen-orientation | 系统栏 / 横屏 |
| @capacitor/clipboard | 剪贴板 |
| @jofr/capacitor-media-session | 媒体会话（锁屏控制） |
| 自定义插件 | `src/plugins/`：LocalMusic、BilibiliProxy、AudioRoute、WebViewLogin（Java 实现在 `android/`） |

### 后端（functions workspace）

- **Cloudflare Workers + Hono**：`functions/app.ts` 注册路由；`functions/routes/pan115.ts` 提供 `/pan115/fetch` 专用代理（仅透传 `*.115.com`，不落盘凭证）。
- 音乐 API 代理：统一 `getApiUrl()`（默认 `https://otter-music.pages.dev`），前端所有跨域请求经此代理。

> 注意：`/pan115/fetch` 目前返回 405（长期未修），代码中已跳过该路由，115 请求全部走
> `open` 长会话通道（Bearer token），见 [6.1](#61-登录与-open-长会话)。

---

## 3. 总体架构

```
┌────────────────────────────── Android App（Capacitor WebView） ─────────────────────────────┐
│  src/components      UI 页面与组件（Web/Android 共享）                                        │
│  src/hooks           播放控制与行为钩子                                                        │
│  src/lib             共享逻辑：API 客户端 / Provider / 存储 / 工具                              │
│  src/store           Zustand store（partialize 持久化到 IndexedDB）                            │
│  src/plugins         自定义 Capacitor 插件 TS 接口（Java 实现在 android/）                     │
│  src/routes, router  路由                                                                     │
└──────────────┬──────────────────────────────────────────────────────────────────┬────────────┘
               │ HTTPS（经 Cloudflare Worker 代理，规避 CORS）                      │
┌──────────────▼──────────────────────────┐        ┌───────────────────────────────▼─────────────┐
│ functions/  Cloudflare Workers (Hono)   │        │ 外部音源                         │
│  · /music-api?types=search... 聚合代理   │        │  · 网易云/GD Studio/酷我/QQ/B站...│
│  · /pan115/fetch 115 专用代理（已停用）  │        │  · 115 网盘 proapi.115.com       │
└─────────────────────────────────────────┘        │  · lixian.115.com 离线下载        │
                                                   └───────────────────────────────────┘
```

- 平台检测入口：`src/lib/api/config.ts` 中 `IS_NATIVE = Capacitor.isNativePlatform()`。
- 所有外部 API 调用统一走 `src/lib/api/config.ts` 的平台感知 URL 选择与超时逻辑，新增调用应复用该层。
- 115 直链播放走「代理流」`buildProxyStreamUrl`（见 6.4）。

---

## 4. 目录结构说明

```
otter-music/
├── android/                  # Capacitor Android 工程（自定义插件 Java 实现）
│   └── app/build.gradle      # versionCode/versionName、JDK 21、minSdk 24
├── capacitor.config.ts       # Capacitor 配置（appId/appName/webDir=dist）
├── components.json           # shadcn 风格组件配置
├── functions/                # Cloudflare Workers（Hono），npm workspace
├── shared/                   # 前后端共享代码（@otter-music/shared）
├── src/
│   ├── App.tsx / main.tsx / Layout.tsx / router.tsx
│   ├── assets/global.css     # 全局样式（含 dots-rhythm 律动 keyframes 等）
│   ├── components/
│   │   ├── PlaylistMarket/   # 歌单广场（Pan115/ Alist/ Billboard/ Awards/ Podcast/ Mine…）
│   │   │   └── Pan115/       # 115 账号卡片/添加/浏览器（Pan115Browser.tsx）
│   │   ├── settings/         # 设置页（IssueLogs 诊断日志、下载、歌词样式等）
│   │   ├── MusicNowPlayingBar.tsx   # 底部播放栏（滑动切歌 + 跟随动画）
│   │   ├── MusicTrackList.tsx / MusicTrackItem.tsx   # 歌曲列表（懒加载 + 行组件）
│   │   ├── FullScreenPlayer.tsx / LandscapePlayer.tsx / LyricsPanel.tsx
│   │   └── …（其余页面组件）
│   ├── hooks/                # 播放控制 hooks
│   ├── lib/
│   │   ├── api/config.ts     # getApiUrl() / IS_NATIVE / 超时（平台感知）
│   │   ├── logger.ts         # 环形日志（MAX_LOG_ENTRIES=200，localStorage 持久化）
│   │   ├── music-provider/   # Provider 体系（base/interface/factory/providers/…）
│   │   │   └── providers/pan115-provider.ts   # 115 Provider + 刮削 + 代理流
│   │   ├── pan115/           # 115 API 封装（api.ts）+ m115 加密（m115.ts）
│   │   ├── netease/ bilibili/ kugou/ kuwo/ …  # 各音源 API
│   │   └── utils/ webdav/ …
│   ├── plugins/              # 自定义 Capacitor 插件 TS 接口
│   ├── routes/               # 路由包装 / 预加载
│   ├── store/                # Zustand stores（music-store 分片、pan115-store 等）
│   ├── sw.ts                 # PWA Service Worker
│   └── types/                # 全局类型（music.ts / pan115.ts / alist.ts …）
├── scripts/                  # 版本号更新 / CI 测试 / 校验脚本
├── patches/                  # patch-package 固化第三方插件修改
├── public/ icons/
├── package.json              # scripts 与依赖
└── PAN115_INTEGRATION.md     # 115 集成原始说明（早期 Cookie 方案）
```

---

## 5. 多音源 Provider 体系

### 5.1 结构

| 文件 | 职责 |
|---|---|
| `interface.ts` | `IMusicProvider` 接口：search / getTrackUrl / getLyric / getPic 等 |
| `base-provider.ts` | 公共基类（解析文件名、音频 URL 判定等） |
| `factory.ts` | 按 `MusicSource` 分发 Provider |
| `utils.ts` / `types.ts` | 通用工具与类型 |
| `aggregate-provider.ts` | 聚合搜索（多源并行 + 结果合并） |
| `providers/*.ts` | 各音源实现（netease / qq / bilibili / pan115 / local …） |

### 5.2 关键约定

- 每个音源实现搜索、播放 URL 解析、歌词、封面四类能力；缺失能力返回空/降级。
- 播放失败自动回退：本地下载缓存 → 其他可用音源 → 代理 → 下一首（`audio-resolver.ts` + `audio-match.ts` 负责匹配与回退决策）。
- 搜索结果统一为 `MusicTrack`（`src/types/music.ts`），`MusicSource` 联合类型包含 `"pan115"`。
- 115 不参与全局聚合搜索（私人文件不进公共结果），独立入口浏览/搜索。

---

## 6. 115 网盘集成（核心）

115 集成是本项目最复杂、迭代最多的模块，涉及 **登录鉴权、目录浏览、音乐库、
全局搜索、播放防防盗链、离线下载存歌、封面歌词专辑刮削** 七条链路。

### 6.1 登录与 Open 长会话

**双通道登录**（`src/lib/pan115/api.ts`）：

1. **Cookie 登录**：`verifyByCookie(cookieStr)` —— 用户在 115 网页复制 `UID/CID/SEID`
   （早期方案，`parseCookie` 解析后验证）。
2. **Open Authorize 升级（主通道）**：`loginByOpenAuthorize()` →
   `createOpenAuthRequest()` 生成授权链接 → WebView 打开 115 授权页 →
   `waitOpenAuthConfirm()` 轮询确认 → `upgradeToOpenAuthorize(cookie)` 用 Cookie 换
   **access_token + refresh_token**，此后 115 请求全部走 **open 长会话 Bearer 通道**
   （`proapi.115.com/open/...`）。

**Token 自动续期**（`refreshAccessToken`）：

- 失效码集合：`40140123 / 40140124 / 40140125 / 40140126 / 40140123 抖动` 全部视为失效。
- 续期只传 `refresh_token`（`refresh_token_open` 语义），成功回写 access_token。
- 瞬时校验抖动：401 后等待 **1.2s** 用原 token 重试一次，仍失败才刷新（`pan115Fetch` 内实现）。

**关键常量**：`OPEN_APP_ID=100195125`；账号结构见 `src/types/pan115.ts`（`Pan115Account` 含
`uid / name / cookies / accessToken / refreshToken / browseRootCid / downloadDirCid`）。

### 6.2 目录浏览与音乐库

| 能力 | 实现 |
|---|---|
| 列目录 | `GET proapi.115.com/open/ufile/files?cid=&limit=500&offset=&o=user_ptime&asc=0&show_dir=1&natsort=1&record_open_time=0`（`listFiles` 分页循环） |
| 目录判定 | `isDirItem`：open 接口不返回 `d` 字段 → 依据 `fid` 存在性 / `fc` 判定（v73 修复） |
| 字段兼容 | `normalizeOpenFsItem`：兼容 `file_id/file_name/sha1/pick_code` 新字段与旧 `fid/fn/pc` |
| 音乐库 | `getOrCreateMusicFolder`：按账号查找/创建「音乐库」文件夹，cid 存 `localStorage` 缓存（命中日志 `pan115-music-folder: 命中"音乐库"文件夹缓存`）；`listMusicLibraryTracks` 整树平铺 |
| 扫描 | `scanAllAudio` 全盘递归扫描音频（mp3/flac/wav/m4a/ape/ogg…），`isAudioFile` 过滤 |

### 6.3 全局搜索（三级兜底）

`searchMusicLibraryLocal` → `searchAllAudioLocal` → `searchFiles`（服务端全盘）：

1. **本地音乐库**：先查已缓存的「音乐库」平铺列表（内存/缓存命中最快）；
2. **全盘扫描兜底**：本地未命中时对已扫描目录递归过滤（`searchAllAudioLocal`）；
3. **服务端搜索**：`GET /open/ufile/search?cid=0&search_value=<kw>&limit=200&type=0&o=user_ptime&asc=0`
   → `searchMusicFiles` 用 `isAudioFile` 过滤歌曲。

日志佐证：`pan115: 本地音乐库无命中，尝试服务端全盘搜索兜底` → `pan115-search: 开始搜索…`
→ `pan115-search: open 搜索完成 count=N`。**搜索返回的是网盘全文件结果**（含非音频），
客户端 `isAudioFile` 二次过滤后 toast「未查询到相关歌曲」属于**真实无匹配**（非 bug）。

### 6.4 播放与防盗链（代理流）

- **直链获取**：`POST proapi.115.com/open/ufile/downurl`，body `pick_code=<pc>`
  （**弃用** `GET /open/ufile/download`，其返回 980006 不可用）。
- **防盗链**：115 直链带 `f=1`（需一致 UA）或 `f=3`（需 UA+Cookie）参数；
  直接 `<audio>` 播放会被拒。解决：`buildProxyStreamUrl` ——
  `${getApiUrl()}/proxy?url=<encodeURIComponent(直链)>&headers=<encodeURIComponent(JSON{User-Agent:UA_BROWSER, Referer:https://115.com/})}`，
  `UA_BROWSER` 为 Android Chrome 120 UA。
- 直链有时效（数小时），`url-cache-store` 缓存 + 过期重取。

### 6.5 存到 115（离线下载 · 双通道定名）

「存到 115」把当前歌曲真实播放直链提交到 115 云下载，**保证落盘文件名 = 「歌名 - 演唱者.ext」**，
采用双通道（v63 实机验证 + 开源学习确认业界最强）：

1. **提交定名（主通道）**：`POST /open/offline/add_task_urls`，body 额外携带
   `savepath: "歌名 - 演唱者.ext"`（115 未文档化但被 open 接口接受，`state:true/code:0`）；
2. **改名兜底（open 拒绝时）**：捕获 `Pan115OpenApiError` 自动回退无定名提交，
   落盘后由 `waitForDownloadAndRename` + `processRenameQueue`（5 分钟定时器 + 3h 僵尸清理）改名。

**队列状态机**（v69/v80 修正）：

| 状态 | 含义 | 处置 |
|---|---|---|
| `-1` | 任务失败（stat=-1） | `failed`：出队丢弃，防僵尸 |
| `0` | 分配中 | 保留队列等待 |
| `1` | 下载中 | 保留队列等待 |
| `2` | 成功 | `ok` 出队 |
| `rename_failed` | 文件已落盘但改名失败 | 保留队列，定时器补改名（v80 新增，不再误丢） |
| `timeout` | open 路径 catch 异常 | 保留队列重试（v80 对齐） |

**改名匹配链**：`predictSavedFileName`（URL 推断）→ 期望名 → hash 名 → 原名前缀逐级匹配；
`basenameOf(n) === newName` 首位判定「已完成无需改名」。

**m115 加密**（`src/lib/pan115/m115.ts`）：115 旧 `lixianssp` 接口要求请求体经
**RSA(1024, E=0x10001) + XOR 派生密钥 + 字节反转 + Base64** 加密，直接提交明文返回
"decode fail!"。逐行翻译自开源 `SheltonZhu/115driver/pkg/crypto/m115`。open 接口不需要。

### 6.6 封面 / 歌词 / 专辑刮削

- **刮削源**：网易云。`matchNetease(title, artist)` 直连
  `${getApiUrl()}/music-api?types=search&name=...&count=10&source=_netease`
  （8s AbortController）；**返回顶层数组** `[{id,name,artist:[],album,pic}]`
  （v76 修复，兼容非 `{songs:[]}` 结构）；歌词走 `{lyric, tlyric}`。
- **track.id 完整性**：`pan115:account:pickcode:fileName` —— 只有完整 id 才能解析文件名刮削
  （v73 贯通）。
- **专辑名批量填充（v77-v79）**：
  - `fsItemToTrack` 不再硬编码专辑为「115网盘」；
  - **列表加载时批量查专辑**（v79）：`enrichAlbums(tracks, concurrency=3)` 对整页 track
    批量 `matchNetease` 查专辑 → 写 7 天 localStorage 缓存
    （`MATCH_CACHE_KEY="pan115_netease_match_v1"`，存 `{songId,picUrl,album,ts}`）；
  - 渲染实时读缓存：`getCachedAlbum(track)`；
  - 接线点：`Pan115Browser`（`searchAlbumMap` state，全局搜索转 track 后 enrich）、
    `MusicSearchView.fetchPage` 返回后异步 enrich。

> 已知边界：专辑名显示依赖网易云曲库能搜到对应歌曲；缓存命中前首次渲染可能短暂空，
> 缓存 7 天后过期重查。

---

## 7. 播放生态与 UI 交互

### 7.1 底部播放栏（MusicNowPlayingBar）

- 结构：外层手势容器（`touchAction: pan-y`）→ 可点击内容区（`overflow-hidden` 裁剪）→
  **跟随滑动内层**（封面 + 歌名/演唱者）+ **固定**圆环进度/播放按钮。
- 滑动切歌（Spotify 参照）：≥60px 且水平位移 ≥ 垂直位移×1.2 判切歌；左滑下一曲、右滑上一曲（循环）。
- 跟随动画：拖动中 `transform: translateX(dragX)` 无过渡（pointer capture 保证流畅），
  超 `SWIPE_MAX=240` 后 40% 阻尼；松手超阈值 → 先滑出 200ms 再切歌复位；
  未超阈值 → `0.35s cubic-bezier(0.22,1,0.36,1)` 回弹。
- `suppressClickRef` 300ms 抑制滑动后的误开全屏。
- **v82b 关键修正**：播放按钮/圆环**不跟随**拖动；封面歌名滑出播放栏边界被
  `overflow-hidden` 裁剪（不跑到屏幕外）。

### 7.2 歌曲列表（MusicTrackList / MusicTrackItem）

- `MusicTrackList`：**懒加载**（滚动距底 160px 自动 `onLoadMore`，`autoLoadRef` 闸门防重复；
  首屏不足一屏自动补载），覆盖 B站/网易云详情页与全局搜索。
- `MusicTrackItem`：序号 + 歌名 + 歌手/专辑 + 三个点菜单（存 115 / 下载 / 加入歌单等）；
  播放中序号位点亮 + 三个点按钮 `playing-rhythm` 律动（`global.css` 的 `@keyframes dots-rhythm`，
  0.55s 上下 2px 弹性动画）。
- 115 页三处列表（搜索/平铺/目录内）均复用 `MusicTrackItem`，样式与全局搜索对齐。

### 7.3 其他播放能力

- 全屏播放器（FullScreenPlayer）/ 横屏播放（LandscapePlayer）/ 歌词面板（LyricsPanel，
  支持车载歌词设置）。
- 睡眠定时、倍速、音质选择、Media Session（锁屏控制）。

---

## 8. 状态管理（Zustand Store）

| Store | 职责 |
|---|---|
| `store/music-store/*` | 播放核心：`playback-slice`（队列/当前/进度）、`playlist-slice`、`favorites-slice`、`search-slice`、`sleep-timer-slice`、`download-settings-slice`、`ui-slice`、`types` |
| `store/pan115-store.ts` | 115 账号列表（persist → IndexedDB） |
| `store/alist/bilibili/netease/qq/webdav/offline/history/local-music/podcast` | 各音源与业务数据 |
| `store/source-quality-store` | 音质偏好 |
| `store/url-cache-store` | 直链缓存（115 时效直链复用） |
| `store/sync-store` | WebDAV 备份同步 |

持久化规则：`partialize` 只挑可序列化、必要的字段；凭证（115 Cookie/token）落 IndexedDB。

---

## 9. 日志系统

`src/lib/logger.ts`：

- **环形上限**：`MAX_LOG_ENTRIES = 200`（内存数组 `shift()` 裁剪 + localStorage 持久化，
  诊断日志仅保留**最近 200 条**）。
- API：`logger.info / warn / error`；设置页「关于系统 → 诊断日志」（IssueLogs）查看/复制，
  文案「仅保留最近 200 条」。
- 全 App 共用单例（115 登录、API、音乐菜单等不再单独输出「调试日志」分区）。

> 已知：115 链路约 10 处**成功类**日志仍以 `logger.error` 输出（历史写法，偏好 success→info，
> 用户尚未拍板批量下调）。「读取下载记录失败 WARN」为 Capacitor `androidBridge` 噪声，非问题。

---

## 10. 构建与发布流程

### 10.1 常用命令

```bash
npm install
npm run dev                 # 本地开发（Vite）
npm run typecheck           # tsc --noEmit
npm run lint && npm run test
npm run build               # tsc -b && vite build → dist/
npm run cap:sync:android    # build + npx cap sync android
```

### 10.2 Android 发布（重要环境约束）

```bash
# 1. 构建 Web 资源并同步
npm run build && npx cap sync android

# 2. 打 Release 包 —— 必须 JDK 21（系统 java 11 会导致 gradle 失败）
cd android
JAVA_HOME=/home/user/jdk21/jdk-21.0.12.1+1 ./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/otter-music-v2.7.9-release.apk

# 3. 签名（debug keystore 示例）
/home/user/android-sdk/build-tools/36.0.0/apksigner sign \
  --ks ~/.android/debug.keystore --ks-pass pass:android \
  --ks-key-alias androiddebugkey \
  --out /tmp/otter-music-vXX-signed.apk /tmp/otter-music-vXX.apk
/home/user/android-sdk/build-tools/36.0.0/apksigner verify /tmp/otter-music-vXX-signed.apk
```

- `app/build.gradle`：`sourceCompatibility/targetCompatibility = JavaVersion.VERSION_21`、
  minSdk 24；版本号 `versionName` 与 `package.json` 由 `scripts/update-mobile-version.js` 联动。
- 版本迭代节奏：每次改动走「tsc → build → cap sync → gradlew(JDK21) → apksigner →
  上传 → 交付」，版本号 vXX 递增。

### 10.3 后端部署（首次 / 自建代理时）

```bash
# functions/ 目录，Cloudflare Workers
npm install
npx wrangler deploy   # 部署后前端自动使用新 getApiUrl()
```

---

## 11. 测试

- 框架：**Vitest + Testing Library + jsdom**（`npm run test`），CI 入口 `scripts/ci-test.js`。
- 覆盖：music-api fallback、各音源 API（kugou/kuwo/migu/bilibili/awards…）、
  store（app/history/sync/url-cache…）、组件（ErrorBoundary/LyricsPanel/PlayerProgressBar/
  PlayerQueueDrawer/MusicSearchView/RootLayout…）、工具（soda-color/sort-tracks/logger…）。
- 新增逻辑（尤其 115 链路）建议补单测：`pan115/api.ts` 的搜索/改名/队列、`logger` 上限。

---

## 12. 已知问题与注意事项

| 项 | 状态 | 说明 |
|---|---|---|
| `/pan115/fetch` 405 | 待修 | 专属代理长期 405，代码已 skip；如需恢复需重新部署 Cloudflare Pages |
| 成功类日志用 error 级别 | 待拍板 | 115 链路约 10 处，偏好 success→info 批量下调 |
| 专辑刮削时效 | 缓存 7 天 | 网易云曲库搜索不到时专辑名为空；缓存过期自动重查 |
| 115 搜索 toast「未查询到相关歌曲」 | 正常行为 | 服务端返回全文件结果，客户端按音频过滤后无匹配即提示（如网盘确无《成都》） |
| 直链时效 | 数小时 | 播放走 url-cache，过期自动重取 downurl |
| 115 云下载配额 | VIP 能力 | 免费配额有限，失败 error_msg 通过 toast 透出 |
| savepath 字段 | 未文档化 | 115 open 接口实测接受；拒绝时自动回退「无定名提交 + 队列改名」 |
| 多账号 | 支持 | 存歌/浏览时弹出账号选择 |
| Web 分支 | 历史遗留 | 新增功能只面向 Android |

---

## 附：115 关键接口速查

| 用途 | 方法与 URL | 关键参数 |
|---|---|---|
| 列目录 | GET `/open/ufile/files` | cid / limit / offset / o=user_ptime / asc=0 / show_dir=1 / natsort=1 |
| 搜索 | GET `/open/ufile/search` | cid=0 / search_value / limit=200 / type=0 |
| 取直链 | POST `/open/ufile/downurl` | body: `pick_code=<pc>` |
| 离线下载 | POST `/open/offline/add_task_urls` | url / savepath / wp_path_id（savepath 定名） |
| 任务列表 | GET `/open/offline/list` | 分页循环（status: -1/0/1/2） |
| 改名 | 见 `renameFile` | open batch_rename / web 变体回退 |
| 刷新 token | `refreshAccessToken` | 只传 refresh_token；失效码 40140123/24/25/26 |

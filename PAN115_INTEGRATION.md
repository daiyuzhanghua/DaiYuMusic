# Otter Music · 115 网盘改造说明

本次改造在原 [otter-music](https://github.com/DJChanahCJD/otter-music) 基础上新增「115 网盘」音源，支持：

1. **浏览与播放 115 网盘里的音乐文件**（mp3 / flac / wav / m4a / ape 等）
2. **把任意歌曲「存到 115 网盘」**——通过 115 离线下载 / 链接转存能力，把当前歌曲的播放直链提交到 115 云下载

---

## 一、新增/改动文件清单

### 后端（Cloudflare Workers）
| 文件 | 说明 |
|---|---|
| `functions/routes/pan115.ts` | 新增 `/pan115/fetch` 专用代理：仅允许转发到 `*.115.com`，由前端在请求体里显式携带 `Cookie`（UID/CID/SEID），Worker 只做透传，不存储凭证 |
| `functions/app.ts` | 注册 `app.route("/pan115", pan115Routes)` |

### 类型与共享层
| 文件 | 说明 |
|---|---|
| `shared/src/types/music.ts` | `MusicSource` 联合类型新增 `"pan115"`；`sourceLabels` 新增 `pan115: "115"` |

### 前端 lib / store
| 文件 | 说明 |
|---|---|
| `src/types/pan115.ts` | `Pan115Account` / `Pan115FsItem` / `Pan115DownloadInfo` / `Pan115AddOfflineResult` 类型 |
| `src/lib/pan115/api.ts` | 115 API 封装：`listFiles` / `getDownloadUrl` / `addOfflineUrl` / `verifyAccount` / `isAudioFile` |
| `src/lib/pan115/index.ts` | 导出 |
| `src/store/pan115-store.ts` | zustand + persist（IndexedDB）保存账号列表 |
| `src/store/store-keys.ts` | 新增 `Pan115Store` |
| `src/lib/music-provider/providers/pan115-provider.ts` | `Pan115Provider`：用 track 里的 `pickcode` 换直链播放 |
| `src/lib/music-provider/factory.ts` | 注册 `case "pan115"` |

### UI
| 文件 | 说明 |
|---|---|
| `src/components/PlaylistMarket/Pan115/Pan115AccountCard.tsx` | 账号卡片 |
| `src/components/PlaylistMarket/Pan115/Pan115AccountAdd.tsx` | 添加/编辑账号抽屉（含 UID/CID/SEID 填写指引） |
| `src/components/PlaylistMarket/Pan115/Pan115Browser.tsx` | 网盘目录浏览器（面包屑、实时筛选、排序、批量导入歌单） |
| `src/components/PlaylistMarket/Pan115/index.ts` | 导出 |
| `src/components/PlaylistMarket/Pan115Section.tsx` | 歌单广场里的「115网盘」分区 |
| `src/components/PlaylistMarket/PlaylistMarket.tsx` | 注册 `"115网盘": Pan115Section` |
| `src/components/MusicTrackMobileMenu.tsx` | 歌曲菜单新增「存到115网盘」按钮（非 115 音源、且已配置账号时显示） |
| `src/lib/netease/netease-cats.ts` | 新增 `PAN115_CAT`，加入 `NON_BROWSE_CATEGORIES` |
| `src/routes/RouteWrappers.tsx` | 懒加载 `Pan115Browser`、`Pan115BrowserRoute` |
| `src/router.tsx` | 新增路由 `/pan115/:accountId` |

---

## 二、使用步骤

### 1. 部署后端（必须）
浏览器直接调 `webapi.115.com` 会被 CORS 拦截，且 115 要求 Cookie 鉴权，所以所有 115 请求都走你自己的 Cloudflare Worker：

```bash
# 在项目根目录，按原仓库的方式部署 functions
# wrangler deploy
```

部署后，前端会自动用 `${getApiUrl()}/pan115/fetch` 这个新路由。
如果你仍用原项目默认的 `https://otter-music.pages.dev`，需要自己 fork 后重新部署 functions。

### 2. 获取 115 凭证
1. 浏览器登录 https://115.com
2. 按 F12 → Application（应用）→ Cookies → `https://115.com`
3. 复制三个字段的值：
   - `UID`（纯数字）
   - `CID`
   - `SEID`

### 3. 在 App 里添加账号
1. 打开 App → 底部「歌单」→ 顶部分类切到「115网盘」
2. 点「添加账号」
3. 粘贴 UID / CID / SEID
4. （可选）填「浏览根目录 cid」（默认 `0` = 全部文件）
5. （可选）填「离线下载默认目录 cid」（默认 `0` = 115 默认云下载目录）
6. 点「验证并添加」——会列一次根目录确认凭证有效

### 4. 播放 115 里的音乐
- 点击账号卡片进入网盘浏览
- 点文件夹逐层进入，点音频文件直接播放
- 顶部「导入歌单」按钮可把当前目录所有音频快照成普通歌单

### 5. 把其他平台的歌存到 115
- 在任意歌曲菜单（网易/B站/酷我等）里，会看到「存到115网盘」
- 点击后：
  1. 前端先通过对应 Provider 解析出这首歌的真实播放直链
  2. 调用 `POST https://lixian.115.com/lixianssp/?ac=add_task_urls` 把该 URL 提交到 115 云下载
- 到 115 App / 网页端的「云下载」里就能看到任务

> 多账号时会弹出编号选择；单账号时直接提交。

---

## 三、实现要点 / 注意事项

- **Cookie 不落盘到 Worker**：UID/CID/SEID 只存在用户浏览器 IndexedDB，每次请求由前端拼到 `Cookie` 头发给 Worker，Worker 立即转发给 115，不写日志、不缓存。
- **直链时效**：115 `files/download?pickcode=` 返回的 URL 有时效（通常几小时），播放走 url-cache-store 缓存，过期后会重新换。
- **离线下载配额**：115 云下载是 VIP 能力，免费用户配额有限，失败时会把 `error_msg` 通过 toast 抛出来。
- **不参与全局聚合搜索**：115 网盘内容是按目录浏览的，不参与「全部音源」的搜索，避免把用户私人文件混进公共搜索结果。
- **115 自身歌曲无需再转存**：从 115 浏览页点出来的歌曲，菜单里不会显示「存到115网盘」按钮。

---

## 四、验证

```bash
npm install
npm run typecheck   # 通过
npm run build       # 通过，产出 dist/ 与独立的 Pan115Browser chunk
```

类型检查与生产构建均已通过。

import { IMusicProvider } from "../interface";
import {
  MusicTrack,
  SearchPageResult,
  SongLyric,
  SearchIntent,
} from "@/types/music";
import {
  getDownloadUrl,
  searchFiles,
  isAudioFile,
  isDirItem,
  parseAudioFileName,
  searchMusicLibraryLocal,
  searchAllAudioLocal,
} from "@/lib/pan115";
import { getApiUrl } from "@/lib/api/config";
import { usePan115Store } from "@/store/pan115-store";
import type { Pan115Account, Pan115FsItem } from "@/types/pan115";
import { logger } from "@/lib/logger";

/** track.id 前缀 */
const PAN115_ID_PREFIX = "pan115:";

/** 与 115 open 请求一致的浏览器 UA（115 直链要求 UA 匹配，见 p115client 直链 note：url 参数 f=1 需 UA、f=3 需 UA+Cookie） */
const UA_BROWSER =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** 网易云封面/歌词匹配缓存 key（localStorage：文件名 → {songId, picUrl}，防重复搜索） */
const MATCH_CACHE_KEY = "pan115_netease_match_v1";
/** 匹配缓存有效期：7 天 */
const MATCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface NeteaseMatch {
  songId: string;
  picUrl: string;
  /** 网易云匹配到的真实专辑名（有缓存时用于替换默认 album） */
  album?: string;
  ts: number;
}

function getMatchCache(): Record<string, NeteaseMatch> {
  try {
    const raw = localStorage.getItem(MATCH_CACHE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null) return {};
    const now = Date.now();
    const out: Record<string, NeteaseMatch> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && (v as NeteaseMatch).ts) {
        if (now - (v as NeteaseMatch).ts < MATCH_CACHE_TTL_MS) out[k] = v as NeteaseMatch;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function setMatchCache(cache: Record<string, NeteaseMatch>) {
  try {
    localStorage.setItem(MATCH_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 存储满等异常忽略
  }
}

/**
 * 按「歌名 演唱者」匹配自有网易云适配器（_netease，直连 pages functions 自有 weapi 适配器，
 * 不依赖 gdstudio 也不绕多源循环）——Navidrome/Last.fm 思路：外部服务按 title+artist 匹配元数据。
 * 返回 { songId, picUrl }：songId 用于拉歌词，picUrl 直接是网易云封面图 URL。
 */
async function matchNetease(
  title: string,
  artist: string
): Promise<NeteaseMatch | null> {
  if (!title) return null;
  const key = `${title}|${artist}`;
  const cache = getMatchCache();
  const hit = cache[key];
  if (hit) return hit;
  try {
    const name = artist ? `${title} ${artist}` : title;
    // 直连 pages 自有适配器（/music-api?source=_netease），8s 超时，失败不重试（有缓存兜底）
    // 实测返回结构：search 顶层是数组 [{id,name,artist,album,pic,url_id,pic_id,lyric_id}]（不是 {songs:[...]}）
    const url = `${getApiUrl()}/music-api?types=search&name=${encodeURIComponent(name)}&count=10&source=_netease`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: unknown;
    try {
      const r = await fetch(url, { signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      res = await r.json();
    } finally {
      clearTimeout(timer);
    }
    const arr = Array.isArray(res)
      ? (res as Array<{ id?: string | number; pic?: string; album?: string }>)
      : (res as { songs?: Array<{ id?: string | number; pic?: string; album?: string }> } | null)?.songs;
    const song = arr?.[0];
    if (!song?.id) return null;
    const match: NeteaseMatch = {
      songId: String(song.id),
      picUrl: song.pic ?? "",
      album: song.album ?? "",
      ts: Date.now(),
    };
    cache[key] = match;
    setMatchCache(cache);
    logger.info("pan115-scrape", "封面/歌词匹配成功", {
      title,
      artist,
      songId: match.songId,
      picUrl: match.picUrl ? match.picUrl.slice(0, 60) : "",
    });
    return match;
  } catch (e) {
    logger.warn("pan115", "netease match failed", e instanceof Error ? e.message : String(e), {
      title,
      artist,
    });
    return null;
  }
}

/**
 * 解析 track.id 为 { accountId, pickcode, fileName }
 * id 格式：pan115:<accountId>:<pickcode>:<fileName>
 * fileName 可能含 ":"，所以只切前两段
 */
function parseTrackId(
  id: string
): { accountId: string; pickcode: string; fileName: string } | null {
  if (!id.startsWith(PAN115_ID_PREFIX)) return null;
  const rest = id.slice(PAN115_ID_PREFIX.length);
  // accountId 是 uuid，不含 ":"
  const firstColon = rest.indexOf(":");
  if (firstColon === -1) return null;
  const accountId = rest.slice(0, firstColon);
  const rest2 = rest.slice(firstColon + 1);
  const secondColon = rest2.indexOf(":");
  if (secondColon === -1) return null;
  const pickcode = rest2.slice(0, secondColon);
  const fileName = rest2.slice(secondColon + 1);
  return { accountId, pickcode, fileName };
}

function resolveAccount(track: MusicTrack): Pan115Account | null {
  const parsed = parseTrackId(track.id);
  if (!parsed) return null;
  const acc = usePan115Store
    .getState()
    .accounts.find((a) => a.id === parsed.accountId && !a.is_deleted);
  return acc ?? null;
}

/** 把 115 文件项转成 MusicTrack（文件名「歌名 - 演唱者.ext」解析出真实歌名/演唱者） */
function fsItemToTrack(item: Pan115FsItem, account: Pan115Account): MusicTrack {
  const pickcode = item.pc ?? "";
  const { title, artist } = parseAudioFileName(item.n);
  // pic_id/lyric_id 携带完整 track.id（含 pickcode:文件名）：facade 的 getPic/getLyric 只传
  // pic_id/lyric_id 字符串构造临时 track，完整 id 才能让 provider 解析出文件名做封面/歌词刮削
  const fullId = `pan115:${account.id}:${pickcode}:${item.n}`;
  return {
    id: fullId,
    name: title || item.n.replace(/\.[^.]+$/, ""),
    artist: artist ? [artist] : [account.name],
    // album 不硬编码"115网盘"（会以「演唱者 • 115网盘」显示在列表里）；search 返回前会用网易云
    // 匹配缓存的真实专辑名补全（有缓存时零网络成本）
    album: "",
    pic_id: fullId,
    url_id: pickcode,
    lyric_id: fullId,
    source: "pan115",
  };
}

/** 用网易云匹配缓存（封面加载时已写入）补全真实专辑名；无缓存则保持空，不触发网络请求 */
function enrichAlbumFromCache(tracks: MusicTrack[]): MusicTrack[] {
  const cache = getMatchCache();
  if (!Object.keys(cache).length) return tracks;
  return tracks.map((t) => {
    if (t.album) return t;
    const parsed = parseTrackId(t.id);
    if (!parsed) return t;
    const { title, artist } = parseAudioFileName(parsed.fileName);
    const hit = cache[`${title}|${artist ?? ""}`];
    if (hit?.album) return { ...t, album: hit.album };
    return t;
  });
}

/**
 * 渲染时实时读取网易云匹配缓存中的真实专辑名（同步、零网络）。
 * 播放/封面加载触发 matchNetease 写入缓存后，列表项重渲染即可自动显示真实专辑名，
 * 无需再次搜索（供 MusicTrackItem / Pan115Browser 列表显示用）。
 */
export function getCachedAlbum(track: MusicTrack): string {
  if (track.album) return track.album;
  if (track.source !== "pan115") return "";
  const parsed = parseTrackId(track.id);
  if (!parsed) return "";
  const { title, artist } = parseAudioFileName(parsed.fileName);
  const hit = getMatchCache()[`${title}|${artist ?? ""}`];
  return hit?.album ?? "";
}

/**
 * 列表加载时批量查询专辑名（不等播放）：对 source==="pan115" 且 album 为空的 track，
 * 并发（默认 3）调 matchNetease 查真实专辑名并写缓存；命中缓存的秒回，未命中的发起网易云搜索。
 * 返回更新了 album 的新数组（失败项保持原样）。供 MusicSearchView / Pan115Browser 列表加载后调用。
 */
export async function enrichAlbums(
  tracks: MusicTrack[],
  concurrency = 3
): Promise<MusicTrack[]> {
  const targets = tracks.filter((t) => t.source === "pan115" && !t.album);
  if (targets.length === 0) return tracks;
  const updated = new Map<string, string>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      const parsed = parseTrackId(t.id);
      if (!parsed) continue;
      const { title, artist } = parseAudioFileName(parsed.fileName);
      const match = await matchNetease(title, artist ?? "");
      if (match?.album) updated.set(t.id, match.album);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => worker())
  );
  if (updated.size === 0) return tracks;
  return tracks.map((t) => (updated.has(t.id) ? { ...t, album: updated.get(t.id)! } : t));
}

/** 115 直链 → 通用代理流式地址（代理端带 UA/Referer 转发，规避直链防盗链） */
function buildProxyStreamUrl(directUrl: string): string {
  const apiBase = getApiUrl();
  const headers = JSON.stringify({
    "User-Agent": UA_BROWSER,
    Referer: "https://115.com/",
  });
  return `${apiBase}/proxy?url=${encodeURIComponent(directUrl)}&headers=${encodeURIComponent(headers)}`;
}

/**
 * 115 网盘音源 Provider
 * - getUrl：pickcode 换直链 → 走通用代理流（直链防盗链要求 UA 匹配，WebView audio 无法自定义请求头）
 * - search：搜索 115 网盘内的音频文件
 * - getPic/getLyric：按「歌名 演唱者」匹配自有网易云适配器补封面/歌词（开源刮削思路：外部服务按 title+artist 匹配）
 */
export class Pan115Provider implements IMusicProvider {
  source = "pan115" as const;

  async search(
    query: string,
    page: number,
    count: number,
    _signal?: AbortSignal,
    _intent?: SearchIntent
  ): Promise<SearchPageResult<MusicTrack>> {
    const accounts = usePan115Store.getState().accounts.filter((a) => !a.is_deleted);
    if (accounts.length === 0 || !query.trim()) {
      return { items: [], hasMore: false };
    }

    // 使用第一个账号搜索
    const account = accounts[0];
    const offset = (page - 1) * count;

    // 加 5 秒超时，避免聚合搜索被卡住
    const timeoutPromise = new Promise<SearchPageResult<MusicTrack>>((resolve) => {
      setTimeout(() => resolve({ items: [], hasMore: false }), 5000);
    });

    try {
      const searchPromise = (async () => {
        const items = await searchFiles(account, query, offset, count);
        // 115 API 不返回 d 字段（目录判定用 isDirItem：有 cid 无 fid），不能用 item.d === 0 过滤
        let audioItems = items.filter((item) => !isDirItem(item) && isAudioFile(item.n));
        // 服务端全盘搜索无音频命中时：本地扫描兜底（v70 思路——open/ufile/search 对部分 open
        // 账号索引不全；先扫「音乐库」，无命中再全盘扫，覆盖歌存在音乐库外的情况）
        if (audioItems.length === 0 && offset === 0) {
          const local = await searchMusicLibraryLocal(account, query);
          if (local.length > 0) {
            audioItems = local;
          } else {
            const allAudio = await searchAllAudioLocal(account, query);
            if (allAudio.length > 0) {
              audioItems = allAudio;
            }
          }
        }
        const tracks = enrichAlbumFromCache(
          audioItems.map((item) => fsItemToTrack(item, account))
        );
        return {
          items: tracks,
          hasMore: audioItems.length >= count,
        };
      })();

      return await Promise.race([searchPromise, timeoutPromise]);
    } catch (e) {
      logger.error("pan115", "search failed", e instanceof Error ? e.message : String(e), {
        accountId: account.id,
        query,
      });
      return { items: [], hasMore: false };
    }
  }

  async getUrl(track: MusicTrack, _br?: number): Promise<string | null> {
    const parsed = parseTrackId(track.id);
    const account = resolveAccount(track);
    if (!parsed || !account) {
      logger.warn("pan115", "getUrl: account not found", track.id);
      return null;
    }
    const info = await getDownloadUrl(account, parsed.pickcode);
    if (!info?.url) return null;
    // 115 直链防盗链：url 参数 f=1 需 UA 匹配、f=3 需 UA+Cookie（WebView audio 元素无法自定义请求头），
    // 统一走通用代理 /proxy 流式转发（代理端带 UA/Referer 请求直链，客户端拿代理流播放）
    return buildProxyStreamUrl(info.url);
  }

  async getPic(track: MusicTrack, _size?: number): Promise<string | null> {
    const parsed = parseTrackId(track.id);
    if (!parsed) return null;
    const { title, artist } = parseAudioFileName(parsed.fileName);
    const match = await matchNetease(title, artist ?? "");
    return match?.picUrl || null;
  }

  async getLyric(track: MusicTrack): Promise<SongLyric | null> {
    const parsed = parseTrackId(track.id);
    if (!parsed) return null;
    const { title, artist } = parseAudioFileName(parsed.fileName);
    const match = await matchNetease(title, artist ?? "");
    if (!match?.songId) return null;
    try {
      // 直连 pages 自有适配器拉歌词（8s 超时）
      const url = `${getApiUrl()}/music-api?types=lyric&id=${encodeURIComponent(match.songId)}&source=_netease`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let res: { lyric?: string; tlyric?: string };
      try {
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        res = await r.json();
      } finally {
        clearTimeout(timer);
      }
      if (!res?.lyric) return null;
      return { lyric: res.lyric, tlyric: res.tlyric };
    } catch (e) {
      logger.warn("pan115", "netease lyric failed", e instanceof Error ? e.message : String(e), {
        songId: match.songId,
      });
      return null;
    }
  }
}

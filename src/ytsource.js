// yt-dlp(youtube-dl-exec) 래퍼: 곡 정보 조회 + 오디오 스트림/캐시 다운로드
import ytdlPkg from 'youtube-dl-exec';
import { createHash } from 'node:crypto';

// asar 패키징 시 아카이브 안의 exe 는 실행 불가 → unpacked 경로로 보정
const YTDLP_BIN = ytdlPkg.constants.YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked');
const ytdl = ytdlPkg.create(YTDLP_BIN);
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// yt-dlp 공통 플래그
const common = {
  noWarnings: true,
  noCheckCertificates: true,
  preferFreeFormats: true,
};

// ---------- 오디오 캐시 ----------
// 스트리밍(다운로드하며 재생)은 네트워크가 출렁이면 무음→배속 증상이 나므로,
// 곡을 통째로 받아 로컬 파일에서 재생한다. 같은 곡은 캐시에서 즉시 재생.
const CACHE_DIR = path.join(tmpdir(), 'yj-musicbot-cache');
try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch {}

const inflight = new Map(); // key -> Promise<filePath> (중복 다운로드 방지)

function cacheKey(url) {
  return createHash('md5').update(url).digest('hex');
}

/** 곡 전체를 캐시에 다운로드하고 파일 경로를 반환. 이미 있으면 즉시 반환. */
export function downloadTrack(url) {
  const key = cacheKey(url);
  const file = path.join(CACHE_DIR, `${key}.audio`);
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 0) return Promise.resolve(file);
  } catch {}
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const part = `${file}.part`;
    try {
      fs.rmSync(part, { force: true });
    } catch {}
    await ytdl(url, {
      output: part,
      format: 'bestaudio[ext=webm]/bestaudio/best',
      noPlaylist: true,
      quiet: true,
      ...common,
    });
    fs.renameSync(part, file);
    pruneCache();
    return file;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** 캐시가 무한정 커지지 않게 최근 파일만 유지 */
function pruneCache(maxFiles = 30) {
  try {
    const files = fs
      .readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith('.audio'))
      .map((f) => {
        const full = path.join(CACHE_DIR, f);
        return { full, t: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.t - a.t);
    for (const { full } of files.slice(maxFiles)) fs.rmSync(full, { force: true });
  } catch {}
}

/** URL 인지 검색어인지 판별 */
function isUrl(input) {
  return /^https?:\/\//i.test(input.trim());
}

/** 재생목록(list=) 링크인지 판별 */
export function isPlaylistUrl(input) {
  try {
    const u = new URL(input.trim());
    return u.searchParams.has('list');
  } catch {
    return false;
  }
}

function toTrack(v) {
  return {
    title: v.title ?? 'Unknown',
    url: v.webpage_url ?? v.original_url ?? v.url,
    thumbnail: v.thumbnail ?? v.thumbnails?.at?.(-1)?.url ?? null,
    duration: v.duration ?? null,
  };
}

/** 단일 곡 해석 (URL 1개 또는 검색어 → 첫 번째 결과) */
export async function resolveSingle(input) {
  const target = isUrl(input) ? input : `ytsearch1:${input}`;
  const info = await ytdl(target, {
    dumpSingleJson: true,
    noPlaylist: true,
    ...common,
  });
  // 검색(ytsearch)은 entries 배열로 반환됨
  const v = info.entries ? info.entries[0] : info;
  if (!v) throw new Error('검색 결과가 없습니다.');
  return toTrack(v);
}

/** 재생목록 전체 해석 → 트랙 배열 */
export async function resolvePlaylist(input) {
  const info = await ytdl(input, {
    dumpSingleJson: true,
    flatPlaylist: true,
    yesPlaylist: true,
    ...common,
  });
  const entries = info.entries ?? [];
  const tracks = entries
    .filter((e) => e && (e.id || e.url))
    .map((e) => ({
      title: e.title ?? 'Unknown',
      url: /^https?:\/\//.test(e.url ?? '')
        ? e.url
        : `https://www.youtube.com/watch?v=${e.id}`,
      thumbnail: null,
      duration: e.duration ?? null,
    }));
  return { title: info.title ?? '재생목록', tracks };
}

/**
 * 오디오 스트림 생성. yt-dlp 가 bestaudio 를 stdout 으로 흘려보내고,
 * @discordjs/voice 가 ffmpeg 로 트랜스코딩한다.
 * @returns child_process (proc.stdout 이 오디오 스트림)
 */
export function createStream(url) {
  const proc = ytdl.exec(
    url,
    {
      output: '-',
      format: 'bestaudio[ext=webm]/bestaudio/best',
      noPlaylist: true,
      quiet: true,
      ...common,
    },
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  // youtube-dl-exec 의 반환값은 promise 이기도 함. 곡 종료/스킵(SIGKILL) 시
  // 이 promise 가 reject 되는데, 안 잡으면 unhandledRejection 으로 봇이 죽는다.
  proc.catch(() => {});
  return proc;
}

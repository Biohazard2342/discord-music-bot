// yt-dlp(youtube-dl-exec) 래퍼: 곡 정보 조회 + 오디오 스트림 생성
import ytdl from 'youtube-dl-exec';

// yt-dlp 공통 플래그
const common = {
  noWarnings: true,
  noCheckCertificates: true,
  preferFreeFormats: true,
};

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
  return ytdl.exec(
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
}

// 서버(길드)별 음악 플레이어: 음성 연결 + 대기열 + 재생 제어
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
  entersState,
} from '@discordjs/voice';
import { spawn } from 'node:child_process';
import { createStream, downloadTrack, FFMPEG_BIN } from './ytsource.js';
import { panelEmbed, panelRows } from './ui.js';

const players = new Map(); // guildId -> GuildMusicPlayer

/** 길드 플레이어 가져오기(없으면 생성). voiceChannel 주면 연결 시도. */
export function getPlayer(guild, voiceChannel = null, textChannel = null) {
  let p = players.get(guild.id);
  if (!p) {
    p = new GuildMusicPlayer(guild);
    players.set(guild.id, p);
  }
  if (textChannel) p.textChannel = textChannel;
  if (voiceChannel) p.connect(voiceChannel);
  return p;
}

export function getExistingPlayer(guildId) {
  return players.get(guildId);
}

class GuildMusicPlayer {
  constructor(guild) {
    this.guild = guild;
    this.textChannel = null;
    this.panelMessage = null; // 갱신할 컨트롤 패널 메시지
    this.queue = [];
    this.current = null;
    this.paused = false;
    this.connection = null;
    this.currentProc = null;

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.player.on(AudioPlayerStatus.Idle, () => this._onIdle());
    this.player.on('error', (err) => {
      console.error('🔊 AudioPlayer 오류:', err.message);
      this._onIdle();
    });
  }

  connect(voiceChannel) {
    // 음질: 채널이 허용하는 최대 비트레이트 기억 (없으면 96kbps)
    this.bitrate = voiceChannel.bitrate || 96000;
    if (this.connection && this.connection.joinConfig.channelId === voiceChannel.id) return;
    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection.subscribe(this.player);

    entersState(this.connection, VoiceConnectionStatus.Ready, 15000).catch(() =>
      console.error(`[${this.guild?.name}] 음성 연결 Ready 실패(15s) — 방화벽/UDP 의심`),
    );

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        this.destroy();
      }
    });
  }

  enqueue(track) {
    this.queue.push(track);
    if (!this.current) this._playNext().catch((e) => console.error('▶️ 재생 시작 실패:', e?.message ?? e));
    else this.updatePanel();
  }

  enqueueMany(tracks) {
    this.queue.push(...tracks);
    if (!this.current) this._playNext().catch((e) => console.error('▶️ 재생 시작 실패:', e?.message ?? e));
    else this.updatePanel();
  }

  async _playNext() {
    this._killProc();
    const track = this.queue.shift();
    if (!track) {
      this.current = null;
      this.paused = false;
      this.updatePanel();
      return;
    }
    this.current = track;
    this.paused = false;
    this.updatePanel();

    // 캐시 우선: 곡을 통째로 받아 로컬 파일에서 재생 — 다운로드하며 재생할 때
    // 생기는 무음→배속(네트워크 버스트) 증상을 원천 차단한다.
    let inputFile = null;
    try {
      inputFile = await downloadTrack(track.url);
    } catch (e) {
      // 라이브 스트림 등 다운로드가 불가능하면 기존 스트리밍으로 폴백
      console.error('⬇️ 캐시 다운로드 실패, 스트리밍 폴백:', e?.message ?? e);
    }
    if (this.current !== track) return; // 다운로드 중 스킵/정지됨

    const bitrate = Math.min(Math.max(this.bitrate || 96000, 64000), 128000);
    // prism.FFmpeg 의 자동 탐색은 패키징(asar) 환경에서 ffmpeg 를 못 찾으므로
    // 정확한 바이너리 경로(FFMPEG_BIN)로 직접 spawn 한다.
    const ffmpeg = spawn(
      FFMPEG_BIN,
      [
        '-analyzeduration', '0', '-loglevel', '0',
        '-i', inputFile ?? 'pipe:0',
        '-acodec', 'libopus', '-f', 'opus',
        '-ar', '48000', '-ac', '2',
        '-b:a', String(bitrate),
        '-vbr', 'on', '-application', 'audio', '-compression_level', '5',
        'pipe:1',
      ],
      { windowsHide: true, stdio: [inputFile ? 'ignore' : 'pipe', 'pipe', 'ignore'] },
    );
    this.currentFfmpeg = ffmpeg;
    ffmpeg.on('error', (e) => console.error('ffmpeg 실행 실패:', e?.message ?? e));
    ffmpeg.on('close', (code) => console.log(`[${this.guild?.name}] ffmpeg 종료 code=${code} (파일=${!!inputFile})`));
    console.log(`[${this.guild?.name}] ▶ 재생 시작: ${track.title} (${inputFile ? '캐시' : '스트리밍'})`);

    if (!inputFile) {
      const proc = createStream(track.url);
      this.currentProc = proc;
      proc.on('error', () => {});
      ffmpeg.stdin.on('error', () => {}); // 종료 시 EPIPE 무시
      proc.stdout.pipe(ffmpeg.stdin);
    }

    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus });
    this.player.play(resource);
    this.updatePanel();

    // 프리페치: 다음 곡을 재생 중에 미리 받아두면 곡 전환이 끊김 없이 즉시 된다.
    if (this.queue[0]) downloadTrack(this.queue[0].url).catch(() => {});
  }

  _onIdle() {
    this._playNext().catch((e) => console.error('▶️ 다음 곡 재생 실패:', e?.message ?? e));
  }

  _killProc() {
    if (this.currentProc) {
      try {
        this.currentProc.kill('SIGKILL');
      } catch {}
      this.currentProc = null;
    }
    if (this.currentFfmpeg) {
      try {
        this.currentFfmpeg.kill('SIGKILL');
      } catch {}
      this.currentFfmpeg = null;
    }
  }

  togglePause() {
    if (!this.current) return;
    if (this.paused) {
      this.player.unpause();
      this.paused = false;
    } else {
      this.player.pause();
      this.paused = true;
    }
    this.updatePanel();
  }

  skip() {
    if (!this.current) return;
    if (this.player.state.status === AudioPlayerStatus.Idle) {
      // 아직 다운로드 중(재생 시작 전)에 스킵 — Idle 이벤트가 없으므로 직접 다음 곡
      this._playNext().catch(() => {});
    } else {
      this.player.stop(); // Idle 이벤트 → 다음 곡
    }
  }

  /** 음성채널에 사람이 없을 때: 잠시 뒤 자동 퇴장 예약 */
  scheduleAloneLeave() {
    this.cancelAloneLeave();
    this._aloneTimer = setTimeout(() => {
      console.log(`[${this.guild?.name}] 음성채널에 아무도 없어 자동 퇴장`);
      this.stop();
    }, 30000); // 30초 뒤 (그 전에 누가 들어오면 취소)
  }

  cancelAloneLeave() {
    if (this._aloneTimer) {
      clearTimeout(this._aloneTimer);
      this._aloneTimer = null;
    }
  }

  /** 사용자 정지: 대기열 비우고 음성 연결 해제 (플레이어 객체/패널은 유지) */
  stop() {
    this.cancelAloneLeave();
    this.queue = [];
    this.current = null;
    this.paused = false;
    this._killProc();
    this.player.stop();
    try {
      this.connection?.destroy();
    } catch {}
    this.connection = null;
    this.updatePanel();
  }

  /** 완전 제거 (음성 연결 끊김 등) */
  destroy() {
    this.cancelAloneLeave();
    this._killProc();
    try {
      this.connection?.destroy();
    } catch {}
    this.connection = null;
    this.current = null;
    this.queue = [];
    players.delete(this.guild.id);
    this.updatePanel();
  }

  async updatePanel() {
    if (!this.panelMessage) return;
    try {
      await this.panelMessage.edit({
        embeds: [panelEmbed(this)],
        components: panelRows(this),
      });
    } catch {
      // 메시지가 삭제됐을 수 있음
      this.panelMessage = null;
    }
  }
}

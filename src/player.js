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
import prism from 'prism-media';
import { createStream } from './ytsource.js';
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
      console.error('❌ 음성 연결이 15초 내 Ready 안 됨 — 방화벽/UDP 차단 의심'),
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
    if (!this.current) this._playNext();
    else this.updatePanel();
  }

  enqueueMany(tracks) {
    this.queue.push(...tracks);
    if (!this.current) this._playNext();
    else this.updatePanel();
  }

  _playNext() {
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

    // yt-dlp 로 bestaudio 를 받아, 우리가 직접 ffmpeg 로 채널 비트레이트만큼
    // 고음질 opus 인코딩 → OggOpus 로 넘김(@discordjs/voice 가 재인코딩 안 함).
    const proc = createStream(track.url);
    this.currentProc = proc;
    proc.on('error', () => {});

    const bitrate = Math.min(Math.max(this.bitrate || 96000, 64000), 510000);
    const ffmpeg = new prism.FFmpeg({
      args: [
        '-analyzeduration', '0', '-loglevel', '0',
        '-i', '-',
        '-acodec', 'libopus', '-f', 'opus',
        '-ar', '48000', '-ac', '2',
        '-b:a', String(bitrate),
        '-vbr', 'on', '-application', 'audio', '-compression_level', '10',
      ],
    });
    this.currentFfmpeg = ffmpeg;
    ffmpeg.on('error', () => {});
    proc.stdout.pipe(ffmpeg);

    const resource = createAudioResource(ffmpeg, { inputType: StreamType.OggOpus });
    this.player.play(resource);
    this.updatePanel();
  }

  _onIdle() {
    this._playNext();
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
        this.currentFfmpeg.destroy();
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
    if (this.current) this.player.stop(); // Idle 이벤트 → 다음 곡
  }

  /** 사용자 정지: 대기열 비우고 음성 연결 해제 (플레이어 객체/패널은 유지) */
  stop() {
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

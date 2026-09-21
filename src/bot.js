// 디스코드 음악봇 — 켜기/끄기로 제어 가능한 모듈
import ffmpegPath from 'ffmpeg-static';
// @discordjs/voice 가 ffmpeg-static 을 찾도록 경로 지정 (패키징 시 asar 경로 보정)
if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

// 안전망: 자식 프로세스/스트림에서 튀는 예외로 봇이 통째로 죽지 않게 한다.
process.on('unhandledRejection', (r) => console.error('⚠️ unhandledRejection:', r?.message ?? r));
process.on('uncaughtException', (e) => console.error('⚠️ uncaughtException:', e?.message ?? e));

import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getPlayer, getExistingPlayer } from './player.js';
import { resolveSingle, resolvePlaylist, isPlaylistUrl, updateYtdlp } from './ytsource.js';
import {
  panelEmbed,
  panelRows,
  addModal,
  playlistChoiceRow,
  queueText,
  setupPromptEmbed,
  setupRow,
  setupDoneEmbed,
} from './ui.js';

const SETUP_CHANNEL = '🎵-음악봇';

// ---------- 런타임 상태 ----------
let client = null;
const state = { online: false, tag: null, startedAt: null, lastError: null };

// 재생목록 선택 대기용 임시 캐시
const pending = new Map();
function stash(query) {
  const token = randomUUID().slice(0, 8);
  pending.set(token, { query, ts: Date.now() });
  setTimeout(() => pending.delete(token), 10 * 60 * 1000).unref?.();
  return token;
}

// ---------- 슬래시 명령어 ----------
const commands = [
  new SlashCommandBuilder()
    .setName('셋업')
    .setDescription('음악 채널을 만들고 컨트롤 패널을 설치합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
];

async function registerCommands(token, clientId, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log(`✅ 슬래시 명령어 등록 완료 (${guildId ? '서버 ' + guildId : '전역'})`);
}

// ---------- 헬퍼 ----------
function memberVoiceChannel(interaction) {
  return interaction.member?.voice?.channel ?? null;
}

async function doSetup(guild) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { error: '봇에게 **채널 관리(Manage Channels)** 권한이 필요해요. 서버 역할 설정에서 권한을 부여해 주세요.' };
  }
  let channel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === SETUP_CHANNEL,
  );
  if (!channel) {
    channel = await guild.channels.create({
      name: SETUP_CHANNEL,
      type: ChannelType.GuildText,
      topic: '🎵 음악봇 컨트롤 패널 — 버튼으로 조작하세요',
    });
  }
  const player = getPlayer(guild, null, channel);
  const msg = await channel.send({ embeds: [panelEmbed(player)], components: panelRows(player) });
  player.panelMessage = msg;
  return { channel };
}

async function addSingleResult(interaction, track) {
  const voice = memberVoiceChannel(interaction);
  if (!voice) return interaction.editReply({ content: '먼저 음성 채널에 들어가 주세요.' });
  const player = getPlayer(interaction.guild, voice, interaction.channel);
  track.requestedBy = interaction.user.displayName ?? interaction.user.username;
  player.enqueue(track);
  return interaction.editReply({ content: `➕ **${track.title}** 추가됨` });
}

async function addPlaylistResult(interaction, title, tracks) {
  const voice = memberVoiceChannel(interaction);
  if (!voice) return interaction.editReply({ content: '먼저 음성 채널에 들어가 주세요.' });
  const player = getPlayer(interaction.guild, voice, interaction.channel);
  const tag = interaction.user.displayName ?? interaction.user.username;
  for (const t of tracks) t.requestedBy = tag;
  player.enqueueMany(tracks);
  return interaction.editReply({ content: `📑 **${title}** — ${tracks.length}곡을 대기열에 추가했습니다.` });
}

// ---------- 이벤트 핸들러 ----------
function onGuildCreate(guild) {
  (async () => {
    try {
      const me = guild.members.me;
      const target =
        (guild.systemChannel?.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)
          ? guild.systemChannel
          : null) ??
        guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildText &&
            c.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages),
        );
      if (!target) return;
      await target.send({ embeds: [setupPromptEmbed()], components: [setupRow()] });
    } catch (e) {
      console.error('GuildCreate 안내 실패:', e.message);
    }
  })();
}

async function onInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === '셋업') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await doSetup(interaction.guild);
      if (res.error) return interaction.editReply({ content: res.error });
      return interaction.editReply({ content: `✅ 셋업 완료! ${res.channel} 채널에서 사용하세요.` });
    }

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === 'music:setup') {
        await interaction.deferUpdate();
        const res = await doSetup(interaction.guild);
        if (res.error) return interaction.followUp({ content: res.error, flags: MessageFlags.Ephemeral });
        return interaction.editReply({ embeds: [setupDoneEmbed(res.channel)], components: [] });
      }

      if (id === 'music:add') {
        const player = getPlayer(interaction.guild, null, interaction.channel);
        player.panelMessage = interaction.message;
        return interaction.showModal(addModal());
      }

      if (id.startsWith('music:pl:')) {
        const [, , mode, token] = id.split(':');
        const entry = pending.get(token);
        pending.delete(token);
        if (!entry) {
          return interaction.update({ content: '⌛ 선택 시간이 만료됐어요. 다시 추가해 주세요.', components: [] });
        }
        await interaction.update({ content: '⏳ 불러오는 중...', components: [] });
        if (mode === 'full') {
          const { title, tracks } = await resolvePlaylist(entry.query);
          if (!tracks.length) return interaction.editReply({ content: '재생목록이 비어있어요.' });
          await addPlaylistResult(interaction, title, tracks);
        } else {
          const track = await resolveSingle(entry.query);
          await addSingleResult(interaction, track);
        }
        return;
      }

      const player = getExistingPlayer(interaction.guildId);
      if (id !== 'music:queue' && player) player.panelMessage = interaction.message;

      if (id === 'music:pause') {
        player?.togglePause();
        return interaction.deferUpdate();
      }
      if (id === 'music:skip') {
        player?.skip();
        return interaction.deferUpdate();
      }
      if (id === 'music:stop') {
        player?.stop();
        return interaction.deferUpdate();
      }
      if (id === 'music:queue') {
        return interaction.reply({ content: queueText(player), flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'music:addModal') {
      const query = interaction.fields.getTextInputValue('query').trim();
      if (!memberVoiceChannel(interaction)) {
        return interaction.reply({ content: '먼저 음성 채널에 들어가 주세요.', flags: MessageFlags.Ephemeral });
      }
      if (isPlaylistUrl(query)) {
        const hasVideo = /[?&]v=/.test(query);
        if (hasVideo) {
          const token = stash(query);
          return interaction.reply({
            content: '이 링크에는 재생목록이 포함돼 있어요. 어떻게 추가할까요?',
            components: [playlistChoiceRow(token)],
            flags: MessageFlags.Ephemeral,
          });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { title, tracks } = await resolvePlaylist(query);
        if (!tracks.length) return interaction.editReply({ content: '재생목록이 비어있어요.' });
        return addPlaylistResult(interaction, title, tracks);
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const track = await resolveSingle(query);
      return addSingleResult(interaction, track);
    }
  } catch (err) {
    console.error('상호작용 처리 오류:', err);
    const msg = '⚠️ 처리 중 오류가 발생했어요. 링크를 확인하거나 잠시 후 다시 시도해 주세요.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: msg, components: [] });
      else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    } catch {}
  }
}

function buildClient() {
  const c = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  c.once(Events.ClientReady, (ready) => {
    state.online = true;
    state.tag = ready.user.tag;
    state.startedAt = Date.now();
    console.log(`🤖 로그인: ${ready.user.tag}`);
  });
  c.on(Events.GuildCreate, onGuildCreate);
  c.on(Events.InteractionCreate, onInteraction);
  c.on(Events.Error, (e) => console.error('클라이언트 오류:', e.message));
  return c;
}

// ---------- 외부 제어 API ----------
// 시작 중(로그인 완료 전)에 또 호출돼도 같은 작업을 공유한다.
// 이게 없으면 클라이언트가 2개 생겨 유령 봇이 남는다(상호작용 실패/무음의 원인).
let startingPromise = null;

export function startBot(creds = {}) {
  if (startingPromise) return startingPromise;
  if (client && state.online) return Promise.resolve(getStatus());
  startingPromise = _startBot(creds).finally(() => {
    startingPromise = null;
  });
  return startingPromise;
}

async function _startBot(creds) {
  const token = creds.token || config.token;
  const clientId = creds.clientId || config.clientId;
  const guildId = creds.guildId || config.guildId || null;
  if (!token || !clientId) throw new Error('봇 토큰과 Application ID를 입력해 주세요.');

  state.lastError = null;
  updateYtdlp(); // 유튜브 변화 대응: yt-dlp 최신 유지 (논블로킹)
  try {
    await registerCommands(token, clientId, guildId);
    client = buildClient();
    const ready = new Promise((res) => client.once(Events.ClientReady, () => res()));
    await client.login(token);
    await ready;
  } catch (e) {
    const friendly = /401|Unauthorized|TOKEN_INVALID|invalid token/i.test(e.message)
      ? '토큰이 올바르지 않습니다. 봇 토큰(Bot 탭의 Reset Token 값)을 다시 확인해 주세요.'
      : e.message;
    state.lastError = friendly;
    state.online = false;
    try {
      await client?.destroy();
    } catch {}
    client = null;
    throw new Error(friendly);
  }
  return getStatus();
}

export async function stopBot() {
  if (client) {
    try {
      await client.destroy();
    } catch {}
  }
  client = null;
  state.online = false;
  state.tag = null;
  state.startedAt = null;
  return getStatus();
}

export function getStatus() {
  const guilds = [];
  if (client && state.online) {
    for (const g of client.guilds.cache.values()) {
      const p = getExistingPlayer(g.id);
      guilds.push({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
        playing: p?.current?.title ?? null,
        paused: !!p?.paused,
        queued: p?.queue?.length ?? 0,
        playerStatus: p?.player?.state?.status ?? null,
        playbackMs: p?.player?.state?.resource?.playbackDuration ?? null,
      });
    }
  }
  return {
    online: state.online,
    tag: state.tag,
    startedAt: state.startedAt,
    lastError: state.lastError,
    guilds,
  };
}

/** 디버그: 지정한 음성채널에 들어가 URL 재생 (패키징 빌드 원격 검증용) */
export async function debugPlay(guildId, channelId, url) {
  if (!client || !state.online) throw new Error('봇이 오프라인입니다.');
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId);
  const track = await resolveSingle(url);
  track.requestedBy = 'debug';
  const player = getPlayer(guild, channel, null);
  player.enqueue(track);
  return track.title;
}

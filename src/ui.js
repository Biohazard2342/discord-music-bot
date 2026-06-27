// 컨트롤 패널 임베드 + 버튼 + 모달 빌더
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

function fmtDuration(sec) {
  if (!sec && sec !== 0) return '실시간/알수없음';
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 패널 임베드 */
export function panelEmbed(player) {
  const cur = player?.current;
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🎵 음악 플레이어');

  if (cur) {
    embed
      .setDescription(`**${player.paused ? '⏸️ 일시정지' : '▶️ 재생 중'}**\n[${cur.title}](${cur.url})`)
      .setThumbnail(cur.thumbnail ?? null)
      .addFields(
        { name: '요청자', value: cur.requestedBy ?? '-', inline: true },
        { name: '길이', value: fmtDuration(cur.duration), inline: true },
        { name: '대기열', value: `${player.queue.length}곡`, inline: true },
      );
  } else {
    embed.setDescription('대기 중입니다. **🔗 추가** 버튼으로 곡을 추가하세요.');
  }
  return embed;
}

/** 패널 버튼 행 */
export function panelRows(player) {
  const playing = !!player?.current;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music:add').setLabel('🔗 추가').setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('music:pause')
      .setLabel(player?.paused ? '▶️ 재생' : '⏸️ 일시정지')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!playing),
    new ButtonBuilder()
      .setCustomId('music:skip')
      .setLabel('⏭️ 스킵')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!playing),
    new ButtonBuilder()
      .setCustomId('music:stop')
      .setLabel('⏹️ 정지')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!playing),
    new ButtonBuilder().setCustomId('music:queue').setLabel('📜 대기열').setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

/** 봇 입장 시 띄우는 셋업 안내 임베드 */
export function setupPromptEmbed() {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎵 음악봇이 들어왔어요!')
    .setDescription(
      '음악봇을 세팅하시겠습니까?\n아래 **세팅하기** 버튼을 누르면 전용 음악 채널을 만들고 그 안에 컨트롤 패널을 설치합니다.',
    );
}

/** 셋업 버튼 */
export function setupRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music:setup').setLabel('✅ 세팅하기').setStyle(ButtonStyle.Success),
  );
}

/** 셋업 완료 임베드 */
export function setupDoneEmbed(channel) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ 셋업 완료')
    .setDescription(`${channel} 채널에 음악 컨트롤 패널을 설치했어요.\n음성 채널에 입장한 뒤 거기서 **🔗 추가** 버튼을 눌러보세요.`);
}

/** 곡 추가 모달 */
export function addModal() {
  return new ModalBuilder()
    .setCustomId('music:addModal')
    .setTitle('곡 추가')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('query')
          .setLabel('유튜브 링크 또는 검색어')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://youtu.be/...  또는  검색어 입력')
          .setRequired(true),
      ),
    );
}

/** 재생목록 처리 선택 버튼 (토큰으로 원본 쿼리 식별) */
export function playlistChoiceRow(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`music:pl:full:${token}`).setLabel('📑 재생목록 전체 추가').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`music:pl:one:${token}`).setLabel('🎵 이 곡만 추가').setStyle(ButtonStyle.Secondary),
  );
}

/** 대기열 텍스트 */
export function queueText(player) {
  if (!player?.current) return '재생 중인 곡이 없습니다.';
  const lines = [`▶️ **${player.current.title}**  _(요청: ${player.current.requestedBy ?? '-'})_`];
  player.queue.slice(0, 15).forEach((t, i) => {
    lines.push(`\`${i + 1}.\` ${t.title}  _(요청: ${t.requestedBy ?? '-'})_`);
  });
  if (player.queue.length > 15) lines.push(`…외 ${player.queue.length - 15}곡`);
  return lines.join('\n');
}

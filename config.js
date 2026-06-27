import 'dotenv/config';

// .env 값(있으면). 앱(Electron) 모드에서는 GUI에서 입력한 자격증명이 우선합니다.
export const config = {
  token: process.env.DISCORD_TOKEN || null,
  clientId: process.env.CLIENT_ID || null,
  guildId: process.env.GUILD_ID || null,
};

// 헤드리스 봇: 창 없이 실행. C# 네이티브 UI 가 이 프로세스를 켜고/끄고 상태를 폴링한다.
// 자격증명은 환경변수(BOT_TOKEN / CLIENT_ID / GUILD_ID)로 받는다.
import http from 'node:http';
import { startBot, stopBot, getStatus, debugPlay } from './src/bot.js';

const PORT = Number(process.env.YJ_PORT) || 8787;

// 상태 제공용 로컬 서버 (JSON only, HTML 없음)
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(getStatus()));
    } else if (u.pathname === '/debug-play' && process.env.YJ_DEBUG === '1') {
      try {
        const title = await debugPlay(u.searchParams.get('g'), u.searchParams.get('c'), u.searchParams.get('url'));
        res.writeHead(200); res.end('OK ' + title);
      } catch (e) {
        res.writeHead(500); res.end('ERR ' + e.message);
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(PORT, '127.0.0.1');

// C# 이 stdout 을 읽어 성공/실패를 판단한다.
startBot({
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
})
  .then((s) => console.log('READY ' + (s.tag || '')))
  .catch((e) => {
    console.error('START_FAIL ' + (e?.message || e));
    process.exit(2);
  });

async function shutdown() {
  try {
    await stopBot();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('message', (m) => {
  if (m === 'shutdown') shutdown();
});

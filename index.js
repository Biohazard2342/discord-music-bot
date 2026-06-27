// CLI 진입점: .env 의 자격증명으로 봇을 바로 실행 (npm start)
// GUI 앱으로 켜고 싶으면: npm run panel
import { startBot } from './src/bot.js';

startBot().catch((e) => {
  console.error('❌ 봇 시작 실패:', e.message);
  console.error('   .env 의 DISCORD_TOKEN / CLIENT_ID 를 확인하세요. (.env.example 참고)');
  process.exit(1);
});

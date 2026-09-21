// 컨트롤 패널 = 로컬 웹 서버 (Electron 제거, 기존 브라우저에서 열림)
// 실행: npm start  →  http://localhost:8787 자동 오픈
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { startBot, stopBot, getStatus } from './src/bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, 'web');
const CREDS = path.join(__dirname, 'creds.json');
const PORT = 8787;
const LINK = `http://localhost:${PORT}`;

function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  } catch {
    return { token: '', clientId: '', guildId: '' };
  }
}
function saveCreds(c) {
  try {
    fs.writeFileSync(CREDS, JSON.stringify(c, null, 2), 'utf8');
  } catch {}
}
// 빈 문자열/undefined 제거 → 저장된 값으로 폴백되게
function clean(o) {
  const out = {};
  for (const k of ['token', 'clientId', 'guildId']) {
    if (o[k] != null && String(o[k]).trim() !== '') out[k] = String(o[k]).trim();
  }
  return out;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      try {
        resolve(JSON.parse(b || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, LINK);
  try {
    if (pathname === '/api/status') return sendJson(res, 200, getStatus());
    if (pathname === '/api/creds' && req.method === 'GET') return sendJson(res, 200, loadCreds());
    if (pathname === '/api/creds' && req.method === 'POST') {
      saveCreds(clean(await readBody(req)));
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/start' && req.method === 'POST') {
      const body = clean(await readBody(req));
      const creds = { ...loadCreds(), ...body };
      if (Object.keys(body).length) saveCreds(creds); // 입력한 값 저장
      try {
        const status = await startBot(creds);
        return sendJson(res, 200, { ok: true, status });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }
    if (pathname === '/api/stop' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, status: await stopBot() });
    }

    // 정적 파일
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const full = path.join(WEB, rel);
    if (!full.startsWith(WEB)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // 이미 실행 중 → 중복 실행 방지. 기존 패널을 브라우저로 열고 종료.
    console.log(`이미 실행 중입니다. 브라우저에서 ${LINK} 를 엽니다.`);
    exec(`start "" "${LINK}"`);
    process.exit(0);
  } else {
    console.error('서버 오류:', e.message);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🎛️  음악봇 컨트롤 패널: ${LINK}`);
  console.log('   (이 창을 닫으면 봇도 꺼집니다. 계속 켜두세요.)');
  if (process.env.YJ_NO_OPEN !== '1') exec(`start "" "${LINK}"`); // 기본 브라우저로 열기
});

// 창 닫힘/종료 시 봇 정리
async function shutdown() {
  try {
    await stopBot();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

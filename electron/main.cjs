// Electron 메인 프로세스: 창 생성 + 봇 제어 IPC + 자격증명 저장
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// 단순 패널 UI 라 GPU 가속 불필요 — 끄면 GPU 프로세스 RAM 을 크게 아낀다.
app.disableHardwareAcceleration();
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// ESM 봇 모듈을 동적으로 로드
let bot = null;
async function getBot() {
  if (!bot) {
    const url = pathToFileURL(path.join(__dirname, '..', 'src', 'bot.js')).href;
    bot = await import(url);
  }
  return bot;
}

// 자격증명 저장 (사용자 데이터 폴더)
function credPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}
function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(credPath(), 'utf8'));
  } catch {
    return { token: '', clientId: '', guildId: '' };
  }
}
function saveCreds(c) {
  fs.writeFileSync(credPath(), JSON.stringify(c, null, 2), 'utf8');
  return true;
}

let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    title: '음악봇 컨트롤 패널',
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---------- IPC ----------
ipcMain.handle('creds:get', () => loadCreds());
ipcMain.handle('creds:save', (_e, c) => saveCreds(c));

ipcMain.handle('bot:start', async (_e, creds) => {
  try {
    const b = await getBot();
    const status = await b.startBot(creds || loadCreds());
    return { ok: true, status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bot:stop', async () => {
  const b = await getBot();
  const status = await b.stopBot();
  return { ok: true, status };
});

ipcMain.handle('bot:status', async () => {
  const b = await getBot();
  return b.getStatus();
});

// ---------- 앱 생명주기 ----------
// 중복 실행 방지: 두 번째로 켜면 새 창 대신 기존 창을 앞으로 가져온다.
// (봇이 2개 뜨면 상호작용 실패/무음/만료 오류가 나므로 반드시 하나만)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// 진단용 에러 로그 파일 (%APPDATA%/YJ Music Bot/main-error.log)
function logError(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => a?.stack ?? String(a)).join(' ')}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'main-error.log'), line);
  } catch {}
  console.error(line.trim());
}
process.on('uncaughtException', (e) => logError('uncaughtException:', e));
process.on('unhandledRejection', (r) => logError('unhandledRejection:', r));

app.whenReady().then(async () => {
  createWindow();
  // 디버그: YJ_DEBUG_AUTOSTART=1 이면 저장된 자격증명으로 봇 자동 시작 (패키징 검증용)
  if (process.env.YJ_DEBUG_AUTOSTART === '1') {
    try {
      const b = await getBot();
      const status = await b.startBot(loadCreds());
      console.log('[AUTOSTART OK]', JSON.stringify(status));
    } catch (e) {
      logError('[AUTOSTART FAIL]', e);
    }
  }
});

app.on('window-all-closed', async () => {
  try {
    const b = await getBot();
    await b.stopBot();
  } catch {}
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

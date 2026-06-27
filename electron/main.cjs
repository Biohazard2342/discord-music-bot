// Electron 메인 프로세스: 창 생성 + 봇 제어 IPC + 자격증명 저장
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
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
app.whenReady().then(createWindow);

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

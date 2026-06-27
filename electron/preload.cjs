// 렌더러(UI)에 안전한 API만 노출
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getCreds: () => ipcRenderer.invoke('creds:get'),
  saveCreds: (c) => ipcRenderer.invoke('creds:save', c),
  start: (creds) => ipcRenderer.invoke('bot:start', creds),
  stop: () => ipcRenderer.invoke('bot:stop'),
  status: () => ipcRenderer.invoke('bot:status'),
});

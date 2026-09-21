// 컨트롤 패널 UI — 로컬 서버(server.js)와 fetch 로 통신
const $ = (id) => document.getElementById(id);

const statusPill = $('statusPill');
const statusText = $('statusText');
const botTag = $('botTag');
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const errBox = $('err');
const guildBody = $('guildBody');
const emptyGuilds = $('emptyGuilds');
const guildCount = $('guildCount');

let busy = false;

async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(path, opt);
  return r.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function render(status) {
  const online = !!status.online;
  statusPill.classList.toggle('on', online);
  statusText.textContent = online ? '온라인' : '오프라인';
  botTag.textContent = online && status.tag ? status.tag : '';
  startBtn.disabled = busy || online;
  stopBtn.disabled = busy || !online;

  const guilds = status.guilds || [];
  guildCount.textContent = online ? `${guilds.length}개 서버` : '';
  guildBody.innerHTML = '';
  if (!guilds.length) {
    emptyGuilds.style.display = 'block';
    emptyGuilds.textContent = online
      ? '아직 들어가 있는 서버가 없어요. 봇을 서버에 초대해 주세요.'
      : '봇을 켜면 들어가 있는 서버가 여기에 표시됩니다.';
  } else {
    emptyGuilds.style.display = 'none';
    for (const g of guilds) {
      const tr = document.createElement('tr');
      const playing = g.playing
        ? `<span class="playing">${g.paused ? '(일시정지) ' : ''}${escapeHtml(g.playing)}</span>`
        : '<span class="badge">—</span>';
      tr.innerHTML =
        `<td>${escapeHtml(g.name)}</td>` +
        `<td>${g.memberCount ?? '-'}</td>` +
        `<td>${playing}</td>` +
        `<td>${g.queued ? g.queued + '곡' : '-'}</td>`;
      guildBody.appendChild(tr);
    }
  }
}

startBtn.addEventListener('click', async () => {
  errBox.textContent = '';
  busy = true;
  startBtn.disabled = true;
  statusText.textContent = '켜는 중...';
  const creds = {
    token: $('token').value.trim() || undefined,
    clientId: $('clientId').value.trim() || undefined,
    guildId: $('guildId').value.trim() || undefined,
  };
  const res = await api('/api/start', 'POST', creds);
  busy = false;
  if (!res.ok) {
    errBox.textContent = res.error;
    statusText.textContent = '오프라인';
    startBtn.disabled = false;
    return;
  }
  render(res.status);
});

stopBtn.addEventListener('click', async () => {
  errBox.textContent = '';
  busy = true;
  stopBtn.disabled = true;
  statusText.textContent = '끄는 중...';
  const res = await api('/api/stop', 'POST', {});
  busy = false;
  render(res.status);
});

$('saveBtn').addEventListener('click', async () => {
  const creds = {
    token: $('token').value.trim(),
    clientId: $('clientId').value.trim(),
    guildId: $('guildId').value.trim(),
  };
  await api('/api/creds', 'POST', creds);
  const msg = $('saveMsg');
  msg.textContent = '저장됨';
  setTimeout(() => (msg.textContent = ''), 2000);
});

async function init() {
  const creds = await api('/api/creds');
  $('token').value = creds.token || '';
  $('clientId').value = creds.clientId || '';
  $('guildId').value = creds.guildId || '';
  if (!creds.token || !creds.clientId) $('credBox').open = true;
  refresh();
}

async function refresh() {
  if (busy) return;
  try {
    render(await api('/api/status'));
  } catch {}
}

init();
setInterval(refresh, 2500);

// 컨트롤 패널 UI 로직
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

function setBusy(b) {
  busy = b;
  startBtn.disabled = b || statusPill.classList.contains('on');
  stopBtn.disabled = b || !statusPill.classList.contains('on');
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
        ? `<span class="playing">${g.paused ? '⏸️ ' : '▶️ '}${escapeHtml(g.playing)}</span>`
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

// ---------- 버튼 ----------
startBtn.addEventListener('click', async () => {
  errBox.textContent = '';
  setBusy(true);
  statusText.textContent = '켜는 중...';
  const creds = {
    token: $('token').value.trim() || undefined,
    clientId: $('clientId').value.trim() || undefined,
    guildId: $('guildId').value.trim() || undefined,
  };
  const res = await window.api.start(creds);
  setBusy(false);
  if (!res.ok) {
    errBox.textContent = '⚠️ ' + res.error;
    statusText.textContent = '오프라인';
    return;
  }
  render(res.status);
});

stopBtn.addEventListener('click', async () => {
  errBox.textContent = '';
  setBusy(true);
  statusText.textContent = '끄는 중...';
  const res = await window.api.stop();
  setBusy(false);
  render(res.status);
});

$('saveBtn').addEventListener('click', async () => {
  const creds = {
    token: $('token').value.trim(),
    clientId: $('clientId').value.trim(),
    guildId: $('guildId').value.trim(),
  };
  await window.api.saveCreds(creds);
  const msg = $('saveMsg');
  msg.textContent = '✅ 저장됨';
  setTimeout(() => (msg.textContent = ''), 2000);
});

// ---------- 초기 로드 + 주기적 갱신 ----------
async function init() {
  const creds = await window.api.getCreds();
  $('token').value = creds.token || '';
  $('clientId').value = creds.clientId || '';
  $('guildId').value = creds.guildId || '';
  // 토큰이 없으면 설정 영역을 펼쳐서 안내
  if (!creds.token || !creds.clientId) $('credBox').open = true;
  refresh();
}

async function refresh() {
  if (busy) return;
  try {
    const status = await window.api.status();
    render(status);
  } catch {}
}

init();
setInterval(refresh, 2500);

const ACCENT_PALETTE = [
  '#F59E0B',
  '#38BDF8',
  '#34D399',
  '#FB7185',
  '#A78BFA',
  '#FB923C',
  '#2DD4BF',
];

const nameInput = document.getElementById('display-name');
const roomInput = document.getElementById('room-id');
const swatchesEl = document.getElementById('color-swatches');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const syncBtn = document.getElementById('sync-btn');
const chatBtn = document.getElementById('chat-btn');
const activePanel = document.getElementById('active-panel');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
const videoInfo = document.getElementById('video-info');
const peerInfo = document.getElementById('peer-info');
const errorMsg = document.getElementById('error-msg');

let selectedColor = ACCENT_PALETTE[Math.floor(Math.random() * ACCENT_PALETTE.length)];
let pollTimer = null;

function extractRoomId(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes('://') || trimmed.includes('?room=')) {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://dummy.local/${trimmed.replace(/^\/+/, '')}`);
      const q = url.searchParams.get('room');
      if (q) return q.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      const match = url.pathname.match(/\/room\/([a-z0-9-]+)/i);
      if (match && match[1]) return match[1].toLowerCase();
    }
  } catch {
    // Fallback to raw code
  }
  const cleaned = trimmed.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return cleaned.length >= 3 && cleaned.length <= 32 ? cleaned : null;
}

function renderSwatches() {
  swatchesEl.innerHTML = '';
  ACCENT_PALETTE.forEach((color) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch' + (color === selectedColor ? ' active' : '');
    btn.style.backgroundColor = color;
    btn.title = color;
    btn.addEventListener('click', () => {
      selectedColor = color;
      chrome.storage.local.set({ kinosync_color: color });
      renderSwatches();
    });
    swatchesEl.appendChild(btn);
  });
}

function showError(text) {
  if (!text) {
    errorMsg.style.display = 'none';
    errorMsg.textContent = '';
  } else {
    errorMsg.style.display = 'block';
    errorMsg.textContent = text;
  }
}

function updateUIState(state) {
  if (!state) return;

  const connected = state.status === 'connected';
  const connecting = state.status === 'connecting' || state.status === 'reconnecting';
  const errored = state.status === 'error';

  statusDot.className = 'dot' + (connected ? ' ok' : connecting ? ' warn' : errored ? ' err' : '');
  statusLabel.textContent =
    connected
      ? `Connected · ${state.roomId}`
      : connecting
      ? 'Connecting...'
      : errored
      ? 'Error'
      : 'Idle';

  if (state.active) {
    activePanel.style.display = 'flex';
    connectBtn.textContent = 'Reconnect';
  } else {
    activePanel.style.display = 'none';
    connectBtn.textContent = 'Connect to Room';
  }

  if (state.videoFound) {
    const res = state.videoWidth && state.videoHeight ? `${state.videoWidth}×${state.videoHeight}` : 'ready';
    const playState = state.isPlaying ? 'Playing' : 'Paused';
    videoInfo.textContent = `Video detected (${res}) · ${playState}`;
  } else {
    videoInfo.textContent = 'No active <video> detected yet (waiting for player...)';
  }

  if (state.lastError) {
    peerInfo.textContent = state.lastError;
  } else if (connected) {
    peerInfo.textContent = `${state.peerCount || 1} participant(s) in room`;
  } else {
    peerInfo.textContent = 'Open the movie tab and wait for PeerJS handshake.';
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function queryTabStatus() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'KINOSYNC_GET_STATUS' });
    if (response) updateUIState(response);
  } catch {
    // Content script might not run on chrome:// pages
  }
}

chrome.storage.local.get(
  ['kinosync_name', 'kinosync_color', 'kinosync_room'],
  (res) => {
    if (res.kinosync_name) nameInput.value = res.kinosync_name;
    if (res.kinosync_color) selectedColor = res.kinosync_color;
    else chrome.storage.local.set({ kinosync_color: selectedColor });
    if (res.kinosync_room) roomInput.value = res.kinosync_room;
    renderSwatches();
    void queryTabStatus();
    pollTimer = window.setInterval(queryTabStatus, 1200);
  }
);

window.addEventListener('unload', () => {
  if (pollTimer) window.clearInterval(pollTimer);
});

connectBtn.addEventListener('click', async () => {
  showError(null);
  const displayName = nameInput.value.trim() || 'Viewer';
  const roomId = extractRoomId(roomInput.value);
  if (!roomId) {
    showError('Enter a valid Room ID or Vercel ?room= invite link.');
    return;
  }

  roomInput.value = roomId;
  await chrome.storage.local.set({
    kinosync_active: true,
    kinosync_name: displayName,
    kinosync_color: selectedColor,
    kinosync_room: roomId,
  });

  const tab = await getActiveTab();
  if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
    showError('Navigate to a movie webpage tab before connecting.');
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'KINOSYNC_CONNECT',
      roomId,
      displayName,
      color: selectedColor,
    });
    window.setTimeout(queryTabStatus, 250);
  } catch {
    showError('Reload this movie tab once so KinoSync can attach to the video player.');
  }
});

disconnectBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ kinosync_active: false });
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'KINOSYNC_DISCONNECT' });
    updateUIState({ active: false, status: 'idle', videoFound: false });
  } catch {
    // Ignore
  }
});

syncBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'KINOSYNC_FORCE_SYNC' });
  } catch {
    // Ignore
  }
});

chatBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'KINOSYNC_TOGGLE_CHAT' });
  } catch {
    // Ignore
  }
});

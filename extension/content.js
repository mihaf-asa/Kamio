(() => {
  if (window.__KINOSYNC_CONTENT_LOADED__) return;
  window.__KINOSYNC_CONTENT_LOADED__ = true;

  const isTopFrame = window === window.top;
  const FRAME_ID = 'frame-' + Math.random().toString(36).slice(2, 10);
  const PEER_ID_PREFIX = 'kinosync-';
  const DRIFT_CHECK_INTERVAL_MS = 3000;
  const DRIFT_THRESHOLD_SECONDS = 0.75;
  const REMOTE_LOCK_MS = 200;
  const REACTIONS = ['😂', '😱', '❤️', '🔥', '👏'];
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];

  // Shared Frame State
  let activeVideo = null;
  let videoObserver = null;
  let boundVideo = null;
  let isRemoteAction = false;
  let remoteLockTimer = null;
  let isDesignatedOverlayFrame = isTopFrame;

  // Top-frame P2P Coordinator State
  let peer = null;
  let hostConn = null;
  let reconnectTimer = null;
  let seqCounter = 0;
  let rttMs = 0;
  let stateConfig = {
    active: false,
    roomId: '',
    displayName: 'Viewer',
    color: '#F59E0B',
  };
  let connectionStatus = 'idle'; // idle | connecting | connected | reconnecting | error
  let lastError = null;
  let participants = [];
  let feedItems = [];
  let latestRoomPlayback = null; // { isPlaying, currentTime, playbackRate, receivedAt }

  // Cross-frame Video Election State (Top Frame only)
  const frameReports = new Map(); // frameId -> { score, width, height, isPlaying, currentTime, playbackRate, updatedAt }
  let activeVideoFrameId = null;

  // Overlay UI State (Per frame that renders Shadow DOM)
  let overlayHost = null;
  let shadowRoot = null;
  let drawerOpen = false;
  let unreadCount = 0;
  let toasts = [];
  let localOverlayState = {
    active: false,
    roomId: '',
    status: 'idle',
    peerCount: 0,
    feed: [],
    color: '#F59E0B',
  };

  function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function armRemoteLock() {
    isRemoteAction = true;
    if (remoteLockTimer) clearTimeout(remoteLockTimer);
    remoteLockTimer = setTimeout(() => {
      isRemoteAction = false;
      remoteLockTimer = null;
    }, REMOTE_LOCK_MS);
  }

  // Recursively broadcast messages down to all nested iframes
  function broadcastToChildFrames(win, msg) {
    try {
      for (let i = 0; i < win.frames.length; i++) {
        try {
          win.frames[i].postMessage(msg, '*');
        } catch {
          // Ignore cross-origin frame errors
        }
      }
    } catch {
      // Ignore
    }
  }

  function collectAllVideos(root, list = []) {
    if (!root) return list;
    const videos = root.querySelectorAll ? root.querySelectorAll('video') : [];
    videos.forEach((v) => list.push(v));
    const allEls = root.querySelectorAll ? root.querySelectorAll('*') : [];
    allEls.forEach((el) => {
      if (el.shadowRoot) {
        collectAllVideos(el.shadowRoot, list);
      }
    });
    return list;
  }

  function findBestVideo() {
    const candidates = collectAllVideos(document);
    let best = null;
    let bestScore = -1;

    for (const v of candidates) {
      const rect = v.getBoundingClientRect();
      const hasDims = (rect.width >= 150 && rect.height >= 85) || v.videoWidth >= 150;
      const hasSource = Boolean(v.currentSrc || v.src || v.readyState >= 1);
      if (!hasDims || !hasSource) continue;

      const area = Math.max(rect.width * rect.height, v.videoWidth * v.videoHeight * 0.25);
      const playingBonus = !v.paused && !v.ended && v.readyState >= 2 ? 25000000 : 0;
      const score = area + playingBonus;

      if (score > bestScore) {
        bestScore = score;
        best = { video: v, score, width: Math.round(rect.width || v.videoWidth), height: Math.round(rect.height || v.videoHeight) };
      }
    }
    return best;
  }

  function reportLocalVideoState() {
    const best = findBestVideo();
    activeVideo = best ? best.video : null;

    if (activeVideo && activeVideo !== boundVideo) {
      bindVideoListeners(activeVideo);
    }

    const payload = {
      __kinosync: true,
      kind: 'FRAME_VIDEO_REPORT',
      frameId: FRAME_ID,
      found: Boolean(best),
      score: best ? best.score : 0,
      width: best ? best.width : 0,
      height: best ? best.height : 0,
      isPlaying: best ? !best.video.paused && !best.video.ended : false,
      currentTime: best ? best.video.currentTime || 0 : 0,
      playbackRate: best ? best.video.playbackRate || 1 : 1,
    };

    if (isTopFrame) {
      handleFrameVideoReport(payload);
    } else {
      try {
        window.top.postMessage(payload, '*');
      } catch {
        // Ignore
      }
    }
  }

  function emitPlaybackEvent(eventType, video) {
    if (!video) return;
    const msg = {
      __kinosync: true,
      kind: 'FRAME_PLAYBACK_EVENT',
      frameId: FRAME_ID,
      eventType,
      currentTime: video.currentTime || 0,
      playbackRate: video.playbackRate || 1,
      isPlaying: !video.paused && !video.ended,
    };

    if (isTopFrame) {
      handleFramePlaybackEvent(msg);
    } else {
      try {
        window.top.postMessage(msg, '*');
      } catch {
        // Ignore
      }
    }
  }

  function bindVideoListeners(video) {
    if (boundVideo === video) return;
    if (boundVideo) {
      boundVideo.removeEventListener('play', onVideoPlay);
      boundVideo.removeEventListener('pause', onVideoPause);
      boundVideo.removeEventListener('seeked', onVideoSeeked);
      boundVideo.removeEventListener('ratechange', onVideoRateChange);
    }
    boundVideo = video;
    video.addEventListener('play', onVideoPlay);
    video.addEventListener('pause', onVideoPause);
    video.addEventListener('seeked', onVideoSeeked);
    video.addEventListener('ratechange', onVideoRateChange);
  }

  function onVideoPlay() {
    reportLocalVideoState();
    if (isRemoteAction) return;
    emitPlaybackEvent('play', boundVideo);
  }

  function onVideoPause() {
    reportLocalVideoState();
    if (isRemoteAction) return;
    if (boundVideo && boundVideo.ended) return;
    emitPlaybackEvent('pause', boundVideo);
  }

  function onVideoSeeked() {
    if (isRemoteAction) return;
    emitPlaybackEvent('seeked', boundVideo);
  }

  function onVideoRateChange() {
    if (isRemoteAction) return;
    emitPlaybackEvent('ratechange', boundVideo);
  }

  function applyRemoteCommandToVideo(cmd) {
    const video = activeVideo;
    if (!video) return;

    armRemoteLock();

    if (cmd.action === 'play') {
      if (typeof cmd.playbackRate === 'number' && video.playbackRate !== cmd.playbackRate) {
        video.playbackRate = cmd.playbackRate;
      }
      if (typeof cmd.currentTime === 'number' && Math.abs(video.currentTime - cmd.currentTime) > 0.75) {
        video.currentTime = Math.max(0, cmd.currentTime);
      }
      if (video.paused) {
        video.play().catch(() => {
          pushToast('Playback', 'Click video once to allow synced autoplay', '#F59E0B');
        });
      }
    } else if (cmd.action === 'pause') {
      if (!video.paused) {
        video.pause();
      }
      if (typeof cmd.currentTime === 'number' && Math.abs(video.currentTime - cmd.currentTime) > 0.5) {
        video.currentTime = Math.max(0, cmd.currentTime);
      }
    } else if (cmd.action === 'seek') {
      if (typeof cmd.currentTime === 'number') {
        video.currentTime = Math.max(0, cmd.currentTime);
      }
      if (typeof cmd.isPlaying === 'boolean') {
        if (cmd.isPlaying && video.paused) {
          video.play().catch(() => {
            pushToast('Playback', 'Click video once to allow synced autoplay', '#F59E0B');
          });
        } else if (!cmd.isPlaying && !video.paused) {
          video.pause();
        }
      }
    } else if (cmd.action === 'rate') {
      if (typeof cmd.playbackRate === 'number') {
        video.playbackRate = cmd.playbackRate;
      }
      if (typeof cmd.currentTime === 'number' && Math.abs(video.currentTime - cmd.currentTime) > 0.75) {
        video.currentTime = Math.max(0, cmd.currentTime);
      }
    } else if (cmd.action === 'drift') {
      const targetTime = cmd.expectedTime;
      const shouldPlay = cmd.isPlaying;
      if (typeof cmd.playbackRate === 'number' && Math.abs(video.playbackRate - cmd.playbackRate) > 0.01) {
        video.playbackRate = cmd.playbackRate;
      }
      if (shouldPlay && video.paused) {
        video.play().catch(() => {});
      } else if (!shouldPlay && !video.paused) {
        video.pause();
      }
      if (typeof targetTime === 'number' && Math.abs(video.currentTime - targetTime) > DRIFT_THRESHOLD_SECONDS) {
        video.currentTime = Math.max(0, targetTime);
      }
    }
  }

  // =========================================================================
  // Top-Frame Coordinator & PeerJS Logic
  // =========================================================================

  function handleFrameVideoReport(report) {
    if (!isTopFrame) return;
    if (report.found) {
      frameReports.set(report.frameId, {
        ...report,
        updatedAt: Date.now(),
      });
    } else {
      frameReports.delete(report.frameId);
    }

    // Prune stale reports older than 5s
    const now = Date.now();
    for (const [fId, entry] of frameReports.entries()) {
      if (now - entry.updatedAt > 5000) {
        frameReports.delete(fId);
      }
    }

    let winnerId = null;
    let winnerScore = -1;
    for (const [fId, entry] of frameReports.entries()) {
      if (entry.score > winnerScore) {
        winnerScore = entry.score;
        winnerId = fId;
      }
    }

    const nextOverlayOwner = winnerId || FRAME_ID;
    if (activeVideoFrameId !== winnerId) {
      activeVideoFrameId = winnerId;
    }

    isDesignatedOverlayFrame = nextOverlayOwner === FRAME_ID;
    syncOverlayVisibility();

    broadcastToChildFrames(window, {
      __kinosync: true,
      kind: 'ACTIVATE_FRAME',
      overlayOwnerFrameId: nextOverlayOwner,
      activeVideoFrameId: winnerId,
    });
  }

  function handleFramePlaybackEvent(msg) {
    if (!isTopFrame || !stateConfig.active) return;
    if (activeVideoFrameId && msg.frameId !== activeVideoFrameId) return;
    if (!hostConn || !hostConn.open) return;

    seqCounter += 1;
    const base = {
      sentAt: Date.now(),
      actorId: peer ? peer.id : 'ext',
      actorName: stateConfig.displayName,
      actorColor: stateConfig.color,
      seq: seqCounter,
    };

    if (msg.eventType === 'play') {
      latestRoomPlayback = {
        isPlaying: true,
        currentTime: msg.currentTime,
        playbackRate: msg.playbackRate || 1,
        receivedAt: Date.now(),
      };
      hostConn.send({
        type: 'playback:play',
        currentTime: msg.currentTime,
        playbackRate: msg.playbackRate || 1,
        ...base,
      });
    } else if (msg.eventType === 'pause') {
      latestRoomPlayback = {
        isPlaying: false,
        currentTime: msg.currentTime,
        playbackRate: msg.playbackRate || 1,
        receivedAt: Date.now(),
      };
      hostConn.send({
        type: 'playback:pause',
        currentTime: msg.currentTime,
        ...base,
      });
    } else if (msg.eventType === 'seeked') {
      latestRoomPlayback = {
        isPlaying: msg.isPlaying,
        currentTime: msg.currentTime,
        playbackRate: msg.playbackRate || 1,
        receivedAt: Date.now(),
      };
      hostConn.send({
        type: 'playback:seek',
        currentTime: msg.currentTime,
        isPlaying: msg.isPlaying,
        ...base,
      });
    } else if (msg.eventType === 'ratechange') {
      latestRoomPlayback = {
        isPlaying: msg.isPlaying,
        currentTime: msg.currentTime,
        playbackRate: msg.playbackRate || 1,
        receivedAt: Date.now(),
      };
      hostConn.send({
        type: 'playback:rate',
        playbackRate: msg.playbackRate || 1,
        currentTime: msg.currentTime,
        ...base,
      });
    }
  }

  function dispatchRemoteCommand(cmd) {
    if (!isTopFrame) return;
    if (!activeVideoFrameId || activeVideoFrameId === FRAME_ID) {
      applyRemoteCommandToVideo(cmd);
    } else {
      broadcastToChildFrames(window, {
        __kinosync: true,
        kind: 'REMOTE_COMMAND',
        targetFrameId: activeVideoFrameId,
        cmd,
      });
    }
  }

  function pushOverlayStateToFrames() {
    if (!isTopFrame) return;
    const snapshot = {
      active: stateConfig.active,
      roomId: stateConfig.roomId,
      status: connectionStatus,
      peerCount: participants.length || 1,
      feed: feedItems.slice(-40),
      color: stateConfig.color,
    };
    localOverlayState = snapshot;
    renderOverlayContents();

    broadcastToChildFrames(window, {
      __kinosync: true,
      kind: 'SYNC_OVERLAY_STATE',
      state: snapshot,
    });
  }

  function pushToastToFrames(senderName, text, color) {
    if (!isTopFrame) return;
    if (isDesignatedOverlayFrame) {
      pushToast(senderName, text, color);
    } else {
      broadcastToChildFrames(window, {
        __kinosync: true,
        kind: 'TOAST_EVENT',
        senderName,
        text,
        color,
      });
    }
  }

  function handleIncomingPeerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'ping':
        if (hostConn && hostConn.open) {
          hostConn.send({ type: 'pong', sentAt: msg.sentAt });
        }
        break;

      case 'pong':
        rttMs = Math.max(1, Date.now() - msg.sentAt);
        break;

      case 'peer:list':
        participants = msg.participants || [];
        pushOverlayStateToFrames();
        break;

      case 'room:state': {
        participants = msg.participants || [];
        feedItems = msg.feed || [];
        connectionStatus = 'connected';
        lastError = null;
        const elapsed = msg.isPlaying ? Math.max(0, (Date.now() - msg.sentAt) / 1000) : 0;
        const targetTime = Math.max(0, (msg.currentTime || 0) + elapsed * (msg.playbackRate || 1));
        latestRoomPlayback = {
          isPlaying: Boolean(msg.isPlaying),
          currentTime: targetTime,
          playbackRate: msg.playbackRate || 1,
          receivedAt: Date.now(),
        };
        dispatchRemoteCommand({
          action: 'seek',
          currentTime: targetTime,
          isPlaying: Boolean(msg.isPlaying),
          playbackRate: msg.playbackRate || 1,
        });
        pushOverlayStateToFrames();
        pushToastToFrames('KinoSync', `Joined Room ${stateConfig.roomId}`, '#10B981');
        break;
      }

      case 'playback:play': {
        const oneWay = rttMs > 0 ? rttMs / 2000 : 0.04;
        const target = Math.max(0, (msg.currentTime || 0) + oneWay * (msg.playbackRate || 1));
        latestRoomPlayback = {
          isPlaying: true,
          currentTime: target,
          playbackRate: msg.playbackRate || 1,
          receivedAt: Date.now(),
        };
        dispatchRemoteCommand({
          action: 'play',
          currentTime: target,
          playbackRate: msg.playbackRate || 1,
        });
        const item = {
          id: `evt-play-${msg.seq}-${msg.actorId}`,
          kind: 'event',
          senderId: msg.actorId,
          senderName: msg.actorName,
          senderColor: msg.actorColor || '#F59E0B',
          text: `resumed at ${formatTime(msg.currentTime)}`,
          timestamp: Date.now(),
        };
        appendLocalFeed(item);
        pushToastToFrames(msg.actorName, `resumed at ${formatTime(msg.currentTime)}`, msg.actorColor);
        break;
      }

      case 'playback:pause': {
        latestRoomPlayback = {
          isPlaying: false,
          currentTime: msg.currentTime || 0,
          playbackRate: 1,
          receivedAt: Date.now(),
        };
        dispatchRemoteCommand({
          action: 'pause',
          currentTime: msg.currentTime || 0,
        });
        const item = {
          id: `evt-pause-${msg.seq}-${msg.actorId}`,
          kind: 'event',
          senderId: msg.actorId,
          senderName: msg.actorName,
          senderColor: msg.actorColor || '#F59E0B',
          text: `paused at ${formatTime(msg.currentTime)}`,
          timestamp: Date.now(),
        };
        appendLocalFeed(item);
        pushToastToFrames(msg.actorName, `paused at ${formatTime(msg.currentTime)}`, msg.actorColor);
        break;
      }

      case 'playback:seek': {
        latestRoomPlayback = {
          isPlaying: Boolean(msg.isPlaying),
          currentTime: msg.currentTime || 0,
          playbackRate: 1,
          receivedAt: Date.now(),
        };
        dispatchRemoteCommand({
          action: 'seek',
          currentTime: msg.currentTime || 0,
          isPlaying: Boolean(msg.isPlaying),
        });
        const item = {
          id: `evt-seek-${msg.seq}-${msg.actorId}`,
          kind: 'event',
          senderId: msg.actorId,
          senderName: msg.actorName,
          senderColor: msg.actorColor || '#F59E0B',
          text: `jumped to ${formatTime(msg.currentTime)}`,
          timestamp: Date.now(),
        };
        appendLocalFeed(item);
        pushToastToFrames(msg.actorName, `jumped to ${formatTime(msg.currentTime)}`, msg.actorColor);
        break;
      }

      case 'playback:rate': {
        latestRoomPlayback = {
          isPlaying: latestRoomPlayback ? latestRoomPlayback.isPlaying : false,
          currentTime: msg.currentTime || 0,
          playbackRate: msg.playbackRate || 1,
          receivedAt: Date.now(),
        };
        dispatchRemoteCommand({
          action: 'rate',
          playbackRate: msg.playbackRate || 1,
          currentTime: msg.currentTime || 0,
        });
        const item = {
          id: `evt-rate-${msg.seq}-${msg.actorId}`,
          kind: 'event',
          senderId: msg.actorId,
          senderName: msg.actorName,
          senderColor: msg.actorColor || '#F59E0B',
          text: `set speed to ${msg.playbackRate}x`,
          timestamp: Date.now(),
        };
        appendLocalFeed(item);
        pushToastToFrames(msg.actorName, `set speed to ${msg.playbackRate}x`, msg.actorColor);
        break;
      }

      case 'sync:force': {
        const elapsed = msg.isPlaying ? Math.max(0, (Date.now() - msg.sentAt) / 1000) : 0;
        const target = Math.max(0, (msg.currentTime || 0) + elapsed * (msg.playbackRate || 1));
        latestRoomPlayback = {
          isPlaying: Boolean(msg.isPlaying),
          currentTime: target,
          playbackRate: msg.playbackRate || 1,
          receivedAt: Date.now(),
        };
        dispatchRemoteCommand({
          action: 'seek',
          currentTime: target,
          isPlaying: Boolean(msg.isPlaying),
        });
        pushToastToFrames(msg.actorName || 'Host', `forced sync to ${formatTime(target)}`, '#F59E0B');
        break;
      }

      case 'sync:heartbeat': {
        const oneWay = rttMs > 0 ? rttMs / 2000 : 0.04;
        const expected = msg.isPlaying
          ? (msg.currentTime || 0) + oneWay * (msg.playbackRate || 1)
          : msg.currentTime || 0;
        latestRoomPlayback = {
          isPlaying: Boolean(msg.isPlaying),
          currentTime: expected,
          playbackRate: msg.playbackRate || 1,
          receivedAt: Date.now(),
        };
        break;
      }

      case 'chat:message': {
        if (!msg.item) break;
        appendLocalFeed(msg.item);
        if (msg.item.kind === 'chat') {
          pushToastToFrames(msg.item.senderName, msg.item.text, msg.item.senderColor);
        } else if (msg.item.kind === 'reaction') {
          pushToastToFrames(msg.item.senderName, `reacted ${msg.item.text}`, msg.item.senderColor);
        }
        break;
      }
    }
  }

  function appendLocalFeed(item) {
    if (feedItems.some((f) => f.id === item.id)) return;
    feedItems = [...feedItems, item].slice(-60);
    pushOverlayStateToFrames();
  }

  function disconnectPeer() {
    stateConfig.active = false;
    connectionStatus = 'idle';
    lastError = null;
    latestRoomPlayback = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (peer) {
      try {
        peer.destroy();
      } catch {
        // Ignore
      }
      peer = null;
    }
    hostConn = null;
    participants = [];
    pushOverlayStateToFrames();
  }

  function connectPeer(roomId, displayName, color) {
    disconnectPeer();
    stateConfig = {
      active: true,
      roomId,
      displayName: displayName || 'Viewer',
      color: color || '#F59E0B',
    };
    connectionStatus = 'connecting';
    lastError = null;
    pushOverlayStateToFrames();

    if (typeof window.Peer !== 'function') {
      connectionStatus = 'error';
      lastError = 'PeerJS failed to initialize in this frame.';
      pushOverlayStateToFrames();
      return;
    }

    try {
      peer = new window.Peer({
        config: { iceServers: ICE_SERVERS },
        debug: 0,
      });
    } catch (err) {
      connectionStatus = 'error';
      lastError = (err && err.message) || 'Unable to start WebRTC peer.';
      pushOverlayStateToFrames();
      return;
    }

    peer.on('open', (assignedId) => {
      if (!stateConfig.active) return;
      const targetId = `${PEER_ID_PREFIX}${roomId}`;
      hostConn = peer.connect(targetId, { reliable: true });

      hostConn.on('open', () => {
        if (!stateConfig.active) return;
        connectionStatus = 'connected';
        lastError = null;
        hostConn.send({
          type: 'peer:hello',
          peerId: assignedId,
          name: stateConfig.displayName,
          color: stateConfig.color,
          clientType: 'extension',
        });
        hostConn.send({ type: 'ping', sentAt: Date.now() });
        pushOverlayStateToFrames();
      });

      hostConn.on('data', (data) => {
        if (!stateConfig.active) return;
        handleIncomingPeerMessage(data);
      });

      hostConn.on('close', () => {
        if (!stateConfig.active) return;
        connectionStatus = 'reconnecting';
        lastError = 'Disconnected from room host. Retrying...';
        pushOverlayStateToFrames();
        reconnectTimer = setTimeout(() => {
          if (stateConfig.active) {
            connectPeer(stateConfig.roomId, stateConfig.displayName, stateConfig.color);
          }
        }, 3000);
      });

      hostConn.on('error', () => {
        if (!stateConfig.active) return;
        connectionStatus = 'reconnecting';
        pushOverlayStateToFrames();
      });
    });

    peer.on('error', (err) => {
      if (!stateConfig.active) return;
      const errType = err && err.type;
      if (errType === 'peer-unavailable' || errType === 'network' || errType === 'disconnected') {
        connectionStatus = 'reconnecting';
        lastError =
          errType === 'peer-unavailable'
            ? 'Room host not found yet. Keep the Vercel room open and retrying...'
            : 'Network interrupted. Reconnecting...';
        pushOverlayStateToFrames();
        reconnectTimer = setTimeout(() => {
          if (stateConfig.active) {
            connectPeer(stateConfig.roomId, stateConfig.displayName, stateConfig.color);
          }
        }, 3000);
      } else {
        connectionStatus = 'error';
        lastError = (err && err.message) || 'Page CSP or WebRTC error prevented PeerJS connection.';
        pushOverlayStateToFrames();
      }
    });
  }

  function sendChatFromAnyFrame(text) {
    const clean = (text || '').trim();
    if (!clean) return;
    if (!isTopFrame) {
      window.top.postMessage({ __kinosync: true, kind: 'FRAME_SEND_CHAT', text: clean }, '*');
      return;
    }
    if (!hostConn || !hostConn.open) {
      pushToastToFrames('KinoSync', 'Not connected to room host yet', '#EF4444');
      return;
    }
    const item = {
      id: createId(),
      kind: 'chat',
      senderId: peer ? peer.id : 'ext',
      senderName: stateConfig.displayName,
      senderColor: stateConfig.color,
      text: clean,
      timestamp: Date.now(),
    };
    appendLocalFeed(item);
    hostConn.send({ type: 'chat:message', item });
  }

  function sendReactionFromAnyFrame(emoji) {
    if (!isTopFrame) {
      window.top.postMessage({ __kinosync: true, kind: 'FRAME_SEND_REACTION', emoji }, '*');
      return;
    }
    if (!hostConn || !hostConn.open) return;
    const item = {
      id: createId(),
      kind: 'reaction',
      senderId: peer ? peer.id : 'ext',
      senderName: stateConfig.displayName,
      senderColor: stateConfig.color,
      text: emoji,
      timestamp: Date.now(),
    };
    appendLocalFeed(item);
    hostConn.send({ type: 'chat:message', item });
  }

  // Periodic 3-second drift correction & status reporting (Top frame)
  if (isTopFrame) {
    setInterval(() => {
      if (!stateConfig.active || !hostConn || !hostConn.open) return;

      // Report current video status to host for Connected Participants badge (Synced / Paused / Drift)
      const activeReport = activeVideoFrameId ? frameReports.get(activeVideoFrameId) : null;
      if (activeReport) {
        hostConn.send({
          type: 'peer:status',
          peerId: peer ? peer.id : 'ext',
          isPlaying: activeReport.isPlaying,
          currentTime: activeReport.currentTime,
          playbackRate: activeReport.playbackRate || 1,
          sentAt: Date.now(),
        });
      }

      // Check drift every 3s (> 0.75s)
      if (latestRoomPlayback) {
        const elapsed = latestRoomPlayback.isPlaying
          ? Math.max(0, (Date.now() - latestRoomPlayback.receivedAt) / 1000)
          : 0;
        const expectedTime =
          latestRoomPlayback.currentTime + elapsed * (latestRoomPlayback.playbackRate || 1);

        dispatchRemoteCommand({
          action: 'drift',
          expectedTime,
          isPlaying: latestRoomPlayback.isPlaying,
          playbackRate: latestRoomPlayback.playbackRate || 1,
        });
      }

      // Keep RTT updated
      hostConn.send({ type: 'ping', sentAt: Date.now() });
    }, DRIFT_CHECK_INTERVAL_MS);
  }

  // =========================================================================
  // In-Video Floating Mini-Chat & Toast Overlay (Shadow DOM + Fullscreen)
  // =========================================================================

  function getOverlayMountParent() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl.tagName !== 'VIDEO') {
      return fsEl;
    }
    return document.body || document.documentElement;
  }

  function ensureOverlayMounted() {
    if (!localOverlayState.active || !isDesignatedOverlayFrame) {
      if (overlayHost && overlayHost.parentNode) {
        overlayHost.parentNode.removeChild(overlayHost);
      }
      return;
    }

    const mountParent = getOverlayMountParent();
    if (!mountParent) return;

    if (!overlayHost) {
      overlayHost = document.createElement('div');
      overlayHost.id = 'kinosync-overlay-host';
      overlayHost.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
      shadowRoot = overlayHost.attachShadow({ mode: 'open' });

      shadowRoot.innerHTML = `
        <style>
          * { box-sizing: border-box; }
          .ks-root {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
            pointer-events: none;
            color: #f4f4f5;
            font-size: 12px;
          }
          .ks-toggle {
            pointer-events: auto;
            display: inline-flex;
            align-items: center;
            gap: 7px;
            height: 36px;
            padding: 0 12px;
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.16);
            background: rgba(9, 9, 11, 0.78);
            backdrop-filter: blur(10px);
            color: #f4f4f5;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 8px 24px rgba(0,0,0,0.45);
            transition: background 0.15s ease, border-color 0.15s ease;
          }
          .ks-toggle:hover {
            background: rgba(24, 24, 29, 0.92);
            border-color: rgba(245, 158, 11, 0.6);
          }
          .ks-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #f59e0b;
          }
          .ks-dot.ok { background: #10b981; }
          .ks-badge {
            min-width: 18px;
            height: 18px;
            padding: 0 5px;
            border-radius: 999px;
            background: #f59e0b;
            color: #09090b;
            font-size: 10px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .ks-toasts {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 6px;
            max-width: 280px;
            pointer-events: none;
          }
          .ks-toast {
            padding: 7px 11px;
            border-radius: 10px;
            background: rgba(9, 9, 11, 0.78);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.12);
            color: #f4f4f5;
            font-size: 12px;
            line-height: 1.35;
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            animation: ksFadeIn 0.18s ease-out;
          }
          @keyframes ksFadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .ks-drawer {
            pointer-events: auto;
            width: 316px;
            max-height: 430px;
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            background: rgba(9, 9, 11, 0.88);
            backdrop-filter: blur(14px);
            border: 1px solid rgba(255,255,255,0.14);
            box-shadow: 0 18px 48px rgba(0,0,0,0.65);
            overflow: hidden;
          }
          .ks-drawer-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            background: rgba(17, 17, 21, 0.75);
          }
          .ks-title {
            font-weight: 700;
            font-size: 12px;
            color: #ffffff;
          }
          .ks-sub {
            font-size: 11px;
            color: #a1a1aa;
          }
          .ks-close {
            background: transparent;
            border: none;
            color: #a1a1aa;
            font-size: 15px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 6px;
          }
          .ks-close:hover {
            color: #ffffff;
            background: rgba(255,255,255,0.1);
          }
          .ks-feed {
            flex: 1;
            min-height: 190px;
            max-height: 260px;
            overflow-y: auto;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .ks-msg {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .ks-msg-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 10px;
            color: #71717a;
          }
          .ks-sender {
            font-weight: 700;
            font-size: 11px;
          }
          .ks-bubble {
            padding: 6px 9px;
            border-radius: 8px;
            background: rgba(255,255,255,0.07);
            color: #f4f4f5;
            word-break: break-word;
            line-height: 1.35;
          }
          .ks-evt {
            font-size: 11px;
            color: #a1a1aa;
          }
          .ks-reacts {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 10px;
            border-top: 1px solid rgba(255,255,255,0.08);
            background: rgba(17, 17, 21, 0.55);
          }
          .ks-react-btn {
            background: transparent;
            border: 1px solid transparent;
            border-radius: 6px;
            font-size: 15px;
            padding: 3px 7px;
            cursor: pointer;
          }
          .ks-react-btn:hover {
            background: rgba(255,255,255,0.1);
          }
          .ks-form {
            display: flex;
            gap: 6px;
            padding: 8px 10px;
            border-top: 1px solid rgba(255,255,255,0.08);
          }
          .ks-input {
            flex: 1;
            height: 32px;
            padding: 0 9px;
            border-radius: 7px;
            border: 1px solid rgba(255,255,255,0.14);
            background: rgba(9,9,11,0.9);
            color: #ffffff;
            font-size: 12px;
            outline: none;
          }
          .ks-input:focus {
            border-color: #f59e0b;
          }
          .ks-send {
            height: 32px;
            padding: 0 11px;
            border-radius: 7px;
            border: none;
            background: #f59e0b;
            color: #09090b;
            font-weight: 700;
            font-size: 12px;
            cursor: pointer;
          }
        </style>
        <div class="ks-root">
          <button type="button" class="ks-toggle" id="ks-toggle-btn" title="Toggle Mini-Chat (Alt + C)">
            <span class="ks-dot" id="ks-dot"></span>
            <span id="ks-toggle-label">Chat</span>
            <span class="ks-badge" id="ks-badge" style="display:none">0</span>
          </button>
          <div class="ks-toasts" id="ks-toasts"></div>
          <div class="ks-drawer" id="ks-drawer" style="display:none">
            <div class="ks-drawer-head">
              <div>
                <div class="ks-title" id="ks-room-title">KinoSync</div>
                <div class="ks-sub" id="ks-room-sub">Connecting...</div>
              </div>
              <button type="button" class="ks-close" id="ks-close-btn" title="Close (Alt + C)">✕</button>
            </div>
            <div class="ks-feed" id="ks-feed"></div>
            <div class="ks-reacts" id="ks-reacts"></div>
            <form class="ks-form" id="ks-form">
              <input class="ks-input" id="ks-input" type="text" maxlength="350" placeholder="Message room..." autocomplete="off" />
              <button class="ks-send" type="submit">Send</button>
            </form>
          </div>
        </div>
      `;

      const toggleBtn = shadowRoot.getElementById('ks-toggle-btn');
      const closeBtn = shadowRoot.getElementById('ks-close-btn');
      const form = shadowRoot.getElementById('ks-form');
      const input = shadowRoot.getElementById('ks-input');
      const reactsBar = shadowRoot.getElementById('ks-reacts');

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDrawer();
      });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDrawer(false);
      });

      REACTIONS.forEach((emoji) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ks-react-btn';
        b.textContent = emoji;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          sendReactionFromAnyFrame(emoji);
        });
        reactsBar.appendChild(b);
      });

      // Prevent player hotkeys (Space, F, M, J, K, L, Arrows) from firing while typing
      ['keydown', 'keyup', 'keypress'].forEach((evtName) => {
        input.addEventListener(evtName, (e) => {
          if (e.altKey && e.key && e.key.toLowerCase() === 'c') {
            return;
          }
          e.stopPropagation();
          e.stopImmediatePropagation();
        });
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const val = input.value.trim();
        if (!val) return;
        sendChatFromAnyFrame(val);
        input.value = '';
      });
    }

    if (overlayHost.parentNode !== mountParent) {
      mountParent.appendChild(overlayHost);
    }
    renderOverlayContents();
  }

  function syncOverlayVisibility() {
    ensureOverlayMounted();
  }

  function toggleDrawer(forceState) {
    drawerOpen = typeof forceState === 'boolean' ? forceState : !drawerOpen;
    if (drawerOpen) {
      unreadCount = 0;
      toasts = [];
    }
    renderOverlayContents();
    if (drawerOpen && shadowRoot) {
      const inp = shadowRoot.getElementById('ks-input');
      if (inp) setTimeout(() => inp.focus(), 30);
    }
  }

  function pushToast(senderName, text, color) {
    if (!isDesignatedOverlayFrame) return;
    if (!drawerOpen) {
      unreadCount += 1;
      const id = createId();
      toasts = [...toasts.slice(-3), { id, senderName, text, color: color || '#F59E0B' }];
      renderOverlayContents();
      setTimeout(() => {
        toasts = toasts.filter((t) => t.id !== id);
        renderOverlayContents();
      }, 3600);
    }
  }

  function renderOverlayContents() {
    if (!shadowRoot) return;
    const dot = shadowRoot.getElementById('ks-dot');
    const toggleBtn = shadowRoot.getElementById('ks-toggle-btn');
    const badge = shadowRoot.getElementById('ks-badge');
    const drawer = shadowRoot.getElementById('ks-drawer');
    const roomTitle = shadowRoot.getElementById('ks-room-title');
    const roomSub = shadowRoot.getElementById('ks-room-sub');
    const feedEl = shadowRoot.getElementById('ks-feed');
    const toastsEl = shadowRoot.getElementById('ks-toasts');

    const isOk = localOverlayState.status === 'connected';
    dot.className = 'ks-dot' + (isOk ? ' ok' : '');
    toggleBtn.style.display = drawerOpen ? 'none' : 'inline-flex';
    drawer.style.display = drawerOpen ? 'flex' : 'none';

    if (unreadCount > 0 && !drawerOpen) {
      badge.style.display = 'inline-flex';
      badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    } else {
      badge.style.display = 'none';
    }

    roomTitle.textContent = `Room ${localOverlayState.roomId || ''}`;
    roomSub.textContent = isOk
      ? `Connected · ${localOverlayState.peerCount || 1} in room`
      : localOverlayState.status === 'reconnecting'
      ? 'Reconnecting...'
      : 'Connecting to host...';

    // Render toasts
    toastsEl.innerHTML = '';
    if (!drawerOpen) {
      toasts.forEach((t) => {
        const div = document.createElement('div');
        div.className = 'ks-toast';
        const strong = document.createElement('strong');
        strong.style.color = t.color || '#F59E0B';
        strong.textContent = `${t.senderName}: `;
        const span = document.createElement('span');
        span.textContent = t.text;
        div.appendChild(strong);
        div.appendChild(span);
        toastsEl.appendChild(div);
      });
    }

    // Render feed
    feedEl.innerHTML = '';
    const list = localOverlayState.feed || [];
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ks-evt';
      empty.textContent = 'No messages yet. Press Alt + C anytime to toggle chat.';
      feedEl.appendChild(empty);
    } else {
      list.forEach((item) => {
        if (item.kind === 'event' || item.kind === 'reaction') {
          const evt = document.createElement('div');
          evt.className = 'ks-evt';
          const who = document.createElement('strong');
          who.style.color = item.senderColor || '#d4d4d8';
          who.textContent = item.senderName + ' ';
          const what = document.createElement('span');
          what.textContent = item.kind === 'reaction' ? `reacted ${item.text}` : item.text;
          evt.appendChild(who);
          evt.appendChild(what);
          feedEl.appendChild(evt);
        } else {
          const msgDiv = document.createElement('div');
          msgDiv.className = 'ks-msg';

          const meta = document.createElement('div');
          meta.className = 'ks-msg-meta';
          const sender = document.createElement('span');
          sender.className = 'ks-sender';
          sender.style.color = item.senderColor || '#F59E0B';
          sender.textContent = item.senderName;
          const time = document.createElement('span');
          time.textContent = new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          meta.appendChild(sender);
          meta.appendChild(time);

          const bubble = document.createElement('div');
          bubble.className = 'ks-bubble';
          const c = item.senderColor || '#F59E0B';
          bubble.style.border = `1px solid ${c}38`;
          bubble.style.background = `${c}14`;
          bubble.textContent = item.text;

          msgDiv.appendChild(meta);
          msgDiv.appendChild(bubble);
          feedEl.appendChild(msgDiv);
        }
      });
      feedEl.scrollTop = feedEl.scrollHeight;
    }
  }

  // =========================================================================
  // Event Listeners (Window PostMessage, Keyboard Alt+C, Fullscreen, Extension)
  // =========================================================================

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.__kinosync) return;

    if (isTopFrame) {
      if (data.kind === 'FRAME_VIDEO_REPORT') {
        handleFrameVideoReport(data);
      } else if (data.kind === 'FRAME_PLAYBACK_EVENT') {
        handleFramePlaybackEvent(data);
      } else if (data.kind === 'FRAME_SEND_CHAT') {
        sendChatFromAnyFrame(data.text);
      } else if (data.kind === 'FRAME_SEND_REACTION') {
        sendReactionFromAnyFrame(data.emoji);
      } else if (data.kind === 'TOGGLE_DRAWER_FROM_CHILD') {
        if (isDesignatedOverlayFrame) {
          toggleDrawer();
        } else {
          broadcastToChildFrames(window, { __kinosync: true, kind: 'TOGGLE_DRAWER' });
        }
      }
    } else {
      // Child frame receiving commands from top frame
      if (data.kind === 'ACTIVATE_FRAME') {
        isDesignatedOverlayFrame = data.overlayOwnerFrameId === FRAME_ID;
        syncOverlayVisibility();
        broadcastToChildFrames(window, data);
      } else if (data.kind === 'REMOTE_COMMAND') {
        if (data.targetFrameId === FRAME_ID) {
          applyRemoteCommandToVideo(data.cmd);
        } else {
          broadcastToChildFrames(window, data);
        }
      } else if (data.kind === 'SYNC_OVERLAY_STATE') {
        localOverlayState = data.state;
        syncOverlayVisibility();
        broadcastToChildFrames(window, data);
      } else if (data.kind === 'TOAST_EVENT') {
        if (isDesignatedOverlayFrame) {
          pushToast(data.senderName, data.text, data.color);
        } else {
          broadcastToChildFrames(window, data);
        }
      } else if (data.kind === 'TOGGLE_DRAWER') {
        if (isDesignatedOverlayFrame) {
          toggleDrawer();
        } else {
          broadcastToChildFrames(window, data);
        }
      }
    }
  });

  // Alt + C shortcut works in any frame
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.key && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        e.stopPropagation();
        if (isDesignatedOverlayFrame) {
          toggleDrawer();
        } else if (!isTopFrame) {
          // Top frame toggles the designated frame
          window.top.postMessage({ __kinosync: true, kind: 'TOGGLE_DRAWER_FROM_CHILD' }, '*');
        } else {
          broadcastToChildFrames(window, { __kinosync: true, kind: 'TOGGLE_DRAWER' });
        }
      }
    },
    true
  );

  // Fullscreen change re-attaches Shadow DOM host inside fullscreen container
  document.addEventListener('fullscreenchange', () => ensureOverlayMounted());
  document.addEventListener('webkitfullscreenchange', () => ensureOverlayMounted());

  // MutationObserver for late-loading players after pre-roll ads
  function startVideoDiscovery() {
    reportLocalVideoState();
    if (!videoObserver && document.documentElement) {
      videoObserver = new MutationObserver(() => {
        reportLocalVideoState();
      });
      videoObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    setInterval(reportLocalVideoState, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startVideoDiscovery);
  } else {
    startVideoDiscovery();
  }

  // Extension popup <-> content.js messaging (Top frame handles status & control)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!isTopFrame) return false;
      if (!msg || !msg.type) return false;

      if (msg.type === 'KINOSYNC_CONNECT') {
        connectPeer(msg.roomId, msg.displayName, msg.color);
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === 'KINOSYNC_DISCONNECT') {
        disconnectPeer();
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === 'KINOSYNC_FORCE_SYNC') {
        if (hostConn && hostConn.open) {
          hostConn.send({ type: 'sync:request', peerId: peer ? peer.id : 'ext' });
        }
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === 'KINOSYNC_TOGGLE_CHAT') {
        if (isDesignatedOverlayFrame) {
          toggleDrawer();
        } else {
          broadcastToChildFrames(window, { __kinosync: true, kind: 'TOGGLE_DRAWER' });
        }
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === 'KINOSYNC_GET_STATUS') {
        const activeReport = activeVideoFrameId ? frameReports.get(activeVideoFrameId) : null;
        sendResponse({
          active: stateConfig.active,
          roomId: stateConfig.roomId,
          status: connectionStatus,
          lastError,
          peerCount: participants.length || 1,
          videoFound: Boolean(activeReport && activeReport.found),
          videoWidth: activeReport ? activeReport.width : 0,
          videoHeight: activeReport ? activeReport.height : 0,
          isPlaying: activeReport ? activeReport.isPlaying : false,
        });
        return true;
      }
      return false;
    });
  }

  // Auto-reconnect if extension was left connected across episode/page navigation
  if (isTopFrame && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(
      ['kinosync_active', 'kinosync_room', 'kinosync_name', 'kinosync_color'],
      (res) => {
        if (res.kinosync_active && res.kinosync_room) {
          connectPeer(res.kinosync_room, res.kinosync_name || 'Viewer', res.kinosync_color || '#F59E0B');
        }
      }
    );
  }
})();

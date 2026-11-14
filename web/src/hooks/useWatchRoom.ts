import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import {
  ConnectionStatus,
  PeerParticipant,
  PeerSyncStatus,
  PlayerHandle,
  RoomFeedItem,
  SyncMessage,
  VideoSource,
} from '../types/watch';
import { formatTime } from '../utils/mediaUrl';
import { playNotificationChime } from '../utils/sound';

const PEER_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

const PEER_ID_PREFIX = 'kinosync-';
const DRIFT_THRESHOLD_SECONDS = 0.75;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface UseWatchRoomOptions {
  roomId: string;
  isHost: boolean;
  initialSource: VideoSource | null;
  initialDisplayName: string;
  initialColor: string;
  isChatActive: boolean;
  playerRef: React.RefObject<PlayerHandle | null>;
}

export interface UseWatchRoomReturn {
  status: ConnectionStatus;
  errorMessage: string | null;
  localPeerId: string;
  displayName: string;
  accentColor: string;
  setDisplayName: (name: string) => void;
  setAccentColor: (color: string) => void;
  source: VideoSource | null;
  participants: PeerParticipant[];
  feed: RoomFeedItem[];
  lastActionLabel: string | null;
  needsUserGesture: boolean;
  clearUserGesturePrompt: () => void;
  averageRttMs: number | null;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  unreadCount: number;
  clearUnreadCount: () => void;
  emitPlay: (currentTime: number, playbackRate: number) => void;
  emitPause: (currentTime: number) => void;
  emitSeek: (currentTime: number, isPlaying: boolean) => void;
  emitRateChange: (playbackRate: number, currentTime: number) => void;
  changeVideoSource: (newSource: VideoSource | null) => void;
  sendChatMessage: (text: string) => void;
  sendReaction: (emoji: string) => void;
  requestManualResync: () => void;
  forceSyncAll: () => void;
  reconnectNow: () => void;
  isRemoteApplyingRef: React.MutableRefObject<boolean>;
}

interface VirtualPlaybackState {
  isPlaying: boolean;
  currentTime: number;
  playbackRate: number;
  updatedAt: number;
}

export function useWatchRoom({
  roomId,
  isHost,
  initialSource,
  initialDisplayName,
  initialColor,
  isChatActive,
  playerRef,
}: UseWatchRoomOptions): UseWatchRoomReturn {
  const [status, setStatus] = useState<ConnectionStatus>('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localPeerId, setLocalPeerId] = useState<string>('');
  const [displayName, setDisplayNameState] = useState<string>(initialDisplayName);
  const [accentColor, setAccentColorState] = useState<string>(initialColor);
  const [source, setSource] = useState<VideoSource | null>(initialSource);
  const [participants, setParticipants] = useState<PeerParticipant[]>([]);
  const [feed, setFeed] = useState<RoomFeedItem[]>([]);
  const [lastActionLabel, setLastActionLabel] = useState<string | null>(null);
  const [needsUserGesture, setNeedsUserGesture] = useState<boolean>(false);
  const [averageRttMs, setAverageRttMs] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const peerRef = useRef<Peer | null>(null);
  const hostConnRef = useRef<DataConnection | null>(null);
  const guestConnsRef = useRef<Map<string, DataConnection>>(new Map());
  const participantsRef = useRef<PeerParticipant[]>([]);
  const feedRef = useRef<RoomFeedItem[]>([]);
  const sourceRef = useRef<VideoSource | null>(initialSource);
  const displayNameRef = useRef<string>(initialDisplayName);
  const accentColorRef = useRef<string>(initialColor);
  const localPeerIdRef = useRef<string>('');
  const seqRef = useRef<number>(0);
  const rttMsRef = useRef<number>(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const destroyedRef = useRef<boolean>(false);
  const soundEnabledRef = useRef<boolean>(true);
  const isChatActiveRef = useRef<boolean>(isChatActive);

  // Virtual playback clock for webpage-mode rooms (when extension controls video in another tab)
  const virtualPlaybackRef = useRef<VirtualPlaybackState>({
    isPlaying: false,
    currentTime: 0,
    playbackRate: 1,
    updatedAt: Date.now(),
  });

  const pendingStateRef = useRef<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
    receivedAt: number;
  } | null>(null);

  const isRemoteApplyingRef = useRef<boolean>(false);
  const remoteLockTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    isChatActiveRef.current = isChatActive;
    if (isChatActive && !document.hidden) {
      setUnreadCount(0);
    }
  }, [isChatActive]);

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && isChatActiveRef.current) {
        setUnreadCount(0);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const baseTitle = `KinoSync · Room ${roomId}`;
    document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;
    return () => {
      document.title = 'KinoSync — Watch Together Over WebRTC';
    };
  }, [roomId, unreadCount]);

  const clearUnreadCount = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const lockRemoteUpdate = useCallback((durationMs = 550) => {
    isRemoteApplyingRef.current = true;
    if (remoteLockTimeoutRef.current !== null) {
      window.clearTimeout(remoteLockTimeoutRef.current);
    }
    remoteLockTimeoutRef.current = window.setTimeout(() => {
      isRemoteApplyingRef.current = false;
      remoteLockTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const getAuthoritativeClock = useCallback((): {
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
  } => {
    const player = playerRef.current;
    if (player && sourceRef.current && sourceRef.current.type !== 'webpage') {
      return {
        isPlaying: player.isPlaying(),
        currentTime: player.getCurrentTime(),
        playbackRate: player.getPlaybackRate(),
      };
    }
    const v = virtualPlaybackRef.current;
    const elapsed = v.isPlaying ? Math.max(0, (Date.now() - v.updatedAt) / 1000) : 0;
    return {
      isPlaying: v.isPlaying,
      currentTime: Math.max(0, v.currentTime + elapsed * v.playbackRate),
      playbackRate: v.playbackRate,
    };
  }, [playerRef]);

  const setVirtualClock = useCallback((isPlaying: boolean, currentTime: number, playbackRate = 1) => {
    virtualPlaybackRef.current = {
      isPlaying,
      currentTime: Math.max(0, currentTime),
      playbackRate,
      updatedAt: Date.now(),
    };
  }, []);

  const computeSyncStatus = useCallback(
    (
      reportedPlaying: boolean,
      reportedTime: number,
      auth: { isPlaying: boolean; currentTime: number }
    ): { syncStatus: PeerSyncStatus; driftSeconds: number } => {
      const drift = Math.abs(reportedTime - auth.currentTime);
      if (!auth.isPlaying && !reportedPlaying) {
        return { syncStatus: drift > 1.2 ? 'drift' : 'paused', driftSeconds: drift };
      }
      if (auth.isPlaying !== reportedPlaying || drift > DRIFT_THRESHOLD_SECONDS) {
        return { syncStatus: 'drift', driftSeconds: drift };
      }
      return { syncStatus: 'synced', driftSeconds: drift };
    },
    []
  );

  const appendFeedItem = useCallback((item: RoomFeedItem, notify = false) => {
    setFeed((prev) => {
      if (prev.some((existing) => existing.id === item.id)) return prev;
      const next = [...prev, item].slice(-100);
      feedRef.current = next;
      return next;
    });

    if (notify && (item.kind === 'chat' || item.kind === 'reaction')) {
      const isSelf = item.senderId === localPeerIdRef.current || item.senderId === 'local';
      if (!isSelf) {
        if (!isChatActiveRef.current || document.hidden) {
          setUnreadCount((c) => c + 1);
        }
        if (soundEnabledRef.current) {
          playNotificationChime();
        }
      }
    }
  }, []);

  const updateParticipants = useCallback((next: PeerParticipant[]) => {
    participantsRef.current = next;
    setParticipants(next);
  }, []);

  const broadcastToGuests = useCallback((msg: SyncMessage, excludePeerId?: string) => {
    guestConnsRef.current.forEach((conn, peerId) => {
      if (excludePeerId && peerId === excludePeerId) return;
      if (conn.open) {
        try {
          conn.send(msg);
        } catch {
          // Ignore send errors
        }
      }
    });
  }, []);

  const sendMessage = useCallback(
    (msg: SyncMessage) => {
      if (isHost) {
        broadcastToGuests(msg);
      } else if (hostConnRef.current?.open) {
        try {
          hostConnRef.current.send(msg);
        } catch {
          // Ignore send errors
        }
      }
    },
    [isHost, broadcastToGuests]
  );

  const safePlayPlayer = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      const maybePromise = player.play();
      if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
        await (maybePromise as Promise<void>);
      }
      setNeedsUserGesture(false);
    } catch {
      setNeedsUserGesture(true);
    }
  }, [playerRef]);

  const applyPendingStateIfReady = useCallback(() => {
    const pending = pendingStateRef.current;
    const player = playerRef.current;
    if (!pending || !player) return;

    const elapsed = pending.isPlaying ? (Date.now() - pending.receivedAt) / 1000 : 0;
    const targetTime = Math.max(0, pending.currentTime + elapsed * pending.playbackRate);

    lockRemoteUpdate(650);
    player.setPlaybackRate(pending.playbackRate);
    player.seekTo(targetTime);
    if (pending.isPlaying) {
      void safePlayPlayer();
    } else {
      player.pause();
    }
    pendingStateRef.current = null;
  }, [lockRemoteUpdate, playerRef, safePlayPlayer]);

  useEffect(() => {
    if (!source || source.type === 'webpage') return;
    const timer = window.setTimeout(() => {
      applyPendingStateIfReady();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [source, applyPendingStateIfReady]);

  const handleIncomingSyncMessage = useCallback(
    (msg: SyncMessage, fromConn: DataConnection) => {
      switch (msg.type) {
        case 'ping': {
          if (fromConn.open) {
            fromConn.send({ type: 'pong', sentAt: msg.sentAt } satisfies SyncMessage);
          }
          break;
        }

        case 'pong': {
          const rtt = Math.max(1, Date.now() - msg.sentAt);
          rttMsRef.current = rtt;
          setAverageRttMs(rtt);
          if (isHost) {
            const updated = participantsRef.current.map((p) =>
              p.peerId === fromConn.peer ? { ...p, rttMs: rtt } : p
            );
            updateParticipants(updated);
            broadcastToGuests({ type: 'peer:list', participants: updated });
          }
          break;
        }

        case 'peer:hello': {
          if (!isHost) break;
          const guestName = msg.name.trim() || `Viewer ${guestConnsRef.current.size}`;
          const guestColor = msg.color || '#38BDF8';
          const newParticipant: PeerParticipant = {
            peerId: msg.peerId,
            name: guestName,
            color: guestColor,
            isHost: false,
            clientType: msg.clientType || 'web',
            joinedAt: Date.now(),
            syncStatus: 'paused',
          };
          const filtered = participantsRef.current.filter((p) => p.peerId !== msg.peerId);
          const updated = [...filtered, newParticipant];
          updateParticipants(updated);

          const viaLabel = msg.clientType === 'extension' ? ' via Extension' : '';
          const joinItem: RoomFeedItem = {
            id: createId(),
            kind: 'event',
            senderId: msg.peerId,
            senderName: guestName,
            senderColor: guestColor,
            text: `joined the room${viaLabel}`,
            timestamp: Date.now(),
          };
          appendFeedItem(joinItem);
          broadcastToGuests({ type: 'chat:message', item: joinItem }, msg.peerId);
          broadcastToGuests({ type: 'peer:list', participants: updated });

          const auth = getAuthoritativeClock();
          if (fromConn.open) {
            seqRef.current += 1;
            fromConn.send({
              type: 'room:state',
              source: sourceRef.current,
              isPlaying: auth.isPlaying,
              currentTime: auth.currentTime,
              playbackRate: auth.playbackRate,
              sentAt: Date.now(),
              participants: updated,
              feed: feedRef.current,
              seq: seqRef.current,
            } satisfies SyncMessage);
          }
          break;
        }

        case 'peer:rename': {
          const cleanName = msg.name.trim().slice(0, 28);
          if (!cleanName) break;
          if (isHost) {
            const updated = participantsRef.current.map((p) =>
              p.peerId === msg.peerId
                ? { ...p, name: cleanName, color: msg.color || p.color }
                : p
            );
            updateParticipants(updated);
            broadcastToGuests({ type: 'peer:list', participants: updated });
          }
          break;
        }

        case 'peer:status': {
          if (!isHost) break;
          // If room is in webpage mode and host has no local video, treat first active peer report if virtual clock is idle
          const auth = getAuthoritativeClock();
          const { syncStatus, driftSeconds } = computeSyncStatus(
            msg.isPlaying,
            msg.currentTime,
            auth
          );
          const updated = participantsRef.current.map((p) =>
            p.peerId === msg.peerId
              ? {
                  ...p,
                  reportedPlaying: msg.isPlaying,
                  reportedTime: msg.currentTime,
                  syncStatus,
                  driftSeconds,
                  lastReportAt: Date.now(),
                }
              : p
          );
          updateParticipants(updated);
          broadcastToGuests({ type: 'peer:list', participants: updated });
          break;
        }

        case 'peer:list': {
          if (!isHost) {
            updateParticipants(msg.participants);
          }
          break;
        }

        case 'room:state': {
          if (isHost) break;
          sourceRef.current = msg.source;
          setSource(msg.source);
          updateParticipants(msg.participants);
          feedRef.current = msg.feed;
          setFeed(msg.feed);
          pendingStateRef.current = {
            isPlaying: msg.isPlaying,
            currentTime: msg.currentTime,
            playbackRate: msg.playbackRate,
            receivedAt: Date.now(),
          };
          setStatus('connected');
          setErrorMessage(null);
          window.setTimeout(() => applyPendingStateIfReady(), 200);
          break;
        }

        case 'sync:request': {
          if (!isHost) break;
          const auth = getAuthoritativeClock();
          if (fromConn.open) {
            seqRef.current += 1;
            fromConn.send({
              type: 'room:state',
              source: sourceRef.current,
              isPlaying: auth.isPlaying,
              currentTime: auth.currentTime,
              playbackRate: auth.playbackRate,
              sentAt: Date.now(),
              participants: participantsRef.current,
              feed: feedRef.current,
              seq: seqRef.current,
            } satisfies SyncMessage);
          }
          break;
        }

        case 'playback:play': {
          const player = playerRef.current;
          setVirtualClock(true, msg.currentTime, msg.playbackRate);
          if (isHost) {
            broadcastToGuests(msg, fromConn.peer);
          }
          if (player && sourceRef.current?.type !== 'webpage') {
            const oneWaySec = rttMsRef.current > 0 ? rttMsRef.current / 2000 : 0.04;
            const target = msg.currentTime + oneWaySec * msg.playbackRate;
            lockRemoteUpdate(600);
            player.setPlaybackRate(msg.playbackRate);
            if (Math.abs(player.getCurrentTime() - target) > 0.6) {
              player.seekTo(target);
            }
            void safePlayPlayer();
          }
          setLastActionLabel(`${msg.actorName} resumed at ${formatTime(msg.currentTime)}`);
          appendFeedItem({
            id: `evt-play-${msg.seq}-${msg.actorId}`,
            kind: 'event',
            senderId: msg.actorId,
            senderName: msg.actorName,
            senderColor: msg.actorColor,
            text: `resumed at ${formatTime(msg.currentTime)}`,
            timestamp: Date.now(),
          });
          break;
        }

        case 'playback:pause': {
          const player = playerRef.current;
          setVirtualClock(false, msg.currentTime, 1);
          if (isHost) {
            broadcastToGuests(msg, fromConn.peer);
          }
          if (player && sourceRef.current?.type !== 'webpage') {
            lockRemoteUpdate(600);
            player.pause();
            if (Math.abs(player.getCurrentTime() - msg.currentTime) > 0.35) {
              player.seekTo(msg.currentTime);
            }
          }
          setLastActionLabel(`${msg.actorName} paused at ${formatTime(msg.currentTime)}`);
          appendFeedItem({
            id: `evt-pause-${msg.seq}-${msg.actorId}`,
            kind: 'event',
            senderId: msg.actorId,
            senderName: msg.actorName,
            senderColor: msg.actorColor,
            text: `paused at ${formatTime(msg.currentTime)}`,
            timestamp: Date.now(),
          });
          break;
        }

        case 'playback:seek': {
          const player = playerRef.current;
          setVirtualClock(msg.isPlaying, msg.currentTime, 1);
          if (isHost) {
            broadcastToGuests(msg, fromConn.peer);
          }
          if (player && sourceRef.current?.type !== 'webpage') {
            lockRemoteUpdate(650);
            player.seekTo(msg.currentTime);
            if (msg.isPlaying) {
              void safePlayPlayer();
            } else {
              player.pause();
            }
          }
          setLastActionLabel(`${msg.actorName} sought to ${formatTime(msg.currentTime)}`);
          appendFeedItem({
            id: `evt-seek-${msg.seq}-${msg.actorId}`,
            kind: 'event',
            senderId: msg.actorId,
            senderName: msg.actorName,
            senderColor: msg.actorColor,
            text: `sought to ${formatTime(msg.currentTime)}`,
            timestamp: Date.now(),
          });
          break;
        }

        case 'playback:rate': {
          const player = playerRef.current;
          setVirtualClock(virtualPlaybackRef.current.isPlaying, msg.currentTime, msg.playbackRate);
          if (isHost) {
            broadcastToGuests(msg, fromConn.peer);
          }
          if (player && sourceRef.current?.type !== 'webpage') {
            lockRemoteUpdate(500);
            player.setPlaybackRate(msg.playbackRate);
            if (Math.abs(player.getCurrentTime() - msg.currentTime) > 0.7) {
              player.seekTo(msg.currentTime);
            }
          }
          setLastActionLabel(`${msg.actorName} set speed to ${msg.playbackRate}x`);
          appendFeedItem({
            id: `evt-rate-${msg.seq}-${msg.actorId}`,
            kind: 'event',
            senderId: msg.actorId,
            senderName: msg.actorName,
            senderColor: msg.actorColor,
            text: `set playback speed to ${msg.playbackRate}x`,
            timestamp: Date.now(),
          });
          break;
        }

        case 'sync:force': {
          const player = playerRef.current;
          setVirtualClock(msg.isPlaying, msg.currentTime, msg.playbackRate);
          if (isHost) {
            broadcastToGuests(msg, fromConn.peer);
          }
          if (player && sourceRef.current?.type !== 'webpage') {
            const elapsed = msg.isPlaying ? Math.max(0, (Date.now() - msg.sentAt) / 1000) : 0;
            const target = Math.max(0, msg.currentTime + elapsed * msg.playbackRate);
            lockRemoteUpdate(650);
            player.setPlaybackRate(msg.playbackRate);
            player.seekTo(target);
            if (msg.isPlaying) {
              void safePlayPlayer();
            } else {
              player.pause();
            }
          }
          setLastActionLabel(`${msg.actorName} forced sync to ${formatTime(msg.currentTime)}`);
          break;
        }

        case 'media:change': {
          if (isHost) {
            broadcastToGuests(msg, fromConn.peer);
          }
          sourceRef.current = msg.source;
          setSource(msg.source);
          setVirtualClock(false, 0, 1);
          pendingStateRef.current = {
            isPlaying: false,
            currentTime: 0,
            playbackRate: 1,
            receivedAt: Date.now(),
          };
          setLastActionLabel(`${msg.actorName} updated the room media`);
          appendFeedItem({
            id: `evt-media-${msg.seq}-${msg.actorId}`,
            kind: 'event',
            senderId: msg.actorId,
            senderName: msg.actorName,
            senderColor: msg.actorColor,
            text: msg.source ? `loaded ${msg.source.url}` : 'cleared the media URL',
            timestamp: Date.now(),
          });
          break;
        }

        case 'sync:heartbeat': {
          if (isHost) break;
          const player = playerRef.current;
          if (!player || sourceRef.current?.type === 'webpage') break;

          const oneWaySec = rttMsRef.current > 0 ? rttMsRef.current / 2000 : 0.04;
          const expectedTime = msg.isPlaying
            ? msg.currentTime + oneWaySec * msg.playbackRate
            : msg.currentTime;
          const localTime = player.getCurrentTime();
          const localPlaying = player.isPlaying();

          if (msg.isPlaying !== localPlaying) {
            lockRemoteUpdate(600);
            player.setPlaybackRate(msg.playbackRate);
            if (Math.abs(localTime - expectedTime) > DRIFT_THRESHOLD_SECONDS) {
              player.seekTo(expectedTime);
            }
            if (msg.isPlaying) {
              void safePlayPlayer();
            } else {
              player.pause();
            }
          } else if (Math.abs(localTime - expectedTime) > DRIFT_THRESHOLD_SECONDS) {
            lockRemoteUpdate(600);
            player.seekTo(expectedTime);
          }
          break;
        }

        case 'chat:message': {
          if (isHost) {
            broadcastToGuests(msg, fromConn.peer);
          }
          appendFeedItem(msg.item, true);
          break;
        }
      }
    },
    [
      isHost,
      appendFeedItem,
      applyPendingStateIfReady,
      broadcastToGuests,
      computeSyncStatus,
      getAuthoritativeClock,
      lockRemoteUpdate,
      playerRef,
      safePlayPlayer,
      setVirtualClock,
      updateParticipants,
    ]
  );

  const initPeer = useCallback(() => {
    destroyedRef.current = false;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch {
        // Ignore cleanup errors
      }
      peerRef.current = null;
    }
    guestConnsRef.current.clear();
    hostConnRef.current = null;

    setStatus(isHost ? 'initializing' : 'connecting');
    setErrorMessage(null);

    const targetHostPeerId = `${PEER_ID_PREFIX}${roomId}`;
    const peer = isHost
      ? new Peer(targetHostPeerId, {
          config: { iceServers: PEER_ICE_SERVERS },
          debug: 0,
        })
      : new Peer({
          config: { iceServers: PEER_ICE_SERVERS },
          debug: 0,
        });

    peerRef.current = peer;

    peer.on('open', (assignedId) => {
      if (destroyedRef.current) return;
      localPeerIdRef.current = assignedId;
      setLocalPeerId(assignedId);

      if (isHost) {
        setStatus('hosting');
        const hostParticipant: PeerParticipant = {
          peerId: assignedId,
          name: displayNameRef.current || 'Host',
          color: accentColorRef.current,
          isHost: true,
          clientType: 'web',
          joinedAt: Date.now(),
          syncStatus: 'paused',
        };
        updateParticipants([hostParticipant]);
      } else {
        setStatus('connecting');
        const conn = peer.connect(targetHostPeerId, { reliable: true });
        hostConnRef.current = conn;

        conn.on('open', () => {
          if (destroyedRef.current) return;
          setStatus('connected');
          setErrorMessage(null);
          conn.send({
            type: 'peer:hello',
            peerId: assignedId,
            name: displayNameRef.current || 'Guest',
            color: accentColorRef.current,
            clientType: 'web',
          } satisfies SyncMessage);
          conn.send({ type: 'ping', sentAt: Date.now() } satisfies SyncMessage);
        });

        conn.on('data', (data) => {
          if (destroyedRef.current) return;
          if (data && typeof data === 'object' && 'type' in data) {
            handleIncomingSyncMessage(data as SyncMessage, conn);
          }
        });

        conn.on('close', () => {
          if (destroyedRef.current) return;
          setStatus('reconnecting');
          setErrorMessage('Connection to room host dropped. Reconnecting...');
          reconnectTimerRef.current = window.setTimeout(() => {
            if (!destroyedRef.current) initPeer();
          }, 3000);
        });

        conn.on('error', () => {
          if (destroyedRef.current) return;
          setStatus('reconnecting');
        });
      }
    });

    if (isHost) {
      peer.on('connection', (conn) => {
        if (destroyedRef.current) return;
        guestConnsRef.current.set(conn.peer, conn);

        conn.on('data', (data) => {
          if (destroyedRef.current) return;
          if (data && typeof data === 'object' && 'type' in data) {
            handleIncomingSyncMessage(data as SyncMessage, conn);
          }
        });

        conn.on('close', () => {
          guestConnsRef.current.delete(conn.peer);
          const departing = participantsRef.current.find((p) => p.peerId === conn.peer);
          const remaining = participantsRef.current.filter((p) => p.peerId !== conn.peer);
          updateParticipants(remaining);
          broadcastToGuests({ type: 'peer:list', participants: remaining });

          if (departing) {
            const leaveItem: RoomFeedItem = {
              id: createId(),
              kind: 'event',
              senderId: departing.peerId,
              senderName: departing.name,
              senderColor: departing.color,
              text: 'left the room',
              timestamp: Date.now(),
            };
            appendFeedItem(leaveItem);
            broadcastToGuests({ type: 'chat:message', item: leaveItem });
          }
        });
      });
    }

    peer.on('error', (err) => {
      if (destroyedRef.current) return;
      const errType = (err as { type?: string })?.type;

      if (errType === 'peer-unavailable' && !isHost) {
        setStatus('reconnecting');
        setErrorMessage('Room host is not online yet. Retrying automatically...');
        reconnectTimerRef.current = window.setTimeout(() => {
          if (!destroyedRef.current) initPeer();
        }, 3000);
        return;
      }

      if (errType === 'unavailable-id' && isHost) {
        setStatus('reconnecting');
        setErrorMessage('Reclaiming room host channel...');
        reconnectTimerRef.current = window.setTimeout(() => {
          if (!destroyedRef.current) initPeer();
        }, 3000);
        return;
      }

      if (errType === 'network' || errType === 'disconnected' || errType === 'server-error') {
        setStatus('reconnecting');
        setErrorMessage('Signaling network interrupted. Reconnecting...');
        reconnectTimerRef.current = window.setTimeout(() => {
          if (!destroyedRef.current) initPeer();
        }, 3500);
        return;
      }

      setStatus('error');
      setErrorMessage(err.message || 'WebRTC peer connection error.');
    });

    peer.on('disconnected', () => {
      if (destroyedRef.current) return;
      if (!peer.destroyed) {
        try {
          peer.reconnect();
        } catch {
          // Ignore reconnect errors
        }
      }
    });
  }, [
    roomId,
    isHost,
    appendFeedItem,
    broadcastToGuests,
    handleIncomingSyncMessage,
    updateParticipants,
  ]);

  useEffect(() => {
    initPeer();
    return () => {
      destroyedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (remoteLockTimeoutRef.current !== null) {
        window.clearTimeout(remoteLockTimeoutRef.current);
      }
      if (peerRef.current) {
        try {
          peerRef.current.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [initPeer]);

  // Periodic ping, host heartbeat & participant sync status calculation
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (isHost) {
        const auth = getAuthoritativeClock();
        // Update host's own sync status in participant list
        const updatedHost = participantsRef.current.map((p) => {
          if (p.peerId === localPeerIdRef.current) {
            return {
              ...p,
              syncStatus: auth.isPlaying ? ('synced' as PeerSyncStatus) : ('paused' as PeerSyncStatus),
              reportedTime: auth.currentTime,
              reportedPlaying: auth.isPlaying,
            };
          }
          if (typeof p.reportedTime === 'number' && typeof p.reportedPlaying === 'boolean') {
            const { syncStatus, driftSeconds } = computeSyncStatus(
              p.reportedPlaying,
              p.reportedTime,
              auth
            );
            return { ...p, syncStatus, driftSeconds };
          }
          return p;
        });
        updateParticipants(updatedHost);

        if (guestConnsRef.current.size > 0) {
          seqRef.current += 1;
          broadcastToGuests({
            type: 'sync:heartbeat',
            isPlaying: auth.isPlaying,
            currentTime: auth.currentTime,
            playbackRate: auth.playbackRate,
            sentAt: Date.now(),
            seq: seqRef.current,
          });
          broadcastToGuests({
            type: 'peer:list',
            participants: updatedHost,
          });
          guestConnsRef.current.forEach((conn) => {
            if (conn.open) {
              try {
                conn.send({ type: 'ping', sentAt: Date.now() } satisfies SyncMessage);
              } catch {
                // Ignore
              }
            }
          });
        }
      } else if (hostConnRef.current?.open) {
        try {
          hostConnRef.current.send({ type: 'ping', sentAt: Date.now() } satisfies SyncMessage);
          const player = playerRef.current;
          if (player && sourceRef.current && sourceRef.current.type !== 'webpage') {
            hostConnRef.current.send({
              type: 'peer:status',
              peerId: localPeerIdRef.current,
              isPlaying: player.isPlaying(),
              currentTime: player.getCurrentTime(),
              playbackRate: player.getPlaybackRate(),
              sentAt: Date.now(),
            } satisfies SyncMessage);
          }
        } catch {
          // Ignore
        }
      }
    }, 2500);

    return () => window.clearInterval(interval);
  }, [isHost, broadcastToGuests, computeSyncStatus, getAuthoritativeClock, playerRef, updateParticipants]);

  const setDisplayName = useCallback(
    (name: string) => {
      const clean = name.trim().slice(0, 28);
      if (!clean) return;
      displayNameRef.current = clean;
      setDisplayNameState(clean);

      if (isHost) {
        const updated = participantsRef.current.map((p) =>
          p.peerId === localPeerIdRef.current ? { ...p, name: clean } : p
        );
        updateParticipants(updated);
        broadcastToGuests({ type: 'peer:list', participants: updated });
      } else if (hostConnRef.current?.open) {
        hostConnRef.current.send({
          type: 'peer:rename',
          peerId: localPeerIdRef.current,
          name: clean,
          color: accentColorRef.current,
        } satisfies SyncMessage);
      }
    },
    [isHost, broadcastToGuests, updateParticipants]
  );

  const setAccentColor = useCallback(
    (color: string) => {
      accentColorRef.current = color;
      setAccentColorState(color);
      if (isHost) {
        const updated = participantsRef.current.map((p) =>
          p.peerId === localPeerIdRef.current ? { ...p, color } : p
        );
        updateParticipants(updated);
        broadcastToGuests({ type: 'peer:list', participants: updated });
      } else if (hostConnRef.current?.open) {
        hostConnRef.current.send({
          type: 'peer:rename',
          peerId: localPeerIdRef.current,
          name: displayNameRef.current,
          color,
        } satisfies SyncMessage);
      }
    },
    [isHost, broadcastToGuests, updateParticipants]
  );

  const emitPlay = useCallback(
    (currentTime: number, playbackRate: number) => {
      if (isRemoteApplyingRef.current) return;
      setVirtualClock(true, currentTime, playbackRate);
      seqRef.current += 1;
      const actorName = displayNameRef.current || 'Someone';
      setLastActionLabel(`You played at ${formatTime(currentTime)}`);
      sendMessage({
        type: 'playback:play',
        currentTime,
        playbackRate,
        sentAt: Date.now(),
        actorId: localPeerIdRef.current,
        actorName,
        actorColor: accentColorRef.current,
        seq: seqRef.current,
      });
    },
    [sendMessage, setVirtualClock]
  );

  const emitPause = useCallback(
    (currentTime: number) => {
      if (isRemoteApplyingRef.current) return;
      setVirtualClock(false, currentTime, 1);
      seqRef.current += 1;
      const actorName = displayNameRef.current || 'Someone';
      setLastActionLabel(`You paused at ${formatTime(currentTime)}`);
      sendMessage({
        type: 'playback:pause',
        currentTime,
        sentAt: Date.now(),
        actorId: localPeerIdRef.current,
        actorName,
        actorColor: accentColorRef.current,
        seq: seqRef.current,
      });
    },
    [sendMessage, setVirtualClock]
  );

  const emitSeek = useCallback(
    (currentTime: number, isPlaying: boolean) => {
      if (isRemoteApplyingRef.current) return;
      setVirtualClock(isPlaying, currentTime, 1);
      seqRef.current += 1;
      const actorName = displayNameRef.current || 'Someone';
      setLastActionLabel(`You sought to ${formatTime(currentTime)}`);
      sendMessage({
        type: 'playback:seek',
        currentTime,
        isPlaying,
        sentAt: Date.now(),
        actorId: localPeerIdRef.current,
        actorName,
        actorColor: accentColorRef.current,
        seq: seqRef.current,
      });
    },
    [sendMessage, setVirtualClock]
  );

  const emitRateChange = useCallback(
    (playbackRate: number, currentTime: number) => {
      if (isRemoteApplyingRef.current) return;
      setVirtualClock(virtualPlaybackRef.current.isPlaying, currentTime, playbackRate);
      seqRef.current += 1;
      const actorName = displayNameRef.current || 'Someone';
      setLastActionLabel(`You set speed to ${playbackRate}x`);
      sendMessage({
        type: 'playback:rate',
        playbackRate,
        currentTime,
        sentAt: Date.now(),
        actorId: localPeerIdRef.current,
        actorName,
        actorColor: accentColorRef.current,
        seq: seqRef.current,
      });
    },
    [sendMessage, setVirtualClock]
  );

  const changeVideoSource = useCallback(
    (newSource: VideoSource | null) => {
      sourceRef.current = newSource;
      setSource(newSource);
      setVirtualClock(false, 0, 1);
      seqRef.current += 1;
      const actorName = displayNameRef.current || 'Someone';
      setLastActionLabel(newSource ? 'Updated room media' : 'Cleared room media');
      appendFeedItem({
        id: createId(),
        kind: 'event',
        senderId: localPeerIdRef.current || 'local',
        senderName: actorName,
        senderColor: accentColorRef.current,
        text: newSource ? `loaded ${newSource.url}` : 'cleared the media URL',
        timestamp: Date.now(),
      });
      sendMessage({
        type: 'media:change',
        source: newSource,
        sentAt: Date.now(),
        actorId: localPeerIdRef.current,
        actorName,
        actorColor: accentColorRef.current,
        seq: seqRef.current,
      });
    },
    [appendFeedItem, sendMessage, setVirtualClock]
  );

  const sendChatMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const item: RoomFeedItem = {
        id: createId(),
        kind: 'chat',
        senderId: localPeerIdRef.current || 'local',
        senderName: displayNameRef.current || 'Viewer',
        senderColor: accentColorRef.current,
        text: trimmed,
        timestamp: Date.now(),
      };
      appendFeedItem(item);
      sendMessage({ type: 'chat:message', item });
    },
    [appendFeedItem, sendMessage]
  );

  const sendReaction = useCallback(
    (emoji: string) => {
      const item: RoomFeedItem = {
        id: createId(),
        kind: 'reaction',
        senderId: localPeerIdRef.current || 'local',
        senderName: displayNameRef.current || 'Viewer',
        senderColor: accentColorRef.current,
        text: emoji,
        timestamp: Date.now(),
      };
      appendFeedItem(item);
      sendMessage({ type: 'chat:message', item });
    },
    [appendFeedItem, sendMessage]
  );

  const requestManualResync = useCallback(() => {
    if (isHost) {
      const auth = getAuthoritativeClock();
      seqRef.current += 1;
      broadcastToGuests({
        type: 'sync:force',
        isPlaying: auth.isPlaying,
        currentTime: auth.currentTime,
        playbackRate: auth.playbackRate,
        sentAt: Date.now(),
        actorId: localPeerIdRef.current,
        actorName: displayNameRef.current || 'Host',
        seq: seqRef.current,
      });
      setLastActionLabel(`Forced sync across room (${formatTime(auth.currentTime)})`);
    } else if (hostConnRef.current?.open) {
      hostConnRef.current.send({
        type: 'sync:request',
        peerId: localPeerIdRef.current,
      } satisfies SyncMessage);
      setLastActionLabel('Requested latest timestamp from host');
    }
  }, [isHost, broadcastToGuests, getAuthoritativeClock]);

  const forceSyncAll = useCallback(() => {
    const auth = getAuthoritativeClock();
    seqRef.current += 1;
    const msg: SyncMessage = {
      type: 'sync:force',
      isPlaying: auth.isPlaying,
      currentTime: auth.currentTime,
      playbackRate: auth.playbackRate,
      sentAt: Date.now(),
      actorId: localPeerIdRef.current,
      actorName: displayNameRef.current || 'Viewer',
      seq: seqRef.current,
    };
    sendMessage(msg);
    setLastActionLabel(`Forced sync to ${formatTime(auth.currentTime)}`);
    appendFeedItem({
      id: `evt-force-${seqRef.current}-${localPeerIdRef.current}`,
      kind: 'event',
      senderId: localPeerIdRef.current || 'local',
      senderName: displayNameRef.current || 'Viewer',
      senderColor: accentColorRef.current,
      text: `forced sync to ${formatTime(auth.currentTime)}`,
      timestamp: Date.now(),
    });
  }, [appendFeedItem, getAuthoritativeClock, sendMessage]);

  const clearUserGesturePrompt = useCallback(() => {
    setNeedsUserGesture(false);
  }, []);

  return {
    status,
    errorMessage,
    localPeerId,
    displayName,
    accentColor,
    setDisplayName,
    setAccentColor,
    source,
    participants,
    feed,
    lastActionLabel,
    needsUserGesture,
    clearUserGesturePrompt,
    averageRttMs,
    soundEnabled,
    setSoundEnabled,
    unreadCount,
    clearUnreadCount,
    emitPlay,
    emitPause,
    emitSeek,
    emitRateChange,
    changeVideoSource,
    sendChatMessage,
    sendReaction,
    requestManualResync,
    forceSyncAll,
    reconnectNow: initPeer,
    isRemoteApplyingRef,
  };
}

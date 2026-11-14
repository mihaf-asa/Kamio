import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  Chrome,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  LogOut,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Users,
  X,
} from 'lucide-react';
import { useWatchRoom } from '../hooks/useWatchRoom';
import { ConnectionStatus, PeerSyncStatus, PlayerHandle, VideoSource } from '../types/watch';
import {
  ACCENT_COLORS,
  buildInviteUrl,
  getMediaTypeLabel,
  getShortSourceLabel,
  parseVideoSource,
  SAMPLE_STREAMS,
} from '../utils/mediaUrl';
import { UnifiedPlayer } from './UnifiedPlayer';

interface RoomViewProps {
  roomId: string;
  isHost: boolean;
  initialSource: VideoSource | null;
  initialDisplayName: string;
  initialColor: string;
  onUpdateIdentity: (name: string, color: string) => void;
  onLeaveRoom: () => void;
}

interface FloatingReaction {
  id: string;
  emoji: string;
  sender: string;
  color: string;
}

const REACTION_CHOICES = ['😂', '😱', '❤️', '🔥', '👏'];

function getStatusText(status: ConnectionStatus, peerCount: number, rttMs: number | null): string {
  switch (status) {
    case 'initializing':
      return 'Opening room channel...';
    case 'hosting':
      return peerCount > 1 ? `Hosting · ${peerCount} in room` : 'Hosting · Waiting for friends';
    case 'connecting':
      return 'Connecting to host...';
    case 'connected':
      return rttMs ? `Connected · ${rttMs} ms` : `Connected · ${peerCount} in room`;
    case 'reconnecting':
      return 'Reconnecting...';
    case 'error':
      return 'Connection error';
    default:
      return 'Idle';
  }
}

function getSyncBadgeProps(syncStatus?: PeerSyncStatus, driftSeconds?: number) {
  if (syncStatus === 'drift') {
    const delta = typeof driftSeconds === 'number' ? ` (${driftSeconds.toFixed(1)}s)` : '';
    return { label: `Drift${delta}`, className: 'text-amber-400' };
  }
  if (syncStatus === 'synced') {
    return { label: 'Synced', className: 'text-emerald-400' };
  }
  return { label: 'Paused', className: 'text-zinc-400' };
}

export const RoomView: React.FC<RoomViewProps> = ({
  roomId,
  isHost,
  initialSource,
  initialDisplayName,
  initialColor,
  onUpdateIdentity,
  onLeaveRoom,
}) => {
  const playerRef = useRef<PlayerHandle | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'viewers'>('chat');

  const {
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
    reconnectNow,
    isRemoteApplyingRef,
  } = useWatchRoom({
    roomId,
    isHost,
    initialSource,
    initialDisplayName,
    initialColor,
    isChatActive: sidebarTab === 'chat',
    playerRef,
  });

  const [isTheatre, setIsTheatre] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copiedRoomId, setCopiedRoomId] = useState(false);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);

  // Media URL input bar inside room
  const [mediaUrlInput, setMediaUrlInput] = useState('');
  const [mediaInputError, setMediaInputError] = useState<string | null>(null);

  // Chat composer
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Identity editor
  const [editingName, setEditingName] = useState(displayName);

  // Floating reactions
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const lastFeedIdRef = useRef<string | null>(null);

  useEffect(() => {
    setEditingName(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!isHost) return;
    try {
      sessionStorage.setItem(
        `kinosync:host:${roomId}`,
        JSON.stringify({ source, createdAt: Date.now() })
      );
    } catch {
      // Ignore storage errors
    }
  }, [isHost, roomId, source]);

  useEffect(() => {
    if (sidebarTab === 'chat') {
      clearUnreadCount();
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [feed.length, sidebarTab, clearUnreadCount]);

  useEffect(() => {
    if (feed.length === 0) return;
    const latest = feed[feed.length - 1];
    if (latest.id === lastFeedIdRef.current) return;
    lastFeedIdRef.current = latest.id;

    if (latest.kind === 'reaction') {
      const id = latest.id;
      setFloatingReactions((prev) => [
        ...prev.slice(-6),
        {
          id,
          emoji: latest.text,
          sender: latest.senderName,
          color: latest.senderColor || '#F59E0B',
        },
      ]);
      window.setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
      }, 2200);
    }
  }, [feed]);

  const detectedMedia = useMemo(() => parseVideoSource(mediaUrlInput), [mediaUrlInput]);

  const copyText = async (text: string, onDone: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const temp = document.createElement('input');
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    onDone(true);
    window.setTimeout(() => onDone(false), 2200);
  };

  const handleLoadMediaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMediaInputError(null);
    const parsed = parseVideoSource(mediaUrlInput);
    if (!parsed) {
      setMediaInputError('Paste a valid movie webpage URL, .mp4, .m3u8 HLS stream, or YouTube link.');
      return;
    }
    changeVideoSource(parsed);
    setMediaUrlInput('');
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendChatMessage(chatInput);
    setChatInput('');
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = editingName.trim();
    if (clean) {
      setDisplayName(clean);
      onUpdateIdentity(clean, accentColor);
    }
  };

  const handleColorPick = (color: string) => {
    setAccentColor(color);
    onUpdateIdentity(displayName, color);
  };

  const statusText = getStatusText(status, participants.length, averageRttMs);
  const isHealthyStatus = status === 'hosting' || status === 'connected';

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      {/* Room Top Bar */}
      <header className="w-full border-b border-white/8 bg-[#09090B]/95 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-4">
          {/* Zone 1: Brand + Room ID */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onLeaveRoom}
              className="font-display text-lg font-bold tracking-tight text-white hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              KinoSync
            </button>
            <span aria-hidden="true" className="text-zinc-700 hidden sm:inline">
              /
            </span>
            <button
              type="button"
              onClick={() => void copyText(roomId, setCopiedRoomId)}
              title="Click to copy Room ID for extension"
              className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-zinc-300 hover:text-white transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>{roomId}</span>
              {copiedRoomId ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-zinc-500" />
              )}
            </button>
          </div>

          {/* Zone 2: Live Connection Telemetry */}
          <div className="hidden md:flex items-center gap-2.5 text-xs whitespace-nowrap">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isHealthyStatus
                  ? 'bg-emerald-500'
                  : status === 'error'
                  ? 'bg-red-500'
                  : 'bg-amber-400'
              }`}
              aria-hidden="true"
            />
            <span className={isHealthyStatus ? 'text-zinc-300' : 'text-amber-300'}>
              {statusText}
            </span>
          </div>

          {/* Zone 3: Room Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setExtensionModalOpen(true)}
              className="px-3 py-2 min-h-[38px] rounded-lg bg-[#141419] hover:bg-zinc-800 border border-white/10 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Chrome className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Extension</span>
            </button>

            <button
              type="button"
              onClick={() => void copyText(buildInviteUrl(roomId), setCopiedInvite)}
              className="px-3.5 py-2 min-h-[38px] rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedInvite ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied Invite Link</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Invite Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onLeaveRoom}
              aria-label="Leave room"
              title="Leave room"
              className="p-2 min-w-[38px] min-h-[38px] rounded-lg text-zinc-400 hover:text-white hover:bg-white/8 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Reconnecting / Error Banner */}
      {(errorMessage || status === 'reconnecting') && (
        <div className="bg-[#141419] border-b border-amber-500/25 px-4 sm:px-6 py-2.5">
          <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-amber-300">
              {errorMessage || 'Attempting to reconnect to WebRTC room...'}
            </span>
            <button
              type="button"
              onClick={reconnectNow}
              className="px-3 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry Connection</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5">
        <div
          className={`grid gap-6 items-start ${
            isTheatre ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]'
          }`}
        >
          {/* Left Column: URL Bar + Player / Movie Webpage Launcher */}
          <div className="min-w-0 space-y-4">
            {/* Load Movie Webpage or Stream URL Bar */}
            <form onSubmit={handleLoadMediaSubmit} className="space-y-1.5">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Link2 className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={mediaUrlInput}
                    onChange={(e) => {
                      setMediaUrlInput(e.target.value);
                      if (mediaInputError) setMediaInputError(null);
                    }}
                    placeholder="Paste movie webpage URL (https://...) or direct .mp4 / .m3u8 / YouTube link..."
                    className="w-full h-10 pl-10 pr-3.5 rounded-lg bg-[#111115] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  className="h-10 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {mediaUrlInput.trim() && detectedMedia
                    ? detectedMedia.type === 'webpage'
                      ? 'Share Movie Page'
                      : 'Load Video'
                    : 'Load URL'}
                </button>
              </div>
              {(mediaInputError || (mediaUrlInput.trim() && detectedMedia)) && (
                <div className="text-xs px-1">
                  {mediaInputError ? (
                    <span className="text-red-400">{mediaInputError}</span>
                  ) : detectedMedia ? (
                    <span className="text-amber-400">
                      Detected: {getMediaTypeLabel(detectedMedia.type)}
                    </span>
                  ) : null}
                </div>
              )}
            </form>

            {/* Stage Area */}
            <div className="relative">
              {!source ? (
                /* Empty Lobby Stage */
                <div className="aspect-video w-full rounded-xl bg-[#111115] border border-white/10 flex flex-col items-center justify-center p-6 sm:p-10 text-center">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
                    <Globe className="w-6 h-6 text-amber-400" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-white">
                    {isHost ? 'Room is ready — load a movie or stream' : 'Waiting for a movie link'}
                  </h2>
                  <p className="text-sm text-zinc-400 mt-1.5 max-w-md">
                    Paste any third-party movie webpage URL above to launch it together with the
                    browser extension, or pick a direct stream to play right here.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                    {SAMPLE_STREAMS.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          const parsed = parseVideoSource(s.url);
                          if (parsed) changeVideoSource(parsed);
                        }}
                        className="px-3 py-2 rounded-lg bg-[#09090B] hover:bg-zinc-900 border border-white/10 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Play className="w-3 h-3 text-amber-400 fill-current" />
                        <span>
                          {s.label} ({s.formatLabel})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : source.type === 'webpage' ? (
                /* External Movie Webpage Launcher Card */
                <div className="rounded-xl bg-[#111115] border border-white/10 p-6 sm:p-10 space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2 min-w-0">
                      <p className="text-xs font-medium text-amber-400">
                        Shared Movie Webpage · Sync via Browser Extension
                      </p>
                      <h2 className="font-display text-xl font-bold text-white break-all">
                        {getShortSourceLabel(source)}
                      </h2>
                      <p className="text-sm text-zinc-400 max-w-xl">
                        Third-party streaming pages cannot be embedded inside iframes. Open the
                        movie page in a new tab, then connect the KinoSync extension using Room ID{' '}
                        <span className="font-mono text-zinc-200">{roomId}</span>.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5 shrink-0">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-5 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>Open Movie Page</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => void copyText(roomId, setCopiedRoomId)}
                        className="px-4 py-3 rounded-lg bg-[#09090B] hover:bg-zinc-900 border border-white/12 text-zinc-200 text-sm font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                      >
                        {copiedRoomId ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-400" />
                            <span>Copied {roomId}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 text-zinc-400" />
                            <span>Copy Room ID</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 3-step Extension Quick Guide */}
                  <div className="pt-5 border-t border-white/8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="font-mono text-amber-400 mb-1">01</div>
                      <div className="font-semibold text-zinc-200">Open the movie tab</div>
                      <p className="text-zinc-400 mt-0.5">
                        Click &ldquo;Open Movie Page&rdquo; and keep this lobby tab open for chat &amp;
                        host sync.
                      </p>
                    </div>
                    <div>
                      <div className="font-mono text-amber-400 mb-1">02</div>
                      <div className="font-semibold text-zinc-200">Connect the extension</div>
                      <p className="text-zinc-400 mt-0.5">
                        Paste Room ID <span className="font-mono text-zinc-200">{roomId}</span> into
                        the KinoSync Chrome/Edge extension popup.
                      </p>
                    </div>
                    <div>
                      <div className="font-mono text-amber-400 mb-1">03</div>
                      <div className="font-semibold text-zinc-200">Press Alt + C in fullscreen</div>
                      <p className="text-zinc-400 mt-0.5">
                        Chat and react directly over the movie player without leaving fullscreen.
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/8 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => changeVideoSource({ url: source.url, type: 'mp4' })}
                      className="text-zinc-400 hover:text-zinc-200 underline underline-offset-4 cursor-pointer"
                    >
                      Is this a direct video stream URL without .mp4? Load in built-in player instead
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtensionModalOpen(true)}
                      className="text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                    >
                      Extension install instructions →
                    </button>
                  </div>
                </div>
              ) : (
                /* Direct HTML5 MP4 / HLS / YouTube Player */
                <UnifiedPlayer
                  source={source}
                  playerRef={playerRef}
                  isRemoteApplyingRef={isRemoteApplyingRef}
                  needsUserGesture={needsUserGesture}
                  onClearUserGesture={clearUserGesturePrompt}
                  onPlayEmit={emitPlay}
                  onPauseEmit={emitPause}
                  onSeekEmit={emitSeek}
                  onRateEmit={emitRateChange}
                  onManualResync={requestManualResync}
                  isTheatre={isTheatre}
                  onToggleTheatre={() => setIsTheatre((t) => !t)}
                />
              )}

              {/* Floating Reactions Overlay */}
              {floatingReactions.length > 0 && (
                <div className="absolute right-4 bottom-20 z-30 flex flex-col items-end gap-1.5 pointer-events-none">
                  {floatingReactions.map((r) => (
                    <div
                      key={r.id}
                      className="px-2.5 py-1 rounded-lg bg-black/80 border border-white/12 text-sm flex items-center gap-1.5 animate-bounce"
                    >
                      <span>{r.emoji}</span>
                      <span className="text-[11px] font-medium" style={{ color: r.color }}>
                        {r.sender}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stream Info & Quick Reaction Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="min-w-0">
                {source ? (
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-400">
                    <span className="text-zinc-200 font-medium">
                      {getMediaTypeLabel(source.type)}
                    </span>
                    <span aria-hidden="true" className="text-zinc-600">
                      ·
                    </span>
                    <span className="font-mono truncate max-w-[260px] sm:max-w-md">
                      {getShortSourceLabel(source)}
                    </span>
                    {lastActionLabel && (
                      <>
                        <span aria-hidden="true" className="text-zinc-600">
                          ·
                        </span>
                        <span className="text-amber-400/90">{lastActionLabel}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500">
                    {lastActionLabel || 'Room ready for playback'}
                  </div>
                )}
              </div>

              {/* Reactions & Force Sync */}
              <div className="flex items-center gap-1.5 shrink-0">
                {REACTION_CHOICES.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => sendReaction(emoji)}
                    aria-label={`Send ${emoji} reaction`}
                    className="w-9 h-9 rounded-lg bg-[#111115] hover:bg-zinc-800 border border-white/8 text-base flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
                {isTheatre && (
                  <button
                    type="button"
                    onClick={() => setIsTheatre(false)}
                    className="ml-1 px-3 h-9 rounded-lg bg-[#111115] hover:bg-zinc-800 border border-white/10 text-xs font-medium text-zinc-200 cursor-pointer"
                  >
                    Show Chat
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Collaboration Sidebar */}
          {!isTheatre && (
            <aside className="bg-[#111115] border border-white/10 rounded-xl flex flex-col h-[500px] lg:h-[calc(100vh-116px)] lg:max-h-[760px] overflow-hidden">
              {/* Segmented Tab Header + Sound Toggle */}
              <div className="p-2 border-b border-white/8 flex items-center gap-1.5 bg-[#0D0D11]">
                <div className="flex-1 grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSidebarTab('chat');
                      clearUnreadCount();
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      sidebarTab === 'chat'
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat</span>
                    {unreadCount > 0 && sidebarTab !== 'chat' && (
                      <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-zinc-950 text-[10px] font-bold tabular-nums">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarTab('viewers')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      sidebarTab === 'viewers'
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span className="tabular-nums">Viewers ({participants.length || 1})</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  title={soundEnabled ? 'Mute chat sound alerts' : 'Enable chat sound alerts'}
                  aria-label={soundEnabled ? 'Mute sound alerts' : 'Enable sound alerts'}
                  className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/8 transition-colors shrink-0 cursor-pointer"
                >
                  {soundEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                </button>
              </div>

              {sidebarTab === 'chat' ? (
                <>
                  {/* Feed */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {feed.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <p className="text-xs font-medium text-zinc-300">Room chat is ready</p>
                        <p className="text-xs text-zinc-500 mt-1">
                          Messages, emoji reactions, and playback activity logs appear here in real
                          time across web and extension tabs.
                        </p>
                      </div>
                    ) : (
                      feed.map((item) => {
                        const color = item.senderColor || '#F59E0B';
                        if (item.kind === 'event') {
                          return (
                            <div
                              key={item.id}
                              className="text-[11px] text-zinc-500 leading-snug py-0.5"
                            >
                              <span className="font-semibold" style={{ color }}>
                                {item.senderName}
                              </span>{' '}
                              <span className="break-all">{item.text}</span>
                            </div>
                          );
                        }

                        if (item.kind === 'reaction') {
                          return (
                            <div
                              key={item.id}
                              className="text-xs text-zinc-400 flex items-center gap-1.5"
                            >
                              <span className="font-semibold" style={{ color }}>
                                {item.senderName}
                              </span>
                              <span>reacted</span>
                              <span className="text-base">{item.text}</span>
                            </div>
                          );
                        }

                        const isMe = item.senderId === localPeerId || item.senderId === 'local';
                        const initial = item.senderName.slice(0, 1).toUpperCase();
                        return (
                          <div key={item.id} className="flex items-start gap-2.5">
                            <div
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-zinc-950 shrink-0 mt-0.5"
                              style={{ backgroundColor: color }}
                            >
                              {initial}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                                <span className="font-semibold truncate" style={{ color }}>
                                  {item.senderName}
                                  {isMe && (
                                    <span className="text-zinc-500 font-normal"> (You)</span>
                                  )}
                                </span>
                                <span className="font-mono text-zinc-600 tabular-nums shrink-0">
                                  {new Date(item.timestamp).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <div
                                className="px-3 py-2 rounded-lg text-sm text-zinc-100 leading-snug break-words"
                                style={{
                                  backgroundColor: `${color}14`,
                                  border: `1px solid ${color}35`,
                                }}
                              >
                                {item.text}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Quick Reactions Row inside Chat */}
                  <div className="px-3 py-1.5 border-t border-white/8 bg-[#0D0D11] flex items-center justify-between">
                    {REACTION_CHOICES.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => sendReaction(emoji)}
                        className="px-2.5 py-1 rounded-md hover:bg-white/10 text-base transition-transform active:scale-95 cursor-pointer"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>

                  {/* Message Composer */}
                  <form
                    onSubmit={handleChatSubmit}
                    className="p-3 border-t border-white/8 bg-[#0D0D11] flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Message the room..."
                      maxLength={400}
                      className="flex-1 h-10 px-3 rounded-lg bg-[#09090B] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                    />
                    <button
                      type="submit"
                      aria-label="Send message"
                      disabled={!chatInput.trim()}
                      className="h-10 w-10 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 flex items-center justify-center transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </>
              ) : (
                /* Viewers & Force Sync Tab */
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  <button
                    type="button"
                    onClick={forceSyncAll}
                    className="w-full h-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Force Sync Now</span>
                  </button>

                  {/* Connected Participants */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-medium text-zinc-400">
                      Connected Participants
                    </div>
                    <ul className="divide-y divide-white/6">
                      {participants.map((p) => {
                        const isSelf = p.peerId === localPeerId;
                        const color = p.color || '#F59E0B';
                        const badge = getSyncBadgeProps(p.syncStatus, p.driftSeconds);
                        return (
                          <li
                            key={p.peerId}
                            className="py-2.5 flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-zinc-950 shrink-0"
                                style={{ backgroundColor: color }}
                              >
                                {p.name.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-zinc-100 truncate">
                                  {p.name}
                                  {isSelf && (
                                    <span className="text-zinc-500 font-normal"> (You)</span>
                                  )}
                                </div>
                                <div className="text-[11px] text-zinc-500">
                                  {p.isHost ? 'Room Host' : p.clientType === 'extension' ? 'Extension' : 'Web Lobby'}
                                  {typeof p.rttMs === 'number' && ` · ${p.rttMs} ms`}
                                </div>
                              </div>
                            </div>
                            <span className={`font-medium shrink-0 ${badge.className}`}>
                              {badge.label}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {/* Identity Editor */}
                  <form
                    onSubmit={handleRenameSubmit}
                    className="border-t border-white/8 pt-4 space-y-3"
                  >
                    <label
                      htmlFor="room-rename-input"
                      className="block text-xs font-medium text-zinc-400"
                    >
                      Your Name &amp; Bubble Accent
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="room-rename-input"
                        type="text"
                        value={editingName}
                        maxLength={28}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="flex-1 h-9 px-3 rounded-lg bg-[#09090B] border border-white/10 text-xs text-white focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="submit"
                        className="h-9 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      {ACCENT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => handleColorPick(c)}
                          aria-label={`Select color ${c}`}
                          className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                            accentColor === c
                              ? 'ring-2 ring-white ring-offset-2 ring-offset-[#111115] scale-110'
                              : 'opacity-75 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </form>
                </div>
              )}
            </aside>
          )}
        </div>
      </main>

      {/* Extension Setup Modal */}
      {extensionModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          onClick={() => setExtensionModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-[#111115] border border-white/12 p-6 shadow-2xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Chrome className="w-4 h-4 text-amber-400" />
                <h2 className="font-display text-base font-semibold text-white">
                  Connect Browser Extension
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setExtensionModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-lg bg-[#09090B] border border-white/10 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] text-zinc-500">Active Room ID</div>
                <div className="font-mono text-sm font-semibold text-amber-400">{roomId}</div>
              </div>
              <button
                type="button"
                onClick={() => void copyText(roomId, setCopiedRoomId)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
              >
                {copiedRoomId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedRoomId ? 'Copied' : 'Copy ID'}</span>
              </button>
            </div>

            <ol className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <li>
                <strong className="text-white">1. Load unpacked extension:</strong> Open{' '}
                <span className="font-mono text-zinc-200">chrome://extensions</span> (or{' '}
                <span className="font-mono text-zinc-200">edge://extensions</span>), enable{' '}
                <strong className="text-white">Developer mode</strong>, click{' '}
                <strong className="text-white">Load unpacked</strong>, and select the{' '}
                <span className="font-mono text-zinc-200">/extension</span> folder.
              </li>
              <li>
                <strong className="text-white">2. Open your movie webpage:</strong> Click the
                &ldquo;Open Movie Page&rdquo; button in this room (keep this lobby tab open).
              </li>
              <li>
                <strong className="text-white">3. Connect &amp; watch in fullscreen:</strong> Click
                the KinoSync extension icon, paste Room ID{' '}
                <span className="font-mono text-amber-400">{roomId}</span>, and click{' '}
                <strong className="text-white">Connect to Room</strong>. Press{' '}
                <span className="font-mono text-zinc-200">Alt + C</span> anytime to toggle the
                floating fullscreen chat.
              </li>
            </ol>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setExtensionModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

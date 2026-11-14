import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { LandingView } from './components/LandingView';
import { RoomView } from './components/RoomView';
import { VideoSource } from './types/watch';
import {
  ACCENT_COLORS,
  generateRoomCode,
  getRoomIdFromLocation,
  pickAccentColor,
} from './utils/mediaUrl';

interface ActiveRoomSession {
  roomId: string;
  isHost: boolean;
  initialSource: VideoSource | null;
}

const DISPLAY_NAME_KEY = 'kinosync:displayName';
const ACCENT_COLOR_KEY = 'kinosync:accentColor';

function getHostStorageKey(roomId: string): string {
  return `kinosync:host:${roomId}`;
}

function loadSavedHostSource(roomId: string): { found: boolean; source: VideoSource | null } {
  try {
    const raw = sessionStorage.getItem(getHostStorageKey(roomId));
    if (!raw) return { found: false, source: null };
    const parsed = JSON.parse(raw) as { source?: VideoSource | null };
    return { found: true, source: parsed?.source ?? null };
  } catch {
    return { found: false, source: null };
  }
}

function resolveSessionFromUrl(): ActiveRoomSession | null {
  const roomId = getRoomIdFromLocation();
  if (!roomId) return null;
  const savedHost = loadSavedHostSource(roomId);
  if (savedHost.found) {
    return {
      roomId,
      isHost: true,
      initialSource: savedHost.source,
    };
  }
  return {
    roomId,
    isHost: false,
    initialSource: null,
  };
}

export default function App() {
  const [savedDisplayName, setSavedDisplayName] = useState<string>(() => {
    try {
      return localStorage.getItem(DISPLAY_NAME_KEY) || '';
    } catch {
      return '';
    }
  });

  const [savedColor, setSavedColor] = useState<string>(() => {
    try {
      const existing = localStorage.getItem(ACCENT_COLOR_KEY);
      if (existing) return existing;
      const picked = pickAccentColor();
      localStorage.setItem(ACCENT_COLOR_KEY, picked);
      return picked;
    } catch {
      return pickAccentColor();
    }
  });

  const [activeRoom, setActiveRoom] = useState<ActiveRoomSession | null>(() =>
    resolveSessionFromUrl()
  );

  // If a guest lands directly via ?room=ROOM_ID with no saved display name, let them pick one first
  const [needsInviteIdentity, setNeedsInviteIdentity] = useState<boolean>(() => {
    const urlRoom = getRoomIdFromLocation();
    if (!urlRoom) return false;
    const savedHost = loadSavedHostSource(urlRoom);
    if (savedHost.found) return false;
    try {
      return !localStorage.getItem(DISPLAY_NAME_KEY);
    } catch {
      return true;
    }
  });
  const [inviteNameInput, setInviteNameInput] = useState('');

  useEffect(() => {
    const onPopState = () => {
      setActiveRoom(resolveSessionFromUrl());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const persistIdentity = useCallback((name: string, color: string) => {
    const clean = name.trim();
    if (clean) {
      setSavedDisplayName(clean);
      try {
        localStorage.setItem(DISPLAY_NAME_KEY, clean);
      } catch {
        // Ignore storage errors
      }
    }
    if (color) {
      setSavedColor(color);
      try {
        localStorage.setItem(ACCENT_COLOR_KEY, color);
      } catch {
        // Ignore storage errors
      }
    }
  }, []);

  const handleCreateRoom = useCallback(
    (source: VideoSource | null, displayName: string, color: string) => {
      const roomId = generateRoomCode();
      persistIdentity(displayName, color);
      try {
        sessionStorage.setItem(
          getHostStorageKey(roomId),
          JSON.stringify({ source, createdAt: Date.now() })
        );
      } catch {
        // Ignore storage errors
      }
      window.history.pushState({}, '', `/?room=${roomId}`);
      setNeedsInviteIdentity(false);
      setActiveRoom({
        roomId,
        isHost: true,
        initialSource: source,
      });
    },
    [persistIdentity]
  );

  const handleJoinRoom = useCallback(
    (roomId: string, displayName: string, color: string) => {
      persistIdentity(displayName, color);
      const savedHost = loadSavedHostSource(roomId);
      window.history.pushState({}, '', `/?room=${roomId}`);
      setNeedsInviteIdentity(false);
      setActiveRoom({
        roomId,
        isHost: savedHost.found,
        initialSource: savedHost.source,
      });
    },
    [persistIdentity]
  );

  const handleLeaveRoom = useCallback(() => {
    window.history.pushState({}, '', '/');
    setNeedsInviteIdentity(false);
    setActiveRoom(null);
  }, []);

  // Pre-join identity prompt for first-time invite link visitors
  if (activeRoom && needsInviteIdentity) {
    return (
      <div className="min-h-screen bg-[#09090B] text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#111115] border border-white/10 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5">
            <p className="text-xs font-mono text-amber-400">Room {activeRoom.roomId}</p>
            <h1 className="font-display text-xl font-bold text-white">
              Choose your display name
            </h1>
            <p className="text-sm text-zinc-400">
              Enter a short name and accent color before joining the watch room.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              persistIdentity(inviteNameInput.trim() || 'Guest', savedColor);
              setNeedsInviteIdentity(false);
            }}
            className="space-y-5"
          >
            <div>
              <label
                htmlFor="invite-name-input"
                className="block text-xs font-medium text-zinc-300 mb-2"
              >
                Display Name
              </label>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-display font-bold text-sm text-zinc-950 shrink-0"
                  style={{ backgroundColor: savedColor }}
                >
                  {(inviteNameInput.trim() || 'G').slice(0, 1).toUpperCase()}
                </div>
                <input
                  id="invite-name-input"
                  type="text"
                  autoFocus
                  maxLength={28}
                  value={inviteNameInput}
                  onChange={(e) => setInviteNameInput(e.target.value)}
                  placeholder="e.g. Maya"
                  className="flex-1 h-11 px-3.5 rounded-lg bg-[#09090B] border border-white/12 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">Chat bubble accent</span>
              <div className="flex items-center gap-2">
                {ACCENT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSavedColor(c)}
                    aria-label={`Select accent color ${c}`}
                    className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                      savedColor === c
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#111115] scale-110'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full h-11 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>Enter Watch Room</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (activeRoom) {
    return (
      <RoomView
        key={activeRoom.roomId}
        roomId={activeRoom.roomId}
        isHost={activeRoom.isHost}
        initialSource={activeRoom.initialSource}
        initialDisplayName={savedDisplayName || (activeRoom.isHost ? 'Host' : 'Guest')}
        initialColor={savedColor}
        onUpdateIdentity={persistIdentity}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  }

  return (
    <LandingView
      initialDisplayName={savedDisplayName}
      initialColor={savedColor}
      onCreateRoom={handleCreateRoom}
      onJoinRoom={handleJoinRoom}
    />
  );
}

import React, { useMemo, useState } from 'react';
import { ArrowRight, Chrome, Globe, Link2, Play, Radio, ShieldCheck, Users } from 'lucide-react';
import { VideoSource } from '../types/watch';
import {
  ACCENT_COLORS,
  extractRoomCodeFromInput,
  getMediaTypeLabel,
  parseVideoSource,
  SAMPLE_STREAMS,
} from '../utils/mediaUrl';

interface LandingViewProps {
  initialDisplayName: string;
  initialColor: string;
  onCreateRoom: (source: VideoSource | null, displayName: string, color: string) => void;
  onJoinRoom: (roomId: string, displayName: string, color: string) => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  initialDisplayName,
  initialColor,
  onCreateRoom,
  onJoinRoom,
}) => {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [accentColor, setAccentColor] = useState(initialColor);
  const [formError, setFormError] = useState<string | null>(null);

  const detectedSource = useMemo(() => parseVideoSource(videoUrlInput), [videoUrlInput]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmedUrl = videoUrlInput.trim();
    let parsed: VideoSource | null = null;
    if (trimmedUrl) {
      parsed = parseVideoSource(trimmedUrl);
      if (!parsed) {
        setFormError('Enter a valid URL (movie webpage, .mp4, .m3u8, or YouTube link), or leave blank to set it inside the room.');
        return;
      }
    }
    onCreateRoom(parsed, displayName.trim() || 'Host', accentColor);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const code = extractRoomCodeFromInput(joinInput);
    if (!code) {
      setFormError('Enter a valid Room ID or ?room= invite link.');
      return;
    }
    onJoinRoom(code, displayName.trim() || 'Guest', accentColor);
  };

  const scrollToLauncher = (targetMode: 'create' | 'join') => {
    setMode(targetMode);
    setFormError(null);
    const el = document.getElementById('room-launcher');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="w-full border-b border-white/8 bg-[#09090B]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            KinoSync
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm text-zinc-400">
            <a
              href="#formats"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Playback Modes
            </a>
            <a
              href="#workflow"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Extension Sync
            </a>
            <a
              href="#architecture"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Zero-Backend
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => scrollToLauncher('join')}
              className="px-4 py-2 text-xs font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Join Room
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero & Room Launcher */}
        <section className="max-w-6xl mx-auto px-6 pt-14 pb-20 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            {/* Left Editorial Pitch */}
            <div className="lg:col-span-6 space-y-6 pt-2">
              <p className="text-xs font-medium text-amber-400 tracking-wide">
                Private peer-to-peer watch parties
              </p>

              <h1
                className="font-display font-bold tracking-tight text-white leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 4.2vw, 3.5rem)', textWrap: 'balance' }}
              >
                Watch together from any webpage or stream.
              </h1>

              <p className="text-base text-zinc-400 leading-relaxed max-w-xl">
                Create a private WebRTC room in one click. Watch direct MP4, HLS (.m3u8), or
                YouTube links right inside this lobby—or share any third-party movie webpage and sync
                native playback across tabs with our lightweight browser extension.
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-zinc-400">
                <span>Any Movie Webpage</span>
                <span aria-hidden="true" className="text-zinc-600">
                  ·
                </span>
                <span>MP4 / HLS / YouTube</span>
                <span aria-hidden="true" className="text-zinc-600">
                  ·
                </span>
                <span>Fullscreen Mini-Chat</span>
              </div>
            </div>

            {/* Right Interactive Launcher */}
            <div
              id="room-launcher"
              className="lg:col-span-6 bg-[#111115] border border-white/10 rounded-xl p-6 sm:p-8"
            >
              {/* Mode Segmented Control */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-[#09090B] border border-white/8 rounded-lg mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setMode('create');
                    setFormError(null);
                  }}
                  className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    mode === 'create'
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Create Room
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('join');
                    setFormError(null);
                  }}
                  className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    mode === 'join'
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Join Existing Room
                </button>
              </div>

              {/* Identity: Display Name & Distinct Chat Accent Color */}
              <div className="space-y-3 mb-5 pb-5 border-b border-white/8">
                <div>
                  <label
                    htmlFor="identity-name-input"
                    className="block text-xs font-medium text-zinc-300 mb-2"
                  >
                    Your Display Name
                  </label>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center font-display font-bold text-sm text-zinc-950 shrink-0"
                      style={{ backgroundColor: accentColor }}
                    >
                      {(displayName.trim() || (mode === 'create' ? 'H' : 'G'))
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                    <input
                      id="identity-name-input"
                      type="text"
                      maxLength={28}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={mode === 'create' ? 'e.g. Alex (Host)' : 'e.g. Maya'}
                      className="flex-1 h-10 px-3.5 rounded-lg bg-[#09090B] border border-white/12 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-zinc-400">Chat bubble accent</span>
                  <div className="flex items-center gap-2">
                    {ACCENT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setAccentColor(c)}
                        aria-label={`Select accent color ${c}`}
                        className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                          accentColor === c
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-[#111115] scale-110'
                            : 'opacity-75 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {mode === 'create' ? (
                <form onSubmit={handleCreateSubmit} className="space-y-5">
                  <div>
                    <label
                      htmlFor="video-url-input"
                      className="block text-xs font-medium text-zinc-300 mb-2"
                    >
                      Movie Webpage or Direct Video URL <span className="text-zinc-500">(optional)</span>
                    </label>
                    <div className="relative">
                      <Link2 className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="video-url-input"
                        type="text"
                        value={videoUrlInput}
                        onChange={(e) => {
                          setVideoUrlInput(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        placeholder="https://example.com/watch/movie or .mp4 / .m3u8 / YouTube"
                        autoComplete="off"
                        className="w-full h-11 pl-10 pr-3.5 rounded-lg bg-[#09090B] border border-white/12 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                      />
                    </div>
                    <div className="mt-2 min-h-[18px] text-xs">
                      {videoUrlInput.trim() ? (
                        detectedSource ? (
                          <span className="text-amber-400">
                            Detected: {getMediaTypeLabel(detectedSource.type)}
                          </span>
                        ) : (
                          <span className="text-zinc-500">
                            Enter a valid webpage URL, .mp4, .m3u8, or YouTube link
                          </span>
                        )
                      ) : (
                        <span className="text-zinc-500">
                          Paste any movie webpage or stream now, or add it inside the room
                        </span>
                      )}
                    </div>
                  </div>

                  {formError && (
                    <p role="alert" className="text-xs text-red-400">
                      {formError}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="w-full h-11 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Create Room</span>
                  </button>

                  {/* Sample Streams */}
                  <div className="pt-4 border-t border-white/8">
                    <p className="text-xs text-zinc-400 mb-2.5">Quick test streams:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {SAMPLE_STREAMS.map((sample) => (
                        <button
                          key={sample.label}
                          type="button"
                          onClick={() => {
                            setVideoUrlInput(sample.url);
                            setFormError(null);
                          }}
                          className="text-left px-3 py-2 rounded-lg bg-[#09090B] hover:bg-zinc-900 border border-white/8 hover:border-white/18 transition-colors cursor-pointer"
                        >
                          <div className="text-xs font-medium text-zinc-200 truncate">
                            {sample.label}
                          </div>
                          <div className="text-[11px] font-mono text-amber-400 mt-0.5">
                            {sample.formatLabel}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleJoinSubmit} className="space-y-5">
                  <div>
                    <label
                      htmlFor="join-code-input"
                      className="block text-xs font-medium text-zinc-300 mb-2"
                    >
                      Room ID or Invite URL
                    </label>
                    <input
                      id="join-code-input"
                      type="text"
                      value={joinInput}
                      onChange={(e) => {
                        setJoinInput(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="e.g. k9x-4m2 or https://your-app.vercel.app/?room=k9x-4m2"
                      autoComplete="off"
                      className="w-full h-11 px-3.5 rounded-lg bg-[#09090B] border border-white/12 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                    />
                  </div>

                  {formError && (
                    <p role="alert" className="text-xs text-red-400">
                      {formError}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="w-full h-11 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <span>Join Room</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>

        {/* Playback Modes */}
        <section id="formats" className="border-t border-white/8 py-16">
          <div className="max-w-6xl mx-auto px-6">
            <h2 className="font-display text-xl font-semibold text-white mb-8">
              Two ways to watch together, one shared room
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-amber-400">
                  <Globe className="w-4 h-4" />
                  <h3 className="text-sm font-semibold text-white">Third-Party Movie Webpages</h3>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Sites that block iframes or tokenize streams open in each friend&apos;s own tab.
                  Our Manifest V3 extension syncs play, pause, seek, and speed inside nested
                  iframes automatically.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-amber-400">
                  <Radio className="w-4 h-4" />
                  <h3 className="text-sm font-semibold text-white">Direct MP4, HLS &amp; YouTube</h3>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Paste any direct .mp4, adaptive .m3u8 HLS stream (via hls.js), or YouTube link to
                  play natively right inside the room with zero extension needed.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-amber-400">
                  <Users className="w-4 h-4" />
                  <h3 className="text-sm font-semibold text-white">Fullscreen Mini-Chat &amp; Reactions</h3>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Press Alt + C on any movie webpage to open the floating translucent chat drawer in
                  fullscreen, or get unobtrusive auto-fading toast bubbles while watching.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Extension Workflow & Architecture */}
        <section id="workflow" className="border-t border-white/8 py-16">
          <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <h2 className="font-display text-xl font-semibold text-white mb-6">
                Watching from a third-party movie website
              </h2>
              <ol className="space-y-5">
                <li className="flex gap-4">
                  <span className="font-mono text-xs text-amber-400 pt-1 tabular-nums">01</span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Create a room &amp; share the link</h3>
                    <p className="text-sm text-zinc-400 mt-1">
                      Paste the movie webpage URL inside the room and send your{' '}
                      <span className="font-mono text-zinc-300">?room=ROOM_ID</span> invite link to
                      friends.
                    </p>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="font-mono text-xs text-amber-400 pt-1 tabular-nums">02</span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Open the movie page in a new tab</h3>
                    <p className="text-sm text-zinc-400 mt-1">
                      Everyone clicks &ldquo;Open Movie Page&rdquo; in the room lobby so you are all
                      viewing the same video source natively in full quality.
                    </p>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="font-mono text-xs text-amber-400 pt-1 tabular-nums">03</span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Connect the extension with your Room ID
                    </h3>
                    <p className="text-sm text-zinc-400 mt-1">
                      Click the KinoSync extension icon, paste the Room ID, and hit Connect. Play,
                      pause, seek, speed, and Alt + C chat sync peer-to-peer in real time.
                    </p>
                  </div>
                </li>
              </ol>
            </div>

            <div id="architecture" className="bg-[#111115] border border-white/10 rounded-xl p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-2 text-amber-400">
                <ShieldCheck className="w-4 h-4" />
                <h2 className="font-display text-base font-semibold text-white">
                  Zero-backend WebRTC DataChannels
                </h2>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Both this static web lobby and the unpacked Manifest V3 browser extension connect
                through PeerJS WebRTC DataChannels. Video streams load directly from their origin at
                full bitrate—never degraded by screen sharing—while playback events, drift checks,
                and chat travel directly between peers.
              </p>
              <div className="pt-4 border-t border-white/8 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-zinc-500">Web Lobby Hosting</div>
                  <div className="text-zinc-200 font-medium mt-0.5">Static GitHub + Vercel</div>
                </div>
                <div className="flex items-start gap-2">
                  <Chrome className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-zinc-500">Browser Extension</div>
                    <div className="text-zinc-200 font-medium mt-0.5">Chrome · Edge · Brave MV3</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/8 py-6">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500">
          <span>KinoSync — Private Watch Together</span>
          <span>Web Shortcuts: Space Play/Pause · J/L ±10s · Extension Chat: Alt + C</span>
        </div>
      </footer>
    </div>
  );
};

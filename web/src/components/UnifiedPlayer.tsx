import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertCircle,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  RectangleHorizontal,
} from 'lucide-react';
import { HlsQualityLevel, PlayerHandle, VideoSource } from '../types/watch';
import { formatTime } from '../utils/mediaUrl';
import { loadYouTubeIframeAPI, YTPlayerInstance } from '../utils/youtubeApi';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface UnifiedPlayerProps {
  source: VideoSource | null;
  playerRef: React.MutableRefObject<PlayerHandle | null>;
  isRemoteApplyingRef: React.MutableRefObject<boolean>;
  needsUserGesture: boolean;
  onClearUserGesture: () => void;
  onPlayEmit: (currentTime: number, playbackRate: number) => void;
  onPauseEmit: (currentTime: number) => void;
  onSeekEmit: (currentTime: number, isPlaying: boolean) => void;
  onRateEmit: (playbackRate: number, currentTime: number) => void;
  onManualResync: () => void;
  isTheatre: boolean;
  onToggleTheatre: () => void;
}

export const UnifiedPlayer: React.FC<UnifiedPlayerProps> = ({
  source,
  playerRef,
  isRemoteApplyingRef,
  needsUserGesture,
  onClearUserGesture,
  onPlayEmit,
  onPauseEmit,
  onSeekEmit,
  onRateEmit,
  onManualResync,
  isTheatre,
  onToggleTheatre,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);

  const localControlGuardRef = useRef<boolean>(false);
  const guardTimerRef = useRef<number | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedRatio, setBufferedRatio] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // HLS quality selector state
  const [hlsLevels, setHlsLevels] = useState<HlsQualityLevel[]>([]);
  const [currentHlsLevel, setCurrentHlsLevel] = useState<number>(-1);
  const [openMenu, setOpenMenu] = useState<'speed' | 'quality' | null>(null);

  // Scrubbing preview state
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number>(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const armLocalGuard = useCallback((ms = 320) => {
    localControlGuardRef.current = true;
    if (guardTimerRef.current !== null) {
      window.clearTimeout(guardTimerRef.current);
    }
    guardTimerRef.current = window.setTimeout(() => {
      localControlGuardRef.current = false;
      guardTimerRef.current = null;
    }, ms);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
    }
    controlsHideTimerRef.current = window.setTimeout(() => {
      if (playerRef.current?.isPlaying() && !openMenu) {
        setControlsVisible(false);
      }
    }, 2800);
  }, [openMenu, playerRef]);

  // Register unified PlayerHandle whenever source changes
  useEffect(() => {
    if (!source) {
      playerRef.current = null;
      return;
    }

    if (source.type === 'youtube') {
      playerRef.current = {
        play: () => {
          ytPlayerRef.current?.playVideo();
          setIsPlaying(true);
        },
        pause: () => {
          ytPlayerRef.current?.pauseVideo();
          setIsPlaying(false);
        },
        seekTo: (seconds: number) => {
          const safe = Math.max(0, seconds);
          ytPlayerRef.current?.seekTo(safe, true);
          setCurrentTime(safe);
        },
        setPlaybackRate: (rate: number) => {
          ytPlayerRef.current?.setPlaybackRate(rate);
          setPlaybackRate(rate);
        },
        setVolume: (vol: number) => {
          const clamped = Math.max(0, Math.min(1, vol));
          ytPlayerRef.current?.setVolume(Math.round(clamped * 100));
          setVolume(clamped);
        },
        setMuted: (muted: boolean) => {
          if (muted) ytPlayerRef.current?.mute();
          else ytPlayerRef.current?.unMute();
          setIsMuted(muted);
        },
        getCurrentTime: () => ytPlayerRef.current?.getCurrentTime() ?? 0,
        getDuration: () => ytPlayerRef.current?.getDuration() ?? 0,
        getPlaybackRate: () => ytPlayerRef.current?.getPlaybackRate() ?? 1,
        isPlaying: () => ytPlayerRef.current?.getPlayerState() === 1,
      };
    } else {
      playerRef.current = {
        play: async () => {
          const vid = videoRef.current;
          if (!vid) return;
          await vid.play();
          setIsPlaying(true);
        },
        pause: () => {
          const vid = videoRef.current;
          if (!vid) return;
          vid.pause();
          setIsPlaying(false);
        },
        seekTo: (seconds: number) => {
          const vid = videoRef.current;
          if (!vid) return;
          const safe = Math.max(0, Number.isFinite(vid.duration) ? Math.min(seconds, vid.duration) : seconds);
          vid.currentTime = safe;
          setCurrentTime(safe);
        },
        setPlaybackRate: (rate: number) => {
          const vid = videoRef.current;
          if (!vid) return;
          vid.playbackRate = rate;
          setPlaybackRate(rate);
        },
        setVolume: (vol: number) => {
          const vid = videoRef.current;
          if (!vid) return;
          const clamped = Math.max(0, Math.min(1, vol));
          vid.volume = clamped;
          setVolume(clamped);
        },
        setMuted: (muted: boolean) => {
          const vid = videoRef.current;
          if (!vid) return;
          vid.muted = muted;
          setIsMuted(muted);
        },
        getCurrentTime: () => videoRef.current?.currentTime ?? 0,
        getDuration: () => {
          const d = videoRef.current?.duration ?? 0;
          return Number.isFinite(d) ? d : 0;
        },
        getPlaybackRate: () => videoRef.current?.playbackRate ?? 1,
        isPlaying: () => {
          const vid = videoRef.current;
          return Boolean(vid && !vid.paused && !vid.ended);
        },
      };
    }
  }, [source, playerRef]);

  // Mount & configure HTML5 / HLS engine
  useEffect(() => {
    if (!source || source.type === 'youtube') return;
    const video = videoRef.current;
    if (!video) return;

    setMediaError(null);
    setIsBuffering(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedRatio(0);
    setHlsLevels([]);
    setCurrentHlsLevel(-1);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    video.volume = volume;
    video.muted = isMuted;

    if (source.type === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 60,
        });
        hlsRef.current = hls;
        hls.loadSource(source.url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
          setIsBuffering(false);
          const levels: HlsQualityLevel[] = data.levels
            .map((lvl, idx) => ({
              index: idx,
              height: lvl.height || 0,
              bitrate: lvl.bitrate || 0,
              label: lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)} kbps`,
            }))
            .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
          setHlsLevels(levels);
        });

        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setIsBuffering(false);
            setMediaError('Unable to load this HLS stream. Verify the URL allows CORS playback.');
            hls.destroy();
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = source.url;
      } else {
        setIsBuffering(false);
        setMediaError('HLS playback is not supported in this browser.');
      }
    } else {
      video.src = source.url;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.url, source?.type]);

  // Mount & configure YouTube IFrame Player API
  useEffect(() => {
    if (!source || source.type !== 'youtube' || !source.youtubeId) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore destroy error
        }
        ytPlayerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setMediaError(null);
    setIsBuffering(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedRatio(0);
    setHlsLevels([]);

    const videoId = source.youtubeId;

    loadYouTubeIframeAPI()
      .then((YT) => {
        if (cancelled || !ytContainerRef.current) return;

        // Clear mount container and create dedicated child div for YT.Player
        ytContainerRef.current.innerHTML = '';
        const targetEl = document.createElement('div');
        targetEl.className = 'w-full h-full';
        ytContainerRef.current.appendChild(targetEl);

        if (ytPlayerRef.current) {
          try {
            ytPlayerRef.current.destroy();
          } catch {
            // Ignore
          }
        }

        const ytPlayer = new YT.Player(targetEl, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: (evt) => {
              if (cancelled) return;
              setIsBuffering(false);
              evt.target.setVolume(Math.round(volume * 100));
              if (isMuted) evt.target.mute();
              const d = evt.target.getDuration();
              if (d > 0) setDuration(d);
            },
            onStateChange: (evt) => {
              if (cancelled) return;
              const state = evt.data;
              if (state === YT.PlayerState.PLAYING) {
                setIsBuffering(false);
                setIsPlaying(true);
                const d = evt.target.getDuration();
                if (d > 0) setDuration(d);
                if (!isRemoteApplyingRef.current && !localControlGuardRef.current) {
                  onPlayEmit(evt.target.getCurrentTime(), evt.target.getPlaybackRate());
                }
              } else if (state === YT.PlayerState.PAUSED) {
                setIsBuffering(false);
                setIsPlaying(false);
                if (!isRemoteApplyingRef.current && !localControlGuardRef.current) {
                  onPauseEmit(evt.target.getCurrentTime());
                }
              } else if (state === YT.PlayerState.BUFFERING) {
                setIsBuffering(true);
              } else if (state === YT.PlayerState.ENDED) {
                setIsBuffering(false);
                setIsPlaying(false);
              }
            },
            onError: () => {
              if (cancelled) return;
              setIsBuffering(false);
              setMediaError('This YouTube video cannot be embedded or was not found.');
            },
          },
        });

        ytPlayerRef.current = ytPlayer;
      })
      .catch(() => {
        if (!cancelled) {
          setIsBuffering(false);
          setMediaError('Could not load YouTube Player API. Check network or ad-block settings.');
        }
      });

    return () => {
      cancelled = true;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.youtubeId, source?.type]);

  // Poll YouTube time & buffered progress
  useEffect(() => {
    if (!source || source.type !== 'youtube') return;
    const timer = window.setInterval(() => {
      const yt = ytPlayerRef.current;
      if (!yt || isScrubbing) return;
      try {
        const t = yt.getCurrentTime();
        const d = yt.getDuration();
        const frac = yt.getVideoLoadedFraction();
        if (Number.isFinite(t)) setCurrentTime(t);
        if (Number.isFinite(d) && d > 0) setDuration(d);
        if (Number.isFinite(frac)) setBufferedRatio(Math.max(0, Math.min(1, frac)));
      } catch {
        // YT player may be mid-destroy
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [source, isScrubbing]);

  // Fullscreen listener
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Mutual player actions
  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    revealControls();
    onClearUserGesture();

    if (player.isPlaying()) {
      armLocalGuard(350);
      const t = player.getCurrentTime();
      player.pause();
      setIsPlaying(false);
      onPauseEmit(t);
    } else {
      armLocalGuard(350);
      const t = player.getCurrentTime();
      const rate = player.getPlaybackRate();
      void Promise.resolve(player.play()).catch(() => {
        // Ignore play rejection
      });
      setIsPlaying(true);
      onPlayEmit(t, rate);
    }
  }, [armLocalGuard, onClearUserGesture, onPauseEmit, onPlayEmit, playerRef, revealControls]);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const player = playerRef.current;
      if (!player) return;
      revealControls();
      const d = player.getDuration();
      const raw = player.getCurrentTime() + deltaSeconds;
      const target = d > 0 ? Math.max(0, Math.min(d, raw)) : Math.max(0, raw);
      armLocalGuard(400);
      player.seekTo(target);
      setCurrentTime(target);
      onSeekEmit(target, player.isPlaying());
    },
    [armLocalGuard, onSeekEmit, playerRef, revealControls]
  );

  const seekToPosition = useCallback(
    (targetSeconds: number) => {
      const player = playerRef.current;
      if (!player) return;
      const d = player.getDuration();
      const target = d > 0 ? Math.max(0, Math.min(d, targetSeconds)) : Math.max(0, targetSeconds);
      armLocalGuard(400);
      player.seekTo(target);
      setCurrentTime(target);
      onSeekEmit(target, player.isPlaying());
    },
    [armLocalGuard, onSeekEmit, playerRef]
  );

  const handleRateSelect = useCallback(
    (rate: number) => {
      const player = playerRef.current;
      if (!player) return;
      armLocalGuard(350);
      player.setPlaybackRate(rate);
      setPlaybackRate(rate);
      setOpenMenu(null);
      onRateEmit(rate, player.getCurrentTime());
    },
    [armLocalGuard, onRateEmit, playerRef]
  );

  const handleHlsLevelSelect = useCallback((levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setCurrentHlsLevel(levelIndex);
    }
    setOpenMenu(null);
  }, []);

  const toggleMute = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    const nextMuted = !isMuted;
    player.setMuted(nextMuted);
    setIsMuted(nextMuted);
    if (!nextMuted && volume === 0) {
      player.setVolume(0.75);
      setVolume(0.75);
    }
  }, [isMuted, playerRef, volume]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextVol = parseFloat(e.target.value);
      const player = playerRef.current;
      if (!player) return;
      player.setVolume(nextVol);
      setVolume(nextVol);
      if (nextVol > 0 && isMuted) {
        player.setMuted(false);
        setIsMuted(false);
      } else if (nextVol === 0 && !isMuted) {
        player.setMuted(true);
        setIsMuted(true);
      }
    },
    [isMuted, playerRef]
  );

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Fullscreen may be restricted in iframe
    }
  }, []);

  // Keyboard shortcuts (ignored when typing in inputs/textareas)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowleft':
          e.preventDefault();
          seekBy(-5);
          break;
        case 'arrowright':
          e.preventDefault();
          seekBy(5);
          break;
        case 'j':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'l':
          e.preventDefault();
          seekBy(10);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          void toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [seekBy, toggleFullscreen, toggleMute, togglePlay]);

  // Progress bar mouse/pointer scrubbing
  const computeTimeFromPointer = (clientX: number): { time: number; pct: number } => {
    const bar = progressBarRef.current;
    if (!bar || duration <= 0) return { time: 0, pct: 0 };
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return { time: pct * duration, pct: pct * 100 };
  };

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    const { time } = computeTimeFromPointer(e.clientX);
    setCurrentTime(time);
  };

  const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { time, pct } = computeTimeFromPointer(e.clientX);
    setHoverTime(duration > 0 ? time : null);
    setHoverPercent(pct);
    if (isScrubbing) {
      setCurrentTime(time);
    }
  };

  const handleProgressPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    setIsScrubbing(false);
    const { time } = computeTimeFromPointer(e.clientX);
    seekToPosition(time);
  };

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const currentQualityLabel =
    currentHlsLevel === -1
      ? 'Auto'
      : hlsLevels.find((l) => l.index === currentHlsLevel)?.label ?? 'Auto';

  if (!source) {
    return (
      <div className="aspect-video w-full rounded-xl bg-[#111115] border border-white/10 flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-7 h-7 text-amber-400 animate-spin mb-3" />
        <p className="text-sm font-medium text-zinc-200">Waiting for room stream</p>
        <p className="text-xs text-zinc-400 mt-1 max-w-sm">
          Connecting to the room host to receive the active video URL and live timestamp.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (isPlaying && !openMenu) setControlsVisible(false);
      }}
      className={`relative aspect-video w-full bg-black overflow-hidden select-none group ${
        isFullscreen ? 'rounded-none' : 'rounded-xl border border-white/10'
      }`}
    >
      {/* HTML5 / HLS Video Element */}
      {source.type !== 'youtube' && (
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          className="w-full h-full object-contain bg-black"
          onLoadedMetadata={() => {
            const vid = videoRef.current;
            if (!vid) return;
            setIsBuffering(false);
            if (Number.isFinite(vid.duration)) setDuration(vid.duration);
          }}
          onTimeUpdate={() => {
            const vid = videoRef.current;
            if (!vid || isScrubbing) return;
            setCurrentTime(vid.currentTime);
            if (Number.isFinite(vid.duration) && vid.duration > 0) {
              setDuration(vid.duration);
              if (vid.buffered.length > 0) {
                const end = vid.buffered.end(vid.buffered.length - 1);
                setBufferedRatio(Math.min(1, end / vid.duration));
              }
            }
          }}
          onWaiting={() => setIsBuffering(true)}
          onCanPlay={() => setIsBuffering(false)}
          onPlaying={() => {
            setIsBuffering(false);
            setIsPlaying(true);
            if (!isRemoteApplyingRef.current && !localControlGuardRef.current && videoRef.current) {
              onPlayEmit(videoRef.current.currentTime, videoRef.current.playbackRate);
            }
          }}
          onPause={() => {
            setIsPlaying(false);
            if (
              !isRemoteApplyingRef.current &&
              !localControlGuardRef.current &&
              videoRef.current &&
              !videoRef.current.ended
            ) {
              onPauseEmit(videoRef.current.currentTime);
            }
          }}
          onEnded={() => setIsPlaying(false)}
          onError={() => {
            setIsBuffering(false);
            if (source.type === 'mp4') {
              setMediaError('Failed to load this video URL. Check that the link is public and supports CORS.');
            }
          }}
        />
      )}

      {/* YouTube IFrame Mount */}
      {source.type === 'youtube' && (
        <div ref={ytContainerRef} className="w-full h-full pointer-events-none" />
      )}

      {/* Unified Click-Catcher Surface (toggles play/pause & double-click fullscreen) */}
      <div
        onClick={() => {
          if (openMenu) {
            setOpenMenu(null);
            return;
          }
          togglePlay();
        }}
        onDoubleClick={() => void toggleFullscreen()}
        className="absolute inset-0 z-10 cursor-pointer"
      />

      {/* Buffering Indicator */}
      {isBuffering && !mediaError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-black/25">
          <div className="p-3 rounded-full bg-black/70 border border-white/10">
            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
          </div>
        </div>
      )}

      {/* Browser Autoplay Policy Prompt */}
      {needsUserGesture && !mediaError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-xs">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClearUserGesture();
              const player = playerRef.current;
              if (player) {
                player.setMuted(false);
                setIsMuted(false);
                void Promise.resolve(player.play()).catch(() => {
                  // Fallback: mute and play if needed
                  player.setMuted(true);
                  setIsMuted(true);
                  void player.play();
                });
              }
              onManualResync();
            }}
            className="flex items-center gap-2.5 px-5 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition-colors shadow-lg cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Click to Join Live Playback</span>
          </button>
        </div>
      )}

      {/* Error State Overlay */}
      {mediaError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/90 p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-sm font-medium text-zinc-100 max-w-md">{mediaError}</p>
          <p className="text-xs text-zinc-400 mt-1.5">
            Try switching to another public .mp4, .m3u8, or YouTube URL.
          </p>
        </div>
      )}

      {/* Bottom Theater Control Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-200 bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-12 pb-3 px-4 ${
          controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Scrubbable Progress Timeline */}
        <div
          ref={progressBarRef}
          onPointerDown={handleProgressPointerDown}
          onPointerMove={handleProgressPointerMove}
          onPointerUp={handleProgressPointerUp}
          onPointerLeave={() => setHoverTime(null)}
          className="relative h-5 flex items-center cursor-pointer group/bar mb-1.5"
        >
          {hoverTime !== null && (
            <div
              style={{ left: `${Math.max(4, Math.min(96, hoverPercent))}%` }}
              className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-zinc-900 border border-white/15 text-[11px] font-mono tabular-nums text-zinc-100 pointer-events-none whitespace-nowrap"
            >
              {formatTime(hoverTime)}
            </div>
          )}
          <div className="w-full h-1 group-hover/bar:h-1.5 transition-all bg-white/20 rounded-full overflow-hidden relative">
            {/* Buffered */}
            <div
              style={{ width: `${bufferedRatio * 100}%` }}
              className="absolute inset-y-0 left-0 bg-white/30"
            />
            {/* Played */}
            <div
              style={{ width: `${progressPercent}%` }}
              className="absolute inset-y-0 left-0 bg-amber-500"
            />
          </div>
          {/* Scrubber thumb */}
          <div
            style={{ left: `${progressPercent}%` }}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-amber-400 opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none"
          />
        </div>

        {/* Control Buttons Row */}
        <div className="flex items-center justify-between gap-2">
          {/* Left Controls */}
          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-zinc-100 hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={() => seekBy(-10)}
              aria-label="Rewind 10 seconds"
              title="Rewind 10s (J)"
              className="p-2 min-w-[40px] min-h-[40px] hidden sm:flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => seekBy(10)}
              aria-label="Forward 10 seconds"
              title="Forward 10s (L)"
              className="p-2 min-w-[40px] min-h-[40px] hidden sm:flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-1 group/vol">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                title="Mute (M)"
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
                className="w-16 hidden md:block accent-amber-500 cursor-pointer h-1 bg-white/20 rounded-lg"
              />
            </div>

            {/* Timecode */}
            <div className="pl-2 text-xs font-mono tabular-nums text-zinc-200 whitespace-nowrap">
              <span>{formatTime(currentTime)}</span>
              <span className="text-zinc-500 mx-1">/</span>
              <span className="text-zinc-400">{duration > 0 ? formatTime(duration) : '--:--'}</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-1 relative shrink-0">
            <button
              type="button"
              onClick={onManualResync}
              title="Resync playback timestamp across room"
              className="px-2.5 py-1.5 min-h-[36px] flex items-center gap-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Resync</span>
            </button>

            {/* HLS Quality Selector */}
            {hlsLevels.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === 'quality' ? null : 'quality'))}
                  className="px-2.5 py-1.5 min-h-[36px] flex items-center gap-1 rounded-lg text-xs font-mono text-zinc-300 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>{currentQualityLabel}</span>
                </button>
                {openMenu === 'quality' && (
                  <div className="absolute right-0 bottom-11 w-32 py-1 rounded-lg bg-[#141419] border border-white/15 shadow-xl z-40">
                    <button
                      type="button"
                      onClick={() => handleHlsLevelSelect(-1)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/10 transition-colors cursor-pointer ${
                        currentHlsLevel === -1 ? 'text-amber-400 font-semibold' : 'text-zinc-300'
                      }`}
                    >
                      Auto
                    </button>
                    {hlsLevels.map((lvl) => (
                      <button
                        key={lvl.index}
                        type="button"
                        onClick={() => handleHlsLevelSelect(lvl.index)}
                        className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/10 transition-colors cursor-pointer ${
                          currentHlsLevel === lvl.index
                            ? 'text-amber-400 font-semibold'
                            : 'text-zinc-300'
                        }`}
                      >
                        {lvl.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Playback Speed Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu((m) => (m === 'speed' ? null : 'speed'))}
                className="px-2.5 py-1.5 min-h-[36px] rounded-lg text-xs font-mono tabular-nums text-zinc-300 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {playbackRate}x
              </button>
              {openMenu === 'speed' && (
                <div className="absolute right-0 bottom-11 w-24 py-1 rounded-lg bg-[#141419] border border-white/15 shadow-xl z-40">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => handleRateSelect(rate)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono tabular-nums hover:bg-white/10 transition-colors cursor-pointer ${
                        playbackRate === rate ? 'text-amber-400 font-semibold' : 'text-zinc-300'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theatre Mode */}
            {!isFullscreen && (
              <button
                type="button"
                onClick={onToggleTheatre}
                aria-label="Toggle wide theater layout"
                title="Toggle sidebar"
                className="p-2 min-w-[40px] min-h-[40px] hidden lg:flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer"
              >
                <RectangleHorizontal className="w-4 h-4" />
              </button>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title="Fullscreen (F)"
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

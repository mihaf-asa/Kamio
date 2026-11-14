import { MediaType, VideoSource } from '../types/watch';

export const ACCENT_COLORS = [
  '#F59E0B', // Amber
  '#38BDF8', // Sky
  '#34D399', // Emerald
  '#FB7185', // Rose
  '#A78BFA', // Violet
  '#FB923C', // Orange
  '#2DD4BF', // Teal
];

export function pickAccentColor(seed?: string): string {
  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return ACCENT_COLORS[hash % ACCENT_COLORS.length];
  }
  return ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)];
}

export interface SampleStream {
  label: string;
  formatLabel: string;
  url: string;
  description: string;
}

export const SAMPLE_STREAMS: SampleStream[] = [
  {
    label: 'Big Buck Bunny',
    formatLabel: 'MP4',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    description: '1080p direct HTML5 MP4 stream',
  },
  {
    label: 'Mux Test Stream',
    formatLabel: 'HLS .m3u8',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    description: 'Adaptive bitrate HLS stream via hls.js',
  },
  {
    label: 'Blender Open Movie',
    formatLabel: 'YouTube',
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    description: 'YouTube IFrame Player API sync',
  },
];

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const DIRECT_VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v', '.ogg', '.ogv'];

export function extractYouTubeId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0];
    return seg && YOUTUBE_ID_REGEX.test(seg) ? seg : null;
  }

  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    const vParam = parsed.searchParams.get('v');
    if (vParam && YOUTUBE_ID_REGEX.test(vParam)) {
      return vParam;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (
      segments.length >= 2 &&
      (segments[0] === 'embed' ||
        segments[0] === 'shorts' ||
        segments[0] === 'live' ||
        segments[0] === 'v')
    ) {
      return YOUTUBE_ID_REGEX.test(segments[1]) ? segments[1] : null;
    }
  }

  return null;
}

export function detectMediaType(rawUrl: string): MediaType | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (extractYouTubeId(trimmed)) {
    return 'youtube';
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const pathLower = parsed.pathname.toLowerCase();
  const fullLower = parsed.toString().toLowerCase();

  if (pathLower.endsWith('.m3u8') || fullLower.includes('.m3u8?')) {
    return 'hls';
  }

  if (DIRECT_VIDEO_EXTS.some((ext) => pathLower.endsWith(ext))) {
    return 'mp4';
  }

  return 'webpage';
}

export function parseVideoSource(rawUrl: string, forceDirectMp4 = false): VideoSource | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const ytId = extractYouTubeId(trimmed);
  if (ytId && !forceDirectMp4) {
    return {
      url: `https://www.youtube.com/watch?v=${ytId}`,
      type: 'youtube',
      youtubeId: ytId,
    };
  }

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProto);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  if (!parsed.hostname.includes('.')) {
    return null;
  }

  if (forceDirectMp4) {
    return {
      url: parsed.toString(),
      type: 'mp4',
    };
  }

  const type = detectMediaType(parsed.toString());
  if (!type) return null;

  return {
    url: parsed.toString(),
    type,
  };
}

export function getMediaTypeLabel(type: MediaType): string {
  switch (type) {
    case 'hls':
      return 'HLS Stream (.m3u8)';
    case 'youtube':
      return 'YouTube Video';
    case 'mp4':
      return 'Direct HTML5 Video';
    case 'webpage':
      return 'External Movie Webpage';
  }
}

export function getShortSourceLabel(source: VideoSource): string {
  if (source.type === 'youtube' && source.youtubeId) {
    return `youtube.com/watch?v=${source.youtubeId}`;
  }
  try {
    const parsed = new URL(source.url);
    const tail = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    const combined = `${parsed.hostname}${tail}`;
    return combined.length > 48 ? `${combined.slice(0, 45)}...` : combined;
  } catch {
    return source.url;
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRoomCode(): string {
  const part = (len: number) => {
    let out = '';
    const array = new Uint32Array(len);
    crypto.getRandomValues(array);
    for (let i = 0; i < len; i++) {
      out += ROOM_ALPHABET[array[i] % ROOM_ALPHABET.length];
    }
    return out;
  };
  return `${part(3)}-${part(4)}`;
}

export function extractRoomCodeFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.includes('://') || trimmed.startsWith('/') || trimmed.includes('?room=')) {
      const url = new URL(
        trimmed.startsWith('http') ? trimmed : `https://dummy.local/${trimmed.replace(/^\/+/, '')}`
      );
      const qRoom = url.searchParams.get('room');
      if (qRoom) return sanitizeRoomCode(qRoom);

      const match = url.pathname.match(/\/room\/([a-zA-Z0-9_-]+)/i);
      if (match?.[1]) return sanitizeRoomCode(match[1]);
    }
  } catch {
    // Fall through to raw room code parsing
  }

  return sanitizeRoomCode(trimmed);
}

export function sanitizeRoomCode(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (cleaned.length < 3 || cleaned.length > 32) return null;
  return cleaned;
}

export function buildInviteUrl(roomId: string): string {
  const url = new URL(window.location.origin);
  url.searchParams.set('room', roomId);
  return url.toString();
}

export function getRoomIdFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const queryRoom = params.get('room');
  if (queryRoom) {
    return sanitizeRoomCode(queryRoom);
  }
  const match = window.location.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)\/?$/i);
  if (match?.[1]) {
    return sanitizeRoomCode(match[1]);
  }
  return null;
}

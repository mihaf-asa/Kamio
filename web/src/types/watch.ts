export type MediaType = 'mp4' | 'hls' | 'youtube' | 'webpage';

export interface VideoSource {
  url: string;
  type: MediaType;
  youtubeId?: string;
  title?: string;
}

export interface HlsQualityLevel {
  index: number; // -1 for Auto
  label: string;
  height: number;
  bitrate: number;
}

export type PeerSyncStatus = 'synced' | 'paused' | 'drift';

export interface PeerParticipant {
  peerId: string;
  name: string;
  color: string;
  isHost: boolean;
  clientType?: 'web' | 'extension';
  joinedAt: number;
  rttMs?: number;
  syncStatus?: PeerSyncStatus;
  driftSeconds?: number;
  reportedTime?: number;
  reportedPlaying?: boolean;
  lastReportAt?: number;
}

export interface RoomFeedItem {
  id: string;
  kind: 'chat' | 'event' | 'reaction';
  senderId: string;
  senderName: string;
  senderColor?: string;
  text: string;
  timestamp: number;
}

export type ConnectionStatus =
  | 'idle'
  | 'initializing'
  | 'hosting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface PlayerHandle {
  play: () => Promise<void> | void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlaybackRate: () => number;
  isPlaying: () => boolean;
}

export type SyncMessage =
  | {
      type: 'peer:hello';
      peerId: string;
      name: string;
      color?: string;
      clientType?: 'web' | 'extension';
    }
  | {
      type: 'peer:rename';
      peerId: string;
      name: string;
      color?: string;
    }
  | {
      type: 'peer:status';
      peerId: string;
      isPlaying: boolean;
      currentTime: number;
      playbackRate: number;
      sentAt: number;
    }
  | {
      type: 'peer:list';
      participants: PeerParticipant[];
    }
  | {
      type: 'room:state';
      source: VideoSource | null;
      isPlaying: boolean;
      currentTime: number;
      playbackRate: number;
      sentAt: number;
      participants: PeerParticipant[];
      feed: RoomFeedItem[];
      seq: number;
    }
  | {
      type: 'playback:play';
      currentTime: number;
      playbackRate: number;
      sentAt: number;
      actorId: string;
      actorName: string;
      actorColor?: string;
      seq: number;
    }
  | {
      type: 'playback:pause';
      currentTime: number;
      sentAt: number;
      actorId: string;
      actorName: string;
      actorColor?: string;
      seq: number;
    }
  | {
      type: 'playback:seek';
      currentTime: number;
      isPlaying: boolean;
      sentAt: number;
      actorId: string;
      actorName: string;
      actorColor?: string;
      seq: number;
    }
  | {
      type: 'playback:rate';
      playbackRate: number;
      currentTime: number;
      sentAt: number;
      actorId: string;
      actorName: string;
      actorColor?: string;
      seq: number;
    }
  | {
      type: 'sync:force';
      isPlaying: boolean;
      currentTime: number;
      playbackRate: number;
      sentAt: number;
      actorId: string;
      actorName: string;
      seq: number;
    }
  | {
      type: 'media:change';
      source: VideoSource | null;
      sentAt: number;
      actorId: string;
      actorName: string;
      actorColor?: string;
      seq: number;
    }
  | {
      type: 'sync:heartbeat';
      isPlaying: boolean;
      currentTime: number;
      playbackRate: number;
      sentAt: number;
      seq: number;
    }
  | {
      type: 'sync:request';
      peerId: string;
    }
  | {
      type: 'chat:message';
      item: RoomFeedItem;
    }
  | {
      type: 'ping';
      sentAt: number;
    }
  | {
      type: 'pong';
      sentAt: number;
    };

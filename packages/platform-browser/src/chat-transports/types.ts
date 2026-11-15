import type { ChatMessage } from "@sidecut/core/live-chat";

export type TransportStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "quota";

export type ChatTransportListener = (message: ChatMessage) => void;
export type ChatStatusListener = (status: TransportStatus, error?: string) => void;

export type TwitchConfig = {
  channel: string;
};

export type YouTubeConfig = {
  apiKey: string;
  videoIdOrUrl: string;
};

export type KickConfig = {
  channelOrSlug: string;
  chatroomId?: number | undefined;
};

export type XConfig = Record<string, never>;

export type PlatformConfigs = {
  twitch: TwitchConfig;
  youtube: YouTubeConfig;
  kick: KickConfig;
  x: XConfig;
};

export interface ChatTransport<Config = unknown> {
  start(config: Config, onMessage: ChatTransportListener, onStatus: ChatStatusListener): () => void;
  stop(): void;
}

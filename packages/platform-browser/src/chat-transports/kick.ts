import type { ChatMessage } from "@sidecut/core/live-chat";
import type { ChatStatusListener, ChatTransport, ChatTransportListener, KickConfig } from "./types";

/**
 * Unofficial transport: Kick does not provide an official public OAuth chat API for client applications.
 * Public chat uses Kick's Pusher WebSocket endpoint.
 * Channel slug-to-chatroomId resolution uses Kick's web API, which browsers block via CORS and
 * requires the desktop app IPC handler or a manually entered numeric chatroom ID in standalone browsers.
 */

export interface KickPusherFrame {
  event: string;
  channel?: string;
  data: unknown;
}

export function parseKickPusherFrame(raw: string): KickPusherFrame | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.event !== "string") return null;
    let data = parsed.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        // Keep as string if not JSON
      }
    }
    return {
      event: parsed.event,
      channel: typeof parsed.channel === "string" ? parsed.channel : undefined,
      data,
    };
  } catch {
    return null;
  }
}

export function normalizeKickChatMessage(eventData: unknown): ChatMessage | null {
  if (!eventData || typeof eventData !== "object") return null;
  const data = eventData as Record<string, unknown>;
  const rawId = data.id;
  if (!rawId) return null;

  const id = String(rawId).slice(0, 100);
  const sender = (data.sender && typeof data.sender === "object" ? data.sender : {}) as Record<
    string,
    unknown
  >;
  const authorID = String(sender.id ?? "unknown").slice(0, 100);
  const author = String(sender.username ?? "Anonymous").slice(0, 100);
  const text = String(data.content ?? "").slice(0, 2000);

  let time = Date.now() / 1000;
  if (typeof data.created_at === "string") {
    const parsed = Date.parse(data.created_at);
    if (!Number.isNaN(parsed)) time = parsed / 1000;
  }

  return {
    id,
    provider: "kick",
    authorID: authorID || "unknown",
    author: author || "Anonymous",
    text,
    time,
    emotes: [],
  };
}

export class KickChatTransport implements ChatTransport<KickConfig> {
  private stopped = false;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1000;
  private seenIds = new Map<string, true>();

  constructor(
    private readonly resolveChatroom?: (
      slug: string,
    ) => Promise<{ chatroomId: number; channelSlug: string }>,
  ) {}

  start(
    config: KickConfig,
    onMessage: ChatTransportListener,
    onStatus: ChatStatusListener,
  ): () => void {
    this.stopped = false;
    this.backoffMs = 1000;
    this.seenIds.clear();

    void this.initAndConnect(config, onMessage, onStatus);

    return () => this.stop();
  }

  private async initAndConnect(
    config: KickConfig,
    onMessage: ChatTransportListener,
    onStatus: ChatStatusListener,
  ) {
    try {
      onStatus("connecting");
    } catch {}

    let chatroomId = config.chatroomId;

    if (!chatroomId) {
      const channelOrSlug = config.channelOrSlug.trim();
      if (!channelOrSlug) {
        onStatus("error", "Kick channel name or numeric chatroom ID required.");
        return;
      }

      if (/^\d+$/.test(channelOrSlug)) {
        chatroomId = Number.parseInt(channelOrSlug, 10);
      } else {
        // Needs resolution via desktop IPC or resolveChatroom function
        if (this.resolveChatroom) {
          try {
            const res = await this.resolveChatroom(channelOrSlug);
            chatroomId = res.chatroomId;
          } catch (err) {
            if (this.stopped) return;
            onStatus(
              "error",
              err instanceof Error
                ? err.message
                : `Failed to resolve Kick channel "${channelOrSlug}".`,
            );
            return;
          }
        } else {
          onStatus(
            "error",
            "Kick channel lookup needs the desktop app (or enter numeric chatroom ID).",
          );
          return;
        }
      }
    }

    if (this.stopped) return;

    const connect = () => {
      if (this.stopped) return;

      try {
        onStatus("connecting");
      } catch {}

      try {
        const url =
          "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false";
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
          if (this.stopped || this.ws !== ws) {
            ws.close();
            return;
          }
        };

        ws.onmessage = (event) => {
          if (this.stopped || this.ws !== ws) return;
          try {
            const raw = typeof event.data === "string" ? event.data : "";
            const frame = parseKickPusherFrame(raw);
            if (!frame) return;

            if (frame.event === "pusher:connection_established") {
              // Subscribe to chatroom channel
              const subMsg = JSON.stringify({
                event: "pusher:subscribe",
                data: {
                  auth: "",
                  channel: `chatrooms.${chatroomId}.v2`,
                },
              });
              ws.send(subMsg);
              this.backoffMs = 1000;
              onStatus("connected");
              return;
            }

            if (frame.event === "pusher:ping") {
              ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
              return;
            }

            if (frame.event === "App\\Events\\ChatMessageEvent") {
              const msg = normalizeKickChatMessage(frame.data);
              if (msg) {
                if (this.seenIds.has(msg.id)) return;
                this.seenIds.set(msg.id, true);
                if (this.seenIds.size > 1000) {
                  const oldest = this.seenIds.keys().next().value;
                  if (oldest) this.seenIds.delete(oldest);
                }
                onMessage(msg);
              }
            }
          } catch (err) {
            console.warn("Error processing Kick message:", err);
          }
        };

        ws.onerror = (err) => {
          console.warn("Kick Pusher websocket error:", err);
        };

        ws.onclose = () => {
          if (this.stopped || this.ws !== ws) return;
          this.ws = null;
          try {
            onStatus("reconnecting");
          } catch {}
          this.scheduleReconnect(connect);
        };
      } catch (err) {
        console.warn("Kick connection error:", err);
        if (!this.stopped) {
          try {
            onStatus("reconnecting");
          } catch {}
          this.scheduleReconnect(connect);
        }
      }
    };

    connect();
  }

  private scheduleReconnect(connect: () => void) {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.backoffMs;
    this.backoffMs = Math.min(30000, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      connect();
    }, delay);
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

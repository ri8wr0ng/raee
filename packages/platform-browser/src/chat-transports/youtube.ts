import type { ChatMessage } from "@sidecut/core/live-chat";
import type {
  ChatStatusListener,
  ChatTransport,
  ChatTransportListener,
  YouTubeConfig,
} from "./types";

export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const match = url.pathname.match(/\/(?:live|embed|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (match?.[1]) return match[1];
    } else if (url.hostname === "youtu.be") {
      const match = url.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
      if (match?.[1]) return match[1];
    }
  } catch {
    // Regex fallback if URL constructor fails
    const match = trimmed.match(
      /(?:v=|\/live\/|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    );
    if (match?.[1]) return match[1];
  }
  return null;
}

export function calculateNextYouTubeInterval(
  baseIntervalMillis: number,
  emptyPageCount: number,
): number {
  const base = Math.max(5000, baseIntervalMillis || 5000);
  if (emptyPageCount < 3) return base;
  // Stretch interval after several empty pages up to 30s
  const stretch = Math.min(30000, base + (emptyPageCount - 2) * 5000);
  return stretch;
}

export function isYouTubeQuotaError(status: number, body: unknown): boolean {
  if (status === 403) {
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error?: { errors?: Array<{ reason?: string }>; message?: string } })
        .error;
      if (err?.errors?.some((e) => e.reason === "quotaExceeded")) return true;
      if (typeof err?.message === "string" && err.message.toLowerCase().includes("quota"))
        return true;
    }
    return true;
  }
  return false;
}

export function normalizeYouTubeMessage(item: unknown): ChatMessage | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 100) : "";
  if (!id) return null;

  const snippet = (raw.snippet && typeof raw.snippet === "object" ? raw.snippet : {}) as Record<
    string,
    unknown
  >;
  const authorDetails = (
    raw.authorDetails && typeof raw.authorDetails === "object" ? raw.authorDetails : {}
  ) as Record<string, unknown>;

  const author = (
    typeof authorDetails.displayName === "string" ? authorDetails.displayName : "Anonymous"
  ).slice(0, 100);
  const authorID = (
    typeof authorDetails.channelId === "string" ? authorDetails.channelId : "unknown"
  ).slice(0, 100);
  const textDetails = (
    snippet.textMessageDetails && typeof snippet.textMessageDetails === "object"
      ? snippet.textMessageDetails
      : {}
  ) as Record<string, unknown>;
  const text = (
    typeof snippet.displayMessage === "string"
      ? snippet.displayMessage
      : typeof textDetails.messageText === "string"
        ? textDetails.messageText
        : ""
  ).slice(0, 2000);

  let time = Date.now() / 1000;
  if (typeof snippet.publishedAt === "string") {
    const parsed = Date.parse(snippet.publishedAt);
    if (!Number.isNaN(parsed)) time = parsed / 1000;
  }

  return {
    id,
    provider: "youtube",
    authorID: authorID || "unknown",
    author: author || "Anonymous",
    text,
    time,
    emotes: [],
  };
}

export class YouTubeChatTransport implements ChatTransport<YouTubeConfig> {
  private stopped = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private seenIds = new Map<string, true>();

  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  start(
    config: YouTubeConfig,
    onMessage: ChatTransportListener,
    onStatus: ChatStatusListener,
  ): () => void {
    this.stopped = false;
    this.seenIds.clear();

    const videoId = extractYouTubeVideoId(config.videoIdOrUrl);
    const apiKey = config.apiKey.trim();

    if (!videoId) {
      try {
        onStatus("error", "Valid YouTube video URL or ID required.");
      } catch {}
      return () => this.stop();
    }
    if (!apiKey) {
      try {
        onStatus("error", "YouTube Data API v3 key required.");
      } catch {}
      return () => this.stop();
    }

    void this.run(apiKey, videoId, onMessage, onStatus);

    return () => this.stop();
  }

  private async run(
    apiKey: string,
    videoId: string,
    onMessage: ChatTransportListener,
    onStatus: ChatStatusListener,
  ) {
    try {
      onStatus("connecting");
    } catch {}

    // Resolve activeLiveChatId
    let activeLiveChatId: string | null = null;
    try {
      this.abortController = new AbortController();
      const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
      const response = await this.fetchFn(videoUrl, { signal: this.abortController.signal });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (isYouTubeQuotaError(response.status, body)) {
          onStatus("quota", "YouTube API quota exceeded.");
          return;
        }
        onStatus("error", `YouTube API request failed (${response.status}).`);
        return;
      }

      const data = (await response.json()) as {
        items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
      };
      activeLiveChatId = data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
      if (!activeLiveChatId) {
        onStatus("error", "No active live chat found for this YouTube stream.");
        return;
      }
    } catch (err) {
      if (this.stopped) return;
      onStatus("error", err instanceof Error ? err.message : "Failed to resolve live chat.");
      return;
    }

    if (this.stopped) return;

    try {
      onStatus("connected");
    } catch {}

    let nextPageToken: string | undefined;
    let emptyPageCount = 0;
    let backoffMs = 1000;

    const poll = async () => {
      if (this.stopped) return;
      try {
        this.abortController = new AbortController();
        const chatUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet,authorDetails&liveChatId=${encodeURIComponent(activeLiveChatId!)}&key=${encodeURIComponent(apiKey)}${nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : ""}`;
        const response = await this.fetchFn(chatUrl, { signal: this.abortController.signal });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (isYouTubeQuotaError(response.status, body)) {
            onStatus("quota", "YouTube API quota exceeded.");
            this.stop();
            return;
          }
          onStatus("reconnecting", `Poll error (${response.status}), retrying...`);
          this.scheduleNext(poll, backoffMs);
          backoffMs = Math.min(30000, backoffMs * 2);
          return;
        }

        onStatus("connected");
        backoffMs = 1000;
        const data = (await response.json()) as {
          nextPageToken?: string;
          pollingIntervalMillis?: number;
          items?: unknown[];
        };

        nextPageToken = data.nextPageToken;
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) {
          emptyPageCount++;
        } else {
          emptyPageCount = 0;
          for (const item of items) {
            const msg = normalizeYouTubeMessage(item);
            if (msg) {
              if (this.seenIds.has(msg.id)) continue;
              this.seenIds.set(msg.id, true);
              if (this.seenIds.size > 1000) {
                const oldest = this.seenIds.keys().next().value;
                if (oldest) this.seenIds.delete(oldest);
              }
              onMessage(msg);
            }
          }
        }

        const interval = calculateNextYouTubeInterval(
          data.pollingIntervalMillis ?? 5000,
          emptyPageCount,
        );
        this.scheduleNext(poll, interval);
      } catch (err) {
        if (this.stopped) return;
        console.warn("YouTube poll error:", err);
        onStatus("reconnecting", "Network error, retrying...");
        this.scheduleNext(poll, backoffMs);
        backoffMs = Math.min(30000, backoffMs * 2);
      }
    };

    void poll();
  }

  private scheduleNext(poll: () => Promise<void>, delay: number) {
    if (this.stopped) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void poll();
    }, delay);
  }

  stop() {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }
  }
}

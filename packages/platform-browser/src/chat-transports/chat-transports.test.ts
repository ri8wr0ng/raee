import { describe, expect, it, vi } from "vite-plus/test";
import {
  parseIrcTags,
  unescapeIrcTagValue,
  parseTwitchEmotes,
  parseTwitchIrcLine,
  normalizeTwitchMessage,
} from "./twitch";
import {
  extractYouTubeVideoId,
  calculateNextYouTubeInterval,
  isYouTubeQuotaError,
  normalizeYouTubeMessage,
  YouTubeChatTransport,
} from "./youtube";
import { parseKickPusherFrame, normalizeKickChatMessage } from "./kick";

describe("Twitch IRC parser and normalizer", () => {
  it("unescapes IRCv3 tag values correctly", () => {
    expect(unescapeIrcTagValue("hello\\sworld")).toBe("hello world");
    expect(unescapeIrcTagValue("foo\\:bar")).toBe("foo;bar");
    expect(unescapeIrcTagValue("c\\\\path")).toBe("c\\path");
    expect(unescapeIrcTagValue("line1\\rline2\\nline3")).toBe("line1\rline2\nline3");
    expect(unescapeIrcTagValue("plain text")).toBe("plain text");
  });

  it("parses IRC tag dictionaries with unescaping", () => {
    const raw = "badge-info=;color=#FF0000;display-name=Test\\sUser;emotes=25:0-4;id=msg-123";
    const tags = parseIrcTags(raw);
    expect(tags["badge-info"]).toBe("");
    expect(tags["color"]).toBe("#FF0000");
    expect(tags["display-name"]).toBe("Test User");
    expect(tags["emotes"]).toBe("25:0-4");
    expect(tags["id"]).toBe("msg-123");
  });

  it("parses Twitch emotes, converts inclusive to exclusive slice ranges, and sorts them non-overlapping", () => {
    const text = "Kappa hello Kappa world Keepo";
    // Kappa at 0-4 (len 5) and 12-16 (len 5). Keepo at 24-28 (len 5).
    // Send them out of order with overlapping/invalid ranges
    const rawEmotes = "1902:24-28/25:12-16,0-4";
    const emotes = parseTwitchEmotes(rawEmotes, text);

    expect(emotes).toHaveLength(3);
    expect(emotes[0]).toEqual({ start: 0, end: 5, text: "Kappa" });
    expect(emotes[1]).toEqual({ start: 12, end: 17, text: "Kappa" });
    expect(emotes[2]).toEqual({ start: 24, end: 29, text: "Keepo" });
  });

  it("discards overlapping emote ranges to guarantee LiveChat validity", () => {
    const text = "1234567890";
    // 0-4 and 3-7 overlap
    const rawEmotes = "1:0-4/2:3-7";
    const emotes = parseTwitchEmotes(rawEmotes, text);
    expect(emotes).toHaveLength(1);
    expect(emotes[0]).toEqual({ start: 0, end: 5, text: "12345" });
  });

  it("parses full Twitch IRC PRIVMSG lines into normalized ChatMessage", () => {
    const line =
      "@badge-info=;badges=broadcaster/1;color=#00FF7F;display-name=CoolStreamer;emotes=25:6-10;id=123-abc;mod=0;room-id=12345;subscriber=0;tmi-sent-ts=1699999999000;turbo=0;user-id=98765;user-type= :coolstreamer!coolstreamer@coolstreamer.tmi.twitch.tv PRIVMSG #coolstreamer :Hello Kappa world";
    const msg = normalizeTwitchMessage(line);
    expect(msg).not.toBeNull();
    expect(msg).toEqual({
      id: "123-abc",
      provider: "twitch",
      authorID: "98765",
      author: "CoolStreamer",
      text: "Hello Kappa world",
      time: 1699999999,
      emotes: [{ start: 6, end: 11, text: "Kappa" }],
    });
  });

  it("handles Twitch messages with fallback display-name and user-id", () => {
    const line = ":user123!user123@user123.tmi.twitch.tv PRIVMSG #chan :Just a test";
    const msg = normalizeTwitchMessage(line);
    expect(msg).not.toBeNull();
    expect(msg?.author).toBe("user123");
    expect(msg?.authorID).toBe("user123");
    expect(msg?.text).toBe("Just a test");
    expect(msg?.emotes).toEqual([]);
  });

  it("parses IRC PING and command lines", () => {
    const ping = parseTwitchIrcLine("PING :tmi.twitch.tv");
    expect(ping).toEqual({
      tags: {},
      prefix: "",
      command: "PING",
      params: ["tmi.twitch.tv"],
    });
  });
});

describe("YouTube video ID extraction, interval/backoff logic, and normalization", () => {
  it("extracts video ID from multiple YouTube URL forms and bare IDs", () => {
    expect(extractYouTubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("")).toBeNull();
    expect(extractYouTubeVideoId("not_an_id")).toBeNull();
  });

  it("calculates next interval honoring 5s floor and stretching after empty pages", () => {
    // Floor of 5000ms
    expect(calculateNextYouTubeInterval(1000, 0)).toBe(5000);
    expect(calculateNextYouTubeInterval(8000, 0)).toBe(8000);

    // Empty pages < 3 don't stretch
    expect(calculateNextYouTubeInterval(5000, 1)).toBe(5000);
    expect(calculateNextYouTubeInterval(5000, 2)).toBe(5000);

    // Empty pages >= 3 stretch
    expect(calculateNextYouTubeInterval(5000, 3)).toBe(10000);
    expect(calculateNextYouTubeInterval(5000, 4)).toBe(15000);
    expect(calculateNextYouTubeInterval(5000, 10)).toBe(30000); // capped at 30s
  });

  it("detects quotaExceeded errors from status 403 and body", () => {
    expect(isYouTubeQuotaError(403, { error: { errors: [{ reason: "quotaExceeded" }] } })).toBe(
      true,
    );
    expect(isYouTubeQuotaError(403, { error: { message: "Quota exceeded for project" } })).toBe(
      true,
    );
    expect(isYouTubeQuotaError(403, null)).toBe(true);
    expect(isYouTubeQuotaError(400, { error: { message: "Bad Request" } })).toBe(false);
    expect(isYouTubeQuotaError(500, null)).toBe(false);
  });

  it("normalizes YouTube chat items into LiveChat message shape", () => {
    const item = {
      id: "LCC.1234567890",
      snippet: {
        type: "textMessageEvent",
        publishedAt: "2026-11-15T12:00:00.000Z",
        displayMessage: "Hello from YouTube!",
      },
      authorDetails: {
        channelId: "UC123456789",
        displayName: "YT Viewer",
      },
    };
    const msg = normalizeYouTubeMessage(item);
    expect(msg).toEqual({
      id: "LCC.1234567890",
      provider: "youtube",
      authorID: "UC123456789",
      author: "YT Viewer",
      text: "Hello from YouTube!",
      time: Date.parse("2026-11-15T12:00:00.000Z") / 1000,
      emotes: [],
    });
  });
});

describe("Kick Pusher frame parsing and message normalization", () => {
  it("parses Kick Pusher frames with JSON or stringified data", () => {
    const raw = JSON.stringify({
      event: "App\\Events\\ChatMessageEvent",
      channel: "chatrooms.12345.v2",
      data: JSON.stringify({
        id: "kick-msg-1",
        content: "Hello Kick!",
        sender: { id: 99, username: "KickUser" },
      }),
    });
    const frame = parseKickPusherFrame(raw);
    expect(frame).not.toBeNull();
    expect(frame?.event).toBe("App\\Events\\ChatMessageEvent");
    expect(frame?.channel).toBe("chatrooms.12345.v2");
    expect(frame?.data).toEqual({
      id: "kick-msg-1",
      content: "Hello Kick!",
      sender: { id: 99, username: "KickUser" },
    });
  });

  it("normalizes Kick chat message events into LiveChat message shape", () => {
    const eventData = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      chatroom_id: 12345,
      content: "Let's go!",
      created_at: "2026-11-15T14:30:00.000Z",
      sender: {
        id: 778899,
        username: "GreenStreamer",
        slug: "greenstreamer",
      },
    };
    const msg = normalizeKickChatMessage(eventData);
    expect(msg).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
      provider: "kick",
      authorID: "778899",
      author: "GreenStreamer",
      text: "Let's go!",
      time: Date.parse("2026-11-15T14:30:00.000Z") / 1000,
      emotes: [],
    });
  });
});

describe("YouTube transport quota discipline", () => {
  it("never retries a failed chat page sooner than five seconds", async () => {
    vi.useFakeTimers();
    try {
      const calls: number[] = [];
      const fetchFn = (async (url: string) => {
        calls.push(Date.now());
        if (String(url).includes("/videos?"))
          return new Response(
            JSON.stringify({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat" } }] }),
          );
        throw new TypeError("network down");
      }) as unknown as typeof fetch;
      const stop = new YouTubeChatTransport(fetchFn).start(
        { apiKey: "key", videoIdOrUrl: "dQw4w9WgXcQ" },
        () => {},
        () => {},
      );
      await vi.advanceTimersByTimeAsync(20_000);
      stop();
      const pages = calls.slice(1);
      expect(pages.length).toBeGreaterThan(1);
      for (let i = 1; i < pages.length; i++)
        expect(pages[i]! - pages[i - 1]!).toBeGreaterThanOrEqual(5000);
    } finally {
      vi.useRealTimers();
    }
  });
});

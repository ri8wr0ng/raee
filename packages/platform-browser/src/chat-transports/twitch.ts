import type { ChatMessage } from "@raee/core/live-chat";
import type {
  ChatStatusListener,
  ChatTransport,
  ChatTransportListener,
  TwitchConfig,
} from "./types";

export function unescapeIrcTagValue(val: string): string {
  let result = "";
  for (let i = 0; i < val.length; i++) {
    if (val[i] === "\\" && i + 1 < val.length) {
      i++;
      const next = val[i];
      if (next === ":") result += ";";
      else if (next === "s") result += " ";
      else if (next === "\\") result += "\\";
      else if (next === "r") result += "\r";
      else if (next === "n") result += "\n";
      else result += next;
    } else {
      result += val[i];
    }
  }
  return result;
}

export function parseIrcTags(tagsStr: string): Record<string, string> {
  const tags: Record<string, string> = {};
  if (!tagsStr) return tags;
  const parts = tagsStr.split(";");
  for (const part of parts) {
    if (!part) continue;
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) {
      tags[part] = "";
    } else {
      const key = part.slice(0, eqIdx);
      const val = part.slice(eqIdx + 1);
      tags[key] = unescapeIrcTagValue(val);
    }
  }
  return tags;
}

export function parseTwitchEmotes(
  emotesTag: string,
  text: string,
): Array<{ start: number; end: number; text: string }> {
  if (!emotesTag || !text) return [];
  const parsedEmotes: Array<{ start: number; end: number; text: string }> = [];
  const groups = emotesTag.split("/");
  for (const group of groups) {
    if (!group) continue;
    const colonIdx = group.indexOf(":");
    if (colonIdx === -1) continue;
    const rangesStr = group.slice(colonIdx + 1);
    const ranges = rangesStr.split(",");
    for (const range of ranges) {
      const [sStr, eStr] = range.split("-");
      if (!sStr || !eStr) continue;
      const start = Number.parseInt(sStr, 10);
      const endInclusive = Number.parseInt(eStr, 10);
      if (Number.isNaN(start) || Number.isNaN(endInclusive)) continue;
      const end = endInclusive + 1;
      if (start >= 0 && end > start && end <= text.length) {
        const emoteText = text.slice(start, end);
        if (emoteText.length >= 1 && emoteText.length <= 100) {
          parsedEmotes.push({ start, end, text: emoteText });
        }
      }
    }
  }

  // Sort by start index ascending
  parsedEmotes.sort((a, b) => a.start - b.start || a.end - b.end);

  // Filter overlapping ranges (LiveChat requires start >= previous end)
  const nonOverlapping: Array<{ start: number; end: number; text: string }> = [];
  let lastEnd = 0;
  for (const emote of parsedEmotes) {
    if (emote.start >= lastEnd) {
      nonOverlapping.push(emote);
      lastEnd = emote.end;
    }
  }

  return nonOverlapping.slice(0, 100);
}

export interface TwitchIrcParsedLine {
  tags: Record<string, string>;
  prefix: string;
  command: string;
  params: string[];
}

export function parseTwitchIrcLine(rawLine: string): TwitchIrcParsedLine | null {
  const line = rawLine.trim();
  if (!line) return null;
  let idx = 0;
  const tags: Record<string, string> = {};

  if (line.startsWith("@")) {
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx === -1) return null;
    const rawTags = line.slice(1, spaceIdx);
    Object.assign(tags, parseIrcTags(rawTags));
    idx = spaceIdx + 1;
    while (idx < line.length && line[idx] === " ") idx++;
  }

  let prefix = "";
  if (line[idx] === ":") {
    const spaceIdx = line.indexOf(" ", idx);
    if (spaceIdx === -1) return null;
    prefix = line.slice(idx + 1, spaceIdx);
    idx = spaceIdx + 1;
    while (idx < line.length && line[idx] === " ") idx++;
  }

  const spaceAfterCmd = line.indexOf(" ", idx);
  let command = "";
  if (spaceAfterCmd === -1) {
    command = line.slice(idx);
    return { tags, prefix, command, params: [] };
  }
  command = line.slice(idx, spaceAfterCmd);
  idx = spaceAfterCmd + 1;
  while (idx < line.length && line[idx] === " ") idx++;

  const params: string[] = [];
  while (idx < line.length) {
    if (line[idx] === ":") {
      params.push(line.slice(idx + 1));
      break;
    }
    const nextSpace = line.indexOf(" ", idx);
    if (nextSpace === -1) {
      params.push(line.slice(idx));
      break;
    }
    params.push(line.slice(idx, nextSpace));
    idx = nextSpace + 1;
    while (idx < line.length && line[idx] === " ") idx++;
  }

  return { tags, prefix, command, params };
}

export function normalizeTwitchMessage(line: string): ChatMessage | null {
  const parsed = parseTwitchIrcLine(line);
  if (!parsed || parsed.command !== "PRIVMSG") return null;

  const nick = parsed.prefix.includes("!")
    ? parsed.prefix.slice(0, parsed.prefix.indexOf("!"))
    : parsed.prefix;

  const text = parsed.params[parsed.params.length - 1] ?? "";
  const author = (parsed.tags["display-name"] || nick || "Anonymous").slice(0, 100);
  const authorID = (parsed.tags["user-id"] || nick || "unknown").slice(0, 100);
  const id = (
    parsed.tags["id"] || `tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  ).slice(0, 100);

  let time = Date.now() / 1000;
  if (parsed.tags["tmi-sent-ts"]) {
    const ts = Number(parsed.tags["tmi-sent-ts"]);
    if (Number.isFinite(ts) && ts > 0) time = ts / 1000;
  }

  const emotes = parseTwitchEmotes(parsed.tags["emotes"] || "", text);

  return {
    id,
    provider: "twitch",
    authorID,
    author,
    text: text.slice(0, 2000),
    time,
    emotes,
  };
}

export class TwitchChatTransport implements ChatTransport<TwitchConfig> {
  private stopped = false;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1000;
  private seenIds = new Map<string, true>();

  start(
    config: TwitchConfig,
    onMessage: ChatTransportListener,
    onStatus: ChatStatusListener,
  ): () => void {
    this.stopped = false;
    this.backoffMs = 1000;
    this.seenIds.clear();

    const channel = config.channel.trim().toLowerCase().replace(/^#/, "");
    if (!channel) {
      try {
        onStatus("error", "Twitch channel name required.");
      } catch {}
      return () => this.stop();
    }

    const connect = () => {
      if (this.stopped) return;

      try {
        onStatus("connecting");
      } catch {}

      try {
        const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
        this.ws = ws;

        ws.onopen = () => {
          if (this.stopped || this.ws !== ws) {
            ws.close();
            return;
          }
          try {
            ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
            ws.send("PASS SCHMOOPIIE\r\n");
            const randomNick = `justinfan${Math.floor(10000 + Math.random() * 90000)}`;
            ws.send(`NICK ${randomNick}\r\n`);
            ws.send(`JOIN #${channel}\r\n`);
            this.backoffMs = 1000;
            onStatus("connected");
          } catch (err) {
            console.warn("Twitch chat websocket send error:", err);
          }
        };

        ws.onmessage = (event) => {
          if (this.stopped || this.ws !== ws) return;
          try {
            const raw = typeof event.data === "string" ? event.data : "";
            const lines = raw.split(/\r\n|\r|\n/);
            for (const line of lines) {
              if (!line) continue;
              if (line.startsWith("PING")) {
                const spaceIdx = line.indexOf(" ");
                const param = spaceIdx !== -1 ? line.slice(spaceIdx + 1) : ":tmi.twitch.tv";
                try {
                  ws.send(`PONG ${param}\r\n`);
                } catch {}
                continue;
              }
              const msg = normalizeTwitchMessage(line);
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
          } catch (err) {
            console.warn("Error processing Twitch message:", err);
          }
        };

        ws.onerror = (err) => {
          console.warn("Twitch chat websocket error:", err);
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
        console.warn("Twitch chat connection failed:", err);
        if (!this.stopped) {
          try {
            onStatus("reconnecting");
          } catch {}
          this.scheduleReconnect(connect);
        }
      }
    };

    connect();

    return () => this.stop();
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

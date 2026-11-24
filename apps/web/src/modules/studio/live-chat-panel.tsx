import { useState, useRef, useEffect, useMemo } from "react";
import type { ChatProvider } from "@raee/core/live-chat";
import { Button } from "@raee/ui/components/button";
import { Input } from "@raee/ui/components/input";
import {
  RiTwitchFill,
  RiYoutubeFill,
  RiTwitterXFill,
  RiArrowDownLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiEyeOffLine,
  RiBroadcastLine,
  RiStarFill,
  RiSettings3Line,
} from "@remixicon/react";
import type { LiveChatController } from "./live-chat-controller";
import type { TransportStatus } from "@raee/platform-browser/chat-transports";

function KickIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4 3h5v5h3v2h2V8h6V3h-4v2h-2V3h-2v2H9V3H4v18h5v-2h2v2h2v-2h2v2h4v-5h-6v-2h-2v2H9v-5h5V8h-2V5H9v3H4V3z" />
    </svg>
  );
}

const PROVIDER_INFO: Record<
  ChatProvider,
  {
    name: string;
    icon: typeof RiTwitchFill | typeof KickIcon;
    color: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  twitch: {
    name: "Twitch",
    icon: RiTwitchFill,
    color: "#9146FF",
    badgeBg: "bg-purple-500/15",
    badgeText: "text-purple-400",
  },
  youtube: {
    name: "YouTube",
    icon: RiYoutubeFill,
    color: "#FF0000",
    badgeBg: "bg-red-500/15",
    badgeText: "text-red-400",
  },
  kick: {
    name: "Kick",
    icon: KickIcon,
    color: "#53FC18",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-400",
  },
  x: {
    name: "X",
    icon: RiTwitterXFill,
    color: "#E7E9EA",
    badgeBg: "bg-neutral-500/15",
    badgeText: "text-neutral-400",
  },
};

const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-purple-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-indigo-600",
  "bg-teal-600",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index] ?? "bg-blue-600";
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0];
  const second = parts[1];
  if (first && second && first.length > 0 && second.length > 0) {
    const c1 = first.charAt(0);
    const c2 = second.charAt(0);
    return (c1 + c2).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function StatusDot({ status }: { status: TransportStatus }) {
  switch (status) {
    case "connected":
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
          title="Connected"
        />
      );
    case "connecting":
    case "reconnecting":
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"
          title={status === "connecting" ? "Connecting…" : "Reconnecting…"}
        />
      );
    case "quota":
      return (
        <span className="inline-block w-2 h-2 rounded-full bg-orange-500" title="Quota exceeded" />
      );
    case "error":
      return <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="Error" />;
    case "disconnected":
    default:
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30"
          title="Disconnected"
        />
      );
  }
}

export function LiveChatPanel({
  mode,
  controller,
}: {
  mode: "record" | "live" | "both";
  controller: LiveChatController;
}) {
  const [collapsed, setCollapsed] = useState(mode === "record");
  const [platformsOpen, setPlatformsOpen] = useState(false);

  // Auto-expand when switching to live or both
  useEffect(() => {
    if (mode !== "record") {
      setCollapsed(false);
    }
  }, [mode]);

  const {
    messages,
    status,
    errors,
    configs,
    highlightedId,
    connect,
    disconnect,
    toggleHighlight,
    hide,
    setConfig,
  } = controller;

  const connectedCount = useMemo(
    () => Object.values(status).filter((s) => s === "connected").length,
    [status],
  );

  const feedRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setUnreadCount(0);
    }
  };

  const lastSeenId = useRef<string | null>(null);
  const newestId = messages.at(-1)?.id ?? null;
  useEffect(() => {
    const el = feedRef.current;
    const previous = lastSeenId.current;
    lastSeenId.current = newestId;
    if (!el || newestId === previous) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const from = previous ? messages.findIndex((item) => item.id === previous) : -1;
    const added = from >= 0 ? messages.length - 1 - from : 1;
    if (added > 0) setUnreadCount((prev) => prev + added);
  }, [newestId, messages]);

  const scrollToBottom = () => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    isAtBottomRef.current = true;
    setUnreadCount(0);
  };

  return (
    <section className="studio-section" aria-label="Live chat">
      <header className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-base">Chat</h3>
          {connectedCount > 0 ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
              {connectedCount} live
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              Offline
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            onClick={() => setPlatformsOpen((prev) => !prev)}
            title="Configure chat platforms"
          >
            <RiSettings3Line className="w-3.5 h-3.5" />
            <span>Platforms</span>
          </Button>
          {mode === "record" && (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setCollapsed((prev) => !prev)}
              aria-label={collapsed ? "Expand chat" : "Collapse chat"}
            >
              {collapsed ? <RiArrowDownSLine /> : <RiArrowUpSLine />}
            </Button>
          )}
        </div>
      </header>

      {/* When collapsed in record mode */}
      {collapsed ? (
        <p className="text-xs text-muted-foreground italic py-1">
          Chat collapsed in record mode. Click expand to open.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Platforms configuration rows */}
          {platformsOpen && (
            <div className="p-3 rounded-lg border border-border bg-card/60 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Connected Platforms
              </div>

              {/* Twitch */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusDot status={status.twitch} />
                  <RiTwitchFill className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="text-xs font-medium w-16">Twitch</span>
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="Channel name (e.g. shroud)"
                    value={configs.twitch.channel}
                    disabled={status.twitch === "connected" || status.twitch === "connecting"}
                    onChange={(e) => setConfig("twitch", { channel: e.target.value })}
                  />
                  {status.twitch === "connected" || status.twitch === "connecting" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      onClick={() => disconnect("twitch")}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs shrink-0"
                      disabled={!configs.twitch.channel.trim()}
                      onClick={() => connect("twitch")}
                    >
                      Connect
                    </Button>
                  )}
                </div>
                {errors.twitch && <p className="text-[11px] text-red-400 pl-6">{errors.twitch}</p>}
              </div>

              {/* YouTube */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusDot status={status.youtube} />
                  <RiYoutubeFill className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-xs font-medium w-16">YouTube</span>
                  <div className="flex-1 grid grid-cols-2 gap-1.5">
                    <Input
                      type="password"
                      className="h-7 text-xs"
                      placeholder="API Key"
                      value={configs.youtube.apiKey}
                      disabled={status.youtube === "connected" || status.youtube === "connecting"}
                      onChange={(e) => setConfig("youtube", { apiKey: e.target.value })}
                    />
                    <Input
                      className="h-7 text-xs"
                      placeholder="Live URL or Video ID"
                      value={configs.youtube.videoIdOrUrl}
                      disabled={status.youtube === "connected" || status.youtube === "connecting"}
                      onChange={(e) => setConfig("youtube", { videoIdOrUrl: e.target.value })}
                    />
                  </div>
                  {status.youtube === "connected" || status.youtube === "connecting" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      onClick={() => disconnect("youtube")}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs shrink-0"
                      disabled={
                        !configs.youtube.apiKey.trim() || !configs.youtube.videoIdOrUrl.trim()
                      }
                      onClick={() => connect("youtube")}
                    >
                      Connect
                    </Button>
                  )}
                </div>
                {errors.youtube && (
                  <p className="text-[11px] text-red-400 pl-6">{errors.youtube}</p>
                )}
              </div>

              {/* Kick */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusDot status={status.kick} />
                  <KickIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-xs font-medium w-16">Kick</span>
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="Channel slug or numeric chatroom ID"
                    value={configs.kick.channelOrSlug}
                    disabled={status.kick === "connected" || status.kick === "connecting"}
                    onChange={(e) => setConfig("kick", { channelOrSlug: e.target.value })}
                  />
                  {status.kick === "connected" || status.kick === "connecting" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      onClick={() => disconnect("kick")}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs shrink-0"
                      disabled={!configs.kick.channelOrSlug.trim()}
                      onClick={() => connect("kick")}
                    >
                      Connect
                    </Button>
                  )}
                </div>
                {errors.kick && <p className="text-[11px] text-red-400 pl-6">{errors.kick}</p>}
              </div>

              {/* X */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 opacity-60">
                  <StatusDot status={status.x} />
                  <RiTwitterXFill className="w-4 h-4 text-neutral-400 shrink-0" />
                  <span className="text-xs font-medium w-16">X</span>
                  <span className="text-xs text-muted-foreground flex-1 italic">
                    Not available yet (requires webhook relay)
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled>
                    Unavailable
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Quick status pills bar if platforms drawer is closed */}
          {!platformsOpen && (
            <div className="flex items-center gap-2 overflow-x-auto py-1 text-xs">
              {(["twitch", "youtube", "kick", "x"] as const).map((prov) => {
                const info = PROVIDER_INFO[prov];
                const Icon = info.icon;
                const isConn = status[prov] === "connected";
                const isConnecting =
                  status[prov] === "connecting" || status[prov] === "reconnecting";
                return (
                  <button
                    key={prov}
                    onClick={() => setPlatformsOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-card/40 hover:bg-card text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: info.color }} />
                    <span>{info.name}</span>
                    <StatusDot status={status[prov]} />
                    {isConn && <span className="text-[10px] text-emerald-400">Live</span>}
                    {isConnecting && <span className="text-[10px] text-amber-400">Connecting</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Merged Chat Feed */}
          <div className="relative border border-border rounded-lg bg-background/50 flex flex-col h-80 overflow-hidden">
            <div
              ref={feedRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-2.5 space-y-2 select-text"
            >
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-4 text-muted-foreground text-xs space-y-1.5">
                  <RiBroadcastLine className="w-6 h-6 text-muted-foreground/40" />
                  <p className="font-medium text-foreground">No chat messages yet</p>
                  <p className="max-w-xs text-muted-foreground">
                    {connectedCount > 0
                      ? "Waiting for messages from connected live streams…"
                      : "Connect a platform above to view and highlight live stream chat."}
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const key = `${msg.provider}:${msg.id}`;
                  const isHighlighted = highlightedId === key;
                  const info = PROVIDER_INFO[msg.provider];
                  const Icon = info.icon;

                  return (
                    <div
                      key={key}
                      onClick={() => toggleHighlight(msg.provider, msg.id)}
                      className={`group relative flex items-start gap-2.5 p-2 rounded-md transition-all cursor-pointer ${
                        isHighlighted
                          ? "bg-primary/10 border border-primary/40 shadow-sm"
                          : "hover:bg-muted/40 border border-transparent"
                      }`}
                      title={
                        isHighlighted
                          ? "Click to remove highlight from stream"
                          : "Click to highlight on stream banner"
                      }
                    >
                      {/* Initials avatar */}
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-sm ${getAvatarColor(
                          msg.author,
                        )}`}
                      >
                        {getInitials(msg.author)}
                      </div>

                      {/* Message content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap leading-tight">
                          <span className="font-semibold text-xs text-foreground truncate max-w-40">
                            {msg.author}
                          </span>

                          {/* Platform badge */}
                          <span
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${info.badgeBg} ${info.badgeText}`}
                          >
                            <Icon className="w-2.5 h-2.5" />
                            <span>{info.name}</span>
                          </span>

                          {/* Highlight indicator */}
                          {isHighlighted && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary text-primary-foreground">
                              <RiStarFill className="w-2.5 h-2.5 text-amber-300" />
                              <span>On stream</span>
                            </span>
                          )}

                          {/* Time */}
                          <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                            {new Date(msg.time * 1000).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        {/* Text (emotes rendered as text) */}
                        <p className="text-xs text-foreground/90 mt-0.5 break-words select-text">
                          {msg.text}
                        </p>
                      </div>

                      {/* Hide action button */}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                        title="Hide message locally"
                        onClick={(e) => {
                          e.stopPropagation();
                          hide(msg.provider, msg.id);
                        }}
                      >
                        <RiEyeOffLine className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Jump to bottom chip */}
            {unreadCount > 0 && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all cursor-pointer z-10"
              >
                <RiArrowDownLine className="w-3.5 h-3.5" />
                <span>
                  {unreadCount} new {unreadCount === 1 ? "message" : "messages"}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

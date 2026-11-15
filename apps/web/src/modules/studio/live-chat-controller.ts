import { useCallback, useEffect, useRef, useState } from "react";
import { LiveChat, type ChatMessage, type ChatProvider } from "@sidecut/core/live-chat";
import {
  TwitchChatTransport,
  YouTubeChatTransport,
  KickChatTransport,
  type PlatformConfigs,
  type TransportStatus,
} from "@sidecut/platform-browser/chat-transports";
import { nativeBridge } from "@/modules/workspace/host-coordinator";

const STORAGE_KEY = "sidecut:live-chat:configs";

const DEFAULT_CONFIGS: PlatformConfigs = {
  twitch: { channel: "" },
  youtube: { apiKey: "", videoIdOrUrl: "" },
  kick: { channelOrSlug: "" },
  x: {},
};

function loadStoredConfigs(): PlatformConfigs {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_CONFIGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIGS;
    const parsed = JSON.parse(raw) as Partial<PlatformConfigs>;
    return {
      twitch: { channel: parsed.twitch?.channel ?? "" },
      youtube: {
        apiKey: parsed.youtube?.apiKey ?? "",
        videoIdOrUrl: parsed.youtube?.videoIdOrUrl ?? "",
      },
      kick: {
        channelOrSlug: parsed.kick?.channelOrSlug ?? "",
        chatroomId: parsed.kick?.chatroomId,
      },
      x: {},
    };
  } catch {
    return DEFAULT_CONFIGS;
  }
}

function saveConfigs(configs: PlatformConfigs) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch (err) {
    console.warn("Failed to persist live chat configs:", err);
  }
}

export type LiveChatController = {
  chat: LiveChat;
  messages: ChatMessage[];
  status: Record<ChatProvider, TransportStatus>;
  errors: Record<ChatProvider, string | null>;
  configs: PlatformConfigs;
  highlightedId: string | null;
  connect: (provider: ChatProvider) => void;
  disconnect: (provider: ChatProvider) => void;
  toggleHighlight: (provider: ChatProvider, id: string) => void;
  hide: (provider: ChatProvider, id: string) => void;
  setConfig: <P extends ChatProvider>(provider: P, change: Partial<PlatformConfigs[P]>) => void;
};

export function useLiveChatController(): LiveChatController {
  const chatRef = useRef<LiveChat>(new LiveChat());
  const chat = chatRef.current;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [configs, setConfigs] = useState<PlatformConfigs>(loadStoredConfigs);

  const [status, setStatus] = useState<Record<ChatProvider, TransportStatus>>({
    twitch: "disconnected",
    youtube: "disconnected",
    kick: "disconnected",
    x: "disconnected",
  });

  const [errors, setErrors] = useState<Record<ChatProvider, string | null>>({
    twitch: null,
    youtube: null,
    kick: null,
    x: null,
  });

  const transports = useRef<Map<ChatProvider, () => void>>(new Map());
  const generations = useRef<Map<ChatProvider, number>>(new Map());

  const setConfig = useCallback(
    <P extends ChatProvider>(provider: P, change: Partial<PlatformConfigs[P]>) => {
      setConfigs((prev) => {
        const next: PlatformConfigs = {
          ...prev,
          [provider]: {
            ...prev[provider],
            ...change,
          },
        };
        saveConfigs(next);
        return next;
      });
    },
    [],
  );

  const disconnect = useCallback(
    (provider: ChatProvider) => {
      const stop = transports.current.get(provider);
      if (stop) {
        try {
          stop();
        } catch {}
        transports.current.delete(provider);
      }

      const generation = generations.current.get(provider);
      if (generation !== undefined) {
        chat.disconnect(provider, generation);
        generations.current.delete(provider);
      }

      setStatus((prev) => ({ ...prev, [provider]: "disconnected" }));
      setErrors((prev) => ({ ...prev, [provider]: null }));
    },
    [chat],
  );

  const connect = useCallback(
    (provider: ChatProvider) => {
      // Disconnect existing if any
      disconnect(provider);

      if (provider === "x") {
        setErrors((prev) => ({
          ...prev,
          x: "X chat is not available yet (requires webhook relay).",
        }));
        setStatus((prev) => ({ ...prev, x: "error" }));
        return;
      }

      const generation = chat.connect(provider);
      generations.current.set(provider, generation);

      setStatus((prev) => ({ ...prev, [provider]: "connecting" }));
      setErrors((prev) => ({ ...prev, [provider]: null }));

      const onMessage = (msg: ChatMessage) => {
        try {
          const accepted = chat.receive(msg, generation);
          if (accepted) {
            setMessages(chat.list());
          }
        } catch (err) {
          console.warn(`Error receiving message from ${provider}:`, err);
        }
      };

      const onStatus = (st: TransportStatus, err?: string) => {
        setStatus((prev) => ({ ...prev, [provider]: st }));
        setErrors((prev) => ({ ...prev, [provider]: err ?? null }));
        if (st === "quota") {
          chat.disconnect(provider, generation, true);
        }
      };

      try {
        let stop: () => void;
        if (provider === "twitch") {
          const transport = new TwitchChatTransport();
          stop = transport.start(configs.twitch, onMessage, onStatus);
        } else if (provider === "youtube") {
          const transport = new YouTubeChatTransport();
          stop = transport.start(configs.youtube, onMessage, onStatus);
        } else if (provider === "kick") {
          const bridge = nativeBridge();
          const resolveChatroom = bridge?.kickChannelLookup
            ? (slug: string) => bridge.kickChannelLookup!(slug)
            : undefined;
          const transport = new KickChatTransport(resolveChatroom);
          stop = transport.start(configs.kick, onMessage, onStatus);
        } else {
          return;
        }

        transports.current.set(provider, stop);
      } catch (err) {
        console.warn(`Failed to start ${provider} chat transport:`, err);
        setStatus((prev) => ({ ...prev, [provider]: "error" }));
        setErrors((prev) => ({
          ...prev,
          [provider]: err instanceof Error ? err.message : "Connection failed.",
        }));
      }
    },
    [chat, configs, disconnect],
  );

  const toggleHighlight = useCallback(
    (provider: ChatProvider, id: string) => {
      const key = `${provider}:${id}`;
      if (highlightedId === key) {
        chat.clearHighlight();
        setHighlightedId(null);
      } else {
        try {
          chat.highlight(provider, id);
          setHighlightedId(key);
        } catch {
          chat.clearHighlight();
          setHighlightedId(null);
        }
      }
    },
    [chat, highlightedId],
  );

  const hide = useCallback(
    (provider: ChatProvider, id: string) => {
      const key = `${provider}:${id}`;
      chat.hide(provider, id);
      if (highlightedId === key) {
        setHighlightedId(null);
      }
      setMessages(chat.list());
    },
    [chat, highlightedId],
  );

  // Teardown all transports on unmount
  useEffect(() => {
    const activeTransports = transports.current;
    return () => {
      for (const stop of activeTransports.values()) {
        try {
          stop();
        } catch {}
      }
      activeTransports.clear();
    };
  }, []);

  return {
    chat,
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
  };
}

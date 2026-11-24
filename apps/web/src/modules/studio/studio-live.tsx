import { useEffect, useRef, useState } from "react";
import { RiBroadcastLine, RiStopFill } from "@remixicon/react";
import type { NativeStreamStatus } from "@raee/contracts/native-recording";
import { Button } from "@raee/ui/components/button";
import { Input } from "@raee/ui/components/input";
import { nativeBridge } from "@/modules/workspace/host-coordinator";
import { AUDIO_BITRATE, videoBitrate, type OutputQuality } from "./output-quality";

// Chunks the main process has not taken yet. Past this the network or encoder cannot keep up.
const BACKLOG_LIMIT = 64 * 1024 * 1024;

type Live =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live"; id: string; started: number; streaming: boolean }
  | { kind: "ending" };

/**
 * Streams the Studio program (scenes, overlays and the audio mix) through the desktop app's
 * FFmpeg. The renderer encodes WebM; the main process re-encodes it for RTMP and keeps a copy.
 */
export function StudioLive({
  projectID,
  quality,
  disabled,
  acquire,
  onLiveChange,
}: {
  projectID: string;
  quality: OutputQuality;
  disabled: boolean;
  acquire: () => Promise<MediaStream>;
  onLiveChange: (live: boolean) => void;
}) {
  const [url, setURL] = useState("");
  const [live, setLive] = useState<Live>({ kind: "idle" });
  const [error, setError] = useState("");
  const [stream, setStream] = useState<NativeStreamStatus>({ state: "off" });
  const [now, setNow] = useState(() => Date.now());
  const recorder = useRef<MediaRecorder | null>(null);
  const sending = useRef<Promise<void>>(Promise.resolve());
  const backlog = useRef(0);
  const liveRef = useRef(live);
  liveRef.current = live;

  const isLive = live.kind !== "idle";
  useEffect(() => onLiveChange(isLive), [isLive, onLiveChange]);

  // Poll FFmpeg's view of the destinations and tick the clock while on air.
  useEffect(() => {
    if (live.kind !== "live") return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void nativeBridge()
        ?.nativeRecordingStreamStatus?.()
        .then(setStream)
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [live.kind]);

  async function end(reason?: string) {
    const current = liveRef.current;
    if (current.kind !== "live") return;
    setLive({ kind: "ending" });
    if (reason) setError(reason);
    const active = recorder.current;
    recorder.current = null;
    if (active && active.state !== "inactive") {
      const stopped = new Promise((resolve) => active.addEventListener("stop", resolve));
      active.stop();
      await stopped;
    }
    for (const track of active?.stream.getTracks() ?? []) track.stop();
    await sending.current.catch(() => {});
    await nativeBridge()
      ?.nativeRecordingStop?.()
      .catch(() => setError("The stream ended, but the local copy could not be finished."));
    setStream({ state: "off" });
    setLive({ kind: "idle" });
  }

  async function start() {
    const bridge = nativeBridge();
    if (!bridge?.nativeRecordingStart || !bridge.nativeRecordingWrite) return;
    const destination = url.trim();
    setError("");
    setLive({ kind: "starting" });
    try {
      const media = await acquire();
      const recording = await bridge.nativeRecordingStart({
        projectID,
        source: "program",
        encoder: "auto",
        frameRate: quality.frameRate,
        maxHeight: quality.height,
        videoBitrate: Math.round(videoBitrate(quality) / 1000),
        ...(destination ? { streamURL: destination } : {}),
      });
      const next = new MediaRecorder(media, {
        mimeType: "video/webm;codecs=vp8,opus",
        videoBitsPerSecond: videoBitrate(quality),
        audioBitsPerSecond: AUDIO_BITRATE,
      });
      backlog.current = 0;
      sending.current = Promise.resolve();
      next.addEventListener("dataavailable", (event) => {
        if (!event.data.size) return;
        backlog.current += event.data.size;
        if (backlog.current > BACKLOG_LIMIT) {
          void end("The stream fell too far behind, so it was stopped. Try a lower quality.");
          return;
        }
        sending.current = sending.current.then(async () => {
          const bytes = new Uint8Array(await event.data.arrayBuffer());
          await bridge.nativeRecordingWrite!(recording.id, bytes);
          backlog.current -= event.data.size;
        });
        sending.current.catch(() => void end("The desktop app stopped taking the stream."));
      });
      next.addEventListener("error", () => void end("The stream encoder failed."));
      recorder.current = next;
      next.start(500);
      setURL("");
      setNow(Date.now());
      setLive({
        kind: "live",
        id: recording.id,
        started: Date.now(),
        streaming: Boolean(destination),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The stream could not start.");
      setLive({ kind: "idle" });
    }
  }

  // Leaving Studio ends the stream instead of leaving FFmpeg waiting for input.
  useEffect(() => () => void end(), []);

  const seconds = live.kind === "live" ? Math.max(0, Math.floor((now - live.started) / 1000)) : 0;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-sm">
        Stream URL
        <Input
          type="password"
          value={url}
          autoComplete="off"
          spellCheck={false}
          maxLength={2048}
          disabled={isLive}
          placeholder="rtmps://live.example.com/app/stream-key"
          onChange={(event) => setURL(event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Paste the full RTMP or RTMPS URL with your stream key. It isn't saved. Leave it empty to
        only record the program on this computer.
      </p>
      <div className="studio-go-row">
        {live.kind === "live" || live.kind === "ending" ? (
          <Button
            variant="destructive"
            className="studio-go-button"
            disabled={live.kind === "ending"}
            onClick={() => void end()}
          >
            <RiStopFill data-icon="inline-start" />
            {live.kind === "ending"
              ? "Ending…"
              : live.kind === "live" && live.streaming
                ? "End stream"
                : "Stop recording"}
          </Button>
        ) : (
          <Button
            className="studio-go-button"
            disabled={disabled || live.kind === "starting"}
            onClick={() => void start()}
          >
            <RiBroadcastLine data-icon="inline-start" className="text-red-500" />
            {live.kind === "starting"
              ? "Starting…"
              : url.trim()
                ? "Go live"
                : "Record on this computer"}
          </Button>
        )}
      </div>
      {live.kind === "live" && (
        <p role="status" className="text-sm">
          {live.streaming ? "Live" : "Recording"} · {clock}
        </p>
      )}
      {stream.state === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          The destination stopped taking the stream. The local copy keeps recording.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        The program is also saved on this computer. Find it in Edit, in the Native recording
        library.
      </p>
    </div>
  );
}

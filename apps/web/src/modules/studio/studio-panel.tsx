import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { DEFAULT_LIVE_ASSETS, liveAssets } from "@sidecut/core/live-assets";
import type { LiveAssets } from "@sidecut/core/live-assets";
import { DEFAULT_LIVE_AUDIO, type LiveAudioSettings } from "@sidecut/core/live-audio";
import { liveQualityProfiles, type LiveStudio } from "@sidecut/core/live-studio";
import { LiveAudioMixer, type LiveAudioChannel } from "@sidecut/platform-browser/live-audio";
import { LiveStudioOutput } from "@sidecut/platform-browser/live-studio";
import { LocalMediaReader } from "@sidecut/platform-browser/preview";
import { RecentClips } from "@sidecut/platform-browser/recent-clips";
import { recordingLimits } from "@sidecut/platform-browser/recording";
import { useLiveChatController } from "./live-chat-controller";
import { LiveChatPanel } from "./live-chat-panel";
import { Button, buttonVariants } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { RadioGroup } from "@sidecut/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sidecut/ui/components/select";
import { useNavigate } from "@tanstack/react-router";
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiBroadcastLine,
  RiCloudLine,
  RiCloseLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiFlagLine,
  RiFullscreenExitLine,
  RiFullscreenLine,
  RiRecordCircleFill,
  RiRecordCircleLine,
  RiRefreshLine,
  RiStackLine,
  RiStopFill,
  RiVideoOnLine,
} from "@remixicon/react";
import { useEditorSession } from "@/modules/workspace/editor-session";
import { nativeBridge } from "@/modules/workspace/host-coordinator";
import { NativeRecordingControls } from "@/modules/workspace/native-recording-controls";
import { megabytes, type UploadProgress } from "./cloud-upload";
import { addTakeToProject, placedMessage } from "./place-take";
import {
  TakeWriter,
  listTakes,
  pruneTakes,
  removeTake,
  takeFile,
  updateTake,
  type TakeInfo,
} from "./take-store";
import { openTakeSink } from "./take-sink";
import type { StudioCloud } from "@/modules/cloud/studio-cloud";
import { loadArrangements, loadStudio, saveArrangements, saveStudio } from "./studio-store";
import {
  ClipCapture,
  StudioCapture,
  captureNeedsResolution,
  clipsNeedResolution,
  type CaptureDeps,
} from "./studio-capture";
import {
  defaultLayout,
  fillLayout,
  fitLayout,
  sourceRect,
  type SourceLayout,
} from "./source-layout";
import { AudioMixerPanel } from "./audio-mixer-panel";
import { openAudioInput, useAudioInputDevices } from "./audio-devices";
import { openCamera, useCameraDevices } from "./camera-devices";
import { OverlayStage } from "./overlay-stage";
import { SceneDeck } from "./scene-deck";
import { SceneLookPanel } from "./scene-look-panel";
import { SceneSources, type SavedArrangements } from "./scene-sources";
import { Soundboard, SoundboardToggle } from "./soundboard";
import { SourceStage } from "./source-stage";
import { activeLiveSceneKey, isAudioInputOpen } from "./audio-gate";
import "./studio.css";

type VideoSource = {
  id: string;
  identity: string;
  kind: "camera" | "screen";
  label: string;
  video: HTMLVideoElement;
  stream: MediaStream;
  deviceId?: string | undefined;
};
type AudioInput = {
  id: string;
  label: string;
  kind: "microphone" | "screen" | "camera";
  /** The video source this audio belongs to; it is removed with that source. */
  sourceId?: string;
  stream: MediaStream;
  channel: LiveAudioChannel;
};
type Recovered = TakeInfo & { bytes: number };
type Mode = "record" | "live" | "both";
type SaveTo = "device" | "cloud";
const SAVE_TO_KEY = "sidecut.studio.saveTo";
const readSaveTo = (): SaveTo => {
  try {
    return localStorage.getItem(SAVE_TO_KEY) === "device" ? "device" : "cloud";
  } catch {
    return "cloud";
  }
};
const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

const sourceAspect = (video: HTMLVideoElement) =>
  video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;

type ShownSource = VideoSource & { layout: SourceLayout };

/** Draws sources bottom to top, each where the user placed it on the program canvas. */
function paintSources(context: CanvasRenderingContext2D, sources: readonly ShownSource[]) {
  const { width, height } = context.canvas;
  for (const { video, layout } of sources) {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) continue;
    const rect = sourceRect(layout, width / height, sourceAspect(video));
    context.drawImage(video, rect.x * width, rect.y * height, rect.w * width, rect.h * height);
  }
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="studio-section" aria-label={title}>
      <header>
        <div className="min-w-0">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export default function StudioPanel({
  onBusy,
  cloud,
}: {
  onBusy: (busy: boolean) => void;
  cloud: StudioCloud;
}) {
  const { session, snapshot } = useEditorSession();
  const navigate = useNavigate();
  const liveChat = useLiveChatController();
  const liveChatRef = useRef(liveChat.chat);
  liveChatRef.current = liveChat.chat;
  // Live goes through the desktop app's native recorder; browsers cannot reach RTMP.
  const canStream = Boolean(nativeBridge()?.nativeRecordingStart);
  const projectID = useRef(snapshot.project.id).current;
  const canvas = useRef<HTMLCanvasElement>(null);
  const studio = useRef<LiveStudio | null>(null);
  const output = useRef<LiveStudioOutput | null>(null);
  const mixer = useRef<LiveAudioMixer | null>(null);
  /** Every open camera and screen; scenes share these streams. */
  const sources = useRef<VideoSource[]>([]);
  /** Which open sources each scene shows, and where. */
  const arrangement = useRef(new SceneSources()).current;
  /** The sources a scene shows, bottom layer first. */
  const shown = useCallback(
    (scene: string): ShownSource[] =>
      arrangement.of(scene).flatMap((placement) => {
        const id = placement.identity ?? placement.sourceId;
        const source = sources.current.find((item) => item.identity === id || item.id === id);
        return source ? [{ ...source, layout: placement.layout }] : [];
      }),
    [arrangement],
  );
  const audioInputs = useRef<AudioInput[]>([]);
  /** Soundboard pads that are playing right now, by pad id. */
  const playingPads = useRef(new Set<string>());
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const persist = useRef<Promise<void>>(Promise.resolve());
  const [, setVersion] = useState(0);
  const syncAudioGates = useCallback(() => {
    const activeScene = studio.current?.activeScene ?? null;
    const hasScenes = (studio.current?.list().length ?? 0) > 0;
    const liveKey = activeLiveSceneKey(activeScene, hasScenes);
    for (const input of audioInputs.current) {
      const open = isAudioInputOpen(input, liveKey, arrangement);
      input.channel.setGate(open);
    }
  }, [arrangement]);
  const refresh = useCallback(() => {
    syncAudioGates();
    setVersion((value) => value + 1);
  }, [syncAudioGates]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [frame, setFrame] = useState<string | null>(null);
  const [name, setName] = useState("Scene 1");
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [draft, setDraft] = useState<LiveAssets>(DEFAULT_LIVE_ASSETS);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  /** While an overlay is selected the preview edits overlays instead of sources. */
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  // The preview edits one layer at a time: picking a source or an overlay hands it over.
  useEffect(() => {
    if (selectedSource) setSelectedOverlay(null);
  }, [selectedSource]);
  useEffect(() => {
    if (selectedOverlay) setSelectedSource(null);
  }, [selectedOverlay]);
  const sourceNumbers = useRef({ camera: 0, screen: 0 });
  /** The program canvas's shape; a placeholder until the first frame sizes it. */
  const canvasAspect = () => {
    const element = canvas.current;
    return frame && element?.width && element.height ? element.width / element.height : 16 / 9;
  };
  /** The look as last saved, to tell the user when the draft has unsaved changes. */
  const [savedLook, setSavedLook] = useState("");
  const [settings, setSettings] = useState<Record<string, LiveAudioSettings>>({});
  const { devices: audioDevices } = useAudioInputDevices();
  const { devices: cameraDevices, refresh: refreshCameraDevices } = useCameraDevices();
  const [cameraSelectKey, setCameraSelectKey] = useState(0);
  const usedCameraDeviceIds = new Set(
    sources.current
      .filter((s) => s.kind === "camera" && s.deviceId)
      .map((s) => s.deviceId as string),
  );
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>("record");
  const [saveTo, setSaveToState] = useState<SaveTo>(readSaveTo);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const toCloud = saveTo === "cloud" && cloud.state === "ready";
  const setSaveTo = (next: SaveTo) => {
    setSaveToState(next);
    try {
      localStorage.setItem(SAVE_TO_KEY, next);
    } catch {
      // Private browsing: the choice lasts for this page only.
    }
  };
  const [recovered, setRecovered] = useState<Recovered[]>([]);
  // Points at this render's programStream so the long-lived clip controller never goes stale.
  const latestStream = useRef<(() => Promise<{ stream: MediaStream; audio: MediaStream }>) | null>(
    null,
  );
  const clips = useRef<ClipCapture | null>(null);
  // The clip controller is the only source for buffer and saved-clip UI.
  clips.current ??= new ClipCapture({
    buffer: new RecentClips(),
    acquire: () => latestStream.current!(),
    createURL: (file) => URL.createObjectURL(file),
    revokeURL: (url) => URL.revokeObjectURL(url),
  });
  const clipState = useSyncExternalStore(clips.current.subscribe, () => clips.current!.state);
  const armed = clipState.buffer.kind === "armed";
  const saving = clipState.product.kind === "saving";
  const clip =
    clipState.product.kind === "retained" || clipState.product.kind === "importing"
      ? clipState.product.clip
      : null;
  // Points at this render's sink options (cloud or device) for the long-lived capture controller.
  const latestSink = useRef<CaptureDeps["openSink"] | null>(null);
  const capture = useRef<StudioCapture | null>(null);
  // The capture controller is the only source for recording, saving, upload and take UI.
  capture.current ??= new StudioCapture({
    acquire: async () => (await latestStream.current!()).stream,
    createRecorder: (stream) => {
      const profile = liveQualityProfiles.standard;
      return new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp8,opus",
        videoBitsPerSecond: profile.videoBitsPerSecond,
        audioBitsPerSecond: profile.audioBitsPerSecond,
      });
    },
    openSink: (fileName, report) => latestSink.current!(fileName, report),
    fileName: () => `studio-${Date.now()}.webm`,
    now: () => performance.now(),
    revokeURL: (url) => URL.revokeObjectURL(url),
    removeStored: (fileName) => void removeTake(fileName),
    encoderMessage: "The recording encoder failed. Add or discard this take.",
  });
  const program = useSyncExternalStore(capture.current.subscribe, () => capture.current!.state);
  const recording = program.kind === "recording";
  const capturing =
    program.kind === "starting" ||
    recording ||
    program.kind === "stopping" ||
    program.kind === "saving";
  // Only a take being written owns the program; a retained take waiting for a choice does not.
  const captureActive = capturing;
  const captureActiveRef = useRef(captureActive);
  captureActiveRef.current = captureActive;
  const uploading = program.kind === "saving" && program.cloud;
  const take = program.kind === "retained" || program.kind === "importing" ? program.take : null;
  const markCount = recording ? program.marks : 0;
  const captureFailure =
    program.kind === "failed"
      ? program.message
      : "failure" in program
        ? program.failure
        : undefined;
  const captureNotice = "notice" in program ? program.notice : undefined;
  // Upload progress only means something while a cloud take is in flight.
  const shownProgress = capturing ? progress : null;
  const blocked = snapshot.readOnly || snapshot.busy || snapshot.project.id !== projectID;

  // Takes on disk can be recovered later, so only takes held in memory keep Studio open.
  const busy = captureNeedsResolution(program) || clipsNeedResolution(clipState);
  useEffect(() => {
    onBusy(busy);
    if (!busy) return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [busy, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);
  const uploadedId = program.kind === "uploaded" ? program.mediaId : null;
  useEffect(() => {
    if (!uploadedId) return;
    setStatus("Saved to the cloud. Opening it in the editor…");
    void navigate({ to: "/edit/$mediaId", params: { mediaId: uploadedId } });
  }, [uploadedId, navigate]);
  useEffect(() => {
    let alive = true;
    // Anything on disk at startup was left by an earlier visit: stopped but not added, or cut off.
    void pruneTakes()
      .then(listTakes)
      .then((takes) => {
        if (alive) setRecovered(takes.filter((item) => !item.mediaId));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const attempt = useCallback(async (action: () => unknown, fallback: string) => {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(message(cause, fallback));
    }
  }, []);
  const commit = useCallback(() => {
    refresh();
    const current = studio.current;
    if (!current) return;
    persist.current = persist.current
      .then(() => saveStudio(projectID, current))
      .catch(() => setError("Scene changes could not be saved on this device."));
  }, [projectID, refresh]);
  const persistArrangements = useRef<Promise<void>>(Promise.resolve());
  const commitArrangements = useCallback(() => {
    refresh();
    const data: SavedArrangements = {
      sourceNumbers: { ...sourceNumbers.current },
      scenes: arrangement.serialize(),
    };
    persistArrangements.current = persistArrangements.current
      .then(() => saveArrangements(projectID, data))
      .catch(() => setError("Scene arrangements could not be saved on this device."));
  }, [arrangement, projectID, refresh]);
  const ensureMixer = useCallback(async () => {
    mixer.current ??= new LiveAudioMixer(new AudioContext());
    await mixer.current.resume();
    return mixer.current;
  }, []);

  // Program output: loads saved scenes, then paints the active one while the panel is open.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const readers = new Map<string, Promise<LocalMediaReader>>();
    const reader = (id: string) => {
      let entry = readers.get(id);
      if (!entry) {
        entry = (async () => {
          const media = session.getSnapshot().project.media.find((item) => item.id === id);
          const local = await session.resource(id);
          if (!media || local?.state !== "available")
            throw new Error("Scene media is unavailable.");
          return LocalMediaReader.open(local.file, media.kind, 1280);
        })();
        readers.set(id, entry);
        entry.catch(() => readers.delete(id));
      }
      return entry;
    };
    void Promise.all([loadStudio(projectID), loadArrangements(projectID)])
      .then(([loaded, loadedArrangements]) => {
        if (!alive || !canvas.current) return;
        studio.current = loaded;
        sourceNumbers.current = { ...loadedArrangements.sourceNumbers };
        arrangement.restore(loadedArrangements.scenes);
        const initialSelected = loaded.activeScene?.id ?? loaded.list()[0]?.id ?? null;
        if (initialSelected) {
          try {
            const saved = liveAssets(
              loaded.project(initialSelected).liveAssets ?? DEFAULT_LIVE_ASSETS,
            );
            draftRef.current = saved;
            setDraft(saved);
            setSavedLook(JSON.stringify(saved));
          } catch {
            // Keep default assets
          }
        }
        output.current = new LiveStudioOutput(
          canvas.current,
          loaded,
          reader,
          { target: "stream", chat: liveChatRef.current },
          (context) => paintSources(context, shown(loaded.activeScene?.id ?? "")),
          // Real-time software compositing and VP8 encoding cannot sustain a 4K project canvas.
          1080,
          () => {
            if (captureActiveRef.current) return undefined;
            if (
              selectedRef.current &&
              loaded.activeScene &&
              selectedRef.current !== loaded.activeScene.id
            ) {
              return undefined;
            }
            return draftRef.current;
          },
        );
        setSelected(initialSelected);
        setName(`Scene ${loaded.list().length + 1}`);
        const origin = performance.now();
        // An interval, not rAF: a backgrounded window must keep feeding an active recording.
        timer = setInterval(() => {
          if (!loaded.activeScene) return;
          output.current
            ?.render((performance.now() - origin) / 1000)
            .then((painted) => {
              if (alive && painted) setFrame(painted.sceneId);
            })
            .catch((cause: unknown) => {
              if (alive) setError(message(cause, "The scene could not be rendered."));
            });
        }, 1000 / liveQualityProfiles.standard.framesPerSecond);
      })
      .catch((cause: unknown) => {
        if (alive) setError(`Saved scenes could not be opened. ${message(cause, "")}`.trim());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      clearInterval(timer);
      void clips.current?.close();
      capture.current?.close();
      output.current?.close();
      output.current = null;
      for (const source of [...sources.current, ...audioInputs.current])
        for (const track of source.stream.getTracks()) track.stop();
      for (const source of sources.current) source.video.onresize = null;
      sources.current = [];
      arrangement.clear();
      audioInputs.current = [];
      mixer.current?.close();
      void mixer.current?.context.close();
      mixer.current = null;
      for (const entry of readers.values()) void entry.then((item) => item.close()).catch(() => {});
    };
  }, [arrangement, projectID, session, shown]);

  const inputCount = audioInputs.current.length;
  useEffect(() => {
    if (!inputCount) return;
    const timer = setInterval(() => {
      setMeters(
        Object.fromEntries(
          audioInputs.current.map((input) => [input.id, input.channel.meter().peak]),
        ),
      );
    }, 150);
    return () => clearInterval(timer);
  }, [inputCount]);

  // The look editor always starts from what the selected scene actually saved.
  useEffect(() => {
    if (!selected || !studio.current) return;
    try {
      const saved = liveAssets(studio.current.project(selected).liveAssets ?? DEFAULT_LIVE_ASSETS);
      setDraft(saved);
      setSavedLook(JSON.stringify(saved));
    } catch {
      setDraft(DEFAULT_LIVE_ASSETS);
      setSavedLook(JSON.stringify(DEFAULT_LIVE_ASSETS));
    }
  }, [selected]);

  const scenes = studio.current?.list() ?? [];
  const active = studio.current?.activeScene ?? null;
  const liveKey = activeLiveSceneKey(active, scenes.length > 0);
  useEffect(() => {
    syncAudioGates();
  }, [syncAudioGates, liveKey]);
  const selectedScene = scenes.find((scene) => scene.id === selected);
  /** The Sources panel arranges the selected scene ("" before any scene exists). */
  const editKey = selected ?? "";
  const editSources = shown(editKey);
  const scenePlacements = arrangement.of(editKey);
  const otherSources = sources.current.filter(
    (source) => !arrangement.has(editKey, source.identity),
  );
  /** Sources can be dragged only while the preview shows the scene being arranged. */
  const editingProgram = Boolean(active && active.id === editKey);

  const saveFromEditor = (existing?: { id: string; name: string }) =>
    attempt(() => {
      const current = studio.current;
      if (!current) return;
      const id = existing?.id ?? crypto.randomUUID();
      const look = existing ? current.project(existing.id).liveAssets : undefined;
      current.save({
        id,
        name: existing?.name ?? name,
        project: { ...session.getSnapshot().project, liveAssets: look ?? DEFAULT_LIVE_ASSETS },
        expectedRevision: current.currentRevision,
      });
      // A new scene starts with the sources of the scene it was made from.
      if (!existing) {
        arrangement.copy(selectedRef.current ?? "", id);
        if (!selectedRef.current) arrangement.drop("");
        commitArrangements();
      }
      setSelected(id);
      if (!existing) setName(`Scene ${current.list().length + 1}`);
      commit();
    }, "The scene could not be saved.");
  const switchTo = (id: string) =>
    attempt(() => {
      const current = studio.current;
      if (!current) return;
      current.switch({ id, expectedRevision: current.currentRevision });
      setSelected(id);
      commit();
    }, "The scene could not be switched.");
  // The deck changes only what is on air; `selected` and its draft stay put so an
  // unsaved look being edited is never thrown away by a quick scene cut.
  const switchOnAir = (id: string) =>
    attempt(() => {
      const current = studio.current;
      if (!current || current.activeScene?.id === id) return;
      current.switch({ id, expectedRevision: current.currentRevision });
      commit();
    }, "The scene could not be switched.");
  const remove = (id: string) =>
    attempt(() => {
      const current = studio.current;
      if (!current) return;
      current.remove({ id, expectedRevision: current.currentRevision });
      for (const orphan of arrangement.drop(id)) {
        const live = sources.current.find((item) => item.identity === orphan || item.id === orphan);
        if (live) closeSource(live.id);
      }
      commitArrangements();
      if (selected === id) setSelected(current.activeScene?.id ?? current.list()[0]?.id ?? null);
      commit();
    }, "The scene could not be removed.");
  const applyLook = (goLive: boolean) =>
    attempt(() => {
      const current = studio.current;
      if (!current || !selectedScene) return;
      current.save({
        id: selectedScene.id,
        name: selectedScene.name,
        project: { ...current.project(selectedScene.id), liveAssets: liveAssets(draft) },
        expectedRevision: current.currentRevision,
      });
      if (goLive)
        current.switch({ id: selectedScene.id, expectedRevision: current.currentRevision });
      setSavedLook(JSON.stringify(draft));
      commit();
    }, "The look could not be applied.");

  /** Stops an open source's media resources and removes it from active sources. */
  const disconnectSource = (id: string) => {
    const source = sources.current.find((item) => item.id === id || item.identity === id);
    if (!source) return;
    sources.current = sources.current.filter((item) => item.id !== source.id);
    for (const track of source.stream.getTracks()) track.stop();
    source.video.onresize = null;
    source.video.srcObject = null;
    for (const input of audioInputs.current)
      if (input.sourceId === source.id) removeInput(input.id);
    setSelectedSource((current) => (current === source.id ? null : current));
    refresh();
  };

  /** Stops an open source and takes it off every scene permanently. */
  const closeSource = (id: string) => {
    const source = sources.current.find((item) => item.id === id || item.identity === id);
    const targetId = source ? source.identity : id;
    arrangement.forget(targetId);
    commitArrangements();
    disconnectSource(id);
  };
  /** Places a source on a scene, screens under cameras so a share never hides the presenter. */
  const placeOnScene = (scene: string, source: VideoSource) => {
    const placed = shown(scene);
    const same = placed.filter((item) => item.kind === source.kind);
    const layout = defaultLayout(
      source.kind,
      same.length,
      canvasAspect(),
      sourceAspect(source.video),
    );
    const firstCamera = placed.findIndex((item) => item.kind === "camera");
    const at = source.kind === "screen" && firstCamera >= 0 ? firstCamera : placed.length;
    arrangement.add(
      scene,
      {
        identity: source.identity,
        label: source.label,
        kind: source.kind,
        deviceId: source.deviceId,
        layout,
      },
      at,
    );
    commitArrangements();
  };
  /** Takes a source off the scene being arranged, closing it once no scene shows it. */
  const removeSource = (id: string) => {
    const source = sources.current.find((item) => item.id === id || item.identity === id);
    const targetId = source ? source.identity : id;
    const removedLast = arrangement.remove(editKey, targetId);
    commitArrangements();
    if (removedLast && source) disconnectSource(source.id);
    setSelectedSource((current) => (current === id || current === targetId ? null : current));
    refresh();
  };
  const addExisting = (id: string) => {
    const source = sources.current.find((item) => item.id === id || item.identity === id);
    if (!source) return;
    placeOnScene(editKey, source);
    setSelectedSource(source.id);
    refresh();
  };
  const addSource = (
    kind: VideoSource["kind"],
    chosenDeviceId?: string,
    targetIdentity?: string,
    targetLabel?: string,
  ) =>
    attempt(async () => {
      // The scene picked when the user asked, even if they pick another while a prompt is open.
      const scene = selectedRef.current ?? "";
      let stream: MediaStream;
      if (kind === "camera") {
        try {
          stream = await openCamera(chosenDeviceId);
        } catch (err) {
          if (chosenDeviceId) {
            stream = await openCamera();
          } else {
            throw err;
          }
        }
      } else {
        // Tab or system audio comes along when the user ticks "Share audio".
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      const id = crypto.randomUUID();
      try {
        await video.play();
      } catch (cause) {
        for (const track of stream.getTracks()) track.stop();
        throw cause;
      }

      let identity: string;
      let label: string;
      const deviceId =
        kind === "camera"
          ? chosenDeviceId || stream.getVideoTracks()[0]?.getSettings?.()?.deviceId
          : undefined;

      if (kind === "camera") {
        if (targetIdentity) {
          identity = targetIdentity;
          label = targetLabel || `Camera ${sourceNumbers.current.camera || 1}`;
        } else {
          const baseIdentity = `camera:${deviceId || "default"}`;
          const sceneCandidates = [
            ...arrangement.of(scene),
            ...Array.from(arrangement.scenesWith(baseIdentity)).flatMap((s) => arrangement.of(s)),
          ];
          const missingPlacement = sceneCandidates.find((p) => {
            const placementId = p.identity ?? p.sourceId ?? "";
            const matchesDevice =
              placementId === baseIdentity || placementId.startsWith(`${baseIdentity}#`);
            const isLive = sources.current.some((s) => s.identity === placementId);
            return matchesDevice && !isLive;
          });

          if (missingPlacement) {
            identity = missingPlacement.identity ?? missingPlacement.sourceId!;
            label = missingPlacement.label ?? `Camera ${sourceNumbers.current.camera || 1}`;
          } else {
            const isBaseIdentityLive = sources.current.some((s) => s.identity === baseIdentity);
            const n = ++sourceNumbers.current.camera;
            label = `Camera ${n}`;
            identity = isBaseIdentityLive ? `${baseIdentity}#${n}` : baseIdentity;
          }
        }
      } else {
        if (targetIdentity) {
          identity = targetIdentity;
          label = targetLabel || targetIdentity.replace("screen:", "Screen ");
        } else {
          // Normal Add screen: check if there is an unconnected missing screen (prioritizing current scene)
          const allScenes = Object.keys(arrangement.serialize());
          const sceneCandidates = [
            ...arrangement.of(scene),
            ...allScenes.flatMap((s) => arrangement.of(s)),
          ];
          const missingScreen = sceneCandidates.find((p) => {
            const placementId = p.identity ?? p.sourceId ?? "";
            const isScreen = p.kind === "screen" || placementId.startsWith("screen:");
            const isLive = sources.current.some((s) => s.identity === placementId);
            return isScreen && !isLive;
          });
          if (missingScreen) {
            identity = missingScreen.identity ?? missingScreen.sourceId!;
            label = missingScreen.label ?? identity.replace("screen:", "Screen ");
          } else {
            const n = ++sourceNumbers.current.screen;
            identity = `screen:${n}`;
            label = `Screen ${n}`;
          }
        }
      }

      const source: VideoSource = { id, identity, kind, label, video, stream, deviceId };
      sources.current = [...sources.current, source];

      // Restore into every scene that had it at its saved layout and layer order.
      // If the current scene did not have it saved, place it with default layout.
      const scenesWithSource = arrangement.scenesWith(identity);
      if (!scenesWithSource.includes(scene)) {
        placeOnScene(scene, source);
      } else {
        commitArrangements();
      }

      video.onresize = refresh;
      const onEnded = () => {
        const current = sources.current.find((item) => item.id === id);
        if (current?.stream === stream) {
          disconnectSource(id);
        }
      };
      stream.getVideoTracks()[0]?.addEventListener("ended", onEnded, { once: true });
      if (stream.getAudioTracks().length) {
        const audio = await ensureMixer();
        const audioID = `${id}:audio`;
        const channel = audio.addStream(audioID, new MediaStream(stream.getAudioTracks()));
        setSettings((current) => ({ ...current, [audioID]: DEFAULT_LIVE_AUDIO }));
        audioInputs.current = [
          ...audioInputs.current,
          { id: audioID, label, kind, sourceId: id, stream, channel },
        ];
      }
      setSelectedSource(id);
      if (kind === "camera") {
        void refreshCameraDevices();
      }
      refresh();
    }, `Could not start the ${kind}.`);

  const switchingCameras = useRef(new Set<string>());
  const switchCameraDevice = (id: string, newDeviceId: string) =>
    attempt(async () => {
      const source = sources.current.find((item) => item.id === id || item.identity === id);
      if (!source || source.kind !== "camera") return;
      if (source.deviceId === newDeviceId) return;
      // One switch per source at a time, so overlapping picks can't orphan a stream.
      if (switchingCameras.current.has(source.id)) return;
      switchingCameras.current.add(source.id);
      let newStream: MediaStream;
      let newVideo: HTMLVideoElement;
      try {
        newStream = await openCamera(newDeviceId);
        newVideo = document.createElement("video");
        newVideo.muted = true;
        newVideo.playsInline = true;
        newVideo.srcObject = newStream;
        try {
          await newVideo.play();
        } catch (cause) {
          for (const track of newStream.getTracks()) track.stop();
          throw cause;
        }
      } finally {
        switchingCameras.current.delete(source.id);
      }
      // The source may have been removed while the new camera was opening.
      if (!sources.current.includes(source)) {
        for (const track of newStream.getTracks()) track.stop();
        newVideo.srcObject = null;
        return;
      }

      for (const track of source.stream.getTracks()) track.stop();
      source.video.onresize = null;
      source.video.srcObject = null;

      const oldIdentity = source.identity;
      const newDeviceIdResolved =
        newDeviceId || newStream.getVideoTracks()[0]?.getSettings?.()?.deviceId;
      const newIdentity = `camera:${newDeviceIdResolved || "default"}`;

      source.stream = newStream;
      source.video = newVideo;
      source.deviceId = newDeviceIdResolved;
      source.identity = newIdentity;

      arrangement.updateIdentity(oldIdentity, newIdentity, newDeviceIdResolved);
      commitArrangements();

      newVideo.onresize = refresh;
      const onEnded = () => {
        const current = sources.current.find((item) => item.id === source.id);
        if (current?.stream === newStream) {
          disconnectSource(source.id);
        }
      };
      newStream.getVideoTracks()[0]?.addEventListener("ended", onEnded, { once: true });

      void refreshCameraDevices();
      refresh();
    }, "Could not switch camera device.");
  const placeSource = (id: string, layout: SourceLayout) => {
    const source = sources.current.find((item) => item.id === id || item.identity === id);
    const targetId = source ? source.identity : id;
    arrangement.place(editKey, targetId, layout);
    commitArrangements();
    refresh();
  };
  /** Moves a source one layer up (towards the viewer) or down in the scene being arranged. */
  const restack = (id: string, step: 1 | -1) => {
    const source = sources.current.find((item) => item.id === id || item.identity === id);
    const targetId = source ? source.identity : id;
    arrangement.restack(editKey, targetId, step);
    commitArrangements();
    refresh();
  };
  const removeInput = (id: string) => {
    mixer.current?.remove(id);
    for (const input of audioInputs.current)
      if (input.id === id && !input.sourceId)
        for (const track of input.stream.getTracks()) track.stop();
    audioInputs.current = audioInputs.current.filter((input) => input.id !== id);
    refresh();
  };
  const addMicrophone = (deviceId: string | null = null) =>
    attempt(async () => {
      const audio = await ensureMixer();
      const stream = await openAudioInput(deviceId);
      const id = crypto.randomUUID();
      const track = stream.getAudioTracks()[0];
      const channel = audio.addStream(id, stream, DEFAULT_LIVE_AUDIO);
      track?.addEventListener("ended", () => removeInput(id), { once: true });
      setSettings((current) => ({ ...current, [id]: DEFAULT_LIVE_AUDIO }));
      audioInputs.current = [
        ...audioInputs.current,
        {
          id,
          label: track?.label || `Microphone ${audioInputs.current.length + 1}`,
          kind: "microphone",
          stream,
          channel,
        },
      ];
      refresh();
    }, "Could not start the microphone.");
  const updateInput = (input: AudioInput, change: Partial<LiveAudioSettings>) => {
    const next = { ...(settings[input.id] ?? DEFAULT_LIVE_AUDIO), ...change };
    void attempt(() => {
      input.channel.update(next);
      setSettings((current) => ({ ...current, [input.id]: next }));
    }, "The audio setting could not be changed.");
  };
  const decodeSound = async (file: Blob) => {
    if (file.size > 32 * 1024 * 1024) throw new Error("Soundboard files can be up to 32 MiB.");
    const audio = await ensureMixer();
    return audio.context.decodeAudioData(await file.arrayBuffer());
  };
  const stopPad = (id: string | null) => {
    for (const pad of id === null ? [...playingPads.current] : [id]) {
      mixer.current?.stop(`pad-${pad}`);
      playingPads.current.delete(pad);
    }
  };
  const playPad = (id: string, buffer: AudioBuffer, volumeDB: number, loop: boolean) =>
    void attempt(async () => {
      const audio = await ensureMixer();
      stopPad(id);
      const channel = audio.play(
        `pad-${id}`,
        buffer,
        { ...DEFAULT_LIVE_AUDIO, gainDB: volumeDB },
        undefined,
        loop,
      );
      playingPads.current.add(id);
      void channel;
    }, "The sound could not be played.");
  /** Shows or hides an overlay on the scene that is on air, for soundboard macros. */
  const setLiveOverlay = (overlayId: string, visible: boolean) =>
    void attempt(() => {
      const current = studio.current;
      const activeID = current?.activeScene?.id;
      const scene = current?.list().find((item) => item.id === activeID);
      if (!current || !scene) return;
      const project = current.project(scene.id);
      const assets = liveAssets(project.liveAssets ?? DEFAULT_LIVE_ASSETS);
      const next = {
        ...assets,
        overlays: assets.overlays.map((overlay) =>
          overlay.id === overlayId ? { ...overlay, enabled: visible } : overlay,
        ),
      };
      current.save({
        id: scene.id,
        name: scene.name,
        project: { ...project, liveAssets: next },
        expectedRevision: current.currentRevision,
      });
      if (selected === scene.id) {
        setDraft(next);
        setSavedLook(JSON.stringify(next));
      }
      commit();
    }, "The overlay could not be changed.");

  const programStream = async () => {
    const audio = await ensureMixer();
    if (!output.current) throw new Error("Studio output is unavailable.");
    return { stream: output.current.recordingStream(audio.stream), audio: audio.stream };
  };
  latestStream.current = programStream;

  latestSink.current = (fileName, report) =>
    openTakeSink(
      fileName,
      "video/webm",
      {
        // Takes stream to disk. Browsers that cannot do that keep a capped copy in memory instead.
        createWriter: (target) => TakeWriter.create(target),
        beginCloud:
          toCloud && cloud.state === "ready"
            ? (target, marks) => {
                setProgress({ sentBytes: 0, recordedBytes: 0, parts: 0 });
                return cloud.begin(target, "video/webm", marks, setProgress);
              }
            : null,
        limitBytes: recordingLimits.bytes,
        createURL: (file) => URL.createObjectURL(file),
        // The disk copy lets the editor open the take without downloading it again.
        linkUpload: (info, mediaId) => updateTake({ ...info, mediaId }),
      },
      report,
    );
  const startRecording = () =>
    attempt(async () => {
      setStatus("");
      await capture.current!.start();
    }, "Recording could not start.");
  const addClip = (file: File) =>
    attempt(async () => {
      await clips.current!.importClip((target) => session.importFiles([target]).then(() => {}));
      setStatus(`${file.name} was added to Project media.`);
    }, "Import failed. Download the file or retry.");
  const addTake = (takeName: string) =>
    attempt(async () => {
      let where: Awaited<ReturnType<typeof addTakeToProject>> | undefined;
      await capture.current!.importTake(async (target) => {
        where = await addTakeToProject(session, target.file, target.marks);
      });
      if (where) setStatus(placedMessage(takeName, where));
    }, "Import failed. Download the file or retry.");
  const dropRecovered = (fileName: string) => {
    void removeTake(fileName);
    setRecovered((items) => items.filter((item) => item.fileName !== fileName));
  };
  const downloadRecovered = (fileName: string) =>
    attempt(async () => {
      const url = URL.createObjectURL(await takeFile(fileName));
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, "The take could not be read from this device.");
  const toggleClips = () =>
    attempt(async () => {
      if (armed || clipState.buffer.kind === "failed") await clips.current!.disarm();
      else await clips.current!.arm();
    }, "Recent clips could not start.");
  const saveClip = (seconds: 30 | 60) =>
    attempt(() => clips.current!.save(seconds), "The clip could not be saved.");

  const stageSources = editSources.map((source) => ({
    id: source.id,
    label: source.label,
    layout: source.layout,
    aspect: sourceAspect(source.video),
  }));
  const startDisabled =
    !frame || (program.kind !== "idle" && program.kind !== "failed" && program.kind !== "uploaded");

  return (
    <div className="studio-layout">
      <div className="grid gap-3">
        <div className="studio-program-frame">
          <div
            className="studio-program"
            style={{ ["--studio-aspect" as string]: String(canvasAspect()) }}
            data-recording={recording || undefined}
          >
            <canvas ref={canvas} aria-label="Program output" data-scene={frame ?? ""} />
            {frame && editingProgram && (
              <SourceStage
                sources={stageSources}
                canvasAspect={canvasAspect()}
                selected={selectedSource}
                onSelect={setSelectedSource}
                onChange={placeSource}
              />
            )}
            {frame && selectedOverlay && (
              <OverlayStage
                overlays={draft.overlays.map((overlay) => ({ ...overlay, label: overlay.text }))}
                selected={selectedOverlay}
                onSelect={setSelectedOverlay}
                onChange={(id, rect) =>
                  setDraft((current) => ({
                    ...current,
                    overlays: current.overlays.map((overlay) =>
                      overlay.id === id ? { ...overlay, ...rect } : overlay,
                    ),
                  }))
                }
              />
            )}
            {!active && !loading && (
              <p className="studio-program-empty">
                Save a scene from the editor, then go live with it to start the program output.
              </p>
            )}
            {recording && (
              <span className="studio-rec-badge" aria-hidden>
                REC
              </span>
            )}
          </div>
        </div>
        <SceneDeck
          scenes={scenes}
          activeId={active?.id ?? null}
          live={captureActive || (mode !== "record" && canStream)}
          onSwitch={(id) => void switchOnAir(id)}
        />
        {(error || captureFailure) && (
          <p role="alert" className="studio-alert">
            {error || captureFailure}
          </p>
        )}
        <p role="status" aria-live="polite" className="text-muted-foreground empty:hidden">
          {loading ? "Opening saved scenes…" : status || captureNotice}
        </p>
        <Section title="Go">
          <RadioGroup
            aria-label="Output"
            className="studio-modes"
            value={mode}
            disabled={busy}
            onValueChange={(value) => setMode(value as typeof mode)}
          >
            {(
              [
                ["record", "Record", RiRecordCircleLine],
                ["live", "Live", RiBroadcastLine],
                ["both", "Both", RiStackLine],
              ] as const
            ).map(([value, label, Icon]) => (
              <label key={value} data-checked={mode === value || undefined}>
                <RadioPrimitive.Root value={value} className="sr-only" />
                <span className="studio-mode-title">
                  <Icon aria-hidden />
                  {label}
                </span>
                {value !== "record" && !canStream && <small>Desktop app</small>}
              </label>
            ))}
          </RadioGroup>
          {mode !== "record" &&
            (canStream ? (
              <>
                <p className="text-muted-foreground">
                  The desktop app streams to RTMP and keeps a recording on this computer. Studio
                  scenes are not streamed yet: it captures the screen or camera you pick below.
                </p>
                <NativeRecordingControls />
              </>
            ) : (
              <p className="text-muted-foreground">
                Going live needs the raE.E desktop app. In the browser you can record the program.
              </p>
            ))}
          {mode === "record" && (
            <>
              <div className="studio-go-row">
                {recording ? (
                  <Button
                    variant="destructive"
                    className="studio-go-button"
                    onClick={() => capture.current!.stop()}
                  >
                    <RiStopFill data-icon="inline-start" />
                    Stop recording
                  </Button>
                ) : (
                  <Button
                    className="studio-go-button"
                    disabled={startDisabled}
                    onClick={() => void startRecording()}
                  >
                    <RiRecordCircleFill data-icon="inline-start" className="text-red-500" />
                    Start recording
                  </Button>
                )}
                {recording && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void attempt(() => capture.current!.mark(), "The mark could not be added.")
                    }
                  >
                    <RiFlagLine data-icon="inline-start" />
                    Mark moment
                  </Button>
                )}
                <div className="studio-save-to">
                  <span id="studio-save-to-label">Save to</span>
                  <Select
                    value={toCloud ? "cloud" : "device"}
                    disabled={busy}
                    onValueChange={(value) => setSaveTo(value === "cloud" ? "cloud" : "device")}
                  >
                    <SelectTrigger aria-labelledby="studio-save-to-label" className="min-w-40">
                      <SelectValue>
                        {(value: string) =>
                          value === "cloud" ? (
                            <>
                              <RiCloudLine className="text-muted-foreground" />
                              {cloud.state === "ready" ? cloud.teamName : "Cloud"}
                            </>
                          ) : (
                            <>
                              <RiComputerLine className="text-muted-foreground" />
                              This device
                            </>
                          )
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end" alignItemWithTrigger={false}>
                      <SelectItem value="device">
                        <RiComputerLine className="text-muted-foreground" />
                        This device
                      </SelectItem>
                      <SelectItem value="cloud" disabled={cloud.state !== "ready"}>
                        <RiCloudLine className="text-muted-foreground" />
                        {cloud.state === "ready"
                          ? `Cloud · ${cloud.teamName}`
                          : "Cloud · not set up"}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {recording ? (
                  <span role="status">
                    Recording program output…
                    {markCount ? ` ${markCount} ${markCount === 1 ? "mark" : "marks"}` : ""}
                  </span>
                ) : program.kind === "starting" ? (
                  <span role="status">Starting recording…</span>
                ) : program.kind === "stopping" || (program.kind === "saving" && !program.cloud) ? (
                  <span role="status">Saving the take…</span>
                ) : !frame ? (
                  "Go live with a scene to enable recording."
                ) : cloud.state !== "ready" ? (
                  cloud.reason
                ) : toCloud ? (
                  "Uploads while you record. When you stop, the take opens in the editor."
                ) : (
                  "Takes stay in this browser until you add them to the project or download them."
                )}
              </p>
              {shownProgress && (
                <p role="status">
                  {uploading ? "Finishing upload:" : "Uploaded"}{" "}
                  {megabytes(shownProgress.sentBytes)} of {megabytes(shownProgress.recordedBytes)}{" "}
                  recorded
                </p>
              )}
              {take && (
                <div className="studio-item">
                  <span className="min-w-0 flex-1 truncate">{take.file.name}</span>
                  <Button
                    size="sm"
                    disabled={blocked || program.kind === "importing"}
                    onClick={() => void addTake(take.file.name)}
                  >
                    Add take to project
                  </Button>
                  <a
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    href={take.url}
                    download={take.file.name}
                  >
                    Download take
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={program.kind === "importing"}
                    onClick={() => capture.current!.discard()}
                  >
                    Discard take
                  </Button>
                </div>
              )}
            </>
          )}
        </Section>
        <LiveChatPanel mode={mode} controller={liveChat} />
        {recovered.length > 0 && (
          <Section
            title="Recovered takes"
            description="Takes left on this device by an earlier visit. Interrupted takes may end abruptly."
          >
            <ul className="grid gap-1.5">
              {recovered.map((item) => (
                <li key={item.fileName} className="studio-item">
                  <span className="min-w-0 flex-1 truncate">
                    {new Date(item.startedAt).toLocaleString()} · {megabytes(item.bytes)}
                    {item.state === "recording" ? " · interrupted" : ""}
                  </span>
                  <Button
                    size="sm"
                    disabled={blocked}
                    onClick={() =>
                      void attempt(async () => {
                        const file = await takeFile(item.fileName);
                        const where = await addTakeToProject(session, file, item.marks);
                        dropRecovered(item.fileName);
                        setStatus(placedMessage(file.name, where));
                      }, "The take could not be added. Download it or retry.")
                    }
                  >
                    Add to project
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void downloadRecovered(item.fileName)}
                  >
                    Download
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => dropRecovered(item.fileName)}>
                    Discard
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section
          title="Recent clips"
          description="Keep a rolling buffer of the program and save the last 30 or 60 seconds."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={armed ? "secondary" : "outline"}
              disabled={
                !frame ||
                clipState.buffer.kind === "arming" ||
                clipState.buffer.kind === "stopping" ||
                saving
              }
              onClick={() => void toggleClips()}
            >
              {armed ? "Stop buffer" : "Arm buffer"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!armed}
              onClick={() =>
                void attempt(
                  () => clips.current!.mark("Studio mark"),
                  "The mark could not be added.",
                )
              }
            >
              Add mark
            </Button>
            {([30, 60] as const).map((seconds) => (
              <Button
                key={seconds}
                size="sm"
                variant="outline"
                disabled={!armed || saving || clipState.product.kind === "importing"}
                onClick={() => void saveClip(seconds)}
              >
                Save last {seconds}s
              </Button>
            ))}
          </div>
          {clip && (
            <div className="studio-item">
              <span className="min-w-0 flex-1 truncate">
                {clip.file.name} · {clip.marks} {clip.marks === 1 ? "mark" : "marks"}
              </span>
              <Button
                size="sm"
                disabled={blocked || clipState.product.kind === "importing"}
                onClick={() => void addClip(clip.file)}
              >
                Add clip to project
              </Button>
              <a
                className={buttonVariants({ size: "sm", variant: "outline" })}
                href={clip.url}
                download={clip.file.name}
              >
                Download clip
              </a>
              <Button
                size="sm"
                variant="ghost"
                disabled={clipState.product.kind === "importing"}
                onClick={() => clips.current!.discard()}
              >
                Discard clip
              </Button>
            </div>
          )}
        </Section>
      </div>
      <div className="grid gap-3">
        <Section
          title="Scenes"
          description="Pick a scene to edit its look. Go live puts it on the program."
        >
          {scenes.length > 0 && (
            <RadioGroup
              aria-label="Scenes"
              className="studio-list"
              render={<ul />}
              value={selected}
              onValueChange={(value) => setSelected(value as string)}
            >
              {scenes.map((scene) => {
                const live = active?.id === scene.id;
                return (
                  <li
                    key={scene.id}
                    className="studio-row"
                    data-selected={selected === scene.id || undefined}
                  >
                    <label className="studio-row-main">
                      <RadioPrimitive.Root value={scene.id} className="sr-only" />
                      <span className="truncate">{scene.name}</span>
                      {live && <span className="studio-live-badge">Live</span>}
                    </label>
                    {!live && (
                      <Button
                        size="xs"
                        aria-label={`Switch to ${scene.name}`}
                        onClick={() => void switchTo(scene.id)}
                      >
                        Go live
                      </Button>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Update ${scene.name} from editor`}
                      title="Update from editor"
                      onClick={() => void saveFromEditor({ id: scene.id, name: scene.name })}
                    >
                      <RiRefreshLine />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${scene.name}`}
                      title={live ? "Go live with another scene first" : "Remove scene"}
                      disabled={live}
                      onClick={() => void remove(scene.id)}
                    >
                      <RiDeleteBinLine />
                    </Button>
                  </li>
                );
              })}
            </RadioGroup>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!loading && name.trim()) void saveFromEditor();
            }}
          >
            <Input
              aria-label="New scene name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" disabled={loading || !name.trim()}>
              <RiAddLine data-icon="inline-start" />
              Save from editor
            </Button>
          </form>
        </Section>
        <Section
          title="Sources"
          description={
            selectedScene && !editingProgram ? (
              <>
                Arranging <strong className="text-foreground">{selectedScene.name}</strong>. Go live
                with it to drag its sources on the preview.
              </>
            ) : editSources.length ? (
              "Drag a source on the preview to move it, or drag its corners to resize. Hold Alt to stop snapping."
            ) : (
              "Add a camera or share a screen to put it on this scene."
            )
          }
          action={
            <>
              {cameraDevices.length > 1 ? (
                <Select
                  key={cameraSelectKey}
                  value=""
                  onValueChange={(val) => {
                    if (!val) return;
                    void addSource("camera", val);
                    setCameraSelectKey((k) => k + 1);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Add camera"
                    className="h-7 text-[0.8rem] rounded-[min(var(--radius-md),12px)] px-2.5"
                  >
                    <RiVideoOnLine data-icon="inline-start" className="size-3.5" />
                    <span>Add camera</span>
                  </SelectTrigger>
                  <SelectContent align="end" alignItemWithTrigger={false}>
                    {cameraDevices.map((device) => {
                      const isUsed = usedCameraDeviceIds.has(device.deviceId);
                      return (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label}
                          {isUsed ? " (in use)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void addSource("camera", cameraDevices[0]?.deviceId)}
                >
                  <RiVideoOnLine data-icon="inline-start" />
                  Add camera
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => void addSource("screen")}>
                <RiComputerLine data-icon="inline-start" />
                Add screen
              </Button>
            </>
          }
        >
          {otherSources.length > 0 && (
            <Select
              value=""
              onValueChange={(value) => {
                if (value) addExisting(value as string);
              }}
            >
              <SelectTrigger size="sm" aria-label="Add an open source" className="w-fit">
                <RiAddLine data-icon="inline-start" className="size-3.5" />
                <span>Add from another scene</span>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {otherSources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.kind === "camera" ? <RiVideoOnLine /> : <RiComputerLine />}
                    {source.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {scenePlacements.length > 0 && (
            <ul className="studio-list">
              {/* Top layer first, like a layers panel. */}
              {[...scenePlacements].reverse().map((placement, fromTop, list) => {
                const identity = placement.identity ?? placement.sourceId ?? "";
                const live = sources.current.find(
                  (s) => s.identity === identity || s.id === identity,
                );

                if (live) {
                  const isSelected = selectedSource === live.id;
                  const aspects = [canvasAspect(), sourceAspect(live.video)] as const;
                  return (
                    <li
                      key={live.id}
                      className="studio-row"
                      data-selected={isSelected || undefined}
                    >
                      <button
                        type="button"
                        className="studio-row-main"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedSource(isSelected ? null : live.id)}
                      >
                        {live.kind === "camera" ? <RiVideoOnLine /> : <RiComputerLine />}
                        <span className="truncate">{live.label}</span>
                      </button>
                      {live.kind === "camera" && cameraDevices.length > 0 && (
                        <Select
                          value={live.deviceId || ""}
                          onValueChange={(val) => {
                            if (!val || val === live.deviceId) return;
                            void switchCameraDevice(live.id, val);
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`Switch camera for ${live.label}`}
                            title="Switch camera device"
                            className="h-6 max-w-28 px-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                          >
                            <SelectValue placeholder="Camera">
                              {cameraDevices.find((d) => d.deviceId === live.deviceId)?.label ??
                                cameraDevices[0]?.label ??
                                "Camera"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end" alignItemWithTrigger={false}>
                            {cameraDevices.map((device) => {
                              const isCurrent = device.deviceId === live.deviceId;
                              const isUsed = usedCameraDeviceIds.has(device.deviceId) && !isCurrent;
                              return (
                                <SelectItem key={device.deviceId} value={device.deviceId}>
                                  {device.label}
                                  {isUsed ? " (in use)" : ""}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Fit ${live.label} to the frame`}
                        title="Fit to frame"
                        onClick={() => placeSource(live.id, fitLayout(...aspects))}
                      >
                        <RiFullscreenExitLine />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Fill the frame with ${live.label}`}
                        title="Fill frame"
                        onClick={() => placeSource(live.id, fillLayout(...aspects))}
                      >
                        <RiFullscreenLine />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Bring ${live.label} forward`}
                        title="Bring forward"
                        disabled={fromTop === 0}
                        onClick={() => restack(live.id, 1)}
                      >
                        <RiArrowUpLine />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Send ${live.label} backward`}
                        title="Send backward"
                        disabled={fromTop === list.length - 1}
                        onClick={() => restack(live.id, -1)}
                      >
                        <RiArrowDownLine />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${live.label}`}
                        title="Remove from this scene"
                        onClick={() => removeSource(live.id)}
                      >
                        <RiCloseLine />
                      </Button>
                    </li>
                  );
                }

                const label =
                  placement.label ?? (identity.startsWith("screen:") ? "Screen" : "Camera");
                const kind =
                  placement.kind ?? (identity.startsWith("screen:") ? "screen" : "camera");
                const deviceId =
                  placement.deviceId ??
                  (identity.startsWith("camera:") ? identity.slice("camera:".length) : undefined);

                return (
                  <li key={identity} className="studio-row opacity-60">
                    <div className="studio-row-main min-w-0">
                      {kind === "camera" ? <RiVideoOnLine /> : <RiComputerLine />}
                      <span className="truncate">{label} · not connected</span>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        if (kind === "camera") {
                          void addSource(
                            "camera",
                            deviceId === "default" ? undefined : deviceId,
                            identity,
                            label,
                          );
                        } else {
                          void addSource("screen", undefined, identity, label);
                        }
                      }}
                    >
                      Reconnect
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${label}`}
                      title="Remove from this scene"
                      onClick={() => removeSource(identity)}
                    >
                      <RiCloseLine />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section
          title="Scene look"
          description={
            selectedScene ? (
              <>
                Editing <strong className="text-foreground">{selectedScene.name}</strong>
              </>
            ) : undefined
          }
        >
          <SceneLookPanel
            draft={draft}
            onDraftChange={setDraft}
            disabled={!selectedScene}
            dirty={JSON.stringify(draft) !== savedLook}
            canPlace={Boolean(frame)}
            selectedOverlay={selectedOverlay}
            onSelectOverlay={setSelectedOverlay}
            onSave={(goLive) => void applyLook(goLive)}
          />
        </Section>
        <Section
          title="Audio"
          action={<SoundboardToggle open={soundboardOpen} onOpenChange={setSoundboardOpen} />}
        >
          <AudioMixerPanel
            channels={audioInputs.current.map((input) => ({
              id: input.id,
              label: input.label,
              kind: input.kind,
              settings: settings[input.id] ?? DEFAULT_LIVE_AUDIO,
              level: meters[input.id] ?? 0,
              gated: !isAudioInputOpen(input, liveKey, arrangement),
            }))}
            devices={audioDevices}
            onAddInput={(deviceId) => void addMicrophone(deviceId)}
            onUpdate={(id, change) => {
              const input = audioInputs.current.find((item) => item.id === id);
              if (input) updateInput(input, change);
            }}
            onRemove={removeInput}
          />
        </Section>
      </div>
      <Soundboard
        open={soundboardOpen}
        onOpenChange={setSoundboardOpen}
        decode={decodeSound}
        play={playPad}
        stop={stopPad}
        actions={{
          scenes: scenes.map((scene) => ({ id: scene.id, name: scene.name })),
          overlays: draft.overlays.map((overlay) => ({ id: overlay.id, text: overlay.text })),
          switchScene: (id) => void switchTo(id),
          setOverlay: setLiveOverlay,
          record: (action) => {
            if (action === "start" && !recording && !startDisabled) void startRecording();
            if (action === "stop" && recording) capture.current?.stop();
          },
          mark: () => {
            if (recording)
              void attempt(() => capture.current!.mark(), "The mark could not be added.");
          },
        }}
      />
    </div>
  );
}

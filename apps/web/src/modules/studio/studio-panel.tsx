import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DEFAULT_LIVE_ASSETS, liveAssets } from "@raee/core/live-assets";
import type { LiveAssets } from "@raee/core/live-assets";
import { DEFAULT_LIVE_AUDIO, type LiveAudioSettings } from "@raee/core/live-audio";
import type { LiveStudio } from "@raee/core/live-studio";
import { LiveAudioMixer, type LiveAudioChannel } from "@raee/platform-browser/live-audio";
import { LiveStudioOutput } from "@raee/platform-browser/live-studio";
import { LocalMediaReader } from "@raee/platform-browser/preview";
import { RecentClips } from "@raee/platform-browser/recent-clips";
import { recordingLimits } from "@raee/platform-browser/recording";
import { useLiveChatController } from "./live-chat-controller";
import { LiveChatPanel } from "./live-chat-panel";
import { Button, buttonVariants } from "@raee/ui/components/button";
import { Input } from "@raee/ui/components/input";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { Toggle } from "@ui-sdk/react/toggle";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@raee/ui/components/select";
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
  RiFilmLine,
  RiMicLine,
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
  bufferCapturing,
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
import { withCaptureGrant } from "./capture-grant";
import {
  AUDIO_BITRATE,
  FRAME_RATES,
  OUTPUT_HEIGHTS,
  describeQuality,
  setOutputQuality,
  useOutputQuality,
  videoBitrate,
} from "./output-quality";
import { useScreenPicker } from "./screen-picker";
import { OverlayStage } from "./overlay-stage";
import { SceneDeck } from "./scene-deck";
import { SceneLookPanel } from "./scene-look-panel";
import { lookForScene, programLook, type LookDraft } from "./scene-look";
import {
  PRE_SCENE,
  SceneSources,
  baseIdentity,
  hasPicture,
  type Placement,
  type SavedArrangements,
} from "./scene-sources";
import { Soundboard, SoundboardToggle } from "./soundboard";
import { SourceStage } from "./source-stage";
import { activeLiveSceneKey, gateSourceKey, isAudioInputOpen } from "./audio-gate";
import "./studio.css";

/** A source with a picture: a live camera or screen, or a project video playing on loop. */
type VideoSource = {
  id: string;
  identity: string;
  kind: "camera" | "screen" | "video";
  label: string;
  video: HTMLVideoElement;
  /** Live capture; video files play from `url` instead. */
  stream: MediaStream | null;
  url?: string | undefined;
  deviceId?: string | undefined;
  mediaId?: string | undefined;
  /** The desktop app's id for the screen or window being captured. */
  display?: string | undefined;
};
type AudioInput = {
  id: string;
  label: string;
  kind: "microphone" | "screen" | "camera" | "video";
  /** The video source this audio belongs to; it is removed with that source. */
  sourceId?: string;
  /** Set for a microphone that belongs to scenes rather than every scene. */
  identity?: string;
  stream: MediaStream | null;
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

function SourceIcon({ kind }: { kind: Placement["kind"] }) {
  if (kind === "camera") return <RiVideoOnLine />;
  if (kind === "video") return <RiFilmLine />;
  if (kind === "audio") return <RiMicLine />;
  return <RiComputerLine />;
}

/** A file name to show for a project video. */
const mediaName = (path: string) => path.split(/[\\/]/).pop() || "Video";

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
          <h2>{title}</h2>
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
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const studio = useRef<LiveStudio | null>(null);
  const output = useRef<LiveStudioOutput | null>(null);
  const previewOutput = useRef<LiveStudioOutput | null>(null);
  const mixer = useRef<LiveAudioMixer | null>(null);
  const screenPicker = useScreenPicker();
  /** Every open camera, screen and video; each belongs to one scene. */
  const sources = useRef<VideoSource[]>([]);
  /** This render's video opener, for the long-lived load effect. */
  const latestOpenVideo = useRef<
    ((mediaId: string, identity?: string) => Promise<VideoSource>) | null
  >(null);
  /** This render's source restorer, for the long-lived load effect. */
  const latestRestore = useRef<(() => Promise<void>) | null>(null);
  /** Set while the panel is closing, so a source that opens late is stopped, not kept. */
  const closing = useRef(false);
  const quality = useOutputQuality();
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  /** Which open sources each scene shows, and where. */
  const arrangement = useRef(new SceneSources()).current;
  /** The sources a scene shows, bottom layer first. */
  const shown = useCallback(
    (scene: string): ShownSource[] =>
      arrangement.of(scene).flatMap((placement) => {
        const id = placement.identity;
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
      const key = gateSourceKey(input, sources.current);
      const open = isAudioInputOpen({ sourceId: key }, liveKey, arrangement);
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
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const [name, setName] = useState("Scene 1");
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [draft, setDraft] = useState<LiveAssets>(DEFAULT_LIVE_ASSETS);
  const draftScene = useRef<string | null>(null);
  /** What the canvas painters read: the draft scoped to each canvas's own scene. */
  const lookRef = useRef<LookDraft>({ sceneId: null, assets: DEFAULT_LIVE_ASSETS });
  lookRef.current = { sceneId: draftScene.current, assets: draft };
  const loadLook = useCallback((sceneId: string | null, assets: LiveAssets) => {
    draftScene.current = sceneId;
    setDraft(assets);
  }, []);
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
  /** The preview canvas's shape; scenes off air may use another output size. */
  const previewAspect = () => {
    const element = previewCanvas.current;
    return previewFrame && element?.width && element.height
      ? element.width / element.height
      : 16 / 9;
  };
  /** The look as last saved, to tell the user when the draft has unsaved changes. */
  const [savedLook, setSavedLook] = useState("");
  const [settings, setSettings] = useState<Record<string, LiveAudioSettings>>({});
  const { devices: audioDevices } = useAudioInputDevices();
  const { devices: cameraDevices, refresh: refreshCameraDevices } = useCameraDevices();
  const [cameraSelectKey, setCameraSelectKey] = useState(0);
  const [mediaSelectKey, setMediaSelectKey] = useState(0);
  const projectVideos = snapshot.project.media.filter((media) => media.kind === "video");
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
  // The clip controller is the only source for buffer and saved-clip UI. The program effect's
  // cleanup closes it, so a re-run of that effect (StrictMode in development) needs a new one.
  if (!clips.current || clips.current.state.product.kind === "closed")
    clips.current = new ClipCapture({
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
  // Like the clip controller, it is replaced once the program effect's cleanup has closed it.
  if (!capture.current || capture.current.state.kind === "closed")
    capture.current = new StudioCapture({
      acquire: async () => (await latestStream.current!()).stream,
      createRecorder: (stream) => {
        return new MediaRecorder(stream, {
          mimeType: "video/webm;codecs=vp8,opus",
          videoBitsPerSecond: videoBitrate(qualityRef.current),
          audioBitsPerSecond: AUDIO_BITRATE,
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

  // A new quality resizes the program from its next frame; it is locked while capturing.
  useEffect(() => {
    output.current?.setMaxOutputHeight(quality.height);
  }, [quality.height]);
  // Program output: loads saved scenes, then paints the active one while the panel is open.
  useEffect(() => {
    let alive = true;
    closing.current = false;
    // A re-run follows a cleanup that closed both controllers; render again to replace them.
    if (capture.current?.state.kind === "closed" || clips.current?.state.product.kind === "closed")
      setVersion((value) => value + 1);
    let timer: ReturnType<typeof setTimeout> | undefined;
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
        // Forget arrangements of scenes that no longer exist, so they never keep a source "used".
        const sceneIds = new Set(loaded.list().map((scene) => scene.id));
        arrangement.restore(
          Object.fromEntries(
            Object.entries(loadedArrangements.scenes).filter(
              ([scene]) => sceneIds.has(scene) || (scene === "" && sceneIds.size === 0),
            ),
          ),
        );
        // Project videos need no permission prompt, so saved ones come back on their own.
        for (const placement of Object.values(arrangement.serialize()).flat())
          if (placement.kind === "video" && placement.mediaId)
            void latestOpenVideo.current?.(placement.mediaId, placement.identity).catch(() => {});
        // Cameras, microphones and screens come back too when no prompt is needed.
        void latestRestore.current?.();
        const initialSelected = loaded.activeScene?.id ?? loaded.list()[0]?.id ?? null;
        if (initialSelected) {
          try {
            const saved = liveAssets(
              loaded.project(initialSelected).liveAssets ?? DEFAULT_LIVE_ASSETS,
            );
            loadLook(initialSelected, saved);
            setSavedLook(JSON.stringify(saved));
          } catch {
            loadLook(initialSelected, DEFAULT_LIVE_ASSETS);
          }
        }
        // The preview shows the selected scene while it is not the one on air.
        const previewScene = () => {
          const id = selectedRef.current;
          if (!id || id === loaded.activeScene?.id) return undefined;
          return loaded.list().some((scene) => scene.id === id) ? id : undefined;
        };
        output.current = new LiveStudioOutput(
          canvas.current,
          loaded,
          reader,
          { target: "stream", chat: liveChatRef.current },
          (context) => paintSources(context, shown(loaded.activeScene?.id ?? "")),
          // Real-time software compositing and VP8 encoding cannot sustain a 4K project canvas.
          qualityRef.current.height,
          (sceneId) =>
            programLook(sceneId, lookRef.current, {
              // Captures must not include unsaved looks.
              recording: captureActiveRef.current,
              buffering: Boolean(clips.current && bufferCapturing(clips.current.state.buffer)),
            }),
        );
        if (previewCanvas.current) {
          previewOutput.current = new LiveStudioOutput(
            previewCanvas.current,
            loaded,
            reader,
            undefined,
            (context) => {
              const id = previewScene();
              if (id) paintSources(context, shown(id));
            },
            1080,
            (sceneId) => lookForScene(sceneId, lookRef.current),
            previewScene,
          );
        }
        setSelected(initialSelected);
        setName(`Scene ${loaded.list().length + 1}`);
        const origin = performance.now();
        // A timer, not rAF: a backgrounded window must keep feeding an active recording.
        // It re-arms each frame so a new output frame rate applies straight away.
        const tick = () => {
          const time = (performance.now() - origin) / 1000;
          if (loaded.activeScene) {
            output.current
              ?.render(time)
              .then((painted) => {
                if (alive && painted) setFrame(painted.sceneId);
              })
              .catch((cause: unknown) => {
                if (alive) setError(message(cause, "The scene could not be rendered."));
              });
          }
          const scene = previewScene();
          if (scene) {
            previewOutput.current
              ?.render(time)
              .then((painted) => {
                if (alive && painted) setPreviewFrame(painted.sceneId);
              })
              .catch((cause: unknown) => {
                if (alive && previewScene() === scene)
                  setError(message(cause, "The scene could not be rendered."));
              });
          }
          if (alive) timer = setTimeout(tick, 1000 / qualityRef.current.frameRate);
        };
        tick();
      })
      .catch((cause: unknown) => {
        if (alive) setError(`Saved scenes could not be opened. ${message(cause, "")}`.trim());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      closing.current = true;
      clearTimeout(timer);
      void clips.current?.close();
      capture.current?.close();
      output.current?.close();
      output.current = null;
      previewOutput.current?.close();
      previewOutput.current = null;
      for (const source of [...sources.current, ...audioInputs.current])
        for (const track of source.stream?.getTracks() ?? []) track.stop();
      for (const source of sources.current) {
        source.video.onresize = null;
        source.video.pause();
        if (source.url) URL.revokeObjectURL(source.url);
      }
      sources.current = [];
      arrangement.clear();
      audioInputs.current = [];
      mixer.current?.close();
      void mixer.current?.context.close();
      mixer.current = null;
      for (const entry of readers.values()) void entry.then((item) => item.close()).catch(() => {});
    };
  }, [arrangement, loadLook, projectID, session, shown]);

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
      loadLook(selected, saved);
      setSavedLook(JSON.stringify(saved));
    } catch {
      loadLook(selected, DEFAULT_LIVE_ASSETS);
      setSavedLook(JSON.stringify(DEFAULT_LIVE_ASSETS));
    }
  }, [loadLook, selected]);

  const scenes = studio.current?.list() ?? [];
  const active = studio.current?.activeScene ?? null;
  const liveKey = activeLiveSceneKey(active, scenes.length > 0);
  useEffect(() => {
    syncAudioGates();
  }, [syncAudioGates, liveKey]);
  const selectedScene = scenes.find((scene) => scene.id === selected);
  /** The Sources panel arranges the selected scene ("" before any scene exists). */
  const editKey = selected ?? PRE_SCENE;
  const editSources = shown(editKey);
  const scenePlacements = arrangement.of(editKey);
  /** Connected sources on other scenes, which this scene can copy. */
  const otherSources = sources.current.filter(
    (source) => !arrangement.has(editKey, source.identity),
  );
  const otherMics = audioInputs.current.filter(
    (input) => input.identity && !arrangement.has(editKey, input.identity),
  );
  /** Sources can be dragged only while a canvas shows the scene being arranged. */
  const editingProgram = Boolean(active && active.id === editKey);
  /** The selected scene is not on air, so it gets its own preview canvas. */
  const previewing = Boolean(selectedScene && selectedScene.id !== active?.id);
  /** The preview has painted the selected scene at least once. */
  const previewPainted = previewing && previewFrame === editKey;
  /** The canvas being arranged has content, so its drag handles can show. */
  const editReady = editingProgram ? frame !== null : previewPainted;

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
      // A new scene starts with its own copies of the sources of the scene it was made from;
      // sources arranged before any scene existed move into the first scene.
      if (!existing) {
        const from = selectedRef.current;
        if (from) for (const placement of arrangement.of(from)) duplicateInto(id, placement);
        else {
          arrangement.copy(PRE_SCENE, id);
          arrangement.drop(PRE_SCENE);
        }
        commitArrangements();
      }
      // With nothing on air yet, the first scene goes straight to the program.
      if (!existing && !current.activeScene)
        current.switch({ id, expectedRevision: current.currentRevision });
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
      for (const orphan of arrangement.drop(id)) disconnectSource(orphan);
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
    if (!source) {
      // A scene microphone has no picture; close its input instead.
      const mic = audioInputs.current.find((input) => input.identity === id);
      if (mic) removeInput(mic.id);
      return;
    }
    sources.current = sources.current.filter((item) => item.id !== source.id);
    for (const track of source.stream?.getTracks() ?? []) track.stop();
    source.video.onresize = null;
    source.video.pause();
    source.video.srcObject = null;
    if (source.url) {
      source.video.removeAttribute("src");
      URL.revokeObjectURL(source.url);
    }
    for (const input of audioInputs.current)
      if (input.sourceId === source.id) removeInput(input.id);
    setSelectedSource((current) => (current === source.id ? null : current));
    refresh();
  };

  /** Places a source on a scene, screens under cameras so a share never hides the presenter. */
  const placeOnScene = (scene: string, source: VideoSource) => {
    // Count sources that are not connected too, so a new one never takes their slot or layer.
    // Videos fill the frame like screens and go under the cameras with them.
    const role = source.kind === "camera" ? "camera" : "screen";
    const roleOf = (kind: string) => (kind === "camera" ? "camera" : "screen");
    const placed = arrangement.of(scene).filter((item) => hasPicture(item.kind));
    const same = placed.filter((item) => roleOf(item.kind) === role);
    const onProgram = scene === (studio.current?.activeScene?.id ?? "");
    const layout = defaultLayout(
      role,
      same.length,
      onProgram ? canvasAspect() : previewAspect(),
      sourceAspect(source.video),
    );
    const all = arrangement.of(scene);
    const firstCamera = all.findIndex((item) => item.kind === "camera");
    const at = role === "screen" && firstCamera >= 0 ? firstCamera : all.length;
    arrangement.add(
      scene,
      {
        identity: source.identity,
        label: source.label,
        kind: source.kind,
        deviceId: source.deviceId,
        mediaId: source.mediaId,
        display: source.display,
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
    if (removedLast) disconnectSource(source ? source.id : targetId);
    setSelectedSource((current) => (current === id || current === targetId ? null : current));
    refresh();
  };
  /** Identities of every open source and scene microphone. */
  const openIdentities = () => [
    ...sources.current.map((source) => source.identity),
    ...audioInputs.current.flatMap((input) => (input.identity ? [input.identity] : [])),
  ];
  /** Opens a second, independent capture of an open camera or screen under a new identity. */
  const cloneStreamSource = async (from: VideoSource, identity: string) => {
    if (!from.stream) return;
    const stream = from.stream.clone();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (cause) {
      for (const track of stream.getTracks()) track.stop();
      throw cause;
    }
    if (closing.current || sources.current.some((item) => item.identity === identity)) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const id = crypto.randomUUID();
    const { kind, label, deviceId, display } = from;
    const source: VideoSource = { id, identity, kind, label, video, stream, deviceId, display };
    sources.current = [...sources.current, source];
    video.onresize = refresh;
    stream.getVideoTracks()[0]?.addEventListener(
      "ended",
      () => {
        if (sources.current.find((item) => item.id === id)?.stream === stream) disconnectSource(id);
      },
      { once: true },
    );
    if (stream.getAudioTracks().length && kind !== "video") {
      const audio = await ensureMixer();
      const audioID = `${id}:audio`;
      const channel = audio.addStream(audioID, new MediaStream(stream.getAudioTracks()));
      setSettings((current) => ({ ...current, [audioID]: DEFAULT_LIVE_AUDIO }));
      audioInputs.current = [
        ...audioInputs.current,
        { id: audioID, label, kind, sourceId: id, stream, channel },
      ];
    }
    refresh();
  };
  /**
   * Gives `scene` its own copy of a source placed on another scene: same place, a new
   * identity, and its own capture, so changing one never touches the other.
   */
  const duplicateInto = (scene: string, placement: Placement) => {
    const identity = arrangement.unique(baseIdentity(placement.identity), openIdentities());
    arrangement.add(scene, { ...placement, identity });
    const live = sources.current.find((item) => item.identity === placement.identity);
    const mic = audioInputs.current.find((input) => input.identity === placement.identity);
    if (live?.kind === "video" && live.mediaId) {
      const mediaId = live.mediaId;
      void attempt(() => openVideo(mediaId, identity), "Could not open the video.");
    } else if (live) {
      void attempt(() => cloneStreamSource(live, identity), `Could not copy ${live.label}.`);
    } else if (mic) {
      void attempt(
        () => openSceneAudio(placement.deviceId, identity, placement.label),
        "Could not start the microphone.",
      );
    }
    return identity;
  };
  /** Copies a source from another scene into the scene being arranged. */
  const copyFromScene = (identity: string) => {
    const placement = Object.values(arrangement.serialize())
      .flat()
      .find((item) => item.identity === identity);
    if (!placement) return;
    duplicateInto(editKey, placement);
    commitArrangements();
    refresh();
  };
  /**
   * Null when the person closes the picker. A saved desktop `display` reopens without the picker.
   * `display` in the result is the desktop app's id for what was picked, to reopen it later.
   */
  const openScreen = async (saved?: string) => {
    const display = saved ?? (await screenPicker.pick());
    if (display === null) return null;
    // In a browser, tab or system audio comes along when the user ticks "Share audio".
    if (display === undefined)
      return { stream: await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }) };
    const stream = await withCaptureGrant(
      "screen",
      () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
      { display },
    );
    return { stream, display };
  };
  /**
   * Opens a camera or screen. `restore` reopens a saved source quietly: it keeps its saved
   * places, takes no other device in its stead, and leaves the selection alone.
   */
  const connectSource = async (
    kind: VideoSource["kind"],
    chosenDeviceId?: string,
    targetIdentity?: string,
    targetLabel?: string,
    { restore = false, display: savedDisplay }: { restore?: boolean; display?: string } = {},
  ) => {
    // The scene picked when the user asked, even if they pick another while a prompt is open.
    const scene = selectedRef.current ?? "";
    let stream: MediaStream;
    let display: string | undefined;
    if (kind === "camera") {
      try {
        stream = await openCamera(chosenDeviceId);
      } catch (err) {
        if (chosenDeviceId && !restore) {
          stream = await openCamera();
        } else {
          throw err;
        }
      }
    } else {
      const picked = await openScreen(savedDisplay);
      if (!picked) return;
      stream = picked.stream;
      display = picked.display;
    }
    // The panel closed, or the same source came back another way, while it was opening.
    if (
      closing.current ||
      (targetIdentity && sources.current.some((item) => item.identity === targetIdentity))
    ) {
      for (const track of stream.getTracks()) track.stop();
      return;
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
        // A camera this scene saved but has not connected takes its place back; scenes never
        // pick up each other's sources.
        const cameraBase = `camera:${deviceId || "default"}`;
        const missingPlacement = arrangement.of(scene).find((p) => {
          const placementId = p.identity;
          const matchesDevice = baseIdentity(placementId) === cameraBase;
          const isLive = sources.current.some((s) => s.identity === placementId);
          return matchesDevice && !isLive;
        });

        if (missingPlacement) {
          identity = missingPlacement.identity;
          label = missingPlacement.label;
        } else {
          const n = ++sourceNumbers.current.camera;
          label = `Camera ${n}`;
          identity = arrangement.unique(cameraBase, openIdentities());
        }
      }
    } else {
      if (targetIdentity) {
        identity = targetIdentity;
        label = targetLabel || targetIdentity.replace("screen:", "Screen ");
      } else {
        // A screen this scene saved but has not connected takes its place back.
        const missingScreen = arrangement.of(scene).find((p) => {
          const placementId = p.identity;
          const isScreen = p.kind === "screen" || placementId.startsWith("screen:");
          const isLive = sources.current.some((s) => s.identity === placementId);
          return isScreen && !isLive;
        });
        if (missingScreen) {
          identity = missingScreen.identity;
          label = missingScreen.label;
        } else {
          const n = ++sourceNumbers.current.screen;
          identity = arrangement.unique(`screen:${n}`, openIdentities());
          label = `Screen ${n}`;
        }
      }
    }

    const source: VideoSource = { id, identity, kind, label, video, stream, deviceId, display };
    sources.current = [...sources.current, source];

    // Remember what was opened, so Reconnect and the next visit open the same thing.
    const scenesWithSource = arrangement.scenesWith(identity);
    if (scenesWithSource.length && (deviceId || display))
      arrangement.annotate(identity, {
        ...(kind === "camera" && deviceId ? { deviceId } : {}),
        ...(display ? { display } : {}),
      });
    // Restore into every scene that had it at its saved layout and layer order.
    // If the current scene did not have it saved, place it with default layout.
    if (!restore && !scenesWithSource.includes(scene)) {
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
    if (!restore) setSelectedSource(id);
    if (kind === "camera") {
      void refreshCameraDevices();
    }
    refresh();
  };
  const addSource = (...args: Parameters<typeof connectSource>) =>
    attempt(() => connectSource(...args), `Could not start the ${args[0]}.`);

  /** Opens a project video as a looping source; scenes that saved it show it again. */
  const openVideo = async (
    mediaId: string,
    identity = arrangement.unique(`video:${mediaId}`, openIdentities()),
  ) => {
    const open = sources.current.find((item) => item.identity === identity);
    if (open) return open;
    const media = session.getSnapshot().project.media.find((item) => item.id === mediaId);
    const local = await session.resource(mediaId);
    if (!media || local?.state !== "available")
      throw new Error("This video is not available on this device.");
    const url = URL.createObjectURL(local.file);
    const video = document.createElement("video");
    video.playsInline = true;
    video.loop = true;
    video.src = url;
    try {
      await video.play();
    } catch {
      // Without a click to allow sound, start muted and unmute on the next interaction.
      video.muted = true;
      try {
        await video.play();
      } catch (cause) {
        URL.revokeObjectURL(url);
        throw cause;
      }
      const unmute = () => {
        video.muted = false;
        void video.play().catch(() => {});
      };
      window.addEventListener("pointerdown", unmute, { once: true });
    }
    // A slower add may have opened the same video meanwhile.
    const raced = sources.current.find((item) => item.identity === identity);
    if (raced) {
      video.pause();
      URL.revokeObjectURL(url);
      return raced;
    }
    const id = crypto.randomUUID();
    const label = mediaName(media.path);
    const source: VideoSource = { id, identity, kind: "video", label, video, stream: null, url };
    source.mediaId = mediaId;
    sources.current = [...sources.current, source];
    video.onresize = refresh;
    if (media.hasAudio) {
      // The mixer takes the element's sound, so it plays in the program, not the speakers.
      void ensureMixer()
        .then((audio) => {
          if (!sources.current.includes(source)) return;
          const audioID = `${id}:audio`;
          const channel = audio.addNode(audioID, audio.context.createMediaElementSource(video));
          setSettings((current) => ({ ...current, [audioID]: DEFAULT_LIVE_AUDIO }));
          audioInputs.current = [
            ...audioInputs.current,
            { id: audioID, label, kind: "video", sourceId: id, stream: null, channel },
          ];
          refresh();
        })
        .catch(() => setError(`The sound of ${label} could not be added.`));
    }
    refresh();
    return source;
  };
  latestOpenVideo.current = openVideo;
  const addVideo = (mediaId: string) =>
    attempt(async () => {
      const scene = selectedRef.current ?? PRE_SCENE;
      // This scene's own copy of the video, if it has one already.
      const saved = arrangement.of(scene).find((item) => item.mediaId === mediaId);
      const source = await openVideo(mediaId, saved?.identity);
      if (!arrangement.has(scene, source.identity)) placeOnScene(scene, source);
      setSelectedSource(source.id);
      refresh();
    }, "Could not add the video.");

  /** Opens a microphone that only the scenes holding it hear. */
  const openSceneAudio = async (deviceId: string | undefined, identity: string, label: string) => {
    const open = audioInputs.current.find((input) => input.identity === identity);
    if (open) return open;
    const audio = await ensureMixer();
    const stream = await openAudioInput(deviceId ?? null);
    const raced = audioInputs.current.find((input) => input.identity === identity);
    if (raced) {
      for (const track of stream.getTracks()) track.stop();
      return raced;
    }
    const id = crypto.randomUUID();
    const channel = audio.addStream(id, stream, DEFAULT_LIVE_AUDIO);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => removeInput(id), { once: true });
    setSettings((current) => ({ ...current, [id]: DEFAULT_LIVE_AUDIO }));
    const input: AudioInput = { id, label, kind: "microphone", identity, stream, channel };
    audioInputs.current = [...audioInputs.current, input];
    refresh();
    return input;
  };
  const addSceneAudio = (deviceId: string) =>
    attempt(async () => {
      const scene = selectedRef.current ?? PRE_SCENE;
      const base = `audio:${deviceId || "default"}`;
      const identity =
        arrangement.of(scene).find((item) => baseIdentity(item.identity) === base)?.identity ??
        arrangement.unique(base, openIdentities());
      const deviceLabel =
        audioDevices.find((device) => device.deviceId === deviceId)?.label || "Microphone";
      const input = await openSceneAudio(deviceId || undefined, identity, deviceLabel);
      if (!arrangement.has(scene, identity)) {
        arrangement.add(scene, {
          identity,
          label: input.label,
          kind: "audio",
          deviceId: deviceId || undefined,
          layout: { x: 0, y: 0, w: 1 },
        });
        commitArrangements();
      }
      refresh();
    }, "Could not start the microphone.");
  /** Reopens a saved source that is not connected, wherever it was saved. */
  const reconnect = (placement: Placement) => {
    const { identity, label, kind } = placement;
    if (kind === "video" && placement.mediaId) {
      const mediaId = placement.mediaId;
      return attempt(() => openVideo(mediaId, identity), "Could not open the video.");
    }
    if (kind === "audio")
      return attempt(
        () => openSceneAudio(placement.deviceId, identity, label),
        "Could not start the microphone.",
      );
    if (kind === "camera") {
      const deviceId =
        placement.deviceId ??
        (identity.startsWith("camera:")
          ? baseIdentity(identity).slice("camera:".length)
          : undefined);
      return addSource("camera", deviceId === "default" ? undefined : deviceId, identity, label);
    }
    // The same screen or window when the desktop app still offers it, else the picker.
    return attempt(async () => {
      const display = placement.display;
      const offered =
        display &&
        (
          (await nativeBridge()
            ?.captureSources?.()
            .catch(() => [])) ?? []
        ).some((item) => item.id === display);
      await connectSource("screen", undefined, identity, label, offered ? { display } : {});
    }, "Could not start the screen.");
  };
  /** Connects a saved camera that is not connected with another camera device. */
  const reconnectWith = (placement: Placement, deviceId: string) =>
    addSource("camera", deviceId, placement.identity, placement.label);

  /** Reopens saved sources that need no prompt: granted cameras and mics, desktop screens. */
  const restoreSources = async () => {
    const saved = new Map<string, Placement>();
    for (const placement of Object.values(arrangement.serialize()).flat())
      if (!saved.has(placement.identity)) saved.set(placement.identity, placement);
    if (!saved.size) return;
    const bridge = nativeBridge();
    const granted = async (device: "camera" | "microphone") => {
      // The desktop app holds standing camera and microphone access.
      if (bridge?.capturePrepare) return true;
      try {
        const permission = await navigator.permissions.query({
          name: device,
        } as unknown as PermissionDescriptor);
        return permission.state === "granted";
      } catch {
        return false;
      }
    };
    const [camera, microphone] = await Promise.all([granted("camera"), granted("microphone")]);
    const placements = [...saved.values()];
    const screens = placements.some((item) => item.kind === "screen" && item.display)
      ? new Set(((await bridge?.captureSources?.().catch(() => [])) ?? []).map((item) => item.id))
      : new Set<string>();
    // One at a time, so devices never race for the same prompt or capture grant.
    for (const placement of placements) {
      if (closing.current) return;
      const { identity, label, kind } = placement;
      const open =
        sources.current.some((item) => item.identity === identity) ||
        audioInputs.current.some((input) => input.identity === identity);
      if (open) continue;
      try {
        if (kind === "camera" && camera) {
          const deviceId =
            placement.deviceId ??
            (identity.startsWith("camera:")
              ? baseIdentity(identity).slice("camera:".length)
              : undefined);
          await connectSource(
            "camera",
            deviceId === "default" ? undefined : deviceId,
            identity,
            label,
            { restore: true },
          );
        } else if (kind === "audio" && microphone) {
          await openSceneAudio(placement.deviceId, identity, label);
        } else if (kind === "screen" && placement.display && screens.has(placement.display)) {
          await connectSource("screen", undefined, identity, label, {
            restore: true,
            display: placement.display,
          });
        }
      } catch {
        // It stays listed as not connected, with Reconnect.
      }
    }
  };
  latestRestore.current = restoreSources;

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

      for (const track of source.stream?.getTracks() ?? []) track.stop();
      source.video.onresize = null;
      source.video.srcObject = null;

      const oldIdentity = source.identity;
      const newDeviceIdResolved =
        newDeviceId || newStream.getVideoTracks()[0]?.getSettings?.()?.deviceId;
      const newIdentity = arrangement.unique(
        `camera:${newDeviceIdResolved || "default"}`,
        openIdentities(),
      );

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
  /** Points a screen source at another screen or window, keeping its place in its scene. */
  const switchScreen = (id: string) =>
    attempt(async () => {
      const source = sources.current.find((item) => item.id === id || item.identity === id);
      if (!source || source.kind !== "screen") return;
      const picked = await openScreen();
      if (!picked) return;
      const { stream } = picked;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      try {
        await video.play();
      } catch (cause) {
        for (const track of stream.getTracks()) track.stop();
        throw cause;
      }
      if (!sources.current.includes(source)) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const audioID = `${source.id}:audio`;
      mixer.current?.remove(audioID);
      audioInputs.current = audioInputs.current.filter((input) => input.id !== audioID);
      for (const track of source.stream?.getTracks() ?? []) track.stop();
      source.video.onresize = null;
      source.video.srcObject = null;
      source.stream = stream;
      source.video = video;
      source.display = picked.display;
      if (picked.display) {
        arrangement.annotate(source.identity, { display: picked.display });
        commitArrangements();
      }
      video.onresize = refresh;
      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (sources.current.find((item) => item.id === source.id)?.stream === stream)
            disconnectSource(source.id);
        },
        { once: true },
      );
      if (stream.getAudioTracks().length) {
        const audio = await ensureMixer();
        const channel = audio.addStream(audioID, new MediaStream(stream.getAudioTracks()));
        setSettings((current) => ({ ...current, [audioID]: DEFAULT_LIVE_AUDIO }));
        audioInputs.current = [
          ...audioInputs.current,
          {
            id: audioID,
            label: source.label,
            kind: "screen",
            sourceId: source.id,
            stream,
            channel,
          },
        ];
      }
      refresh();
    }, "Could not switch the screen.");
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
        for (const track of input.stream?.getTracks() ?? []) track.stop();
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
        loadLook(scene.id, next);
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
  // Drag handles sit on whichever canvas shows the scene being arranged.
  const editStages = editReady ? (
    <>
      <SourceStage
        sources={stageSources}
        canvasAspect={editingProgram ? canvasAspect() : previewAspect()}
        selected={selectedSource}
        onSelect={setSelectedSource}
        onChange={placeSource}
      />
      {selectedOverlay && (
        <OverlayStage
          overlays={draft.overlays.map((overlay) => ({ ...overlay, label: overlay.text }))}
          selected={selectedOverlay}
          // The canvas paints the draft look except while a take or clip buffer owns it.
          standIn={editingProgram && (captureActive || bufferCapturing(clipState.buffer))}
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
    </>
  ) : null;
  const startDisabled =
    !frame || (program.kind !== "idle" && program.kind !== "failed" && program.kind !== "uploaded");

  return (
    <div className="studio-layout">
      {screenPicker.dialog}
      <div className="grid gap-3">
        <div className="studio-frames" data-preview={previewing || undefined}>
          <div className="studio-program-frame" hidden={!previewing}>
            <div
              className="studio-program"
              style={{ ["--studio-aspect" as string]: String(previewAspect()) }}
            >
              <canvas
                ref={previewCanvas}
                aria-label="Preview output"
                data-scene={previewFrame ?? ""}
              />
              {previewing && editStages}
              <span className="studio-canvas-tag">
                Preview{selectedScene ? ` · ${selectedScene.name}` : ""}
              </span>
            </div>
          </div>
          <div className="studio-program-frame">
            <div
              className="studio-program"
              style={{ ["--studio-aspect" as string]: String(canvasAspect()) }}
              data-recording={recording || undefined}
            >
              <canvas ref={canvas} aria-label="Program output" data-scene={frame ?? ""} />
              {editingProgram && editStages}
              <span className="studio-canvas-tag">Program</span>
              {!active && !loading && (
                <p className="studio-program-empty">
                  Save a scene from the editor to put it on air.
                </p>
              )}
              {recording && (
                <span className="studio-rec-badge" aria-hidden>
                  REC
                </span>
              )}
            </div>
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
            className="grid w-full gap-2 studio-modes"
            value={mode}
            disabled={busy}
            onValueChange={(value) => value && setMode(value as typeof mode)}
          >
            {(
              [
                ["record", "Record", RiRecordCircleLine],
                ["live", "Live", RiBroadcastLine],
                ["both", "Both", RiStackLine],
              ] as const
            ).map(([value, label, Icon]) => (
              <label key={value} data-checked={mode === value || undefined}>
                <Radio value={value} className="sr-only" />
                <span className="studio-mode-title">
                  <Icon aria-hidden />
                  {label}
                </span>
                {value !== "record" && !canStream && <small>Desktop app</small>}
              </label>
            ))}
          </RadioGroup>
          <div className="studio-quality">
            <span>Quality</span>
            <Select
              value={String(quality.height)}
              disabled={capturing}
              onValueChange={(value) => {
                const height = OUTPUT_HEIGHTS.find((item) => String(item) === value);
                if (height) setOutputQuality({ height });
              }}
            >
              <SelectTrigger aria-label="Video quality" className="min-w-24">
                <SelectValue>{(value: string) => `${value}p`}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {OUTPUT_HEIGHTS.map((height) => (
                  <SelectItem key={height} value={String(height)}>
                    {height}p
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(quality.frameRate)}
              disabled={capturing}
              onValueChange={(value) => {
                const frameRate = FRAME_RATES.find((item) => String(item) === value);
                if (frameRate) setOutputQuality({ frameRate });
              }}
            >
              <SelectTrigger aria-label="Frame rate" className="min-w-24">
                <SelectValue>{(value: string) => `${value} fps`}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {FRAME_RATES.map((rate) => (
                  <SelectItem key={rate} value={String(rate)}>
                    {rate} fps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <small className="text-muted-foreground">
              {describeQuality(quality)}. Used for recordings and streams.
            </small>
          </div>
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
                  "Put a scene on air to enable recording."
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
                    {new Date(item.startedAt).toLocaleString()} ·{" "}
                    {item.bytes < 1024 * 1024
                      ? `${Math.max(1, Math.round(item.bytes / 1024))} KB`
                      : megabytes(item.bytes)}
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
          description="Pick a scene to edit its look. Put on air sends it to the program."
        >
          {scenes.length > 0 && (
            <RadioGroup
              aria-label="Scenes"
              className="w-full"
              value={selected}
              onValueChange={(value) => value && setSelected(value)}
            >
              <ul className="grid w-full gap-2 studio-list">
                {scenes.map((scene) => {
                  const live = active?.id === scene.id;
                  return (
                    <li
                      key={scene.id}
                      className="studio-row"
                      data-selected={selected === scene.id || undefined}
                    >
                      <label className="studio-row-main">
                        <Radio value={scene.id} className="sr-only" />
                        <span className="truncate">{scene.name}</span>
                        {live && <span className="studio-live-badge">On air</span>}
                      </label>
                      {!live && (
                        <Button size="xs" onClick={() => void switchTo(scene.id)}>
                          Put <span className="sr-only">{scene.name} </span>on air
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
                        title={live ? "Put another scene on air first" : "Remove scene"}
                        disabled={live}
                        onClick={() => void remove(scene.id)}
                      >
                        <RiDeleteBinLine />
                      </Button>
                    </li>
                  );
                })}
              </ul>
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
            editSources.length ? (
              `Drag a source on the ${editingProgram ? "program" : "preview"} to move it, or drag its corners to resize. Hold Alt to stop snapping.`
            ) : selectedScene ? (
              <>
                Arranging <strong className="text-foreground">{selectedScene.name}</strong>. Add a
                camera, screen, video or audio input to this scene.
              </>
            ) : (
              "Add a camera, screen, video or audio input to put it on this scene."
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
              <Select
                key={`media-${mediaSelectKey}`}
                value=""
                onValueChange={(value) => {
                  const choice = String(value ?? "");
                  setMediaSelectKey((key) => key + 1);
                  if (choice.startsWith("video:")) void addVideo(choice.slice("video:".length));
                  else if (choice.startsWith("audio:"))
                    void addSceneAudio(choice.slice("audio:".length));
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Add video or audio"
                  className="h-7 text-[0.8rem] rounded-[min(var(--radius-md),12px)] px-2.5"
                >
                  <RiAddLine data-icon="inline-start" className="size-3.5" />
                  <span>Video or audio</span>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectLabel>Video from Project media</SelectLabel>
                    {projectVideos.length ? (
                      projectVideos.map((media) => (
                        <SelectItem key={media.id} value={`video:${media.id}`}>
                          <RiFilmLine className="text-muted-foreground" />
                          {mediaName(media.path)}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none-video" disabled>
                        Import a video into the project first
                      </SelectItem>
                    )}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Audio for this scene only</SelectLabel>
                    {(audioDevices.length
                      ? audioDevices
                      : [{ deviceId: "", label: "Default microphone" }]
                    ).map((device) => (
                      <SelectItem
                        key={device.deviceId || "default"}
                        value={`audio:${device.deviceId}`}
                      >
                        <RiMicLine className="text-muted-foreground" />
                        {device.label || "Microphone"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </>
          }
        >
          {otherSources.length + otherMics.length > 0 && (
            <Select
              value=""
              onValueChange={(value) => {
                if (value) copyFromScene(value as string);
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Copy a source from another scene"
                className="w-fit"
              >
                <RiAddLine data-icon="inline-start" className="size-3.5" />
                <span>Copy from another scene</span>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {otherSources.map((source) => (
                  <SelectItem key={source.id} value={source.identity}>
                    <SourceIcon kind={source.kind} />
                    {source.label}
                  </SelectItem>
                ))}
                {otherMics.map((input) => (
                  <SelectItem key={input.id} value={input.identity!}>
                    <RiMicLine />
                    {input.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {scenePlacements.length > 0 && (
            <ul className="studio-list">
              {/* Top layer first, like a layers panel. */}
              {[...scenePlacements].reverse().map((placement, fromTop, list) => {
                const identity = placement.identity;
                const live = sources.current.find(
                  (s) => s.identity === identity || s.id === identity,
                );
                const mic =
                  placement.kind === "audio"
                    ? audioInputs.current.find((input) => input.identity === identity)
                    : undefined;

                if (mic) {
                  return (
                    <li key={identity} className="studio-row">
                      <div className="studio-row-main min-w-0">
                        <RiMicLine />
                        <span className="truncate">{mic.label}</span>
                        <span className="text-xs text-muted-foreground">Audio</span>
                      </div>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${mic.label}`}
                        title="Remove from this scene"
                        onClick={() => removeSource(identity)}
                      >
                        <RiCloseLine />
                      </Button>
                    </li>
                  );
                }

                if (live) {
                  const isSelected = selectedSource === live.id;
                  const aspects = [
                    editingProgram ? canvasAspect() : previewAspect(),
                    sourceAspect(live.video),
                  ] as const;
                  return (
                    <li
                      key={live.id}
                      className="studio-row"
                      data-selected={isSelected || undefined}
                    >
                      <Toggle
                        className="studio-row-main"
                        pressed={isSelected}
                        onPressedChange={(pressed) => setSelectedSource(pressed ? live.id : null)}
                      >
                        <SourceIcon kind={live.kind} />
                        <span className="truncate">{live.label}</span>
                      </Toggle>
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
                      {live.kind === "screen" && (
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Change what ${live.label} shows`}
                          title="Change screen or window"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => void switchScreen(live.id)}
                        >
                          Change
                        </Button>
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

                const { label, kind } = placement;

                return (
                  <li key={identity} className="studio-row">
                    <div className="studio-row-main min-w-0 opacity-60">
                      <SourceIcon kind={kind} />
                      <span className="truncate">{label} · not connected</span>
                    </div>
                    {kind === "camera" && cameraDevices.length > 1 && (
                      <Select
                        value=""
                        onValueChange={(deviceId) => {
                          if (typeof deviceId === "string" && deviceId)
                            void reconnectWith(placement, deviceId);
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Connect ${label} with another camera`}
                          title="Connect with another camera"
                          className="h-6 max-w-28 px-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                        >
                          <SelectValue placeholder="Camera…" />
                        </SelectTrigger>
                        <SelectContent align="end" alignItemWithTrigger={false}>
                          {cameraDevices.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>
                              {device.label}
                              {usedCameraDeviceIds.has(device.deviceId) ? " (in use)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      size="xs"
                      variant="outline"
                      title={`Open ${label} again`}
                      onClick={() => void reconnect(placement)}
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
            canPlace={editingProgram ? frame !== null : previewing}
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
              gated: !isAudioInputOpen(
                { sourceId: gateSourceKey(input, sources.current) },
                liveKey,
                arrangement,
              ),
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
        liveSceneId={active?.id ?? null}
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

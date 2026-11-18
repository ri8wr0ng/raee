import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from "react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Slider } from "@sidecut/ui/components/slider";
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDraggable,
  RiKeyboardLine,
  RiMusic2Line,
  RiPlayFill,
  RiRepeatLine,
  RiStopFill,
  RiSubtractLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import {
  DEFAULT_PAD_COLORS,
  createMacro,
  createPad,
  deleteSoundAudio,
  findShortcutConflict,
  loadSoundAudio,
  loadSoundboardData,
  matchesShortcut,
  padsForScene,
  saveSoundAudio,
  saveSoundboardData,
  shortcutFromEvent,
  type ConflictItem,
  type Macro,
  type MacroStep,
  type Pad,
} from "./soundboard-store";
import { Toggle } from "@ui-sdk/react/toggle";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { isTabNavigationKey } from "../workspace/tab-keys";
import "./soundboard.css";
import { OptionSelect, SelectItem } from "@sidecut/ui/components/option-select";
import { Checkbox } from "@sidecut/ui/components/checkbox";

export type SoundboardActions = {
  scenes: readonly { id: string; name: string }[];
  overlays: readonly { id: string; text: string }[];
  switchScene: (id: string) => void;
  setOverlay: (id: string, visible: boolean) => void;
  record: (action: "start" | "stop") => void;
  mark: () => void;
};

export type SoundboardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decode: (file: Blob) => Promise<AudioBuffer>;
  play: (id: string, buffer: AudioBuffer, volumeDB: number, loop: boolean) => void;
  stop: (id: string | null /* null = all */) => void;
  actions: SoundboardActions;
  /** The scene on air: pads for other scenes are hidden and silent. */
  liveSceneId: string | null;
};

type Tab = "pads" | "macros";

type CapturingState = {
  target: "pad" | "macro";
  id: string;
};

const POSITION_STORAGE_KEY = "sidecut.soundboard.position";

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function Soundboard({
  open,
  onOpenChange,
  decode,
  play,
  stop,
  actions,
  liveSceneId,
}: SoundboardProps) {
  const [data, setData] = useState<{ pads: Pad[]; macros: Macro[] }>(() => loadSoundboardData());
  const [activeTab, setActiveTab] = useState<Tab>("pads");
  const [isEditing, setIsEditing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [playingPads, setPlayingPads] = useState<ReadonlySet<string>>(new Set());
  const [capturing, setCapturing] = useState<CapturingState | null>(null);
  const [conflictWarning, setConflictWarning] = useState<ConflictItem | null>(null);
  const [flash, setFlash] = useState<{ message: string; shortcut?: string } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [expandedPadId, setExpandedPadId] = useState<string | null>(null);

  // Position management
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(POSITION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
          return { x: parsed.x, y: parsed.y };
        }
      }
    } catch {
      // ignore
    }
    return null;
  });

  const panelRef = useRef<HTMLDivElement | null>(null);
  const buffersRef = useRef(new Map<string, AudioBuffer>());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep live references for global keydown handler
  const padsRef = useRef(data.pads);
  padsRef.current = data.pads;
  /** The pads the live scene can play. */
  const livePads = padsForScene(data.pads, liveSceneId);
  const livePadsRef = useRef(livePads);
  livePadsRef.current = livePads;
  const liveSceneName = actions.scenes.find((scene) => scene.id === liveSceneId)?.name;
  const macrosRef = useRef(data.macros);
  macrosRef.current = data.macros;
  const playingPadsRef = useRef(playingPads);
  playingPadsRef.current = playingPads;
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;

  const showFlash = useCallback((message: string, shortcut?: string) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlash(shortcut ? { message, shortcut } : { message });
    flashTimerRef.current = setTimeout(() => {
      setFlash(null);
      flashTimerRef.current = null;
    }, 1600);
  }, []);

  const stopPad = useCallback(
    (id: string) => {
      stop(id);
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
      setPlayingPads((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [stop],
  );

  const stopAll = useCallback(() => {
    stop(null);
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    setPlayingPads(new Set());
  }, [stop]);

  const playPad = useCallback(
    async (pad: Pad) => {
      if (!livePadsRef.current.some((item) => item.id === pad.id)) return;
      try {
        let buffer = buffersRef.current.get(pad.id);
        if (!buffer) {
          const audioBytes = await loadSoundAudio(pad.id);
          if (!audioBytes) {
            showFlash(`No audio recorded for ${pad.name}`);
            return;
          }
          buffer = await decode(new Blob([audioBytes]));
          buffersRef.current.set(pad.id, buffer);
        }

        // Loading can finish after a scene cut; macros obey the same scene scope.
        if (!livePadsRef.current.some((item) => item.id === pad.id)) return;
        play(pad.id, buffer, pad.volumeDB, pad.loop);
        setPlayingPads((prev) => new Set(prev).add(pad.id));

        const existingTimer = timersRef.current.get(pad.id);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        if (!pad.loop) {
          const durationMs = Math.max(100, buffer.duration * 1000);
          const timer = setTimeout(() => {
            setPlayingPads((prev) => {
              const next = new Set(prev);
              next.delete(pad.id);
              return next;
            });
            timersRef.current.delete(pad.id);
          }, durationMs);
          timersRef.current.set(pad.id, timer);
        }
      } catch (err) {
        showFlash(`Could not play ${pad.name}`);
        console.error("Failed to play sound pad:", err);
      }
    },
    [decode, play, showFlash],
  );

  const runMacro = useCallback(
    async (macro: Macro) => {
      showFlash(`Running: ${macro.name}`, macro.shortcut ?? undefined);
      for (const step of macro.steps) {
        switch (step.kind) {
          case "play": {
            const pad = padsRef.current.find((p) => p.id === step.padId);
            if (pad) {
              await playPad(pad);
            }
            break;
          }
          case "stop-all": {
            stopAll();
            break;
          }
          case "wait": {
            await new Promise((resolve) => setTimeout(resolve, step.ms));
            break;
          }
          case "scene": {
            actions.switchScene(step.sceneId);
            break;
          }
          case "overlay": {
            actions.setOverlay(step.overlayId, step.visible);
            break;
          }
          case "record": {
            actions.record(step.action);
            break;
          }
          case "mark": {
            actions.mark();
            break;
          }
        }
      }
    },
    [actions, playPad, showFlash, stopAll],
  );

  // A scene's own pads fall silent when it goes off air, like its other sources.
  useEffect(() => {
    for (const id of playingPadsRef.current) {
      const pad = padsRef.current.find((item) => item.id === id);
      if (pad?.scene && pad.scene !== liveSceneId) stopPad(id);
    }
  }, [liveSceneId, stopPad]);

  // Global keydown listener: always active while Soundboard is mounted, even if closed or collapsed
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (capturingRef.current) return;
      if (isInteractiveElement(event.target) || isTabNavigationKey(event)) return;

      // Check pads the live scene can play
      for (const pad of livePadsRef.current) {
        if (pad.shortcut && matchesShortcut(event, pad.shortcut)) {
          event.preventDefault();
          event.stopPropagation();
          if (playingPadsRef.current.has(pad.id)) {
            stopPad(pad.id);
            showFlash(`Stopped ${pad.name}`, pad.shortcut);
          } else {
            void playPad(pad);
            showFlash(`Played ${pad.name}`, pad.shortcut);
          }
          return;
        }
      }

      // Check macros
      for (const macro of macrosRef.current) {
        if (macro.shortcut && matchesShortcut(event, macro.shortcut)) {
          event.preventDefault();
          event.stopPropagation();
          void runMacro(macro);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playPad, runMacro, showFlash, stopPad]);

  // Capture shortcut listener when capturing modal/state is active
  useEffect(() => {
    if (!capturing) return;

    const handleCaptureKeyDown = (event: KeyboardEvent) => {
      if (isTabNavigationKey(event)) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCapturing(null);
        setConflictWarning(null);
        return;
      }

      const shortcut = shortcutFromEvent(event);
      if (!shortcut) return;

      const conflict = findShortcutConflict(
        padsRef.current,
        macrosRef.current,
        shortcut,
        capturing.id,
      );
      if (conflict) {
        setConflictWarning(conflict);
      } else {
        setConflictWarning(null);
      }

      if (capturing.target === "pad") {
        updatePad(capturing.id, { shortcut });
      } else {
        updateMacro(capturing.id, { shortcut });
      }
      setCapturing(null);
    };

    window.addEventListener("keydown", handleCaptureKeyDown, true);
    return () => window.removeEventListener("keydown", handleCaptureKeyDown, true);
  }, [capturing]);

  // Dragging support for floating panel
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only drag from primary button and not on interactive controls inside the header
    if (event.button !== 0 || isInteractiveElement(event.target)) return;

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialPos = position ?? { x: rect.left, y: rect.top };

    const handlePointerMove = (e: PointerEvent) => {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const maxX = Math.max(0, window.innerWidth - rect.width - 8);
      const maxY = Math.max(0, window.innerHeight - rect.height - 8);

      const nextX = Math.max(8, Math.min(maxX, initialPos.x + deltaX));
      const nextY = Math.max(8, Math.min(maxY, initialPos.y + deltaY));

      setPosition({ x: nextX, y: nextY });
    };

    const handlePointerUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const maxX = Math.max(0, window.innerWidth - rect.width - 8);
      const maxY = Math.max(0, window.innerHeight - rect.height - 8);

      const finalX = Math.max(8, Math.min(maxX, initialPos.x + deltaX));
      const finalY = Math.max(8, Math.min(maxY, initialPos.y + deltaY));

      const finalPos = { x: finalX, y: finalY };
      setPosition(finalPos);
      try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(finalPos));
      } catch {
        // ignore
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  // Sound & pad CRUD operations
  const addAudioFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      if (
        !file.type.startsWith("audio/") &&
        !file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i)
      ) {
        continue;
      }
      const id = crypto.randomUUID();
      const rawName = file.name.replace(/\.[^/.]+$/, "");
      const name = rawName.length > 0 ? rawName : "Sound";
      const color =
        DEFAULT_PAD_COLORS[data.pads.length % DEFAULT_PAD_COLORS.length] ?? DEFAULT_PAD_COLORS[0]!;

      try {
        await saveSoundAudio(id, file);
        const buffer = await decode(file);
        buffersRef.current.set(id, buffer);
      } catch (err) {
        console.error("Audio decode error:", err);
      }

      const newPad = createPad({
        id,
        name,
        color,
        volumeDB: 0,
        loop: false,
        shortcut: null,
      });

      setData((prev) => {
        const nextPads = [...prev.pads, newPad];
        const nextData = { pads: nextPads, macros: prev.macros };
        saveSoundboardData(nextData);
        return nextData;
      });
    }
  };

  const updatePad = (id: string, change: Partial<Pad>) => {
    setData((prev) => {
      const nextPads = prev.pads.map((pad) => (pad.id === id ? { ...pad, ...change } : pad));
      const nextData = { pads: nextPads, macros: prev.macros };
      saveSoundboardData(nextData);
      return nextData;
    });
  };

  const removePad = async (id: string) => {
    stopPad(id);
    buffersRef.current.delete(id);
    await deleteSoundAudio(id);

    setData((prev) => {
      const nextPads = prev.pads.filter((p) => p.id !== id);
      // Remove play steps in macros referencing this pad
      const nextMacros = prev.macros.map((m) => ({
        ...m,
        steps: m.steps.filter((s) => (s.kind === "play" ? s.padId !== id : true)),
      }));
      const nextData = { pads: nextPads, macros: nextMacros };
      saveSoundboardData(nextData);
      return nextData;
    });
  };

  const replacePadSound = async (padId: string, file: File) => {
    try {
      await saveSoundAudio(padId, file);
      const buffer = await decode(file);
      buffersRef.current.set(padId, buffer);
      showFlash("Audio updated");
    } catch (err) {
      console.error("Error replacing audio:", err);
      showFlash("Could not decode audio file");
    }
  };

  // Macro CRUD operations
  const addMacro = () => {
    const newMacro = createMacro({
      name: `Macro ${data.macros.length + 1}`,
      shortcut: null,
      steps: [],
    });
    setData((prev) => {
      const nextMacros = [...prev.macros, newMacro];
      const nextData = { pads: prev.pads, macros: nextMacros };
      saveSoundboardData(nextData);
      return nextData;
    });
  };

  const updateMacro = (id: string, change: Partial<Macro>) => {
    setData((prev) => {
      const nextMacros = prev.macros.map((m) => (m.id === id ? { ...m, ...change } : m));
      const nextData = { pads: prev.pads, macros: nextMacros };
      saveSoundboardData(nextData);
      return nextData;
    });
  };

  const removeMacro = (id: string) => {
    setData((prev) => {
      const nextMacros = prev.macros.filter((m) => m.id !== id);
      const nextData = { pads: prev.pads, macros: nextMacros };
      saveSoundboardData(nextData);
      return nextData;
    });
  };

  const addMacroStep = (macroId: string, step: MacroStep) => {
    setData((prev) => {
      const nextMacros = prev.macros.map((m) =>
        m.id === macroId ? { ...m, steps: [...m.steps, step] } : m,
      );
      const nextData = { pads: prev.pads, macros: nextMacros };
      saveSoundboardData(nextData);
      return nextData;
    });
  };

  const removeMacroStep = (macroId: string, stepIndex: number) => {
    setData((prev) => {
      const nextMacros = prev.macros.map((m) => {
        if (m.id !== macroId) return m;
        const nextSteps = m.steps.filter((_, idx) => idx !== stepIndex);
        return { ...m, steps: nextSteps };
      });
      const nextData = { pads: prev.pads, macros: nextMacros };
      saveSoundboardData(nextData);
      return nextData;
    });
  };

  const moveMacroStep = (macroId: string, stepIndex: number, direction: "up" | "down") => {
    setData((prev) => {
      const nextMacros = prev.macros.map((m) => {
        if (m.id !== macroId) return m;
        const targetIndex = direction === "up" ? stepIndex - 1 : stepIndex + 1;
        if (targetIndex < 0 || targetIndex >= m.steps.length) return m;

        const nextSteps = [...m.steps];
        const current = nextSteps[stepIndex];
        const target = nextSteps[targetIndex];
        if (!current || !target) return m;

        nextSteps[stepIndex] = target;
        nextSteps[targetIndex] = current;
        return { ...m, steps: nextSteps };
      });
      const nextData = { pads: prev.pads, macros: nextMacros };
      saveSoundboardData(nextData);
      return nextData;
    });
  };

  // Drag and drop handlers for sound files
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };
  const handleDragLeave = () => setIsDraggingOver(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void addAudioFiles(e.dataTransfer.files);
    }
  };

  // Position style computation
  // The panel never grows past the viewport; its body scrolls instead.
  const floatingStyle: CSSProperties = position
    ? {
        left: `${position.x}px`,
        top: `${position.y}px`,
        maxHeight: `calc(100dvh - ${Math.round(position.y)}px - 16px)`,
      }
    : { right: "24px", bottom: "24px", maxHeight: "calc(100dvh - 48px)" };

  return (
    <>
      {/* Toast-like inline flash for shortcuts */}
      {flash && (
        <div className="soundboard-flash-toast" role="status" aria-live="polite">
          <RiMusic2Line className="size-4 text-primary" />
          <span>{flash.message}</span>
          {flash.shortcut && (
            <span className="soundboard-shortcut-chip ml-1">{flash.shortcut}</span>
          )}
        </div>
      )}

      {/* Floating soundboard panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Soundboard"
          style={floatingStyle}
          className="soundboard-panel fixed z-50 flex flex-col rounded-xl overflow-hidden w-[420px] max-w-[calc(100vw-32px)] text-foreground"
        >
          {/* Draggable Header */}
          <div
            onPointerDown={handlePointerDown}
            className="soundboard-header flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b border-border/40 cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center gap-2 min-w-0">
              <RiDraggable className="size-4 shrink-0 text-muted-foreground opacity-60" />
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[13px] font-semibold text-foreground">Soundboard</span>
                {playingPads.size > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/20 text-primary border border-primary/30">
                    {playingPads.size} playing
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {playingPads.size > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={stopAll}
                  className="h-6 px-2 text-[11px] gap-1"
                  aria-label="Stop all sounds"
                >
                  <RiStopFill className="size-3" />
                  Stop all
                </Button>
              )}

              <Button
                size="sm"
                variant={isEditing ? "default" : "secondary"}
                onClick={() => setIsEditing(!isEditing)}
                className="h-6 px-2 text-[11px]"
                aria-label={isEditing ? "Done editing" : "Edit soundboard"}
              >
                {isEditing ? "Done" : "Edit"}
              </Button>

              <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-none"
                aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
              >
                {isCollapsed ? (
                  <RiArrowUpLine className="size-3.5" />
                ) : (
                  <RiSubtractLine className="size-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-none"
                aria-label="Close soundboard"
              >
                <RiCloseLine className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Panel Body (hidden when collapsed) */}
          {!isCollapsed && (
            <Tabs
              value={activeTab}
              onValueChange={(next) => next && setActiveTab(next)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {/* Tab Navigation */}
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5 bg-muted/10">
                <TabsList className="flex items-center gap-1" aria-label="Soundboard view">
                  <TabsTab
                    value="pads"
                    className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors aria-selected:bg-accent aria-selected:text-foreground aria-selected:shadow-xs not-aria-selected:text-muted-foreground not-aria-selected:hover:bg-accent/50 not-aria-selected:hover:text-foreground"
                  >
                    Pads ({data.pads.length})
                  </TabsTab>
                  <TabsTab
                    value="macros"
                    className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors aria-selected:bg-accent aria-selected:text-foreground aria-selected:shadow-xs not-aria-selected:text-muted-foreground not-aria-selected:hover:bg-accent/50 not-aria-selected:hover:text-foreground"
                  >
                    Macros ({data.macros.length})
                  </TabsTab>
                </TabsList>

                {capturing && (
                  <div className="flex items-center gap-1.5 text-xs text-primary animate-pulse font-medium">
                    <RiKeyboardLine className="size-3.5" />
                    <span>Press keys… (Esc cancels)</span>
                  </div>
                )}
              </div>

              {/* Conflict warning banner */}
              {conflictWarning && (
                <div className="px-3 py-1.5 text-[11px] bg-amber-500/10 border-b border-amber-500/20 text-amber-400 flex items-center justify-between">
                  <span>
                    Shortcut conflict with {conflictWarning.type} &ldquo;{conflictWarning.name}
                    &rdquo;
                  </span>
                  <button
                    type="button"
                    onClick={() => setConflictWarning(null)}
                    className="underline hover:text-amber-300 ml-2"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <TabsPanel
                value="pads"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-3"
              >
                {/* Add Sound Drop Zone in Edit Mode */}
                {isEditing && (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 border-dashed transition-colors ${
                      isDraggingOver
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 hover:border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <RiAddLine className="size-6 mb-1 text-muted-foreground" />
                    <span className="text-xs font-medium">Add sounds</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      Drag & drop audio files here, or
                    </span>
                    <label className="mt-1.5 inline-flex items-center justify-center px-2 py-1 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer transition-colors">
                      Browse files
                      <input
                        type="file"
                        accept="audio/*"
                        multiple
                        className="hidden"
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                          if (e.target.files && e.target.files.length > 0) {
                            void addAudioFiles(e.target.files);
                            e.target.value = "";
                          }
                        }}
                      />
                    </label>
                  </div>
                )}

                {/* Empty State */}
                {livePads.length === 0 && !isEditing && (
                  <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                    <RiMusic2Line className="size-10 text-muted-foreground/40 mb-2" />
                    <p className="text-xs font-medium text-foreground">
                      {data.pads.length ? "No pads for this scene" : "No sound pads yet"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
                      {data.pads.length ? (
                        <>
                          Pads set to another scene appear when that scene is live. Use{" "}
                          <strong className="text-foreground">Edit</strong> to set a pad to all
                          scenes.
                        </>
                      ) : (
                        <>
                          Click <strong className="text-foreground">Edit</strong> above to add audio
                          clips for applause, rimshots, music or sound effects.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {!isEditing && liveSceneName && data.pads.some((pad) => pad.scene) && (
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Pads for <strong className="text-foreground">{liveSceneName}</strong> and all
                    scenes
                  </p>
                )}

                {/* Pads Grid (Play Mode) */}
                {!isEditing && livePads.length > 0 && (
                  <div className="grid grid-cols-3 gap-2.5">
                    {livePads.map((pad) => {
                      const isPlaying = playingPads.has(pad.id);
                      return (
                        <Toggle
                          key={pad.id}
                          pressed={isPlaying}
                          onPressedChange={(pressed) => {
                            if (pressed) {
                              void playPad(pad);
                            } else {
                              stopPad(pad.id);
                            }
                          }}
                          style={
                            {
                              "--pad-color": pad.color,
                              "--pad-glow": `${pad.color}80`,
                            } as CSSProperties
                          }
                          className="soundboard-pad group text-left"
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="soundboard-pad-led" />
                            {pad.loop && <RiRepeatLine className="size-3 text-muted-foreground" />}
                          </div>

                          <div className="my-1 w-full min-w-0">
                            <span className="block text-xs font-semibold text-foreground truncate">
                              {pad.name}
                            </span>
                          </div>

                          <div className="flex items-center justify-between w-full mt-auto pt-1">
                            {pad.shortcut ? (
                              <>
                                {" "}
                                <span className="soundboard-shortcut-chip">{pad.shortcut}</span>
                              </>
                            ) : (
                              <span
                                aria-hidden="true"
                                className="text-[10px] text-muted-foreground/50"
                              >
                                —
                              </span>
                            )}
                            {isPlaying && (
                              <RiStopFill className="size-3 text-primary animate-pulse" />
                            )}
                          </div>
                        </Toggle>
                      );
                    })}
                  </div>
                )}

                {/* Pads Editor (Edit Mode) */}
                {isEditing && (
                  <div className="space-y-2">
                    {data.pads.map((pad) => {
                      const isExpanded = expandedPadId === pad.id;
                      return (
                        <div
                          key={pad.id}
                          className="rounded-lg border border-border/50 bg-card/60 p-2.5 space-y-2.5 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div
                                className="size-3.5 rounded-full shrink-0"
                                style={{ backgroundColor: pad.color }}
                              />
                              <Input
                                value={pad.name}
                                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                  updatePad(pad.id, { name: e.target.value })
                                }
                                className="h-7 text-xs font-medium"
                                placeholder="Pad name"
                              />
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setExpandedPadId(isExpanded ? null : pad.id)}
                                className="h-7 px-2 text-xs"
                              >
                                {isExpanded ? "Less" : "Settings"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void removePad(pad.id)}
                                className="h-7 px-1.5 text-destructive hover:text-destructive"
                                aria-label={`Remove ${pad.name}`}
                              >
                                <RiDeleteBinLine className="size-3.5" />
                              </Button>
                            </div>
                          </div>

                          {/* Expanded Pad Settings */}
                          {isExpanded && (
                            <div className="pt-2 border-t border-border/30 space-y-3 text-xs">
                              {/* Color Palette */}
                              <div>
                                <span className="text-[11px] text-muted-foreground block mb-1.5">
                                  Color
                                </span>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {DEFAULT_PAD_COLORS.map((c) => (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => updatePad(pad.id, { color: c })}
                                      style={{ backgroundColor: c }}
                                      className={`size-5 rounded-full transition-transform ${
                                        pad.color === c
                                          ? "scale-110 ring-2 ring-white/60"
                                          : "hover:scale-105 opacity-80 hover:opacity-100"
                                      }`}
                                      aria-label={`Color ${c}`}
                                    />
                                  ))}
                                </div>
                              </div>

                              {/* Volume Slider */}
                              <div>
                                <div className="flex items-center justify-between text-[11px] mb-1">
                                  <span className="text-muted-foreground flex items-center gap-1">
                                    <RiVolumeUpLine className="size-3" />
                                    Volume
                                  </span>
                                  <span className="font-mono text-muted-foreground">
                                    {pad.volumeDB > 0 ? `+${pad.volumeDB}` : pad.volumeDB} dB
                                  </span>
                                </div>
                                <Slider
                                  min={-30}
                                  max={6}
                                  step={1}
                                  value={pad.volumeDB}
                                  onValueChange={(val) => {
                                    const v = typeof val === "number" ? val : (val[0] ?? 0);
                                    updatePad(pad.id, { volumeDB: v });
                                  }}
                                  aria-label={`${pad.name} volume`}
                                />
                              </div>

                              {/* Scene */}
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[11px] text-muted-foreground">Plays on</span>
                                <OptionSelect
                                  value={pad.scene ?? "all"}
                                  onValueChange={(value) =>
                                    updatePad(pad.id, {
                                      scene: value === "all" ? null : String(value),
                                    })
                                  }
                                  aria-label={`Scene for ${pad.name}`}
                                  className="h-7 w-auto max-w-[160px] text-xs"
                                >
                                  <SelectItem value="all">All scenes</SelectItem>
                                  {actions.scenes.map((scene) => (
                                    <SelectItem key={scene.id} value={scene.id}>
                                      {scene.name}
                                    </SelectItem>
                                  ))}
                                </OptionSelect>
                              </div>

                              {/* Loop & Shortcut Controls */}
                              <div className="flex items-center justify-between gap-3 pt-1">
                                <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none">
                                  <Checkbox
                                    checked={pad.loop}
                                    onCheckedChange={(checked) =>
                                      updatePad(pad.id, { loop: Boolean(checked) })
                                    }
                                  />
                                  <span>Loop playback</span>
                                </label>

                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-muted-foreground">
                                    Shortcut:
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                      if (capturing?.target === "pad" && capturing.id === pad.id) {
                                        setCapturing(null);
                                      } else {
                                        setCapturing({ target: "pad", id: pad.id });
                                      }
                                    }}
                                    className={`h-6 px-2 text-[11px] font-mono ${
                                      capturing?.target === "pad" && capturing.id === pad.id
                                        ? "bg-primary text-primary-foreground animate-pulse"
                                        : ""
                                    }`}
                                  >
                                    {capturing?.target === "pad" && capturing.id === pad.id
                                      ? "Press keys…"
                                      : (pad.shortcut ?? "None")}
                                  </Button>
                                  {pad.shortcut && (
                                    <button
                                      type="button"
                                      onClick={() => updatePad(pad.id, { shortcut: null })}
                                      className="text-[10px] text-muted-foreground hover:text-foreground"
                                      aria-label="Clear shortcut"
                                    >
                                      Clear
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Replace audio file */}
                              <div className="pt-1 flex justify-end">
                                <label className="text-[11px] text-primary hover:underline cursor-pointer inline-flex items-center gap-1">
                                  Replace sound file
                                  <input
                                    type="file"
                                    accept="audio/*"
                                    className="hidden"
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        void replacePadSound(pad.id, file);
                                        e.target.value = "";
                                      }
                                    }}
                                  />
                                </label>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsPanel>
              <TabsPanel
                value="macros"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-3"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Trigger multiple actions with one shortcut
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={addMacro}
                      className="h-6 px-2 text-xs gap-1"
                    >
                      <RiAddLine className="size-3.5" />
                      New macro
                    </Button>
                  </div>

                  {data.macros.length === 0 && (
                    <div className="text-center py-8 px-4 text-muted-foreground">
                      <p className="text-xs font-medium text-foreground">No macros configured</p>
                      <p className="text-[11px] mt-1">
                        Create a macro to change scenes, play stings, toggle overlays, and record
                        with a single cue.
                      </p>
                    </div>
                  )}

                  {data.macros.map((macro) => (
                    <div
                      key={macro.id}
                      className="rounded-lg border border-border/50 bg-card/60 p-2.5 space-y-2.5"
                    >
                      {/* Macro header */}
                      <div className="flex items-center justify-between gap-2">
                        <Input
                          value={macro.name}
                          onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            updateMacro(macro.id, { name: e.target.value })
                          }
                          className="h-7 text-xs font-semibold flex-1"
                          placeholder="Macro name"
                        />

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Shortcut button */}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              if (capturing?.target === "macro" && capturing.id === macro.id) {
                                setCapturing(null);
                              } else {
                                setCapturing({ target: "macro", id: macro.id });
                              }
                            }}
                            className={`h-6 px-2 text-[11px] font-mono ${
                              capturing?.target === "macro" && capturing.id === macro.id
                                ? "bg-primary text-primary-foreground animate-pulse"
                                : ""
                            }`}
                          >
                            {capturing?.target === "macro" && capturing.id === macro.id
                              ? "Press keys…"
                              : (macro.shortcut ?? "Shortcut")}
                          </Button>
                          {macro.shortcut && (
                            <button
                              type="button"
                              onClick={() => updateMacro(macro.id, { shortcut: null })}
                              className="text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              Clear
                            </button>
                          )}

                          {/* Run macro */}
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => void runMacro(macro)}
                            className="h-6 px-2 text-[11px] gap-1"
                          >
                            <RiPlayFill className="size-3" />
                            Run
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeMacro(macro.id)}
                            aria-label={`Remove ${macro.name} macro`}
                            className="h-6 px-1.5 text-destructive hover:text-destructive"
                          >
                            <RiDeleteBinLine className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Steps List */}
                      <div className="space-y-1.5">
                        {macro.steps.length === 0 && (
                          <p className="text-[11px] text-muted-foreground italic py-1">
                            No steps yet. Add a step below.
                          </p>
                        )}
                        {macro.steps.map((step, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-md bg-muted/20 border border-border/30 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[10px] text-muted-foreground w-4">
                                {idx + 1}.
                              </span>
                              <span className="truncate">
                                {renderStepDescription(step, data.pads, actions)}
                              </span>
                            </div>

                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveMacroStep(macro.id, idx, "up")}
                                className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                aria-label="Move step up"
                              >
                                <RiArrowUpLine className="size-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === macro.steps.length - 1}
                                onClick={() => moveMacroStep(macro.id, idx, "down")}
                                className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                aria-label="Move step down"
                              >
                                <RiArrowDownLine className="size-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeMacroStep(macro.id, idx)}
                                className="p-0.5 text-muted-foreground hover:text-destructive ml-1"
                                aria-label="Remove step"
                              >
                                <RiCloseLine className="size-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Add Step Selector */}
                      <MacroStepAdder
                        pads={data.pads}
                        actions={actions}
                        onAddStep={(step) => addMacroStep(macro.id, step)}
                      />
                    </div>
                  ))}
                </div>
              </TabsPanel>
            </Tabs>
          )}
        </div>
      )}
    </>
  );
}

function renderStepDescription(
  step: MacroStep,
  pads: readonly Pad[],
  actions: SoundboardActions,
): string {
  switch (step.kind) {
    case "play": {
      const pad = pads.find((p) => p.id === step.padId);
      return `Play sound: ${pad ? pad.name : "Unknown pad"}`;
    }
    case "stop-all":
      return "Stop all sounds";
    case "wait":
      return `Wait ${step.ms} ms`;
    case "scene": {
      const scene = actions.scenes.find((s) => s.id === step.sceneId);
      return `Switch scene: ${scene ? scene.name : step.sceneId}`;
    }
    case "overlay": {
      const overlay = actions.overlays.find((o) => o.id === step.overlayId);
      const label = overlay ? overlay.text : step.overlayId;
      return `${step.visible ? "Show" : "Hide"} overlay: ${label}`;
    }
    case "record":
      return `${step.action === "start" ? "Start" : "Stop"} recording`;
    case "mark":
      return "Add marker";
  }
}

function MacroStepAdder({
  pads,
  actions,
  onAddStep,
}: {
  pads: readonly Pad[];
  actions: SoundboardActions;
  onAddStep: (step: MacroStep) => void;
}) {
  const [kind, setKind] = useState<MacroStep["kind"]>("play");
  const [padId, setPadId] = useState<string>(pads[0]?.id ?? "");
  const [sceneId, setSceneId] = useState<string>(actions.scenes[0]?.id ?? "");
  const [overlayId, setOverlayId] = useState<string>(actions.overlays[0]?.id ?? "");
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [waitMs, setWaitMs] = useState(500);
  const [recordAction, setRecordAction] = useState<"start" | "stop">("start");

  // Keep defaults updated if actions/pads populate later
  useEffect(() => {
    if (!padId && pads[0]) setPadId(pads[0].id);
  }, [pads, padId]);

  useEffect(() => {
    if (!sceneId && actions.scenes[0]) setSceneId(actions.scenes[0].id);
  }, [actions.scenes, sceneId]);

  useEffect(() => {
    if (!overlayId && actions.overlays[0]) setOverlayId(actions.overlays[0].id);
  }, [actions.overlays, overlayId]);

  const handleAdd = () => {
    switch (kind) {
      case "play":
        if (padId) onAddStep({ kind: "play", padId });
        break;
      case "stop-all":
        onAddStep({ kind: "stop-all" });
        break;
      case "wait":
        onAddStep({ kind: "wait", ms: Math.max(0, waitMs) });
        break;
      case "scene":
        if (sceneId) onAddStep({ kind: "scene", sceneId });
        break;
      case "overlay":
        if (overlayId) onAddStep({ kind: "overlay", overlayId, visible: overlayVisible });
        break;
      case "record":
        onAddStep({ kind: "record", action: recordAction });
        break;
      case "mark":
        onAddStep({ kind: "mark" });
        break;
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/20">
      {/* Step Kind Selector */}
      <OptionSelect
        value={kind}
        onValueChange={(value) => setKind(value as MacroStep["kind"])}
        aria-label="Step type"
        className="h-7 w-auto text-xs"
      >
        <SelectItem value="play">Play sound</SelectItem>
        <SelectItem value="stop-all">Stop all sounds</SelectItem>
        <SelectItem value="wait">Wait delay</SelectItem>
        <SelectItem value="scene">Switch scene</SelectItem>
        <SelectItem value="overlay">Set overlay</SelectItem>
        <SelectItem value="record">Record</SelectItem>
        <SelectItem value="mark">Add marker</SelectItem>
      </OptionSelect>

      {/* Dynamic Step Options */}
      {kind === "play" && (
        <OptionSelect
          value={padId}
          onValueChange={setPadId}
          aria-label="Sound pad"
          className="h-7 w-auto text-xs max-w-[140px]"
        >
          {pads.length === 0 ? (
            <SelectItem value="">No pads created</SelectItem>
          ) : (
            pads.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))
          )}
        </OptionSelect>
      )}

      {kind === "wait" && (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            step={100}
            value={waitMs}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWaitMs(Number(e.target.value))}
            className="h-7 w-20 text-xs font-mono"
          />
          <span className="text-[11px] text-muted-foreground">ms</span>
        </div>
      )}

      {kind === "scene" && (
        <OptionSelect
          value={sceneId}
          onValueChange={setSceneId}
          className="h-7 w-auto text-xs max-w-[140px]"
        >
          {actions.scenes.length === 0 ? (
            <SelectItem value="">No scenes available</SelectItem>
          ) : (
            actions.scenes.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))
          )}
        </OptionSelect>
      )}

      {kind === "overlay" && (
        <div className="flex items-center gap-1.5">
          <OptionSelect
            value={overlayId}
            onValueChange={setOverlayId}
            className="h-7 w-auto text-xs max-w-[130px]"
          >
            {actions.overlays.length === 0 ? (
              <SelectItem value="">No overlays</SelectItem>
            ) : (
              actions.overlays.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.text}
                </SelectItem>
              ))
            )}
          </OptionSelect>
          <OptionSelect
            value={overlayVisible ? "show" : "hide"}
            onValueChange={(value) => setOverlayVisible(value === "show")}
            className="h-7 w-auto text-xs"
          >
            <SelectItem value="show">Show</SelectItem>
            <SelectItem value="hide">Hide</SelectItem>
          </OptionSelect>
        </div>
      )}

      {kind === "record" && (
        <OptionSelect
          value={recordAction}
          onValueChange={(value) => setRecordAction(value as "start" | "stop")}
          className="h-7 w-auto text-xs"
        >
          <SelectItem value="start">Start</SelectItem>
          <SelectItem value="stop">Stop</SelectItem>
        </OptionSelect>
      )}

      <Button
        size="sm"
        variant="secondary"
        onClick={handleAdd}
        className="h-7 px-2 text-xs ml-auto gap-1"
      >
        <RiCheckLine className="size-3" />
        Add
      </Button>
    </div>
  );
}

/**
 * Small toolbar toggle button for parent header/toolbar.
 */
export function SoundboardToggle({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={open ? "default" : "secondary"}
      onClick={() => onOpenChange(!open)}
      aria-label="Soundboard"
      aria-expanded={open}
      className="gap-1.5"
    >
      <RiMusic2Line className="size-4" />
      <span>Soundboard</span>
    </Button>
  );
}

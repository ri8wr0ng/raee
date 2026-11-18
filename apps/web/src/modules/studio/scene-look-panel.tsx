import { useEffect, useRef, useState, type ReactNode } from "react";
import { LIVE_BACKGROUNDS, type LiveAssets, type LiveOverlay } from "@sidecut/core/live-assets";
import { paintLiveBackground } from "@sidecut/platform-browser/live-assets";
import { Button } from "@sidecut/ui/components/button";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@sidecut/ui/components/select";
import { Slider } from "@sidecut/ui/components/slider";
import { Switch } from "@sidecut/ui/components/switch";
import { Textarea } from "@sidecut/ui/components/textarea";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { Toggle } from "@ui-sdk/react/toggle";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiEyeLine,
  RiEyeOffLine,
  RiFullscreenLine,
  RiLayoutBottom2Line,
  RiPriceTag3Line,
} from "@remixicon/react";
import "./scene-look-panel.css";

type Kind = LiveOverlay["kind"];
type Background = LiveAssets["background"];

const MAX_OVERLAYS = 20;
const KINDS: readonly { value: Kind; label: string; icon: typeof RiAddLine }[] = [
  { value: "banner", label: "Banner", icon: RiLayoutBottom2Line },
  { value: "takeover", label: "Takeover", icon: RiFullscreenLine },
  { value: "highlight", label: "Highlight", icon: RiPriceTag3Line },
];
const MOTIONS: readonly { value: LiveOverlay["motion"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "slide", label: "Slide" },
  { value: "pulse", label: "Pulse" },
];
const BOUNDS: Record<Kind, Pick<LiveOverlay, "x" | "y" | "width" | "height">> = {
  banner: { x: 0.05, y: 0.8, width: 0.9, height: 0.12 },
  takeover: { x: 0, y: 0, width: 1, height: 1 },
  highlight: { x: 0.6, y: 0.05, width: 0.35, height: 0.2 },
};
const STARTER_TEXT: Record<Kind, string> = {
  banner: "Your name, your title",
  takeover: "Be right back",
  highlight: "New",
};

const label = (value: string) => value[0]!.toUpperCase() + value.slice(1);

/** A still frame of a background, drawn by the same painter as the program output. */
function BackgroundSwatch({ assets }: { assets: LiveAssets }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    paintLiveBackground(ctx, { ...assets, motion: false }, 0, true);
    // Particles are sub-pixel at swatch size; redraw the same dots large enough to see.
    if (assets.background === "particles") {
      const { width: w, height: h } = ctx.canvas;
      ctx.save();
      ctx.fillStyle = assets.accent;
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 48; i++) {
        ctx.beginPath();
        ctx.arc(
          ((i * 0.61803398875) % 1) * w,
          ((i * 0.41421356237) % 1) * h,
          1 + (i % 3) * 0.6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }, [assets]);
  return <canvas ref={canvas} width={128} height={72} aria-hidden />;
}

function ColorButton({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="look-color" data-disabled={disabled || undefined}>
      <span className="look-color-chip" style={{ background: value }} aria-hidden />
      <span className="look-color-text">
        <span>{name}</span>
        <span className="look-color-hex">{value.toUpperCase()}</span>
      </span>
      <input
        type="color"
        className="sr-only"
        aria-label={name}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <RadioGroup
      aria-label={name}
      className="grid w-full gap-2 look-segmented"
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
    >
      {options.map((option) => (
        <label key={option.value} data-checked={value === option.value || undefined}>
          <Radio value={option.value} className="sr-only" />
          {option.label}
        </label>
      ))}
    </RadioGroup>
  );
}

function Field({ label: name, children }: { label: string; children: ReactNode }) {
  return (
    <div className="look-field">
      <span className="look-field-label">{name}</span>
      {children}
    </div>
  );
}

/**
 * The look of one saved scene: its background and the text overlays drawn over the program.
 * Changes stay in the draft until the user saves them.
 */
export function SceneLookPanel({
  draft,
  onDraftChange,
  disabled,
  dirty,
  canPlace,
  selectedOverlay,
  onSelectOverlay,
  onSave,
}: {
  draft: LiveAssets;
  onDraftChange: (next: LiveAssets) => void;
  /** No scene is saved yet, so there is nothing to style. */
  disabled: boolean;
  /** The draft differs from what the scene saved. */
  dirty: boolean;
  /** The program preview is running, so overlays can be placed on it. */
  canPlace: boolean;
  selectedOverlay: string | null;
  onSelectOverlay: (id: string | null) => void;
  onSave: (goLive: boolean) => void;
}) {
  const [addKey, setAddKey] = useState(0);
  const focusText = useRef<string | null>(null);
  const set = (change: Partial<LiveAssets>) => onDraftChange({ ...draft, ...change });
  const setOverlay = (id: string, change: Partial<LiveOverlay>) =>
    set({
      overlays: draft.overlays.map((item) => (item.id === id ? { ...item, ...change } : item)),
    });
  const addOverlay = (kind: Kind) => {
    const id = crypto.randomUUID();
    set({
      overlays: [
        ...draft.overlays,
        {
          id,
          kind,
          text: STARTER_TEXT[kind],
          ...BOUNDS[kind],
          color: draft.accent,
          textColor: "#ffffff",
          opacity: kind === "takeover" ? 0.9 : 1,
          enabled: true,
          motion: "none",
          start: 0,
          duration: 86400,
        },
      ],
    });
    focusText.current = id;
    onSelectOverlay(id);
  };

  if (disabled)
    return (
      <p className="look-empty">
        Save a scene from the editor first. Its background and overlays are styled here.
      </p>
    );

  const full = draft.overlays.length >= MAX_OVERLAYS;
  return (
    <div className="look">
      <Field label="Background">
        <RadioGroup
          aria-label="Background"
          className="grid w-full gap-2 look-backgrounds"
          value={draft.background}
          onValueChange={(background) =>
            background && set({ background: background as Background })
          }
        >
          {LIVE_BACKGROUNDS.map((background) => (
            <label
              key={background}
              className="look-background"
              data-checked={draft.background === background || undefined}
              title={label(background)}
            >
              <Radio value={background} className="sr-only" />
              <BackgroundSwatch assets={{ ...draft, background }} />
              <span>{label(background)}</span>
            </label>
          ))}
        </RadioGroup>
      </Field>

      <div className="look-colors">
        <ColorButton
          name="Base"
          value={draft.color}
          disabled={false}
          onChange={(color) => set({ color })}
        />
        <ColorButton
          name="Accent"
          value={draft.accent}
          disabled={false}
          onChange={(accent) => set({ accent })}
        />
      </div>

      <div className="look-motion">
        <label className="look-switch">
          <Switch checked={draft.motion} onCheckedChange={(motion) => set({ motion })} />
          Animate background
        </label>
        {draft.motion && draft.background !== "solid" && (
          <label className="look-speed">
            <span className="look-field-label">Speed</span>
            <Slider
              aria-label="Animation speed"
              min={0.1}
              max={2}
              step={0.1}
              value={draft.speed}
              onValueChange={(speed) => set({ speed: speed as number })}
            />
            <output>{draft.speed.toFixed(1)}×</output>
          </label>
        )}
      </div>

      <section className="look-overlays" aria-label="Overlays">
        <header>
          <h4>
            Overlays
            {draft.overlays.length > 0 && (
              <span className="look-count">
                {draft.overlays.length} of {MAX_OVERLAYS}
              </span>
            )}
          </h4>
          <Select
            key={addKey}
            value=""
            disabled={full}
            onValueChange={(kind) => {
              if (kind) addOverlay(kind as Kind);
              setAddKey((key) => key + 1);
            }}
          >
            <SelectTrigger size="sm" aria-label="Add overlay" className="h-7 text-xs">
              <RiAddLine data-icon="inline-start" className="size-3.5" />
              Add overlay
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              {KINDS.map(({ value, label: name, icon: Icon }) => (
                <SelectItem key={value} value={value}>
                  <Icon className="text-muted-foreground" />
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        {draft.overlays.length === 0 ? (
          <p className="look-hint">
            Add a banner for your name, a takeover for breaks, or a highlight to call something out.
          </p>
        ) : (
          <ul className="look-overlay-list">
            {draft.overlays.map((overlay) => {
              const open = selectedOverlay === overlay.id;
              const Icon = KINDS.find((kind) => kind.value === overlay.kind)!.icon;
              return (
                <Collapsible
                  key={overlay.id}
                  render={<li />}
                  open={open}
                  onOpenChange={(next) => onSelectOverlay(next ? overlay.id : null)}
                  data-hidden={!overlay.enabled || undefined}
                >
                  <div className="look-overlay-row">
                    <CollapsibleTrigger className="look-overlay-main">
                      <span className="look-overlay-icon" style={{ background: overlay.color }}>
                        <Icon aria-hidden style={{ color: overlay.textColor }} />
                      </span>
                      <span className="look-overlay-text">
                        {overlay.text.trim() || <em>No text</em>}
                      </span>
                      <RiArrowDownSLine className="look-overlay-chevron" aria-hidden />
                    </CollapsibleTrigger>
                    <Toggle
                      aria-label={overlay.enabled ? `Hide ${overlay.text}` : `Show ${overlay.text}`}
                      title={overlay.enabled ? "Hide" : "Show"}
                      pressed={!overlay.enabled}
                      onPressedChange={(hidden) => setOverlay(overlay.id, { enabled: !hidden })}
                      render={<Button size="icon-xs" variant="ghost" />}
                    >
                      {overlay.enabled ? <RiEyeLine /> : <RiEyeOffLine />}
                    </Toggle>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${overlay.text}`}
                      title="Remove"
                      onClick={() => {
                        if (open) onSelectOverlay(null);
                        set({ overlays: draft.overlays.filter((item) => item.id !== overlay.id) });
                      }}
                    >
                      <RiDeleteBinLine />
                    </Button>
                  </div>
                  <CollapsiblePanel>
                    <div className="look-overlay-editor">
                      <Textarea
                        aria-label="Overlay text"
                        rows={2}
                        maxLength={500}
                        value={overlay.text}
                        ref={(node) => {
                          if (node && focusText.current === overlay.id) {
                            focusText.current = null;
                            node.focus();
                            node.select();
                          }
                        }}
                        onChange={(event) => setOverlay(overlay.id, { text: event.target.value })}
                      />
                      <Field label="Type">
                        <Segmented
                          name="Overlay type"
                          value={overlay.kind}
                          options={KINDS}
                          onChange={(kind) => setOverlay(overlay.id, { kind, ...BOUNDS[kind] })}
                        />
                      </Field>
                      <div className="look-colors">
                        <ColorButton
                          name="Fill"
                          value={overlay.color}
                          disabled={false}
                          onChange={(color) => setOverlay(overlay.id, { color })}
                        />
                        <ColorButton
                          name="Text"
                          value={overlay.textColor}
                          disabled={false}
                          onChange={(textColor) => setOverlay(overlay.id, { textColor })}
                        />
                      </div>
                      <Field label="Opacity">
                        <div className="look-slider">
                          <Slider
                            aria-label="Overlay opacity"
                            min={0.1}
                            max={1}
                            step={0.05}
                            value={overlay.opacity}
                            onValueChange={(opacity) =>
                              setOverlay(overlay.id, { opacity: opacity as number })
                            }
                          />
                          <output>{Math.round(overlay.opacity * 100)}%</output>
                        </div>
                      </Field>
                      <Field label="Entrance">
                        <Segmented
                          name="Overlay entrance"
                          value={overlay.motion}
                          options={MOTIONS}
                          onChange={(motion) => setOverlay(overlay.id, { motion })}
                        />
                      </Field>
                      <p className="look-hint">
                        <RiDragMove2Line aria-hidden />
                        {!overlay.enabled
                          ? "Show this overlay to place it on the preview."
                          : canPlace
                            ? "Drag it on the preview to move it, or pull its edges to resize."
                            : "Put a scene on air to place this overlay on the preview."}
                      </p>
                    </div>
                  </CollapsiblePanel>
                </Collapsible>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="look-footer">
        <span className="look-status" role="status" data-dirty={dirty || undefined}>
          {dirty ? "Unsaved changes" : "Saved"}
        </span>
        <Button size="sm" variant="outline" disabled={!dirty} onClick={() => onSave(false)}>
          Save look
        </Button>
        <Button size="sm" onClick={() => onSave(true)}>
          Save and put on air
        </Button>
      </footer>
    </div>
  );
}

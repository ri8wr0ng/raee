import { useState, type ReactNode } from "react";
import type { LiveAudioSettings } from "@sidecut/core/live-audio";
import { Button } from "@sidecut/ui/components/button";
import { Checkbox } from "@sidecut/ui/components/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@sidecut/ui/components/select";
import { Slider } from "@sidecut/ui/components/slider";
import {
  RiAddLine,
  RiCloseLine,
  RiComputerLine,
  RiEqualizerLine,
  RiHeadphoneLine,
  RiFilmLine,
  RiMicLine,
  RiMusic2Line,
  RiVideoOnLine,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import "./audio-mixer-panel.css";

export type AudioMixerChannelKind = "microphone" | "screen" | "camera" | "video" | "sound";

export type AudioMixerChannel = {
  readonly id: string;
  readonly label: string;
  readonly kind: AudioMixerChannelKind;
  readonly settings: LiveAudioSettings;
  readonly level: number /* 0..1 peak */;
  readonly gated?: boolean | undefined;
};

export type AudioMixerDevice = {
  readonly deviceId: string;
  readonly label: string;
};

export type AudioMixerPanelProps = {
  readonly channels: readonly AudioMixerChannel[];
  readonly devices: readonly AudioMixerDevice[];
  readonly onAddInput: (deviceId: string | null) => void;
  readonly onUpdate: (id: string, patch: Partial<LiveAudioSettings>) => void;
  readonly onRemove: (id: string) => void;
};

function ChannelKindIcon({ kind }: { readonly kind: AudioMixerChannelKind }): ReactNode {
  switch (kind) {
    case "microphone":
      return <RiMicLine className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
    case "screen":
      return (
        <RiComputerLine className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      );
    case "camera":
      return <RiVideoOnLine className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
    case "video":
      return <RiFilmLine className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
    case "sound":
      return <RiMusic2Line className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
}

/**
 * Compact channel-strip audio mixer panel.
 * Displays volume, peak meter, mute, monitor, delay and rumble filters
 * for all audio-producing sources.
 */
export function AudioMixerPanel({
  channels = [],
  devices = [],
  onAddInput,
  onUpdate,
  onRemove,
}: AudioMixerPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectKey, setSelectKey] = useState(0);

  const seen = new Set<string>();
  const uniqueDevices = devices.filter((device) => {
    if (!device.deviceId || device.deviceId === "default" || seen.has(device.deviceId)) {
      return false;
    }
    seen.add(device.deviceId);
    return true;
  });

  return (
    <div className="audio-mixer" aria-label="Audio mixer">
      <div className="audio-mixer-header">
        <Select
          key={selectKey}
          value=""
          onValueChange={(val) => {
            if (!val) return;
            onAddInput(val === "__default__" ? null : val);
            setSelectKey((k) => k + 1);
          }}
        >
          <SelectTrigger size="sm" aria-label="Add audio input" className="h-7 text-xs">
            <RiAddLine data-icon="inline-start" className="size-3.5" />
            <span>Add audio input</span>
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectItem value="__default__">Default microphone</SelectItem>
            {uniqueDevices.map((device) => (
              <SelectItem key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone (${device.deviceId.slice(0, 6)})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {channels.length === 0 ? (
        <p className="audio-mixer-empty">
          Add a microphone for your voice, or share a tab with audio.
        </p>
      ) : (
        <div className="audio-mixer-channels">
          {channels.map((channel) => {
            const clampedLevel = Math.max(
              0,
              Math.min(1, Number.isFinite(channel.level) ? channel.level : 0),
            );
            const peakStatus =
              clampedLevel >= 0.95 ? "clip" : clampedLevel >= 0.75 ? "warn" : "normal";
            const levelPercent = (clampedLevel * 100).toFixed(1);
            const isExpanded = Boolean(expanded[channel.id]);
            const isMuted = channel.settings.muted;
            const isMonitored = channel.settings.monitor;

            return (
              <div
                key={channel.id}
                className="audio-mixer-strip"
                data-gated={channel.gated || undefined}
              >
                <div className="audio-mixer-strip-top">
                  <div className="audio-mixer-strip-info">
                    <ChannelKindIcon kind={channel.kind} />
                    <span className="audio-mixer-strip-label" title={channel.label}>
                      {channel.label}
                    </span>
                    {channel.gated && (
                      <span className="audio-mixer-strip-hint">Not in live scene</span>
                    )}
                  </div>

                  <div className="audio-mixer-strip-actions">
                    <Button
                      size="icon-xs"
                      variant={isMuted ? "destructive" : "ghost"}
                      aria-label={`Mute ${channel.label}`}
                      aria-pressed={isMuted}
                      title={isMuted ? `Unmute ${channel.label}` : `Mute ${channel.label}`}
                      onClick={() => onUpdate(channel.id, { muted: !isMuted })}
                    >
                      {isMuted ? <RiVolumeMuteLine /> : <RiVolumeUpLine />}
                    </Button>

                    <Button
                      size="icon-xs"
                      variant={isMonitored ? "secondary" : "ghost"}
                      aria-label={`Monitor ${channel.label}`}
                      aria-pressed={isMonitored}
                      title={
                        isMonitored
                          ? `Stop monitoring ${channel.label}`
                          : `Monitor ${channel.label}`
                      }
                      className={isMonitored ? "text-primary" : ""}
                      onClick={() => onUpdate(channel.id, { monitor: !isMonitored })}
                    >
                      <RiHeadphoneLine />
                    </Button>

                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`More settings for ${channel.label}`}
                      aria-expanded={isExpanded}
                      title={isExpanded ? "Hide extra settings" : "Show extra settings"}
                      className={isExpanded ? "text-primary" : ""}
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [channel.id]: !prev[channel.id],
                        }))
                      }
                    >
                      <RiEqualizerLine />
                    </Button>

                    {(channel.kind === "microphone" || channel.kind === "sound") && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${channel.label}`}
                        title={`Remove ${channel.label}`}
                        onClick={() => onRemove(channel.id)}
                      >
                        <RiCloseLine />
                      </Button>
                    )}
                  </div>
                </div>

                <div
                  role="meter"
                  aria-label={`${channel.label} level`}
                  aria-valuenow={Math.round(clampedLevel * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="audio-mixer-meter"
                >
                  <div
                    className="audio-mixer-meter-fill"
                    data-peak={peakStatus}
                    style={{ width: `${levelPercent}%` }}
                  />
                </div>

                <div
                  className="audio-mixer-volume-row"
                  onDoubleClick={() => onUpdate(channel.id, { gainDB: 0 })}
                  title="Double-click to reset to 0 dB"
                >
                  <span className="audio-mixer-volume-label">Volume</span>
                  <Slider
                    aria-label={`${channel.label} volume`}
                    min={-60}
                    max={12}
                    step={1}
                    value={channel.settings.gainDB}
                    onValueChange={(val) => {
                      const gainDB = typeof val === "number" ? val : (val[0] ?? 0);
                      onUpdate(channel.id, { gainDB });
                    }}
                  />
                  <button
                    type="button"
                    className="audio-mixer-db-button"
                    aria-label={`Reset ${channel.label} volume to 0 dB`}
                    title="Reset to 0 dB"
                    onClick={() => onUpdate(channel.id, { gainDB: 0 })}
                  >
                    {channel.settings.gainDB > 0
                      ? `+${channel.settings.gainDB}`
                      : channel.settings.gainDB}{" "}
                    dB
                  </button>
                </div>

                {isExpanded && (
                  <div className="audio-mixer-overflow">
                    <div className="audio-mixer-delay-row">
                      <span className="audio-mixer-volume-label">Delay</span>
                      <Slider
                        aria-label={`${channel.label} delay`}
                        min={0}
                        max={500}
                        step={10}
                        value={channel.settings.syncOffsetMs}
                        onValueChange={(val) => {
                          const syncOffsetMs = typeof val === "number" ? val : (val[0] ?? 0);
                          onUpdate(channel.id, { syncOffsetMs });
                        }}
                      />
                      <output className="text-xs text-foreground tabular-nums text-right">
                        {channel.settings.syncOffsetMs} ms
                      </output>
                    </div>

                    <label className="audio-mixer-check">
                      <Checkbox
                        aria-label={`Remove rumble for ${channel.label}`}
                        checked={channel.settings.cleanup === "rumble"}
                        onCheckedChange={(checked) =>
                          onUpdate(channel.id, { cleanup: checked ? "rumble" : "off" })
                        }
                      />
                      <span className="text-xs text-muted-foreground">Remove rumble</span>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AudioMixerPanel;

import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiDeleteBinLine,
  RiLinksLine,
  RiLinkUnlinkM,
  RiLockLine,
  RiLockUnlockLine,
  RiScissorsCutLine,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import { Button } from "@raee/ui/components/button";
import { Toggle } from "@ui-sdk/react/toggle";
import { Toolbar, ToolbarButton, ToolbarGroup } from "@ui-sdk/react/toolbar";

// Toolbar items stay focusable and report aria-disabled, which Button's `disabled:` classes don't match.
const DISABLED_LOOK = "aria-disabled:pointer-events-none aria-disabled:[&_svg]:opacity-50";
const RIPPLE_HELP = {
  cut: "Ripple edits split and shift clips on this track",
  follow: "Ripple edits shift clips on this track without splitting them",
  off: "Ripple edits leave this track in place",
} as const;

export type TrackControlsTrack = {
  name: string;
  locked: boolean;
  muted: boolean;
  rippleMode: keyof typeof RIPPLE_HELP;
};

/** One toolbar per track header: lock, mute, ripple mode and track order, with a single tab stop. */
export function TrackControls({
  track,
  index,
  step,
  count,
  disabled,
  patch,
  move,
  remove,
}: {
  track: TrackControlsTrack;
  /** Position of the track within its kind's list. */
  index: number;
  /** +1 for video tracks, -1 for audio tracks: which way "up" moves in the list. */
  step: number;
  /** Number of tracks of this kind. */
  count: number;
  disabled: boolean;
  patch: (changes: Record<string, unknown>) => void;
  move: (index: number) => void;
  remove: () => void;
}) {
  return (
    <Toolbar className="editor-track-controls" aria-label={`${track.name} track controls`}>
      <Toggle
        disabled={disabled}
        aria-label={`Lock track ${track.name}`}
        title={track.locked ? "Unlock track" : "Lock track"}
        pressed={track.locked}
        onPressedChange={(locked) => patch({ locked })}
        render={
          <Button
            size="icon-xs"
            variant={track.locked ? "secondary" : "ghost"}
            className={DISABLED_LOOK}
          />
        }
      >
        {track.locked ? <RiLockLine aria-hidden="true" /> : <RiLockUnlockLine aria-hidden="true" />}
      </Toggle>
      <Toggle
        disabled={disabled}
        aria-label={`Mute track ${track.name}`}
        title={track.muted ? "Unmute track" : "Mute track"}
        pressed={track.muted}
        onPressedChange={(muted) => patch({ muted })}
        render={
          <Button
            size="icon-xs"
            variant={track.muted ? "secondary" : "ghost"}
            className={DISABLED_LOOK}
          />
        }
      >
        {track.muted ? (
          <RiVolumeMuteLine aria-hidden="true" />
        ) : (
          <RiVolumeUpLine aria-hidden="true" />
        )}
      </Toggle>
      <ToolbarButton
        disabled={disabled}
        aria-label={`Ripple mode ${track.name}: ${track.rippleMode}`}
        title={`${RIPPLE_HELP[track.rippleMode]}. Click to change.`}
        render={<Button size="icon-xs" variant="ghost" className={DISABLED_LOOK} />}
        onClick={() =>
          patch({
            rippleMode:
              track.rippleMode === "cut" ? "follow" : track.rippleMode === "follow" ? "off" : "cut",
          })
        }
      >
        {track.rippleMode === "cut" ? (
          <RiScissorsCutLine aria-hidden="true" />
        ) : track.rippleMode === "follow" ? (
          <RiLinksLine aria-hidden="true" />
        ) : (
          <RiLinkUnlinkM aria-hidden="true" />
        )}
      </ToolbarButton>
      <ToolbarGroup className="editor-track-extra" aria-label={`${track.name} track order`}>
        <ToolbarButton
          disabled={disabled || index + step < 0 || index + step >= count}
          aria-label={`Move track ${track.name} up`}
          title="Move track up"
          render={<Button size="icon-xs" variant="ghost" className={DISABLED_LOOK} />}
          onClick={() => move(index + step)}
        >
          <RiArrowUpSLine aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled || index - step < 0 || index - step >= count}
          aria-label={`Move track ${track.name} down`}
          title="Move track down"
          render={<Button size="icon-xs" variant="ghost" className={DISABLED_LOOK} />}
          onClick={() => move(index - step)}
        >
          <RiArrowDownSLine aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled || track.locked}
          aria-label={`Remove track ${track.name}`}
          title="Remove track and its clips; Undo restores them"
          data-agent-confirm={`Removes track ${track.name} and its clips`}
          render={<Button size="icon-xs" variant="ghost" className={DISABLED_LOOK} />}
          onClick={remove}
        >
          <RiDeleteBinLine aria-hidden="true" />
        </ToolbarButton>
      </ToolbarGroup>
    </Toolbar>
  );
}

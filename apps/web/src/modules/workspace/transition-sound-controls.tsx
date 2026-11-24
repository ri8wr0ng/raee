import { readPreference, writePreference } from "@raee/platform-browser/preferences";
import { useState } from "react";
import type { Project, Track } from "@raee/contracts/project";
import { transitionWindow } from "@raee/core/transitions";
import { Button } from "@raee/ui/components/button";
import { FieldError } from "@raee/ui/components/field";
import { Input } from "@raee/ui/components/input";
import { useEditorSession } from "./editor-session";
import { ActionRow, Hint, InspectorSection, PropertyRow } from "./inspector-layout";
import { OptionSelect, SelectItem } from "@raee/ui/components/option-select";
interface SoundDefault {
  mediaID: string;
  gainDB: number;
  offset: number;
}
const defaultKey = (projectID: string, type: string) =>
  `sidecut:transitionSound:${projectID}:${type}`;
export function defaultTransitionSound(
  project: Project,
  type: string,
): SoundDefault | null | undefined {
  try {
    const raw = readPreference(defaultKey(project.id, type));
    if (raw == null) return undefined;
    const value: unknown = JSON.parse(raw);
    if (value === null) return null;
    if (
      value &&
      typeof value === "object" &&
      "mediaID" in value &&
      "gainDB" in value &&
      "offset" in value &&
      typeof value.mediaID === "string" &&
      typeof value.gainDB === "number" &&
      Number.isFinite(value.gainDB) &&
      typeof value.offset === "number" &&
      Number.isFinite(value.offset) &&
      project.media.some((m) => m.id === value.mediaID && m.hasAudio)
    )
      return value as SoundDefault;
  } catch {
    /* A missing or corrupt preference uses the type's built-in default. */
  }
  return undefined;
}
export function TransitionSoundControls({
  track,
  transition,
}: {
  track: Track;
  transition: Track["transitions"][number];
}) {
  const { snapshot, session } = useEditorSession(),
    project = snapshot.project;
  const current = project.audioTracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === transition.soundClipID);
  const ref = current?.content.media,
    currentID = ref && typeof ref === "object" && "mediaID" in ref ? String(ref.mediaID) : "";
  const window = transitionWindow(track, transition),
    center = window ? window.start + window.duration / 2 : 0;
  const [mediaID, setMediaID] = useState(currentID),
    [gainDB, setGain] = useState(String(current?.audio?.gainDB ?? -15)),
    [offset, setOffset] = useState(
      String(current ? current.start.seconds - center : (window?.start ?? 0) - center),
    ),
    [tie, setTie] = useState(""),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const disabled = snapshot.readOnly || snapshot.busy || track.locked;
  const sound = () => {
    if (!mediaID) return null;
    if (!Number.isFinite(Number(gainDB)) || !Number.isFinite(Number(offset)))
      throw new Error("Sound gain and offset must be finite numbers.");
    return { mediaID, gainDB: Number(gainDB), offset: Number(offset) };
  };
  const run = (patch: object) => {
    setError(null);
    try {
      session.apply({
        label: "Edit transition sound",
        expectedRevision: snapshot.revision,
        commands: [{ updateTransition: { transitionID: transition.id, patch } }],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const media = project.media.find((m) => m.id === mediaID);
  const type = String(transition.type),
    builtIn = ["push", "slide", "cutSlide", "wipe"].includes(type);
  return (
    <InspectorSection id="transitions.sound" title="Sound" label="Transition sound">
      <PropertyRow label="Source" htmlFor={`sound-media-${transition.id}`}>
        <OptionSelect
          id={`sound-media-${transition.id}`}
          value={mediaID}
          disabled={disabled}
          onValueChange={setMediaID}
        >
          <SelectItem value="">None</SelectItem>
          {project.media
            .filter((m) => m.hasAudio)
            .map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.path}
              </SelectItem>
            ))}
        </OptionSelect>
      </PropertyRow>
      {media && (
        <Hint>
          Source: {media.path}
          {typeof media.attribution === "string" ? ` · ${media.attribution}` : ""}. Source metadata
          is retained with this media item.
        </Hint>
      )}
      <PropertyRow label="Sound gain (dB)" htmlFor={`sound-gain-${transition.id}`}>
        <Input
          id={`sound-gain-${transition.id}`}
          type="number"
          value={gainDB}
          disabled={disabled}
          onChange={(e) => setGain(e.target.value)}
        />
      </PropertyRow>
      <PropertyRow label="Start from cut midpoint (s)" htmlFor={`sound-offset-${transition.id}`}>
        <Input
          id={`sound-offset-${transition.id}`}
          type="number"
          value={offset}
          step="any"
          disabled={disabled}
          onChange={(e) => setOffset(e.target.value)}
        />
      </PropertyRow>
      <ActionRow>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            try {
              run({ sound: sound() });
            } catch (cause) {
              setError(String(cause));
            }
          }}
        >
          Apply sound
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || !current}
          onClick={() => run({ soundClipID: null })}
        >
          Detach sound and keep clip
        </Button>
      </ActionRow>
      <PropertyRow label="Existing audio clip" htmlFor={`sound-tie-${transition.id}`}>
        <OptionSelect
          id={`sound-tie-${transition.id}`}
          disabled={disabled}
          value={tie}
          onValueChange={setTie}
        >
          <SelectItem value="">Choose clip</SelectItem>
          {project.audioTracks
            .flatMap((t) => t.clips)
            .map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name ?? c.id}
              </SelectItem>
            ))}
        </OptionSelect>
      </PropertyRow>
      <ActionRow>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || !tie}
          onClick={() => run({ soundClipID: tie })}
        >
          Tie existing clip
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            void writePreference(defaultKey(project.id, type), JSON.stringify(sound()))
              .then(() => {
                setNotice(`Default saved for ${type} in this project.`);
                setError(null);
              })
              .catch((cause) => setError(String(cause)));
          }}
        >
          Remember as {type} default
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            const value = defaultTransitionSound(project, type);
            if (value === undefined && builtIn) {
              setError(
                "The built-in light swoosh is unavailable. Import a local sound and remember it as this type's default.",
              );
              return;
            }
            run({ sound: value ?? null });
          }}
        >
          Use type default
        </Button>
      </ActionRow>
      <Hint>
        {builtIn
          ? "Built-in light swoosh: elevenlabs:sfx_2ybnc2tu, −23.3 dB, offset −0.39 s. Its licensed asset is not bundled. Choose a local source to replace it."
          : "This type is silent by default."}{" "}
        Remembered choices apply to new transitions and type changes. Sound clips remain editable on
        SFX tracks.
      </Hint>
      {notice && <Hint role="status">{notice}</Hint>}
      {error && <FieldError role="alert">{error}</FieldError>}
    </InspectorSection>
  );
}

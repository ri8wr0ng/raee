import { useState } from "react";
import type { MediaItem } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { OptionSelect, SelectItem } from "@sidecut/ui/components/option-select";
import { Checkbox } from "@sidecut/ui/components/checkbox";

export function MediaPlacementForm({ item }: { item: MediaItem }) {
  const { session, snapshot, editor } = useEditorSession();
  const [role, setRole] = useState<string>(item.role),
    [take, setTake] = useState(item.takeID ?? ""),
    [offset, setOffset] = useState(String(item.takeOffset?.seconds ?? 0)),
    [mode, setMode] = useState("place"),
    [includeTake, setIncludeTake] = useState(true),
    [error, setError] = useState<string | null>(null);
  const disabled = snapshot.readOnly || snapshot.busy;
  const unavailable = snapshot.mediaAvailability[item.id]?.state !== "available";
  const run = (label: string, command: unknown) => {
    setError(null);
    try {
      const result = session.apply({
        label,
        expectedRevision: snapshot.revision,
        commands: [command],
      });
      const created = new Set(result.createdIDs);
      const first = [
        ...session.getSnapshot().project.videoTracks,
        ...session.getSnapshot().project.audioTracks,
      ]
        .flatMap((t) => t.clips)
        .find((clip) => created.has(clip.id));
      if (first) editor.getState().select(first.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="editor-source-placement">
      <h4>Role and take placement</h4>
      <form
        className="editor-trim-form"
        onSubmit={(e) => {
          e.preventDefault();
          run("Update source placement metadata", {
            updateMedia: {
              mediaID: item.id,
              patch: {
                role,
                takeID: take.trim() || null,
                takeOffset: take.trim() ? Number(offset) : null,
              },
            },
          });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`role-${item.id}`}>Source role</FieldLabel>
            <OptionSelect
              id={`role-${item.id}`}
              value={role}
              disabled={disabled}
              onValueChange={setRole}
            >
              {[
                "camera",
                "screen",
                "broll",
                "graphic",
                "sticker",
                "music",
                "sfx",
                "image",
                "other",
              ].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </OptionSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={`take-${item.id}`}>Take ID</FieldLabel>
            <Input
              id={`take-${item.id}`}
              value={take}
              disabled={disabled}
              onChange={(e) => setTake(e.target.value)}
            />
            <FieldDescription>
              Use the same ID for files recorded together. Save metadata before placing.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`offset-${item.id}`}>File start in take (s)</FieldLabel>
            <Input
              id={`offset-${item.id}`}
              type="number"
              step="any"
              required
              value={offset}
              disabled={disabled}
              onChange={(e) => setOffset(e.target.value)}
            />
            <FieldDescription>
              Known sync offset. Use Local analysis and preview to measure it by sound.
            </FieldDescription>
          </Field>
          <Button size="xs" type="submit" variant="outline" disabled={disabled}>
            Save source metadata
          </Button>
        </FieldGroup>
      </form>
      <FieldGroup className="editor-trim-form">
        <Field>
          <FieldLabel htmlFor={`mode-${item.id}`}>Placement mode</FieldLabel>
          <OptionSelect
            id={`mode-${item.id}`}
            value={mode}
            disabled={disabled}
            onValueChange={setMode}
          >
            <SelectItem value="place">Place in free space</SelectItem>
            <SelectItem value="insert">Insert time</SelectItem>
            <SelectItem value="overwrite">Overwrite</SelectItem>
          </OptionSelect>
        </Field>
        {item.takeID && (
          <Field orientation="horizontal">
            <FieldLabel htmlFor={`pair-${item.id}`}>Include files from this take</FieldLabel>
            <Checkbox
              id={`pair-${item.id}`}
              checked={includeTake}
              disabled={disabled}
              onCheckedChange={(checked) => setIncludeTake(checked)}
            />
          </Field>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || unavailable}
          onClick={() =>
            run("Place media by role", {
              placeMedia: {
                mediaIDs:
                  includeTake && item.takeID
                    ? snapshot.project.media
                        .filter((m) => m.takeID === item.takeID)
                        .map((m) => m.id)
                    : [item.id],
                at: editor.getState().playhead.seconds,
                mode,
              },
            })
          }
        >
          Place by role at playhead
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || unavailable || !item.takeID}
          onClick={() => run("Place synced source", { placeSynced: { mediaID: item.id } })}
        >
          Place alongside existing take
        </Button>
        <FieldDescription>
          Camera picture and voice link together. An added angle stays disabled until enabled in the
          clip inspector. An external mic replaces the take's voice and keeps camera sound on a
          muted track.
        </FieldDescription>
      </FieldGroup>
      {error && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}

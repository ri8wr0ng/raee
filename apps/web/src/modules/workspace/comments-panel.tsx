import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { RiAddLine, RiCheckLine, RiChat3Line, RiEditLine, RiSearchLine } from "@remixicon/react";
import { Time } from "@raee/contracts/time";
import { markerKind, type Marker } from "@raee/contracts/project";
import { CommentEdits, oneLine } from "@raee/core/markers";
import { Button } from "@raee/ui/components/button";
import { Tip } from "@raee/ui/components/tooltip";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@raee/ui/components/empty";
import { useEditorSession, useEditorView } from "./editor-session";
import { timecode } from "./timeline-model";
import { Textarea } from "@raee/ui/components/textarea";
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control";

type Filter = "all" | "comment" | "todo";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "comment", label: "Comments" },
  { id: "todo", label: "To do" },
];
const KIND_LABEL = { comment: "Comment", todo: "To do" } as const;

/** Every comment and to-do flag in the project, in time order. */
export function CommentsPanel({
  run,
  hideButton,
}: {
  run: (action: () => unknown) => void;
  hideButton?: ReactNode;
}) {
  const { session, snapshot, editor } = useEditorSession();
  const playhead = useEditorView((s) => s.playhead);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const disabled = snapshot.readOnly || snapshot.busy;
  const { project } = snapshot;
  const all = useMemo(
    () =>
      project.markers
        .filter((m) => ["comment", "todo"].includes(markerKind(m)))
        .sort((a, b) => a.time - b.time),
    [project.markers],
  );
  const needle = query.trim().toLowerCase();
  const visible = all.filter(
    (m) =>
      (filter === "all" || markerKind(m) === filter) &&
      (!needle || `${m.name} ${m.note ?? ""}`.toLowerCase().includes(needle)),
  );
  const activeID = visible.findLast((m) => m.time <= playhead.seconds + 1e-6)?.id;
  const filtered = visible.length !== all.length;

  function submit(batch: { label: string; commands: unknown[] } | null) {
    if (batch) run(() => session.apply({ ...batch, expectedRevision: snapshot.revision }));
  }
  function addComment() {
    submit(CommentEdits.add(draft, playhead.seconds));
    setDraft("");
    setComposing(false);
  }
  function saveEdit(marker: Marker) {
    submit(CommentEdits.edit(marker, editDraft));
    setEditing(null);
  }
  function resolve(marker: Marker) {
    submit(
      markerKind(marker) === "comment"
        ? CommentEdits.remove([marker.id], "Resolve comment")
        : { label: "Remove marker", commands: [{ removeMarker: { markerID: marker.id } }] },
    );
  }
  function fieldKeys(
    event: KeyboardEvent<HTMLTextAreaElement>,
    save: () => void,
    cancel: () => void,
  ) {
    if (event.key === "Escape") {
      event.stopPropagation();
      cancel();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  }

  return (
    <section aria-labelledby="comments-title" className="editor-panel editor-side-section">
      <div className="editor-panel-heading">
        <h2 id="comments-title">Comments</h2>
        {all.length > 0 && (
          <span aria-label={`${filtered ? `${visible.length} of ` : ""}${all.length} total`}>
            {filtered ? `${visible.length} / ${all.length}` : all.length}
          </span>
        )}
        <Tip label="Add comment at playhead">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Add comment at playhead"
            disabled={disabled}
            onClick={() => setComposing(true)}
          >
            <RiAddLine aria-hidden="true" />
          </Button>
        </Tip>
        {hideButton}
      </div>
      {composing && (
        <form
          className="editor-side-compose"
          onSubmit={(event) => {
            event.preventDefault();
            addComment();
          }}
        >
          <label className="sr-only" htmlFor="side-comment-draft">
            New comment at {timecode(playhead, project)}
          </label>
          <Textarea
            id="side-comment-draft"
            className="editor-text-area"
            rows={3}
            autoFocus
            placeholder={`Comment at ${timecode(playhead, project)}`}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => fieldKeys(event, addComment, () => setComposing(false))}
          />
          <div className="editor-side-actions">
            <Button type="submit" size="xs" disabled={disabled || !draft.trim()}>
              Add
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {all.length > 0 && (
        <div className="editor-side-tools">
          <label className="editor-side-search">
            <RiSearchLine aria-hidden="true" />
            <input
              type="search"
              aria-label="Search comments"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <SegmentedControl
            className="editor-side-filter"
            aria-label="Show"
            value={filter}
            onValueChange={(next) => {
              if (next) setFilter(next as Filter);
            }}
          >
            {FILTERS.map((item) => (
              <SegmentedControlItem key={item.id} value={item.id}>
                {item.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
      )}
      <div
        className="editor-panel-content editor-side-scroll"
        role="region"
        aria-label="Comment list"
        tabIndex={0}
      >
        {visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiChat3Line aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{all.length ? "No matching comments" : "No comments yet"}</EmptyTitle>
              <EmptyDescription>
                {all.length
                  ? "Try a different search or filter."
                  : "Leave notes at the playhead for the next round of edits."}
              </EmptyDescription>
            </EmptyHeader>
            {!all.length && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => setComposing(true)}
              >
                Add comment at playhead
              </Button>
            )}
          </Empty>
        ) : (
          <ul className="editor-side-list">
            {visible.map((marker) => {
              const kind = markerKind(marker) as keyof typeof KIND_LABEL;
              const at = timecode(Time.fromSeconds(marker.time), project);
              const text = oneLine(marker.name) || KIND_LABEL[kind];
              return (
                <li
                  key={marker.id}
                  className="editor-side-row"
                  data-active={marker.id === activeID}
                  data-kind={kind}
                >
                  {editing === marker.id ? (
                    <div className="editor-side-edit">
                      <label className="sr-only" htmlFor="side-comment-edit">
                        Edit comment at {at}
                      </label>
                      <Textarea
                        id="side-comment-edit"
                        className="editor-text-area"
                        rows={3}
                        autoFocus
                        value={editDraft}
                        disabled={disabled}
                        onChange={(event) => setEditDraft(event.target.value)}
                        onKeyDown={(event) =>
                          fieldKeys(
                            event,
                            () => saveEdit(marker),
                            () => setEditing(null),
                          )
                        }
                      />
                      <div className="editor-side-actions">
                        <Button size="xs" disabled={disabled} onClick={() => saveEdit(marker)}>
                          Save
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="editor-side-main"
                        aria-current={marker.id === activeID ? "true" : undefined}
                        onClick={() => editor.getState().seek(Time.fromSeconds(marker.time))}
                      >
                        <span className="editor-side-meta">
                          <span className="editor-side-time">{at}</span>
                          <span className="editor-side-kind">{KIND_LABEL[kind]}</span>
                          {marker.duration > 0 && <span>Range {marker.duration.toFixed(2)} s</span>}
                        </span>
                        <span className="editor-side-text">{text}</span>
                        {marker.note && <span className="editor-side-note">{marker.note}</span>}
                      </button>
                      <span className="editor-side-row-actions">
                        <Tip label="Edit">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Edit comment at ${at}`}
                            disabled={disabled}
                            onClick={() => {
                              setEditDraft(marker.name);
                              setEditing(marker.id);
                            }}
                          >
                            <RiEditLine aria-hidden="true" />
                          </Button>
                        </Tip>
                        <Tip label="Resolve">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Resolve comment at ${at}`}
                            disabled={disabled}
                            onClick={() => resolve(marker)}
                          >
                            <RiCheckLine aria-hidden="true" />
                          </Button>
                        </Tip>
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

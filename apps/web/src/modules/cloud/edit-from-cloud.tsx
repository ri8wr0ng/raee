import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCloudAuth } from "./cloud-auth";
import { useAction, useConvexAuth } from "convex/react";
import type { GenericId } from "convex/values";
import { api } from "@raee/cloud/api";
import { Button } from "@raee/ui/components/button";
import { Progress } from "@raee/ui/components/progress";
import { AppPage } from "@/modules/shell/app-shell";
import { megabytes } from "@/modules/studio/cloud-upload";
import { addTakeToProject, focusPlacedTake } from "@/modules/studio/place-take";
import { findCloudTake, removeTake, takeFile, type TakeInfo } from "@/modules/studio/take-store";
import { useEditorSession } from "@/modules/workspace/editor-session";
import { currentReturnTo, useCloud } from "./cloud-provider";
import { recordingMetadata } from "./recording-metadata";
import { downloadToFile } from "./add-to-project";

export function EditFromCloud({ mediaId, from }: { mediaId: string; from?: "studio" | undefined }) {
  const { configured } = useCloud();
  return (
    <AppPage
      title="Open from cloud"
      description="Get the original file from your team's library and edit it here."
    >
      {configured ? (
        <Download mediaId={mediaId as GenericId<"media">} from={from} />
      ) : (
        <p>Cloud is not configured for this app. Open files from this device in Edit.</p>
      )}
    </AppPage>
  );
}

// One import per file at a time. The effect below can run again (StrictMode, a token refresh)
// while an import is still writing to the project; this keeps it from adding the file twice.
type ImportResult = Awaited<ReturnType<typeof addTakeToProject>>;
const importing = new Map<string, Promise<ImportResult>>();

type Phase =
  | { name: "waiting" }
  | { name: "downloading"; received: number; total: number; fileName: string }
  | { name: "importing"; fileName: string }
  | { name: "failed"; error: string };

function Download({ mediaId, from }: { mediaId: GenericId<"media">; from?: "studio" | undefined }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useCloudAuth();
  const sourceUrl = useAction(api.storage.sourceUrl);
  const { session, snapshot, editor } = useEditorSession();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ name: "waiting" });
  const [attempt, setAttempt] = useState(0);
  const [confirmed, setConfirmed] = useState(from === "studio");
  const [localResult, setLocalResult] = useState<{ mediaId: string; take: TakeInfo | null }>();
  const local = localResult?.mediaId === mediaId ? localResult.take : undefined;
  const projectLoading = snapshot.saveState === "loading";

  useEffect(() => {
    let active = true;
    void findCloudTake(mediaId)
      .catch(() => undefined)
      .then((take) => {
        if (active) setLocalResult({ mediaId, take: take ?? null });
      });
    return () => {
      active = false;
    };
  }, [mediaId]);

  useEffect(() => {
    if (
      (isLoading && !local) ||
      projectLoading ||
      !confirmed ||
      local === undefined ||
      (!local && !isAuthenticated)
    )
      return;
    const abort = new AbortController();
    void (async () => {
      try {
        setPhase({ name: "waiting" });
        // Another run is already adding this file: wait for it instead of adding it again.
        const running = importing.get(mediaId);
        if (running) {
          setPhase({ name: "importing", fileName: "the file" });
          await running;
          if (!abort.signal.aborted) void navigate({ to: "/", replace: true });
          return;
        }
        // A take recorded on this device is still on disk: open it without downloading.
        if (local) {
          setPhase({ name: "importing", fileName: local.fileName });
          const result = await importOnce(mediaId, async () => {
            const imported = await addTakeToProject(
              session,
              await takeFile(local.fileName),
              local.marks,
            );
            await removeTake(local.fileName);
            return imported;
          });
          focusPlacedTake(session, editor, result);
          if (!abort.signal.aborted) void navigate({ to: "/", replace: true });
          return;
        }
        const source = await sourceUrl({ mediaId });
        const { fileName, type } = recordingMetadata(source.snapshot, source.name);
        const file = await downloadToFile({
          url: source.url,
          name: source.name,
          fileName,
          mimeType: type,
          signal: abort.signal,
          onProgress: ({ loaded, total }) =>
            setPhase({ name: "downloading", received: loaded, total: total ?? 0, fileName }),
        });
        if (abort.signal.aborted) return;
        setPhase({ name: "importing", fileName });
        const result = await importOnce(mediaId, () =>
          addTakeToProject(session, file, source.marks),
        );
        focusPlacedTake(session, editor, result);
        if (!abort.signal.aborted) void navigate({ to: "/", replace: true });
      } catch (cause) {
        if (abort.signal.aborted) return;
        setPhase({
          name: "failed",
          error: cause instanceof Error ? cause.message : "The file could not be opened.",
        });
      }
    })();
    return () => abort.abort();
  }, [
    attempt,
    confirmed,
    editor,
    isAuthenticated,
    isLoading,
    local,
    mediaId,
    navigate,
    projectLoading,
    session,
    sourceUrl,
  ]);

  if (isLoading || projectLoading) return <p role="status">Getting ready…</p>;
  if (!confirmed) {
    const name = snapshot.project.name || "Untitled";
    return (
      <div className="grid justify-items-start gap-3">
        <p>This adds the file to “{name}” and places it at the end of the timeline.</p>
        <div className="flex gap-2">
          <Button onClick={() => setConfirmed(true)}>Add to “{name}”</Button>
          <Button variant="outline" onClick={() => void navigate({ to: "/library" })}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  if (local === undefined) return <p role="status">Finding the file…</p>;
  if (!local && !isAuthenticated)
    return (
      <div className="grid justify-items-start gap-3">
        <p>Sign in to open this file from your team's library.</p>
        <Button onClick={() => void signIn({ returnTo: currentReturnTo() })}>Sign in</Button>
      </div>
    );
  if (phase.name === "failed")
    return (
      <div role="alert" className="grid justify-items-start gap-3">
        <p>{phase.error}</p>
        <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
      </div>
    );
  if (phase.name === "downloading")
    return (
      <div className="grid max-w-md gap-2">
        <p role="status">
          Downloading {phase.fileName} · {megabytes(phase.received)}
          {phase.total ? ` of ${megabytes(phase.total)}` : ""}
        </p>
        {phase.total > 0 && <Progress value={(phase.received / phase.total) * 100} />}
      </div>
    );
  if (phase.name === "importing")
    return <p role="status">Adding {phase.fileName} to the project…</p>;
  return <p role="status">Finding the file…</p>;
}

function importOnce(mediaId: string, run: () => Promise<ImportResult>): Promise<ImportResult> {
  const existing = importing.get(mediaId);
  if (existing) return existing;
  const task = run().finally(() => importing.delete(mediaId));
  importing.set(mediaId, task);
  return task;
}

import { useEffect, useRef, useState } from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useNavigate } from "@tanstack/react-router";
import { RiUploadCloud2Line } from "@remixicon/react";
import { api } from "@raee/cloud/api";
import { Button } from "@raee/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@raee/ui/components/dialog";
import { Progress } from "@raee/ui/components/progress";
import { useEditorSession } from "../workspace/editor-session";
import {
  openCloudProject,
  readProjectLink,
  saveProjectToCloud,
  writeProjectLink,
  type CloudProjectRecord,
  type SaveProgress,
} from "./cloud-project";
import { isAbortError } from "./add-to-project";
import { cloudErrorMessage } from "./subscription-error";
import type { UploadClient } from "./upload";

type TeamId = FunctionArgs<typeof api.projects.list>["teamId"];
type ProjectId = FunctionArgs<typeof api.projects.get>["projectId"];
type ProjectRow = FunctionReturnType<typeof api.projects.list>[number];
type BeginArgs = FunctionArgs<typeof api.versions.beginUpload>;
type VersionId = FunctionArgs<typeof api.storage.start>["versionId"];
type MediaId = NonNullable<BeginArgs["mediaId"]>;

type Work =
  | { kind: "saving"; progress: SaveProgress | null }
  | { kind: "opening"; name: string; progress: SaveProgress | null };

type Notice =
  | { kind: "saved"; name: string; uploaded: number; reused: number }
  | { kind: "error"; message: string; conflict?: boolean };

type Confirm = { kind: "open" | "remove"; project: ProjectRow };

export function size(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Saves the editor's project with its files to the team, and opens saved projects again. */
export function CloudProjects({ teamId, readOnly }: { teamId: TeamId; readOnly: boolean }) {
  const projects = useQuery(api.projects.list, { teamId });
  const convex = useConvex();
  const save = useMutation(api.projects.save);
  const archive = useMutation(api.projects.archive);
  const originalUrl = useAction(api.storage.originalUrl);
  const beginUpload = useMutation(api.versions.beginUpload);
  const start = useAction(api.storage.start);
  const uploadedParts = useAction(api.storage.uploadedParts);
  const partUrl = useAction(api.storage.partUrl);
  const complete = useAction(api.storage.complete);
  const abortUpload = useAction(api.storage.abort);
  const { session, snapshot } = useEditorSession();
  const navigate = useNavigate();
  const [work, setWork] = useState<Work | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page stops a save or download in progress.
  useEffect(() => () => controller.current?.abort(), []);

  const client: UploadClient = {
    beginUpload: ({ mediaId, folderId: _folder, ...args }) =>
      beginUpload({
        ...args,
        teamId: args.teamId as TeamId,
        ...(mediaId ? { mediaId: mediaId as MediaId } : {}),
      }),
    start: (args) => start({ versionId: args.versionId as VersionId }),
    uploadedParts: (args) => uploadedParts({ versionId: args.versionId as VersionId }),
    partUrl: (args) => partUrl({ versionId: args.versionId as VersionId, part: args.part }),
    complete: (args) => complete({ versionId: args.versionId as VersionId }),
    abort: (args) => abortUpload({ versionId: args.versionId as VersionId }),
  };

  const localID = snapshot.project.id;
  const link = readProjectLink(localID);
  const linked = link?.teamId === teamId ? link : null;
  const linkedRow = linked && projects?.find((project) => project._id === linked.projectId);

  function blockReason(): string | undefined {
    if (readOnly) return "Viewers can open projects but can't save them.";
    if (snapshot.readOnly)
      return "This project is read-only here. Enable editing after the other tab closes.";
    if (snapshot.saveState === "loading") return "Wait for the project to finish loading.";
    if (snapshot.busy) return "Wait for the current file operation to finish.";
    if (work) return work.kind === "saving" ? undefined : "Wait for the download to finish.";
    return undefined;
  }

  async function record(projectId: string): Promise<CloudProjectRecord | null> {
    try {
      const found = await convex.query(api.projects.get, { projectId: projectId as ProjectId });
      return found.archived ? null : (found as unknown as CloudProjectRecord);
    } catch {
      return null;
    }
  }

  async function runSave(asNew: boolean) {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setNotice(null);
    setWork({ kind: "saving", progress: null });
    try {
      const project = await session.cloudProject();
      const found = !asNew && linked ? await record(linked.projectId) : null;
      // Checked again by the server; refusing here avoids uploading files for a save that fails.
      if (found && linked?.revision !== undefined && found.revision !== linked.revision)
        throw new Error("This project was saved from another device since you opened it.");
      // The revision this device last saved or opened, so a newer save elsewhere isn't overwritten.
      const existing = found && { ...found, revision: linked?.revision ?? found.revision };
      const result = await saveProjectToCloud({
        project,
        teamId,
        existing,
        client,
        save: ({ projectId, ...args }) =>
          save({
            ...args,
            teamId,
            ...(projectId ? { projectId: projectId as ProjectId } : {}),
            document: {
              mediaId: args.document.mediaId as MediaId,
              versionId: args.document.versionId as VersionId,
            },
            resources: args.resources.map((resource) => ({
              ...resource,
              mediaId: resource.mediaId as MediaId,
              versionId: resource.versionId as VersionId,
            })),
          }),
        onProgress: (progress) => setWork({ kind: "saving", progress }),
        signal: abort.signal,
      });
      writeProjectLink(project.projectID, {
        projectId: result.projectId,
        teamId,
        revision: result.revision,
      });
      setNotice({
        kind: "saved",
        name: project.name,
        uploaded: result.uploaded,
        reused: result.reused,
      });
    } catch (cause) {
      if (abort.signal.aborted || isAbortError(cause))
        setNotice({ kind: "error", message: "Saving was cancelled. Nothing was changed." });
      else {
        const message = cloudErrorMessage(cause, "The project could not be saved. Try again.");
        setNotice({ kind: "error", message, conflict: /another device/.test(message) });
      }
    } finally {
      controller.current = null;
      setWork(null);
    }
  }

  async function runOpen(row: ProjectRow) {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setNotice(null);
    setWork({ kind: "opening", name: row.name, progress: null });
    try {
      const found = await record(row._id);
      if (!found) throw new Error("This project was removed from the cloud.");
      const opened = await openCloudProject({
        record: found,
        resolve: ({ mediaId, versionId }) =>
          originalUrl({ mediaId: mediaId as MediaId, versionId: versionId as VersionId }),
        onProgress: (progress) => setWork({ kind: "opening", name: row.name, progress }),
        signal: abort.signal,
      });
      abort.signal.throwIfAborted();
      const localProjectID = await session.openCloudProject(opened.json, opened.resources);
      writeProjectLink(localProjectID, { projectId: found._id, teamId, revision: found.revision });
      void navigate({ to: "/" });
    } catch (cause) {
      if (abort.signal.aborted || isAbortError(cause))
        setNotice({ kind: "error", message: "Opening was cancelled." });
      else
        setNotice({
          kind: "error",
          message: cloudErrorMessage(cause, "The project could not be opened. Try again."),
        });
    } finally {
      controller.current = null;
      setWork(null);
    }
  }

  async function runRemove(row: ProjectRow) {
    setNotice(null);
    try {
      await archive({ projectId: row._id });
    } catch (cause) {
      setNotice({
        kind: "error",
        message: cloudErrorMessage(cause, "The project could not be removed. Try again."),
      });
    }
  }

  const blocked = blockReason();
  const progress = work?.progress;
  const percent = progress?.total ? (progress.loaded / progress.total) * 100 : 0;
  const projectName = snapshot.project.name || "Untitled";

  return (
    <section className="cloud-projects grid gap-3" aria-labelledby="cloud-projects-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cloud-projects-title" className="text-base font-semibold">
          Projects
        </h2>
        {!readOnly && (
          <Button
            size="sm"
            disabled={Boolean(blocked) || Boolean(work)}
            aria-describedby={blocked ? "cloud-projects-blocked" : undefined}
            onClick={() => void runSave(false)}
          >
            <RiUploadCloud2Line data-icon="inline-start" aria-hidden="true" />
            {linkedRow ? "Save changes" : "Save to cloud"}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {linkedRow
          ? `Saving updates “${linkedRow.name}” with the project open in the editor.`
          : `Saves “${projectName}” from the editor with its media, so the team can open it on any device.`}
      </p>
      {blocked && !readOnly && (
        <p id="cloud-projects-blocked" className="text-xs text-muted-foreground">
          {blocked}
        </p>
      )}

      {work && (
        <div className="grid max-w-md gap-2" role="status">
          <p className="text-sm">
            {work.kind === "saving" ? "Saving" : `Opening “${work.name}”`}
            {progress
              ? ` · ${size(progress.loaded)} of ${size(progress.total)}`
              : work.kind === "saving"
                ? " · getting files ready…"
                : " · finding files…"}
          </p>
          {progress && progress.total > 0 && <Progress value={percent} />}
          <p className="text-xs text-muted-foreground">
            Keep this page open until it finishes. Files already in the cloud aren't sent again.
          </p>
          <div>
            <Button size="sm" variant="outline" onClick={() => controller.current?.abort()}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {notice?.kind === "saved" && (
        <p role="status" className="text-sm">
          Saved “{notice.name}”.{" "}
          {notice.uploaded === 0
            ? "All files were already in the cloud."
            : `${notice.uploaded} ${notice.uploaded === 1 ? "file" : "files"} uploaded${
                notice.reused ? `, ${notice.reused} already there` : ""
              }.`}
        </p>
      )}
      {notice?.kind === "error" && (
        <div role="alert" className="grid justify-items-start gap-2 text-sm">
          <p className="text-destructive">{notice.message}</p>
          {notice.conflict && (
            <Button size="sm" variant="outline" onClick={() => void runSave(true)}>
              Save as a new project
            </Button>
          )}
        </div>
      )}

      {projects === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading projects…
        </p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects saved to this team yet.</p>
      ) : (
        <ul className="cloud-project-list grid gap-2">
          {projects.map((project) => (
            <li
              key={project._id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="grid min-w-0 gap-0.5">
                <p className="truncate font-medium">
                  {project.name}
                  {linkedRow?._id === project._id && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      In the editor
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Saved {when.format(project.updatedAt)} by {project.updatedByName} ·{" "}
                  {project.files} {project.files === 1 ? "file" : "files"} · {size(project.bytes)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(work) || snapshot.busy || snapshot.readOnly}
                  onClick={() => setConfirm({ kind: "open", project })}
                >
                  Open
                </Button>
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(work)}
                    onClick={() => setConfirm({ kind: "remove", project })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {confirm.kind === "open"
                    ? `Open “${confirm.project.name}”?`
                    : `Remove “${confirm.project.name}”?`}
                </DialogTitle>
                <DialogDescription>
                  {confirm.kind === "open"
                    ? `It downloads ${size(confirm.project.bytes)} and replaces “${projectName}” in the editor. Save that project first if you want to keep its latest changes.`
                    : "The team won't see it in Projects anymore. Footage it uses stays in the library."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  variant={confirm.kind === "remove" ? "destructive" : "default"}
                  onClick={() => {
                    const { kind, project } = confirm;
                    setConfirm(null);
                    void (kind === "open" ? runOpen(project) : runRemove(project));
                  }}
                >
                  {confirm.kind === "open" ? "Open project" : "Remove"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

import { useState, type ReactNode } from "react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "@raee/cloud/api";
import { Button } from "@raee/ui/components/button";
import { Checkbox } from "@raee/ui/components/checkbox";
import { Input } from "@raee/ui/components/input";
import { OptionSelect } from "@raee/ui/components/option-select";
import { isSubscriptionRequired, subscriptionRequiredMessage } from "./subscription-error";

export type LibraryFilter = Omit<FunctionArgs<typeof api.library.list>, "teamId">;
type Bulk = Omit<FunctionArgs<typeof api.library.bulk>, "teamId">;
type Items = FunctionReturnType<typeof api.library.list>;
type Folders = FunctionReturnType<typeof api.library.folders>;

export type LibraryBrowserProps = {
  items: Items | undefined;
  folders: Folders | undefined;
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
  readOnly: boolean;
  createFolder: (name: string) => Promise<unknown>;
  bulk: (operation: Bulk) => Promise<unknown>;
  /** Opens a file in the editor; omitted where there is no editor to open it in. */
  onEdit?: (mediaId: Items[number]["_id"]) => void;
  pagination?: {
    status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
    loadMore: () => void;
  };
  renderItemAction?: (item: Items[number]) => ReactNode;
};

export function LibraryBrowser({
  items,
  folders,
  filter,
  onFilter,
  readOnly,
  createFolder,
  bulk,
  onEdit,
  pagination,
  renderItemAction,
}: LibraryBrowserProps) {
  const [selected, setSelected] = useState(new Set<Items[number]["_id"]>());
  const [destination, setDestination] = useState<Folders[number]["_id"] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const visibleSelected =
    items?.filter((item) => selected.has(item._id)).map((item) => item._id) ?? [];
  const changeFilter = (next: LibraryFilter) => {
    setSelected(new Set());
    setError("");
    setMessage("");
    onFilter(next);
  };
  async function run(action: () => Promise<unknown>, success: string) {
    if (busy || readOnly) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setSelected(new Set());
      setMessage(success);
    } catch (cause) {
      setError(
        isSubscriptionRequired(cause)
          ? subscriptionRequiredMessage
          : "The library update failed. Your selection was kept. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="cloud-library-heading" className="grid gap-4 border-t pt-4">
      <div className="space-y-1">
        <h3 id="cloud-library-heading" className="font-medium">
          Cloud library
        </h3>
        <p className="text-sm text-muted-foreground">
          Manage files shared with this team. Local projects stay on this device.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Search library
          <Input
            type="search"
            value={filter.search ?? ""}
            maxLength={200}
            disabled={busy}
            onChange={(event) => changeFilter({ ...filter, search: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Library folder
          <OptionSelect
            className="h-9"
            value={filter.folderId ?? ""}
            disabled={busy || !folders}
            options={[
              { value: "", label: "All folders" },
              ...(folders ?? []).map((folder) => ({ value: folder._id, label: folder.name })),
            ]}
            onValueChange={(value) => {
              const next = { ...filter };
              const folder = folders?.find((candidate) => candidate._id === value);
              if (folder) next.folderId = folder._id;
              else delete next.folderId;
              changeFilter(next);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Library order
          <OptionSelect
            className="h-9"
            value={filter.search?.trim() ? "relevance" : filter.sort}
            disabled={busy || Boolean(filter.search?.trim())}
            options={[
              ...(filter.search?.trim()
                ? [{ value: "relevance" as const, label: "Search relevance" }]
                : []),
              { value: "newest" as const, label: "Newest first" },
              { value: "name" as const, label: "Name" },
            ]}
            onValueChange={(value) =>
              changeFilter({ ...filter, sort: value === "name" ? "name" : "newest" })
            }
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={filter.archived ?? false}
            disabled={busy}
            onCheckedChange={(archived) => changeFilter({ ...filter, archived })}
          />
          Show archived files
        </label>
      </div>
      {readOnly && (
        <p className="text-sm text-muted-foreground">
          You have viewing access. Ask a team editor to organize files.
        </p>
      )}
      {!readOnly && (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget,
              name = new FormData(form).get("folderName");
            if (typeof name === "string" && name.trim())
              void run(async () => {
                await createFolder(name);
                form.reset();
              }, "Folder created.");
          }}
        >
          <label className="grid min-w-0 flex-1 gap-1 text-sm">
            New library folder
            <Input name="folderName" required maxLength={200} disabled={busy} />
          </label>
          <Button type="submit" variant="outline" disabled={busy}>
            Create folder
          </Button>
        </form>
      )}
      {!items || !folders ? (
        <p role="status">Loading library…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter.search
            ? "No files match this search."
            : filter.archived
              ? "No archived files in this view."
              : "No cloud files in this view yet."}
        </p>
      ) : (
        <ul className="grid max-h-72 gap-2 overflow-y-auto" aria-label="Cloud files">
          {items.map((item) => (
            <li key={item._id} className="flex min-w-0 items-start gap-2 rounded-md border p-3">
              {!readOnly && (
                <Checkbox
                  aria-label={`Select ${item.name}`}
                  className="mt-1"
                  checked={selected.has(item._id)}
                  disabled={busy || (!selected.has(item._id) && visibleSelected.length >= 100)}
                  onCheckedChange={(checked) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(item._id);
                      else next.delete(item._id);
                      return next;
                    })
                  }
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {folders.find((folder) => folder._id === item.folderId)?.name ?? "No folder"}
                  {item.archived ? " · Archived" : ""}
                </p>
              </div>
              {renderItemAction?.(item)}
              {onEdit && !item.archived && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Open ${item.name} in the editor`}
                  onClick={() => onEdit(item._id)}
                >
                  Open in editor
                </Button>
              )}
              {onEdit && item.archived && !readOnly && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={`Restore ${item.name} and open it in the editor`}
                  onClick={() =>
                    void run(async () => {
                      await bulk({ mediaIds: [item._id], operation: "restore" });
                      onEdit(item._id);
                    }, "File restored.")
                  }
                >
                  Restore and edit
                </Button>
              )}
              {onEdit && item.archived && readOnly && (
                <span className="text-xs text-muted-foreground">Ask an editor to restore it</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {pagination && pagination.status !== "Exhausted" && (
        <Button
          variant="outline"
          disabled={busy || pagination.status !== "CanLoadMore"}
          onClick={pagination.loadMore}
        >
          {pagination.status === "CanLoadMore" ? "Load more files" : "Loading files…"}
        </Button>
      )}
      {!readOnly && (
        <div className="grid gap-2">
          <p className="text-sm" role="status">
            {visibleSelected.length} selected
            {visibleSelected.length === 100 ? " (selection limit reached)" : ""}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-0 gap-1 text-sm">
              Move selected to
              <OptionSelect
                className="h-9 max-w-full"
                value={destination ?? ""}
                disabled={busy || !visibleSelected.length}
                options={[
                  { value: "", label: "No folder" },
                  ...(folders ?? []).map((folder) => ({ value: folder._id, label: folder.name })),
                ]}
                onValueChange={(value) =>
                  setDestination(folders?.find((folder) => folder._id === value)?._id)
                }
              />
            </label>
            <Button
              variant="outline"
              disabled={busy || !visibleSelected.length}
              onClick={() =>
                void run(
                  () =>
                    bulk({
                      mediaIds: visibleSelected,
                      operation: "move",
                      ...(destination ? { folderId: destination } : {}),
                    }),
                  "Files moved.",
                )
              }
            >
              Move selected
            </Button>
            <Button
              variant="outline"
              disabled={busy || !visibleSelected.length}
              onClick={() =>
                void run(
                  () =>
                    bulk({
                      mediaIds: visibleSelected,
                      operation: filter.archived ? "restore" : "archive",
                    }),
                  filter.archived ? "Files restored." : "Files archived.",
                )
              }
            >
              {filter.archived ? "Restore selected" : "Archive selected"}
            </Button>
          </div>
        </div>
      )}
      {busy && <p role="status">Updating library…</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

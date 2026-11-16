import { useCallback, useRef, useState } from "react";
import type { CaptureSource } from "@sidecut/contracts/desktop";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@sidecut/ui/components/dialog";
import { nativeBridge } from "@/modules/workspace/host-coordinator";

/** The desktop app can capture system sound on Windows only. */
const systemAudio = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

type Listing =
  | { status: "loading" }
  | { status: "ready"; sources: CaptureSource[] }
  | { status: "failed"; message: string };

/**
 * The desktop app lists screens and windows with previews; the browser keeps its own picker.
 * `pick` resolves to the chosen source id, or null when the person closes the picker.
 */
export function useScreenPicker() {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const resolver = useRef<((id: string | null) => void) | null>(null);

  const finish = useCallback((id: string | null) => {
    resolver.current?.(id);
    resolver.current = null;
    setOpen(false);
  }, []);

  const pick = useCallback(() => {
    const list = nativeBridge()?.captureSources;
    if (!list) return Promise.resolve(undefined);
    resolver.current?.(null);
    setListing({ status: "loading" });
    setOpen(true);
    void list().then(
      (sources) => setListing({ status: "ready", sources }),
      (cause: unknown) =>
        setListing({
          status: "failed",
          message: cause instanceof Error ? cause.message : "Screens could not be listed.",
        }),
    );
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const screens =
    listing.status === "ready" ? listing.sources.filter((s) => s.kind === "screen") : [];
  const windows =
    listing.status === "ready" ? listing.sources.filter((s) => s.kind === "window") : [];
  const group = (title: string, items: CaptureSource[]) =>
    items.length > 0 && (
      <section className="studio-picker-group" aria-label={title}>
        <h3>{title}</h3>
        <div className="studio-picker-grid">
          {items.map((source) => (
            <button
              key={source.id}
              type="button"
              className="studio-picker-item"
              onClick={() => finish(source.id)}
            >
              <img src={source.thumbnail} alt="" />
              <span title={source.name}>{source.name}</span>
            </button>
          ))}
        </div>
      </section>
    );

  const dialog = (
    <Dialog open={open} onOpenChange={(value) => !value && finish(null)}>
      <DialogContent className="dark studio-picker">
        <DialogHeader>
          <DialogTitle>Choose what to share</DialogTitle>
          <DialogDescription>
            {systemAudio
              ? "Pick a screen or window. System sound comes along."
              : "Pick a screen or window. System sound is not included."}
          </DialogDescription>
        </DialogHeader>
        {listing.status === "loading" && <p className="studio-picker-note">Looking for screens…</p>}
        {listing.status === "failed" && (
          <p className="studio-picker-note" role="alert">
            {listing.message}
          </p>
        )}
        {listing.status === "ready" && listing.sources.length === 0 && (
          <p className="studio-picker-note">No screens or windows are available.</p>
        )}
        <div className="studio-picker-body">
          {group("Screens", screens)}
          {group("Windows", windows)}
        </div>
      </DialogContent>
    </Dialog>
  );

  return { pick, dialog };
}

import type { NativeBridge } from "@sidecut/contracts/desktop";
import { nativeBridge } from "../workspace/host-coordinator";

type Host = Pick<NativeBridge, "capturePrepare" | "captureRelease">;
type Source = "screen" | "camera" | "microphone";

let queue: Promise<unknown> = Promise.resolve();

/**
 * Tells the desktop app which device is about to open (and which screen was picked) before
 * opening it, so it can point at blocked system settings. One open at a time.
 */
export function withCaptureGrant<T>(
  source: Source,
  open: () => Promise<T>,
  { host = nativeBridge(), display }: { host?: Host | undefined; display?: string } = {},
): Promise<T> {
  const prepare = host?.capturePrepare;
  if (!prepare) return open();
  const run = async () => {
    const id = crypto.randomUUID();
    await prepare(id, { source, microphone: false, ...(display ? { display } : {}) });
    try {
      return await open();
    } finally {
      void host.captureRelease?.(id).catch(() => {});
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

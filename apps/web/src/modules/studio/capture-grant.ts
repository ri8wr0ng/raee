import type { NativeBridge } from "@sidecut/contracts/desktop";
import { nativeBridge } from "../workspace/host-coordinator";

type Host = Pick<NativeBridge, "capturePrepare" | "captureRelease">;
type Source = "screen" | "camera" | "microphone";

let queue: Promise<unknown> = Promise.resolve();

/**
 * The desktop app only lets a page open a device inside an approved, one-request grant.
 * Grants are one at a time, so concurrent opens wait their turn.
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

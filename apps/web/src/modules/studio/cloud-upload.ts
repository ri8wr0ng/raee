/** R2 needs every part but the last to be the same size and at least 5 MiB. */
export const PART_BYTES = 8 * 1024 * 1024;
/** Tries per part. Backoff grows to 15 s, so a part keeps trying for about two and a half minutes. */
const ATTEMPTS = 14;
const MAX_WAIT_MS = 15_000;
/** A request that hangs (for example while Convex waits to reconnect) counts as a failed try. */
const REQUEST_TIMEOUT_MS = 120_000;
/** After recording stops, the cloud copy gets this long to finish before the take stays local. */
export const FINISH_DEADLINE_MS = 3 * 60_000;
/** Recorded bytes waiting to upload. Past this the take stays on the device only. */
export const MAX_BACKLOG_BYTES = 256 * 1024 * 1024;

export type UploadProgress = { sentBytes: number; recordedBytes: number; parts: number };

export type CloudUploadTarget = {
  /** Signs a fresh URL for one part; signatures expire quickly, so each attempt asks again. */
  partUrl: (part: number) => Promise<string>;
  /** Sends one part. Rejects on network or HTTP failure. */
  put: (url: string, body: Blob) => Promise<void>;
  /** Fixes the final size, then asks storage to assemble the object. */
  finish: (expectedBytes: number, partCount: number) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
  /** Resolves when the network looks usable again. Defaults to the browser's online event. */
  online?: () => Promise<void>;
  /** Overrides FINISH_DEADLINE_MS, for tests. */
  finishDeadline?: number;
};

function within<T>(
  promise: Promise<T>,
  ms = REQUEST_TIMEOUT_MS,
  message = "The cloud stopped responding.",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function browserOnline(): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) =>
    window.addEventListener("online", () => resolve(), { once: true }),
  );
}

/**
 * Uploads a recording while it is still being recorded. Chunks are buffered until a full part is
 * available, then sent in order. A dropped connection pauses the upload instead of ending it; if
 * the backlog grows past MAX_BACKLOG_BYTES the cloud copy is given up and the take stays on the
 * device, so memory stays bounded however long the take runs.
 */
export class RecordingUpload {
  #pending: Blob[] = [];
  #pendingBytes = 0;
  #recordedBytes = 0;
  #sentBytes = 0;
  #parts = 0;
  #queuedBytes = 0;
  #queue: Promise<void> = Promise.resolve();
  #failure: unknown = null;
  #closed = false;
  readonly #target: CloudUploadTarget;
  readonly #onProgress: (progress: UploadProgress) => void;

  constructor(
    target: CloudUploadTarget,
    onProgress: (progress: UploadProgress) => void = () => {},
  ) {
    this.#target = target;
    this.#onProgress = onProgress;
  }

  get failed() {
    return this.#failure !== null;
  }

  push(chunk: Blob) {
    if (this.#closed) throw new Error("The upload is already finished.");
    if (!chunk.size) return;
    this.#recordedBytes += chunk.size;
    // A failed upload stops buffering; the disk copy keeps the take.
    if (this.#failure) return this.#report();
    if (this.#queuedBytes + this.#pendingBytes + chunk.size > MAX_BACKLOG_BYTES) {
      this.#failure = new Error(
        "The cloud upload fell too far behind, so the take is kept on this device only.",
      );
      this.#pending = [];
      this.#pendingBytes = 0;
      return this.#report();
    }
    this.#pending.push(chunk);
    this.#pendingBytes += chunk.size;
    while (this.#pendingBytes >= PART_BYTES) this.#send(this.#take(PART_BYTES));
    this.#report();
  }

  /** Sends the remainder as the last part and completes the object. */
  async finish() {
    if (this.#closed) throw new Error("The upload is already finished.");
    this.#closed = true;
    // An upload that already gave up must not keep the take waiting on parts still in flight.
    if (this.#failure) throw this.#failure;
    if (this.#pendingBytes) this.#send(this.#take(this.#pendingBytes));
    try {
      await within(
        (async () => {
          await this.#queue;
          if (this.#failure) throw this.#failure;
          if (!this.#parts) throw new Error("The recording is empty.");
          await within(this.#target.finish(this.#recordedBytes, this.#parts));
        })(),
        this.#target.finishDeadline ?? FINISH_DEADLINE_MS,
        "The cloud upload didn't finish in time.",
      );
    } catch (error) {
      // Parts still retrying stop at their next check.
      this.#failure ??= error;
      throw error;
    }
  }

  #take(bytes: number) {
    const whole = new Blob(this.#pending);
    const part = whole.slice(0, bytes);
    const rest = whole.slice(bytes);
    this.#pending = rest.size ? [rest] : [];
    this.#pendingBytes = rest.size;
    return part;
  }

  #send(body: Blob) {
    const part = ++this.#parts;
    this.#queuedBytes += body.size;
    this.#queue = this.#queue.then(async () => {
      try {
        if (this.#failure) return;
        await this.#attempt(part, body);
        this.#sentBytes += body.size;
        this.#report();
      } catch (error) {
        this.#failure ??= error;
        this.#report();
      } finally {
        this.#queuedBytes -= body.size;
      }
    });
  }

  async #attempt(part: number, body: Blob) {
    const wait = this.#target.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    const online = this.#target.online ?? browserOnline;
    for (let attempt = 1; ; attempt++) {
      try {
        // Bounded, so a network that never returns still ends in a failure and the disk copy closes.
        await Promise.race([online(), wait(MAX_WAIT_MS)]);
        if (this.#failure) throw this.#failure;
        const url = await within(this.#target.partUrl(part));
        if (this.#failure) throw this.#failure;
        await within(this.#target.put(url, body));
        return;
      } catch (error) {
        if (attempt >= ATTEMPTS || this.#failure) throw error;
        await wait(Math.min(MAX_WAIT_MS, 500 * 2 ** (attempt - 1)));
      }
    }
  }

  #report() {
    this.#onProgress({
      sentBytes: this.#sentBytes,
      recordedBytes: this.#recordedBytes,
      parts: this.#parts,
    });
  }
}

export async function putPart(url: string, body: Blob) {
  const response = await fetch(url, { method: "PUT", body });
  if (!response.ok) throw new Error(`Cloud storage rejected a part (${response.status}).`);
}

export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

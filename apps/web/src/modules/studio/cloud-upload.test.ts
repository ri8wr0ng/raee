import { describe, expect, it } from "vite-plus/test";
import {
  MAX_BACKLOG_BYTES,
  PART_BYTES,
  RecordingUpload,
  type CloudUploadTarget,
} from "./cloud-upload";

function target(failures = new Map<number, number>()) {
  const sent: { part: number; size: number }[] = [];
  const finished: [number, number][] = [];
  const value: CloudUploadTarget = {
    partUrl: async (part) => `part:${part}`,
    put: async (url, body) => {
      const part = Number(url.split(":")[1]);
      const left = failures.get(part) ?? 0;
      if (left) {
        failures.set(part, left - 1);
        throw new Error("offline");
      }
      sent.push({ part, size: body.size });
    },
    finish: async (bytes, parts) => {
      finished.push([bytes, parts]);
    },
    wait: async () => {},
  };
  return { value, sent, finished };
}
const chunk = (bytes: number) => new Blob([new Uint8Array(bytes)]);

describe("recording upload", () => {
  it("sends equal full parts while recording and the remainder last", async () => {
    const { value, sent, finished } = target();
    const upload = new RecordingUpload(value);
    upload.push(chunk(PART_BYTES - 10));
    upload.push(chunk(20));
    upload.push(chunk(PART_BYTES));
    await upload.finish();
    expect(sent).toEqual([
      { part: 1, size: PART_BYTES },
      { part: 2, size: PART_BYTES },
      { part: 3, size: 10 },
    ]);
    expect(finished).toEqual([[PART_BYTES * 2 + 10, 3]]);
  });

  it("retries a failed part with a fresh URL before giving up", async () => {
    const { value, sent } = target(new Map([[1, 2]]));
    const upload = new RecordingUpload(value);
    upload.push(chunk(5));
    await upload.finish();
    expect(sent).toEqual([{ part: 1, size: 5 }]);
  });

  it("reports a part that keeps failing and never completes the object", async () => {
    const { value, finished } = target(new Map([[1, 100]]));
    const upload = new RecordingUpload(value);
    upload.push(chunk(5));
    await expect(upload.finish()).rejects.toThrow("offline");
    expect(upload.failed).toBe(true);
    expect(finished).toEqual([]);
  });

  it("keeps trying through a long outage instead of dropping the cloud copy", async () => {
    const { value, sent } = target(new Map([[1, 10]]));
    const upload = new RecordingUpload(value);
    upload.push(chunk(5));
    await upload.finish();
    expect(sent).toEqual([{ part: 1, size: 5 }]);
  });

  it("waits for the network before each attempt", async () => {
    const { value, sent } = target();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const upload = new RecordingUpload({
      ...value,
      online: () => gate,
      wait: () => new Promise(() => {}),
    });
    upload.push(chunk(5));
    const done = upload.finish();
    await Promise.resolve();
    expect(sent).toEqual([]);
    release();
    await done;
    expect(sent).toEqual([{ part: 1, size: 5 }]);
  });

  it("gives up the cloud copy when the backlog grows too large, without buffering more", async () => {
    const { value } = target();
    const upload = new RecordingUpload({ ...value, online: () => new Promise(() => {}) });
    upload.push(chunk(MAX_BACKLOG_BYTES));
    expect(upload.failed).toBe(false);
    upload.push(chunk(PART_BYTES));
    expect(upload.failed).toBe(true);
    await expect(upload.finish()).rejects.toThrow("too far behind");
  });

  it("does not hang when the online event never fires", async () => {
    const { value, finished } = target();
    const upload = new RecordingUpload({ ...value, online: () => new Promise(() => {}) });
    upload.push(chunk(5));
    await expect(upload.finish()).resolves.toBeUndefined();
    expect(finished).toEqual([[5, 1]]);
  });

  it("keeps the take local when the cloud can't finish before the deadline", async () => {
    const { value, finished } = target();
    const upload = new RecordingUpload({
      ...value,
      partUrl: () => new Promise(() => {}),
      finishDeadline: 10,
    });
    upload.push(chunk(5));
    await expect(upload.finish()).rejects.toThrow("didn't finish in time");
    expect(upload.failed).toBe(true);
    expect(finished).toEqual([]);
  });

  it("rejects an empty recording and pushes after finishing", async () => {
    const upload = new RecordingUpload(target().value);
    await expect(upload.finish()).rejects.toThrow("empty");
    expect(() => upload.push(chunk(1))).toThrow("finished");
  });
});

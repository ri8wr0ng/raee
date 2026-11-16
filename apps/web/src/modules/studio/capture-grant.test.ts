import { describe, expect, it, vi } from "vite-plus/test";
import { withCaptureGrant } from "./capture-grant";

describe("withCaptureGrant", () => {
  it("opens directly when there is no desktop host", async () => {
    await expect(withCaptureGrant("camera", async () => "stream", undefined)).resolves.toBe(
      "stream",
    );
  });

  it("prepares a grant, opens inside it and releases it after", async () => {
    const calls: string[] = [];
    const host = {
      capturePrepare: vi.fn(async (_id: string, request: { source: string }) => {
        calls.push(`prepare:${request.source}`);
      }),
      captureRelease: vi.fn(async () => {
        calls.push("release");
      }),
    };
    const result = await withCaptureGrant(
      "microphone",
      async () => {
        calls.push("open");
        return "stream";
      },
      host,
    );
    expect(result).toBe("stream");
    expect(calls).toEqual(["prepare:microphone", "open", "release"]);
    expect(host.captureRelease).toHaveBeenCalledWith(host.capturePrepare.mock.calls[0]![0]);
  });

  it("releases the grant when opening fails and does not open when approval is refused", async () => {
    const host = {
      capturePrepare: vi.fn(async () => {}),
      captureRelease: vi.fn(async () => {}),
    };
    await expect(
      withCaptureGrant("camera", () => Promise.reject(new Error("busy")), host),
    ).rejects.toThrow("busy");
    expect(host.captureRelease).toHaveBeenCalledTimes(1);

    const open = vi.fn(async () => "stream");
    host.capturePrepare.mockRejectedValueOnce(new Error("Recording permission cancelled."));
    await expect(withCaptureGrant("camera", open, host)).rejects.toThrow("cancelled");
    expect(open).not.toHaveBeenCalled();
  });

  it("runs one grant at a time", async () => {
    let active = 0;
    let most = 0;
    const host = {
      capturePrepare: vi.fn(async () => {
        active++;
        most = Math.max(most, active);
      }),
      captureRelease: vi.fn(async () => {}),
    };
    const open = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return "stream";
    };
    await Promise.all([
      withCaptureGrant("camera", open, host),
      withCaptureGrant("screen", open, host),
      withCaptureGrant("microphone", open, host),
    ]);
    expect(most).toBe(1);
  });
});

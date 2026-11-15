import { describe, expect, it, vi } from "vite-plus/test";
import { filterCameraDevices, openCamera } from "./camera-devices";

describe("filterCameraDevices", () => {
  it("filters out non-video devices, empty ids, and default ids", () => {
    const devices = [
      { deviceId: "", kind: "videoinput", label: "" },
      { deviceId: "default", kind: "videoinput", label: "Default" },
      { deviceId: "mic-1", kind: "audioinput", label: "Mic" },
      { deviceId: "cam-1", kind: "videoinput", label: "Webcam" },
    ] as MediaDeviceInfo[];

    const result = filterCameraDevices(devices);
    expect(result).toEqual([{ deviceId: "cam-1", label: "Webcam" }]);
  });

  it("deduplicates video devices by deviceId", () => {
    const devices = [
      { deviceId: "cam-1", kind: "videoinput", label: "Webcam 1" },
      { deviceId: "cam-1", kind: "videoinput", label: "Webcam 1 Duplicate" },
      { deviceId: "cam-2", kind: "videoinput", label: "Webcam 2" },
    ] as MediaDeviceInfo[];

    const result = filterCameraDevices(devices);
    expect(result).toEqual([
      { deviceId: "cam-1", label: "Webcam 1" },
      { deviceId: "cam-2", label: "Webcam 2" },
    ]);
  });

  it("uses fallback label Camera (abc123) when label is blank", () => {
    const devices = [
      { deviceId: "0123456789", kind: "videoinput", label: "" },
      { deviceId: "xyz", kind: "videoinput", label: "   " },
    ] as MediaDeviceInfo[];

    const result = filterCameraDevices(devices);
    expect(result).toEqual([
      { deviceId: "0123456789", label: "Camera (012345)" },
      { deviceId: "xyz", label: "Camera (xyz)" },
    ]);
  });
});

describe("openCamera", () => {
  it("requests default video stream when no deviceId is provided", async () => {
    const fakeStream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });

    const stream = await openCamera();
    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledWith({ video: true });
  });

  it("requests exact deviceId when provided", async () => {
    const fakeStream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });

    const stream = await openCamera("cam-123");
    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { exact: "cam-123" } },
    });
  });

  it("throws when getUserMedia is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(openCamera("cam-1")).rejects.toThrow(
      "Camera input is not supported in this environment.",
    );
  });
});

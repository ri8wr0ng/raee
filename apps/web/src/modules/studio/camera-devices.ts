import { useCallback, useEffect, useState } from "react";
import { withCaptureGrant } from "./capture-grant";

export type CameraDeviceInfo = {
  deviceId: string;
  label: string;
};

/**
 * Filters and deduplicates enumerated media devices for valid video inputs,
 * skipping empty or "default" IDs and assigning fallback labels ("Camera (abc123)").
 */
export function filterCameraDevices(devices: MediaDeviceInfo[]): CameraDeviceInfo[] {
  const seen = new Set<string>();
  const inputs: CameraDeviceInfo[] = [];
  for (const device of devices) {
    if (device.kind !== "videoinput") continue;
    const id = device.deviceId;
    if (!id || id === "default" || seen.has(id)) continue;
    seen.add(id);
    const trimmed = device.label.trim();
    const label = trimmed || `Camera (${id.slice(0, 6)})`;
    inputs.push({
      deviceId: id,
      label,
    });
  }
  return inputs;
}

/**
 * Enumerates video input devices, listens to devicechange events,
 * and assigns fallback labels ("Camera (abc123)") for devices without a label.
 * Deduplicates devices and skips empty or "default" IDs.
 */
export function useCameraDevices(): {
  devices: CameraDeviceInfo[];
  refresh: () => Promise<void>;
} {
  const [devices, setDevices] = useState<CameraDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(filterCameraDevices(all));
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) {
      return;
    }
    const onDeviceChange = () => {
      void refresh();
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [refresh]);

  return { devices, refresh };
}

/**
 * Opens a media stream for a video input (camera) device.
 * When deviceId is provided, requests the exact deviceId.
 */
export async function openCamera(deviceId: string | null = null): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera input is not supported in this environment.");
  }
  const videoConstraints: MediaTrackConstraints | boolean = deviceId
    ? { deviceId: { exact: deviceId } }
    : true;
  return withCaptureGrant("camera", () =>
    navigator.mediaDevices.getUserMedia({ video: videoConstraints }),
  );
}

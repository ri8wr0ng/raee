import { useCallback, useEffect, useState } from "react";
import { withCaptureGrant } from "./capture-grant";

export type AudioInputDeviceInfo = {
  deviceId: string;
  label: string;
};

/**
 * Enumerates audio input devices, listens to devicechange events,
 * and assigns fallback labels ("Microphone N") for devices without a label.
 */
export function useAudioInputDevices(): {
  devices: { deviceId: string; label: string }[];
  refresh: () => Promise<void>;
} {
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      let unnamedCount = 0;
      const inputs = all
        .filter((device) => device.kind === "audioinput")
        .map((device) => {
          let label = device.label.trim();
          if (!label) {
            unnamedCount += 1;
            label = `Microphone ${unnamedCount}`;
          }
          return {
            deviceId: device.deviceId,
            label,
          };
        });
      setDevices(inputs);
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
 * Opens a media stream for an audio input device with echo cancellation
 * and noise suppression enabled.
 */
export async function openAudioInput(deviceId: string | null = null): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Audio input is not supported in this environment.");
  }
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
  };
  if (deviceId) {
    audioConstraints.deviceId = { exact: deviceId };
  }
  return withCaptureGrant("microphone", () =>
    navigator.mediaDevices.getUserMedia({ audio: audioConstraints }),
  );
}

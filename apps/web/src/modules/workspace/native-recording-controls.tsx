import { useEffect, useState } from "react";
import { RiRecordCircleLine } from "@remixicon/react";
import type {
  NativeCaptureDevice,
  NativeRecording,
  NativeRecordingRequest,
  NativeStreamStatus,
} from "@sidecut/contracts/native-recording";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { nativeBridge } from "./host-coordinator";
import { MediaSection } from "./media-section";
import { OptionSelect, SelectItem } from "@sidecut/ui/components/option-select";

export function NativeRecordingControls() {
  const { snapshot } = useEditorSession();
  const bridge = nativeBridge();
  const [source, setSource] = useState<NativeRecordingRequest["source"]>("screen");
  const [encoder, setEncoder] = useState<NativeRecordingRequest["encoder"]>("auto");
  const [deviceID, setDeviceID] = useState("");
  const [microphoneID, setMicrophoneID] = useState("");
  const [devices, setDevices] = useState<NativeCaptureDevice[]>([]);
  const [recordings, setRecordings] = useState<NativeRecording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [streamURL, setStreamURL] = useState("");
  const [streamStatus, setStreamStatus] = useState<NativeStreamStatus>({ state: "off" });
  useEffect(() => {
    if (!open || !bridge?.nativeRecordingList || !bridge.nativeRecordingDevices) return;
    let alive = true;
    const refresh = () =>
      void bridge
        .nativeRecordingList?.()
        .then((items) => {
          if (alive) setRecordings(items);
          if (items.some((item) => item.status === "recording" || item.status === "stopping"))
            void bridge
              .nativeRecordingStreamStatus?.()
              .then((status) => {
                if (alive) setStreamStatus(status);
              })
              .catch(() => {
                if (alive) setStreamStatus({ state: "off" });
              });
          else if (alive) setStreamStatus({ state: "off" });
        })
        .catch((cause: unknown) => {
          if (alive)
            setError(cause instanceof Error ? cause.message : "Could not load recordings.");
        });
    void bridge
      .nativeRecordingDevices()
      .then((items) => {
        if (alive) setDevices(items);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not list devices.");
      });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, bridge]);
  if (!bridge?.nativeRecordingStart || !bridge.nativeRecordingStop || !bridge.nativeRecordingRetry)
    return null;
  const active = recordings.find(
    (item) => item.status === "recording" || item.status === "stopping",
  );
  const blocked = snapshot.readOnly || snapshot.busy || snapshot.saveState === "loading" || pending;
  const run = async (action: () => Promise<NativeRecording>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      setRecordings(await bridge.nativeRecordingList!());
      setStreamStatus(
        (await bridge
          .nativeRecordingStreamStatus?.()
          .catch(() => ({ state: "off" }) satisfies NativeStreamStatus)) ?? { state: "off" },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Native recording failed.");
    } finally {
      setPending(false);
    }
  };
  const options = (kind: NativeCaptureDevice["kind"]) =>
    devices
      .filter((device) => device.kind === kind)
      .map((device) => (
        <SelectItem key={device.id} value={device.id}>
          {device.name}
        </SelectItem>
      ));
  return (
    <div
      onToggle={(event) => {
        if (
          event.target === event.currentTarget.firstElementChild &&
          event.target instanceof HTMLDetailsElement
        )
          setOpen(event.target.open);
      }}
    >
      <MediaSection icon={<RiRecordCircleLine aria-hidden="true" />} title="Native recording">
        <FieldGroup className="gap-2">
          <Field>
            <FieldLabel htmlFor="native-source">Source</FieldLabel>
            <OptionSelect
              id="native-source"
              value={source}
              disabled={blocked || !!active}
              onValueChange={(value) => {
                if (value === "screen" || value === "camera" || value === "microphone") {
                  setSource(value);
                  setDeviceID("");
                  setMicrophoneID("");
                }
              }}
            >
              <SelectItem value="screen">Entire desktop</SelectItem>
              <SelectItem value="camera">Camera</SelectItem>
              <SelectItem value="microphone">Microphone</SelectItem>
            </OptionSelect>
            <FieldDescription>
              A recording copy stays on local disk. Screen capture records the entire desktop;
              system audio is excluded.
            </FieldDescription>
          </Field>
          {bridge.nativeRecordingStreamStatus && (
            <Field>
              <FieldLabel htmlFor="native-stream-url">Streaming destination (optional)</FieldLabel>
              <Input
                id="native-stream-url"
                type="password"
                value={streamURL}
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                aria-describedby="native-stream-description"
                disabled={blocked || !!active}
                onChange={(event) => setStreamURL(event.target.value)}
              />
              <FieldDescription id="native-stream-description">
                Paste the full RTMP or RTMPS URL, including the stream key. Leave blank to record
                locally. Streaming sends your capture live and stops with recording. The URL is not
                saved.
              </FieldDescription>
            </Field>
          )}
          {source !== "screen" && (
            <Field>
              <FieldLabel htmlFor="native-device">
                {source === "camera" ? "Camera" : "Microphone"}
              </FieldLabel>
              <OptionSelect
                id="native-device"
                value={deviceID}
                disabled={blocked || !!active}
                onValueChange={setDeviceID}
              >
                <SelectItem value="">Select a device</SelectItem>
                {options(source)}
              </OptionSelect>
            </Field>
          )}
          {source !== "microphone" && (
            <Field>
              <FieldLabel htmlFor="native-mic">Microphone (optional)</FieldLabel>
              <OptionSelect
                id="native-mic"
                value={microphoneID}
                disabled={blocked || !!active}
                onValueChange={setMicrophoneID}
              >
                <SelectItem value="">None</SelectItem>
                {options("microphone")}
              </OptionSelect>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="native-encoder">Encoder profile</FieldLabel>
            <OptionSelect
              id="native-encoder"
              value={encoder}
              disabled={blocked || !!active}
              onValueChange={(value) => {
                if (value === "auto" || value === "software") setEncoder(value);
              }}
            >
              <SelectItem value="auto">Automatic</SelectItem>
              <SelectItem value="software">Software</SelectItem>
            </OptionSelect>
          </Field>
          {error && <p role="alert">{error}</p>}
          {active ? (
            <>
              <p role="status">
                {active.status === "stopping"
                  ? "Finishing recording…"
                  : `Recording · ${Math.floor(active.elapsedSeconds)} seconds`}
              </p>
              {streamStatus.state === "requested" && (
                <p role="status">Stream requested. Delivery is not confirmed.</p>
              )}
              {streamStatus.state === "failed" && (
                <p role="alert">Streaming failed. Local recording continues.</p>
              )}
              <Button
                size="sm"
                disabled={pending || active.status !== "recording"}
                onClick={() => void run(() => bridge.nativeRecordingStop!())}
              >
                {streamStatus.state === "off" ? "Stop recording" : "Stop streaming and recording"}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={blocked || (source !== "screen" && !deviceID)}
              onClick={() =>
                void run(() =>
                  bridge.nativeRecordingStart!({
                    projectID: snapshot.project.id,
                    source,
                    encoder,
                    ...(deviceID && source !== "screen" ? { deviceID } : {}),
                    ...(microphoneID && source !== "microphone" ? { microphoneID } : {}),
                    ...(streamURL.trim() ? { streamURL: streamURL.trim() } : {}),
                  }).then((item) => {
                    setStreamURL("");
                    return item;
                  }),
                )
              }
            >
              {streamURL.trim() ? "Start streaming and recording" : "Start recording"}
            </Button>
          )}
          {recordings
            .filter(
              (item) =>
                item.projectID === snapshot.project.id &&
                item.status !== "recording" &&
                item.status !== "stopping",
            )
            .map((item) => (
              <div key={item.id}>
                <p>
                  {item.source} · {item.status} · {Math.floor(item.elapsedSeconds)} seconds
                  {item.error ? ` · ${item.error}` : ""}
                </p>
                {(item.status === "error" || item.status === "interrupted") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={blocked || !!active}
                    onClick={() => void run(() => bridge.nativeRecordingRetry!(item.id))}
                  >
                    Retry finalization
                  </Button>
                )}
              </div>
            ))}
        </FieldGroup>
      </MediaSection>
    </div>
  );
}

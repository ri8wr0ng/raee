import { useEffect, useState } from "react";
import { RiDownloadLine, RiErrorWarningLine, RiRestartLine } from "@remixicon/react";
import type { UpdateState } from "@sidecut/contracts/desktop";
import { nativeBridge } from "@/modules/workspace/host-coordinator";

/** Shown in the rail only while the desktop app has an update to offer. */
export function UpdateButton() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const bridge = nativeBridge();
    if (!bridge?.updateState || !bridge.updateSubscribe) return;
    let active = true;
    const unsubscribe = bridge.updateSubscribe((next) => {
      setState(next);
      setFailed((current) => (next.status === "error" ? current : false));
    });
    void bridge.updateState().then((next) => active && setState(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const bridge = nativeBridge();
  if (state.status === "error" && failed)
    return (
      <button
        type="button"
        className="app-rail-link app-rail-update"
        title={`Update failed: ${state.message}. Select to try again.`}
        onClick={() => void bridge?.updateCheck?.()}
      >
        <RiErrorWarningLine aria-hidden="true" />
        <span>Retry</span>
      </button>
    );
  if (state.status === "available")
    return (
      <button
        type="button"
        className="app-rail-link app-rail-update"
        title={
          state.manual
            ? `Version ${state.version} is available. Open the download page.`
            : `Version ${state.version} is available. Download it now.`
        }
        onClick={() => {
          setFailed(true);
          void bridge?.updateDownload?.();
        }}
      >
        <RiDownloadLine aria-hidden="true" />
        <span>Update</span>
      </button>
    );
  if (state.status === "downloading")
    return (
      <div
        className="app-rail-link app-rail-update"
        role="status"
        title={`Downloading version ${state.version}`}
      >
        <RiDownloadLine aria-hidden="true" />
        <span>{state.percent}%</span>
      </div>
    );
  if (state.status === "ready")
    return (
      <button
        type="button"
        className="app-rail-link app-rail-update"
        title={`Restart to install version ${state.version}`}
        onClick={() => void bridge?.updateInstall?.()}
      >
        <RiRestartLine aria-hidden="true" />
        <span>Restart</span>
      </button>
    );
  return null;
}

import { useEffect, useState, type ComponentType } from "react";
import { RiDownloadLine, RiErrorWarningLine, RiRestartLine } from "@remixicon/react";
import { Progress } from "@ui-sdk/react/progress";
import type { UpdateState } from "@sidecut/contracts/desktop";
import { nativeBridge } from "@/modules/workspace/host-coordinator";

const RADIUS = 17;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A round icon whose ring fills with the download. */
function UpdateIcon({ icon: Icon, progress }: { icon: ComponentType; progress: number }) {
  return (
    <span className="app-rail-update-icon">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="app-rail-update-track" cx="20" cy="20" r={RADIUS} />
        <circle
          className="app-rail-update-ring"
          cx="20"
          cy="20"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress / 100)}
        />
      </svg>
      <Icon aria-hidden="true" />
    </span>
  );
}

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
        data-state="error"
        title={`Update failed: ${state.message}. Select to try again.`}
        onClick={() => void bridge?.updateCheck?.()}
      >
        <UpdateIcon icon={RiErrorWarningLine} progress={0} />
        <span>Retry</span>
      </button>
    );
  if (state.status === "available")
    return (
      <button
        type="button"
        className="app-rail-link app-rail-update"
        data-state="available"
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
        <UpdateIcon icon={RiDownloadLine} progress={0} />
        <span>Update</span>
      </button>
    );
  if (state.status === "downloading")
    return (
      <Progress
        className="app-rail-link app-rail-update"
        data-state="downloading"
        aria-label={`Downloading version ${state.version}`}
        value={state.percent}
        title={`Downloading version ${state.version}`}
      >
        <UpdateIcon icon={RiDownloadLine} progress={state.percent} />
        <span>{state.percent}%</span>
      </Progress>
    );
  if (state.status === "ready")
    return (
      <button
        type="button"
        className="app-rail-link app-rail-update"
        data-state="ready"
        title={`Restart to install version ${state.version}`}
        onClick={() => void bridge?.updateInstall?.()}
      >
        <UpdateIcon icon={RiRestartLine} progress={100} />
        <span>Restart</span>
      </button>
    );
  return null;
}

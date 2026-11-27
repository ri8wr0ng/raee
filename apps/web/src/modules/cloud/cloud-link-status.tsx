import { Link } from "@tanstack/react-router";
import { Tip } from "@raee/ui/components/tooltip";
import { useEditorSession } from "../workspace/editor-session";
import { readProjectLink } from "./cloud-project";

export function CloudLinkStatus() {
  const { snapshot } = useEditorSession();
  const link = readProjectLink(snapshot.project.id);
  if (!link) return null;

  const behind = link.localRevision === undefined || snapshot.revision !== link.localRevision;
  return (
    <Tip
      label={
        behind
          ? "You have changes not saved to the cloud. Open Cloud projects to save them."
          : "The cloud copy matches this project."
      }
    >
      <Link
        to="/library"
        className="editor-session-label"
        data-state={behind ? "cloud-behind" : "cloud-synced"}
      >
        {behind ? "Cloud copy is behind" : "In sync with cloud"}
      </Link>
    </Tip>
  );
}

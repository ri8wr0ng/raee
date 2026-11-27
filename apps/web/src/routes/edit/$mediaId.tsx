import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/modules/shell/app-shell";
import { EditFromCloud } from "@/modules/cloud/edit-from-cloud";

export const Route = createFileRoute("/edit/$mediaId")({
  validateSearch: (search: Record<string, unknown>) =>
    search.from === "studio" ? { from: "studio" as const } : {},
  component: EditMedia,
});

function EditMedia() {
  const { mediaId } = Route.useParams();
  const { from } = Route.useSearch();
  return (
    <AppShell>
      <EditFromCloud mediaId={mediaId} from={from} />
    </AppShell>
  );
}

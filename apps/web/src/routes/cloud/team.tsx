import { createFileRoute, redirect } from "@tanstack/react-router";

// Account and team settings live on the app rail's Team page.
export const Route = createFileRoute("/cloud/team")({
  beforeLoad: () => {
    throw redirect({ to: "/team", replace: true });
  },
});

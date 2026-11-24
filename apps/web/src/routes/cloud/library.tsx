import { createFileRoute, redirect } from "@tanstack/react-router";

// The team library lives on the app rail's Library page.
export const Route = createFileRoute("/cloud/library")({
  beforeLoad: () => {
    throw redirect({ to: "/library", replace: true });
  },
});

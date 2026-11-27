// @vitest-environment happy-dom
import "../../test/dom-setup";
import type { ComponentProps, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { writeProjectLink } from "./cloud-project";
import { CloudLinkStatus } from "./cloud-link-status";

const calls = vi.hoisted(() => ({ revision: 4 }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, ...props }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {props.children}
    </a>
  ),
}));
vi.mock("@raee/ui/components/tooltip", () => ({
  Tip: ({ children, label }: { children: ReactNode; label: string }) => (
    <div title={label}>{children}</div>
  ),
}));
vi.mock("../workspace/editor-session", () => ({
  useEditorSession: () => ({
    snapshot: { project: { id: "local_1" }, revision: calls.revision },
  }),
}));

beforeEach(() => {
  localStorage.clear();
  calls.revision = 4;
});

it("shows cloud sync state and links to the project library", () => {
  writeProjectLink("local_1", {
    projectId: "cloud_1",
    teamId: "team_1",
    revision: 2,
    localRevision: 4,
  });
  render(<CloudLinkStatus />);
  const link = screen.getByRole("link", { name: "In sync with cloud" });
  expect(link.getAttribute("href")).toBe("/library");
  expect(link.getAttribute("data-state")).toBe("cloud-synced");
  expect(link.parentElement?.getAttribute("title")).toBe("The cloud copy matches this project.");
});

it("marks old links or changed local revisions as behind", () => {
  writeProjectLink("local_1", { projectId: "cloud_1", teamId: "team_1", revision: 2 });
  const view = render(<CloudLinkStatus />);
  expect(
    screen.getByRole("link", { name: "Cloud copy is behind" }).getAttribute("data-state"),
  ).toBe("cloud-behind");
  writeProjectLink("local_1", {
    projectId: "cloud_1",
    teamId: "team_1",
    revision: 2,
    localRevision: 4,
  });
  calls.revision = 5;
  view.rerender(<CloudLinkStatus />);
  expect(
    screen.getByRole("link", { name: "Cloud copy is behind" }).getAttribute("data-state"),
  ).toBe("cloud-behind");
});

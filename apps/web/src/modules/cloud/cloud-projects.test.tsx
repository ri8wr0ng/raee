// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { CloudProjects } from "./cloud-projects";
import { readProjectLink, writeProjectLink } from "./cloud-project";
import type * as CloudProject from "./cloud-project";

const calls = vi.hoisted(() => ({
  rows: [] as unknown[] | undefined,
  record: null as unknown,
  save: vi.fn(),
  open: vi.fn(),
  archive: vi.fn(),
  navigate: vi.fn(),
  cloudProject: vi.fn(),
  openCloudProject: vi.fn(),
}));

const name = (reference: unknown) => getFunctionName(reference as never);

vi.mock("convex/react", () => ({
  useQuery: () => calls.rows,
  useConvex: () => ({ query: async () => calls.record }),
  useMutation: (reference: unknown) =>
    name(reference) === "projects:archive" ? calls.archive : vi.fn(),
  useAction: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => calls.navigate }));
vi.mock("../workspace/editor-session", () => ({
  useEditorSession: () => ({
    session: { cloudProject: calls.cloudProject, openCloudProject: calls.openCloudProject },
    snapshot: {
      project: { id: "prj_local", name: "Launch video" },
      readOnly: false,
      busy: false,
      saveState: "saved",
    },
  }),
}));
vi.mock("./cloud-project", async (actual) => ({
  ...(await actual<typeof CloudProject>()),
  saveProjectToCloud: calls.save,
  openCloudProject: calls.open,
}));

const row = {
  _id: "proj_1",
  name: "Launch video",
  revision: 3,
  updatedAt: Date.UTC(2026, 10, 24, 10),
  updatedByName: "Sam",
  files: 2,
  bytes: 3 * 1024 ** 3,
};
const record = {
  ...row,
  archived: false,
  document: { mediaId: "m_doc", versionId: "v_doc" },
  resources: [],
};

beforeEach(() => {
  localStorage.clear();
  calls.rows = [];
  calls.record = record;
  for (const fn of [
    calls.save,
    calls.open,
    calls.archive,
    calls.navigate,
    calls.cloudProject,
    calls.openCloudProject,
  ])
    fn.mockReset();
  calls.cloudProject.mockResolvedValue({ projectID: "prj_local", name: "Launch video" });
});

it("saves a new project, links it to this device and reports what was sent", async () => {
  calls.save.mockResolvedValue({ projectId: "proj_9", revision: 1, uploaded: 2, reused: 0 });
  render(<CloudProjects teamId={"team_1" as never} readOnly={false} />);
  expect(screen.getByText("No projects saved to this team yet.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Save to cloud" }));
  await screen.findByText(/Saved “Launch video”\. 2 files uploaded\./);
  expect(calls.save.mock.calls[0]![0]).toMatchObject({ teamId: "team_1", existing: null });
  expect(readProjectLink("prj_local")).toEqual({
    projectId: "proj_9",
    teamId: "team_1",
    revision: 1,
  });
});

it("updates the linked project, and refuses before uploading when another device saved since", async () => {
  calls.rows = [row];
  writeProjectLink("prj_local", { projectId: "proj_1", teamId: "team_1", revision: 3 });
  calls.save.mockResolvedValue({ projectId: "proj_1", revision: 4, uploaded: 1, reused: 1 });
  const view = render(<CloudProjects teamId={"team_1" as never} readOnly={false} />);
  expect(screen.getByText("In the editor")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/1 file uploaded, 1 already there/);
  expect(calls.save.mock.calls[0]![0].existing).toMatchObject({ _id: "proj_1", revision: 3 });
  view.unmount();

  calls.save.mockClear();
  writeProjectLink("prj_local", { projectId: "proj_1", teamId: "team_1", revision: 2 });
  render(<CloudProjects teamId={"team_1" as never} readOnly={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/saved from another device/);
  expect(calls.save).not.toHaveBeenCalled();

  calls.save.mockResolvedValue({ projectId: "proj_2", revision: 1, uploaded: 0, reused: 2 });
  await userEvent.click(screen.getByRole("button", { name: "Save as a new project" }));
  await screen.findByText(/All files were already in the cloud\./);
  expect(calls.save.mock.calls[0]![0].existing).toBeNull();
});

it("confirms before opening, then opens the download as a new local project", async () => {
  calls.rows = [row];
  calls.open.mockResolvedValue({ json: "{}", resources: [] });
  calls.openCloudProject.mockResolvedValue("prj_new");
  render(<CloudProjects teamId={"team_1" as never} readOnly={false} />);
  expect(screen.getByText(/by Sam · 2 files · 3\.0 GB/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByText(/It downloads 3\.0 GB and replaces “Launch video”/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Open project" }));
  await waitFor(() => expect(calls.navigate).toHaveBeenCalledWith({ to: "/" }));
  expect(calls.openCloudProject).toHaveBeenCalledWith("{}", []);
  expect(readProjectLink("prj_new")).toEqual({
    projectId: "proj_1",
    teamId: "team_1",
    revision: 3,
  });
});

it("lets viewers open projects but not save or remove them", () => {
  calls.rows = [row];
  render(<CloudProjects teamId={"team_1" as never} readOnly />);
  expect(screen.queryByRole("button", { name: "Save to cloud" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
});

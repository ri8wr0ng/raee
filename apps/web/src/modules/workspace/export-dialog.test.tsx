// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ExportDialog } from "./export-dialog";

const state = vi.hoisted(() => ({
  reviewPendingCount: 0,
  markReviewed: vi.fn(),
  queueExport: vi.fn(),
}));

vi.mock("../cloud/upload-button-lazy", () => ({
  UploadToCloudButton: () => null,
}));

vi.mock("@raee/core/export-presets", () => ({
  exportPresetPlan: (project: unknown) => ({ project, warnings: [] }),
}));

vi.mock("@raee/core/render-plan", () => ({
  exportPlan: () => ({ width: 1920, height: 1080, fps: 30, duration: 5 }),
  projectDuration: () => ({ seconds: 5 }),
}));

vi.mock("./editor-session", async () => {
  const { fakeEditorSession, fakeProject } = await import("../../test/fake-session");
  const project = fakeProject({ schemaVersion: 2 });
  const base = fakeEditorSession(project);
  const baseValue = base.useEditorSession();
  const emptyExports: never[] = [];
  const exportsStore = {
    subscribe: () => () => {},
    getSnapshot: () => emptyExports,
    retry: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
  };

  return {
    ...base,
    useEditorSession: () => ({
      ...baseValue,
      session: {
        ...baseValue.session,
        exports: exportsStore,
        markReviewed: state.markReviewed,
        queueExport: state.queueExport,
      },
      snapshot: {
        ...baseValue.snapshot,
        saveState: "saved" as const,
        reviewPendingCount: state.reviewPendingCount,
      },
      editor: {
        getState: () => ({
          ...baseValue.editor.getState(),
          setPlaying: vi.fn(),
        }),
      },
    }),
  };
});

describe("ExportDialog", () => {
  beforeEach(() => {
    state.reviewPendingCount = 0;
    state.markReviewed.mockReset();
    state.queueExport.mockReset();
  });

  it("enables Queue export and hides review notice when reviewPendingCount is 0", () => {
    state.reviewPendingCount = 0;
    render(<ExportDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.queryByText(/need review/i)).toBeNull();
    const queueButton = screen.getByRole("button", { name: "Queue export" });
    expect((queueButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows review notice, disables Queue export, and calls markReviewed when reviewPendingCount is 2", async () => {
    state.reviewPendingCount = 2;
    const user = userEvent.setup();
    render(<ExportDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText(/2 agent edit batches/i)).toBeTruthy();
    const queueButton = screen.getByRole("button", { name: "Queue export" });
    expect((queueButton as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(state.markReviewed).toHaveBeenCalledTimes(1);
  });

  it("enables Queue export when reviewPendingCount is 1 and preset is changed to Review · 720p WebM", async () => {
    state.reviewPendingCount = 1;
    const user = userEvent.setup();
    render(<ExportDialog open={true} onOpenChange={vi.fn()} />);

    const queueButton = screen.getByRole("button", { name: "Queue export" });
    expect((queueButton as HTMLButtonElement).disabled).toBe(true);

    const presetTrigger = screen.getByRole("combobox", { name: "Export preset" });
    await user.click(presetTrigger);
    await user.click(screen.getByRole("option", { name: "Review · 720p WebM" }));

    expect((queueButton as HTMLButtonElement).disabled).toBe(false);
  });
});

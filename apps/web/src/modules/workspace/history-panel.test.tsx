// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { HistoryEntry } from "./browser-session";
import { HistoryPanel } from "./history-panel";

const defaultEntries = (): HistoryEntry[] => [
  { id: "e1", kind: "edit", revision: 1, label: "Trim intro", author: "user" },
  { id: "e2", kind: "edit", revision: 2, label: "Tighten pauses", author: "claude" },
  { id: "e3", kind: "edit", revision: 3, label: "Add title", author: "user" },
  { id: "e4", kind: "edit", revision: 4, label: "Add captions", author: "claude" },
];

const { session, snapshot } = vi.hoisted(() => ({
  session: {
    history: vi.fn<() => { entries: HistoryEntry[]; complete: boolean }>(),
    markReviewed: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  },
  snapshot: {
    reviewPendingCount: 2,
    readOnly: false,
    busy: false,
    undoLabel: "Add captions",
    redoLabel: null as string | null,
    revision: 4,
    saveState: "saved" as const,
  },
}));

vi.mock("./editor-session", () => ({
  useEditorSession: () => ({ session, snapshot }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  session.history.mockReturnValue({ entries: defaultEntries(), complete: true });
  snapshot.reviewPendingCount = 2;
  snapshot.readOnly = false;
  snapshot.busy = false;
  snapshot.undoLabel = "Add captions";
  snapshot.redoLabel = null;
  snapshot.revision = 4;
  snapshot.saveState = "saved";
});

function renderPanel() {
  const user = userEvent.setup();
  render(<HistoryPanel run={(action) => action()} />);
  return { user };
}

describe("HistoryPanel", () => {
  it("shows all four labels by default and marks the two claude rows to review", () => {
    renderPanel();

    for (const label of ["Trim intro", "Tighten pauses", "Add title", "Add captions"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    expect(screen.getAllByText("To review")).toHaveLength(2);

    const rows = screen.getAllByRole("listitem");
    const byLabel = (label: string) => rows.find((row) => within(row).queryByText(label) !== null)!;

    expect(within(byLabel("Tighten pauses")).getByText("To review")).toBeTruthy();
    expect(within(byLabel("Add captions")).getByText("To review")).toBeTruthy();
    expect(within(byLabel("Trim intro")).queryByText("To review")).toBeNull();
    expect(within(byLabel("Add title")).queryByText("To review")).toBeNull();
  });

  it("filters to agent entries when Agents only is clicked", async () => {
    const { user } = renderPanel();
    const toggle = screen.getByRole("button", { name: "Agents only" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Trim intro")).toBeNull();
    expect(screen.queryByText("Add title")).toBeNull();
    expect(screen.getByText("Tighten pauses")).toBeTruthy();
    expect(screen.getByText("Add captions")).toBeTruthy();
  });

  it("shows an empty note when only user entries exist and Agents only is pressed", async () => {
    session.history.mockReturnValue({
      entries: [
        { id: "e1", kind: "edit", revision: 1, label: "Trim intro", author: "user" },
        { id: "e2", kind: "edit", revision: 2, label: "Add title", author: "user" },
      ],
      complete: true,
    });
    snapshot.reviewPendingCount = 0;

    const { user } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Agents only" }));

    expect(screen.getByText("No agent changes yet.")).toBeTruthy();
  });

  it("calls session.markReviewed when Mark reviewed is clicked", async () => {
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));

    expect(session.markReviewed).toHaveBeenCalledTimes(1);
  });
});

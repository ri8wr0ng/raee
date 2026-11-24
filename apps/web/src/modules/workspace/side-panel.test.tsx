// @vitest-environment happy-dom
import "../../test/dom-setup";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { SideTab } from "./panel-sizes";
import { SidePanel } from "./side-panel";

// The panels need an editor session; the tab wiring is what is under test.
vi.mock("./media-bin", () => ({ MediaBin: () => <p>media content</p> }));
vi.mock("./comments-panel", () => ({ CommentsPanel: () => <p>comments content</p> }));
vi.mock("./history-panel", () => ({ HistoryPanel: () => <p>history content</p> }));

vi.mock("./assistant-panel", () => ({ AssistantPanel: () => <p>assistant content</p> }));

afterEach(() => vi.unstubAllGlobals());

function Harness({ onTab }: { onTab: (tab: SideTab) => void }) {
  const [tab, setTab] = useState<SideTab>("media");
  return (
    <>
      <button type="button">before</button>
      <SidePanel
        tab={tab}
        onTab={(next) => {
          onTab(next);
          setTab(next);
        }}
        run={vi.fn()}
        hideButton={null}
      />
      <button type="button">after</button>
    </>
  );
}

function setup() {
  const onTab = vi.fn();
  const user = userEvent.setup();
  render(<Harness onTab={onTab} />);
  return { onTab, user };
}

const tab = (name: string) => screen.getByRole("tab", { name });

describe("side panel tabs", () => {
  it("starts on Media with one selected tab and its panel shown", () => {
    setup();
    expect(screen.getByRole("tablist", { name: "Side panels" })).toBeTruthy();
    expect(tab("Media").getAttribute("aria-selected")).toBe("true");
    expect(tab("Comments").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel").textContent).toBe("media content");
    expect(screen.queryByText("comments content")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Assistant" })).toBeNull();
  });

  it("has one tab stop, on the selected tab", async () => {
    const { user } = setup();
    expect(screen.getAllByRole("tab").filter((item) => item.tabIndex === 0)).toEqual([
      tab("Media"),
    ]);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(tab("Media"));
    await user.tab();
    expect(document.activeElement).not.toBe(tab("Comments"));
    expect(document.activeElement).not.toBe(tab("History"));
  });

  it("ArrowRight and ArrowLeft switch the selected tab and its panel", async () => {
    const { user, onTab } = setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab("Comments"));
    expect(tab("Comments").getAttribute("aria-selected")).toBe("true");
    expect(tab("Media").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel").textContent).toBe("comments content");
    expect(onTab).toHaveBeenLastCalledWith("comments");
    await user.keyboard("{ArrowRight}");
    expect(tab("History").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("history content");
    await user.keyboard("{ArrowLeft}");
    expect(tab("Comments").getAttribute("aria-selected")).toBe("true");
    expect(onTab).toHaveBeenLastCalledWith("comments");
  });

  it("Home and End jump to the first and last tab", async () => {
    const { user } = setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{End}");
    expect(tab("History").getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(tab("Media").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("media content");
  });

  it("clicking a tab selects it", async () => {
    const { user, onTab } = setup();
    await user.click(tab("History"));
    expect(onTab).toHaveBeenLastCalledWith("history");
    expect(screen.getByRole("tabpanel").textContent).toBe("history content");
  });

  it("selects the desktop Assistant tab with the keyboard", async () => {
    vi.stubGlobal("raeeDesktop", {
      assistantConnect: vi.fn(),
      assistantSettings: vi.fn(),
      assistantConfigure: vi.fn(),
      providerCredential: vi.fn(),
    });
    const { user, onTab } = setup();
    expect(screen.queryByText("assistant content")).toBeNull();
    await user.tab();
    await user.tab();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(tab("Assistant"));
    expect(onTab).toHaveBeenLastCalledWith("assistant");
    expect(await screen.findByText("assistant content")).toBeTruthy();
    expect(screen.getByRole("tabpanel", { name: "Assistant" })).toBeTruthy();
  });

  it("names each panel after its tab", async () => {
    const { user } = setup();
    expect(screen.getByRole("tabpanel", { name: "Media" })).toBeTruthy();
    await user.click(tab("Comments"));
    expect(screen.getByRole("tabpanel", { name: "Comments" })).toBeTruthy();
  });
});

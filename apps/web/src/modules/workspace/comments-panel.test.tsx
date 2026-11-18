// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { CommentsPanel } from "./comments-panel";

vi.mock("./editor-session", () => {
  const project = {
    schemaVersion: 2,
    markers: [
      { id: "m1", time: 1, name: "Fix audio", kind: "comment" },
      { id: "m2", time: 2, name: "Replace shot", kind: "todo" },
      { id: "m3", time: 3, name: "Trim intro", kind: "todo" },
    ],
  };
  return import("../../test/fake-session").then(({ fakeEditorSession, fakeProject }) =>
    fakeEditorSession(fakeProject(project)),
  );
});

function setup() {
  const user = userEvent.setup();
  render(
    <>
      <button type="button">before</button>
      <CommentsPanel run={vi.fn()} />
      <button type="button">after</button>
    </>,
  );
  return { user };
}

const radio = (name: string) => screen.getByRole("radio", { name });
const checked = () =>
  screen.getAllByRole("radio").filter((item) => item.getAttribute("aria-checked") === "true");
const rows = () => screen.getByRole("region", { name: "Comment list" }).textContent ?? "";

describe("comments Show filter", () => {
  it("is a labelled radio group with All checked", () => {
    setup();
    expect(screen.getByRole("radiogroup", { name: "Show" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(checked().map((item) => item.textContent)).toEqual(["All"]);
    expect(rows()).toContain("Fix audio");
    expect(rows()).toContain("Replace shot");
  });

  it("has one tab stop", async () => {
    const { user } = setup();
    expect(screen.getAllByRole("radio").filter((item) => item.tabIndex === 0)).toHaveLength(1);
    let stops = 0;
    for (let guard = 0; guard < 40; guard += 1) {
      await user.tab();
      if (screen.getAllByRole("radio").includes(document.activeElement as HTMLElement)) stops += 1;
      if (document.activeElement === screen.getByText("after")) break;
    }
    expect(stops).toBe(1);
  });

  it("arrows change the checked radio and the list", async () => {
    const { user } = setup();
    radio("All").focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(radio("Comments"));
    expect(checked().map((item) => item.textContent)).toEqual(["Comments"]);
    expect(rows()).toContain("Fix audio");
    expect(rows()).not.toContain("Replace shot");
    await user.keyboard("{ArrowRight}");
    expect(checked().map((item) => item.textContent)).toEqual(["To do"]);
    expect(rows()).toContain("Replace shot");
    expect(rows()).not.toContain("Fix audio");
    await user.keyboard("{ArrowLeft}");
    expect(checked().map((item) => item.textContent)).toEqual(["Comments"]);
  });

  it("clicking a radio checks it", async () => {
    const { user } = setup();
    await user.click(radio("To do"));
    expect(checked().map((item) => item.textContent)).toEqual(["To do"]);
  });
});

// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { SceneDeck } from "./scene-deck";

const scenes = [
  { id: "a", name: "Intro" },
  { id: "b", name: "Desk" },
  { id: "c", name: "Screen" },
];

function setup(activeId: string | null = "a") {
  const onSwitch = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <button type="button">before</button>
      <SceneDeck scenes={scenes} activeId={activeId} live={false} onSwitch={onSwitch} />
      <button type="button">after</button>
    </>,
  );
  return { onSwitch, user };
}

const scene = (name: RegExp | string) => screen.getByRole("button", { name });
const focused = () => document.activeElement?.textContent ?? "";

describe("scene deck keyboard", () => {
  it("is a labelled toolbar with the on-air scene pressed", () => {
    setup("b");
    expect(screen.getByRole("toolbar", { name: "Scene deck" })).toBeTruthy();
    const buttons = screen.getAllByRole("button", { pressed: true });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("Desk");
  });

  it("has one tab stop", async () => {
    const { user } = setup();
    await user.tab();
    await user.tab();
    expect(focused()).toContain("Intro");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("after"));
  });

  it("arrows, Home and End move focus without putting a scene on air", async () => {
    const { user, onSwitch } = setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(focused()).toContain("Desk");
    await user.keyboard("{ArrowRight}");
    expect(focused()).toContain("Screen");
    await user.keyboard("{ArrowLeft}");
    expect(focused()).toContain("Desk");
    await user.keyboard("{End}");
    expect(focused()).toContain("Screen");
    await user.keyboard("{Home}");
    expect(focused()).toContain("Intro");
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("Enter on the focused scene puts it on air", async () => {
    const { user, onSwitch } = setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onSwitch).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith("b");
  });

  it("Space puts the focused scene on air", async () => {
    const { user, onSwitch } = setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{End}");
    await user.keyboard(" ");
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith("c");
  });

  it("activating the scene already on air does nothing", async () => {
    const { user, onSwitch } = setup("a");
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    await user.click(scene(/Intro/));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("digit keys cut to the matching scene, even with focus elsewhere", async () => {
    const { user, onSwitch } = setup();
    await user.keyboard("2");
    expect(onSwitch).toHaveBeenLastCalledWith("b");
    await user.keyboard("3");
    expect(onSwitch).toHaveBeenLastCalledWith("c");
    await user.keyboard("9");
    expect(onSwitch).toHaveBeenCalledTimes(2);
  });

  it("announces the switch in a status region", async () => {
    const { user } = setup();
    await user.click(scene(/Desk/));
    expect(screen.getByRole("status").textContent).toBe("Desk on air");
  });
});

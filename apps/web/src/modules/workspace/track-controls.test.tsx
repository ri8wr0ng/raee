// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { TrackControls, type TrackControlsTrack } from "./track-controls";

const track: TrackControlsTrack = {
  name: "Dialog",
  locked: false,
  muted: false,
  rippleMode: "cut",
};

type Setup = {
  track?: Partial<TrackControlsTrack>;
  disabled?: boolean;
  index?: number;
  step?: number;
  count?: number;
};

function setup(options: Setup = {}) {
  const patch = vi.fn();
  const move = vi.fn();
  const remove = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <button type="button">before</button>
      <TrackControls
        track={{ ...track, ...options.track }}
        index={options.index ?? 1}
        step={options.step ?? 1}
        count={options.count ?? 3}
        disabled={options.disabled ?? false}
        patch={patch}
        move={move}
        remove={remove}
      />
      <button type="button">after</button>
    </>,
  );
  return { patch, move, remove, user };
}

const lock = () => screen.getByRole("button", { name: "Lock track Dialog" });
const mute = () => screen.getByRole("button", { name: "Mute track Dialog" });
const ripple = () => screen.getByRole("button", { name: /^Ripple mode Dialog/ });
const up = () => screen.getByRole("button", { name: "Move track Dialog up" });
const down = () => screen.getByRole("button", { name: "Move track Dialog down" });
const del = () => screen.getByRole("button", { name: "Remove track Dialog" });
const items = () => [lock(), mute(), ripple(), up(), down(), del()];

describe("track header controls", () => {
  it("is one labelled toolbar with every control named", () => {
    setup();
    expect(screen.getByRole("toolbar", { name: "Dialog track controls" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Dialog track order" })).toBeTruthy();
    expect(items()).toHaveLength(6);
  });

  it("has one tab stop: Tab enters on the first item and the next Tab leaves", async () => {
    const { user } = setup();
    expect(items().filter((item) => item.tabIndex === 0)).toHaveLength(1);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("before"));
    await user.tab();
    expect(document.activeElement).toBe(lock());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("after"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(lock());
  });

  it("moves focus with ArrowRight, ArrowLeft, Home and End", async () => {
    const { user } = setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(mute());
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(up());
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(ripple());
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(del());
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(lock());
  });

  it("keeps the roving tab stop on the item that has focus", async () => {
    const { user } = setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(items().filter((item) => item.tabIndex === 0)).toEqual([ripple()]);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("after"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(ripple());
  });

  it("Lock reports aria-pressed and calls patch, by click, Space and Enter", async () => {
    const { patch, user } = setup();
    expect(lock().getAttribute("aria-pressed")).toBe("false");
    await user.click(lock());
    expect(patch).toHaveBeenLastCalledWith({ locked: true });
    lock().focus();
    await user.keyboard(" ");
    expect(patch).toHaveBeenCalledTimes(2);
    await user.keyboard("{Enter}");
    expect(patch).toHaveBeenCalledTimes(3);
  });

  it("shows the locked state and unlocks", async () => {
    const { patch, user } = setup({ track: { locked: true } });
    expect(lock().getAttribute("aria-pressed")).toBe("true");
    expect(lock().getAttribute("title")).toBe("Unlock track");
    await user.click(lock());
    expect(patch).toHaveBeenLastCalledWith({ locked: false });
  });

  it("Mute reports aria-pressed and calls patch, by click and Space", async () => {
    const { patch, user } = setup();
    expect(mute().getAttribute("aria-pressed")).toBe("false");
    await user.click(mute());
    expect(patch).toHaveBeenLastCalledWith({ muted: true });
    mute().focus();
    await user.keyboard(" ");
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it("shows the muted state and unmutes", async () => {
    const { patch, user } = setup({ track: { muted: true } });
    expect(mute().getAttribute("aria-pressed")).toBe("true");
    await user.click(mute());
    expect(patch).toHaveBeenLastCalledWith({ muted: false });
  });

  it.each([
    ["cut", "follow"],
    ["follow", "off"],
    ["off", "cut"],
  ] as const)(
    "the ripple button goes from %s to %s",
    async (from: TrackControlsTrack["rippleMode"], to: string) => {
      const { patch, user } = setup({ track: { rippleMode: from } });
      expect(ripple().getAttribute("aria-label")).toBe(`Ripple mode Dialog: ${from}`);
      await user.click(ripple());
      expect(patch).toHaveBeenCalledWith({ rippleMode: to });
    },
  );

  it("move and remove buttons call their handlers with the new index", async () => {
    const { move, remove, user } = setup();
    await user.click(up());
    expect(move).toHaveBeenLastCalledWith(2);
    await user.click(down());
    expect(move).toHaveBeenLastCalledWith(0);
    await user.click(del());
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("while disabled every item stays focusable, reports aria-disabled and fires nothing", async () => {
    const { patch, move, remove, user } = setup({ disabled: true });
    for (const item of items()) {
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.hasAttribute("disabled")).toBe(false);
    }
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(lock());
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(mute());
    for (const item of items()) await user.click(item);
    await user.keyboard(" {Enter}");
    expect(patch).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("enabled items do not carry aria-disabled", () => {
    setup();
    for (const item of items()) expect(item.hasAttribute("aria-disabled")).toBe(false);
  });

  it("disables a move that would leave the list, and Remove on a locked track", async () => {
    const { move, remove, user } = setup({ index: 0, track: { locked: true } });
    expect(up().hasAttribute("aria-disabled")).toBe(false);
    expect(down().getAttribute("aria-disabled")).toBe("true");
    expect(del().getAttribute("aria-disabled")).toBe("true");
    await user.click(down());
    await user.click(del());
    expect(move).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await user.click(up());
    expect(move).toHaveBeenCalledWith(1);
  });

  it("audio tracks (step -1) reach the opposite neighbours", async () => {
    const { move, user } = setup({ step: -1 });
    await user.click(up());
    expect(move).toHaveBeenLastCalledWith(0);
    await user.click(down());
    expect(move).toHaveBeenLastCalledWith(2);
  });
});

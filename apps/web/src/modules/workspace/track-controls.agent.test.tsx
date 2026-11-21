// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { expect, it, vi } from "vite-plus/test";
import { TrackControls } from "./track-controls";

it("an agent can find and use every track control", async () => {
  const agent = createAgent();
  const patch = vi.fn();
  const move = vi.fn();
  const remove = vi.fn();
  render(
    <TrackControls
      track={{ name: "Dialog", locked: false, muted: false, rippleMode: "cut" }}
      index={1}
      step={1}
      count={3}
      disabled={false}
      patch={patch}
      move={move}
      remove={remove}
    />,
  );

  const components = agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of components)
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  const labels = components.map((entry) => entry.label);
  for (const label of ["Lock track Dialog", "Mute track Dialog", "Dialog track controls"])
    expect(labels, `${label} is missing from the snapshot`).toContain(label);
  const toolbar = components.find((entry) => entry.label === "Dialog track controls");
  expect(toolbar).toMatchObject({
    buttons: expect.arrayContaining([
      "Ripple mode Dialog: cut",
      "Move track Dialog up",
      "Move track Dialog down",
      "Remove track Dialog",
    ]),
  });

  const result = await agent.act({
    steps: [
      { ref: "Lock track Dialog", action: "setPressed", args: [true] },
      { ref: "Mute track Dialog", action: "setPressed", args: [true] },
      { ref: "Dialog track controls", action: "press", args: ["Ripple mode Dialog: cut"] },
      { ref: "Dialog track controls", action: "press", args: ["Move track Dialog up"] },
    ],
  });
  expect(result.ok, result.error?.message).toBe(true);
  expect(patch).toHaveBeenCalledWith({ locked: true });
  expect(patch).toHaveBeenCalledWith({ muted: true });
  expect(patch).toHaveBeenCalledWith({ rippleMode: "follow" });
  expect(move).toHaveBeenCalledWith(2);
  expect(screen.getByRole("toolbar", { name: "Dialog track controls" })).toBeTruthy();
});

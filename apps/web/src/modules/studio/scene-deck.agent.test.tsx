// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render } from "@testing-library/react";
import { createAgent } from "@ui-sdk/react/agent";
import { expect, it, vi } from "vite-plus/test";
import { SceneDeck } from "./scene-deck";

it("an agent can find the scene deck and put a scene on air", async () => {
  const agent = createAgent();
  const onSwitch = vi.fn();
  render(
    <SceneDeck
      scenes={[
        { id: "a", name: "Intro" },
        { id: "b", name: "Desk" },
      ]}
      activeId="a"
      live={false}
      onSwitch={onSwitch}
    />,
  );

  const components = agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");
  for (const entry of components)
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  const labels = components.map((entry) => entry.label);
  for (const label of ["Scene deck", "Desk"])
    expect(labels, `${label} is missing from the snapshot`).toContain(label);

  const result = await agent.act({
    steps: [{ ref: "Desk", action: "setPressed", args: [true] }],
  });
  expect(result.ok, result.error?.message).toBe(true);
  expect(onSwitch).toHaveBeenCalledWith("b");
});

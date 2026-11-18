// @vitest-environment happy-dom
import "../../test/dom-setup";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ownsKey } from "./keyboard";
import { isTabNavigationKey } from "./tab-keys";

function mount(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

afterEach(() => document.body.replaceChildren());

describe("ownsKey with real DOM", () => {
  it("lets a toolbar, radio and tab (and anything inside them) keep arrow, Home and End keys", () => {
    const host = mount(`
      <div role="toolbar"><button id="tool">Lock</button></div>
      <div role="radiogroup"><span role="radio" id="radio" tabindex="0"></span></div>
      <div role="tablist"><button role="tab" id="tab"><span id="label">Media</span></button></div>
      <div role="slider" id="slider" tabindex="0"></div>`);
    for (const id of ["tool", "radio", "tab", "label", "slider"]) {
      const target = host.querySelector(`#${id}`)!;
      for (const action of ["back", "forward", "previous", "next", "home", "end"] as const)
        expect(ownsKey(target, action), `${id} ${action}`).toBe(true);
    }
  });

  it("leaves the keys to the editor on the page body and plain elements", () => {
    const host = mount(`<div id="plain"><button id="plainButton">x</button></div>`);
    expect(ownsKey(document.body, "forward")).toBe(false);
    expect(ownsKey(host.querySelector("#plain"), "forward")).toBe(false);
    expect(ownsKey(host.querySelector("#plainButton"), "forward")).toBe(false);
    expect(ownsKey(null, "forward")).toBe(false);
  });

  it("only claims navigation keys, not other shortcuts, inside a toolbar", () => {
    const host = mount(`<div role="toolbar"><button id="tool">Lock</button></div>`);
    expect(ownsKey(host.querySelector("#tool"), "split")).toBe(false);
    expect(ownsKey(host.querySelector("#tool"), "undo")).toBe(false);
  });

  it("claims Space (play) for buttons, links, summaries, tabs and sliders only", () => {
    const host = mount(`
      <button id="button">b</button><a href="#" id="link">l</a>
      <details><summary id="summary">s</summary></details>
      <div role="tab" id="tab"></div><div role="slider" id="slider"></div>
      <div id="plain"></div>`);
    for (const id of ["button", "link", "summary", "tab", "slider"])
      expect(ownsKey(host.querySelector(`#${id}`), "play"), id).toBe(true);
    expect(ownsKey(host.querySelector("#plain"), "play")).toBe(false);
    expect(ownsKey(document.body, "play")).toBe(false);
  });
});

describe("isTabNavigationKey with real DOM", () => {
  it("is true for arrows, Home and End from inside a tab", () => {
    const host = mount(
      `<div role="tablist"><button role="tab" id="tab"><span id="label">x</span></button></div>`,
    );
    for (const id of ["tab", "label"])
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"])
        expect(
          isTabNavigationKey({ key, target: host.querySelector(`#${id}`) }),
          `${id} ${key}`,
        ).toBe(true);
  });

  it("is false for other keys from a tab", () => {
    const host = mount(`<button role="tab" id="tab">x</button>`);
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "a"])
      expect(isTabNavigationKey({ key, target: host.querySelector("#tab") }), key).toBe(false);
  });

  it("is false for arrows outside a tab, including a toolbar, radio or the body", () => {
    const host = mount(`
      <div role="toolbar"><button id="tool">x</button></div>
      <span role="radio" id="radio"></span><button id="plain">p</button>`);
    for (const target of [
      host.querySelector("#tool"),
      host.querySelector("#radio"),
      host.querySelector("#plain"),
      document.body,
      null,
    ])
      expect(isTabNavigationKey({ key: "ArrowRight", target })).toBe(false);
  });
});

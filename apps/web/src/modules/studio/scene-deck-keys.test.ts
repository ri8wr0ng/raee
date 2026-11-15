import { describe, expect, it } from "vite-plus/test";
import { isEditableHotkeyTarget, sceneHotkeyIndex, sceneHotkeyScene } from "./scene-deck-keys";

const key = (over: Partial<Parameters<typeof sceneHotkeyScene>[0]> = {}) => ({
  key: "2",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: null,
  ...over,
});

describe("sceneHotkeyIndex", () => {
  it("maps digits 1-9 to scene indexes", () => {
    expect(sceneHotkeyIndex("1", 3)).toBe(0);
    expect(sceneHotkeyIndex("9", 9)).toBe(8);
  });

  it("ignores keys outside 1-9 and digits past the scene count", () => {
    expect(sceneHotkeyIndex("0", 3)).toBeNull();
    expect(sceneHotkeyIndex("a", 3)).toBeNull();
    expect(sceneHotkeyIndex("Enter", 3)).toBeNull();
    expect(sceneHotkeyIndex("3", 2)).toBeNull();
  });

  it("stays off until a second scene exists", () => {
    expect(sceneHotkeyIndex("1", 0)).toBeNull();
    expect(sceneHotkeyIndex("1", 1)).toBeNull();
  });
});

describe("isEditableHotkeyTarget", () => {
  it("detects fields and contenteditable", () => {
    expect(isEditableHotkeyTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableHotkeyTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableHotkeyTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableHotkeyTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableHotkeyTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableHotkeyTarget(null)).toBe(false);
  });
});

describe("sceneHotkeyScene", () => {
  it("returns the scene index for a plain digit", () => {
    expect(sceneHotkeyScene(key(), 4)).toBe(1);
  });

  it("ignores modifier combos", () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(sceneHotkeyScene(key({ [mod]: true }), 4)).toBeNull();
    }
  });

  it("ignores typing in editable targets", () => {
    expect(sceneHotkeyScene(key({ target: { tagName: "INPUT" } }), 4)).toBeNull();
    expect(
      sceneHotkeyScene(key({ target: { tagName: "DIV", isContentEditable: true } }), 4),
    ).toBeNull();
  });
});

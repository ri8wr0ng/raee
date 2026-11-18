/* eslint-disable no-underscore-dangle -- `__UI_SDK_STRICT__` is the name ui-sdk reads. */
// Import for its side effects at the top of a DOM test file (after `// @vitest-environment happy-dom`).
import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Development warnings from ui-sdk fail the test instead of scrolling past.
globalThis.__UI_SDK_STRICT__ = true;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout, so these only need to exist.
HTMLElement.prototype.showPopover = function () {};
HTMLElement.prototype.hidePopover = function () {};
Element.prototype.getAnimations = () => [];
Element.prototype.scrollIntoView = function () {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

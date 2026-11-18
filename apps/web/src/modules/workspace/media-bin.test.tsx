// @vitest-environment happy-dom
import "../../test/dom-setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { MediaBin } from "./media-bin";

vi.mock("./editor-session", () => {
  const project = {
    schemaVersion: 2,
    media: [
      { id: "v1", path: "/clips/interview.mov", kind: "video" },
      { id: "a1", path: "/clips/music.wav", kind: "audio" },
      { id: "i1", path: "/clips/logo.png", kind: "image" },
    ],
  };
  return import("../../test/fake-session").then(({ fakeEditorSession, fakeProject }) =>
    fakeEditorSession(fakeProject(project)),
  );
});

// Everything below the filter needs a live session or the cloud; it is not under test.
vi.mock("../cloud/upload-button-lazy", () => ({ UploadToCloudButton: () => null }));
vi.mock("./media-placement-form", () => ({ MediaPlacementForm: () => null }));
vi.mock("./media-analysis-controls", () => ({
  MediaAnalysisControls: () => null,
  TakeIdentification: () => null,
}));
vi.mock("./source-samples", () => ({ MediaThumb: () => null }));
vi.mock("./asset-library", () => ({ LocalAssetLibrary: () => null }));
vi.mock("./saved-segments", () => ({ SavedSegments: () => null }));
vi.mock("./native-recording-controls", () => ({ NativeRecordingControls: () => null }));
vi.mock("./native-recording-library", () => ({ NativeRecordingLibrary: () => null }));
vi.mock("./recording-controls", () => ({ RecordingControls: () => null }));
vi.mock("./saved-recordings", () => ({ SavedRecordings: () => null }));
vi.mock("./rendered-review", () => ({ RenderedReview: () => null }));

function setup() {
  const user = userEvent.setup();
  render(
    <>
      <button type="button">before</button>
      <MediaBin run={vi.fn()} />
      <button type="button">after</button>
    </>,
  );
  return { user };
}

const filter = () => screen.getByRole("radiogroup", { name: "Filter by kind" });
const radios = () => Array.from(filter().querySelectorAll<HTMLElement>("[role=radio]"));
const radio = (name: string) => screen.getByRole("radio", { name });
const checked = () =>
  radios()
    .filter((item) => item.getAttribute("aria-checked") === "true")
    .map((item) => item.getAttribute("aria-label") ?? item.textContent);
const page = () => document.body.textContent ?? "";

describe("media kind filter", () => {
  it("is a labelled radio group, one radio per kind, All checked", () => {
    setup();
    expect(radios().map((item) => item.getAttribute("aria-label"))).toEqual([
      "All",
      "Video",
      "Audio",
      "Image",
    ]);
    expect(checked()).toEqual(["All"]);
    expect(page()).toContain("interview.mov");
    expect(page()).toContain("music.wav");
    expect(page()).toContain("logo.png");
  });

  it("has one tab stop", async () => {
    const { user } = setup();
    expect(radios().filter((item) => item.tabIndex === 0)).toHaveLength(1);
    let stops = 0;
    for (let guard = 0; guard < 60; guard += 1) {
      await user.tab();
      if (radios().includes(document.activeElement as HTMLElement)) stops += 1;
      if (document.activeElement === screen.getByText("after")) break;
    }
    expect(stops).toBe(1);
  });

  it("arrows change the checked radio and narrow the list", async () => {
    const { user } = setup();
    radio("All").focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(radio("Video"));
    expect(checked()).toEqual(["Video"]);
    expect(page()).toContain("interview.mov");
    expect(page()).not.toContain("music.wav");
    await user.keyboard("{ArrowRight}");
    expect(checked()).toEqual(["Audio"]);
    expect(page()).toContain("music.wav");
    expect(page()).not.toContain("interview.mov");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(checked()).toEqual(["All"]);
    expect(page()).toContain("logo.png");
  });

  it("clicking a radio checks it", async () => {
    const { user } = setup();
    await user.click(radio("Image"));
    expect(checked()).toEqual(["Image"]);
    expect(page()).toContain("logo.png");
    expect(page()).not.toContain("music.wav");
  });
});

import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@raee/contracts/project";
import type { BrowserProjectSession } from "@/modules/workspace/browser-session";
import { addTakeToProject } from "./place-take";

describe("addTakeToProject", () => {
  it("returns the media id and timeline placement time", async () => {
    const project = decodeProjectFile({
      revision: 1,
      project: {
        settings: { frameRate: { numerator: 30, denominator: 1 } },
        media: [{ id: "media-1", path: "take.webm", duration: 8 }],
        videoTracks: [
          {
            id: "track-1",
            kind: "video",
            clips: [
              {
                id: "clip-1",
                start: 0,
                duration: 5,
                sourceStart: 0,
                content: { media: { mediaID: "existing" } },
              },
            ],
          },
        ],
      },
    }).project;
    const state = {
      project,
      revision: 1,
      mediaAvailability: { "media-1": { state: "available" } },
    };
    const session = {
      importFiles: async () => ["media-1"],
      getSnapshot: () => state,
      apply: () => {},
    } as unknown as BrowserProjectSession;

    await expect(addTakeToProject(session, new File(["take"], "take.webm"), [])).resolves.toEqual({
      where: "timeline",
      at: 5,
      mediaID: "media-1",
    });
  });
});

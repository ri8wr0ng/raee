import { afterEach, describe, expect, it } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import type { GenericId } from "convex/values";
import schema from "./schema";
import * as library from "./library";
import * as projects from "./projects";
import * as teams from "./teams";
import * as versions from "./versions";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  library,
  projects,
  teams,
  versions,
});

const alice = {
  subject: "alice",
  issuer: "https://api.workos.com/",
  email: "alice@example.com",
  emailVerified: true,
  name: "Alice",
};
const bob = { ...alice, subject: "bob", email: "bob@example.com", name: "Bob" };
const originalBillingFlag = process.env.RAEE_BILLING_ENABLED;
function setBilling(value: string | undefined) {
  if (value === undefined) delete process.env.RAEE_BILLING_ENABLED;
  else process.env.RAEE_BILLING_ENABLED = value;
}
afterEach(() => setBilling(originalBillingFlag));

const uploadArgs = (teamId: GenericId<"teams">, requestId: string, hidden?: boolean) => ({
  teamId,
  name: requestId,
  requestId,
  fileName: `${requestId}.json`,
  snapshot: "{}",
  expectedBytes: 5,
  partCount: 1,
  ...(hidden === undefined ? {} : { hidden }),
});

async function setup() {
  setBilling(undefined);
  const t = createTest();
  const a = t.withIdentity(alice);
  const b = t.withIdentity(bob);
  const teamId = await a.mutation(api.teams.create, { name: "A" });
  const makeFile = async (requestId: string, hidden?: boolean, ready = true) => {
    const file = await a.mutation(api.versions.beginUpload, uploadArgs(teamId, requestId, hidden));
    if (ready) {
      await t.mutation(internal.versions.recordPart, {
        versionId: file.versionId,
        part: 1,
        etag: requestId,
        bytes: 5,
      });
      await t.mutation(internal.versions.uploaded, { versionId: file.versionId });
    }
    return file;
  };
  const document = await makeFile("document");
  const projectArgs = {
    teamId,
    name: "Cut",
    document,
    resources: [
      {
        key: "lut/main",
        name: "Main LUT",
        type: "application/octet-stream",
        bytes: 42,
        ...(await makeFile("lut", true)),
      },
    ],
  };
  return { t, a, b, teamId, document, projectArgs, makeFile };
}

describe("cloud projects", () => {
  it("creates revision 1 and saves the next revision", async () => {
    const { a, projectArgs } = await setup();
    const created = await a.mutation(api.projects.save, projectArgs);
    expect(created).toMatchObject({ revision: 1 });
    expect(await a.query(api.projects.get, { projectId: created.projectId })).toMatchObject({
      name: "Cut",
      revision: 1,
      updatedByName: "Alice",
    });
    await expect(
      a.mutation(api.projects.save, {
        ...projectArgs,
        projectId: created.projectId,
        baseRevision: 1,
      }),
    ).resolves.toMatchObject({ projectId: created.projectId, revision: 2 });
  });

  it("rejects stale revisions, unready versions, cross-team media and invalid resources", async () => {
    const { a, projectArgs, makeFile } = await setup();
    const created = await a.mutation(api.projects.save, projectArgs);
    await expect(
      a.mutation(api.projects.save, {
        ...projectArgs,
        projectId: created.projectId,
        baseRevision: 0,
      }),
    ).rejects.toThrow("This project was saved from another device since you opened it.");
    const unready = await makeFile("unready", false, false);
    await expect(
      a.mutation(api.projects.save, {
        ...projectArgs,
        document: unready,
        projectId: created.projectId,
      }),
    ).rejects.toThrow("A project file is not uploaded yet.");

    const otherTeamId = await a.mutation(api.teams.create, { name: "Other" });
    const foreign = await a.mutation(api.versions.beginUpload, uploadArgs(otherTeamId, "foreign"));
    await expect(
      a.mutation(api.projects.save, { ...projectArgs, document: foreign }),
    ).rejects.toThrow("A project file is not uploaded yet.");
    const [resource] = projectArgs.resources;
    if (!resource) throw new Error("Missing project resource fixture");
    await expect(
      a.mutation(api.projects.save, {
        ...projectArgs,
        resources: [{ ...resource, key: "" }],
      }),
    ).rejects.toThrow("Invalid project resources.");
  });

  it("requires membership to list and get, and editor access to save", async () => {
    const { a, b, teamId, projectArgs } = await setup();
    const { projectId } = await a.mutation(api.projects.save, projectArgs);
    const outsiderTeamId = await b.mutation(api.teams.create, { name: "Bob" });
    await expect(b.query(api.projects.list, { teamId })).rejects.toThrow("Team access denied.");
    await expect(b.query(api.projects.get, { projectId })).rejects.toThrow("Team access denied.");
    await expect(b.mutation(api.projects.save, projectArgs)).rejects.toThrow("Team access denied.");
    expect(outsiderTeamId).not.toBe(teamId);

    const invitationId = await a.mutation(api.teams.invite, {
      teamId,
      email: bob.email,
      role: "viewer",
    });
    await b.mutation(api.teams.accept, { invitationId });
    expect(await b.query(api.projects.list, { teamId })).toHaveLength(1);
    await expect(b.mutation(api.projects.save, projectArgs)).rejects.toThrow(
      "Editing access required.",
    );
  });

  it("hides archived projects from the list", async () => {
    const { a, teamId, projectArgs } = await setup();
    const { projectId } = await a.mutation(api.projects.save, projectArgs);
    expect(await a.query(api.projects.list, { teamId })).toMatchObject([
      { _id: projectId, files: 1, bytes: 42 },
    ]);
    await a.mutation(api.projects.archive, { projectId });
    expect(await a.query(api.projects.list, { teamId })).toEqual([]);
  });

  it("keeps hidden uploads out of library list and page", async () => {
    const { t, a, teamId } = await setup();
    const hidden = await a.mutation(api.versions.beginUpload, uploadArgs(teamId, "private", true));
    const media = await a.query(api.library.list, { teamId, sort: "name" });
    expect(media.some((item) => item._id === hidden.mediaId)).toBe(false);
    const page = await a.query(api.library.page, {
      teamId,
      sort: "name",
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(page.page.some((item) => item._id === hidden.mediaId)).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(hidden.mediaId))).toMatchObject({ hidden: true });
  });
});

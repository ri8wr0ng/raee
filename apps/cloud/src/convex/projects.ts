import { v, ConvexError } from "convex/values";
import { mutation, query } from "./model";
import { membership } from "./access";
import { creatorAccess, name } from "./library";
import { projectResource } from "./schema";

const projectFile = v.object({ mediaId: v.id("media"), versionId: v.id("mediaVersions") });

export const save = mutation({
  args: {
    teamId: v.id("teams"),
    projectId: v.optional(v.id("projects")),
    baseRevision: v.optional(v.number()),
    name: v.string(),
    document: projectFile,
    resources: v.array(projectResource),
  },
  handler: async (ctx, args) => {
    await creatorAccess(ctx, args.teamId);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in required.");
    const updatedBy = identity.tokenIdentifier;
    const updatedByName = identity.name ?? identity.email ?? "Someone";
    if (
      args.resources.length > 5000 ||
      new Set(args.resources.map((resource) => resource.key)).size !== args.resources.length ||
      args.resources.some(
        (resource) =>
          resource.key.length < 1 ||
          resource.key.length > 300 ||
          resource.name.length < 1 ||
          resource.name.length > 255 ||
          resource.type.length > 120 ||
          !Number.isSafeInteger(resource.bytes) ||
          resource.bytes < 0,
      )
    )
      throw new ConvexError("Invalid project resources.");

    const project = args.projectId ? await ctx.db.get(args.projectId) : null;
    if (args.projectId && (!project || project.teamId !== args.teamId || project.archived))
      throw new ConvexError("Project unavailable.");
    // Files this project already saved stay usable after the library archives them.
    const kept = new Set(project?.resources.map((resource) => resource.versionId));
    const files = [args.document, ...args.resources];
    const versions = new Map(
      await Promise.all(
        [...new Set(files.map((file) => file.versionId))].map(
          async (versionId) => [versionId, await ctx.db.get(versionId)] as const,
        ),
      ),
    );
    for (const file of files) {
      const version = versions.get(file.versionId);
      const media = await ctx.db.get(file.mediaId);
      if (
        !version ||
        version.mediaId !== file.mediaId ||
        !media ||
        media.teamId !== args.teamId ||
        version.status !== "ready"
      )
        throw new ConvexError("A project file is not uploaded yet.");
      if (media.archived && !kept.has(file.versionId))
        throw new ConvexError(
          `${media.name} is archived in the library. Restore it, then save again.`,
        );
    }

    const updatedAt = Date.now();
    if (project) {
      if (args.baseRevision !== undefined && args.baseRevision !== project.revision)
        throw new ConvexError("This project was saved from another device since you opened it.");
      const revision = project.revision + 1;
      await ctx.db.patch(project._id, {
        name: name(args.name),
        document: args.document,
        resources: args.resources,
        revision,
        updatedAt,
        updatedBy,
        updatedByName,
      });
      return { projectId: project._id, revision };
    }

    const projectId = await ctx.db.insert("projects", {
      teamId: args.teamId,
      name: name(args.name),
      archived: false,
      revision: 1,
      updatedAt,
      updatedBy,
      updatedByName,
      document: args.document,
      resources: args.resources,
    });
    return { projectId, revision: 1 };
  },
});

export const list = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await membership(ctx, args.teamId);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_team_archived_updated", (q) =>
        q.eq("teamId", args.teamId).eq("archived", false),
      )
      .order("desc")
      .take(200);
    return projects.map((project) => ({
      _id: project._id,
      name: project.name,
      revision: project.revision,
      updatedAt: project.updatedAt,
      updatedByName: project.updatedByName,
      files: project.resources.length,
      bytes: project.resources.reduce((total, resource) => total + resource.bytes, 0),
    }));
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new ConvexError("Project unavailable.");
    await membership(ctx, project.teamId);
    return project;
  },
});

export const archive = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new ConvexError("Project unavailable.");
    await creatorAccess(ctx, project.teamId);
    await ctx.db.patch(project._id, { archived: true });
  },
});

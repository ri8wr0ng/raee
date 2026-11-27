#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { discoverHost, hostCall, watchHost } from "./host-client.mjs";
import { findProject, verifyProjectOwner } from "./cli-foundation.mjs";
import { definitions, prepareTool, toolResult, clientAuthor } from "./mcp-adapters.mjs";
import { acquireProjectHost } from "./headless-host.mjs";

const instructions =
  "raE.E edits local projects through one authoritative owner, starting a hidden desktop host for closed projects. Read status/timeline before editing. Use expectedRevision on mutations, label edits, and apply idempotencyKey for retries. Helpers preview unless apply:true. Resolve comments with removeMarker. Provider downloads/paid generation require explicit opt-in. Do not retry other mutations after a lost reply. Tools return readable text by default; json:true returns raw data. Read warnings and documented adapter limits.";

/** Forwards export progress as MCP progress notifications while the export call runs. */
async function watchExportProgress(host, extra, signal) {
  // MCP names request metadata `_meta`.
  // eslint-disable-next-line no-underscore-dangle
  const progressToken = extra._meta?.progressToken;
  let exportId;
  try {
    for await (const event of watchHost(host, { signal })) {
      const job = event?.kind === "export" ? event.export : undefined;
      if (!job || typeof job !== "object") continue;
      if (exportId === undefined) {
        if (job.state !== "running") continue;
        exportId = job.id;
      }
      if (job.id !== exportId) continue;
      if (progressToken !== undefined && typeof job.progress === "number") {
        await extra
          .sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: Math.round(job.progress * 100),
              total: 100,
              message: `Exporting ${job.output}`,
            },
          })
          .catch(() => {});
      }
      if (job.state === "done" || job.state === "failed") return;
    }
  } catch {
    // Event stream failures must never fail the tool call.
  }
}

async function main() {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (
      !["--endpoint-file", "--project", "--author"].includes(key) ||
      !process.argv[i + 1] ||
      options.has(key)
    )
      throw new Error("Expected --endpoint-file, --project, or --author followed by a value.");
    options.set(key, process.argv[i + 1]);
  }
  const server = new Server(
    { name: "raee", version: "0.1.0" },
    { capabilities: { tools: {}, logging: {} }, instructions },
  );
  const hosts = new Map();
  server.onclose = () => {
    for (const host of hosts.values()) void host.close();
    hosts.clear();
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definitions.map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const { tool, input, json, project } = prepareTool(
        request.params.name,
        request.params.arguments,
      );
      if (tool.name === "effects") {
        const result = JSON.parse(
          await readFile(new URL("./effects-catalog.json", import.meta.url), "utf8"),
        );
        if (input.type != null)
          result.effects = result.effects.filter(
            (effect) => effect.type.toLowerCase() === input.type.toLowerCase(),
          );
        if (!result.effects.length) throw new Error("Unknown effect type.");
        return toolResult(tool.operation, result, json);
      }
      const selected = tool.usesProject
        ? (project ??
          options.get("--project") ??
          process.env.RAEE_PROJECT ??
          process.env.TANDEM_PROJECT)
        : undefined;
      const owner = selected == null ? undefined : await findProject(selected);
      let host;
      // Reuse the configured profile if it owns the project; otherwise connect
      // to that project's existing owner. Never create another coordinator.
      try {
        host = await discoverHost(options.get("--endpoint-file"));
        if (owner)
          await verifyProjectOwner(owner, await hostCall(host, "status", {}, extra.signal));
      } catch (error) {
        if (extra.signal.aborted || (!owner && tool.usesProject)) throw error;
        if (owner) {
          try {
            host = await discoverHost(`${owner}.api.json`);
            await verifyProjectOwner(owner, await hostCall(host, "status", {}, extra.signal));
          } catch (ownerError) {
            if (ownerError.code !== "ENOENT") throw ownerError;
            host = undefined;
          }
        }
        const key = owner ?? "library";
        let acquired = hosts.get(key);
        if ((!host || host.headless) && !acquired) {
          acquired = await acquireProjectHost(owner ? new Map([["project", owner]]) : new Map(), {
            library: !tool.usesProject,
            signal: extra.signal,
          });
          hosts.set(key, acquired);
        }
        host ??= acquired.endpoint;
      }
      const author = options.get("--author") ?? clientAuthor(server.getClientVersion()?.name);
      const exportWatching = ["export", "clip"].includes(tool.operation);
      const exportAbort = new AbortController();
      const exportWatch = exportWatching
        ? watchExportProgress(
            host,
            extra,
            extra.signal ? AbortSignal.any([extra.signal, exportAbort.signal]) : exportAbort.signal,
          )
        : undefined;
      // The done/failed message comes from the call itself, so it can't race the event stream.
      const notify = (level, data) =>
        exportWatching
          ? server.sendLoggingMessage({ level, logger: "raee", data }).catch(() => {})
          : undefined;
      let result;
      try {
        result = await hostCall(host, tool.operation, input, extra.signal, author);
      } catch (error) {
        await notify("error", `Export failed: ${error.message ?? "unknown error"}`);
        throw error;
      } finally {
        exportAbort.abort();
        await exportWatch;
      }
      await notify("info", `Export done: ${result.path ?? input.output ?? ""}`.trim());
      const output = toolResult(tool.operation, result, json);
      if (exportWatching)
        for (const item of output.content)
          if (item.type === "text") item.text = `Export done.\n${item.text}`;
      return output;
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message ?? "Host request failed." }],
      };
    }
  });
  await server.connect(new StdioServerTransport());
  process.once("SIGINT", () => void server.close());
}
main().catch((error) => {
  process.stderr.write(`raE.E MCP could not start: ${error.message}\n`);
  process.exitCode = 1;
});

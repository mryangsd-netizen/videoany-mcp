#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HOMEPAGE, getSiteOverview, readPublicPage } from "./site.js";

const server = new McpServer({
  name: "videoany",
  version: "1.0.0",
});

function ok(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

server.registerTool(
  "get_site_overview",
  {
    title: "Get site overview",
    description: `Fetch only the public homepage ${HOMEPAGE} and return its title, meta description, and up to 20 https links on videoany.ai. Does not call image or video generation APIs.`,
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    try {
      return ok(await getSiteOverview());
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  "read_public_page",
  {
    title: "Read a public page",
    description: `Read one public HTML page on ${HOMEPAGE} only. path must start with /. Any other host is rejected before a request is sent. script tags are removed and the text is capped at 4000 characters.`,
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "A path that starts with /, such as /. Absolute URLs on other hosts are rejected.",
        ),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ path }) => {
    try {
      return ok(await readPublicPage(path));
    } catch (error) {
      return fail(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

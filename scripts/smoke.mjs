import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_ORIGIN = "https://videoany.ai";
const EXPECTED_HOST = "videoany.ai";
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, "../src/index.js");

function readRejectArg(argv) {
  const index = argv.indexOf("--reject");
  if (index === -1 || !argv[index + 1]) {
    throw new Error("Usage: node scripts/smoke.mjs --reject https://other.example/");
  }
  return argv[index + 1];
}

function textOf(result) {
  return (result.content || [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function assertAllowed(result, label) {
  if (result.isError) {
    throw new Error(`${label} was rejected: ${textOf(result)}`);
  }
  return JSON.parse(textOf(result));
}

const rejectTarget = readRejectArg(process.argv.slice(2));
const rejectUrl = new URL(rejectTarget);
if (rejectUrl.hostname.toLowerCase() === EXPECTED_HOST) {
  throw new Error("--reject must be a different host");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: path.resolve(here, ".."),
  stderr: "pipe",
});
const client = new Client({ name: "videoany-mcp-smoke", version: "1.0.0" });
await client.connect(transport);

try {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  if (names.join(",") !== "get_site_overview,read_public_page") {
    throw new Error(`unexpected tools: ${names.join(",")}`);
  }

  const overview = assertAllowed(
    await client.callTool({ name: "get_site_overview", arguments: {} }),
    "get_site_overview",
  );
  if (overview.site !== `${EXPECTED_ORIGIN}/`) {
    throw new Error(`overview site mismatch: ${overview.site}`);
  }
  if (!overview.title) {
    throw new Error("homepage title is empty");
  }
  if (!Array.isArray(overview.links) || overview.links.length > 20) {
    throw new Error("links must be an array of at most 20");
  }
  for (const link of overview.links) {
    const host = new URL(link).hostname.toLowerCase();
    if (host !== EXPECTED_HOST) {
      throw new Error(`off-site link returned: ${link}`);
    }
  }

  const page = assertAllowed(
    await client.callTool({ name: "read_public_page", arguments: { path: "/" } }),
    "read_public_page /",
  );
  if (!page.url.startsWith(`${EXPECTED_ORIGIN}/`)) {
    throw new Error(`page url left the site: ${page.url}`);
  }
  if (typeof page.text !== "string" || page.text.length === 0 || page.text.length > 4000) {
    throw new Error(`page text length out of range: ${page.text?.length}`);
  }
  if (/<script\b/i.test(page.text)) {
    throw new Error("script markup leaked into page text");
  }

  const rejected = await client.callTool({
    name: "read_public_page",
    arguments: { path: rejectUrl.href },
  });
  const rejectedText = textOf(rejected);
  if (!rejected.isError || !rejectedText.includes(`Rejected host ${rejectUrl.hostname}`)) {
    throw new Error(`other host was not rejected: ${JSON.stringify(rejected)}`);
  }

  const protocolRelative = await client.callTool({
    name: "read_public_page",
    arguments: { path: `//${rejectUrl.hostname}/` },
  });
  if (!protocolRelative.isError) {
    throw new Error("protocol-relative other host was not rejected");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        site: `${EXPECTED_ORIGIN}/`,
        title: overview.title,
        descriptionLength: (overview.description || "").length,
        linkCount: overview.links.length,
        pageChars: page.text.length,
        rejectedHost: rejectUrl.hostname,
        rejectedMessage: rejectedText,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

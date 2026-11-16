# videoany.ai MCP

This is a public stdio MCP server for the adult AI image and video site at https://videoany.ai/.

It reads public HTML from that host only. It does not generate images or videos, and it does not read or write API keys.

## Tools

### get_site_overview

Fetches https://videoany.ai/ and returns the page title, the meta description, and up to 20 links that stay on `videoany.ai`.

### read_public_page

Reads one public page. `path` must start with `/`, for example `/`. Absolute URLs and protocol-relative URLs on any other host are rejected before a request is sent. `script` tags are removed. The returned text is at most 4000 characters.

## Run

Node.js 20 or newer:

```bash
npm install
node src/index.js
```

Example client config:

```json
{
  "mcpServers": {
    "videoany": {
      "command": "node",
      "args": ["/absolute/path/to/videoany-mcp/src/index.js"]
    }
  }
}
```

## Check

```bash
npm run smoke -- --reject https://example.invalid/
```

`--reject` must be a different host. The command fails if the homepage cannot be read or if that host is not rejected.

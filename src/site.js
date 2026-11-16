export const ORIGIN = "https://videoany.ai";
export const ALLOWED_HOST = "videoany.ai";
export const HOMEPAGE = "https://videoany.ai/";

const MAX_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_LINKS = 20;
const MAX_TEXT = 4000;

function isAllowedHost(hostname) {
  return hostname.toLowerCase().replace(/\.$/, "") === ALLOWED_HOST;
}

export function resolvePublicPath(path) {
  if (typeof path !== "string") {
    throw new Error("path must be a string");
  }
  const raw = path.trim();
  if (!raw) {
    throw new Error("path is required");
  }

  let candidate;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme || raw.startsWith("//")) {
    try {
      candidate = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    } catch {
      throw new Error("Invalid URL");
    }
    if (!isAllowedHost(candidate.hostname)) {
      throw new Error(
        `Rejected host ${candidate.hostname}. This server only reads ${HOMEPAGE}`,
      );
    }
  } else {
    if (!raw.startsWith("/")) {
      throw new Error("path must start with /");
    }
    if (raw.includes("\\") || raw.includes("\0")) {
      throw new Error("Rejected path");
    }
    try {
      candidate = new URL(raw, ORIGIN);
    } catch {
      throw new Error("Invalid path");
    }
  }

  if (candidate.protocol !== "https:") {
    throw new Error(`Rejected protocol ${candidate.protocol}`);
  }
  if (candidate.username || candidate.password) {
    throw new Error("Rejected credentials in URL");
  }
  if (!isAllowedHost(candidate.hostname)) {
    throw new Error(
      `Rejected host ${candidate.hostname}. This server only reads ${HOMEPAGE}`,
    );
  }

  const safe = new URL(`${candidate.pathname}${candidate.search}`, ORIGIN);
  if (!isAllowedHost(safe.hostname) || safe.origin !== ORIGIN) {
    throw new Error(
      `Rejected host ${safe.hostname}. This server only reads ${HOMEPAGE}`,
    );
  }
  return safe;
}

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function stripScripts(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
}

export function extractTitle(html) {
  const match = stripScripts(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeEntities(match[1]).replace(/\s+/g, " ").trim();
}

export function extractSameHostLinks(html, pageUrl) {
  const source = stripScripts(html);
  const links = [];
  const seen = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(source)) && links.length < MAX_LINKS) {
    const href = match[1].trim();
    if (
      !href ||
      href.startsWith("#") ||
      /^javascript:/i.test(href) ||
      /^mailto:/i.test(href) ||
      /^tel:/i.test(href) ||
      /^data:/i.test(href)
    ) {
      continue;
    }
    let absolute;
    try {
      absolute = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== "https:" || !isAllowedHost(absolute.hostname)) {
      continue;
    }
    absolute.hash = "";
    const normalized = absolute.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

export function extractDescription(html) {
  const tags = stripScripts(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!name) continue;
    const key = name[1].toLowerCase();
    if (key !== "description" && key !== "og:description") continue;
    const content = /content\s*=\s*["']([\s\S]*?)["']/i.exec(tag);
    if (!content) continue;
    const text = decodeEntities(content[1]).replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

export function htmlToText(html) {
  const stripped = stripScripts(html).replace(/<[^>]+>/g, " ");
  const text = decodeEntities(stripped).replace(/\s+/g, " ").trim();
  return text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": `videoany-mcp/1.0 (+${HOMEPAGE})`,
      },
    });
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || !isAllowedHost(finalUrl.hostname)) {
      throw new Error(
        `Rejected host ${finalUrl.hostname}. This server only reads ${HOMEPAGE}`,
      );
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${finalUrl.href}`);
    }
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new Error(`Refusing non-HTML content-type: ${type || "unknown"}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      throw new Error("Page is too large");
    }
    return {
      url: finalUrl.toString(),
      html: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Timed out fetching ${url.href ?? url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSiteOverview() {
  const page = await fetchHtml(new URL(HOMEPAGE));
  return {
    site: HOMEPAGE,
    title: extractTitle(page.html),
    description: extractDescription(page.html),
    links: extractSameHostLinks(page.html, page.url),
  };
}

export async function readPublicPage(path) {
  const url = resolvePublicPath(path);
  const page = await fetchHtml(url);
  return {
    site: HOMEPAGE,
    url: page.url,
    title: extractTitle(page.html),
    text: htmlToText(page.html),
  };
}

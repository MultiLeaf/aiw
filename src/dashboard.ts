import { createServer, type Server } from "node:http";
import { isAbsolute, join, relative, sep } from "node:path";
import type { FileSystem, Target } from "./types.js";
import { TARGETS } from "./types.js";

export type DashboardFact = { key: string; value: string; state: string; confidence: string };
export type DashboardRecommendation = { id: string; provider: string; selected: boolean };
export type DashboardTrace = {
  requirement: string;
  decisions: string[];
  tasks: string[];
  evidence: string[];
};
export type DashboardModel = {
  project: string;
  target: string;
  facts: DashboardFact[];
  recommendations: DashboardRecommendation[];
  traceability: DashboardTrace[];
};
export type DashboardCommand = (
  args: string[],
) => Promise<{ exitCode: number; output?: string; error?: string }>;
export type DashboardHandle = { url: string; close(): Promise<void> };

export function buildDashboardModel(root: string, fs: FileSystem): DashboardModel {
  const projectRoot = fs.realpath?.(root) ?? root;
  const read = (path: string): string => {
    if (!fs.exists(path)) return "";
    if (fs.pathType?.(path) === "symlink")
      throw new Error(`Dashboard input cannot be a symbolic link: ${path}`);
    const realPath = fs.realpath?.(path) ?? path;
    if (!isInside(projectRoot, realPath))
      throw new Error(`Dashboard input must stay inside the project: ${path}`);
    return fs.read(path);
  };
  const aiw = join(root, ".aiw");
  const manifest = read(join(aiw, "manifest.yml"));
  const profile = read(join(aiw, "profile.yml"));
  const recommendations = read(join(aiw, "recommendations.yml"));
  const traceability = read(join(aiw, "generated/artifacts/traceability.yml"));
  return {
    project: manifest.match(/^\s{2}name:\s*(.+)$/m)?.[1]?.trim() ?? root.split("/").at(-1) ?? root,
    target: manifest.match(/^\s{2}active:\s*(.+)$/m)?.[1]?.trim() ?? "not configured",
    facts: blocks(profile, /^\s{2}- key:\s*(.+)$/gm).map(({ heading, body }) => ({
      key: heading,
      value: field(body, "value"),
      state: field(body, "state"),
      confidence: field(body, "confidence"),
    })),
    recommendations: blocks(recommendations, /^\s{2}- id:\s*(.+)$/gm).map(({ heading, body }) => ({
      id: heading,
      provider: field(body, "provider"),
      selected: field(body, "selected") === "true",
    })),
    traceability: blocks(traceability, /^\s{2}- requirement:\s*(.+)$/gm).map(
      ({ heading, body }) => ({
        requirement: heading,
        decisions: inlineList(field(body, "decisions")),
        tasks: inlineList(field(body, "tasks")),
        evidence: inlineList(field(body, "evidence")),
      }),
    ),
  };
}

export function renderDashboard(model: DashboardModel, notice = ""): string {
  const facts = model.facts.length
    ? model.facts
        .map(
          (fact) =>
            `<tr><th>${escapeHtml(fact.key)}</th><td>${escapeHtml(fact.value)}</td><td><span class="state">${escapeHtml(fact.state)}</span></td><td>${escapeHtml(fact.confidence)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="empty">Run <code>aiw scan</code> to build the project profile.</td></tr>';
  const recommendations = model.recommendations.length
    ? model.recommendations
        .map(
          (item) =>
            `<li><span><strong>${escapeHtml(item.id)}</strong><small>${escapeHtml(item.provider)}</small></span><b class="${item.selected ? "selected" : "pending"}">${item.selected ? "Selected" : "Available"}</b></li>`,
        )
        .join("")
    : '<li class="empty">Run <code>aiw recommend</code> to see project-specific capabilities.</li>';
  const traces = model.traceability.length
    ? model.traceability
        .map(
          (link) =>
            `<article class="trace"><strong>${escapeHtml(link.requirement)}</strong><i></i><span>${escapeHtml(link.decisions.join(", ") || "No decision")}</span><i></i><span>${escapeHtml(link.tasks.join(", ") || "No task")}</span><i></i><span>${escapeHtml(link.evidence.join(", ") || "No evidence")}</span></article>`,
        )
        .join("")
    : '<p class="empty">Run <code>aiw trace</code> to connect requirements to evidence.</p>';
  const options = TARGETS.map(
    (target) =>
      `<option value="${target}"${target === model.target ? " selected" : ""}>${target}</option>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(model.project)} · AI Workflow</title><style>${styles}</style></head><body><header><p class="eyebrow">AI WORKFLOW / PROJECT CONTROL</p><h1>${escapeHtml(model.project)}</h1><div class="target">Active target <strong>${escapeHtml(model.target)}</strong></div></header><main>${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}<section><div class="section-title"><span>Profile</span><small>Confirmed project signals</small></div><div class="table-wrap"><table><thead><tr><th>Fact</th><th>Value</th><th>State</th><th>Confidence</th></tr></thead><tbody>${facts}</tbody></table></div></section><section><div class="section-title"><span>Recommendations</span><small>Capabilities matched to this repository</small></div><ul>${recommendations}</ul></section><section class="wide"><div class="section-title"><span>Traceability</span><small>Requirement → decision → task → evidence</small></div><div class="traces">${traces}</div></section><section class="wide migration"><div><div class="section-title"><span>Migration</span><small>Render neutral resources for another assistant</small></div><p>Changing target updates generated adapter files. Type <code>MIGRATE</code> to confirm.</p></div><form method="post" action="/migrate"><label>Target<select name="target">${options}</select></label><label>Confirmation<input name="confirmation" autocomplete="off" placeholder="MIGRATE" required></label><button type="submit">Migrate target</button></form></section></main><footer>Local-only dashboard · No external assets or telemetry</footer></body></html>`;
}

export async function startDashboard(
  root: string,
  fs: FileSystem,
  execute: DashboardCommand,
  port = 0,
): Promise<DashboardHandle> {
  if (!fs.exists(join(root, ".aiw/manifest.yml"))) throw new Error("Run `aiw install` first.");
  let notice = "";
  const server = createServer(async (request, response) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    const address = server.address();
    const expectedOrigin =
      address && typeof address !== "string" ? `http://127.0.0.1:${address.port}` : "";
    if (request.headers.host !== expectedOrigin.slice("http://".length)) {
      response.statusCode = 400;
      response.end("Invalid host");
      return;
    }
    if (request.method === "GET" && request.url === "/api/dashboard") {
      try {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify(buildDashboardModel(root, fs)));
      } catch {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: "Dashboard project state is unsafe or unreadable." }));
      }
      return;
    }
    if (request.method === "POST" && request.url === "/migrate") {
      try {
        if (request.headers.origin !== expectedOrigin)
          throw new Error("Migration requests must originate from this dashboard.");
        if (
          !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(
            request.headers["content-type"] ?? "",
          )
        )
          throw new Error("Migration request content type is invalid.");
        const params = parseForm(await requestBody(request));
        const target = params.target;
        if (!TARGETS.includes(target as Target) || params.confirmation !== "MIGRATE")
          throw new Error("Select a supported target and type MIGRATE to confirm.");
        const result = await execute(["target", target]);
        notice = result.output ?? result.error ?? "Migration finished.";
        if (result.exitCode !== 0) {
          renderResponse(response, 409, renderDashboard(buildDashboardModel(root, fs), notice));
          notice = "";
          return;
        }
        response.statusCode = 303;
      } catch (error) {
        notice = error instanceof Error ? error.message : String(error);
        renderResponse(response, 400, renderDashboard(buildDashboardModel(root, fs), notice));
        notice = "";
        return;
      }
      response.setHeader("Location", "/");
      response.end();
      return;
    }
    if (request.method !== "GET" || request.url !== "/") {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    try {
      response.end(renderDashboard(buildDashboardModel(root, fs), notice));
    } catch {
      response.statusCode = 500;
      response.end("Dashboard project state is unsafe or unreadable.");
    }
    notice = "";
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Dashboard address is unavailable.");
  return { url: `http://127.0.0.1:${address.port}`, close: () => closeServer(server) };
}

function blocks(content: string, expression: RegExp): Array<{ heading: string; body: string }> {
  const matches = [...content.matchAll(expression)];
  return matches.map((match, index) => ({
    heading: match[1].trim(),
    body: content.slice(match.index, matches[index + 1]?.index ?? content.length),
  }));
}

function field(block: string, name: string): string {
  return block.match(new RegExp(`^\\s{4}${name}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "unknown";
}

function inlineList(value: string): string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  const items: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of value.slice(1, -1)) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quoted) {
      current += character;
      escaped = true;
    } else if (character === '"') {
      current += character;
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      items.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  items.push(current);
  return items.map(parseInlineItem).filter(Boolean);
}

function parseInlineItem(value: string): string {
  const item = value.trim();
  if (item.startsWith('"') && item.endsWith('"')) {
    try {
      return JSON.parse(item) as string;
    } catch {
      return item.slice(1, -1);
    }
  }
  return item;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function requestBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 4096) throw new Error("Request body is too large.");
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

function parseForm(body: string): { target: string; confirmation: string } {
  const values = new Map<string, string>();
  for (const pair of body.split("&")) {
    const separator = pair.indexOf("=");
    if (!pair || separator <= 0 || separator !== pair.lastIndexOf("="))
      throw new Error("Migration request form is malformed.");
    const decode = (value: string): string => decodeURIComponent(value.replaceAll("+", " "));
    const key = decode(pair.slice(0, separator));
    const value = decode(pair.slice(separator + 1));
    if (!(["target", "confirmation"] as string[]).includes(key) || values.has(key))
      throw new Error("Migration request fields are invalid or duplicated.");
    values.set(key, value);
  }
  if (values.size !== 2 || !values.has("target") || !values.has("confirmation"))
    throw new Error("Migration request fields are incomplete.");
  return { target: values.get("target") ?? "", confirmation: values.get("confirmation") ?? "" };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function renderResponse(
  response: import("node:http").ServerResponse,
  status: number,
  html: string,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

function isInside(root: string, destination: string): boolean {
  const path = relative(root, destination);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

const styles = `:root{color-scheme:dark;--ink:#09111f;--panel:#101d30;--line:#29405d;--text:#e8f1fa;--muted:#8fa6bd;--cyan:#55d6d0;--amber:#f0b35a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#173251 0,transparent 35%),var(--ink);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}header,main,footer{max-width:1180px;margin:auto;min-width:0}header{padding:52px 24px 30px;border-bottom:1px solid var(--line);position:relative}h1{font:700 clamp(2.4rem,7vw,5.5rem)/.9 ui-monospace,SFMono-Regular,monospace;letter-spacing:-.08em;margin:.2em 0;overflow-wrap:anywhere}.eyebrow,.section-title,small,footer{color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font:600 11px/1.4 ui-monospace,monospace}.target{position:absolute;right:24px;bottom:32px}.target strong,.state{color:var(--cyan)}main{padding:28px 24px;display:grid;grid-template-columns:1.3fr .7fr;gap:18px}section{background:color-mix(in srgb,var(--panel) 88%,transparent);border:1px solid var(--line);padding:22px;min-width:0}.wide{grid-column:1/-1}.section-title{display:flex;justify-content:space-between;gap:12px;color:var(--text);margin-bottom:18px}.section-title small{color:var(--muted);text-align:right}section:not(.wide) .section-title{align-items:flex-start;flex-direction:column}section:not(.wide) .section-title small{text-align:left}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:10px;border-bottom:1px solid var(--line)}thead th{color:var(--muted);font-size:11px;text-transform:uppercase}tbody th{font-family:ui-monospace,monospace}ul{list-style:none;padding:0;margin:0}li{display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--line)}li small{display:block}.selected{color:var(--cyan)}.pending{color:var(--amber)}.trace{display:grid;grid-template-columns:auto minmax(20px,1fr) auto minmax(20px,1fr) auto minmax(20px,1fr) auto;align-items:center;gap:10px;margin:12px 0;font-family:ui-monospace,monospace}.trace>*{min-width:0;overflow-wrap:anywhere}.trace i{height:1px;background:linear-gradient(90deg,var(--cyan),var(--line));position:relative}.trace i:after{content:'›';position:absolute;right:-2px;top:-12px;color:var(--cyan)}.migration{display:flex;justify-content:space-between;gap:24px;align-items:end}.migration form{display:flex;gap:10px;align-items:end}label{color:var(--muted);font-size:12px}select,input,button{display:block;margin-top:5px;background:var(--ink);color:var(--text);border:1px solid var(--line);padding:10px 12px;font:inherit;max-width:100%}button{background:var(--cyan);color:var(--ink);font-weight:800;cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--amber);outline-offset:2px}.notice{grid-column:1/-1;border-left:3px solid var(--cyan);padding:12px 16px;background:var(--panel)}.empty{color:var(--muted)}code{font-family:ui-monospace,monospace;color:var(--cyan)}footer{padding:18px 24px 40px}@media(max-width:760px){header{padding-top:32px}.target{position:static}main{grid-template-columns:1fr}.wide{grid-column:auto}.migration,.migration form{display:grid}.trace{grid-template-columns:1fr}.trace i{width:28px}.table-wrap{overflow:auto}}@media(prefers-reduced-motion:no-preference){section{animation:enter .35s ease both}@keyframes enter{from{opacity:0;transform:translateY(8px)}}}`;

export const ORIEDITA_API_PREFIX = "/api";

type FetchLike = (request: Request) => Promise<Response>;

type DiscoveryCache = {
  source: string;
  upstream: string;
  expiresAt: number;
};

let discoveryCache: DiscoveryCache | null = null;

const ALLOWED_ROUTES = [
  { method: "GET", pattern: /^\/health$/ },
  { method: "POST", pattern: /^\/jobs$/ },
  { method: "GET", pattern: /^\/jobs\/[0-9a-f-]+$/i },
  { method: "GET", pattern: /^\/openapi\.json$/ },
  { method: "GET", pattern: /^\/v1\/oriedita\/health$/ },
  { method: "POST", pattern: /^\/v1\/oriedita\/fold$/ },
  { method: "GET", pattern: /^\/v1\/oriedita\/jobs\/[0-9a-f-]+$/i },
  { method: "OPTIONS", pattern: /^\/(?:jobs|v1\/oriedita\/(?:fold|jobs\/[0-9a-f-]+))$/i },
];

function json(status: number, payload: object) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function isOrieditaApiRequest(url: URL) {
  return url.pathname === ORIEDITA_API_PREFIX
    || url.pathname.startsWith(`${ORIEDITA_API_PREFIX}/`);
}

function validHttpsOrigin(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function resolveOrieditaUpstream(
  discoveryValue: string | undefined,
  fallbackValue: string | undefined,
  fetcher: FetchLike = fetch,
  now = Date.now(),
  force = false,
) {
  const fallback = validHttpsOrigin(fallbackValue);
  const discovery = validHttpsOrigin(discoveryValue);
  if (!discovery) return fallback ?? undefined;
  if (!force && discoveryCache?.source === discovery && discoveryCache.expiresAt > now) {
    return discoveryCache.upstream;
  }

  try {
    const registryUrl = new URL(discoveryValue!);
    registryUrl.searchParams.set("refresh", String(Math.floor(now / 10_000)));
    const response = await fetcher(new Request(registryUrl, {
      headers: {
        Accept: "application/vnd.github.raw+json, application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "ORIAI-tunnel-discovery",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }));
    if (!response.ok) throw new Error("discovery unavailable");
    const payload = await response.json() as { url?: unknown };
    const upstream = validHttpsOrigin(payload.url);
    if (!upstream) throw new Error("invalid discovery response");
    discoveryCache = { source: discovery, upstream, expiresAt: now + 60_000 };
    return upstream;
  } catch (error) {
    console.warn("ORIAI tunnel discovery failed", error instanceof Error ? error.message : String(error));
    return fallback ?? undefined;
  }
}

export async function proxyOrieditaRequest(
  request: Request,
  upstreamValue: string | undefined,
  fetcher: FetchLike = fetch,
) {
  const sourceUrl = new URL(request.url);
  const suffix = sourceUrl.pathname.slice(ORIEDITA_API_PREFIX.length) || "/health";
  const allowed = ALLOWED_ROUTES.some(({ method, pattern }) => method === request.method && pattern.test(suffix));
  if (!allowed) return json(404, { ok: false, error: "見つかりません" });

  let upstream: URL;
  try {
    upstream = new URL(upstreamValue ?? "");
    if (upstream.protocol !== "https:") throw new Error("HTTPS is required");
  } catch {
    return json(503, { ok: false, error: "Oriedita APIに接続できません" });
  }

  const target = new URL(suffix, `${upstream.origin}/`);
  target.search = sourceUrl.search;
  const headers = new Headers(request.headers);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);
  headers.delete("Host");
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  let response: Response;
  try {
    response = await fetcher(new Request(target, init));
  } catch {
    return json(503, { ok: false, error: "Oriedita APIに接続できません" });
  }

  if (suffix === "/openapi.json" && response.ok) {
    const document = await response.json() as Record<string, unknown>;
    document.servers = [{ url: `${sourceUrl.origin}${ORIEDITA_API_PREFIX}` }];
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("Content-Length");
    return Response.json(document, { status: response.status, headers: responseHeaders });
  }
  return response;
}

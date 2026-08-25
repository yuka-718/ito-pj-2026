export const ORIEDITA_API_PREFIX = "/api";

type FetchLike = (request: Request) => Promise<Response>;

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

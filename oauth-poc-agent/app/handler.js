import {
  completeAuthorization,
  createPendingAuthorization,
  disconnect,
  getConnectionStatus,
  parseAgentContext,
} from "./oauth-state.js";

function appPath(url) {
  const pathname = url.pathname.replace(/^\/app(?=\/|$)/, "") || "/";
  return pathname === "" ? "/" : pathname;
}

function html(body, status = 200) {
  return new Response(`<!doctype html>${body}`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shell(content) {
  return `<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #f7f8fa; color: #15171a; }
    main { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
    section { background: white; border: 1px solid #dde1e7; border-radius: 8px; padding: 22px; }
    h1 { font-size: 22px; line-height: 1.2; margin: 0 0 12px; }
    p { color: #4d5662; line-height: 1.5; margin: 8px 0; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; margin: 18px 0; font-size: 14px; }
    dt { color: #657180; }
    dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
    a, button { appearance: none; border: 1px solid #15171a; border-radius: 6px; background: #15171a; color: white; padding: 10px 14px; text-decoration: none; font: inherit; cursor: pointer; }
    a.secondary, button.secondary { background: white; color: #15171a; border-color: #c7ced8; }
    form { margin: 0; }
    .ok { color: #126c43; font-weight: 600; }
    .warn { color: #9a3412; font-weight: 600; }
  </style>
</head>
<body><main>${content}</main></body>
</html>`;
}

function redirect(location) {
  return new Response(null, {
    status: 303,
    headers: { location },
  });
}

function appHref(context, pathname) {
  const base = String(context.agentAppBaseUrl || "/app").replace(/\/+$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${path}`;
}

async function renderHome(request) {
  const context = parseAgentContext(request.headers);
  const status = await getConnectionStatus(context);
  const clientId = process.env.MOCK_OAUTH_CLIENT_ID || "mock-client";
  return html(shell(`<section>
    <h1>Mock OAuth Connection</h1>
    <p>This app proves the IQuly agent app OAuth shape: private app route, state, callback, and token persistence.</p>
    <dl>
      <dt>Status</dt><dd class="${status.connected ? "ok" : "warn"}">${status.connected ? "Connected" : "Not connected"}</dd>
      <dt>Provider</dt><dd>${escapeHtml(status.provider)}</dd>
      <dt>Subject</dt><dd>${escapeHtml(status.subject)}</dd>
      <dt>Client ID</dt><dd>${escapeHtml(clientId)}</dd>
      <dt>Connected At</dt><dd>${escapeHtml(status.connectedAt || "never")}</dd>
    </dl>
    <div class="actions">
      <a href="${escapeHtml(appHref(context, "/connect"))}">Connect mock account</a>
      <a class="secondary" href="${escapeHtml(appHref(context, "/status"))}">View JSON status</a>
      <form method="post" action="${escapeHtml(appHref(context, "/disconnect"))}"><button class="secondary" type="submit">Disconnect</button></form>
    </div>
  </section>`));
}

async function handleConnect(request, url) {
  const context = parseAgentContext(request.headers);
  const returnTo = url.searchParams.get("returnTo") || "/";
  const { state } = await createPendingAuthorization(context, returnTo);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.MOCK_OAUTH_CLIENT_ID || "mock-client",
    redirect_uri: "/callback",
    scope: "profile.read",
    state,
  });
  return redirect(`${appHref(context, "/mock-provider/authorize")}?${params.toString()}`);
}

function renderMockProvider(request, url) {
  const context = parseAgentContext(request.headers);
  const state = url.searchParams.get("state") || "";
  const clientId = url.searchParams.get("client_id") || "mock-client";
  return html(shell(`<section>
    <h1>Mock OAuth Provider</h1>
    <p>Approve access for the demo client. This screen simulates an external OAuth provider.</p>
    <dl>
      <dt>Client</dt><dd>${escapeHtml(clientId)}</dd>
      <dt>Scope</dt><dd>${escapeHtml(url.searchParams.get("scope") || "profile.read")}</dd>
      <dt>State</dt><dd>${escapeHtml(state)}</dd>
    </dl>
    <div class="actions">
      <a href="${escapeHtml(`${appHref(context, "/callback")}?code=mock_code&state=${encodeURIComponent(state)}`)}">Approve</a>
      <a class="secondary" href="${escapeHtml(appHref(context, "/"))}">Cancel</a>
    </div>
  </section>`));
}

async function handleCallback(request, url) {
  const context = parseAgentContext(request.headers);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const result = await completeAuthorization(context, state, code);
  if (!result.ok) {
    return html(shell(`<section>
      <h1>Connection failed</h1>
      <p>${escapeHtml(result.error)}</p>
      <div class="actions"><a href="${escapeHtml(appHref(context, "/"))}">Back</a></div>
    </section>`), 400);
  }
  return redirect(appHref(context, "/"));
}

export async function handleAgentAppRequest(request) {
  const url = new URL(request.url);
  const path = appPath(url);

  if (request.method === "GET" && path === "/") {
    return renderHome(request);
  }
  if (request.method === "GET" && path === "/connect") {
    return handleConnect(request, url);
  }
  if (request.method === "GET" && path === "/mock-provider/authorize") {
    return renderMockProvider(request, url);
  }
  if (request.method === "GET" && path === "/callback") {
    return handleCallback(request, url);
  }
  if (request.method === "GET" && path === "/status") {
    return Response.json(await getConnectionStatus(parseAgentContext(request.headers)));
  }
  if (request.method === "POST" && path === "/disconnect") {
    const context = parseAgentContext(request.headers);
    await disconnect(context);
    return redirect(appHref(context, "/"));
  }

  return Response.json({ ok: false, error: "Not found" }, { status: 404 });
}

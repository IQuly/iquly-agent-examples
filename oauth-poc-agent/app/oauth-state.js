import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function stateFilePath() {
  const stateRoot = process.env.STATE_ROOT || process.cwd();
  return path.join(stateRoot, "oauth-poc", "session.json");
}

export function parseAgentContext(headers) {
  const payload = headers.get("x-iquly-agent-context");
  if (!payload) {
    return {};
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export function resolveSubject(context = {}) {
  return String(context.userId || context.workspaceId || process.env.WORKSPACE_ID || "local");
}

export async function readStore() {
  try {
    return JSON.parse(await readFile(stateFilePath(), "utf8"));
  } catch {
    return { pending: {}, tokens: {} };
  }
}

export async function writeStore(store) {
  const targetPath = stateFilePath();
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function createPlatformHandoff(targetPath, returnTo = null) {
  const baseUrl = `http://127.0.0.1:${process.env.PORT || "3001"}`;
  const token = process.env.IQULY_RUNTIME_CAPABILITY_TOKEN || "";
  const response = await fetch(`${baseUrl}/capabilities/external-ingress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-iquly-runtime-capability-token": token,
    },
    body: JSON.stringify({
      mode: "handoff",
      targetPath,
      returnTo,
      methods: ["GET"],
      singleUse: true,
      expiresInSeconds: 600,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create external ingress: ${response.status}`);
  }
  return response.json();
}

export async function completeAuthorization(context, code) {
  const store = await readStore();
  const subject = resolveSubject(context);
  if (!context.ingressId) {
    return { ok: false, error: "Invalid or expired OAuth state" };
  }

  const now = new Date().toISOString();
  store.tokens[subject] = {
    provider: "mock-oauth",
    accessToken: `mock_access_${code || "code"}_${crypto.randomUUID()}`,
    scope: "profile.read",
    connectedAt: now,
    userEmail: context.userEmail || null,
  };
  await writeStore(store);
  return { ok: true, token: store.tokens[subject] };
}

export async function getConnectionStatus(context = {}) {
  const store = await readStore();
  const subject = resolveSubject(context);
  const token = store.tokens[subject] || null;
  const status = {
    connected: Boolean(token),
    provider: token?.provider || "mock-oauth",
    subject,
  };
  if (token?.connectedAt) {
    status.connectedAt = token.connectedAt;
  }
  const userEmail = token?.userEmail || context.userEmail;
  if (userEmail) {
    status.userEmail = userEmail;
  }
  return status;
}

export async function disconnect(context = {}) {
  const store = await readStore();
  const subject = resolveSubject(context);
  delete store.tokens[subject];
  await writeStore(store);
  return { connected: false, subject };
}

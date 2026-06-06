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

export async function createPendingAuthorization(context, returnTo = "/") {
  const store = await readStore();
  const subject = resolveSubject(context);
  const state = crypto.randomUUID();
  store.pending[state] = {
    subject,
    returnTo,
    createdAt: new Date().toISOString(),
  };
  await writeStore(store);
  return { state, subject };
}

export async function completeAuthorization(context, state, code) {
  const store = await readStore();
  const pending = store.pending[state];
  const subject = resolveSubject(context);
  if (!pending || pending.subject !== subject) {
    return { ok: false, error: "Invalid or expired OAuth state" };
  }

  delete store.pending[state];
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

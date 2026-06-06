import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleAgentAppRequest } from "../app/handler.js";
import { getConnectionStatus } from "../app/oauth-state.js";

let tempRoot;

function contextHeaders(context = {}) {
  const payload = Buffer.from(JSON.stringify({
    userId: "user_oauth_test",
    userEmail: "oauth-test@example.com",
    workspaceId: "workspace_oauth_test",
    agentAppBaseUrl: "/app",
    ...context,
  }), "utf8").toString("base64url");
  return { "x-iquly-agent-context": payload };
}

async function runTool(relativePath, input = {}) {
  const proc = Bun.spawn(["bun", relativePath], {
    cwd: path.resolve(import.meta.dir, ".."),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(`${JSON.stringify(input)}\n`);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr || `Tool exited with ${exitCode}`);
  }
  return JSON.parse(stdout);
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "oauth-poc-agent-test-"));
  process.env.STATE_ROOT = tempRoot;
  process.env.PACKAGE_ROOT = path.resolve(import.meta.dir, "..");
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
  delete process.env.STATE_ROOT;
  delete process.env.PACKAGE_ROOT;
});

describe("oauth poc agent", () => {
  test("connect and callback persist a mock token", async () => {
    const headers = contextHeaders();
    const before = await handleAgentAppRequest(new Request("http://runtime.test/app/status", { headers }));
    expect(await before.json()).toMatchObject({ connected: false, subject: "user_oauth_test" });

    const connect = await handleAgentAppRequest(new Request("http://runtime.test/app/connect", { headers }));
    expect(connect.status).toBe(303);
    const authorizeLocation = connect.headers.get("location");
    expect(authorizeLocation).toContain("/app/mock-provider/authorize");

    const authorizeUrl = new URL(authorizeLocation, "http://runtime.test");
    const state = authorizeUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await handleAgentAppRequest(
      new Request(`http://runtime.test/app/callback?code=mock_code&state=${encodeURIComponent(state)}`, {
        headers,
      }),
    );
    expect(callback.status).toBe(303);

    const after = await getConnectionStatus({
      userId: "user_oauth_test",
      userEmail: "oauth-test@example.com",
      workspaceId: "workspace_oauth_test",
    });
    expect(after).toMatchObject({
      connected: true,
      provider: "mock-oauth",
      subject: "user_oauth_test",
      userEmail: "oauth-test@example.com",
    });
  });

  test("rejects callbacks with invalid state", async () => {
    const response = await handleAgentAppRequest(
      new Request("http://runtime.test/app/callback?code=mock_code&state=missing", {
        headers: contextHeaders(),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid or expired OAuth state");
  });

  test("connect card emits an agent app artifact descriptor", async () => {
    const output = await runTool("tools/oauth-connect-card/run.js");
    expect(output).toMatchObject({
      status: "auth_required",
      chatRender: {
        kind: "artifact",
        source: {
          type: "agentApp",
          path: "/",
        },
      },
    });
  });
});

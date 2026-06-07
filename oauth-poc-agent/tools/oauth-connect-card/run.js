await new Response(Bun.stdin.stream()).text();

async function appSessionUrl() {
  if (process.env.IQULY_AGENT_APP_SESSION_URL) {
    return process.env.IQULY_AGENT_APP_SESSION_URL;
  }
  const token = process.env.IQULY_RUNTIME_CAPABILITY_TOKEN || "";
  if (!token) {
    return "/app/session-local";
  }
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || "3001"}/capabilities/external-ingress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-iquly-runtime-capability-token": token,
    },
    body: JSON.stringify({
      mode: "app_session",
      targetPath: "/",
      methods: ["GET", "POST"],
      expiresInSeconds: 3600,
      singleUse: false,
    }),
  });
  if (!response.ok) {
    return "/app/session-local";
  }
  const payload = await response.json();
  return payload.appSessionUrl || "/app/session-local";
}

process.stdout.write(JSON.stringify({
  status: "auth_required",
  message: "Open the mock OAuth connection panel.",
  chatRender: {
    kind: "agentApp",
    title: "Connect mock OAuth account",
    description: "Runs the OAuth POC inside the agent app iframe.",
    presentation: "panel",
    url: await appSessionUrl(),
  },
}));

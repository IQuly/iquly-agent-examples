await new Response(Bun.stdin.stream()).text();

process.stdout.write(JSON.stringify({
  status: "auth_required",
  message: "Open the mock OAuth connection panel.",
  chatRender: {
    kind: "artifact",
    title: "Connect mock OAuth account",
    description: "Runs the OAuth POC inside the agent app iframe.",
    preferredSize: "panel",
    source: {
      type: "agentApp",
      path: "/",
    },
  },
}));

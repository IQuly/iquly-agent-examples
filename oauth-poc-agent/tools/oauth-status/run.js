import { getConnectionStatus } from "../../app/oauth-state.js";

await new Response(Bun.stdin.stream()).text();

const status = await getConnectionStatus({});
process.stdout.write(JSON.stringify(status));

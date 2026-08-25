import pkg from "@/../package.json";

// The version field is what lets the updater sidecar verify that a restart
// actually landed on the target release (a bare 200 proves nothing).
export async function GET() {
  return Response.json({ status: "ok", version: pkg.version });
}

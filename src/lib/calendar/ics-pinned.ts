import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * GET a URL while connecting to a pre-resolved public IP (SNI/Host stay on
 * the original hostname) so DNS cannot rebind between allowlist and connect.
 */
export function fetchPinned(
  url: URL,
  ip: string,
  redirect: "manual" | "error",
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const family = net.isIP(ip) === 6 ? 6 : 4;
    const req = lib.request(
      {
        host: ip,
        servername: url.hostname,
        port: Number(url.port) || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Host: url.host,
          "User-Agent": "KurirMail/1.0 ICS",
          ...extraHeaders,
        },
        lookup: (_hostname, _options, cb) => {
          cb(null, ip, family);
        },
        timeout: 10_000,
      },
      (res) => {
        if (
          redirect === "error" &&
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400
        ) {
          req.destroy();
          reject(new Error("redirect"));
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            res.on("data", (chunk: Buffer) => {
              controller.enqueue(new Uint8Array(chunk));
            });
            res.on("end", () => controller.close());
            res.on("error", (err) => controller.error(err));
          },
        });
        resolve(
          new Response(stream, {
            status: res.statusCode ?? 502,
            headers,
          }),
        );
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

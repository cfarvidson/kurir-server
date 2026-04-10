#!/usr/bin/env python3
"""
Kurir companion updater.

Runs alongside the Kurir app container with /var/run/docker.sock and the
install directory bind-mounted at /workdir. The Next.js app calls POST /apply
or /rollback on this service; we run `docker compose pull && up -d app` from
outside the app container (so restarting the app doesn't kill us) and stream
status back to /api/admin/updates/status on the app.
"""

import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

APP_URL = os.environ.get("APP_URL", "http://app:3000")
UPDATER_TOKEN = os.environ.get("UPDATER_TOKEN", "")
WORKDIR = os.environ.get("WORKDIR", "/workdir")
COMPOSE_FILE = os.environ.get("COMPOSE_FILE", "docker-compose.yml")
APP_SERVICE = os.environ.get("APP_SERVICE", "app")
SKIP_PULL = os.environ.get("SKIP_PULL", "").lower() in ("1", "true", "yes")
MAX_HEALTH_ATTEMPTS = int(os.environ.get("MAX_HEALTH_ATTEMPTS", "24"))
HEALTH_INTERVAL = int(os.environ.get("HEALTH_INTERVAL_SECONDS", "5"))
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8080"))

HEALTH_ENDPOINT = f"{APP_URL}/api/up"
STATUS_ENDPOINT = f"{APP_URL}/api/admin/updates/status"

_state_lock = threading.Lock()
_current_log_id: str | None = None


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] {msg}", flush=True)


def report_status(log_id: str, status: str, error: str | None = None) -> None:
    """Best-effort callback into the Next.js app to update UpdateLog."""
    if not log_id:
        return
    payload = json.dumps({"logId": log_id, "status": status, "error": error}).encode()
    req = urllib.request.Request(
        STATUS_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Updater-Token": UPDATER_TOKEN,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except Exception as exc:
        log(f"report_status({status}) failed: {exc}")


def run_compose(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    cmd = ["docker", "compose", "-f", COMPOSE_FILE, *args]
    log("$ " + " ".join(cmd))
    result = subprocess.run(
        cmd,
        cwd=WORKDIR,
        capture_output=True,
        text=True,
    )
    if result.stdout:
        for line in result.stdout.rstrip().splitlines():
            log(f"  {line}")
    if result.returncode != 0:
        if result.stderr:
            for line in result.stderr.rstrip().splitlines():
                log(f"  ! {line}")
        if check:
            raise RuntimeError(
                f"{' '.join(cmd)} exited {result.returncode}: "
                f"{result.stderr.strip() or 'no stderr'}"
            )
    return result


def current_app_image() -> str | None:
    """Return the currently-running app image ref, or None if undetectable."""
    try:
        result = subprocess.run(
            ["docker", "compose", "-f", COMPOSE_FILE, "images", APP_SERVICE, "--format", "json"],
            cwd=WORKDIR,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        raw = result.stdout.strip()
        # docker compose images --format json returns either:
        #   - a JSON array: [{"Repository":…}]
        #   - NDJSON (one object per line): {"Repository":…}\n{"Repository":…}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # Try NDJSON — take the first line
            first_line = raw.splitlines()[0]
            data = json.loads(first_line)
        if isinstance(data, list):
            if not data:
                return None
            entry = data[0]
        else:
            entry = data
        repo = entry.get("Repository") or ""
        tag = entry.get("Tag") or ""
        if not repo or not tag:
            return None
        return f"{repo}:{tag}"
    except Exception as exc:
        log(f"current_app_image failed: {exc}")
        return None


def tag_rollback() -> str | None:
    image = current_app_image()
    if not image:
        log("could not determine current image — rollback will be unavailable")
        return None
    log(f"tagging rollback image: {image} -> kurir-server:rollback")
    subprocess.run(
        ["docker", "tag", image, "kurir-server:rollback"],
        check=False,
    )
    return image


def restore_rollback(previous_image: str) -> None:
    log(f"restoring rollback image: kurir-server:rollback -> {previous_image}")
    subprocess.run(
        ["docker", "tag", "kurir-server:rollback", previous_image],
        check=False,
    )


def wait_healthy() -> bool:
    for attempt in range(1, MAX_HEALTH_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(HEALTH_ENDPOINT, timeout=5) as resp:
                if 200 <= resp.status < 300:
                    log(f"health check passed on attempt {attempt}")
                    return True
        except Exception as exc:
            log(f"health attempt {attempt}/{MAX_HEALTH_ATTEMPTS}: {exc}")
        time.sleep(HEALTH_INTERVAL)
    return False


def do_update(log_id: str, rollback: bool) -> None:
    global _current_log_id
    try:
        log(f"=== {'rollback' if rollback else 'update'} starting (logId={log_id}) ===")
        report_status(log_id, "pulling")

        previous = tag_rollback()

        if rollback:
            if not previous:
                raise RuntimeError("rollback requested but no previous image to restore")
            # Point the compose ref at the rollback-tagged image so `up -d` uses it.
            restore_rollback(previous)
        elif SKIP_PULL:
            log("SKIP_PULL set — skipping docker compose pull")
        else:
            run_compose("pull", APP_SERVICE)

        report_status(log_id, "restarting")
        run_compose("up", "-d", APP_SERVICE)

        report_status(log_id, "verifying")
        time.sleep(5)  # give the container a moment to bind :3000

        if wait_healthy():
            report_status(log_id, "success")
            log("=== update succeeded ===")
            return

        # Health failed — attempt automatic rollback if we have a previous image
        log("health check failed; attempting automatic rollback")
        if previous and not rollback:
            try:
                restore_rollback(previous)
                run_compose("up", "-d", APP_SERVICE, check=False)
            except Exception as exc:
                log(f"rollback-on-failure errored: {exc}")
        report_status(
            log_id,
            "rolled_back" if previous else "failed",
            error=f"health check failed after {MAX_HEALTH_ATTEMPTS} attempts",
        )
        log("=== update failed ===")
    except Exception as exc:
        log(f"update errored: {exc}")
        report_status(log_id, "failed", error=str(exc))
    finally:
        with _state_lock:
            if _current_log_id == log_id:
                _current_log_id = None


class Handler(BaseHTTPRequestHandler):
    # Silence the default stderr access logger; we use our own
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        log(f"{self.address_string()} - {format % args}")

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _auth_ok(self) -> bool:
        if not UPDATER_TOKEN:
            return False
        token = self.headers.get("X-Updater-Token", "")
        return token == UPDATER_TOKEN

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        global _current_log_id
        if self.path not in ("/apply", "/rollback"):
            self._send(404, {"error": "not found"})
            return
        if not self._auth_ok():
            self._send(401, {"error": "unauthorized"})
            return

        body = self._read_json()
        log_id = body.get("logId")
        if not isinstance(log_id, str) or not log_id:
            self._send(400, {"error": "missing logId"})
            return

        with _state_lock:
            if _current_log_id is not None:
                self._send(
                    409,
                    {"error": f"update already in progress: {_current_log_id}"},
                )
                return
            _current_log_id = log_id

        rollback = self.path == "/rollback"
        threading.Thread(
            target=do_update, args=(log_id, rollback), daemon=True
        ).start()
        self._send(202, {"accepted": True, "logId": log_id, "rollback": rollback})


def main() -> None:
    if not UPDATER_TOKEN:
        log("FATAL: UPDATER_TOKEN is not set — refusing to start")
        sys.exit(1)
    log(
        f"kurir-updater listening on :{LISTEN_PORT} "
        f"(workdir={WORKDIR}, compose={COMPOSE_FILE}, service={APP_SERVICE}, "
        f"app_url={APP_URL}, skip_pull={SKIP_PULL})"
    )
    HTTPServer(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

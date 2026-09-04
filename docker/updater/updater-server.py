#!/usr/bin/env python3
"""
Kurir companion updater.

Runs alongside the Kurir app container with /var/run/docker.sock and the
install directory bind-mounted at /workdir. The Next.js app calls POST /apply
or /rollback on this service; we run `docker compose pull && up -d app` from
outside the app container (so restarting the app doesn't kill us) and stream
status back to /api/admin/updates/status on the app.
"""

import hmac
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

# Bumped when the updater gains capabilities the app depends on. The app
# refuses to start updates against a sidecar older than it requires and
# shows the operator how to refresh it.
#   2 = pull_pinned (imageRef pinning) + running-version verification
PROTOCOL_VERSION = 2

APP_URL = os.environ.get("KURIR_INTERNAL_URL", "http://app:3000")
UPDATER_TOKEN = os.environ.get("UPDATER_TOKEN", "")
WORKDIR = os.environ.get("WORKDIR", "/workdir")
COMPOSE_FILE = os.environ.get("COMPOSE_FILE", "docker-compose.yml")
APP_SERVICE = os.environ.get("APP_SERVICE", "app")
UPDATER_SERVICE = os.environ.get("UPDATER_SERVICE", "updater")
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


def _compose_env() -> dict[str, str]:
    """Build a clean env for docker compose — only PATH and HOME.

    Docker compose inherits the caller's environment and uses it to
    interpolate ${VAR} in the compose file, with shell env taking
    precedence over .env file values. We must NOT leak the updater's own
    vars (like the old APP_URL) into the app container's environment.
    """
    clean = {"PATH": os.environ.get("PATH", "/usr/bin:/usr/local/bin"), "HOME": "/root"}
    # Pass through DOCKER_HOST if set (e.g. remote docker daemons)
    if os.environ.get("DOCKER_HOST"):
        clean["DOCKER_HOST"] = os.environ["DOCKER_HOST"]
    return clean


def run_compose(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    cmd = ["docker", "compose", "-f", COMPOSE_FILE, *args]
    log("$ " + " ".join(cmd))
    result = subprocess.run(
        cmd,
        cwd=WORKDIR,
        capture_output=True,
        text=True,
        env=_compose_env(),
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
            env=_compose_env(),
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


def compose_image_ref() -> str | None:
    """Return the image ref the compose file configures for the app service.

    (`config --images SERVICE` does not filter by service on all compose
    versions, so parse the full JSON config instead.)
    """
    result = subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, "config", "--format", "json"],
        cwd=WORKDIR,
        capture_output=True,
        text=True,
        check=False,
        env=_compose_env(),
    )
    if result.returncode != 0:
        return None
    try:
        config = json.loads(result.stdout)
        image = config["services"][APP_SERVICE].get("image")
        return image if isinstance(image, str) and image else None
    except Exception as exc:
        log(f"compose_image_ref failed: {exc}")
        return None


def pull_pinned(image_ref: str) -> None:
    """Pull the exact release image and point the compose ref at it.

    Pulling the compose file's own tag (`:latest`) races the release
    pipeline: a pre-release main build can sit there before the tag build
    finishes. Pulling the pinned ref either gets exactly the announced
    release or fails cleanly (image not published yet).
    """
    log(f"pulling pinned release image {image_ref}")
    result = subprocess.run(
        ["docker", "pull", image_ref], capture_output=True, text=True, check=False
    )
    if result.stdout:
        for line in result.stdout.rstrip().splitlines():
            log(f"  {line}")
    if result.returncode != 0:
        raise RuntimeError(
            f"failed to pull {image_ref} — the release image may not be "
            f"published yet; try again in a few minutes "
            f"({result.stderr.strip() or 'no stderr'})"
        )
    ref = compose_image_ref() or current_app_image()
    if ref and ref != image_ref:
        log(f"tagging {image_ref} -> {ref}")
        subprocess.run(["docker", "tag", image_ref, ref], check=True)


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


def fetch_app_version() -> str | None:
    """Return the version reported by the running app's /api/up, or None."""
    try:
        with urllib.request.urlopen(HEALTH_ENDPOINT, timeout=5) as resp:
            body = json.loads(resp.read())
            version = body.get("version")
            return version if isinstance(version, str) and version else None
    except Exception as exc:
        log(f"fetch_app_version failed: {exc}")
        return None


def refresh_updater_image() -> None:
    """Best-effort pull of the updater's own image after a successful update.

    Only pulls — recreating our own container from inside it would kill the
    compose client mid-recreate and can leave the updater stopped. The
    operator (or the app's Admin warning) runs
    `docker compose up -d updater` to actually swap to the pulled image.
    """
    try:
        log("refreshing updater image (pull only; recreate is up to the operator)")
        run_compose("pull", UPDATER_SERVICE, check=False)
    except Exception as exc:
        log(f"refresh_updater_image failed: {exc}")


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


def do_update(
    log_id: str,
    rollback: bool,
    image_ref: str | None = None,
    to_version: str | None = None,
) -> None:
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
        elif image_ref:
            pull_pinned(image_ref)
        else:
            # Older app versions don't send imageRef — fall back to pulling
            # whatever the compose file references (`:latest`).
            run_compose("pull", APP_SERVICE)

        report_status(log_id, "restarting")
        run_compose("up", "-d", APP_SERVICE)

        report_status(log_id, "verifying")
        time.sleep(5)  # give the container a moment to bind :3000

        if wait_healthy():
            # A 200 from /api/up only proves *something* is running — verify
            # the running version actually matches the target before claiming
            # success (a stale image can restart into the old code).
            running = fetch_app_version() if to_version else None
            if to_version and running != to_version and not (rollback and running is None):
                # On rollback a missing version is tolerated: the previous
                # release may predate the /api/up version field. On update the
                # target always reports a version, so missing == old code.
                mismatch = (
                    f"version mismatch after restart: running "
                    f"{running or 'unknown'}, expected {to_version}"
                )
                log(mismatch + "; attempting automatic rollback")
                if previous and not rollback:
                    try:
                        restore_rollback(previous)
                        run_compose("up", "-d", APP_SERVICE, check=False)
                    except Exception as exc:
                        log(f"rollback-on-failure errored: {exc}")
                report_status(log_id, "failed", error=mismatch)
                log("=== update failed ===")
                return

            report_status(log_id, "success")
            log("=== update succeeded ===")
            if not rollback:
                refresh_updater_image()
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
        a = token.encode("utf-8")
        b = UPDATER_TOKEN.encode("utf-8")
        if len(a) != len(b):
            return False
        return hmac.compare_digest(a, b)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "protocolVersion": PROTOCOL_VERSION})
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

        image_ref = body.get("imageRef")
        if not isinstance(image_ref, str) or not image_ref:
            image_ref = None

        to_version = body.get("toVersion")
        if not isinstance(to_version, str) or not to_version:
            to_version = None

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
            target=do_update,
            args=(log_id, rollback, image_ref, to_version),
            daemon=True,
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

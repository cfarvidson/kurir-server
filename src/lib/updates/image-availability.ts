/**
 * Is the release image actually pullable yet?
 *
 * latest.json is committed by the release script minutes before
 * docker-publish.yml finishes the multi-arch manifest, so "update available"
 * used to run ahead of the registry and the sidecar's `docker pull` failed.
 * A HEAD on the manifest endpoint only succeeds once the manifest list is
 * pushed, which is exactly when the pull would succeed.
 */

const TIMEOUT_MS = 5_000;

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/** `ghcr.io/<name>:<tag>`; anything else is not ours to probe. */
export function parseGhcrRef(
  imageRef: string,
): { name: string; tag: string } | null {
  const match = /^ghcr\.io\/([a-z0-9][a-z0-9._/-]*):([A-Za-z0-9._-]+)$/.exec(
    imageRef,
  );
  if (!match) return null;
  return { name: match[1], tag: match[2] };
}

/**
 * Resolves true when the tag exists in ghcr, false on a 404. Throws on
 * anything else (network, timeout, unexpected status) so callers can keep
 * their previous answer instead of flipping a verified image to "pending".
 *
 * Non-ghcr references (self-hosters pointing latest.json at a mirror) resolve
 * true without a network call; the pull itself is still the final arbiter.
 */
export async function checkImageExists(imageRef: string): Promise<boolean> {
  const ref = parseGhcrRef(imageRef);
  if (!ref) {
    console.log(
      `[image-availability] ${imageRef} is not a ghcr.io tag; skipping registry check`,
    );
    return true;
  }

  const tokenRes = await fetch(
    `https://ghcr.io/token?scope=repository:${ref.name}:pull`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!tokenRes.ok) {
    throw new Error(`ghcr token request failed: ${tokenRes.status}`);
  }
  const { token } = (await tokenRes.json()) as { token?: string };
  if (!token) {
    throw new Error("ghcr token response had no token");
  }

  const res = await fetch(
    `https://ghcr.io/v2/${ref.name}/manifests/${ref.tag}`,
    {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`ghcr manifest check failed: ${res.status}`);
}

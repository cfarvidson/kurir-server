/**
 * The user's effective remote-image policy, modeled as a clean tri-state so the
 * rest of the app never has to reason about the two underlying boolean columns
 * (`User.blockRemoteImages` + `User.blockTrackers`) directly.
 *
 *  - BLOCK_ALL       Strip every remote image (the Hey-style default).
 *  - BLOCK_TRACKERS  Load ordinary images (proxied) but strip known trackers and
 *                    invisible spy pixels.
 *  - ALLOW_ALL       Proxy every remote image, no tracker filtering.
 *
 * The dead combination `blockRemoteImages=true` + `blockTrackers=false` is never
 * written by the UI and is collapsed to BLOCK_ALL here, so the awkwardness of
 * two booleans lives in exactly one place.
 */

export type RemoteImagePolicy = "BLOCK_ALL" | "BLOCK_TRACKERS" | "ALLOW_ALL";

export interface ImagePolicyFlags {
  blockRemoteImages: boolean;
  blockTrackers: boolean;
}

/** Map the two persisted booleans to the effective tri-state policy. */
export function resolveImagePolicy(flags: ImagePolicyFlags): RemoteImagePolicy {
  if (flags.blockRemoteImages) return "BLOCK_ALL";
  return flags.blockTrackers ? "BLOCK_TRACKERS" : "ALLOW_ALL";
}

/** Map a chosen policy back to the booleans persisted on the User row. */
export function imagePolicyToFlags(policy: RemoteImagePolicy): ImagePolicyFlags {
  switch (policy) {
    case "BLOCK_ALL":
      return { blockRemoteImages: true, blockTrackers: true };
    case "BLOCK_TRACKERS":
      return { blockRemoteImages: false, blockTrackers: true };
    case "ALLOW_ALL":
      return { blockRemoteImages: false, blockTrackers: false };
  }
}

/**
 * Resolve the effective policy for a single message from the user's global
 * policy plus per-message overrides. Your own outbound messages, senders you've
 * explicitly trusted, and messages where you clicked "Load images" always load
 * everything (your own images can't track you; trust is explicit). Otherwise
 * the global policy applies. This is the privacy gate for every rendered body.
 */
export function resolveEffectiveMessagePolicy(args: {
  globalPolicy: RemoteImagePolicy;
  isFromCurrentUser: boolean;
  senderAllowsRemoteImages: boolean;
  imagesRevealed: boolean;
}): RemoteImagePolicy {
  if (
    args.isFromCurrentUser ||
    args.senderAllowsRemoteImages ||
    args.imagesRevealed
  ) {
    return "ALLOW_ALL";
  }
  return args.globalPolicy;
}

/**
 * Translate an effective policy into the sanitizer flags for a single message.
 * `blockRemoteImages` strips everything; `blockTrackers` strips only detected
 * trackers while other remote images are proxied.
 */
export function imagePolicyToSanitizeFlags(policy: RemoteImagePolicy): {
  blockRemoteImages: boolean;
  blockTrackers: boolean;
} {
  switch (policy) {
    case "BLOCK_ALL":
      return { blockRemoteImages: true, blockTrackers: false };
    case "BLOCK_TRACKERS":
      return { blockRemoteImages: false, blockTrackers: true };
    case "ALLOW_ALL":
      return { blockRemoteImages: false, blockTrackers: false };
  }
}

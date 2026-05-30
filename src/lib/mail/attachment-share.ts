/**
 * Shared "hand this attachment off to the OS" logic used by both the attachment
 * chips (AttachmentList) and the lightbox (AttachmentViewer). Fetches the bytes,
 * then either invokes the Web Share sheet or opens the file in a new tab.
 *
 * Kept in one place so the two call sites cannot diverge (they previously had
 * subtly different fallback behaviour).
 */

/** Whether this browser can share files via the Web Share API. */
export function canShareFiles(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

/**
 * Fetch an attachment and share it (Web Share API) or open it in a new tab.
 *
 * Pass an `AbortSignal` so an in-flight request can be cancelled when the user
 * switches to a different attachment — otherwise a stale fetch could resolve and
 * share the *previous* file.
 */
export async function shareOrOpenAttachment(
  id: string,
  filename: string,
  contentType: string,
  signal?: AbortSignal,
): Promise<void> {
  const apiUrl = `/api/attachments/${id}`;
  const res = await fetch(apiUrl, { signal });
  if (!res.ok) throw new Error(`Failed to load attachment (${res.status})`);
  const blob = await res.blob();
  if (signal?.aborted) return;

  const file = new File([blob], filename, {
    type: blob.type || contentType || "application/octet-stream",
  });

  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return;
  }

  // No file sharing — open the blob in a new tab so the browser can preview/save.
  const objectUrl = URL.createObjectURL(blob);
  const win = window.open(objectUrl, "_blank");
  if (win) {
    // Revoke once the new tab has had time to load.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } else {
    // Popup blocked: don't leak the object URL — revoke now and navigate
    // directly to the attachment as a last-ditch fallback.
    URL.revokeObjectURL(objectUrl);
    window.location.href = apiUrl;
  }
}

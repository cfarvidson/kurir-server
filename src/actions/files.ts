"use server";

import { auth } from "@/lib/auth";
import { getFiles, type GetFilesOptions } from "@/lib/mail/files";

/**
 * Load a page of the current user's attachments. Used by the Files library's
 * "Load more" button. Read-only — no mutation, no revalidation.
 */
export async function loadMoreFiles(options: GetFilesOptions) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const result = await getFiles(session.user.id, options);
  return result ?? { files: [], nextCursor: null };
}

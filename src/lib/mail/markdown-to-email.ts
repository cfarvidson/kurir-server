import { marked } from "marked";

// Configure marked for GFM
marked.setOptions({ gfm: true, breaks: true });

const EMAIL_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 16px; }
  p { margin: 0 0 1em; }
  h1 { font-size: 1.5em; margin: 1em 0 0.5em; }
  h2 { font-size: 1.3em; margin: 1em 0 0.5em; }
  h3 { font-size: 1.1em; margin: 1em 0 0.5em; }
  a { color: #2563eb; }
  code { background: #f3f4f6; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d1d5db; margin: 0 0 1em; padding: 0 0 0 12px; color: #6b7280; }
  table { border-collapse: collapse; margin: 0 0 1em; }
  th, td { border: 1px solid #d1d5db; padding: 6px 12px; text-align: left; }
  th { background: #f9fafb; font-weight: 600; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  ul, ol { margin: 0 0 1em; padding-left: 2em; }
  li { margin: 0 0 0.25em; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
`;

function wrapInBoilerplate(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${EMAIL_STYLES}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

interface ConvertResult {
  /** HTML for display in Kurir (images use /api/attachments/{id} URLs) */
  displayHtml: string;
  /** HTML for sending via email (images use cid: URLs) */
  emailHtml: string;
  /** Attachment IDs referenced as inline images (need CID embedding) */
  inlineImageIds: string[];
}

/**
 * Convert markdown to HTML in two variants:
 *
 * - displayHtml: for rendering in Kurir's thread view (images as /api/attachments/{id})
 * - emailHtml: for sending via SMTP (images as cid:{id}@kurir)
 */
export function convertMarkdownToEmailHtml(markdown: string): ConvertResult {
  const rawHtml = marked.parse(markdown) as string;

  // Extract inline image attachment IDs and build CID version
  const inlineImageIds: string[] = [];
  const cidHtml = rawHtml.replace(
    /src="\/api\/attachments\/([a-zA-Z0-9_-]+)"/g,
    (_match, id) => {
      if (!inlineImageIds.includes(id)) {
        inlineImageIds.push(id);
      }
      return `src="cid:${id}@kurir"`;
    },
  );

  return {
    displayHtml: wrapInBoilerplate(rawHtml),
    emailHtml: wrapInBoilerplate(cidHtml),
    inlineImageIds,
  };
}

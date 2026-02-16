/**
 * Split a plain-text email body into original content and trailing quoted text.
 * Only collapses trailing > blocks (not interleaved inline replies).
 */
export function splitPlainTextQuotes(text: string): {
  body: string;
  quoted: string | null;
} {
  const lines = text.split("\n");
  let quoteStart = lines.length;

  // Walk backwards to find the start of trailing > block (including blank lines)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(">") || lines[i].trim() === "") {
      quoteStart = i;
    } else {
      break;
    }
  }

  // Verify at least one line actually starts with >
  if (!lines.slice(quoteStart).some((l) => l.startsWith(">"))) {
    return { body: text, quoted: null };
  }

  // If entire body is quoted, bail out — nothing to collapse
  if (quoteStart === 0) return { body: text, quoted: null };

  // Check for attribution line ("On ... wrote:") just before the > block
  if (quoteStart > 0 && /^On .+ wrote:\s*$/.test(lines[quoteStart - 1])) {
    quoteStart--;
  }

  const body = lines.slice(0, quoteStart).join("\n").trimEnd();
  const quoted = lines.slice(quoteStart).join("\n");

  return { body, quoted };
}

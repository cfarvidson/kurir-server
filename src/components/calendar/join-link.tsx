import type { MouseEventHandler } from "react";

/**
 * "Join" on a meeting with a link: the one button for it, in the Next up
 * card and on a day's rows. A frame in the app tint.
 */
export function JoinLink({
  href,
  onClick,
}: {
  href: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="shrink-0 rounded-lg border border-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary hover:bg-primary/10"
    >
      Join
    </a>
  );
}

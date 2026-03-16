export function KurirLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Kurir"
      className={className}
    >
      {/* Top-left: coral rounded horizontal bar */}
      <rect x="3" y="1" width="13" height="6" rx="3" fill="#E8756A" />
      {/* Middle: terracotta swoosh — left bar + diagonal arm to upper-right */}
      <path
        d="M3 12.5C3 10.6 4.6 9 6.5 9H11c1.2 0 2.2.5 2.9 1.4L22 2.5c.9-.6 2-.5 2.8.2.7.7.9 1.8.4 2.7l-7.5 12c-.6 1-1.7 1.6-2.9 1.6H6.5C4.6 19 3 17.4 3 15.5v-3z"
        fill="#C0704A"
      />
      {/* Bottom-left: amber rounded shape */}
      <rect x="3" y="21" width="11" height="8.5" rx="3" fill="#DBA044" />
      {/* Bottom-right: amber rounded shape, offset lower-right */}
      <rect x="17" y="22.5" width="11.5" height="8.5" rx="3" fill="#DBA044" />
    </svg>
  );
}

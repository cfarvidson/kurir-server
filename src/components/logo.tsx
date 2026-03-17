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
      <defs>
        <clipPath id="kurir-terra-clip">
          <rect x="0" y="0" width="32" height="15.5" />
        </clipPath>
      </defs>
      {/* Top-left: coral rounded horizontal bar */}
      <rect x="2.5" y="1" width="12.5" height="5.5" rx="2.75" fill="#E8756A" />
      {/* Middle: terracotta bar + rotated arm forming the swoosh */}
      <g clipPath="url(#kurir-terra-clip)">
        <rect x="2.5" y="9" width="12.5" height="6" rx="3" fill="#C0704A" />
        <rect
          x="11"
          y="5"
          width="13"
          height="5"
          rx="2.5"
          transform="rotate(-35, 17.5, 7.5)"
          fill="#C0704A"
        />
      </g>
      {/* Bottom-left: amber rounded shape */}
      <rect
        x="2.5"
        y="19.5"
        width="10"
        height="8"
        rx="3"
        transform="rotate(-3, 7.5, 23.5)"
        fill="#DBA044"
      />
      {/* Bottom-right: amber rounded shape, offset lower-right */}
      <rect
        x="15"
        y="21.5"
        width="10.5"
        height="8"
        rx="3"
        transform="rotate(5, 20.25, 25.5)"
        fill="#DBA044"
      />
    </svg>
  );
}

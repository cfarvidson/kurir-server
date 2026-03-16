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
          <rect x="0" y="0" width="32" height="15" />
        </clipPath>
      </defs>
      {/* Top-left: coral rounded horizontal bar */}
      <rect x="2" y="1" width="13" height="5.5" rx="2.75" fill="#E8756A" />
      {/* Middle: terracotta bar + rotated arm forming the swoosh */}
      <g clipPath="url(#kurir-terra-clip)">
        <rect x="2" y="8.5" width="13" height="6" rx="3" fill="#C0704A" />
        <rect
          x="10"
          y="4.5"
          width="15"
          height="5.5"
          rx="2.75"
          transform="rotate(-35, 17.5, 7.25)"
          fill="#C0704A"
        />
      </g>
      {/* Bottom-left: amber rounded shape */}
      <rect
        x="2"
        y="19"
        width="10.5"
        height="8.5"
        rx="3.2"
        transform="rotate(-3, 7.25, 23.25)"
        fill="#DBA044"
      />
      {/* Bottom-right: amber rounded shape, offset lower-right */}
      <rect
        x="15"
        y="21"
        width="11"
        height="8.5"
        rx="3.2"
        transform="rotate(5, 20.5, 25.25)"
        fill="#DBA044"
      />
    </svg>
  );
}

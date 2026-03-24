interface NutterxLogoProps {
  size?: number;
  className?: string;
}

export function NutterxLogo({ size = 28, className }: NutterxLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 180 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="90" cy="90" r="88" fill="#111111" />
      <circle cx="90" cy="90" r="82" stroke="#D4AF37" strokeWidth="10" />
      <polyline
        points="44,46 44,134 136,46 136,134"
        stroke="#D4AF37"
        strokeWidth="19"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

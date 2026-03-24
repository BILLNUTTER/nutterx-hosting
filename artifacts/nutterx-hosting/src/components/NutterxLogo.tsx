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
      {/* Dark background disc */}
      <circle cx="90" cy="90" r="88" fill="#111111" />
      {/* Strong golden ring */}
      <circle cx="90" cy="90" r="82" stroke="#D4AF37" strokeWidth="10" />
      {/*
        Correct forward N — traced: bottom-left → top-left → bottom-right → top-right
        This makes the diagonal go top-left ↘ bottom-right (not inverted).
        Letter is smaller than the circle so it sits centred with breathing room.
      */}
      <polyline
        points="55,130 55,50 125,130 125,50"
        stroke="#D4AF37"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeMiterlimit="10"
        fill="none"
      />
    </svg>
  );
}

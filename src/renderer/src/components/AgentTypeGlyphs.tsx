interface AgentTypeGlyphProps {
  size?: number;
  className?: string;
}

/** A small orbiting spark mark for the model-backed Agents One runtime. */
export function OneAgentGlyph({
  size = 22,
  className,
}: AgentTypeGlyphProps): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      focusable="false"
    >
      <ellipse
        cx="16"
        cy="16"
        rx="12.5"
        ry="7.2"
        transform="rotate(-34 16 16)"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.65"
      />
      <path
        d="M16 4.8 19.15 12.85 27.2 16l-8.05 3.15L16 27.2l-3.15-8.05L4.8 16l8.05-3.15L16 4.8Z"
        fill="currentColor"
      />
      <circle cx="6.1" cy="9.3" r="1.8" fill="currentColor" />
      <circle cx="25.6" cy="23.9" r="1.35" fill="currentColor" />
    </svg>
  );
}

/** A computer glyph with a terminal prompt and live status dot for local agents. */
export function LocalAgentGlyph({
  size = 22,
  className,
}: AgentTypeGlyphProps): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      focusable="false"
    >
      <rect
        x="4.4"
        y="5.3"
        width="23.2"
        height="17.1"
        rx="3.2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m9 10.7 3.3 3-3.3 3m6.2-.1h4.3M12.1 27h7.8m-3.9-4.3V27"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.4" cy="22.9" r="4.1" fill="currentColor" />
      <path
        d="m22.8 22.9 1.1 1.1 2.1-2.4"
        stroke="white"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

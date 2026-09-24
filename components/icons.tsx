/**
 * One line-icon set, drawn for this site on a 20px grid with a 1.6 stroke.
 *
 * Drawn rather than imported: a package of a thousand icons would be the largest
 * dependency on a page whose tools are a few kilobytes each, and every glyph here is
 * meant to show the tool's own material — brackets for the IN list, a gauge for the
 * optimizer — rather than a generic metaphor.
 */

type IconProps = { className?: string };

function Svg({ className = 'size-4', children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ tools */

export function ScratchpadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
      <path d="M6 8l2.5 2L6 12" />
      <path d="M10.5 12.5h3.5" />
    </Svg>
  );
}

export function InListIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 3C4.3 5 4.3 15 6.5 17" />
      <path d="M13.5 3c2.2 2 2.2 12 0 14" />
      <path d="M9 6.5h2M9 10h2M9 13.5h2" />
    </Svg>
  );
}

export function BulkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 2.8 17 6.3 10 9.8 3 6.3Z" />
      <path d="M3 10l7 3.5 7-3.5" />
      <path d="M3 13.7l7 3.5 7-3.5" />
    </Svg>
  );
}

export function DiffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="3" width="6.5" height="14" rx="1.8" />
      <rect x="11" y="3" width="6.5" height="14" rx="1.8" />
      <path d="M4.3 10h2.9M12.8 10h2.9M14.25 8.55v2.9" />
    </Svg>
  );
}

export function FormatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4.5h11" />
      <path d="M6.5 8.2h10.5" />
      <path d="M6.5 11.8h8" />
      <path d="M3 15.5h11" />
    </Svg>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.2 14.5a7.5 7.5 0 1 1 13.6 0" />
      <path d="M10 12.2 13 7.5" />
      <circle cx="10" cy="12.6" r="1.2" />
    </Svg>
  );
}

export function ConvertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 7h12l-3-3" />
      <path d="M16.5 13h-12l3 3" />
    </Svg>
  );
}

export function OverviewIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="6" height="6" rx="1.6" />
      <rect x="11" y="3" width="6" height="6" rx="1.6" />
      <rect x="3" y="11" width="6" height="6" rx="1.6" />
      <rect x="11" y="11" width="6" height="6" rx="1.6" />
    </Svg>
  );
}

/* ---------------------------------------------------------------- general */

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.2 13.2 3.8 3.8" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6.5" y="6.5" width="10" height="10" rx="2" />
      <path d="M13.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.5 10.5 3.5 3.5 7.5-8" />
    </Svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 2.5 4 4.8v4.6c0 3.6 2.5 6.6 6 8.1 3.5-1.5 6-4.5 6-8.1V4.8L10 2.5Z" />
      <path d="m7.4 10 1.9 1.9 3.4-3.6" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 4.5v11l9-5.5-9-5.5Z" fill="currentColor" strokeWidth={1.2} />
    </Svg>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5v13l-3-3" />
      <path d="M14 16.5v-13l3 3" />
    </Svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 7.5 5 5 5-5" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5M10 6.5v.01" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.6 3.4 2.4 14.3A1.6 1.6 0 0 0 3.8 16.7h12.4a1.6 1.6 0 0 0 1.4-2.4L11.4 3.4a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M10 8v3.5M10 14v.01" />
    </Svg>
  );
}

export function ErrorIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m7.5 7.5 5 5M12.5 7.5l-5 5" />
    </Svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m6.8 10.2 2.2 2.2 4.2-4.6" />
    </Svg>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
      <path d="M3.5 3.5v3.5H7" />
    </Svg>
  );
}

export function EraseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5l10 10M15 5 5 15" />
    </Svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 13V3.5M6 7.5l4-4 4 4" />
      <path d="M3.5 12.5v2a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3.5V13M6 9l4 4 4-4" />
      <path d="M3.5 12.5v2a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.1 5.1l2.1 2.1M12.8 12.8l2.1 2.1M5.1 14.9l2.1-2.1M12.8 7.2l2.1-2.1" />
    </Svg>
  );
}

/**
 * The parity mark: an equals sign on the code surface, the same drawing as the
 * favicon, so the header and the browser tab carry one mark.
 */
export function ParityMark({ className = 'size-8' }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="parity-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a2e3d" />
          <stop offset="1" stopColor="#171923" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#parity-tile)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#ffffff" strokeOpacity="0.1" />
      <rect x="7" y="11" width="18" height="3.6" rx="1.8" fill="#6fdcae" />
      <rect x="7" y="17.4" width="18" height="3.6" rx="1.8" fill="#6fdcae" />
    </svg>
  );
}

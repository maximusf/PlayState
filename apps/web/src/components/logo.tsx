// Pixel play arrow on a green tile, drawn on an 8x8 grid.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8 8"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="8" height="8" className="fill-emerald" />
      <path d="M2 1h1v1h1v1h1v1h1v1H5v1H4v1H3v1H2z" className="fill-forest" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark className="size-7" />
      <span className="font-pixel text-[2.125rem] leading-none text-forest">PlayState</span>
    </span>
  );
}

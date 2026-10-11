// Pixel play arrow on a raised green tile, on a 16x16 grid. The source drawing
// is design/playstate-mark.aseprite, and the favicon files are exported from it.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 0h14v1h1v14h-1v1H1v-1H0V1h1z" className="fill-emerald" />
      <path d="M1 0h14v1H1v14H0V1h1z" className="fill-mint" />
      <path d="M15 1h1v14h-1v1H1v-1h14z" className="fill-pine" />
      <path d="M5 4h2v1h2v1h2v1h2v2h-2v1H9v1H7v1H5z" className="fill-forest" />
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

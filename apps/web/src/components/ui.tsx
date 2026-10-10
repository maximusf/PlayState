import Image from "next/image";

export function PixelLoader({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6 text-muted">
      <span aria-hidden="true" className="flex gap-1">
        <span className="size-2 animate-step bg-emerald" />
        <span className="size-2 animate-step bg-emerald [animation-delay:0.3s]" />
        <span className="size-2 animate-step bg-emerald [animation-delay:0.6s]" />
      </span>
      <span>{label}</span>
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "error" | "info";
  children: React.ReactNode;
}) {
  const isError = tone === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`border-l-4 px-4 py-3 ${
        isError ? "border-danger bg-surface text-danger" : "border-emerald bg-sage text-forest"
      }`}
    >
      {children}
    </div>
  );
}

// Cover art, with a pixel placeholder when IGDB has none.
export function GameCover({
  title,
  coverUrl,
  className = "",
}: {
  title: string;
  coverUrl: string | null;
  className?: string;
}) {
  return (
    <div className={`relative aspect-[3/4] overflow-hidden bg-sage ${className}`}>
      {coverUrl ? (
        <Image
          src={coverUrl}
          alt={`${title} cover art`}
          fill
          sizes="(min-width: 1024px) 200px, 45vw"
          className="object-cover"
          unoptimized
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <svg
            viewBox="0 0 8 8"
            className="w-1/3 fill-forest/40"
            shapeRendering="crispEdges"
            role="img"
            aria-label={`No cover art for ${title}`}
          >
            <path d="M1 2h6v4H1zM2 3v2h1V3zM5 3v1h1V3z" fillRule="evenodd" />
          </svg>
        </div>
      )}
    </div>
  );
}

// Small pixel cartridge used in empty states.
export function EmptyArt() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="size-20"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 1h8v10H2z" className="fill-forest" />
      <path d="M3 2h6v5H3z" className="fill-mint" />
      <path d="M4 8h4v3H4z" className="fill-sage" />
      <path d="M5 3h1v1h1v1H6v1H5z" className="fill-emerald" />
    </svg>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 bg-surface px-6 py-12 text-center pixel-frame">
      <EmptyArt />
      <h2 className="font-pixel text-2xl text-forest">{title}</h2>
      <p className="max-w-sm text-muted">{children}</p>
      {action}
    </div>
  );
}

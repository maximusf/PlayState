// Loading placeholders shaped like the content they stand in for, so the page does not
// jump when the real thing arrives. Each one announces its label to screen readers.

const bone = "bg-fern/40";
const coverBone = `aspect-[3/4] ${bone} ring-4 ring-fern/50`;

function Skeleton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" className="animate-pulse">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function Line({ className }: { className: string }) {
  return <span className={`block ${bone} ${className}`} />;
}

function times(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

// The same column layouts the library uses for large and small covers.
const GRIDS = {
  grid: "grid grid-cols-2 gap-x-6 gap-y-8 px-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  compact: "grid grid-cols-3 gap-x-4 gap-y-5 px-1 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8",
};

function CoverGrid({ variant, count }: { variant: keyof typeof GRIDS; count: number }) {
  return (
    <div className={GRIDS[variant]}>
      {times(count).map((index) => (
        <div key={index} className={`flex flex-col ${variant === "compact" ? "gap-2" : "gap-3"}`}>
          <span className={`block ${coverBone}`} />
          <span className="space-y-2">
            <Line className="h-4 w-4/5" />
            {variant === "grid" && <Line className="h-3 w-1/2" />}
          </span>
        </div>
      ))}
    </div>
  );
}

function Rows({ count, cover }: { count: number; cover: boolean }) {
  return (
    <div className="space-y-4 px-1">
      {times(count).map((index) => (
        <div
          key={index}
          className="flex items-center gap-4 bg-surface p-3 pixel-frame [--frame:var(--color-fern)]"
        >
          {cover && <span className={`block w-12 shrink-0 aspect-[3/4] ${bone}`} />}
          <span className="min-w-0 flex-1 space-y-2">
            <Line className="h-4 w-2/5" />
            <Line className="h-3 w-1/4" />
          </span>
          <Line className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function CoverGridSkeleton({
  label,
  variant = "grid",
  count = 10,
}: {
  label: string;
  variant?: keyof typeof GRIDS;
  count?: number;
}) {
  return (
    <Skeleton label={label}>
      <CoverGrid variant={variant} count={count} />
    </Skeleton>
  );
}

export function RowListSkeleton({
  label,
  count = 5,
  cover = true,
}: {
  label: string;
  count?: number;
  cover?: boolean;
}) {
  return (
    <Skeleton label={label}>
      <Rows count={count} cover={cover} />
    </Skeleton>
  );
}

// The game page: a cover beside a title, a summary and rows of tags.
export function GameDetailSkeleton({ label }: { label: string }) {
  return (
    <Skeleton label={label}>
      <div className="flex flex-col gap-10 md:flex-row md:items-start md:gap-12">
        <div className="mx-auto w-56 shrink-0 px-1 pb-3 sm:w-64 md:mx-0 md:w-80">
          <span className={`block ${coverBone}`} />
        </div>
        <div className="min-w-0 flex-1">
          <Line className="h-4 w-48" />
          <Line className="mt-4 h-14 w-4/5" />
          <Line className="mt-4 h-5 w-32" />
          <div className="mt-7 max-w-2xl space-y-3">
            <Line className="h-4 w-full" />
            <Line className="h-4 w-full" />
            <Line className="h-4 w-3/5" />
          </div>
          <div className="mt-7 space-y-4 border-y-4 border-dotted border-fern py-6">
            {times(3).map((index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Line className="mr-4 h-4 w-20" />
                <Line className="h-9 w-24" />
                <Line className="h-9 w-28" />
                <Line className="h-9 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Skeleton>
  );
}

// The three pick cards on the picker page.
export function PickCardsSkeleton({ label }: { label: string }) {
  return (
    <Skeleton label={label}>
      <div className="grid gap-7 px-1 sm:grid-cols-2 lg:grid-cols-3">
        {times(3).map((index) => (
          <div key={index} className="flex flex-col gap-4 bg-surface p-5 pixel-frame">
            <span className={`block aspect-[3/4] ${bone}`} />
            <span className="space-y-2">
              <Line className="h-6 w-3/4" />
              <Line className="h-4 w-1/2" />
            </span>
            <span className="space-y-2">
              <Line className="h-4 w-28" />
              <Line className="h-4 w-2/3" />
              <Line className="h-4 w-1/2" />
            </span>
          </div>
        ))}
      </div>
    </Skeleton>
  );
}

// The player count badge on the home page: an icon beside a big number and a label.
export function PlayerCountSkeleton({ label }: { label: string }) {
  return (
    <Skeleton label={label}>
      <div className="mx-1 mt-6 flex items-center gap-4 bg-surface p-3 pixel-frame [--frame:var(--color-fern)] sm:gap-5 sm:p-4">
        <span className={`block size-14 shrink-0 ${bone}`} />
        <span className="flex flex-col gap-2">
          <Line className="h-12 w-20" />
          <Line className="h-4 w-44" />
        </span>
      </div>
    </Skeleton>
  );
}

// A party page: its name, the players, then the games everyone owns.
export function PartySkeleton({ label }: { label: string }) {
  return (
    <Skeleton label={label}>
      <Line className="h-4 w-16" />
      <Line className="mt-4 h-12 w-72 max-w-full" />
      <Line className="mt-3 h-4 w-48" />
      <div className="mt-6 flex flex-wrap gap-2">
        <Line className="h-9 w-24" />
        <Line className="h-9 w-20" />
        <Line className="h-9 w-28" />
      </div>
      <Line className="mt-10 h-8 w-56" />
      <div className="mt-6">
        <CoverGrid variant="compact" count={8} />
      </div>
    </Skeleton>
  );
}

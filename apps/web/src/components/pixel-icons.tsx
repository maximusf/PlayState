// Pixel icons, each drawn on a 12 by 12 grid. A "#" is a filled pixel.
// Edit the grid to change an icon.
const GRIDS = {
  windows: [
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "............",
    "............",
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "#####..#####",
  ],
  mac: [
    ".......##...",
    "......##....",
    "......#.....",
    "..###..###..",
    ".##########.",
    "#########...",
    "########....",
    "########....",
    "#########...",
    ".##########.",
    ".##########.",
    "..###..###..",
  ],
  linux: [
    "....####....",
    "...######...",
    "...#.##.#...",
    "...######...",
    "....#..#....",
    "...##..##...",
    "..##....##..",
    ".###....###.",
    ".###....###.",
    ".###....###.",
    "..##....##..",
    ".####..####.",
  ],
  singlePlayer: [
    "....####....",
    "...######...",
    "...######...",
    "...######...",
    "....####....",
    "............",
    "...######...",
    "..########..",
    ".##########.",
    ".##########.",
    ".##########.",
    ".##########.",
  ],
  multiplayer: [
    "....####....",
    "....####....",
    "....####....",
    ".##......##.",
    ".##.####.##.",
    ".##.####.##.",
    "....####....",
    "###.####.###",
    "###.####.###",
    "###.####.###",
    "###......###",
    "###......###",
  ],
  coop: [
    "..##....##..",
    ".####..####.",
    ".####..####.",
    "..##....##..",
    "............",
    ".####..####.",
    "############",
    "############",
    "############",
    "############",
    "############",
    "############",
  ],
  splitScreen: [
    "############",
    "#....##....#",
    "#....##....#",
    "#....##....#",
    "#....##....#",
    "#....##....#",
    "#....##....#",
    "#....##....#",
    "############",
    "....####....",
    "....####....",
    "..########..",
  ],
  online: [
    "...######...",
    "..#..##..#..",
    ".#...##...#.",
    "#....##....#",
    "############",
    "#....##....#",
    "#....##....#",
    "############",
    "#....##....#",
    ".#...##...#.",
    "..#..##..#..",
    "...######...",
  ],
  battleRoyale: [
    "............",
    "#....##....#",
    "#....##....#",
    "##..####..##",
    "##..####..##",
    "############",
    "############",
    "############",
    "############",
    "............",
    "############",
    "############",
  ],
  search: [
    "..#####.....",
    ".##...##....",
    "##.....##...",
    "#.......#...",
    "#.......#...",
    "#.......#...",
    "##.....##...",
    ".##...##....",
    "..#####.##..",
    ".......####.",
    "........####",
    ".........###",
  ],
  // A solid face with the pips cut out of it, so it reads as a dice at any size.
  dice: [
    ".##########.",
    "############",
    "##..####..##",
    "##..####..##",
    "############",
    "#####..#####",
    "#####..#####",
    "############",
    "##..####..##",
    "##..####..##",
    "############",
    ".##########.",
  ],
  // Library layouts.
  grid: [
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "............",
    "............",
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "#####..#####",
    "#####..#####",
  ],
  compactGrid: [
    "###.###.###.",
    "###.###.###.",
    "###.###.###.",
    "............",
    "###.###.###.",
    "###.###.###.",
    "###.###.###.",
    "............",
    "###.###.###.",
    "###.###.###.",
    "###.###.###.",
    "............",
  ],
  list: [
    "............",
    "##.#########",
    "##.#########",
    "............",
    "............",
    "##.#########",
    "##.#########",
    "............",
    "............",
    "##.#########",
    "##.#########",
    "............",
  ],
  // A funnel, for the library filters.
  filter: [
    "############",
    "############",
    "############",
    ".##########.",
    "..########..",
    "...######...",
    "....####....",
    "....####....",
    "....####....",
    "....####....",
    "....####....",
    "............",
  ],
  // Two chain links on a slant, for sharing the invite link.
  link: [
    "............",
    ".......####.",
    "......##..#.",
    ".....##...#.",
    "....####.##.",
    "...##..###..",
    "..###..##...",
    ".##.####....",
    ".#...##.....",
    ".#..##......",
    ".####.......",
    "............",
  ],
  check: [
    "............",
    "..........##",
    ".........###",
    "........###.",
    ".......###..",
    "##....###...",
    "###..###....",
    ".######.....",
    "..####......",
    "...##.......",
    "............",
    "............",
  ],
} as const;

export type PixelIconName = keyof typeof GRIDS;

// One rectangle for each run of filled pixels in a row.
function toPath(rows: readonly string[]): string {
  return rows
    .flatMap((row, y) =>
      [...row.matchAll(/#+/g)].map((run) => `M${run.index} ${y}h${run[0].length}v1H${run.index}z`),
    )
    .join("");
}

const PATHS = Object.fromEntries(
  Object.entries(GRIDS).map(([name, rows]) => [name, toPath(rows)]),
) as Record<PixelIconName, string>;

// IGDB's names for platforms and game modes, with the icon and short label for each.
const PLATFORM_ICONS: Record<string, { icon: PixelIconName; label: string }> = {
  "PC (Microsoft Windows)": { icon: "windows", label: "Windows" },
  Mac: { icon: "mac", label: "Mac" },
  Linux: { icon: "linux", label: "Linux" },
};

const GAME_MODE_ICONS: Record<string, { icon: PixelIconName; label: string }> = {
  "Single player": { icon: "singlePlayer", label: "Single player" },
  Multiplayer: { icon: "multiplayer", label: "Multiplayer" },
  "Co-operative": { icon: "coop", label: "Co-op" },
  "Split screen": { icon: "splitScreen", label: "Split screen" },
  "Massively Multiplayer Online (MMO)": { icon: "online", label: "Online (MMO)" },
  "Battle Royale": { icon: "battleRoyale", label: "Battle royale" },
};

export type Badge = { label: string; icon: PixelIconName | null };

// The computer platforms a game runs on. Consoles are left out.
export function platformBadges(platforms: string[]): Badge[] {
  return Object.entries(PLATFORM_ICONS)
    .filter(([igdbName]) => platforms.includes(igdbName))
    .map(([, badge]) => badge);
}

// A mode without an icon keeps its name, and is shown as text.
export function gameModeBadges(gameModes: string[]): Badge[] {
  return gameModes.map((mode) => GAME_MODE_ICONS[mode] ?? { label: mode, icon: null });
}

// A paint palette in colour, drawn on a 16 by 16 grid. It is the Customize button.
const PALETTE_COLOURS: Record<string, string> = {
  O: "#0f2d23",
  B: "#b9775f",
  U: "#3b9be0",
  Y: "#f9c933",
  R: "#ee6f62",
  G: "#37a35a",
  N: "#f4812c",
  W: "#fafbf8",
};

const PALETTE = [
  "................",
  ".....OOOOOOO....",
  "...OOBBBBBBBOO..",
  "..OBBBBBBBBBBBO.",
  ".OBBUUBBBYYBBBBO",
  ".OBBUUBBBYYBBRRO",
  "OBBBBBBBBBBBBRRO",
  "OBGGBBBBBBBBBBBO",
  "OBGGBBBBBBBBBBO.",
  "OBBBBBBBBBBBBO..",
  ".OBNNBBBBBBBBO..",
  ".OBNNBBWWBBBO...",
  "..OBBBBWWBBO....",
  "...OOBBBBOO.....",
  ".....OOOOO......",
  "................",
];

const PALETTE_RECTS = PALETTE.flatMap((row, y) =>
  [...row.matchAll(/([A-Z])\1*/g)].map((run) => ({
    x: run.index,
    y,
    width: run[0].length,
    fill: PALETTE_COLOURS[run[1]],
  })),
);

export function PaletteIcon({ className = "size-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {PALETTE_RECTS.map((rect) => (
        <rect key={`${rect.x}-${rect.y}`} x={rect.x} y={rect.y} width={rect.width} height="1" fill={rect.fill} />
      ))}
    </svg>
  );
}

export function PixelIcon({
  name,
  className = "size-6",
}: {
  name: PixelIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`fill-current ${className}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// A square icon badge. Its name appears on hover and on keyboard focus,
// and is always there for screen readers.
export function IconBadge({ icon, label }: { icon: PixelIconName; label: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        className="inline-flex size-11 items-center justify-center bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
      >
        <PixelIcon name={icon} />
        <span className="sr-only">{label}</span>
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden bg-forest px-2.5 py-1.5 text-sm font-bold whitespace-nowrap text-surface group-focus-within:block group-hover:block"
      >
        {label}
      </span>
    </span>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { PixelIcon } from "@/components/pixel-icons";
import { RandomDiceLink } from "@/components/random-dice-link";
import { PlayerCountSkeleton } from "@/components/skeletons";

// Set to false to hide the player count scoreboard under the hero shelf.
const SHOW_PLAYER_COUNT = true;
// How long the home page reuses a count before asking the API again, in seconds.
const PLAYER_COUNT_TTL = 300;

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const COVER_BASE = "https://images.igdb.com/igdb/image/upload/t_cover_big";

// The shelf in the hero: twelve IGDB covers, three of them picked.
// Hovering a cover eases it upward, and fades a greyed-out one back to full colour.
const SHELF: { title: string; image: string; pick?: boolean }[] = [
  { title: "Hades", image: "cob9kr" },
  { title: "Minecraft", image: "co8fu7", pick: true },
  { title: "Stardew Valley", image: "coa93h" },
  { title: "Celeste", image: "cob9dh" },
  { title: "Risk of Rain", image: "co2k2z", pick: true },
  { title: "Portal 2", image: "co1rs4" },
  { title: "Terraria", image: "coaamg" },
  { title: "Rocket League", image: "cocyri" },
  { title: "Undertale", image: "cob1t2" },
  { title: "Among Us", image: "co6kqt" },
  { title: "Hollow Knight", image: "cocpbl" },
  { title: "Call of Duty: Black Ops", image: "co1wkl", pick: true },
];

const STEPS = [
  {
    title: "Build your library",
    body: "Search by title and add the games you own. Covers and genres come from IGDB.",
  },
  {
    title: "Answer three questions",
    body: "How much time you have, what sounds good, and whether you are playing alone.",
  },
  {
    title: "Get three picks",
    body: 'Each pick lists plain reasons, such as "Matches Strategy". No made-up match scores.',
  },
];

function Shelf() {
  let pickNumber = 0;

  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="pixel-label text-muted">Tonight</span>
        {["2+ hours", "Action, Sandbox", "Either"].map((answer) => (
          <span key={answer} className="bg-forest px-3 py-1.5 text-sm font-semibold text-surface">
            {answer}
          </span>
        ))}
      </div>

      <div className="mx-1 grid grid-cols-4 gap-3 bg-surface p-4 pixel-frame sm:gap-4 sm:p-5">
        {SHELF.map((game) => (
          <div
            key={game.title}
            className={`group relative aspect-[3/4] bg-fern/50 transition duration-200 ease-out hover:z-10 hover:-translate-y-1 hover:shadow-[0_8px_0_0_var(--color-forest)] ${
              game.pick ? "ring-4 ring-emerald" : "hover:ring-4 hover:ring-forest"
            }`}
          >
            {/* Decorative: the whole shelf is hidden from assistive technology. */}
            <Image
              src={`${COVER_BASE}/${game.image}.jpg`}
              alt=""
              fill
              sizes="(min-width: 768px) 120px, 22vw"
              className={`object-cover transition duration-200 ease-out ${
                game.pick ? "" : "opacity-35 grayscale group-hover:opacity-100 group-hover:grayscale-0"
              }`}
              unoptimized
            />
            {game.pick && (
              <span className="absolute bottom-1.5 left-1.5 bg-emerald px-1.5 font-pixel text-base leading-tight text-forest sm:bottom-2 sm:left-2">
                PICK {++pickNumber}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// The badge loads on its own, so a slow or sleeping API never holds up the page.
// If the count cannot be fetched, the badge is left out.
async function PlayerCount() {
  let players: number;

  try {
    const response = await fetch(`${API_URL}/api/stats`, {
      next: { revalidate: PLAYER_COUNT_TTL },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;

    players = (await response.json()).data.players;
  } catch {
    return null;
  }

  if (!Number.isInteger(players) || players < 1) return null;

  return (
    <p className="mx-1 mt-6 flex items-center gap-4 bg-emerald p-3 text-forest pixel-frame sm:gap-5 sm:p-4">
      <span className="flex size-14 shrink-0 items-center justify-center bg-forest text-mint">
        <PixelIcon name="multiplayer" className="size-9" />
      </span>
      <span className="flex flex-col gap-2">
        <span className="font-pixel text-6xl leading-[0.8]">{players.toLocaleString("en-US")}</span>
        <span className="pixel-label">
          {players === 1 ? "player uses" : "players use"} PlayState
        </span>
      </span>
    </p>
  );
}

export default async function Home() {
  const { userId } = await auth();

  return (
    <div className="py-4 md:py-10">
      <div className="grid items-center gap-12 md:grid-cols-2 md:gap-14">
        <div>
          <p className="pixel-label text-pine">A game picker for your own library</p>
          <h1 className="mt-5 font-pixel text-7xl leading-[0.88] text-forest lg:text-[5.75rem]">
            Find the right game for right now.
          </h1>
          <p className="mt-6 max-w-md text-xl leading-relaxed text-slate">
            You own more games than you have evenings. Say how long you have and what you feel
            like, and PlayState picks three from the games you already own.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6 px-1 pb-2">
            {userId ? (
              <>
                <RandomDiceLink large />
                <Link href="/pick" className="btn btn-primary btn-lg">
                  Pick a game
                </Link>
                <Link href="/library" className="btn btn-secondary btn-lg">
                  Open your library
                </Link>
              </>
            ) : (
              <>
                <Link href="/sign-up" className="btn btn-primary btn-lg">
                  Get started
                </Link>
                <Link href="/sign-in" className="btn btn-secondary btn-lg">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>

        <div>
          <Shelf />
          {SHOW_PLAYER_COUNT && (
            <Suspense fallback={<PlayerCountSkeleton label="Loading player count" />}>
              <PlayerCount />
            </Suspense>
          )}
        </div>
      </div>

      <section
        aria-labelledby="how-it-works"
        className="mt-20 border-t-4 border-dotted border-fern pt-10"
      >
        <h2 id="how-it-works" className="sr-only">
          How it works
        </h2>
        <ol className="grid gap-10 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true" className="block font-pixel text-5xl leading-none text-pine">
                {index + 1}
              </span>
              <h3 className="mt-2 font-pixel text-4xl leading-none text-forest">{step.title}</h3>
              <p className="mt-2 text-slate">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

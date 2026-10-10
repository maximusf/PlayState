import Image from "next/image";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

const COVER_BASE = "https://images.igdb.com/igdb/image/upload/t_cover_big";

// The shelf in the hero: twelve IGDB covers, three of them picked.
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
            className={`relative aspect-[3/4] bg-fern/50 ${game.pick ? "ring-4 ring-emerald" : ""}`}
          >
            {/* Decorative: the whole shelf is hidden from assistive technology. */}
            <Image
              src={`${COVER_BASE}/${game.image}.jpg`}
              alt=""
              fill
              sizes="(min-width: 768px) 120px, 22vw"
              className={`object-cover ${game.pick ? "" : "opacity-35 grayscale"}`}
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

        <Shelf />
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

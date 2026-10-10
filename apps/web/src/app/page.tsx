import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

// A static preview of the picker, shown beside the hero copy.
function PickerPreview() {
  const row = "flex items-center gap-2 px-3 py-2 text-sm";

  return (
    <div aria-hidden="true" className="mx-1 bg-surface p-5 pixel-frame sm:p-6">
      <p className="pixel-label text-muted">How much time do you have?</p>
      <div className="mt-3 grid grid-cols-3 gap-3 px-1">
        <span className={`${row} pixel-frame [--frame:var(--color-sage)]`}>30 min</span>
        <span className={`${row} bg-mint font-semibold text-forest pixel-frame`}>
          <span className="animate-blink text-emerald">&#9654;</span>1 to 2 hrs
        </span>
        <span className={`${row} pixel-frame [--frame:var(--color-sage)]`}>Any</span>
      </div>

      <p className="pixel-label mt-6 text-muted">What sounds good?</p>
      <div className="mt-3 grid grid-cols-3 gap-3 px-1">
        <span className={`${row} bg-mint font-semibold text-forest pixel-frame`}>Strategy</span>
        <span className={`${row} pixel-frame [--frame:var(--color-sage)]`}>Puzzle</span>
        <span className={`${row} pixel-frame [--frame:var(--color-sage)]`}>RPG</span>
      </div>

      <div className="mt-7 border-t-4 border-dotted border-sage pt-5">
        <p className="pixel-label text-emerald">Pick 1</p>
        <p className="mt-1 text-lg font-semibold text-forest">Against the Storm</p>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          <li>+ Matches Strategy</li>
          <li>+ Supports single-player</li>
        </ul>
      </div>
    </div>
  );
}

export default async function Home() {
  const { userId } = await auth();

  return (
    <div className="grid items-center gap-10 py-4 md:grid-cols-2 md:gap-12 md:py-12">
      <div>
        <h1 className="font-pixel text-4xl leading-tight text-forest sm:text-5xl">
          Find the right game for right now.
        </h1>
        <p className="mt-5 max-w-md text-lg text-slate">
          Your library is full of games. PlayState narrows it down to three, based on how much time
          you have and what you feel like playing.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-6 px-1 pb-2">
          {userId ? (
            <>
              <Link href="/pick" className="btn btn-primary">
                Pick a game
              </Link>
              <Link href="/library" className="btn btn-secondary">
                Open your library
              </Link>
            </>
          ) : (
            <>
              <Link href="/sign-up" className="btn btn-primary">
                Get started
              </Link>
              <Link href="/sign-in" className="btn btn-secondary">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>

      <PickerPreview />
    </div>
  );
}

import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Logo } from "./logo";

const navLink =
  "pixel-label inline-flex min-h-11 items-center px-2 text-forest underline-offset-8 hover:underline";

export async function SiteHeader() {
  const { userId } = await auth();

  return (
    <header className="border-b-4 border-forest bg-surface">
      {/* Four links and the logo do not fit on one line on a phone, so the links may wrap below it. */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="PlayState home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="flex flex-wrap items-center justify-end gap-x-1 sm:gap-x-3">
          {userId ? (
            <>
              <Link href="/random" className={navLink}>
                Random
              </Link>
              <Link href="/pick" className={navLink}>
                Pick
              </Link>
              <Link href="/library" className={navLink}>
                Library
              </Link>
              <Link href="/discover" className={navLink}>
                Discover
              </Link>
              <Link href="/party" className={navLink}>
                Party
              </Link>
              <UserButton />
            </>
          ) : (
            <Link href="/sign-in" className={navLink}>
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

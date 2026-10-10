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
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="PlayState home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-3">
          {userId ? (
            <>
              <Link href="/library" className={navLink}>
                Library
              </Link>
              <Link href="/pick" className={navLink}>
                Pick
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

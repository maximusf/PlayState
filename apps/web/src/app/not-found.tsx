import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

// Shown for any address that does not match a page.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-1">
      <p className="pixel-label text-pine">Error 404</p>
      <h1 className="mt-3 mb-8 font-pixel text-6xl leading-[0.9] text-forest">Game over.</h1>
      <EmptyState
        title="That page is not here."
        action={
          <div className="mb-2 flex flex-wrap justify-center gap-5">
            <Link href="/" className="btn btn-primary">
              Back to home
            </Link>
            <Link href="/library" className="btn btn-secondary">
              Open your library
            </Link>
          </div>
        }
      >
        The link may be mistyped, or the page may have moved. Nothing in your library is affected.
      </EmptyState>
    </div>
  );
}

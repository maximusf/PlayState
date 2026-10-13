import Link from "next/link";

const REPO_URL = "https://github.com/maximusf/PlayState";

const footerLink =
  "inline-flex min-h-11 items-center font-semibold text-forest underline underline-offset-4 hover:no-underline";

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-t-4 border-dotted border-fern py-4 text-sm text-muted">
        <p>Game data provided by IGDB. Not affiliated with Valve or Steam.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6">
          <Link href="/privacy" className={footerLink}>
            Privacy
          </Link>
          <a href={`${REPO_URL}/issues`} className={footerLink}>
            Report a problem
          </a>
          <a href={REPO_URL} className={footerLink}>
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}

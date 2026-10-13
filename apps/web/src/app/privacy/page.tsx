import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

const ISSUES_URL = "https://github.com/maximusf/PlayState/issues";

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Your account",
    body: (
      <>
        Sign-in is handled by Clerk. Clerk stores your email address and sign-in details, and uses
        cookies to keep you signed in. PlayState&apos;s own database stores only the account ID
        Clerk gives you, never your email or password.
      </>
    ),
  },
  {
    title: "Your library",
    body: (
      <>
        PlayState stores the games you add and the session length you tag them with, linked to your
        account ID. Your library is private unless you join a party. You can remove any game at any time.
      </>
    ),
  },
  {
    title: "Parties",
    body: (
      <>
        When you join a party, its other members see the name you chose and the multiplayer games
        you all have in common, plus the games only one member is missing. They never see the rest
        of your library, your email, or your account ID. Leaving a party removes you from it. A
        party is deleted when its host ends it, and otherwise one day after it was started.
      </>
    ),
  },
  {
    title: "Importing from Steam",
    body: (
      <>
        When you paste a Steam profile link, PlayState asks Steam for that profile&apos;s public
        list of games and playtime so you can choose what to import. The link, the Steam ID, and
        the playtime are not saved. Only the games you choose to import are added to your library.
      </>
    ),
  },
  {
    title: "Other services",
    body: (
      <>
        Game titles, covers, and genres come from IGDB. Your searches reach IGDB through
        PlayState&apos;s server and do not include who you are. The site runs on Vercel, Render,
        and Supabase, which process requests in order to serve it.
      </>
    ),
  },
  {
    title: "What PlayState does not do",
    body: (
      <>
        There are no ads and no analytics or tracking scripts, and your data is not sold or shared
        for marketing. The player count on the home page is a total and identifies no one.
      </>
    ),
  },
  {
    title: "Deleting your data",
    body: (
      <>
        You can delete your account yourself: open the account menu at the top of the page and
        choose Manage account. Deleting your account also deletes your library from PlayState. To
        ask anything about this page,{" "}
        <a
          href={ISSUES_URL}
          className="font-semibold text-forest underline underline-offset-4 hover:no-underline"
        >
          open an issue on GitHub
        </a>
        .
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-forest underline underline-offset-4 hover:no-underline"
      >
        Back to home
      </Link>
      <h1 className="mt-2 font-pixel text-6xl leading-[0.9] text-forest">Privacy</h1>
      <p className="mt-4 text-lg text-slate">
        What PlayState stores about you, in plain words. Last updated October 2026.
      </p>

      <div className="mt-8 space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="font-pixel text-3xl leading-none text-forest">{section.title}</h2>
            <p className="mt-2 leading-relaxed text-slate">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

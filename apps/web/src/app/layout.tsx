import type { Metadata } from "next";
import { Figtree, Pixelify_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const body = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
});

const display = Pixelify_Sans({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PlayState",
    template: "%s | PlayState",
  },
  description:
    "PlayState is a personalized game picker that matches your library to your available time and the kind of experience you want.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#0f2d23",
          colorForeground: "#1f2937",
          borderRadius: "0.25rem",
        },
      }}
    >
      <html lang="en" className={`${body.variable} ${display.variable} h-full antialiased`}>
        <body className="flex min-h-full flex-col font-sans">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:px-3 focus:py-2"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
            {children}
          </main>
          <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted sm:px-6">
            Game data provided by IGDB.
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}

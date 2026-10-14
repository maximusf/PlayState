import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Link unfurlers for chat apps and social sites. They are not signed in, so they
// get the public invite page, which carries the preview tags and nothing private.
const LINK_PREVIEW_BOTS =
  /Discordbot|Slackbot|Slack-ImgProxy|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|SkypeUriPreview|Applebot|iMessage|redditbot|Mastodon|Pinterestbot|Embedly|vkShare|Googlebot|bingbot|MicrosoftPreview/i;
const INVITE_PATH = /^\/party\/([A-Za-z0-9_-]{8,32})\/?$/;

// Makes the Clerk session available to pages and layouts.
// Route protection itself lives in src/app/(app)/layout.tsx.
export default clerkMiddleware((_auth, req) => {
  const match = INVITE_PATH.exec(req.nextUrl.pathname);
  if (match && LINK_PREVIEW_BOTS.test(req.headers.get("user-agent") ?? "")) {
    const url = req.nextUrl.clone();
    url.pathname = `/invite/${match[1]}`;
    return NextResponse.rewrite(url);
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};

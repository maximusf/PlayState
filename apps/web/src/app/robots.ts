import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /party is left crawlable on purpose: Slackbot and Twitterbot honour robots.txt
      // and need to fetch invite pages to build link previews.
      disallow: ["/api/", "/library", "/pick", "/random"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

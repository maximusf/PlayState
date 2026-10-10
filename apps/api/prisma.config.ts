import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI (migrations) uses the direct connection.
// The running API uses the pooled DATABASE_URL (see src/lib/prisma.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});

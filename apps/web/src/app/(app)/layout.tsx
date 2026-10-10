import { auth } from "@clerk/nextjs/server";

// Everything in the (app) route group requires a signed-in user.
// Signed-out visitors are redirected to the sign-in page.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await auth.protect();

  return children;
}

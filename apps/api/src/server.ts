import "dotenv/config";
import app from "./app";

const PORT = process.env.PORT || 4000;

// Report missing configuration by name at startup. Values are never logged.
const REQUIRED_ENV = [
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
];
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.warn(`Missing environment variables: ${missing.join(", ")}`);
}

app.listen(PORT, () => {
  console.log(`PlayState API running on http://localhost:${PORT}`);
});

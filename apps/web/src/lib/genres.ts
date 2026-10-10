// IGDB genre names are accurate but long. These are the short forms shown in the UI.
const SHORT_NAMES: Record<string, string> = {
  "Role-playing (RPG)": "RPG",
  "Hack and slash/Beat 'em up": "Hack and slash",
  "Real Time Strategy (RTS)": "RTS",
  "Turn-based strategy (TBS)": "Turn-based",
  "Card & Board Game": "Card and board",
  Simulator: "Simulation",
  Platform: "Platformer",
  Sport: "Sports",
};

export function shortGenre(name: string): string {
  return SHORT_NAMES[name] ?? name;
}

export function genreLine(genres: string[], limit = 2): string {
  return genres.slice(0, limit).map(shortGenre).join(", ") || "No genre listed";
}

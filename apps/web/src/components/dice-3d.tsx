import "./dice-3d.css";

// Which of the nine spots on a face hold a pip, counted left to right, top to bottom.
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// How to turn the cube so a given face ends up pointing at the player.
const RESTING: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: -90, y: 0 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  5: { x: 90, y: 0 },
  6: { x: 0, y: 180 },
};

// The length of the tumble, which the page also needs to know when the roll is over.
export const DICE_MS = 2600;

// A cube that is thrown, tumbles and lands showing `face`. `delayMs` waits before the throw,
// or is negative to join a throw already under way.
export function Dice3D({ face, delayMs }: { face: number; delayMs: number }) {
  const resting = RESTING[face] ?? RESTING[1];

  return (
    <div
      aria-hidden="true"
      className="dice-scene"
      style={
        {
          "--dice-delay": `${Math.round(delayMs)}ms`,
          "--dice-ms": `${DICE_MS}ms`,
          "--dice-rx": `${resting.x}deg`,
          "--dice-ry": `${resting.y}deg`,
        } as React.CSSProperties
      }
    >
      <div className="dice-hop">
        <div className="dice-cube">
          {[1, 2, 3, 4, 5, 6].map((value) => (
            <div key={value} className="dice-face" data-value={value}>
              {Array.from({ length: 9 }, (_, spot) => (
                <span key={spot} className={PIPS[value].includes(spot) ? "dice-pip" : ""} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="dice-shadow" />
    </div>
  );
}

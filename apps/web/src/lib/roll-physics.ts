import { mulberry32 } from "@/lib/seeded";

// A real rigid-body die for the cover die roll: gravity, a tray with walls, spin and friction.
// The throw is simulated with impulses at the cube's eight corners. Throws are tried until one
// settles with a wanted face up, then recorded, so every browser replays the very same roll.
//
// Lengths are in cube sides. The page's y axis points down, so "up" is negative y and the floor is
// y = 0. A cube resting on the floor has its centre at y = -0.5.

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

export type RigidRoll = {
  // The cube's centre and turn at every frame, 120 frames a second.
  positions: Vec3[];
  rotations: Quat[];
  // The frames where the cube hit the floor or a wall hard enough to count as a bounce.
  hits: number[];
  // The face number that ended up on top. It is the wanted face unless no throw found it.
  face: number;
};

export const ROLL_UNIT = 60;
export const ROLL_FPS = 120;
const HALF_WIDTH = 2.4;
const HALF_DEPTH = 1.7;
const GRAVITY = 10;
const BOUNCE = 0.52;
const FRICTION = 0.5;
const INERTIA = 1 / 6;
const STEP = 1 / 240;
const MAX_TRIES = 600;

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function multiply(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function normalise(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;

  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

// A turn as a 3 by 3 matrix, row by row.
function toMatrix(q: Quat): number[] {
  const [w, x, y, z] = q;

  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

// Which face points up. Opposite faces add up to seven, like a real die.
function topFace(m: number[]): { face: number; flat: number } {
  const axes: Vec3[] = [
    [m[0], m[3], m[6]],
    [m[1], m[4], m[7]],
    [m[2], m[5], m[8]],
  ];
  const faces = [[3, 4], [5, 2], [1, 6]];
  let best = 0;
  let strongest = 0;

  axes.forEach((axis, i) => {
    if (Math.abs(axis[1]) > Math.abs(strongest)) {
      strongest = axis[1];
      best = i;
    }
  });

  return { face: faces[best][strongest < 0 ? 0 : 1], flat: Math.abs(strongest) };
}

const CORNERS: Vec3[] = [];
for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) CORNERS.push([x, y, z]);

function throwOnce(random: () => number): RigidRoll | null {
  const p: Vec3 = [-HALF_WIDTH * 0.78, -(2.1 + random() * 0.7), (random() - 0.5) * 1.2];
  let v: Vec3 = [4.5 + random() * 3, -1 + random() * 1.6, (random() - 0.5) * 2.4];
  let q = normalise([random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5]);
  const axis: Vec3 = [random() - 0.5, random() - 0.5, random() - 0.5];
  const axisLength = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const spin = 16 + random() * 14;
  let w: Vec3 = [(axis[0] / axisLength) * spin, (axis[1] / axisLength) * spin, (axis[2] / axisLength) * spin];

  const positions: Vec3[] = [];
  const rotations: Quat[] = [];
  const hits: number[] = [];
  let calm = 0;
  let m = toMatrix(q);

  // Pushes a corner back out of a wall or the floor and gives the cube a bounce and some grip.
  const resolve = (n: Vec3, depth: number, r: Vec3) => {
    p[0] += n[0] * depth;
    p[1] += n[1] * depth;
    p[2] += n[2] * depth;

    const spinSpeed = cross(w, r);
    const relative: Vec3 = [v[0] + spinSpeed[0], v[1] + spinSpeed[1], v[2] + spinSpeed[2]];
    const approach = dot(relative, n);
    if (approach >= 0) return;

    const rn = cross(r, n);
    const denominator = 1 + dot(rn, rn) / INERTIA;
    const bounce = -approach > 0.9 ? BOUNCE : 0;
    const impulse = (-(1 + bounce) * approach) / denominator;

    v[0] += n[0] * impulse;
    v[1] += n[1] * impulse;
    v[2] += n[2] * impulse;
    w[0] += (rn[0] * impulse) / INERTIA;
    w[1] += (rn[1] * impulse) / INERTIA;
    w[2] += (rn[2] * impulse) / INERTIA;
    if (impulse > 0.3) hits.push(positions.length);

    const spinSpeed2 = cross(w, r);
    const relative2: Vec3 = [v[0] + spinSpeed2[0], v[1] + spinSpeed2[1], v[2] + spinSpeed2[2]];
    const normalPart = dot(relative2, n);
    const slide: Vec3 = [relative2[0] - n[0] * normalPart, relative2[1] - n[1] * normalPart, relative2[2] - n[2] * normalPart];
    const slideSpeed = Math.hypot(slide[0], slide[1], slide[2]);

    if (slideSpeed > 1e-6) {
      const t: Vec3 = [slide[0] / slideSpeed, slide[1] / slideSpeed, slide[2] / slideSpeed];
      const rt = cross(r, t);
      const grip = Math.min(slideSpeed / (1 + dot(rt, rt) / INERTIA), FRICTION * impulse);

      v[0] -= t[0] * grip;
      v[1] -= t[1] * grip;
      v[2] -= t[2] * grip;
      w[0] -= (rt[0] * grip) / INERTIA;
      w[1] -= (rt[1] * grip) / INERTIA;
      w[2] -= (rt[2] * grip) / INERTIA;
    }
  };

  for (let step = 0; step < 1500; step++) {
    v[1] += GRAVITY * STEP;
    p[0] += v[0] * STEP;
    p[1] += v[1] * STEP;
    p[2] += v[2] * STEP;

    const change = multiply([0, w[0], w[1], w[2]], q);
    q = normalise([
      q[0] + 0.5 * STEP * change[0],
      q[1] + 0.5 * STEP * change[1],
      q[2] + 0.5 * STEP * change[2],
      q[3] + 0.5 * STEP * change[3],
    ]);
    m = toMatrix(q);

    let touching = false;

    for (let pass = 0; pass < 3; pass++) {
      for (const c of CORNERS) {
        const r: Vec3 = [
          m[0] * c[0] + m[1] * c[1] + m[2] * c[2],
          m[3] * c[0] + m[4] * c[1] + m[5] * c[2],
          m[6] * c[0] + m[7] * c[1] + m[8] * c[2],
        ];
        const x = p[0] + r[0];
        const y = p[1] + r[1];
        const z = p[2] + r[2];

        if (y > 0) { resolve([0, -1, 0], y, r); touching = true; }
        if (x < -HALF_WIDTH) resolve([1, 0, 0], -HALF_WIDTH - x, r);
        if (x > HALF_WIDTH) resolve([-1, 0, 0], x - HALF_WIDTH, r);
        if (z < -HALF_DEPTH) resolve([0, 0, 1], -HALF_DEPTH - z, r);
        if (z > HALF_DEPTH) resolve([0, 0, -1], z - HALF_DEPTH, r);
      }
    }

    const speed = Math.hypot(v[0], v[1], v[2]);
    const turning = Math.hypot(w[0], w[1], w[2]);
    // A little air and rolling drag, and a faster fade once it is barely moving on the floor.
    const nearlyStill = touching && speed < 0.3 && turning < 1.2;
    const drag = nearlyStill ? 0.94 : 1 - 0.25 * STEP;
    w = [w[0] * drag, w[1] * drag, w[2] * drag];
    if (nearlyStill) v = [v[0] * 0.95, v[1] * 0.95, v[2] * 0.95];

    if (step % 2 === 0) {
      positions.push([p[0], p[1], p[2]]);
      rotations.push([q[0], q[1], q[2], q[3]]);
    }

    if (speed < 0.09 && turning < 0.25) {
      if (++calm > 40) break;
    } else {
      calm = 0;
    }
  }

  if (calm <= 40) return null;

  const top = topFace(m);
  if (top.flat < 0.995 || positions.length < 150 || positions.length > 420) return null;

  return { positions, rotations, hits, face: top.face };
}

const cache = new Map<string, RigidRoll>();

// A roll that ends with `target` face up. The same seed always gives the same roll.
export function rigidRoll(seed: number, target: number): RigidRoll {
  const key = `${seed}|${target}`;
  const known = cache.get(key);
  if (known) return known;
  if (cache.size > 20) cache.clear();

  let found: RigidRoll | null = null;
  let fallback: RigidRoll | null = null;

  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const roll = throwOnce(mulberry32(seed * 7919 + tries));
    if (!roll) continue;

    fallback = fallback ?? roll;

    if (roll.face === target) {
      found = roll;
      break;
    }
  }

  // If no throw found the wanted face, the page puts the winner on whichever face did end up on top.
  const result = found ??
    fallback ?? { positions: [[0, -0.5, 0]], rotations: [[1, 0, 0, 0]], hits: [], face: target };
  cache.set(key, result);

  return result;
}

// The share of the recorded roll to show a given time after it begins. The roll plays in real time
// and then rests. If the length leaves too little room it is squeezed to fit.
export function rollFraction(sinceSec: number, availableSec: number, roll: RigidRoll): number {
  const rollSec = Math.max(0.5, (roll.positions.length - 1) / ROLL_FPS);
  const playSec = Math.min(rollSec, Math.max(0.3, availableSec - 0.25));

  return Math.min(1, Math.max(0, (sinceSec - 0.12) / playSec));
}

export type RollPose = {
  // A CSS matrix3d() that puts the cube where it is and turns it as it is.
  cube: string;
  // Where the shadow sits on the floor, and how high the cube is above it, in cube sides.
  x: number;
  z: number;
  height: number;
};

export function rollPose(roll: RigidRoll, fraction: number): RollPose {
  const last = roll.positions.length - 1;
  const f = Math.min(1, Math.max(0, fraction)) * last;
  const i = Math.min(Math.max(last - 1, 0), Math.floor(f));
  const u = f - i;
  const a = roll.positions[i];
  const b = roll.positions[Math.min(last, i + 1)];
  const qa = roll.rotations[i];
  const qb = roll.rotations[Math.min(last, i + 1)];
  const sign = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3] < 0 ? -1 : 1;
  const mix = (from: number, to: number) => from + (to - from) * u;
  const m = toMatrix(
    normalise([mix(qa[0], qb[0] * sign), mix(qa[1], qb[1] * sign), mix(qa[2], qb[2] * sign), mix(qa[3], qb[3] * sign)]),
  );
  const x = mix(a[0], b[0]) * ROLL_UNIT;
  const y = mix(a[1], b[1]) * ROLL_UNIT;
  const z = mix(a[2], b[2]) * ROLL_UNIT;

  return {
    cube: `matrix3d(${m[0]},${m[3]},${m[6]},0,${m[1]},${m[4]},${m[7]},0,${m[2]},${m[5]},${m[8]},0,${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},1)`,
    x,
    z,
    height: Math.max(0, -mix(a[1], b[1]) - 0.5),
  };
}

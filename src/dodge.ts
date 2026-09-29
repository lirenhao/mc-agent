export type Point = { x: number; z: number };

export type DodgeCandidate = {
  name: string;
  x: number;
  z: number;
  distance: number;
  hostile: boolean;
  projectile: boolean;
  player: boolean;
  closing: boolean;
};

export type DodgeKind = "flee" | "strafe";

export type DodgeChoice = { index: number; kind: DodgeKind };

const MELEE = 3.4;
const CREEP_FLEE = 7;
const LOW_HEALTH = 6;

export function unitAway(from: Point, threat: Point): Point | undefined {
  const x = from.x - threat.x;
  const z = from.z - threat.z;
  const len = Math.hypot(x, z);
  if (len < 0.05) return undefined;
  return { x: x / len, z: z / len };
}

export function strafeOf(away: Point, side: 1 | -1): Point {
  const x = -away.z * side * 0.85 + away.x * 0.15;
  const z = away.x * side * 0.85 + away.z * 0.15;
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}

export function controlsFor(yaw: number, dir: Point): { forward: boolean; back: boolean; left: boolean; right: boolean } {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  const forwardAmt = dir.x * fx + dir.z * fz;
  const rightAmt = dir.x * rx + dir.z * rz;
  return {
    forward: forwardAmt > 0.4,
    back: forwardAmt < -0.4,
    right: rightAmt > 0.4,
    left: rightAmt < -0.4,
  };
}

export function isClosing(from: Point, velocity: Point, target: Point): boolean {
  const toX = target.x - from.x;
  const toZ = target.z - from.z;
  const speed = Math.hypot(velocity.x, velocity.z);
  const dist = Math.hypot(toX, toZ);
  if (speed < 0.02 || dist < 0.2 || dist > 12) return false;
  return (velocity.x * toX + velocity.z * toZ) / (speed * dist) > 0.55;
}

export function pickDodge(input: {
  health: number;
  justHurt: boolean;
  sparring: boolean;
  candidates: DodgeCandidate[];
}): DodgeChoice | undefined {
  let best: DodgeChoice & { rank: number; distance: number } | undefined;
  for (let index = 0; index < input.candidates.length; index += 1) {
    const candidate = input.candidates[index];
    const kind = kindFor(candidate, input);
    if (!kind) continue;
    const rank = kind === "flee" ? 0 : candidate.projectile ? 1 : 2;
    if (!best || rank < best.rank || (rank === best.rank && candidate.distance < best.distance)) {
      best = { index, kind, rank, distance: candidate.distance };
    }
  }
  return best ? { index: best.index, kind: best.kind } : undefined;
}

function kindFor(
  candidate: DodgeCandidate,
  input: { health: number; justHurt: boolean; sparring: boolean },
): DodgeKind | undefined {
  if (candidate.projectile) return candidate.closing && candidate.distance < 12 ? "strafe" : undefined;
  if (candidate.player) {
    if (candidate.distance >= 4) return undefined;
    if (input.sparring || input.justHurt) return "strafe";
    return undefined;
  }
  if (!candidate.hostile) return input.justHurt && candidate.distance < 5 ? "strafe" : undefined;
  if (candidate.name === "creeper" && candidate.distance < CREEP_FLEE) return "flee";
  if (input.health <= LOW_HEALTH && candidate.distance < 8) return "flee";
  if (candidate.distance < MELEE) return "strafe";
  if (input.justHurt && candidate.distance < 8) return "strafe";
  return undefined;
}

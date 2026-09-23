export const DROP_SPAWN_RADIUS = 4;
export const DROP_CLAIM_RADIUS = 12;
export const DROP_CHASE_RADIUS = 32;
export const DROP_LIFE_MS = 5 * 60_000;
export const DROP_GIVE_UP_MS = 8_000;

export function isDroppedItemName(name?: string): boolean {
  return name === "item" || name === "Item" || name === "item_stack";
}

export function isChildDrop(distanceToChild: number, radius = DROP_SPAWN_RADIUS): boolean {
  return Number.isFinite(distanceToChild) && distanceToChild <= radius;
}

type Point = { x: number; y: number; z: number };

type DropEntity = {
  id: number;
  name?: string;
  position: Point;
  getDroppedItem?: () => { type?: number; stackSize?: number } | null;
};

type DropWorld = {
  entity?: { position: Point };
  entities: Record<string, DropEntity | undefined>;
  players: Record<string, { entity?: { position: Point } } | undefined>;
};

function apart(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Item entities that appeared beside the companion player. */
export class ChildDrops {
  private readonly noticed = new Map<number, number>();
  private ignoreUntil = 0;
  private attempt?: { id: number; since: number };

  ignore(ms: number): void {
    this.ignoreUntil = Date.now() + ms;
  }

  get ignoring(): boolean {
    return Date.now() < this.ignoreUntil;
  }

  notice(entity: DropEntity, childPosition: { x: number; y: number; z: number } | undefined, now = Date.now()): boolean {
    if (this.ignoring || !isDroppedItemName(entity.name) || !childPosition) return false;
    if (!isChildDrop(apart(entity.position, childPosition))) return false;
    this.noticed.set(entity.id, now);
    return true;
  }

  forget(id: number): void {
    this.noticed.delete(id);
    if (this.attempt?.id === id) this.attempt = undefined;
  }

  claim(world: DropWorld, childName: string, radius: number, now = Date.now()): number {
    const child = world.players[childName]?.entity;
    if (!child) return 0;
    let added = 0;
    for (const entity of Object.values(world.entities)) {
      if (!entity || !isDroppedItemName(entity.name)) continue;
      if (!isChildDrop(apart(entity.position, child.position), radius)) continue;
      if (!this.noticed.has(entity.id)) added += 1;
      this.noticed.set(entity.id, this.noticed.get(entity.id) ?? now);
    }
    return added;
  }

  has(world: DropWorld, childName: string, now = Date.now()): boolean {
    return Boolean(this.next(world, childName, now));
  }

  next(world: DropWorld, childName: string, now = Date.now()): DropEntity | undefined {
    const child = world.players[childName]?.entity;
    const bot = world.entity;
    if (!child || !bot) return undefined;
    let best: DropEntity | undefined;
    let bestDistance = Infinity;
    for (const [id, at] of this.noticed) {
      if (now - at > DROP_LIFE_MS) {
        this.forget(id);
        continue;
      }
      const entity = world.entities[id];
      if (!entity || !isDroppedItemName(entity.name)) {
        this.forget(id);
        continue;
      }
      if (!isChildDrop(apart(entity.position, child.position), DROP_CHASE_RADIUS)) continue;
      const distance = apart(entity.position, bot.position);
      if (distance < bestDistance) {
        best = entity;
        bestDistance = distance;
      }
    }
    return best;
  }

  attemptAge(id: number, now = Date.now()): number {
    if (this.attempt?.id !== id) this.attempt = { id, since: now };
    return now - this.attempt.since;
  }
}

import type { ActionIntent } from "./types.js";

const PLANKS = ["oak_planks", "spruce_planks"];
const LOGS = ["oak_log", "spruce_log"];

/** A 4×4 hut: log corners, plank walls, a door facing the bot, a window, and a roof. */
function cabinPlan(): Array<{ dx: number; dy: number; dz: number; names: string[] }> {
  const size = 4;
  const blocks: Array<{ dx: number; dy: number; dz: number; names: string[] }> = [];
  const corner = (x: number, z: number) => (x === 0 || x === size - 1) && (z === 0 || z === size - 1);
  const edge = (x: number, z: number) => x === 0 || z === 0 || x === size - 1 || z === size - 1;
  const door = (x: number, z: number, y: number) => x === 0 && z === 1 && y < 2;
  const window = (x: number, z: number, y: number) => x === size - 1 && z === 1 && y === 1;
  for (let x = 1; x <= 2; x += 1) {
    for (let z = 1; z <= 2; z += 1) blocks.push({ dx: x, dy: 0, dz: z, names: PLANKS });
  }
  for (let y = 0; y <= 2; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (let z = 0; z < size; z += 1) {
        if (!edge(x, z) || door(x, z, y) || window(x, z, y)) continue;
        blocks.push({ dx: x, dy: y, dz: z, names: corner(x, z) ? LOGS : PLANKS });
      }
    }
  }
  const roof: Array<{ x: number; z: number; edge: boolean }> = [];
  for (let x = 0; x < size; x += 1) {
    for (let z = 0; z < size; z += 1) roof.push({ x, z, edge: edge(x, z) });
  }
  roof.sort((a, b) => Number(b.edge) - Number(a.edge));
  for (const cell of roof) blocks.push({ dx: cell.x, dy: 3, dz: cell.z, names: PLANKS });
  return blocks;
}

export const templateBlocks: Record<string, Array<{ dx: number; dy: number; dz: number; names: string[] }>> = {
  cabin: cabinPlan(),
  farm: [
    { dx: 0, dy: 0, dz: 0, names: ["oak_fence", "spruce_fence"] }, { dx: 1, dy: 0, dz: 0, names: ["oak_fence", "spruce_fence"] },
    { dx: 2, dy: 0, dz: 0, names: ["oak_fence", "spruce_fence"] }, { dx: 0, dy: 0, dz: 1, names: ["oak_fence", "spruce_fence"] },
    { dx: 2, dy: 0, dz: 1, names: ["oak_fence", "spruce_fence"] }, { dx: 0, dy: 0, dz: 2, names: ["oak_fence", "spruce_fence"] },
    { dx: 1, dy: 0, dz: 2, names: ["oak_fence", "spruce_fence"] }, { dx: 2, dy: 0, dz: 2, names: ["oak_fence", "spruce_fence"] },
  ],
  camp: [
    { dx: 0, dy: 0, dz: 0, names: ["campfire"] }, { dx: -1, dy: 0, dz: 0, names: ["oak_log", "spruce_log"] },
    { dx: 1, dy: 0, dz: 0, names: ["oak_log", "spruce_log"] }, { dx: 0, dy: 0, dz: -1, names: ["oak_log", "spruce_log"] },
    { dx: 0, dy: 0, dz: 1, names: ["oak_log", "spruce_log"] },
  ],
};

type Need = { names: string[]; count: number };

/** Drop gathering the task already has in the inventory, and craft what the rest can make. */
export function prepareTaskSteps(steps: ActionIntent[], have: Record<string, number>): ActionIntent[] {
  const buildAt = steps.findIndex((step) => step.type.toLowerCase() === "build" && step.template && templateBlocks[step.template]);
  if (buildAt < 0) return steps;
  const template = steps[buildAt].template ?? "";
  const stock = { ...have };
  const collects = new Map<string, { count: number; label: string }>();
  const crafts: ActionIntent[] = [];
  const needs = groupedNeeds(templateBlocks[template]).sort((a, b) => Number(isPlanks(b.names)) - Number(isPlanks(a.names)));
  for (const need of needs) {
    let left = take(stock, need.names, need.count);
    if (left <= 0) continue;
    if (isPlanks(need.names)) {
      const logs = need.names.map((name) => name.replace(/_planks$/, "_log"));
      while (left > 0) {
        const log = logs.find((name) => (stock[name] ?? 0) > 0);
        if (!log) break;
        stock[log] -= 1;
        left -= Math.min(4, left);
        addCraft(crafts, log.replace(/_log$/, "_planks"), need.count);
      }
      if (left > 0) {
        const log = logs[0] ?? "oak_log";
        const batches = Math.ceil(left / 4);
        addCollect(collects, log, batches, "木头");
        addCraft(crafts, log.replace(/_log$/, "_planks"), need.count);
      }
      continue;
    }
    addCollect(collects, need.names[0], left, labelFor(need.names[0]));
  }
  const gather = [...collects.entries()].map(([block, item]) => ({
    type: "collect",
    block,
    count: item.count,
    label: item.label,
  }));
  const rest = steps.filter((step, index) => {
    if (index >= buildAt) return true;
    const type = step.type.toLowerCase();
    return type !== "collect" && type !== "mine" && type !== "harvest" && type !== "come";
  });
  const nextBuild = rest.findIndex((step) => step.type.toLowerCase() === "build" && step.template === template);
  return [...rest.slice(0, nextBuild), ...gather, ...crafts, ...rest.slice(nextBuild)];
}

export function buildReply(steps: ActionIntent[], fallback: string): string {
  if (!steps.some((step) => step.type.toLowerCase() === "build")) return fallback;
  const collect = steps.some((step) => step.type.toLowerCase() === "collect");
  const craft = steps.some((step) => step.type.toLowerCase() === "craft");
  if (!collect && craft) return "背包里的木头够了，我先做木板再盖。";
  if (!collect) return "背包里的材料够了，我直接盖。";
  return fallback;
}

function groupedNeeds(plan: Array<{ names: string[] }>): Need[] {
  const groups = new Map<string, Need>();
  for (const entry of plan) {
    const key = entry.names.join("|");
    const group = groups.get(key) ?? { names: entry.names, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}

function take(stock: Record<string, number>, names: string[], count: number): number {
  let left = count;
  for (const name of names) {
    const used = Math.min(left, stock[name] ?? 0);
    stock[name] = (stock[name] ?? 0) - used;
    left -= used;
  }
  return left;
}

function addCollect(collects: Map<string, { count: number; label: string }>, item: string, count: number, label: string): void {
  const current = collects.get(item);
  if (current) current.count += count;
  else collects.set(item, { count, label });
}

function addCraft(crafts: ActionIntent[], item: string, count: number): void {
  if (crafts.some((step) => step.item === item)) return;
  crafts.push({ type: "craft", item, count, label: "木板" });
}

function isPlanks(names: string[]): boolean {
  return names.some((name) => name.endsWith("_planks"));
}

function labelFor(item: string): string {
  if (item.endsWith("_log") || item.endsWith("_planks")) return "木头";
  if (item.endsWith("_fence")) return "栅栏";
  if (item === "campfire") return "营火";
  return item;
}

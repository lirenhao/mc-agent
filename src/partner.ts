import type { Block } from "prismarine-block";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";

export type Assist =
  | { kind: "follow" }
  | { kind: "fight"; entity: string; label: string }
  | { kind: "mine"; block: string; label: string; avoid?: Vec3 }
  | { kind: "errand"; block: string; label: string }
  | { kind: "light" };

const ERRANDS: Array<{ names: string[]; label: string }> = [
  { names: ["dandelion", "poppy", "azure_bluet", "oxeye_daisy", "cornflower", "allium", "blue_orchid"], label: "花" },
  { names: ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log"], label: "木头" },
];

/** Watches the companion player and suggests a nearby cooperative action. */
export class Partner {
  private miningUntil = 0;
  private miningBlock = "";
  private miningAt?: Vec3;

  bind(bot: Bot, childName: string): void {
    const onBreak = (block: { name?: string; position: Vec3 } | null, _stage: number, entity?: { id?: number }): void => {
      const child = bot.players[childName]?.entity;
      if (!block?.name || block.name === "air" || !entity || !child || entity.id !== child.id) return;
      this.miningUntil = Date.now() + 6_000;
      this.miningBlock = block.name;
      this.miningAt = block.position;
    };
    bot.on("blockBreakProgressObserved", onBreak as (block: Block, destroyStage: number) => void);
  }

  decide(bot: Bot, childName: string, options: { canErrand: boolean; canLight: boolean }): Assist {
    const child = bot.players[childName]?.entity;
    if (!child) return { kind: "follow" };

    const threat = nearestThreat(bot, child.position, 8);
    if (threat) return { kind: "fight", entity: threat.name, label: threatLabel(threat.name) };

    if (Date.now() < this.miningUntil && this.miningBlock) {
      return { kind: "mine", block: this.miningBlock, label: blockLabel(this.miningBlock), avoid: this.miningAt };
    }

    if (options.canLight && bot.inventory.items().some((item) => item.name === "torch" || item.name === "soul_torch")) {
      return { kind: "light" };
    }

    if (options.canErrand) {
      const errand = nearestErrand(bot, child.position);
      if (errand) return { kind: "errand", block: errand.block, label: errand.label };
    }

    return { kind: "follow" };
  }
}

function nearestThreat(bot: Bot, position: Vec3, radius: number): { name: string } | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const entity of Object.values(bot.entities)) {
    if (entity.type !== "mob" || !entity.name) continue;
    if (!["zombie", "skeleton", "spider", "witch", "drowned", "husk", "creeper", "slime"].includes(entity.name)) continue;
    const distance = entity.position.distanceTo(position);
    if (distance > radius) continue;
    if (!best || distance < best.distance) best = { name: entity.name, distance };
  }
  return best;
}

function nearestErrand(bot: Bot, position: Vec3): { block: string; label: string } | undefined {
  let best: { block: string; label: string; distance: number } | undefined;
  for (const group of ERRANDS) {
    const ids = group.names.map((name) => bot.registry.blocksByName[name]?.id).filter((id): id is number => id !== undefined);
    if (!ids.length) continue;
    const positions = bot.findBlocks({ matching: ids, maxDistance: 16, count: 6 });
    for (const pos of positions) {
      const distance = pos.distanceTo(position);
      if (distance < 2 || distance > 14) continue;
      if (!best || distance < best.distance) {
        const block = bot.blockAt(pos);
        best = { block: block?.name ?? group.names[0], label: group.label, distance };
      }
    }
  }
  return best ? { block: best.block, label: best.label } : undefined;
}

function blockLabel(name: string): string {
  if (name.includes("log") || name.includes("wood")) return "木头";
  if (name.includes("ore")) return "矿";
  if (name.includes("flower") || /dandelion|poppy|tulip|orchid|daisy|cornflower|allium/.test(name)) return "花";
  return "方块";
}

function threatLabel(name: string): string {
  return ({
    zombie: "僵尸",
    skeleton: "骷髅",
    spider: "蜘蛛",
    witch: "女巫",
    drowned: "溺尸",
    husk: "尸壳",
    creeper: "苦力怕",
    slime: "史莱姆",
  })[name] ?? name;
}

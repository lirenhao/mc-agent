import type { Bot } from "mineflayer";
import { goals, Movements } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { config } from "./config.js";
import type { BuildTemplate, ResourceName, SkillName, WorldState } from "./types.js";

const resourceBlocks: Record<ResourceName, string[]> = {
  wood: ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
  stone: ["stone", "cobblestone"],
  coal: ["coal_ore", "deepslate_coal_ore"],
  iron: ["iron_ore", "deepslate_iron_ore"],
};

const templateBlocks: Record<BuildTemplate, Array<{ dx: number; dy: number; dz: number; names: string[] }>> = {
  cabin: [
    { dx: 0, dy: 0, dz: 0, names: ["oak_planks", "spruce_planks"] }, { dx: 1, dy: 0, dz: 0, names: ["oak_planks", "spruce_planks"] },
    { dx: 0, dy: 0, dz: 1, names: ["oak_planks", "spruce_planks"] }, { dx: 1, dy: 0, dz: 1, names: ["oak_planks", "spruce_planks"] },
    { dx: 0, dy: 1, dz: 0, names: ["oak_log", "spruce_log"] }, { dx: 1, dy: 1, dz: 0, names: ["oak_log", "spruce_log"] },
    { dx: 0, dy: 1, dz: 1, names: ["oak_log", "spruce_log"] }, { dx: 1, dy: 1, dz: 1, names: ["oak_log", "spruce_log"] },
  ],
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

export class SkillController {
  private protectionTimer?: NodeJS.Timeout;

  constructor(private readonly bot: Bot) {}

  stop(): void {
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    this.stopProtection();
  }

  follow(playerName: string): string {
    const player = this.bot.players[playerName];
    if (!player?.entity) return "我现在看不到你，靠近我一点再试试。";
    this.stopProtection();
    this.bot.pathfinder.setMovements(new Movements(this.bot));
    this.bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
    return "好，我跟着你。";
  }

  findResource(resource: ResourceName): string {
    this.stopProtection();
    const ids = resourceBlocks[resource].map((name) => this.bot.registry.blocksByName[name]?.id).filter((id): id is number => id !== undefined);
    const block = this.bot.findBlock({ matching: ids, maxDistance: 64 });
    if (!block) return `附近还没有发现${resourceLabel(resource)}，我带你往前探索。`;
    this.bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
    return `我发现${resourceLabel(resource)}了，跟我来；找到后我们一起采。`;
  }

  protect(playerName: string): string {
    this.stopProtection();
    const defend = (): void => {
      const player = this.bot.players[playerName];
      const hostile = this.nearestHostile();
      if (!hostile) {
        if (player?.entity) this.bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
        return;
      }
      // Creepers are handled by retreating, not by attacking beside the child.
      if (hostile.name === "creeper" || this.bot.health <= 6) {
        this.bot.pathfinder.setGoal(new goals.GoalNear(this.bot.entity.position.x - 8, this.bot.entity.position.y, this.bot.entity.position.z - 8, 2));
        return;
      }
      if (hostile.position.distanceTo(this.bot.entity.position) < 3.2) this.bot.attack(hostile);
      else this.bot.pathfinder.setGoal(new goals.GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2));
    };
    defend();
    this.protectionTimer = setInterval(defend, 900);
    return "我会留意附近的怪物，危险时先带你撤开。";
  }

  async build(template: BuildTemplate): Promise<string> {
    this.stopProtection();
    const origin = this.bot.entity.position.floored().offset(2, 0, 0);
    const plan = templateBlocks[template];
    const missing = plan.find((entry) => !entry.names.some((name) => this.bot.inventory.items().some((item) => item.name === name)));
    if (missing) return `我背包里的材料不够。我们先一起准备${template === "farm" ? "栅栏" : template === "camp" ? "营火和原木" : "木板和原木"}。`;
    let placed = 0;
    for (const entry of plan) {
      const target = origin.offset(entry.dx, entry.dy, entry.dz);
      const existing = this.bot.blockAt(target);
      if (!existing || existing.name !== "air") continue; // Never overwrite a player's structure.
      const material = this.bot.inventory.items().find((item) => entry.names.includes(item.name));
      const reference = this.bot.blockAt(target.offset(0, -1, 0));
      if (!material || !reference) continue;
      try {
        await this.bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2));
        await this.bot.equip(material, "hand");
        await this.bot.placeBlock(reference, new Vec3(0, 1, 0));
        placed += 1;
      } catch (error) {
        console.warn("放置方块失败：", error);
      }
    }
    return placed ? `我先放好了 ${placed} 个方块，我们一起把${templateLabel(template)}完成吧。` : "这里不适合直接建造；请在平坦空地旁边再叫我一次。";
  }

  status(state: WorldState): string {
    return `我有 ${state.health}/20 生命、${state.food}/20 饥饿值。附近${state.hostiles.length ? `有${state.hostiles[0].name}` : "很安全"}。`;
  }

  async run(action: SkillName, playerName: string, resource?: ResourceName, template?: BuildTemplate, state?: WorldState): Promise<string> {
    if (action === "stop") { this.stop(); return "好，我停在这里等你。"; }
    if (action === "follow") return this.follow(playerName);
    if (action === "find_resource" && resource) return this.findResource(resource);
    if (action === "protect") return this.protect(playerName);
    if (action === "build" && template) return this.build(template);
    if (action === "status" && state) return this.status(state);
    return "我没听明白。可以说跟着我、带我找煤，或盖小木屋。";
  }

  private nearestHostile() {
    const hostileNames = new Set(["zombie", "skeleton", "spider", "witch", "drowned", "husk", "creeper"]);
    return this.bot.nearestEntity((entity) => entity.type === "mob" && hostileNames.has(entity.name) && entity.position.distanceTo(this.bot.entity.position) < 14);
  }

  private stopProtection(): void {
    if (this.protectionTimer) clearInterval(this.protectionTimer);
    this.protectionTimer = undefined;
  }
}

function resourceLabel(resource: ResourceName): string { return ({ wood: "木头", stone: "石头", coal: "煤矿", iron: "铁矿" })[resource]; }
function templateLabel(template: BuildTemplate): string { return ({ cabin: "小木屋", farm: "围栏农场", camp: "篝火营地" })[template]; }

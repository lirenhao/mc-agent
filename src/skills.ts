import type { Bot } from "mineflayer";
import "mineflayer-collectblock";
import pathfinderModule from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import type { ActionIntent, BuildTemplate, Task, WorldState } from "./types.js";

const { goals, Movements } = pathfinderModule;

const resourceBlocks: Record<string, string[]> = {
  wood: ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
  stone: ["stone", "cobblestone"],
  coal: ["coal_ore", "deepslate_coal_ore"],
  iron: ["iron_ore", "deepslate_iron_ore"],
};

const templateBlocks: Record<string, Array<{ dx: number; dy: number; dz: number; names: string[] }>> = {
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

const neverAttack = new Set(["player", "villager", "wandering_trader", "iron_golem", "snow_golem", "cat", "wolf", "allay", "parrot"]);

export class SkillController {
  private protectionTimer?: NodeJS.Timeout;

  constructor(private readonly bot: Bot) {}

  stop(): void {
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    this.stopProtection();
    void this.bot.collectBlock?.cancelTask();
  }

  async run(action: string, playerName: string, task: Task, state: WorldState): Promise<string> {
    const intent = task.intents[action] ?? { type: action, block: task.resource, template: task.template, label: task.reply };
    return this.perform(intent, playerName, task, state);
  }

  private async perform(intent: ActionIntent, playerName: string, task: Task, state: WorldState): Promise<string> {
    const type = intent.type.toLowerCase();
    if (type === "clarify") return task.reply;
    if (type === "stop") { this.stop(); return "好，我停在这里等你。"; }
    if (type === "follow") return this.follow(playerName);
    if (type === "protect") return this.protect(playerName);
    if (type === "status") return this.status(state);
    if (type === "find" || type === "find_resource") return this.find(intent);
    if (type === "collect" || type === "mine" || type === "harvest") return this.collect(intent);
    if (type === "attack" || type === "hunt") return this.attack(intent);
    if (type === "build") return this.build(intent);
    if (type === "place") return this.place(intent);
    if (type === "give" || type === "toss") return this.give(intent, playerName);
    if (type === "goto") return this.goto(intent, playerName);
    if (type === "come") return this.come(playerName);
    if (type === "explore") return this.explore();
    if (type === "dance" || type === "jump" || type === "emote") return this.dance();
    if (type === "eat") return this.eat();
    if (type === "look") return this.look(playerName);
    return this.fallback(intent, playerName);
  }

  private follow(playerName: string): string {
    const player = this.bot.players[playerName];
    if (!player?.entity) return "我现在看不到你，靠近我一点再试试。";
    this.stopProtection();
    this.bot.pathfinder.setMovements(new Movements(this.bot));
    this.bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
    return "好，我跟着你。";
  }

  private find(intent: ActionIntent): string {
    this.stopProtection();
    const names = this.resolveBlocks(intent.block);
    const ids = names.map((name) => this.bot.registry.blocksByName[name]?.id).filter((id): id is number => id !== undefined);
    const label = intent.label ?? intent.block ?? "那个";
    const block = ids.length ? this.bot.findBlock({ matching: ids, maxDistance: 64 }) : null;
    if (!block) {
      this.walkAhead();
      return `附近还没有发现${label}，我先带你往前探索。`;
    }
    this.bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
    return `我发现${label}了，跟我来。`;
  }

  private async collect(intent: ActionIntent): Promise<string> {
    this.stopProtection();
    const names = this.resolveBlocks(intent.block);
    const ids = names.map((name) => this.bot.registry.blocksByName[name]?.id).filter((id): id is number => id !== undefined);
    const label = intent.label ?? intent.block ?? "这个";
    if (!ids.length || !this.bot.collectBlock) {
      return this.find(intent);
    }
    const count = intent.count ?? 3;
    const blocks = this.bot.findBlocks({ matching: ids, maxDistance: 64, count });
    if (!blocks.length) {
      this.walkAhead();
      return `附近没有${label}，我先往前找一找。`;
    }
    const targets = blocks.map((pos) => this.bot.blockAt(pos)).filter((block): block is NonNullable<typeof block> => Boolean(block));
    try {
      this.bot.pathfinder.setMovements(new Movements(this.bot));
      await this.bot.collectBlock.collect(targets, { ignoreNoPath: true });
      return `我采到了一些${label}。`;
    } catch (error) {
      console.warn("采集失败：", error);
      return `我没采全${label}，我们再试一次吧。`;
    }
  }

  private attack(intent: ActionIntent): string {
    this.stopProtection();
    const targetName = intent.entity?.toLowerCase();
    const entity = this.bot.nearestEntity((candidate) => {
      if (!candidate.name) return false;
      if (candidate.type === "player" || neverAttack.has(candidate.name)) return false;
      if (candidate.position.distanceTo(this.bot.entity.position) > 16) return false;
      if (targetName) return candidate.name === targetName || candidate.name.includes(targetName);
      return candidate.type === "mob" && this.isHostile(candidate.name);
    });
    if (!entity) {
      this.walkAhead();
      return intent.entity ? `附近没有${intent.label ?? intent.entity}。` : "附近暂时没有要对付的东西。";
    }
    if (entity.name === "creeper") {
      this.bot.pathfinder.setGoal(new goals.GoalNear(this.bot.entity.position.x - 8, this.bot.entity.position.y, this.bot.entity.position.z - 8, 2));
      return "那是苦力怕，我们先撤开。";
    }
    this.bot.pathfinder.setGoal(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2));
    if (entity.position.distanceTo(this.bot.entity.position) < 3.2) this.bot.attack(entity);
    return `我去对付${intent.label ?? entity.name}。`;
  }

  private protect(playerName: string): string {
    this.stopProtection();
    const defend = (): void => {
      const player = this.bot.players[playerName];
      const hostile = this.nearestHostile();
      if (!hostile) {
        if (player?.entity) this.bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
        return;
      }
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

  private async build(intent: ActionIntent): Promise<string> {
    this.stopProtection();
    const template = (intent.template ?? "") as BuildTemplate;
    const plan = templateBlocks[template];
    if (!plan) return this.place(intent);
    const origin = this.bot.entity.position.floored().offset(2, 0, 0);
    const missing = plan.find((entry) => !entry.names.some((name) => this.bot.inventory.items().some((item) => item.name === name)));
    if (missing) return `我背包里的材料不够。我们先一起准备${template === "farm" ? "栅栏" : template === "camp" ? "营火和原木" : "木板和原木"}。`;
    let placed = 0;
    for (const entry of plan) {
      if (await this.placeAt(origin.offset(entry.dx, entry.dy, entry.dz), entry.names)) placed += 1;
    }
    return placed ? `我先放好了 ${placed} 个方块，我们一起把${templateLabel(template)}完成吧。` : "这里不适合直接建造；请在平坦空地旁边再叫我一次。";
  }

  private async place(intent: ActionIntent): Promise<string> {
    this.stopProtection();
    const names = this.resolveItems(intent.block ?? intent.item);
    const origin = this.bot.entity.position.floored().offset(2, 0, 0);
    if (await this.placeAt(origin, names.length ? names : undefined)) {
      return `我放下了${intent.label ?? intent.block ?? intent.item ?? "方块"}。`;
    }
    return "我手里没有合适的方块，或这里放不下。";
  }

  private async give(intent: ActionIntent, playerName: string): Promise<string> {
    this.stopProtection();
    const player = this.bot.players[playerName];
    if (!player?.entity) return "我现在看不到你，靠近我一点再试试。";
    const names = this.resolveItems(intent.item ?? intent.block);
    const item = this.bot.inventory.items().find((candidate) => !names.length || names.includes(candidate.name) || candidate.name.includes(intent.item ?? ""));
    if (!item) return `我背包里没有${intent.label ?? intent.item ?? "能送你的东西"}。`;
    try {
      await this.bot.lookAt(player.entity.position.offset(0, 1.2, 0));
      await this.bot.toss(item.type, null, Math.min(intent.count ?? 1, item.count));
      return `给你${intent.label ?? item.name}。`;
    } catch (error) {
      console.warn("丢物品失败：", error);
      return "我没扔出去，再靠近一点吧。";
    }
  }

  private goto(intent: ActionIntent, playerName: string): string {
    this.stopProtection();
    if (intent.x !== undefined && intent.y !== undefined && intent.z !== undefined) {
      this.bot.pathfinder.setGoal(new goals.GoalNear(intent.x, intent.y, intent.z, 2));
      return `我去 ${intent.x}, ${intent.y}, ${intent.z}。`;
    }
    return this.come(playerName);
  }

  private come(playerName: string): string {
    const player = this.bot.players[playerName];
    if (!player?.entity) return "我现在看不到你，靠近我一点再试试。";
    this.stopProtection();
    const pos = player.entity.position.floored();
    this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
    return "我过来了。";
  }

  private explore(): string {
    this.stopProtection();
    this.walkAhead();
    return "我们往前走走看。";
  }

  private async dance(): Promise<string> {
    this.stopProtection();
    this.bot.pathfinder.setGoal(null);
    for (let i = 0; i < 3; i += 1) {
      this.bot.setControlState("jump", true);
      await wait(180);
      this.bot.setControlState("jump", false);
      await wait(220);
    }
    return "看我跳！";
  }

  private async eat(): Promise<string> {
    const food = this.bot.inventory.items().find((item) => this.bot.registry.foodsByName[item.name]);
    if (!food) return "我没有能吃的东西。";
    try {
      await this.bot.equip(food, "hand");
      await this.bot.consume();
      return "我吃了一点东西。";
    } catch (error) {
      console.warn("进食失败：", error);
      return "我现在吃不了。";
    }
  }

  private async look(playerName: string): Promise<string> {
    const player = this.bot.players[playerName];
    if (!player?.entity) return "我现在看不到你。";
    await this.bot.lookAt(player.entity.position.offset(0, 1.6, 0));
    return "我看着你呢。";
  }

  private status(state: WorldState): string {
    return `我有 ${state.health}/20 生命、${state.food}/20 饥饿值。附近${state.hostiles.length ? `有${state.hostiles[0].name}` : "很安全"}。`;
  }

  private fallback(intent: ActionIntent, playerName: string): string {
    if (intent.block || intent.item) return this.find(intent);
    if (intent.entity) return this.attack(intent);
    if (intent.x !== undefined) return this.goto(intent, playerName);
    return this.explore();
  }

  private async placeAt(target: Vec3, names?: string[]): Promise<boolean> {
    const existing = this.bot.blockAt(target);
    if (!existing || existing.name !== "air") return false;
    const material = this.bot.inventory.items().find((item) => !names?.length || names.includes(item.name));
    const reference = this.bot.blockAt(target.offset(0, -1, 0));
    if (!material || !reference || reference.name === "air") return false;
    try {
      await this.bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2));
      await this.bot.equip(material, "hand");
      await this.bot.placeBlock(reference, new Vec3(0, 1, 0));
      return true;
    } catch (error) {
      console.warn("放置方块失败：", error);
      return false;
    }
  }

  private walkAhead(): void {
    const yaw = this.bot.entity.yaw;
    const ahead = this.bot.entity.position.offset(-Math.sin(yaw) * 18, 0, -Math.cos(yaw) * 18).floored();
    this.bot.pathfinder.setGoal(new goals.GoalNear(ahead.x, ahead.y, ahead.z, 2));
  }

  private resolveBlocks(name?: string): string[] {
    if (!name) return [];
    const raw = name.replace(/^minecraft:/, "").toLowerCase();
    if (resourceBlocks[raw]) return resourceBlocks[raw];
    if (this.bot.registry.blocksByName[raw]) return [raw];
    return Object.keys(this.bot.registry.blocksByName).filter((block) => block.includes(raw)).slice(0, 8);
  }

  private resolveItems(name?: string): string[] {
    if (!name) return [];
    const raw = name.replace(/^minecraft:/, "").toLowerCase();
    if (this.bot.registry.itemsByName[raw]) return [raw];
    return Object.keys(this.bot.registry.itemsByName).filter((item) => item.includes(raw)).slice(0, 8);
  }

  private isHostile(name: string): boolean {
    return ["zombie", "skeleton", "spider", "witch", "drowned", "husk", "creeper"].includes(name);
  }

  private nearestHostile() {
    return this.bot.nearestEntity((entity) => entity.type === "mob" && Boolean(entity.name) && this.isHostile(entity.name!) && entity.position.distanceTo(this.bot.entity.position) < 14);
  }

  private stopProtection(): void {
    if (this.protectionTimer) clearInterval(this.protectionTimer);
    this.protectionTimer = undefined;
  }
}

function templateLabel(template: string): string {
  return ({ cabin: "小木屋", farm: "围栏农场", camp: "篝火营地" })[template] ?? template;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { Bot } from "mineflayer";
import "mineflayer-collectblock";
import pathfinderModule from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { isHostileEntity } from "./mobs.js";
import type { ActionIntent, StepResult, WorldState } from "./types.js";

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

export class Skills {
  private buildCursor?: { origin: Vec3; index: number; plan: Array<{ dx: number; dy: number; dz: number; names: string[] }> };

  constructor(private readonly bot: Bot) {}

  stop(): void {
    if (this.bot.isSleeping) void this.bot.wake().catch(() => undefined);
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    this.buildCursor = undefined;
    void this.bot.collectBlock?.cancelTask();
  }

  bedNearby(maxDistance = 32): boolean {
    return Boolean(this.nearestBed(maxDistance));
  }

  keepFollow(playerName: string, distance = 3): boolean {
    const player = this.bot.players[playerName];
    if (!player?.entity) return false;
    this.bot.setControlState("sneak", false);
    this.bot.pathfinder.setMovements(new Movements(this.bot));
    this.bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, distance), true);
    return true;
  }

  keepSit(playerName: string): void {
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    this.bot.setControlState("sneak", true);
    const player = this.bot.players[playerName];
    if (player?.entity) void this.bot.lookAt(player.entity.position.offset(0, 1.2, 0));
  }

  protectOnce(playerName: string): boolean {
    const player = this.bot.players[playerName];
    const hostile = this.nearestHostile();
    if (!hostile) {
      if (player?.entity) this.keepFollow(playerName, 2);
      return false;
    }
    if (hostile.name === "creeper" || this.bot.health <= 6) {
      this.bot.pathfinder.setGoal(new goals.GoalNear(this.bot.entity.position.x - 8, this.bot.entity.position.y, this.bot.entity.position.z - 8, 2));
      return true;
    }
    if (hostile.position.distanceTo(this.bot.entity.position) < 3.2) this.bot.attack(hostile);
    else this.bot.pathfinder.setGoal(new goals.GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2));
    return true;
  }

  nearestHostileDistance(): number | undefined {
    const hostile = this.nearestHostile();
    return hostile ? hostile.position.distanceTo(this.bot.entity.position) : undefined;
  }

  threatNear(position: Vec3, radius: number): { name: string; distance: number } | undefined {
    let closest: { name: string; distance: number } | undefined;
    for (const entity of Object.values(this.bot.entities)) {
      if (!isHostileEntity(entity)) continue;
      const distance = entity.position.distanceTo(position);
      if (distance > radius) continue;
      if (!closest || distance < closest.distance) closest = { name: entity.name, distance };
    }
    return closest;
  }

  async helpGather(blockName: string, playerName: string, radius: number, avoid?: Vec3): Promise<StepResult> {
    const player = this.bot.players[playerName]?.entity;
    if (!player) return { status: "blocked", message: "我现在看不到你。" };
    const names = this.resolveBlocks(blockName);
    const ids = names.map((name) => this.bot.registry.blocksByName[name]?.id).filter((id): id is number => id !== undefined);
    if (!ids.length || !this.bot.collectBlock) return { status: "done" };
    const positions = this.bot.findBlocks({ matching: ids, maxDistance: radius + 8, count: 12 });
    const target = positions
      .map((pos) => this.bot.blockAt(pos))
      .filter((block): block is NonNullable<typeof block> => Boolean(block))
      .filter((block) => block.position.distanceTo(player.position) <= radius)
      .filter((block) => !avoid || block.position.distanceTo(avoid) > 1.2)
      .sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position))[0];
    if (!target) return { status: "done" };
    try {
      this.bot.pathfinder.setMovements(new Movements(this.bot));
      await this.bot.collectBlock.collect(target, { ignoreNoPath: true });
      return { status: "progress" };
    } catch (error) {
      console.warn("配合采集失败：", error);
      return { status: "done" };
    }
  }

  async lightNear(playerName: string): Promise<StepResult> {
    const player = this.bot.players[playerName]?.entity;
    if (!player) return { status: "blocked" };
    if (player.position.distanceTo(this.bot.entity.position) > 5) return this.come(playerName);
    const already = this.bot.findBlock({ matching: (block) => block.name === "torch" || block.name === "soul_torch", maxDistance: 6 });
    if (already && already.position.distanceTo(player.position) < 6) return { status: "done" };
    return this.place({ type: "place", item: "torch", label: "火把" });
  }

  countItems(names: string[]): number {
    if (!names.length) return 0;
    return this.bot.inventory.items().filter((item) => names.includes(item.name)).reduce((sum, item) => sum + item.count, 0);
  }

  resolveBlocks(name?: string): string[] {
    if (!name) return [];
    const raw = name.replace(/^minecraft:/, "").toLowerCase();
    if (resourceBlocks[raw]) return resourceBlocks[raw];
    if (this.bot.registry.blocksByName[raw]) return [raw];
    return Object.keys(this.bot.registry.blocksByName).filter((block) => block.includes(raw)).slice(0, 8);
  }

  resolveItems(name?: string): string[] {
    if (!name) return [];
    const raw = name.replace(/^minecraft:/, "").toLowerCase();
    if (this.bot.registry.itemsByName[raw]) return [raw];
    return Object.keys(this.bot.registry.itemsByName).filter((item) => item.includes(raw)).slice(0, 8);
  }

  async progress(intent: ActionIntent, playerName: string, state: WorldState): Promise<StepResult> {
    const type = intent.type.toLowerCase();
    if (type === "clarify" || type === "status") return { status: "done", message: undefined };
    if (type === "stop") { this.stop(); return { status: "done", message: "好，我停在这里等你。" }; }
    if (type === "follow") {
      const ok = this.keepFollow(playerName);
      return { status: ok ? "done" : "blocked", message: ok ? "好，我跟着你。" : "我现在看不到你。" };
    }
    if (type === "protect") { this.protectOnce(playerName); return { status: "done", message: "我会一直留意怪物。" }; }
    if (type === "wait") return { status: "done" };
    if (type === "come") return this.come(playerName);
    if (type === "goto") return this.goto(intent, playerName);
    if (type === "find" || type === "find_resource") return this.find(intent);
    if (type === "collect" || type === "mine" || type === "harvest") return this.collectOne(intent);
    if (type === "attack" || type === "hunt") return this.attack(intent);
    if (type === "build") return this.buildOne(intent);
    if (type === "place") return this.place(intent);
    if (type === "give" || type === "toss") return this.give(intent, playerName);
    if (type === "explore") return this.explore();
    if (type === "dance" || type === "jump" || type === "emote") return this.dance();
    if (type === "eat") return this.eat();
    if (type === "look") return this.look(playerName);
    if (type === "sit" || type === "sneak" || type === "rest") return this.sit(playerName);
    if (type === "sleep") return this.sleepNight();
    if (type === "tp" || type === "teleport") return this.teleportTo(playerName);
    if (intent.block || intent.item) return this.collectOne({ ...intent, type: "collect" });
    if (intent.entity) return this.attack(intent);
    return this.explore();
  }

  async eatIfHungry(): Promise<boolean> {
    if (this.bot.food > 14) return false;
    const result = await this.eat();
    return result.status === "done";
  }

  status(state: WorldState): string {
    const mission = state.mission ? `正在做「${state.mission.title}」第 ${state.mission.step}/${state.mission.total} 步。` : "现在没有长任务。";
    return `我有 ${state.health}/20 生命、${state.food}/20 饥饿值。${mission}附近${state.hostiles.length ? `有${state.hostiles[0].name}` : "很安全"}。`;
  }

  private come(playerName: string): StepResult {
    const player = this.bot.players[playerName];
    if (!player?.entity) return { status: "blocked", message: "我现在看不到你，靠近我一点再试试。" };
    const pos = player.entity.position;
    if (pos.distanceTo(this.bot.entity.position) <= 3.5) return { status: "done", message: "我到你身边了。" };
    this.bot.pathfinder.setMovements(new Movements(this.bot));
    this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
    return { status: "progress" };
  }

  private goto(intent: ActionIntent, playerName: string): StepResult {
    if (intent.x === undefined || intent.y === undefined || intent.z === undefined) return this.come(playerName);
    const target = new Vec3(intent.x, intent.y, intent.z);
    if (target.distanceTo(this.bot.entity.position) <= 3) return { status: "done", message: `我到 ${intent.label ?? "那里"} 了。` };
    this.bot.pathfinder.setGoal(new goals.GoalNear(intent.x, intent.y, intent.z, 2));
    return { status: "progress" };
  }

  private find(intent: ActionIntent): StepResult {
    const names = this.resolveBlocks(intent.block);
    const ids = names.map((name) => this.bot.registry.blocksByName[name]?.id).filter((id): id is number => id !== undefined);
    const label = intent.label ?? intent.block ?? "那个";
    const block = ids.length ? this.bot.findBlock({ matching: ids, maxDistance: 64 }) : null;
    if (!block) {
      this.walkAhead();
      return { status: "progress", message: `附近还没有${label}，我先往前找。` };
    }
    if (block.position.distanceTo(this.bot.entity.position) <= 3.5) return { status: "done", message: `我找到${label}了。` };
    this.bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
    return { status: "progress" };
  }

  private async collectOne(intent: ActionIntent): Promise<StepResult> {
    const names = this.resolveBlocks(intent.block ?? intent.item);
    const ids = names.map((name) => this.bot.registry.blocksByName[name]?.id).filter((id): id is number => id !== undefined);
    const label = intent.label ?? intent.block ?? "这个";
    if (!ids.length) return { status: "blocked", message: `我不知道${label}长什么样。` };
    if (!this.bot.collectBlock) return this.find(intent);
    const target = this.bot.findBlock({ matching: ids, maxDistance: 64 });
    if (!target) {
      this.walkAhead();
      return { status: "progress", message: `附近没有${label}，我再找找。` };
    }
    try {
      this.bot.pathfinder.setMovements(new Movements(this.bot));
      await this.bot.collectBlock.collect(target, { ignoreNoPath: true });
      return { status: "progress" };
    } catch (error) {
      console.warn("采集失败：", error);
      this.walkAhead();
      return { status: "progress", message: `这块${label}不好采，我换一个。` };
    }
  }

  private async attack(intent: ActionIntent): Promise<StepResult> {
    await this.equipWeapon();
    const targetName = intent.entity?.toLowerCase();
    const entity = this.bot.nearestEntity((candidate) => {
      if (!candidate.name) return false;
      if (candidate.type === "player" || neverAttack.has(candidate.name)) return false;
      if (candidate.position.distanceTo(this.bot.entity.position) > 24) return false;
      if (targetName) return candidate.name === targetName || candidate.name.includes(targetName);
      return isHostileEntity(candidate);
    });
    if (!entity) return { status: "done", message: intent.entity ? `附近没有${intent.label ?? intent.entity}了。` : "附近暂时没有要打的。" };
    if (entity.name === "creeper") {
      this.bot.pathfinder.setGoal(new goals.GoalNear(this.bot.entity.position.x - 8, this.bot.entity.position.y, this.bot.entity.position.z - 8, 2));
      return { status: "progress", message: "那是苦力怕，我们先撤开。" };
    }
    void this.bot.lookAt(entity.position.offset(0, (entity.height ?? 1.6) * 0.7, 0));
    if (entity.position.distanceTo(this.bot.entity.position) < 3.2) {
      this.bot.attack(entity);
      return { status: "progress" };
    }
    this.bot.pathfinder.setMovements(new Movements(this.bot));
    this.bot.pathfinder.setGoal(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2));
    return { status: "progress" };
  }

  private async equipWeapon(): Promise<void> {
    const held = this.bot.heldItem?.name ?? "";
    if (/_sword$|_axe$/.test(held)) return;
    const weapon = this.bot.inventory.items().find((item) => /_sword$|_axe$/.test(item.name));
    if (weapon) {
      try { await this.bot.equip(weapon, "hand"); } catch { /* keep going unarmed */ }
    }
  }

  private async buildOne(intent: ActionIntent): Promise<StepResult> {
    const plan = templateBlocks[intent.template ?? ""];
    if (!plan) return this.place(intent);
    if (!this.buildCursor || this.buildCursor.plan !== plan) {
      this.buildCursor = { origin: this.bot.entity.position.floored().offset(2, 0, 0), index: 0, plan };
    }
    while (this.buildCursor.index < plan.length) {
      const entry = plan[this.buildCursor.index];
      const target = this.buildCursor.origin.offset(entry.dx, entry.dy, entry.dz);
      const existing = this.bot.blockAt(target);
      this.buildCursor.index += 1;
      if (existing && existing.name !== "air") continue;
      const placed = await this.placeAt(target, entry.names);
      if (placed) {
        if (this.buildCursor.index >= plan.length) {
          this.buildCursor = undefined;
          return { status: "done", message: `小${intent.label ?? intent.template ?? "建筑"}放好了。` };
        }
        return { status: "progress" };
      }
    }
    this.buildCursor = undefined;
    return { status: "done", message: intent.label ? `我先把${intent.label}能放的放好了。` : "能放的方块我都试过了。" };
  }

  private async place(intent: ActionIntent): Promise<StepResult> {
    const names = this.resolveItems(intent.block ?? intent.item);
    const origin = this.bot.entity.position.floored().offset(2, 0, 0);
    if (await this.placeAt(origin, names.length ? names : undefined)) {
      return { status: "done", message: `我放下了${intent.label ?? intent.block ?? intent.item ?? "方块"}。` };
    }
    return { status: "blocked", message: "我手里没有合适的方块，或这里放不下。" };
  }

  private async give(intent: ActionIntent, playerName: string): Promise<StepResult> {
    const player = this.bot.players[playerName];
    if (!player?.entity) return { status: "blocked", message: "我现在看不到你，靠近我一点再试试。" };
    if (player.entity.position.distanceTo(this.bot.entity.position) > 4) {
      this.bot.pathfinder.setGoal(new goals.GoalNear(player.entity.position.x, player.entity.position.y, player.entity.position.z, 2));
      return { status: "progress" };
    }
    const names = this.resolveItems(intent.item ?? intent.block);
    const item = this.bot.inventory.items().find((candidate) => !names.length || names.includes(candidate.name));
    if (!item) return { status: "blocked", message: `我背包里没有${intent.label ?? intent.item ?? "能送你的东西"}。` };
    try {
      await this.bot.lookAt(player.entity.position.offset(0, 1.2, 0));
      await this.bot.toss(item.type, null, Math.min(intent.count ?? 1, item.count));
      return { status: "done", message: `给你${intent.label ?? item.name}。` };
    } catch (error) {
      console.warn("丢物品失败：", error);
      return { status: "blocked", message: "我没扔出去，再靠近一点吧。" };
    }
  }

  private explore(): StepResult {
    this.walkAhead();
    return { status: "done", message: "我们往前走走看。" };
  }

  private async dance(): Promise<StepResult> {
    this.bot.pathfinder.setGoal(null);
    for (let i = 0; i < 3; i += 1) {
      this.bot.setControlState("jump", true);
      await wait(180);
      this.bot.setControlState("jump", false);
      await wait(220);
    }
    return { status: "done", message: "看我跳！" };
  }

  private async eat(): Promise<StepResult> {
    const food = this.bot.inventory.items().find((item) => this.bot.registry.foodsByName[item.name]);
    if (!food) return { status: "blocked", message: "我没有能吃的东西。" };
    try {
      await this.bot.equip(food, "hand");
      await this.bot.consume();
      return { status: "done", message: "我吃了一点东西。" };
    } catch (error) {
      console.warn("进食失败：", error);
      return { status: "blocked", message: "我现在吃不了。" };
    }
  }

  private async sleepNight(): Promise<StepResult> {
    const night = this.canSleepNow();
    if (this.bot.isSleeping) {
      if (night) return { status: "progress" };
      try { await this.bot.wake(); } catch { /* already waking */ }
      return { status: "done", message: "天亮了，我起来了。" };
    }
    if (!night) return { status: "done", message: "现在是白天，不用睡觉。" };
    const bed = this.nearestBed(48);
    if (!bed) return { status: "blocked", message: "附近没有床，放一张床我才能睡觉。" };
    if (bed.position.distanceTo(this.bot.entity.position) > 2) {
      this.bot.pathfinder.setMovements(new Movements(this.bot));
      this.bot.pathfinder.setGoal(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));
      return { status: "progress", message: "我去床上睡觉。" };
    }
    this.bot.pathfinder.setGoal(null);
    try {
      await this.bot.sleep(bed);
      return { status: "progress", message: "我躺下了。你也上床，我们就能到天亮。" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("monsters")) return { status: "blocked", message: "床边有怪物，我先睡不了。" };
      if (message.includes("occupied")) return { status: "blocked", message: "这张床有人了。" };
      if (message.includes("not night")) return { status: "done", message: "现在是白天，不用睡觉。" };
      if (message.includes("too far") || message.includes("cant click") || message.includes("half bed")) {
        this.bot.pathfinder.setGoal(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));
        return { status: "progress", message: "我再靠近床一点。" };
      }
      console.warn("睡觉失败：", error);
      return { status: "blocked", message: "我现在睡不了。" };
    }
  }

  private canSleepNow(): boolean {
    const time = this.bot.time.timeOfDay;
    const thunder = this.bot.isRaining && this.bot.thunderState > 0;
    return thunder || (time >= 12541 && time <= 23458);
  }

  private nearestBed(maxDistance: number) {
    return this.bot.findBlock({
      matching: (block) => this.bot.isABed(block),
      maxDistance,
    });
  }

  private teleportTo(playerName: string): StepResult {
    const target = this.teleportTarget(playerName);
    if (!target) return { status: "blocked", message: "这个名字不能写进传送命令。" };
    this.stop();
    const command = `/tp ${target}`;
    console.log(`发送传送命令 ${command}`);
    this.bot.chat(command);
    return { status: "done", message: `我传送过去了。要是没到身边，请先开作弊，再输入 /op ${this.bot.username}。` };
  }

  private teleportTarget(playerName: string): string | undefined {
    const named = playerName.trim();
    if (!named) return undefined;
    const online = Object.keys(this.bot.players).find((name) => name.toLowerCase() === named.toLowerCase());
    const target = online ?? named;
    return /^[\p{L}\p{N}_]{1,16}$/u.test(target) ? target : undefined;
  }

  private sit(playerName: string): StepResult {
    const player = this.bot.players[playerName];
    if (player?.entity && player.entity.position.distanceTo(this.bot.entity.position) > 3.5) return this.come(playerName);
    const stair = this.nearbySeat();
    if (stair && stair.position.distanceTo(this.bot.entity.position) > 1.6) {
      this.bot.setControlState("sneak", false);
      this.bot.pathfinder.setMovements(new Movements(this.bot));
      this.bot.pathfinder.setGoal(new goals.GoalNear(stair.position.x, stair.position.y, stair.position.z, 1));
      return { status: "progress", message: "我去那边坐一下。" };
    }
    this.keepSit(playerName);
    return { status: "done", message: "我坐下了。" };
  }

  private nearbySeat() {
    return this.bot.findBlock({
      matching: (block) => /stairs|chair|bench/.test(block.name) && !block.name.includes("wall"),
      maxDistance: 8,
    });
  }

  private async look(playerName: string): Promise<StepResult> {
    const player = this.bot.players[playerName];
    if (!player?.entity) return { status: "blocked", message: "我现在看不到你。" };
    await this.bot.lookAt(player.entity.position.offset(0, 1.6, 0));
    return { status: "done", message: "我看着你呢。" };
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
    const ahead = this.bot.entity.position.offset(-Math.sin(yaw) * 12, 0, -Math.cos(yaw) * 12).floored();
    this.bot.pathfinder.setMovements(new Movements(this.bot));
    this.bot.pathfinder.setGoal(new goals.GoalNear(ahead.x, ahead.y, ahead.z, 2));
  }

  private nearestHostile() {
    return this.bot.nearestEntity((entity) => isHostileEntity(entity) && entity.position.distanceTo(this.bot.entity.position) < 14);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

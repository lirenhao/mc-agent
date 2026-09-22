import type { Bot } from "mineflayer";
import { config } from "./config.js";
import { chooseMission } from "./jev.js";
import { Skills } from "./skills.js";
import { planMission } from "./task-planner.js";
import type { Mission, MissionBlueprint, Plan, WorldState } from "./types.js";
import { getWorldState } from "./world-state.js";

const TICK_MS = 650;
const MISSION_LIMIT_MS = 5 * 60_000;
const CHAT_GAP_MS = 8_000;
const CATCH_UP_BLOCKS = 26;
const STUCK_TICKS = 10;

type Pending = { text: string; playerName: string; resolve: (message: string) => void };

export class Companion {
  private mission?: Mission;
  private busy = false;
  private planning = false;
  private pending?: Pending;
  private stayPut = false;
  private emergency = false;
  private lastChat = 0;
  private lastEat = 0;
  private lastNightNotice?: "day" | "night";
  private stuck = 0;
  private lastPos = { x: 0, y: 0, z: 0 };
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly bot: Bot,
    private readonly skills: Skills,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stopLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.skills.stop();
  }

  instruct(text: string, playerName: string): Promise<string> {
    return new Promise((resolve) => {
      this.pending?.resolve("好，我改听新的。");
      this.pending = { text, playerName, resolve };
      void this.flushPlan();
    });
  }

  private childName(): string {
    return config.companionPlayer ?? "";
  }

  private snapshot(): WorldState {
    return getWorldState(this.bot, this.childName(), this.mission);
  }

  private async flushPlan(): Promise<void> {
    if (this.planning || !this.pending) return;
    this.planning = true;
    const current = this.pending;
    this.pending = undefined;
    try {
      const message = await this.adopt(current.text, current.playerName);
      current.resolve(message);
    } catch (error) {
      console.error("规划任务失败：", error);
      current.resolve("我现在有点乱，请再说一次。");
    } finally {
      this.planning = false;
      if (this.pending) void this.flushPlan();
    }
  }

  private async adopt(text: string, playerName: string): Promise<string> {
    const state = this.snapshot();
    const plan = await planMission(text, state);
    const chosen = await chooseMission(plan, state);
    if (chosen === "status") {
      const message = this.skills.status(state);
      this.say(message, true);
      return message;
    }
    if (chosen === "clarify") {
      this.say(plan.reply, true);
      return plan.reply;
    }
    this.skills.stop();
    this.stuck = 0;
    if (chosen === "stop") {
      this.mission = undefined;
      this.stayPut = true;
      this.say(plan.reply, true);
      return plan.reply;
    }
    this.stayPut = false;
    const blueprint = plan.missions[chosen] ?? fallbackBlueprint(chosen, plan);
    this.mission = this.createMission(chosen, plan.reply, blueprint);
    const message = plan.reply;
    this.say(message, true);
    return message;
  }

  private createMission(id: string, reply: string, blueprint: MissionBlueprint): Mission {
    const now = Date.now();
    const first = blueprint.steps[0];
    return {
      id,
      title: blueprint.title ?? reply.slice(0, 18),
      reply,
      mode: blueprint.mode,
      steps: blueprint.steps,
      stepIndex: 0,
      startedAt: now,
      lastProgressAt: now,
      baseCount: this.stepBaseCount(first),
    };
  }

  private async tick(): Promise<void> {
    if (!this.bot.entity || this.planning) return;
    const playerName = this.childName();
    if (!playerName) return;
    const state = this.snapshot();

    if (this.handleEmergency(state, playerName)) return;
    if (this.busy) return;
    if (await this.maybeEat()) return;
    this.noticeNight(state);

    if (this.mission) {
      if (Date.now() - this.mission.startedAt > MISSION_LIMIT_MS) {
        this.say("这件事变久了，我先回到你身边。", true);
        this.mission = undefined;
        this.skills.keepFollow(playerName, 4);
        return;
      }
      if (this.shouldCatchUp(state) && this.mission.mode === "focused") {
        this.skills.keepFollow(playerName, 3);
        this.say("你走远了，我先跟上。");
        return;
      }
      this.busy = true;
      try {
        await this.advance(playerName, state);
      } finally {
        this.busy = false;
      }
      return;
    }

    if (this.stayPut) return;
    this.skills.keepFollow(playerName, state.time === "night" ? 2 : 4);
  }

  private handleEmergency(state: WorldState, playerName: string): boolean {
    const closeHostile = state.hostiles.some((hostile) => hostile.distance < 10)
      || (this.skills.nearestHostileDistance() ?? 99) < 10;
    const childInDanger = Boolean(state.childVisible && state.childDistance !== undefined && state.childDistance < 16 && closeHostile);
    const selfInDanger = state.health <= 6 && closeHostile;
    if (childInDanger || selfInDanger) {
      if (!this.emergency) {
        this.skills.stop();
        this.emergency = true;
        this.say("小心，我来挡住。", true);
      }
      this.skills.protectOnce(playerName);
      return true;
    }
    if (this.emergency) {
      this.emergency = false;
      this.say("安全了。", true);
    }
    return false;
  }

  private async maybeEat(): Promise<boolean> {
    if (this.bot.food > 10 || Date.now() - this.lastEat < 20_000) return false;
    this.lastEat = Date.now();
    return this.skills.eatIfHungry();
  }

  private noticeNight(state: WorldState): void {
    if (this.lastNightNotice === state.time) return;
    this.lastNightNotice = state.time;
    if (state.time === "night") this.say("天黑了，我挨着你。");
  }

  private shouldCatchUp(state: WorldState): boolean {
    return Boolean(state.childVisible && state.childDistance !== undefined && state.childDistance > CATCH_UP_BLOCKS);
  }

  private async advance(playerName: string, state: WorldState): Promise<void> {
    const mission = this.mission;
    if (!mission) return;
    if (mission.mode === "follow") {
      this.skills.keepFollow(playerName, 3);
      return;
    }
    if (mission.mode === "guard") {
      this.skills.protectOnce(playerName);
      return;
    }
    if (mission.mode === "hunt") {
      const intent = mission.steps.find((step) => /attack|hunt/i.test(step.type)) ?? { type: "attack" };
      const result = await this.skills.progress(intent, playerName, state);
      if (result.message) this.say(result.message);
      if (result.status === "done") this.skills.keepFollow(playerName, 4);
      return;
    }
    if (mission.mode === "sit") {
      if (state.childVisible && state.childDistance !== undefined && state.childDistance > 8) {
        this.skills.keepFollow(playerName, 3);
        return;
      }
      const step = mission.steps[mission.stepIndex];
      if (step && step.type.toLowerCase() !== "sit") {
        const result = await this.skills.progress(step, playerName, state);
        if (result.status === "done" || result.status === "blocked") this.nextStep(playerName, state);
        return;
      }
      const result = await this.skills.progress({ type: "sit" }, playerName, state);
      if (result.message) this.say(result.message);
      if (result.status !== "progress") this.skills.keepSit(playerName);
      return;
    }
    const step = mission.steps[mission.stepIndex];
    if (!step) {
      this.finish(playerName, "做完了，我回来找你。");
      return;
    }
    if (this.isStuck()) {
      this.stuck = 0;
      this.say("我卡住了，换个办法。");
      this.nextStep(playerName, state);
      return;
    }
    if (this.stepComplete(step, mission)) {
      this.nextStep(playerName, state);
      return;
    }
    const result = await this.skills.progress(step, playerName, state);
    this.trackProgress();
    if (result.status === "blocked") {
      this.say(result.message ?? "这一步做不了，我先跳过。", true);
      this.nextStep(playerName, state);
      return;
    }
    if (result.status === "done" || this.stepComplete(step, mission)) {
      if (result.message) this.say(result.message);
      this.nextStep(playerName, state);
      return;
    }
    if (result.message) this.say(result.message);
  }

  private stepComplete(step: { type: string; block?: string; item?: string; count?: number }, mission: Mission): boolean {
    const type = step.type.toLowerCase();
    if (type !== "collect" && type !== "mine" && type !== "harvest") return false;
    const names = this.skills.resolveBlocks(step.block ?? step.item);
    const got = this.skills.countItems(names) - mission.baseCount;
    return got >= (step.count ?? 1);
  }

  private nextStep(playerName: string, state: WorldState): void {
    if (!this.mission) return;
    this.mission.stepIndex += 1;
    const next = this.mission.steps[this.mission.stepIndex];
    if (!next) {
      this.finish(playerName, "做完了，我回来找你。");
      return;
    }
    this.mission.baseCount = this.stepBaseCount(next);
    this.mission.lastProgressAt = Date.now();
    this.stuck = 0;
    this.say(`下一步：${next.label ?? next.type}。`);
  }

  private finish(playerName: string, message: string): void {
    this.mission = undefined;
    this.stayPut = false;
    this.say(message, true);
    this.skills.keepFollow(playerName, 3);
  }

  private stepBaseCount(step?: { type: string; block?: string; item?: string }): number {
    if (!step) return 0;
    const type = step.type.toLowerCase();
    if (type !== "collect" && type !== "mine" && type !== "harvest") return 0;
    return this.skills.countItems(this.skills.resolveBlocks(step.block ?? step.item));
  }

  private isStuck(): boolean {
    const pos = this.bot.entity.position.floored();
    if (pos.x === this.lastPos.x && pos.y === this.lastPos.y && pos.z === this.lastPos.z) this.stuck += 1;
    else this.stuck = 0;
    this.lastPos = { x: pos.x, y: pos.y, z: pos.z };
    return this.stuck >= STUCK_TICKS;
  }

  private trackProgress(): void {
    if (this.mission) this.mission.lastProgressAt = Date.now();
  }

  private say(message: string, important = false): void {
    if (!message) return;
    const now = Date.now();
    if (!important && now - this.lastChat < CHAT_GAP_MS) return;
    this.lastChat = now;
    this.bot.chat(message);
  }
}

function fallbackBlueprint(id: string, plan: Plan): MissionBlueprint {
  if (id === "protect") return { mode: "guard", title: "保护", steps: [{ type: "protect" }] };
  if (id === "follow") return { mode: "follow", title: "跟随", steps: [{ type: "follow" }] };
  if (id === "sit") return { mode: "sit", title: "坐下", steps: [{ type: "come" }, { type: "sit" }] };
  if (id === "attack" || id === "hunt") return { mode: "hunt", title: "进攻", steps: [{ type: "attack", entity: plan.entity, label: plan.entity }] };
  if (id === "stop") return { mode: "stop", title: "停下", steps: [{ type: "stop" }] };
  return plan.missions[plan.skill] ?? { mode: "idle", steps: [{ type: "follow" }] };
}

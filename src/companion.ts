import type { Bot } from "mineflayer";
import { buildOffers, failureCooldown, filterOffers, planTrigger, type Offer, type RecentAction } from "./actions.js";
import { config } from "./config.js";
import { chooseMission, chooseOffer } from "./jev.js";
import { Partner, type Assist } from "./partner.js";
import { Skills } from "./skills.js";
import { planMission } from "./task-planner.js";
import type { Mission, MissionBlueprint, Plan, StepResult, WorldState } from "./types.js";
import { getWorldState } from "./world-state.js";

const TICK_MS = 650;
const MISSION_LIMIT_MS = 5 * 60_000;
const CHAT_GAP_MS = 8_000;
const CATCH_UP_BLOCKS = 26;
const STUCK_TICKS = 10;
const ERRAND_GAP_MS = 45_000;
const TORCH_GAP_MS = 90_000;
const DECISION_MS = 2_500;

type Pending = { text: string; playerName: string; resolve: (message: string) => void };

export class Companion {
  private mission?: Mission;
  private busy = false;
  private planning = false;
  private pending?: Pending;
  private active?: Pending;
  private stayPut = false;
  private emergency = false;
  private lastChat = 0;
  private lastEat = 0;
  private lastNightNotice?: "day" | "night";
  private stuck = 0;
  private lastPos = { x: 0, y: 0, z: 0 };
  private lastErrand = 0;
  private lastTorch = 0;
  private failures = 0;
  private lastPlanAt = 0;
  private planGeneration = 0;
  private workToken = 0;
  private decisionToken = 0;
  private nextDecisionAt = 0;
  private holding?: Offer;
  private deciding = false;
  private refreshing = false;
  private noUseful = false;
  private assist: Assist = { kind: "follow" };
  private recent: RecentAction[] = [];
  private readonly cooled = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private readonly partner = new Partner();

  constructor(
    private readonly bot: Bot,
    private readonly skills: Skills,
  ) {}

  start(): void {
    this.partner.bind(this.bot, this.childName());
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stopLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.pending?.resolve("我掉线了，正在重新连接。");
    this.pending = undefined;
    this.active?.resolve("我掉线了，正在重新连接。");
    this.active = undefined;
    try {
      this.skills.stop();
    } catch (error) {
      console.warn("停止动作失败：", error);
    }
  }

  instruct(text: string, playerName: string): Promise<string> {
    return new Promise((resolve) => {
      this.planGeneration += 1;
      const working = Boolean(this.mission || this.busy || (this.holding && this.holding.key !== "follow"));
      this.cutOff();
      if (working) this.say("好，先停下来听新的。", true);
      const replaced = "好，我改听新的。";
      this.pending?.resolve(replaced);
      this.active?.resolve(replaced);
      this.active = undefined;
      this.pending = { text, playerName, resolve };
      void this.flushPlan();
    });
  }

  private cutOff(): void {
    this.workToken += 1;
    this.decisionToken += 1;
    this.skills.stop();
    this.mission = undefined;
    this.holding = undefined;
    this.nextDecisionAt = 0;
    this.stayPut = false;
    this.stuck = 0;
    this.busy = false;
    this.deciding = false;
    this.failures = 0;
  }

  private childName(): string {
    return config.companionPlayer ?? "";
  }

  private snapshot(): WorldState {
    return { ...getWorldState(this.bot, this.childName(), this.mission), recent: this.recent.slice(-5) };
  }

  private async flushPlan(): Promise<void> {
    if (this.planning || !this.pending) return;
    this.planning = true;
    const current = this.pending;
    this.pending = undefined;
    this.active = current;
    try {
      const message = await this.adopt(current.text, current.playerName);
      if (this.active === current) current.resolve(message);
    } catch (error) {
      console.error("规划任务失败：", error);
      if (this.active === current) current.resolve("我现在有点乱，请再说一次。");
    } finally {
      if (this.active === current) this.active = undefined;
      this.planning = false;
      if (this.pending) void this.flushPlan();
    }
  }

  private async adopt(text: string, playerName: string): Promise<string> {
    const generation = this.planGeneration;
    this.lastPlanAt = Date.now();
    this.failures = 0;
    const state = this.snapshot();
    const plan = await planMission(text, state);
    if (generation !== this.planGeneration) return plan.reply;
    const chosen = await chooseMission(plan, state);
    if (generation !== this.planGeneration) return plan.reply;
    this.skills.stop();
    this.stuck = 0;
    this.holding = undefined;
    if (chosen === "status") {
      const message = this.skills.status(state);
      this.say(message, true);
      return message;
    }
    if (chosen === "clarify") {
      this.say(plan.reply, true);
      return plan.reply;
    }
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
    if (!this.bot.entity) return;
    const playerName = this.childName();
    if (!playerName) return;
    const state = this.snapshot();

    if (await this.handleEmergency(state, playerName)) return;
    if (this.planning) return;
    this.noticeNight(state);
    this.queueBackgroundPlan(state);
    if (this.busy) return;
    if (await this.maybeEat()) return;

    if (this.mission && Date.now() - this.mission.startedAt > MISSION_LIMIT_MS) {
      this.say("这件事变久了，我先回到你身边。", true);
      this.mission = undefined;
      this.holding = undefined;
      this.skills.stop();
      this.skills.keepFollow(playerName, 4);
      return;
    }
    if (this.shouldCatchUp(state) && this.mission?.mode === "focused") {
      this.skills.keepFollow(playerName, 3);
      this.say("你走远了，我先跟上。");
      return;
    }
    if (this.holding?.sustain && Date.now() < this.nextDecisionAt) {
      await this.runOffer(this.holding, playerName, state, true);
      return;
    }
    if (this.deciding) return;
    if (this.stayPut && !this.mission) return;
    await this.decide(playerName, state);
  }

  private queueBackgroundPlan(state: WorldState): void {
    const reason = planTrigger({
      hasMission: this.mission?.mode === "focused",
      failures: this.failures,
      now: Date.now(),
      lastPlanAt: this.lastPlanAt,
      noUseful: this.noUseful,
    });
    if (!reason || this.planning || this.refreshing || !this.mission) return;
    const generation = this.planGeneration;
    const missionId = this.mission.id;
    const title = this.mission.title;
    this.refreshing = true;
    this.lastPlanAt = Date.now();
    const note = `继续任务「${title}」。更新原因：${reason}。最近动作：${this.recent.map((item) => `${item.action}=${item.result}`).join("；") || "无"}。`;
    void planMission(note, state)
      .then((plan) => {
        if (generation !== this.planGeneration || this.mission?.id !== missionId) {
          console.log(`丢弃过期计划（${reason}）`);
          return;
        }
        const blueprint = plan.missions.do ?? plan.missions[plan.skill];
        if (!blueprint?.steps.length || plan.skill === "clarify" || plan.skill === "stop") return;
        this.mission.steps = blueprint.steps;
        this.mission.stepIndex = 0;
        this.mission.mode = blueprint.mode;
        this.mission.title = blueprint.title ?? this.mission.title;
        this.mission.baseCount = this.stepBaseCount(blueprint.steps[0]);
        this.failures = 0;
        this.holding = undefined;
        this.nextDecisionAt = 0;
        console.log(`后台更新计划（${reason}）：${this.mission.title}`);
      })
      .catch((error: unknown) => console.error("后台规划失败：", error))
      .finally(() => {
        this.refreshing = false;
      });
  }

  private async decide(playerName: string, state: WorldState): Promise<void> {
    const generation = this.planGeneration;
    const token = ++this.decisionToken;
    this.deciding = true;
    this.nextDecisionAt = Date.now() + DECISION_MS;
    try {
      const step = this.mission?.steps[this.mission.stepIndex];
      this.assist = this.stayPut
        ? { kind: "follow" }
        : this.partner.decide(this.bot, playerName, {
            canErrand: !this.mission && Date.now() - this.lastErrand > ERRAND_GAP_MS && state.time === "day" && state.hostiles.length === 0 && (state.childDistance ?? 99) < 12,
            canLight: state.time === "night" && Date.now() - this.lastTorch > TORCH_GAP_MS,
          });
      if (this.mission && !step) {
        this.finish(playerName, "做完了，我回来找你。");
        return;
      }
      const offers = filterOffers(buildOffers({
        stayPut: this.stayPut,
        childVisible: state.childVisible,
        night: state.time === "night",
        defense: state.hostiles.length > 0 || this.mission?.mode === "guard",
        mission: this.mission && step ? { mode: this.mission.mode, title: this.mission.title, step } : undefined,
        mining: this.assist.kind === "mine" ? { block: this.assist.block, label: this.assist.label } : undefined,
        errand: this.assist.kind === "errand" ? { block: this.assist.block, label: this.assist.label } : undefined,
        canLight: this.assist.kind === "light",
        canSleep: state.time === "night"
          && !this.stayPut
          && (!this.mission || this.mission.mode === "follow" || this.mission.mode === "idle")
          && this.skills.bedNearby(),
      }), { unsafe: false, cooled: this.cooledKeys() });
      this.noUseful = offers.every((offer) => offer.key === "wait");
      if (this.noUseful) {
        this.failures += 1;
        this.skills.keepFollow(playerName, 3);
        return;
      }
      const offer = await chooseOffer(offers, state);
      if (generation !== this.planGeneration || token !== this.decisionToken) return;
      console.log(`选择 ${offer.key}：${offer.description}`);
      this.holding = offer;
      if (!offer.sustain) this.nextDecisionAt = 0;
      await this.runOffer(offer, playerName, state, false);
    } finally {
      if (token === this.decisionToken) this.deciding = false;
    }
  }

  private async handleEmergency(state: WorldState, playerName: string): Promise<boolean> {
    const child = this.bot.players[playerName]?.entity;
    const threatNearChild = child ? this.skills.threatNear(child.position, 8) : undefined;
    const closeHostile = Boolean(threatNearChild)
      || state.hostiles.some((hostile) => hostile.distance < 10)
      || (this.skills.nearestHostileDistance() ?? 99) < 10;
    const childInDanger = Boolean(threatNearChild || (state.childVisible && state.childDistance !== undefined && state.childDistance < 16 && closeHostile));
    const selfInDanger = state.health <= 6 && closeHostile;
    if (childInDanger || selfInDanger) {
      if (!this.emergency) {
        this.skills.stop();
        this.emergency = true;
        const helping = Boolean(threatNearChild && threatNearChild.name !== "creeper");
        this.say(helping ? "我过来帮你打。" : "小心，我来挡住。", true);
      }
      if (this.busy) return true;
      if (threatNearChild && threatNearChild.name !== "creeper") {
        const name = threatNearChild.name;
        await this.withWork(async () => {
          await this.skills.progress({ type: "attack", entity: name, label: name }, playerName, state);
        });
      } else {
        this.skills.protectOnce(playerName);
      }
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

  private async runOffer(offer: Offer, playerName: string, state: WorldState, quiet: boolean): Promise<void> {
    const generation = this.planGeneration;
    const token = this.workToken;
    const current = (): boolean => this.fresh(generation, token);
    const key = offer.key;
    if (key === "follow") {
      this.skills.keepFollow(playerName, state.time === "night" ? 2 : 4);
      return;
    }
    if (key === "stop" || key === "wait") {
      if (key === "stop") this.skills.stop();
      return;
    }
    if (key === "protect" || key === "retreat") {
      this.skills.protectOnce(playerName);
      return;
    }
    if (key === "sleep") {
      await this.withWork(async () => {
        const result = await this.skills.progress({ type: "sleep", label: "睡觉" }, playerName, state);
        if (!current()) return;
        this.noteResult(key, result, quiet);
        if (result.status !== "progress") {
          this.holding = undefined;
          this.nextDecisionAt = 0;
        }
      });
      return;
    }
    if (key === "sit" || offer.intent.type === "sit") {
      if (state.childVisible && (state.childDistance ?? 0) > 8) {
        this.skills.keepFollow(playerName, 3);
        return;
      }
      const result = await this.skills.progress({ type: "sit" }, playerName, state);
      if (!current()) return;
      this.skills.keepSit(playerName);
      this.noteResult(key, result, quiet);
      return;
    }
    if (key === "light") {
      this.lastTorch = Date.now();
      await this.withWork(async () => {
        const result = await this.skills.lightNear(playerName);
        if (!current()) return;
        this.noteResult(key, result, quiet);
      });
      return;
    }
    if (key.startsWith("mine:") || key.startsWith("errand:")) {
      if (key.startsWith("errand:")) this.lastErrand = Date.now();
      if (!quiet) this.say(key.startsWith("mine:") ? `我来帮你挖${offer.intent.label ?? "这个"}。` : `我去旁边拿点${offer.intent.label ?? "东西"}，马上回来。`);
      await this.withWork(async () => {
        const result = await this.skills.helpGather(
          offer.intent.block ?? "",
          playerName,
          key.startsWith("mine:") ? 10 : 14,
          this.assist.kind === "mine" ? this.assist.avoid : undefined,
        );
        if (!current()) return;
        this.noteResult(key, result, quiet);
      });
      if (!current()) return;
      this.nextDecisionAt = 0;
      return;
    }
    if (!this.mission || !key.startsWith("mission:")) return;
    if (this.isStuck() && !this.sticky(offer)) {
      this.stuck = 0;
      this.failures += 1;
      this.cooled.set(key, Date.now() + failureCooldown(key));
      this.remember(key, "卡住");
      this.say("我卡住了，换个办法。");
      this.nextStep(playerName, state);
      return;
    }
    if (this.stepComplete(offer.intent, this.mission)) {
      this.nextStep(playerName, state);
      return;
    }
    await this.withWork(async () => {
      const result = await this.skills.progress(offer.intent, playerName, state);
      if (!current()) return;
      this.trackProgress();
      this.noteResult(key, result, quiet);
      if (this.sticky(offer) || !this.mission) return;
      if (offer.intent.type.toLowerCase() === "sleep") {
        if (result.status === "done") this.nextStep(playerName, state);
        if (result.status === "blocked") {
          this.holding = undefined;
          this.nextDecisionAt = 0;
        }
        return;
      }
      if (result.status === "blocked" || result.status === "done" || this.stepComplete(offer.intent, this.mission)) {
        this.nextStep(playerName, state);
      }
    });
  }

  private fresh(generation: number, token: number): boolean {
    return generation === this.planGeneration && token === this.workToken;
  }

  private sticky(offer: Offer): boolean {
    return ["sit", "attack", "hunt", "protect", "follow", "retreat"].includes(offer.intent.type.toLowerCase());
  }

  private async withWork(work: () => Promise<void>): Promise<void> {
    const token = this.workToken;
    this.busy = true;
    try {
      await work();
    } finally {
      if (token === this.workToken) this.busy = false;
    }
  }

  private noteResult(key: string, result: StepResult, quiet: boolean): void {
    this.remember(key, result.message ?? result.status);
    if (!quiet && result.message) this.say(result.message);
    if (result.status === "blocked") {
      this.failures += 1;
      this.cooled.set(key, Date.now() + failureCooldown(key));
      return;
    }
    if (result.status === "done") this.failures = 0;
  }

  private remember(action: string, result: string): void {
    this.recent.push({ action, result });
    if (this.recent.length > 5) this.recent.shift();
  }

  private cooledKeys(): Set<string> {
    const now = Date.now();
    for (const [key, until] of this.cooled) {
      if (until <= now) this.cooled.delete(key);
    }
    return new Set(this.cooled.keys());
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
    this.holding = undefined;
    this.nextDecisionAt = 0;
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
    this.holding = undefined;
    this.stayPut = false;
    this.say(message, true);
    this.skills.stop();
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
  if (id === "sleep") return { mode: "sleep", title: "睡觉", steps: [{ type: "sleep", label: "睡觉" }] };
  if (id === "attack" || id === "hunt") return { mode: "hunt", title: "进攻", steps: [{ type: "attack", entity: plan.entity, label: plan.entity }] };
  if (id === "stop") return { mode: "stop", title: "停下", steps: [{ type: "stop" }] };
  return plan.missions[plan.skill] ?? { mode: "idle", steps: [{ type: "follow" }] };
}

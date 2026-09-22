import type { ActionIntent, MissionMode } from "./types.js";

export type Offer = {
  key: string;
  description: string;
  intent: ActionIntent;
  sustain: boolean;
};

export type RecentAction = { action: string; result: string };

export function failureCooldown(key: string): number {
  if (key === "retreat" || key === "protect") return 1_500;
  if (key === "follow" || key === "sit" || key === "stop") return 2_000;
  return 8_000;
}

export function filterOffers(offers: Offer[], options: { unsafe: boolean; cooled: Set<string> }): Offer[] {
  const available = offers.filter((offer) => !options.cooled.has(offer.key));
  if (options.unsafe) {
    const escape = available.filter((offer) => offer.key === "retreat" || offer.key === "protect");
    if (escape.length) return escape;
  }
  const useful = available.filter((offer) => offer.key !== "wait");
  return useful.length ? useful : available;
}

export function preferOffer(offers: Offer[], bias?: string): Offer {
  if (bias) {
    const chosen = offers.find((offer) => offer.key === bias);
    if (chosen) return chosen;
  }
  const rank = (key: string): number => {
    if (key.startsWith("mission:")) return 0;
    if (key.startsWith("mine:")) return 1;
    if (key === "light") return 2;
    if (key.startsWith("errand:")) return 3;
    if (key === "sit") return 4;
    if (key === "follow") return 5;
    if (key === "sleep") return 6;
    if (key === "protect") return 7;
    if (key === "stop") return 8;
    if (key === "retreat") return 9;
    return 10;
  };
  return [...offers].sort((a, b) => rank(a.key) - rank(b.key))[0];
}

export function planTrigger(input: {
  hasMission: boolean;
  failures: number;
  now: number;
  lastPlanAt: number;
  noUseful: boolean;
}): string | null {
  if (!input.hasMission) return null;
  if (input.noUseful && input.now - input.lastPlanAt > 5_000) return "no useful actions";
  if (input.failures >= 2 && input.now - input.lastPlanAt > 8_000) return "repeated failure";
  if (input.now - input.lastPlanAt > 120_000) return "periodic review";
  return null;
}

export function buildOffers(input: {
  stayPut: boolean;
  childVisible: boolean;
  night: boolean;
  defense: boolean;
  mission?: { mode: MissionMode; title: string; step?: ActionIntent };
  mining?: { block: string; label: string };
  errand?: { block: string; label: string };
  canLight: boolean;
  canSleep: boolean;
}): Offer[] {
  const offers: Offer[] = [];
  if (input.defense) {
    offers.push(
      { key: "retreat", description: "先撤开。苦力怕或血量低时用这个，不要硬打。", intent: { type: "retreat" }, sustain: true },
      { key: "protect", description: "保护孩子，只打靠近的敌对生物，不攻击玩家或村民。", intent: { type: "protect" }, sustain: true },
    );
  }
  const step = input.mission?.step;
  if (input.mission && input.mission.mode !== "stop" && step) {
    offers.push({
      key: `mission:${step.type}:${step.block ?? step.entity ?? step.template ?? "go"}`,
      description: `继续「${input.mission.title}」：${step.label ?? step.type}`,
      intent: step,
      sustain: input.mission.mode === "hunt" || input.mission.mode === "guard" || input.mission.mode === "sit" || input.mission.mode === "follow" || input.mission.mode === "sleep",
    });
  }
  if (input.mining) {
    offers.push({
      key: `mine:${input.mining.block}`,
      description: `帮孩子挖旁边的${input.mining.label}，不要抢正在挖的那一块。`,
      intent: { type: "collect", block: input.mining.block, label: input.mining.label },
      sustain: false,
    });
  }
  if (input.canSleep) {
    offers.push({
      key: "sleep",
      description: "天黑了，去附近的床上睡觉跳过夜晚。床边有怪物或没有床就不要选。孩子也要上床，夜晚才会过去。",
      intent: { type: "sleep", label: "睡觉" },
      sustain: true,
    });
  }
  if (input.canLight) {
    offers.push({
      key: "light",
      description: "天黑了，在孩子身边插一支火把。",
      intent: { type: "place", item: "torch", label: "火把" },
      sustain: false,
    });
  }
  if (input.errand) {
    offers.push({
      key: `errand:${input.errand.block}`,
      description: `去旁边拿一点${input.errand.label}，然后回到孩子身边。`,
      intent: { type: "collect", block: input.errand.block, label: input.errand.label },
      sustain: false,
    });
  }
  if (input.mission?.mode === "sit") {
    offers.push({ key: "sit", description: "走到孩子身边坐下陪着。", intent: { type: "sit" }, sustain: true });
  }
  if (input.childVisible && !input.stayPut) {
    offers.push({
      key: "follow",
      description: input.night ? "天黑了，靠近孩子。" : "跟着孩子。",
      intent: { type: "follow" },
      sustain: true,
    });
  }
  if (input.stayPut) {
    offers.push({ key: "stop", description: "停在原地，不要跟随。", intent: { type: "stop" }, sustain: true });
  }
  offers.push({ key: "wait", description: "暂时等待。", intent: { type: "wait" }, sustain: true });
  return offers;
}

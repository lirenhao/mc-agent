import type { Offer, RecentAction } from "./actions.js";
import { preferOffer } from "./actions.js";
import { config } from "./config.js";
import type { Plan, WorldState } from "./types.js";

const HIGH_STAKES = new Set(["retreat", "protect", "stop"]);

export async function chooseOffer(offers: Offer[], state: WorldState): Promise<Offer> {
  if (offers.length === 1 || !config.jev.apiKey) return preferOffer(offers);
  const criteria = Object.fromEntries(offers.map((offer, index) => [`a${index}`, offerCriterion(offer, state.time === "night")]));
  try {
    const response = await fetch(config.jev.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.jev.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.jev.model,
        state: worldFacts(state),
        questions: {
          action: {
            type: "choice",
            instructions: "Choose the single available action that best continues the companion's current goal.",
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Jev ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const picked = readChoice(await response.json(), "action");
    const index = picked ? choiceIndex(picked.choice, offers.length) : undefined;
    if (index === undefined || !picked) return preferOffer(offers);
    const offer = offers[index];
    if (HIGH_STAKES.has(offer.key) && picked.confidence < config.jev.minConfidence) {
      console.log(`Jev 想选 ${offer.key}，置信度 ${picked.confidence.toFixed(2)}，改用本地优先级`);
      return preferOffer(offers);
    }
    console.log(`Jev 选择 ${offer.key}，置信度 ${picked.confidence.toFixed(2)}`);
    return offer;
  } catch (error) {
    console.error("Jev 选择失败，使用本地优先级：", error);
    return preferOffer(offers);
  }
}

/** Jev only vetoes a proposed task. Danger in the world is handled by code. */
export async function chooseMission(plan: Plan, state: WorldState): Promise<string> {
  if (!config.jev.apiKey) return safeRule(plan, state);
  const proposed = plan.missions[plan.skill] ?? plan.missions.do;
  try {
    const response = await fetch(config.jev.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.jev.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.jev.model,
        state: {
          proposed: {
            skill: plan.skill,
            title: proposed?.title,
            mode: proposed?.mode,
            steps: (proposed?.steps ?? []).slice(0, 8).map((step) => ({
              type: step.type,
              block: step.block,
              entity: step.entity,
              item: step.item,
              template: step.template,
              count: step.count,
            })),
          },
          reply: plan.reply,
          ...worldFacts(state),
        },
        questions: {
          next_action: {
            type: "choice",
            instructions: "Decide whether the companion should start the proposed task now.",
            criteria: {
              do: "Start the proposed task. Choose this unless a hostile mob is an immediate threat or the task would harm a player or villager.",
              protect: "Do not start the task. A hostile mob is close or health is very low, so protect the child instead.",
              stop: "Do not start the task. It would harm a player or villager, or it should clearly not be done.",
            },
          },
        },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Jev ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const picked = readChoice(await response.json(), "next_action");
    if ((picked?.choice === "protect" || picked?.choice === "stop") && picked.confidence >= config.jev.minConfidence) {
      console.log(`Jev 否决任务，改为 ${picked.choice}，置信度 ${picked.confidence.toFixed(2)}`);
      return picked.choice;
    }
    return plan.skill;
  } catch (error) {
    console.error("Jev 决策失败，使用安全规则：", error);
    return safeRule(plan, state);
  }
}

function worldFacts(state: WorldState): {
  health: number;
  food: number;
  time: WorldState["time"];
  childVisible: boolean;
  childDistance?: number;
  hostiles: WorldState["hostiles"];
  mission?: WorldState["mission"];
  recent: RecentAction[];
} {
  return {
    health: state.health,
    food: state.food,
    time: state.time,
    childVisible: state.childVisible,
    childDistance: state.childDistance,
    hostiles: state.hostiles.slice(0, 3),
    mission: state.mission,
    recent: (state.recent ?? []).slice(-5),
  };
}

function offerCriterion(offer: Offer, night: boolean): string {
  const key = offer.key;
  if (key === "retreat") return "Move away from danger. Use this when a creeper is close or health is low. Do not fight.";
  if (key === "protect") return "Protect the child by fighting only nearby hostile mobs. Never attack players or villagers.";
  if (key === "sleep") return "Sleep in a nearby bed to skip the night. Do not choose this when monsters are beside the bed.";
  if (key === "light") return "Place one torch beside the child because it is night.";
  if (key === "sit") return "Walk to the child and sit beside them.";
  if (key === "follow") return night ? "It is night. Stay close to the child." : "Follow the child.";
  if (key === "stop") return "Stop moving and do not follow.";
  if (key === "wait") return "Wait briefly and do nothing else.";
  if (key.startsWith("mine:")) return `Help the child mine a nearby ${offer.intent.block ?? "block"}. Do not take the exact block the child is breaking.`;
  if (key.startsWith("errand:")) return `Collect a little ${offer.intent.block ?? "block"} nearby, then return to the child.`;
  if (key.startsWith("mission:")) {
    const step = offer.intent;
    const detail = [step.type, step.block, step.entity, step.item, step.template, step.count ? `x${step.count}` : undefined].filter(Boolean).join(" ");
    return `Continue the accepted task. Next step: ${detail}.`;
  }
  return `Perform the available action ${key}.`;
}

function safeRule(plan: Plan, state: WorldState): string {
  if (state.health <= 6 && state.hostiles.some((hostile) => hostile.distance < 12)) return "protect";
  return plan.skill;
}

function readChoice(value: unknown, question: string): { choice: string; confidence: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const answer = (value as { answers?: Record<string, unknown> }).answers?.[question];
  if (!answer || typeof answer !== "object") return undefined;
  const choice = (answer as { choice?: unknown }).choice;
  const confidence = Number((answer as { confidence?: unknown }).confidence);
  if (typeof choice !== "string") return undefined;
  return { choice, confidence: Number.isFinite(confidence) ? confidence : 0 };
}

function choiceIndex(choice: string, count: number): number | undefined {
  if (!/^a\d+$/.test(choice)) return undefined;
  const index = Number(choice.slice(1));
  return index >= 0 && index < count ? index : undefined;
}

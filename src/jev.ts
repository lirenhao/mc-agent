import type { Offer, RecentAction } from "./actions.js";
import { preferOffer } from "./actions.js";
import { config } from "./config.js";
import { DEFAULT_CRITERIA, type Plan, type WorldState } from "./types.js";

export async function chooseOffer(offers: Offer[], observation: { recent: RecentAction[]; summary: string }): Promise<Offer> {
  if (offers.length === 1 || !config.jev.apiKey) return preferOffer(offers);
  const criteria = Object.fromEntries(offers.map((offer, index) => [`a${index}`, offer.description]));
  try {
    const response = await fetch(config.jev.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.jev.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.jev.model,
        state: JSON.stringify({
          summary: observation.summary,
          recent: observation.recent.slice(-5),
          policy: "只能选择下面列出的动作。危险时选撤离或保护。不要发明列表以外的动作。",
        }),
        questions: {
          action: {
            type: "choice",
            instructions: "选择一个现在就能执行的动作，推进当前陪玩目标。",
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Jev ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const index = choiceIndex(await response.json(), offers.length);
    if (index === undefined) return preferOffer(offers);
    return offers[index];
  } catch (error) {
    console.error("Jev 选择失败，使用本地优先级：", error);
    return preferOffer(offers);
  }
}

function choiceIndex(value: unknown, count: number): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const action = (value as { answers?: { action?: { choice?: unknown } } }).answers?.action?.choice;
  if (typeof action !== "string" || !/^a\d+$/.test(action)) return undefined;
  const index = Number(action.slice(1));
  return index >= 0 && index < count ? index : undefined;
}

/** Jev gates the whole mission, not each micro-step. */
export async function chooseMission(plan: Plan, state: WorldState): Promise<string> {
  if (!config.jev.apiKey) return safeRule(plan, state);
  const criteria = usableCriteria(plan.criteria, state);
  try {
    const response = await fetch(config.jev.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.jev.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.jev.model,
        state: {
          plan: { skill: plan.skill, reply: plan.reply, missions: plan.missions },
          world: state,
          policy: "模型推荐的任务是 do。孩子没危险、任务也不伤害玩家或村民时必须选 do。只有附近有威胁或血量很低才选 protect；任务明显不该做才选 stop。",
        },
        questions: {
          next_action: {
            type: "choice",
            instructions: "是否照模型给出的任务执行？能执行就选 do。",
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Jev ${response.status}: ${detail.slice(0, 500)}`);
    }
    const parsed = extractDecision(await response.json(), Object.keys(criteria));
    if ((parsed.action === "protect" || parsed.action === "stop") && parsed.confidence >= config.jev.minConfidence) {
      return parsed.action;
    }
    return plan.skill;
  } catch (error) {
    console.error("Jev 决策失败，使用安全规则：", error);
    return safeRule(plan, state);
  }
}

function usableCriteria(criteria: Plan["criteria"], state: WorldState): Record<string, string> {
  const picked: Record<string, string> = { ...criteria };
  if (state.health <= 6 && state.hostiles.some((hostile) => hostile.distance < 12)) {
    picked.protect ??= DEFAULT_CRITERIA.protect;
    picked.stop ??= DEFAULT_CRITERIA.stop;
  }
  return Object.keys(picked).length >= 2 ? picked : { ...DEFAULT_CRITERIA };
}

function safeRule(plan: Plan, state: WorldState): string {
  if (state.health <= 6 && state.hostiles.some((hostile) => hostile.distance < 12)) return "protect";
  return plan.skill;
}

function extractDecision(value: unknown, allowed: string[]): { action?: string; confidence: number } {
  if (!value || typeof value !== "object") return { confidence: 0 };
  const answers = (value as { answers?: Record<string, unknown> }).answers;
  const next = answers?.next_action;
  if (!next || typeof next !== "object") return { confidence: 0 };
  const choice = (next as { choice?: unknown }).choice;
  const confidence = Number((next as { confidence?: unknown }).confidence);
  return {
    action: typeof choice === "string" && allowed.includes(choice) ? choice : undefined,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}

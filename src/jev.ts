import { config } from "./config.js";
import { DEFAULT_CRITERIA, type Plan, type WorldState } from "./types.js";

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

import { config } from "./config.js";
import { DEFAULT_CRITERIA, type Task, type WorldState } from "./types.js";

/** Jev is the final action gate: it only picks among the planner's candidate ids. */
export async function chooseAction(task: Task, state: WorldState): Promise<string> {
  if (!config.jev.apiKey) return safeRule(task, state);
  const criteria = usableCriteria(task.criteria, state);
  try {
    const response = await fetch(config.jev.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.jev.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.jev.model,
        state: {
          task: { skill: task.skill, reply: task.reply, intents: task.intents },
          world: state,
          policy: "从候选里选最好玩又安全的陪玩动作。危险或低血量时优先 protect、stop 或 clarify。不要攻击玩家或村民。",
        },
        questions: {
          next_action: {
            type: "choice",
            instructions: "根据孩子的话和当前世界，只选择一个候选动作。",
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
    if (!parsed.action || parsed.confidence < config.jev.minConfidence) return "clarify";
    return parsed.action;
  } catch (error) {
    console.error("Jev 决策失败，使用安全规则：", error);
    return safeRule(task, state);
  }
}

function usableCriteria(criteria: Task["criteria"], state: WorldState): Record<string, string> {
  const picked: Record<string, string> = { ...criteria };
  if (state.health <= 6 && state.hostiles.some((hostile) => hostile.distance < 12)) {
    picked.protect ??= DEFAULT_CRITERIA.protect;
    picked.stop ??= DEFAULT_CRITERIA.stop;
  }
  return Object.keys(picked).length >= 2 ? picked : { ...DEFAULT_CRITERIA };
}

function safeRule(task: Task, state: WorldState): string {
  if (state.health <= 6 && state.hostiles.some((hostile) => hostile.distance < 12)) return "protect";
  return task.skill;
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

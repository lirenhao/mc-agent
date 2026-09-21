import { config } from "./config.js";
import { DEFAULT_CRITERIA, SKILL_NAMES, type ActionIntent, type BuildTemplate, type ResourceName, type SkillName, type Task, type WorldState } from "./types.js";

const resources: ResourceName[] = ["wood", "stone", "coal", "iron"];
const templates: BuildTemplate[] = ["cabin", "farm", "camp"];

export async function planTask(transcript: string, state: WorldState): Promise<Task> {
  if (!config.llm.baseUrl || !config.llm.apiKey || !config.llm.model) {
    return withDefaultActions(localPlan(transcript));
  }
  try {
    const result = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.llm.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `你是 Minecraft 陪玩 ${config.persona.name}。风格：${config.persona.style}。把孩子的话变成 JSON：{skill,reply,criteria,intents}。
skill 是推荐动作的 id（英文蛇形，如 pick_flowers、hunt_pig、give_apple）。
criteria 是给实时闸门的候选：键是动作 id，值是此刻为何可选。至少 2 个，最多 8 个，必须包含推荐 skill 和 clarify。
intents 为每个 criteria 键提供执行意图 {type,block?,entity?,item?,count?,template?,x?,y?,z?,label?}。
type 常用：follow, stop, status, protect, find, collect, attack, build, place, give, explore, come, look, dance, eat, goto, clarify。也可以自创 type。
block/item/entity 用 Minecraft 英文 id（oak_log、dandelion、pig）。count 1-8。label 用中文短名。
reply 不超过 35 个汉字。
不要把动作限制在跟随/找矿/三个模板里；可以摘花、喂动物、跳舞、递东西、去看风景、小量采集、打怪等。不要攻击玩家或村民。不能确定时 skill=clarify。`,
          },
          { role: "user", content: JSON.stringify({ transcript, state }) },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!result.ok) throw new Error(`LLM ${result.status}`);
    const content = (await result.json() as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
    return validatePlan(JSON.parse(content ?? "{}"));
  } catch (error) {
    if (isTimeout(error)) {
      console.error("大模型规划超时，使用默认动作：", error);
      return withDefaultActions(localPlan(transcript));
    }
    console.error("大模型规划失败，未使用默认动作集：", error);
    return localClarify();
  }
}

function validatePlan(value: unknown): Task {
  if (!value || typeof value !== "object") return localClarify();
  const candidate = value as { skill?: unknown; reply?: unknown; criteria?: unknown; intents?: unknown; resource?: unknown; template?: unknown };
  const skill = sanitizeActionId(String(candidate.skill ?? ""));
  if (!skill) return localClarify();
  const criteria = sanitizeCriteria(candidate.criteria, skill);
  if (!criteria) return localClarify();
  const intents = sanitizeIntents(candidate.intents, criteria);
  if (!intents[skill]) intents[skill] = { type: skill };
  return {
    skill,
    resource: resources.includes(candidate.resource as ResourceName) ? candidate.resource as ResourceName : undefined,
    template: templates.includes(candidate.template as BuildTemplate) ? candidate.template as BuildTemplate : undefined,
    reply: typeof candidate.reply === "string" && candidate.reply.length <= 70 ? candidate.reply : "好，我来陪你一起做。",
    criteria,
    intents,
  };
}

function sanitizeCriteria(value: unknown, recommended: string): Record<string, string> | undefined {
  const criteria: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, description] of Object.entries(value as Record<string, unknown>)) {
      const id = sanitizeActionId(key);
      if (!id || typeof description !== "string") continue;
      const text = description.trim().slice(0, 80);
      if (text) criteria[id] = text;
      if (Object.keys(criteria).length >= 8) break;
    }
  }
  if (!criteria[recommended]) criteria[recommended] = "按孩子刚才说的去做。";
  if (!criteria.clarify) criteria.clarify = DEFAULT_CRITERIA.clarify;
  return Object.keys(criteria).length >= 2 ? criteria : undefined;
}

function sanitizeIntents(value: unknown, criteria: Record<string, string>): Record<string, ActionIntent> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const intents: Record<string, ActionIntent> = {};
  for (const id of Object.keys(criteria)) {
    intents[id] = sanitizeIntent(source[id]) ?? { type: id };
  }
  return intents;
}

function sanitizeIntent(value: unknown): ActionIntent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const type = String(raw.type ?? "").trim().toLowerCase().slice(0, 32);
  if (!type) return undefined;
  const intent: ActionIntent = { type };
  if (typeof raw.block === "string") intent.block = raw.block.trim().slice(0, 40);
  if (typeof raw.entity === "string") intent.entity = raw.entity.trim().slice(0, 40);
  if (typeof raw.item === "string") intent.item = raw.item.trim().slice(0, 40);
  if (typeof raw.template === "string") intent.template = raw.template.trim().slice(0, 40);
  if (typeof raw.label === "string") intent.label = raw.label.trim().slice(0, 20);
  if (typeof raw.count === "number" && Number.isFinite(raw.count)) intent.count = Math.min(8, Math.max(1, Math.round(raw.count)));
  for (const axis of ["x", "y", "z"] as const) {
    const n = raw[axis];
    if (typeof n === "number" && Number.isFinite(n)) intent[axis] = Math.round(n);
  }
  return intent;
}

function sanitizeActionId(value: string): string | undefined {
  const id = value.trim().slice(0, 40);
  if (!id || /[^\p{L}\p{N}_-]/u.test(id)) return undefined;
  return id;
}

function withDefaultActions(task: ReturnType<typeof localPlan>): Task {
  const intents: Record<string, ActionIntent> = {};
  for (const name of SKILL_NAMES) {
    intents[name] = defaultIntent(name, task.resource, task.template);
  }
  return { ...task, criteria: { ...DEFAULT_CRITERIA }, intents };
}

function defaultIntent(skill: SkillName, resource?: ResourceName, template?: BuildTemplate): ActionIntent {
  if (skill === "find_resource") return { type: "find", block: resource, label: resource };
  if (skill === "build") return { type: "build", template, label: template };
  return { type: skill };
}

function localClarify(): Task {
  return {
    skill: "clarify",
    reply: "我没听明白。可以说跟着我、带我找煤，或盖小木屋。",
    criteria: {
      clarify: DEFAULT_CRITERIA.clarify,
      stop: DEFAULT_CRITERIA.stop,
    },
    intents: {
      clarify: { type: "clarify" },
      stop: { type: "stop" },
    },
  };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function localPlan(text: string): Omit<Task, "criteria" | "intents"> {
  if (/(停|别动|停止)/.test(text)) return { skill: "stop", reply: "好，我停在这里等你。" };
  if (/(跟着|跟我|跟随)/.test(text)) return { skill: "follow", reply: "好，我跟着你。" };
  if (/(保护|打怪|怪物|救我)/.test(text)) return { skill: "protect", reply: "我会留意怪物，保护你。" };
  if (/(木头|树木)/.test(text)) return { skill: "find_resource", resource: "wood", reply: "好，我带你去找木头。" };
  if (/(石头|圆石)/.test(text)) return { skill: "find_resource", resource: "stone", reply: "好，我们一起找石头。" };
  if (/煤/.test(text)) return { skill: "find_resource", resource: "coal", reply: "好，我带你去找煤矿。" };
  if (/(铁|铁矿)/.test(text)) return { skill: "find_resource", resource: "iron", reply: "好，我们一起找铁矿。" };
  if (/(小木屋|房子)/.test(text)) return { skill: "build", template: "cabin", reply: "好，我们找块空地盖小木屋。" };
  if (/(农场|围栏)/.test(text)) return { skill: "build", template: "farm", reply: "好，我们来围一个小农场。" };
  if (/(篝火|营地)/.test(text)) return { skill: "build", template: "camp", reply: "好，我们布置一个篝火营地。" };
  if (/(状态|血量|饿)/.test(text)) return { skill: "status", reply: "我来报告状态。" };
  return { skill: "clarify", reply: "我没听明白。可以说跟着我、带我找煤，或盖小木屋。" };
}

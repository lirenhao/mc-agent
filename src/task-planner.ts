import { config } from "./config.js";
import { DEFAULT_CRITERIA, SKILL_NAMES, type ActionIntent, type BuildTemplate, type MissionBlueprint, type MissionMode, type Plan, type ResourceName, type SkillName, type WorldState } from "./types.js";

const resources: ResourceName[] = ["wood", "stone", "coal", "iron"];
const templates: BuildTemplate[] = ["cabin", "farm", "camp"];
const modes: MissionMode[] = ["focused", "follow", "guard", "idle", "stop", "sit", "hunt"];

export async function planMission(transcript: string, state: WorldState): Promise<Plan> {
  if (!config.llm.baseUrl || !config.llm.apiKey || !config.llm.model) {
    return withDefaultMissions(localPlan(transcript));
  }
  try {
    const result = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.llm.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `你是 Minecraft 陪玩 ${config.persona.name}。风格：${config.persona.style}。把孩子的话变成 JSON：{skill,reply,criteria,missions}。
skill 是推荐任务 id（英文蛇形）。
criteria 给实时闸门：键是任务 id，值是一句话。至少 2 个，最多 6 个，必须含推荐 skill 和 clarify。
missions 为每个 criteria 键提供 {mode,title,steps}。
mode：focused=专心做完再回孩子身边；follow=一直跟着；guard=边陪边防怪；hunt=主动进攻直到停下；idle=只待在附近；stop=停下；sit=走到身边坐下陪着。
steps 是有序长任务，每步 {type,block?,entity?,item?,count?,template?,x?,y?,z?,label?}。
复杂要求必须拆步，例如“砍树盖房子”→ collect 木头 → come → build cabin。采集 count 最多 24。
type 常用：follow, stop, status, protect, attack, hunt, find, collect, build, place, give, explore, come, look, dance, eat, goto, wait, sit, clarify。
block/item/entity 用 Minecraft 英文 id。label 用中文短名。reply 不超过 35 个汉字。
孩子说攻击、去打、打怪时 skill=attack、mode=hunt；entity 填 zombie、skeleton、spider 等，没说种类就打附近敌对生物，一直打到停下。苦力怕只撤离。不要攻击玩家或村民。不能确定时 skill=clarify。若已有 mission，优先把孩子的新话理解成改任务或追加，而不是忽略。`,
          },
          { role: "user", content: JSON.stringify({ transcript, state }) },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!result.ok) throw new Error(`LLM ${result.status}`);
    const content = (await result.json() as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
    return validatePlan(JSON.parse(content ?? "{}"));
  } catch (error) {
    if (isTimeout(error)) {
      console.error("大模型规划超时，使用默认任务：", error);
      return withDefaultMissions(localPlan(transcript));
    }
    console.error("大模型规划失败：", error);
    return localClarify();
  }
}

function validatePlan(value: unknown): Plan {
  if (!value || typeof value !== "object") return localClarify();
  const candidate = value as { skill?: unknown; reply?: unknown; criteria?: unknown; missions?: unknown; resource?: unknown; template?: unknown; entity?: unknown };
  const skill = sanitizeActionId(String(candidate.skill ?? ""));
  if (!skill) return localClarify();
  const criteria = sanitizeCriteria(candidate.criteria, skill);
  if (!criteria) return localClarify();
  const missions = sanitizeMissions(candidate.missions, criteria, candidate.resource, candidate.template, candidate.entity);
  const entity = typeof candidate.entity === "string" ? candidate.entity.trim().slice(0, 40).toLowerCase() : undefined;
  return {
    skill,
    resource: resources.includes(candidate.resource as ResourceName) ? candidate.resource as ResourceName : undefined,
    template: templates.includes(candidate.template as BuildTemplate) ? candidate.template as BuildTemplate : undefined,
    entity: entity || undefined,
    reply: typeof candidate.reply === "string" && candidate.reply.length <= 70 ? candidate.reply : "好，我来陪你一起做。",
    criteria,
    missions,
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
      if (Object.keys(criteria).length >= 6) break;
    }
  }
  if (!criteria[recommended]) criteria[recommended] = "按孩子刚才说的去做。";
  if (!criteria.clarify) criteria.clarify = DEFAULT_CRITERIA.clarify;
  return Object.keys(criteria).length >= 2 ? criteria : undefined;
}

function sanitizeMissions(value: unknown, criteria: Record<string, string>, resource: unknown, template: unknown, entity: unknown): Record<string, MissionBlueprint> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const missions: Record<string, MissionBlueprint> = {};
  for (const id of Object.keys(criteria)) {
    missions[id] = sanitizeBlueprint(source[id], id, resource, template, entity);
  }
  return missions;
}

function sanitizeBlueprint(value: unknown, id: string, resource: unknown, template: unknown, entity: unknown): MissionBlueprint {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const mode = modes.includes(raw.mode as MissionMode) ? raw.mode as MissionMode : inferMode(id);
  const steps = Array.isArray(raw.steps) ? raw.steps.map(sanitizeIntent).filter((step): step is ActionIntent => Boolean(step)).slice(0, 12) : [];
  if (!steps.length) steps.push(fallbackStep(id, resource, template, entity));
  return {
    mode,
    title: typeof raw.title === "string" ? raw.title.trim().slice(0, 24) : undefined,
    steps,
  };
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
  if (typeof raw.count === "number" && Number.isFinite(raw.count)) intent.count = Math.min(24, Math.max(1, Math.round(raw.count)));
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

function inferMode(id: string): MissionMode {
  if (id === "stop") return "stop";
  if (id === "protect") return "guard";
  if (id === "follow") return "follow";
  if (id === "sit" || id === "rest" || id === "sneak") return "sit";
  if (id === "attack" || id === "hunt") return "hunt";
  if (id === "clarify" || id === "status") return "idle";
  return "focused";
}

function fallbackStep(id: string, resource: unknown, template: unknown, entity?: unknown): ActionIntent {
  if (id === "find_resource") return { type: "collect", block: String(resource ?? "wood"), count: 8, label: String(resource ?? "木头") };
  if (id === "build") return { type: "build", template: String(template ?? "cabin") };
  if (id === "attack" || id === "hunt") {
    const name = typeof entity === "string" && entity ? entity : undefined;
    return { type: "attack", entity: name, label: name ? mobLabel(name) : "附近的怪物" };
  }
  return { type: id };
}

function withDefaultMissions(task: ReturnType<typeof localPlan>): Plan {
  const criteria: Record<string, string> = { ...DEFAULT_CRITERIA };
  const missions: Record<string, MissionBlueprint> = {};
  for (const name of SKILL_NAMES) {
    missions[name] = {
      mode: inferMode(name),
      title: DEFAULT_CRITERIA[name].slice(0, 24),
      steps: [defaultIntent(name, task.resource, task.template)],
    };
  }
  if (task.skill === "sit") {
    criteria.sit = "孩子想坐下、蹲下或一起休息。";
    missions.sit = { mode: "sit", title: "坐下陪着", steps: [{ type: "come" }, { type: "sit" }] };
  }
  if (task.skill === "attack") {
    criteria.attack = "孩子要主动进攻附近的生物。";
    missions.attack = {
      mode: "hunt",
      title: task.entity ? `打${mobLabel(task.entity)}` : "进攻",
      steps: [{ type: "attack", entity: task.entity, label: task.entity ? mobLabel(task.entity) : "附近的怪物" }],
    };
  }
  if (task.skill === "build" && task.template === "cabin") {
    missions.build = {
      mode: "focused",
      title: "备料并盖小木屋",
      steps: [
        { type: "collect", block: "wood", count: 8, label: "木头" },
        { type: "come" },
        { type: "build", template: "cabin", label: "小木屋" },
      ],
    };
  }
  return { ...task, criteria, missions };
}

function defaultIntent(skill: SkillName, resource?: ResourceName, template?: BuildTemplate): ActionIntent {
  if (skill === "find_resource") return { type: "collect", block: resource, count: 8, label: resource };
  if (skill === "build") return { type: "build", template, label: template };
  return { type: skill };
}

function localClarify(): Plan {
  return {
    skill: "clarify",
    reply: "我没听明白。可以说跟着我、坐下、去打怪，或盖房子。",
    criteria: { clarify: DEFAULT_CRITERIA.clarify, stop: DEFAULT_CRITERIA.stop },
    missions: {
      clarify: { mode: "idle", steps: [{ type: "clarify" }] },
      stop: { mode: "stop", steps: [{ type: "stop" }] },
    },
  };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function localPlan(text: string): Omit<Plan, "criteria" | "missions"> {
  if (/(坐下|蹲下|坐着|坐下来|休息一下)/.test(text)) return { skill: "sit", reply: "好，我坐下来陪你。" };
  if (/(停|别动|停止)/.test(text)) return { skill: "stop", reply: "好，我停在这里等你。" };
  if (/(跟着|跟我|跟随)/.test(text)) return { skill: "follow", reply: "好，我跟着你。" };
  const target = parseMob(text);
  if (/(攻击|进攻|开战|去打|打它|打怪|砍怪|打一打)/.test(text) || /打(僵尸|骷髅|蜘蛛|苦力怕|末影人|女巫|史莱姆|溺尸|猪|牛|羊|鸡)/.test(text)) {
    return {
      skill: "attack",
      entity: target?.id,
      reply: target ? `好，我去打${target.label}。` : "好，我去打附近的怪物。",
    };
  }
  if (/(保护|救我)/.test(text)) return { skill: "protect", reply: "我会一直留意怪物，保护你。" };
  if (/(房子|小木屋)/.test(text)) return { skill: "build", template: "cabin", reply: "好，我去备木头，再回来盖小木屋。" };
  if (/(农场|围栏)/.test(text)) return { skill: "build", template: "farm", reply: "好，我们来围一个小农场。" };
  if (/(篝火|营地)/.test(text)) return { skill: "build", template: "camp", reply: "好，我们布置一个篝火营地。" };
  if (/(木头|树木|砍树)/.test(text)) return { skill: "find_resource", resource: "wood", reply: "好，我去砍一些木头，砍完回来找你。" };
  if (/(石头|圆石)/.test(text)) return { skill: "find_resource", resource: "stone", reply: "好，我去采一些石头。" };
  if (/煤/.test(text)) return { skill: "find_resource", resource: "coal", reply: "好，我去找煤矿。" };
  if (/(铁|铁矿)/.test(text)) return { skill: "find_resource", resource: "iron", reply: "好，我去找铁矿。" };
  if (/(状态|血量|饿)/.test(text)) return { skill: "status", reply: "我来报告状态。" };
  return { skill: "clarify", reply: "我没听明白。可以说跟着我、坐下、去打怪，或盖房子。" };
}

const MOBS: Array<{ pattern: RegExp; id: string; label: string }> = [
  { pattern: /苦力怕|creeper/, id: "creeper", label: "苦力怕" },
  { pattern: /僵尸|zombie/, id: "zombie", label: "僵尸" },
  { pattern: /骷髅|skeleton/, id: "skeleton", label: "骷髅" },
  { pattern: /蜘蛛|spider/, id: "spider", label: "蜘蛛" },
  { pattern: /末影人|enderman/, id: "enderman", label: "末影人" },
  { pattern: /女巫|witch/, id: "witch", label: "女巫" },
  { pattern: /溺尸|drowned/, id: "drowned", label: "溺尸" },
  { pattern: /史莱姆|slime/, id: "slime", label: "史莱姆" },
  { pattern: /尸壳|husk/, id: "husk", label: "尸壳" },
  { pattern: /猪(?!人)/, id: "pig", label: "猪" },
  { pattern: /牛/, id: "cow", label: "牛" },
  { pattern: /羊/, id: "sheep", label: "羊" },
  { pattern: /鸡/, id: "chicken", label: "鸡" },
];

function parseMob(text: string): { id: string; label: string } | undefined {
  return MOBS.find((mob) => mob.pattern.test(text));
}

function mobLabel(id: string): string {
  return MOBS.find((mob) => mob.id === id)?.label ?? id;
}

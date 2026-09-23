import { config } from "./config.js";
import { DEFAULT_CRITERIA, SKILL_NAMES, type ActionIntent, type BuildTemplate, type MissionBlueprint, type MissionMode, type Plan, type ResourceName, type SkillName, type WorldState } from "./types.js";

const resources: ResourceName[] = ["wood", "stone", "coal", "iron"];
const templates: BuildTemplate[] = ["cabin", "farm", "camp"];
const modes: MissionMode[] = ["focused", "follow", "guard", "idle", "stop", "sit", "hunt", "sleep"];

export function isPickupRequest(text: string): boolean {
  return /(捡起|捡起来|捡东西|捡我的|帮我捡|拣起|拣起来|拣取|拣东西|拣物资|捡物资|把地上)/.test(text);
}

export async function planMission(transcript: string, state: WorldState): Promise<Plan> {
  if (/(传送|瞬移|\btp\b)/i.test(transcript)) return withDefaultMissions(localPlan(transcript));
  if (isPickupRequest(transcript)) return withDefaultMissions(localPlan(transcript));
  if (!config.llm.baseUrl || !config.llm.apiKey || !config.llm.model) {
    return withDefaultMissions(localPlan(transcript));
  }
  try {
    const result = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.llm.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `你是 Minecraft 陪玩 ${config.persona.name}。风格：${config.persona.style}。只输出一个 JSON 对象，不要 markdown。
格式：{"reply":"不超过35字","mode":"focused|follow|guard|hunt|sit|sleep|stop|idle","title":"短标题","steps":[{"type":"collect","block":"oak_log","count":8,"label":"木头"}]}
type 只能是：follow, stop, protect, collect, attack, build, place, give, come, look, dance, eat, goto, sit, sleep, tp, wait。
mode：follow=一直跟着；guard=保护；hunt=一直进攻直到停下；sit=坐下陪着；sleep=上床睡觉直到天亮；stop=停下；focused=按 steps 做完再回来。
孩子要传送到身边时，type=tp，mode=focused。这会让机器人在游戏里发送 /tp，服务器必须允许它使用该命令。
多件事拆成有序 steps。例如砍树盖房：collect oak_log → come → build，template 只能是 cabin、farm、camp。
block/item 用英文 id（木头用 oak_log，石头用 stone，煤用 coal_ore，铁用 iron_ore，花用 dandelion）。
攻击时 type=attack，mode=hunt，entity 用 zombie、skeleton、spider、creeper 等；没点名就省略 entity。不要攻击玩家或村民。
听不懂时 steps 用 [{"type":"wait"}]，reply 请孩子再说具体一点。`,
          },
          {
            role: "user",
            content: JSON.stringify({
              said: transcript,
              health: state.health,
              food: state.food,
              time: state.time,
              hostiles: state.hostiles.slice(0, 3),
              inventory: state.inventory.slice(0, 8),
              childNearby: state.childVisible,
              doing: state.mission?.title,
              recent: state.recent?.slice(-5) ?? [],
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!result.ok) throw new Error(`LLM ${result.status}`);
    const content = (await result.json() as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
    return interpretModel(parseModelJson(content), transcript);
  } catch (error) {
    console.error(isTimeout(error) ? "大模型规划超时，改用口令：" : "大模型规划失败，改用口令：", error);
    return withDefaultMissions(localPlan(transcript));
  }
}

function parseModelJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? content).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("模型没有返回 JSON");
  }
}

function interpretModel(value: unknown, transcript: string): Plan {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const steps = root ? readSteps(root) : [];
  if (!root || !steps.length) {
    console.warn("模型输出里没有可执行步骤，改用口令。");
    return withDefaultMissions(localPlan(transcript));
  }
  const reply = clip(root.reply ?? root.message, 70) || "好，我来陪你一起做。";
  if (steps.length === 1 && steps[0].type === "wait") {
    return {
      skill: "clarify",
      reply,
      criteria: { clarify: reply, stop: "停下，不执行新任务。" },
      missions: {
        clarify: { mode: "idle", title: "再问一次", steps: [{ type: "wait" }] },
        stop: { mode: "stop", title: "停下", steps: [{ type: "stop" }] },
      },
    };
  }
  const blueprint: MissionBlueprint = {
    mode: readMode(root.mode, steps),
    title: clip(root.title, 24),
    steps,
  };
  return {
    skill: "do",
    entity: steps.find((step) => step.entity)?.entity,
    reply,
    criteria: {
      do: blueprint.title || reply,
      protect: "孩子附近有危险，先保护而不是继续原任务。",
      stop: "任务会伤害玩家或村民，或者不该执行。",
    },
    missions: {
      do: blueprint,
      protect: { mode: "guard", title: "保护", steps: [{ type: "protect" }] },
      stop: { mode: "stop", title: "停下", steps: [{ type: "stop" }] },
    },
  };
}

function readSteps(root: Record<string, unknown>): ActionIntent[] {
  const direct = asStepList(root.steps ?? root.actions ?? root.plan);
  if (direct.length) return direct;
  const mission = root.mission;
  if (mission && typeof mission === "object" && !Array.isArray(mission)) {
    const nested = asStepList((mission as Record<string, unknown>).steps);
    if (nested.length) return nested;
  }
  if (root.type || root.action) return asStepList([root]);
  const missions = root.missions;
  if (missions && typeof missions === "object") {
    const entries = Array.isArray(missions) ? missions : Object.values(missions as Record<string, unknown>);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const nested = asStepList((entry as Record<string, unknown>).steps);
      if (nested.length) return nested;
    }
  }
  const skill = String(root.skill ?? "");
  return skill ? stepsFromSkill(skill, root) : [];
}

function asStepList(value: unknown): ActionIntent[] {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeIntent).filter((step): step is ActionIntent => Boolean(step)).slice(0, 12);
}

function stepsFromSkill(skill: string, root: Record<string, unknown>): ActionIntent[] {
  const id = skill.trim().toLowerCase();
  if (!id || id === "clarify") return [];
  if (id === "follow" || id === "stop" || id === "sit" || id === "protect") return [{ type: id }];
  if (id === "sleep") return [{ type: "sleep", label: "睡觉" }];
  if (id === "tp" || id === "teleport") return [{ type: "tp", label: "传送" }];
  if (id === "status") return [{ type: "wait" }];
  if (id.includes("attack") || id.includes("hunt")) {
    const entity = typeof root.entity === "string" ? normalizeEntity(root.entity) : undefined;
    return [{ type: "attack", entity, label: entity ? mobLabel(entity) : "附近的怪物" }];
  }
  if (id.includes("build") || id.includes("cabin")) {
    return [
      { type: "collect", block: "oak_log", count: 8, label: "木头" },
      { type: "come" },
      { type: "build", template: "cabin", label: "小木屋" },
    ];
  }
  const type = normalizeType(id);
  return type ? [{ type }] : [];
}

function readMode(value: unknown, steps: ActionIntent[]): MissionMode {
  const text = String(value ?? "").trim().toLowerCase();
  const alias: Record<string, MissionMode> = {
    focused: "focused", follow: "follow", guard: "guard", hunt: "hunt", idle: "idle", stop: "stop", sit: "sit", sleep: "sleep",
    跟着: "follow", 跟随: "follow", 保护: "guard", 攻击: "hunt", 进攻: "hunt", 坐下: "sit", 停下: "stop", 睡觉: "sleep",
  };
  if (alias[text] || modes.includes(text as MissionMode)) return (alias[text] ?? text) as MissionMode;
  const types = new Set(steps.map((step) => step.type));
  if (types.has("sit")) return "sit";
  if (types.has("sleep")) return "sleep";
  if ([...types].every((type) => type === "attack" || type === "hunt")) return "hunt";
  if (types.size === 1 && types.has("follow")) return "follow";
  if (types.size === 1 && types.has("protect")) return "guard";
  if (types.has("stop")) return "stop";
  return "focused";
}

function sanitizeIntent(value: unknown): ActionIntent | undefined {
  if (typeof value === "string") return intentFromText(value);
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const type = normalizeType(String(raw.type ?? raw.action ?? ""));
  if (!type) return undefined;
  const intent: ActionIntent = { type };
  if (typeof raw.block === "string") intent.block = normalizeBlock(raw.block);
  if (typeof raw.entity === "string") intent.entity = normalizeEntity(raw.entity);
  if (typeof raw.item === "string") intent.item = normalizeBlock(raw.item);
  if (typeof raw.template === "string" && templates.includes(raw.template as BuildTemplate)) intent.template = raw.template;
  if (typeof raw.label === "string") intent.label = raw.label.trim().slice(0, 20);
  const count = typeof raw.count === "string" ? Number(raw.count) : raw.count;
  if (typeof count === "number" && Number.isFinite(count)) intent.count = Math.min(24, Math.max(1, Math.round(count)));
  for (const axis of ["x", "y", "z"] as const) {
    const n = raw[axis];
    if (typeof n === "number" && Number.isFinite(n)) intent[axis] = Math.round(n);
  }
  return intent;
}

function intentFromText(text: string): ActionIntent | undefined {
  const type = normalizeType(text);
  if (type) return { type };
  const [head, block, count] = text.trim().split(/\s+/);
  const mapped = normalizeType(head ?? "");
  if (!mapped) return undefined;
  const intent: ActionIntent = { type: mapped };
  if (block) intent.block = normalizeBlock(block);
  if (count && Number.isFinite(Number(count))) intent.count = Math.min(24, Math.max(1, Math.round(Number(count))));
  return intent;
}

const TYPE_ALIAS: Record<string, string> = {
  follow: "follow", 跟随: "follow", 跟着: "follow", 跟着我: "follow",
  stop: "stop", 停下: "stop", 停止: "stop", 别动: "stop",
  protect: "protect", 保护: "protect", 保护我: "protect",
  collect: "collect", mine: "collect", harvest: "collect", 采集: "collect", 挖: "collect", 砍: "collect", 砍树: "collect",
  attack: "attack", hunt: "attack", 攻击: "attack", 打: "attack", 打怪: "attack",
  build: "build", 建造: "build", 盖: "build",
  place: "place", 放置: "place",
  give: "give", toss: "give", 给: "give", 递: "give",
  come: "come", 过来: "come", 回来: "come",
  look: "look", 看: "look",
  dance: "dance", jump: "dance", 跳: "dance", 跳舞: "dance",
  eat: "eat", 吃: "eat",
  goto: "goto", 去: "goto",
  sit: "sit", rest: "sit", sneak: "sit", 坐下: "sit", 蹲下: "sit",
  sleep: "sleep", 睡觉: "sleep", 上床: "sleep", 过夜: "sleep",
  tp: "tp", teleport: "tp", 传送: "tp", 瞬移: "tp",
  wait: "wait", 等: "wait",
  find: "find", 找: "find",
  explore: "explore", 探索: "explore",
  status: "wait",
};

function normalizeType(raw: string): string {
  const text = raw.trim().toLowerCase();
  if (!text) return "";
  if (TYPE_ALIAS[text]) return TYPE_ALIAS[text];
  if (TYPE_ALIAS[raw.trim()]) return TYPE_ALIAS[raw.trim()];
  return "";
}

const BLOCK_ALIAS: Record<string, string> = {
  木头: "oak_log", 原木: "oak_log", 树: "oak_log", 树木: "oak_log", wood: "oak_log",
  石头: "stone", 圆石: "cobblestone",
  煤: "coal_ore", 煤矿: "coal_ore", coal: "coal_ore",
  铁: "iron_ore", 铁矿: "iron_ore", iron: "iron_ore",
  花: "dandelion", 火把: "torch",
};

function normalizeBlock(name: string): string {
  const text = name.trim();
  return (BLOCK_ALIAS[text] ?? BLOCK_ALIAS[text.toLowerCase()] ?? text.replace(/^minecraft:/, "")).slice(0, 40);
}

function normalizeEntity(name: string): string | undefined {
  const known = parseMob(name);
  if (known) return known.id;
  const raw = name.trim().toLowerCase().replace(/^minecraft:/, "");
  return raw ? raw.slice(0, 40) : undefined;
}

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function inferMode(id: string): MissionMode {
  if (id === "stop") return "stop";
  if (id === "protect") return "guard";
  if (id === "follow") return "follow";
  if (id === "sit") return "sit";
  if (id === "sleep") return "sleep";
  if (id === "attack") return "hunt";
  if (id === "clarify" || id === "status") return "idle";
  return "focused";
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
  if (task.skill === "sleep") {
    criteria.sleep = "孩子要上床睡觉，跳过夜晚。";
    missions.sleep = { mode: "sleep", title: "睡觉", steps: [{ type: "sleep", label: "睡觉" }] };
  }
  if (task.skill === "tp") {
    criteria.tp = "孩子要机器人用服务器的传送命令到自己身边。";
    missions.tp = { mode: "focused", title: "传送", steps: [{ type: "tp", label: "传送" }] };
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
  if (/(传送|瞬移|\btp\b)/i.test(text)) return { skill: "tp", reply: "好，我传送到你身边。" };
  if (/(睡觉|去睡|上床|跳过夜晚|睡到天亮|过夜)/.test(text)) return { skill: "sleep", reply: "好，我去床上睡觉。你也上床，我们就能到天亮。" };
  if (/(坐下|蹲下|坐着|坐下来|休息一下)/.test(text)) return { skill: "sit", reply: "好，我坐下来陪你。" };
  if (/(停|别动|停止)/.test(text)) return { skill: "stop", reply: "好，我停在这里等你。" };
  if (/(跟着|跟我|跟随)/.test(text)) return { skill: "follow", reply: "好，我跟着你。" };
  if (isPickupRequest(text)) return { skill: "pickup", reply: "好，我去捡你掉的东西。" };
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

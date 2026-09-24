const COMMAND_PREFIX = /^[!！]\s*bot\s*/i;
const DIRECT_ORDER = /^(跟着我|跟我|跟随|坐下|蹲下|坐下来|坐着|睡觉|去睡觉|上床|跳过夜晚|睡到天亮|过夜|传送|瞬移|tp|捡起来|捡东西|捡我的|拣起来|拣东西|放进箱子|放到箱子|放入箱子|存进箱子|从箱子|切换|创造|生存|冒险|旁观|做|合成|制作|工作台|攻击|进攻|去打|打怪|保护我|救我|停下|别动|停止|状态|砍|挖|采|摘|给|盖|建造)/;

export function parseGameCommand(raw: string, options: { persona?: string; direct?: boolean } = {}): string | undefined {
  let message = raw.replace(/\u00a7./g, "").trim();
  const bracket = message.match(/^<[^>\n]{1,40}>\s*(.*)$/);
  if (bracket) message = bracket[1].trim();
  if (!message || message.startsWith("/")) return undefined;
  if (COMMAND_PREFIX.test(message)) {
    const text = message.replace(COMMAND_PREFIX, "").trim();
    return text || "状态";
  }
  const persona = options.persona?.trim();
  if (persona) {
    const called = message.match(new RegExp(`^(?:@)?${escapeRegExp(persona)}[\\s,，:：]+(.*)$`));
    if (called) return called[1].trim() || "状态";
  }
  if (options.direct && DIRECT_ORDER.test(message)) return message;
  return undefined;
}

export function usernameFromChat(players: Array<{ username: string; uuid?: string }>, sender: unknown, senderName?: string): string | undefined {
  if (typeof sender === "string") {
    const found = players.find((player) => player.uuid === sender || player.username === sender);
    if (found && !found.username.includes("-")) return found.username;
    if (!sender.includes("-") && sender.length <= 16) return sender;
  }
  if (!senderName) return undefined;
  const plain = senderName.startsWith("{") ? readChatText(senderName) : senderName;
  if (!plain || plain.includes("-")) return undefined;
  return players.find((player) => player.username === plain)?.username ?? plain.slice(0, 16);
}

function readChatText(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

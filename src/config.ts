import "dotenv/config";

const port = Number(process.env.MC_PORT ?? 25565);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MC_PORT 必须是 1 到 65535 的整数");
}

const voicePort = Number(process.env.VOICE_PORT ?? 8787);
if (!Number.isInteger(voicePort) || voicePort < 1 || voicePort > 65535) {
  throw new Error("VOICE_PORT 必须是 1 到 65535 的整数");
}

const minConfidence = Number(process.env.JEV_MIN_CONFIDENCE ?? 0.85);
if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
  throw new Error("JEV_MIN_CONFIDENCE 必须是 0 到 1 的数字");
}

export const config = {
  host: process.env.MC_HOST ?? "localhost",
  port,
  username: process.env.MC_USERNAME ?? "CompanionBot",
  auth: process.env.MC_AUTH ?? "offline",
  allowedPlayers: new Set(
    (process.env.MC_ALLOWED_PLAYERS ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  ),
  companionPlayer: process.env.MC_COMPANION_PLAYER,
  voicePort,
  llm: {
    baseUrl: process.env.LLM_BASE_URL?.replace(/\/$/, ""),
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
  },
  jev: {
    apiKey: process.env.JEV_API_KEY,
    endpoint: process.env.JEV_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone",
    model: process.env.JEV_MODEL ?? "jev-1.13.0",
    minConfidence,
  },
  persona: {
    name: process.env.PERSONA_NAME ?? "阿搭",
    style: process.env.PERSONA_STYLE ?? "可靠的小伙伴，简短、友善、鼓励式，不说教",
  },
};

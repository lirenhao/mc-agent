import type { Bot } from "mineflayer";
import type { WorldState } from "./types.js";

const hostileNames = new Set(["zombie", "skeleton", "creeper", "spider", "enderman", "witch", "drowned", "husk"]);

export function getWorldState(bot: Bot): WorldState {
  const position = bot.entity.position.floored();
  const hostiles = Object.values(bot.entities)
    .filter((entity) => entity.type === "mob" && Boolean(entity.name) && hostileNames.has(entity.name!))
    .map((entity) => ({ name: entity.name!, distance: Number(entity.position.distanceTo(bot.entity.position).toFixed(1)) }))
    .filter((entity) => entity.distance < 20)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6);

  return {
    health: Math.round(bot.health),
    food: Math.round(bot.food),
    position: { x: position.x, y: position.y, z: position.z },
    time: bot.time.timeOfDay >= 13000 && bot.time.timeOfDay <= 23000 ? "night" : "day",
    nearbyPlayers: Object.values(bot.players).filter((player) => player.entity).map((player) => player.username),
    hostiles,
  };
}

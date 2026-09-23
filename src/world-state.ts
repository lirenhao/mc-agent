import type { Bot } from "mineflayer";
import { isHostileEntity } from "./mobs.js";
import type { Mission, WorldState } from "./types.js";

export function getWorldState(bot: Bot, childName?: string, mission?: Mission): WorldState {
  const position = bot.entity.position.floored();
  const child = childName ? bot.players[childName]?.entity : undefined;
  const hostiles = Object.values(bot.entities)
    .filter((entity) => isHostileEntity(entity))
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
    inventory: [...new Set(bot.inventory.items().map((item) => item.name))].slice(0, 16),
    childVisible: Boolean(child),
    childDistance: child ? Number(child.position.distanceTo(bot.entity.position).toFixed(1)) : undefined,
    mission: mission
      ? {
          title: mission.title,
          step: mission.stepIndex + 1,
          total: mission.steps.length,
          current: mission.steps[mission.stepIndex]?.type,
        }
      : undefined,
  };
}

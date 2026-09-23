export type MobLike = { type?: string; name?: string; kind?: string };

const peaceful = new Set([
  "player", "villager", "wandering_trader", "iron_golem", "snow_golem",
  "cat", "wolf", "allay", "parrot", "armor_stand",
]);

const neutral = new Set(["piglin", "zombified_piglin"]);

const namedHostiles = new Set([
  "zombie", "zombie_villager", "husk", "drowned",
  "skeleton", "stray", "bogged", "wither_skeleton",
  "creeper", "spider", "cave_spider", "enderman", "witch",
  "slime", "magma_cube", "phantom", "blaze", "ghast",
  "silverfish", "endermite", "guardian", "elder_guardian", "shulker",
  "pillager", "vindicator", "evoker", "vex", "ravager",
  "piglin_brute", "hoglin", "zoglin", "warden", "breeze", "creaking", "wither",
]);

export function isHostileEntity(entity: MobLike): entity is MobLike & { name: string } {
  const name = entity.name?.toLowerCase();
  if (!name || entity.type === "player" || peaceful.has(name) || neutral.has(name)) return false;
  if (entity.type === "hostile" || entity.kind === "Hostile mobs") return true;
  return namedHostiles.has(name);
}

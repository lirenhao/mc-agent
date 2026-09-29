/** Wooden doors, trapdoors, and fence gates. Iron doors stay shut. */
export function isToggleDoor(name: string): boolean {
  const id = name.replace(/^minecraft:/, "");
  if (id.startsWith("iron_")) return false;
  return id.endsWith("_door") || id.endsWith("_trapdoor") || id.endsWith("_fence_gate");
}

export function isDoorRequest(text: string): boolean {
  if (/(做|合成|制作|打造)/.test(text)) return false;
  return /开(?:一下)?门|打开(?:面前的|这个|那扇)?门|把门打开/.test(text);
}

export function doorIsClosed(open: boolean | string | number | undefined): boolean {
  return open !== true && open !== "true" && open !== 1 && open !== "1";
}

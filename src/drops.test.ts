import assert from "node:assert/strict";
import test from "node:test";
import { ChildDrops, isChildDrop, isDroppedItemName } from "./drops.js";

test("only dropped item entities are supplies", () => {
  assert.equal(isDroppedItemName("item"), true);
  assert.equal(isDroppedItemName("item_stack"), true);
  assert.equal(isDroppedItemName("experience_orb"), false);
  assert.equal(isDroppedItemName("zombie"), false);
  assert.equal(isChildDrop(3.5), true);
  assert.equal(isChildDrop(8), false);
});

test("a drop beside the child is kept, and a far one is not", () => {
  const drops = new ChildDrops();
  const child = { position: pos(0, 64, 0) };
  const near = { id: 1, name: "item", position: pos(2, 64, 0) };
  const far = { id: 2, name: "item", position: pos(20, 64, 0) };
  assert.equal(drops.notice(near, child.position), true);
  assert.equal(drops.notice(far, child.position), false);
  const world = {
    entity: { position: pos(3, 64, 1) },
    players: { 小明: { entity: child } },
    entities: { 1: near, 2: far },
  };
  assert.equal(drops.next(world, "小明")?.id, 1);
  drops.forget(1);
  assert.equal(drops.has(world, "小明"), false);
});

function pos(x: number, y: number, z: number) {
  return {
    x,
    y,
    z,
    distanceTo(other: { x: number; y: number; z: number }) {
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dz = this.z - other.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },
  };
}

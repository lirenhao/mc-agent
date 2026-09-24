import assert from "node:assert/strict";
import test from "node:test";
import { parseStorageRequest, storageNames } from "./storage.js";

test("storage phrases put items in or take them out", () => {
  assert.deepEqual(parseStorageRequest("把东西放进箱子"), { mode: "deposit", label: "背包里的东西" });
  assert.deepEqual(parseStorageRequest("把木头存进箱子"), { mode: "deposit", item: "oak_log", label: "木头" });
  assert.deepEqual(parseStorageRequest("从箱子里拿火把"), { mode: "withdraw", item: "torch", label: "火把" });
  assert.equal(parseStorageRequest("做一个箱子"), undefined);
  assert.equal(parseStorageRequest("跟着我"), undefined);
  assert.deepEqual(storageNames("oak_log")?.includes("birch_log"), true);
});

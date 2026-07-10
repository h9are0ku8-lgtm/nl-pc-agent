import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planWithRules } from "./planner.js";
import { resolveInWorkspace } from "./safety.js";
import { runStep } from "./tools.js";

test("整理依頼は organize_by_extension を含む", () => {
  const plan = planWithRules("ダウンロードフォルダを整理して");
  assert.ok(plan.steps.some((s) => s.tool === "organize_by_extension"));
});

test("ワークスペース外パスは拒否する", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-root-"));
  assert.throws(() => resolveInWorkspace(root, "/tmp/outside.txt"));
});

test("拡張子整理が動く", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ws-"));
  const inbox = path.join(root, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(inbox, "a.pdf"), "pdf");
  fs.writeFileSync(path.join(inbox, "b.txt"), "txt");

  const result = await runStep(root, {
    tool: "organize_by_extension",
    args: { path: "inbox" },
  });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(inbox, "pdf", "a.pdf")));
  assert.ok(fs.existsSync(path.join(inbox, "txt", "b.txt")));
});

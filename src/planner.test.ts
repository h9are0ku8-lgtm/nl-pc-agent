import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planWithRules } from "./planner.js";
import { resolveInWorkspace } from "./safety.js";
import { assertPublicHttpUrl, htmlTableToCsv, runStep } from "./tools.js";

test("整理依頼は organize_by_extension を含む", () => {
  const plan = planWithRules("ダウンロードフォルダを整理して");
  assert.ok(plan.steps.some((s) => s.tool === "organize_by_extension"));
});

test("昨日×Slack移動は move_recent_files を使う", () => {
  const plan = planWithRules("昨日作ったファイルを全部Slack用フォルダへ移動");
  assert.ok(plan.steps.some((s) => s.tool === "move_recent_files"));
});

test("ワークスペース外パスは拒否する", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-root-"));
  assert.throws(() => resolveInWorkspace(root, "/tmp/outside.txt"));
});

test("localhost URL は拒否する", () => {
  assert.throws(() => assertPublicHttpUrl("http://127.0.0.1/secret"));
});

test("HTMLテーブルをCSVに変換できる", () => {
  const csv = htmlTableToCsv(
    "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>"
  );
  assert.match(csv, /a,b/);
  assert.match(csv, /1,2/);
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

test("直近ファイル移動が動く", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-move-"));
  const inbox = path.join(root, "inbox");
  const slack = path.join(root, "slack");
  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(slack, { recursive: true });
  fs.writeFileSync(path.join(inbox, "today.txt"), "x");

  const result = await runStep(root, {
    tool: "move_recent_files",
    args: { from: "inbox", to: "slack", withinDays: "1" },
  });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(slack, "today.txt")));
});

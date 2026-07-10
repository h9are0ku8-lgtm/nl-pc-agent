#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createPlan } from "./planner.js";
import { confirmPlan, executePlan } from "./executor.js";
import { ensureWorkspace, getWorkspaceRoot, homeDownloadsHint } from "./safety.js";

function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function printHelp(): void {
  console.log(`
自然言語PCエージェント (MVP)

使い方:
  npm start -- "inboxを整理して"
  npm start -- --yes "CSVサンプルを作って"

オプション:
  --yes   確認なしで実行
  --help  ヘルプ

安全策:
  - 操作できるのは AGENT_WORKSPACE（既定: ./workspace）内のみ
  - 実際の Downloads を触る場合は AGENT_WORKSPACE にそのパスを設定
  - いまの Downloads ヒント: ${homeDownloadsHint()}

例:
  1) workspace/inbox にファイルを置く
  2) npm start -- "ダウンロードフォルダを整理して"
`);
}

async function main(): Promise<void> {
  loadEnvFile();
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const autoYes = argv.includes("--yes");
  const request = argv.filter((a) => a !== "--yes").join(" ").trim();
  if (!request) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const root = getWorkspaceRoot();
  ensureWorkspace(root);
  console.log(`ワークスペース: ${root}`);
  console.log(`依頼: ${request}`);

  const { plan, mode } = await createPlan(request);
  console.log(`プランナー: ${mode}`);

  const ok = await confirmPlan(plan, autoYes);
  if (!ok) {
    console.log("キャンセルしました。");
    return;
  }

  await executePlan(root, plan);
  console.log("\n完了");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

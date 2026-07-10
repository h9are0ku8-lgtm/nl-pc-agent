import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * エージェントが操作してよいルートを決める。
 * デフォルトはプロジェクト内の workspace/（安全のためホーム全体は触らない）
 */
export function getWorkspaceRoot(cwd = process.cwd()): string {
  const fromEnv = process.env.AGENT_WORKSPACE?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.resolve(cwd, "workspace");
}

export function ensureWorkspace(root: string): void {
  fs.mkdirSync(root, { recursive: true });
  const inbox = path.join(root, "inbox");
  const outbox = path.join(root, "outbox");
  const slack = path.join(root, "slack");
  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(outbox, { recursive: true });
  fs.mkdirSync(slack, { recursive: true });
}

/**
 * パスがワークスペース内か検証する。外への書き込みを防ぐ。
 */
export function resolveInWorkspace(root: string, inputPath: string): string {
  const absolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(root, inputPath);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`安全制限: ワークスペース外は操作できません → ${absolute}`);
  }
  return absolute;
}

export function homeDownloadsHint(): string {
  return path.join(os.homedir(), "Downloads");
}

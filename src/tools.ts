import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import ExcelJS from "exceljs";
import { resolveInWorkspace } from "./safety.js";
import type { Step } from "./types.js";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;

export type ToolResult = {
  ok: boolean;
  message: string;
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runStep(root: string, step: Step): Promise<ToolResult> {
  const args = step.args;

  switch (step.tool) {
    case "list_files": {
      const target = resolveInWorkspace(root, args.path || ".");
      const entries = await fs.readdir(target, { withFileTypes: true });
      const lines = entries.map((e) => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`);
      return {
        ok: true,
        message: lines.length ? lines.join("\n") : "(空です)",
      };
    }
    case "make_dir": {
      const target = resolveInWorkspace(root, args.path || "");
      await fs.mkdir(target, { recursive: true });
      return { ok: true, message: `フォルダ作成: ${target}` };
    }
    case "move_file": {
      const from = resolveInWorkspace(root, args.from || "");
      const to = resolveInWorkspace(root, args.to || "");
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return { ok: true, message: `移動: ${from} → ${to}` };
    }
    case "copy_file": {
      const from = resolveInWorkspace(root, args.from || "");
      const to = resolveInWorkspace(root, args.to || "");
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      return { ok: true, message: `コピー: ${from} → ${to}` };
    }
    case "rename_file": {
      const from = resolveInWorkspace(root, args.from || "");
      const dir = path.dirname(from);
      const to = resolveInWorkspace(root, path.join(dir, args.toName || args.to || ""));
      await fs.rename(from, to);
      return { ok: true, message: `リネーム: ${from} → ${to}` };
    }
    case "organize_by_extension": {
      const target = resolveInWorkspace(root, args.path || "inbox");
      const entries = await fs.readdir(target, { withFileTypes: true });
      const moved: string[] = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).replace(".", "").toLowerCase() || "other";
        const destDir = path.join(target, ext);
        await fs.mkdir(destDir, { recursive: true });
        const from = path.join(target, entry.name);
        const to = path.join(destDir, entry.name);
        if (from === to) continue;
        if (await exists(to)) {
          const stamped = path.join(destDir, `${Date.now()}_${entry.name}`);
          await fs.rename(from, stamped);
          moved.push(`${entry.name} → ${ext}/`);
        } else {
          await fs.rename(from, to);
          moved.push(`${entry.name} → ${ext}/`);
        }
      }
      return {
        ok: true,
        message: moved.length
          ? `整理完了 (${moved.length}件)\n${moved.join("\n")}`
          : "整理対象のファイルがありません",
      };
    }
    case "extract_pdf_text": {
      const target = resolveInWorkspace(root, args.path || "");
      const buf = await fs.readFile(target);
      const parsed = await pdf(buf);
      const out = resolveInWorkspace(
        root,
        args.out || path.join("outbox", `${path.basename(target, ".pdf")}.txt`)
      );
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, parsed.text, "utf8");
      return {
        ok: true,
        message: `PDFテキスト抽出 → ${out} (${parsed.text.length}文字)`,
      };
    }
    case "summarize_pdf_to_excel": {
      const target = resolveInWorkspace(root, args.path || "");
      const buf = await fs.readFile(target);
      const parsed = await pdf(buf);
      const text = parsed.text.replace(/\s+/g, " ").trim();
      const chunks = text.match(/.{1,120}/g)?.slice(0, 20) ?? ["(本文なし)"];
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("summary");
      sheet.columns = [
        { header: "no", key: "no", width: 8 },
        { header: "excerpt", key: "excerpt", width: 80 },
      ];
      chunks.forEach((excerpt, i) => sheet.addRow({ no: i + 1, excerpt }));
      const out = resolveInWorkspace(
        root,
        args.out || path.join("outbox", `${path.basename(target, ".pdf")}_summary.xlsx`)
      );
      await fs.mkdir(path.dirname(out), { recursive: true });
      await workbook.xlsx.writeFile(out);
      return {
        ok: true,
        message: `PDF要約シート作成 → ${out}（抜粋 ${chunks.length} 行）`,
      };
    }
    case "write_csv": {
      const out = resolveInWorkspace(root, args.path || path.join("outbox", "data.csv"));
      const content = args.content || "col1,col2\n";
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, content, "utf8");
      return { ok: true, message: `CSV保存 → ${out}` };
    }
    case "write_text": {
      const out = resolveInWorkspace(root, args.path || path.join("outbox", "note.txt"));
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, args.content || "", "utf8");
      return { ok: true, message: `テキスト保存 → ${out}` };
    }
    default:
      return { ok: false, message: `未対応ツール: ${(step as Step).tool}` };
  }
}

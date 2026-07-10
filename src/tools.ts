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

/** プライベートIPやlocalhostへのSSR Fを避ける簡易チェック */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URLが不正です");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("http/https のみ許可されています");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error("ローカル/プライベートアドレスへのアクセスは禁止です");
  }
  return url;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** HTMLの単純な table をCSV文字列にする（最初の表） */
export function htmlTableToCsv(html: string): string {
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    throw new Error("HTML内に <table> が見つかりませんでした");
  }
  const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  const csvRows: string[] = [];
  for (const row of rows) {
    const cells = [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) =>
      csvEscape(
        m[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim()
      )
    );
    if (cells.length) csvRows.push(cells.join(","));
  }
  if (!csvRows.length) throw new Error("表の行を抽出できませんでした");
  return csvRows.join("\n") + "\n";
}

async function summarizeTextWithGemini(text: string): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return text.match(/.{1,120}/g)?.slice(0, 8) ?? ["(本文なし)"];
  }
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `次の文書を日本語で箇条書き要約してください。最大8項目。各項目は1行。番号や記号は不要。\n\n${text.slice(0, 12000)}`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.2 },
    }),
  });
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!res.ok) {
    return text.match(/.{1,120}/g)?.slice(0, 8) ?? ["(要約失敗のため抜粋)"];
  }
  const raw =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";
  const lines = raw
    .split(/\n/)
    .map((l) => l.replace(/^[\s\-*・\d.]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  return lines.length ? lines : ["(要約結果が空でした)"];
}

export async function runStep(root: string, step: Step): Promise<ToolResult> {
  const args = step.args;

  switch (step.tool) {
    case "list_files": {
      const target = resolveInWorkspace(root, args.path || ".");
      const entries = await fs.readdir(target, { withFileTypes: true });
      const lines = entries.map((e) => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`);
      return { ok: true, message: lines.length ? lines.join("\n") : "(空です)" };
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
        if (await exists(to)) {
          await fs.rename(from, path.join(destDir, `${Date.now()}_${entry.name}`));
        } else {
          await fs.rename(from, to);
        }
        moved.push(`${entry.name} → ${ext}/`);
      }
      return {
        ok: true,
        message: moved.length
          ? `整理完了 (${moved.length}件)\n${moved.join("\n")}`
          : "整理対象のファイルがありません",
      };
    }
    case "move_recent_files": {
      // days=1 なら「昨日以降」ではなく「直近24時間」より分かりやすく:
      // withinDays=1 → 過去1日以内に更新されたファイル
      const fromDir = resolveInWorkspace(root, args.from || "inbox");
      const toDir = resolveInWorkspace(root, args.to || "slack");
      const withinDays = Math.max(1, Number(args.withinDays || args.days || "1"));
      const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
      await fs.mkdir(toDir, { recursive: true });
      const entries = await fs.readdir(fromDir, { withFileTypes: true });
      const moved: string[] = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const from = path.join(fromDir, entry.name);
        const stat = await fs.stat(from);
        if (stat.mtimeMs < cutoff) continue;
        const to = path.join(toDir, entry.name);
        if (await exists(to)) {
          await fs.rename(from, path.join(toDir, `${Date.now()}_${entry.name}`));
        } else {
          await fs.rename(from, to);
        }
        moved.push(entry.name);
      }
      return {
        ok: true,
        message: moved.length
          ? `直近${withinDays}日のファイルを移動 (${moved.length}件)\n${moved.join("\n")}`
          : `直近${withinDays}日に更新されたファイルはありません`,
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
      const lines = await summarizeTextWithGemini(text);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("summary");
      sheet.columns = [
        { header: "no", key: "no", width: 8 },
        { header: "summary", key: "summary", width: 100 },
      ];
      lines.forEach((summary, i) => sheet.addRow({ no: i + 1, summary }));
      const out = resolveInWorkspace(
        root,
        args.out || path.join("outbox", `${path.basename(target, ".pdf")}_summary.xlsx`)
      );
      await fs.mkdir(path.dirname(out), { recursive: true });
      await workbook.xlsx.writeFile(out);
      const mode = process.env.GEMINI_API_KEY?.trim() ? "AI要約" : "抜粋モード";
      return {
        ok: true,
        message: `PDF→Excel（${mode}） → ${out}（${lines.length}行）`,
      };
    }
    case "fetch_url_to_csv": {
      const url = assertPublicHttpUrl(args.url || "");
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "nl-pc-agent/0.1" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return { ok: false, message: `取得失敗: HTTP ${res.status}` };
      }
      const contentType = res.headers.get("content-type") || "";
      const body = await res.text();
      let csv = "";
      if (contentType.includes("json") || body.trim().startsWith("[") || body.trim().startsWith("{")) {
        const data = JSON.parse(body) as unknown;
        const rows = Array.isArray(data) ? data : [data];
        if (!rows.length || typeof rows[0] !== "object" || rows[0] === null) {
          throw new Error("JSONを表形式に変換できません");
        }
        const flatten = (obj: Record<string, unknown>, prefix = ""): Record<string, string> => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(obj)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === "object" && !Array.isArray(v)) {
              Object.assign(out, flatten(v as Record<string, unknown>, key));
            } else {
              out[key] = Array.isArray(v) ? JSON.stringify(v) : String(v ?? "");
            }
          }
          return out;
        };
        const flatRows = rows.map((row) => flatten(row as Record<string, unknown>));
        const keys = [...new Set(flatRows.flatMap((r) => Object.keys(r)))];
        csv =
          keys.join(",") +
          "\n" +
          flatRows
            .map((row) => keys.map((k) => csvEscape(row[k] ?? "")).join(","))
            .join("\n") +
          "\n";
      } else {
        csv = htmlTableToCsv(body);
      }
      const out = resolveInWorkspace(root, args.out || path.join("outbox", "fetched.csv"));
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, csv, "utf8");
      return { ok: true, message: `URLからCSV保存 → ${out}` };
    }
    case "write_csv": {
      const out = resolveInWorkspace(root, args.path || path.join("outbox", "data.csv"));
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, args.content || "col1,col2\n", "utf8");
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

import fs from "node:fs";
import path from "node:path";
import { PlanSchema, type Plan } from "./types.js";

const TOOL_LIST = `
使えるツール:
- list_files {path}
- make_dir {path}
- move_file {from,to}
- copy_file {from,to}
- rename_file {from,toName}
- organize_by_extension {path}
- move_recent_files {from,to,withinDays}  … 直近N日更新ファイルを移動
- extract_pdf_text {path,out?}
- summarize_pdf_to_excel {path,out?}  … PDF要約をExcel化（GeminiがあればAI要約）
- fetch_url_to_csv {url,out?}  … 公開URLの表/JSONをCSV保存
- write_csv {path,content}
- write_text {path,content}

パスはワークスペース相対（inbox, outbox, slack など）。
`;

function firstPdfInInbox(rootHint = process.cwd()): string | null {
  const inbox = path.join(rootHint, "workspace", "inbox");
  if (!fs.existsSync(inbox)) return null;
  const pdfs: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.toLowerCase().endsWith(".pdf")) {
        pdfs.push(path.relative(path.join(rootHint, "workspace"), full));
      }
    }
  };
  walk(inbox);
  return pdfs[0] ?? null;
}

/**
 * APIキーが無いとき用の簡易プランナー
 */
export function planWithRules(request: string): Plan {
  const text = request.trim();

  if (/整理|organize/i.test(text)) {
    return {
      summary: "inbox を拡張子ごとに整理します",
      steps: [
        { tool: "list_files", args: { path: "inbox" }, note: "現状確認" },
        { tool: "organize_by_extension", args: { path: "inbox" } },
        { tool: "list_files", args: { path: "inbox" }, note: "結果確認" },
      ],
    };
  }

  if (
    /(昨日|直近|最近)/.test(text) &&
    /(slack|スラック)/i.test(text) &&
    /(移動|移して|移す)/.test(text)
  ) {
    return {
      summary: "直近1日に更新された inbox ファイルを slack へ移動します",
      steps: [
        { tool: "list_files", args: { path: "inbox" } },
        {
          tool: "move_recent_files",
          args: { from: "inbox", to: "slack", withinDays: "1" },
        },
        { tool: "list_files", args: { path: "slack" } },
      ],
    };
  }

  if (/(slack|スラック)/i.test(text) && /(移動|移して|移す)/.test(text)) {
    return {
      summary: "inbox の直近ファイルを slack フォルダへ移動します",
      steps: [
        {
          tool: "move_recent_files",
          args: { from: "inbox", to: "slack", withinDays: "7" },
          note: "直近7日分を移動",
        },
        { tool: "list_files", args: { path: "slack" } },
      ],
    };
  }

  if (/pdf/i.test(text) && /(要約|excel|エクセル|xlsx)/i.test(text)) {
    const found = firstPdfInInbox();
    const pdfPath = found || "inbox/sample.pdf";
    return {
      summary: `PDFを要約してExcel化します（対象: ${pdfPath}）`,
      steps: [
        { tool: "list_files", args: { path: "inbox" } },
        {
          tool: "summarize_pdf_to_excel",
          args: {
            path: pdfPath,
            out: "outbox/pdf_summary.xlsx",
          },
          note: found
            ? "inbox内のPDFを自動検出"
            : "inboxにPDFを置いてから再実行してください",
        },
      ],
    };
  }

  if (/(http|www\.|サイト|取得|スクレイピング|売上)/i.test(text)) {
    const urlMatch = text.match(/https?:\/\/\S+/);
    if (urlMatch) {
      return {
        summary: "指定URLから表/JSONを取得してCSV保存します",
        steps: [
          {
            tool: "fetch_url_to_csv",
            args: { url: urlMatch[0], out: "outbox/fetched.csv" },
          },
        ],
      };
    }
    return {
      summary: "URL付きで依頼してください（例: このURLから取得 https://... ）",
      steps: [
        {
          tool: "write_text",
          args: {
            path: "outbox/need_url.txt",
            content:
              "Web取得には https://... のURLが必要です。表があるページかJSON APIを指定してください。",
          },
        },
      ],
    };
  }

  if (/csv/i.test(text)) {
    return {
      summary: "サンプルCSVをoutboxに作成します",
      steps: [
        {
          tool: "write_csv",
          args: {
            path: "outbox/sales.csv",
            content: "date,amount\n2026-07-09,1000\n2026-07-10,1200\n",
          },
        },
      ],
    };
  }

  return {
    summary: "依頼内容確認のためフォルダ一覧を表示します",
    steps: [
      { tool: "list_files", args: { path: "." } },
      { tool: "list_files", args: { path: "inbox" } },
      { tool: "list_files", args: { path: "outbox" } },
      { tool: "list_files", args: { path: "slack" } },
    ],
  };
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}

export async function planWithGemini(request: string): Promise<Plan> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY 未設定");

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const prompt = `
あなたはPC作業エージェントのプランナーです。
ユーザー依頼を、許可されたツールだけのJSONプランに分解してください。
危険なシェル実行やワークスペース外操作は禁止です。
${TOOL_LIST}

出力は次のJSONのみ:
{"summary":"短い説明","steps":[{"tool":"...","args":{"k":"v"},"note":"任意"}]}

ユーザー依頼:
${request}
`.trim();

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  const data = (await res.json()) as GeminiResponse;
  if (!res.ok) throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n");
  if (!text) throw new Error("Gemini応答が空");
  return PlanSchema.parse(extractJson(text));
}

export async function createPlan(request: string): Promise<{ plan: Plan; mode: string }> {
  if (process.env.GEMINI_API_KEY?.trim()) {
    try {
      return { plan: await planWithGemini(request), mode: "gemini" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      const plan = planWithRules(request);
      plan.summary = `${plan.summary}（Gemini失敗のためルール切替: ${reason}）`;
      return { plan, mode: "rules-fallback" };
    }
  }
  return { plan: planWithRules(request), mode: "rules" };
}

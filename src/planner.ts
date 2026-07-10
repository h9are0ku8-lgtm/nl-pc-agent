import { PlanSchema, type Plan } from "./types.js";

const TOOL_LIST = `
使えるツール:
- list_files {path}
- make_dir {path}
- move_file {from,to}
- copy_file {from,to}
- rename_file {from,toName}
- organize_by_extension {path}  … 拡張子ごとにフォルダ分け
- extract_pdf_text {path,out?}
- summarize_pdf_to_excel {path,out?}  … PDF本文抜粋をExcel化
- write_csv {path,content}
- write_text {path,content}

パスはワークスペース相対で書く（例: inbox, outbox/a.pdf, slack/）。
`;

/**
 * APIキーが無いとき用の簡易プランナー（よくある依頼をルールで分解）
 */
export function planWithRules(request: string): Plan {
  const text = request.trim();

  if (/整理|organize|ダウンロード|inbox/i.test(text)) {
    return {
      summary: "inbox（作業フォルダ）を拡張子ごとに整理します",
      steps: [
        { tool: "list_files", args: { path: "inbox" }, note: "現状確認" },
        {
          tool: "organize_by_extension",
          args: { path: "inbox" },
          note: "拡張子別フォルダへ移動",
        },
        { tool: "list_files", args: { path: "inbox" }, note: "結果確認" },
      ],
    };
  }

  if (/pdf/i.test(text) && /(要約|excel|エクセル|xlsx)/i.test(text)) {
    return {
      summary: "inbox内のPDFを探し、要約Excelをoutboxへ出力します",
      steps: [
        { tool: "list_files", args: { path: "inbox" } },
        {
          tool: "summarize_pdf_to_excel",
          args: { path: "inbox/sample.pdf", out: "outbox/sample_summary.xlsx" },
          note: "inboxにPDFを置いてから実行してください（ファイル名は必要に応じて変更）",
        },
      ],
    };
  }

  if (/slack|スラック/i.test(text) && /(移動|移して|移す)/i.test(text)) {
    return {
      summary: "inboxのファイルをslackフォルダへ移動する準備プランです",
      steps: [
        { tool: "list_files", args: { path: "inbox" } },
        { tool: "make_dir", args: { path: "slack" } },
        {
          tool: "write_text",
          args: {
            path: "outbox/move_hint.txt",
            content:
              "個別ファイルの移動は move_file で from/to を指定してください。例: inbox/a.pdf → slack/a.pdf",
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
    summary: "依頼内容を確認するための一覧表示プランです",
    steps: [
      { tool: "list_files", args: { path: "." } },
      { tool: "list_files", args: { path: "inbox" } },
      { tool: "list_files", args: { path: "outbox" } },
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

/**
 * Geminiで自然言語をJSONプランに分解する
 */
export async function planWithGemini(request: string): Promise<Plan> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 未設定");
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const prompt = `
あなたはPC作業エージェントのプランナーです。
ユーザー依頼を、許可されたツールだけのJSONプランに分解してください。
危険なシェル実行やワークスペース外操作は禁止です。
${TOOL_LIST}

出力は次のJSONのみ:
{
  "summary": "短い説明",
  "steps": [{"tool":"...", "args":{"k":"v"}, "note":"任意"}]
}

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
  if (!res.ok) {
    throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n");
  if (!text) throw new Error("Gemini応答が空");
  return PlanSchema.parse(extractJson(text));
}

export async function createPlan(request: string): Promise<{ plan: Plan; mode: string }> {
  if (process.env.GEMINI_API_KEY?.trim()) {
    try {
      const plan = await planWithGemini(request);
      return { plan, mode: "gemini" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      const plan = planWithRules(request);
      plan.summary = `${plan.summary}（Gemini失敗のためルールプランに切替: ${reason}）`;
      return { plan, mode: "rules-fallback" };
    }
  }
  return { plan: planWithRules(request), mode: "rules" };
}

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Plan } from "./types.js";
import { runStep } from "./tools.js";

export async function confirmPlan(plan: Plan, autoYes: boolean): Promise<boolean> {
  console.log("\n--- 実行プラン ---");
  console.log(plan.summary);
  plan.steps.forEach((step, i) => {
    console.log(
      `${i + 1}. ${step.tool} ${JSON.stringify(step.args)}${step.note ? `  # ${step.note}` : ""}`
    );
  });
  console.log("------------------\n");

  if (autoYes) return true;

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("このプランを実行しますか？ (y/N): ");
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export async function executePlan(root: string, plan: Plan): Promise<void> {
  for (const [index, step] of plan.steps.entries()) {
    process.stdout.write(`\n[${index + 1}/${plan.steps.length}] ${step.tool} ... `);
    try {
      const result = await runStep(root, step);
      console.log(result.ok ? "OK" : "NG");
      console.log(result.message);
      if (!result.ok) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("NG");
      console.log(message);
      break;
    }
  }
}

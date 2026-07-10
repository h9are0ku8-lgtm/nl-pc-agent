import { z } from "zod";

export const StepSchema = z.object({
  tool: z.enum([
    "list_files",
    "make_dir",
    "move_file",
    "copy_file",
    "rename_file",
    "organize_by_extension",
    "extract_pdf_text",
    "summarize_pdf_to_excel",
    "write_csv",
    "write_text",
  ]),
  args: z.record(z.string()).default({}),
  note: z.string().optional(),
});

export const PlanSchema = z.object({
  summary: z.string(),
  steps: z.array(StepSchema).min(1),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Step = z.infer<typeof StepSchema>;

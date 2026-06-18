// System prompts for the chat-based workflows. Single source of truth is
// shared/prompts.json (kept in sync with the macOS app); this module assembles
// the final prompt strings, mirroring BlitztextMac/Services/LLMService.swift.
import promptData from "../../shared/prompts.json";
import type { Settings, WorkflowType } from "./config";

function improvementPrompt(s: Settings["improve"]): string {
  const t = promptData.textImprovement;
  const termsBlock = s.customTerms.length
    ? "\n\n" + t.customTermsTemplate.replace("{{terms}}", s.customTerms.join(", "))
    : "";

  // A custom instruction overrides the default base + tone (but still honors
  // the custom terms), exactly like the macOS app.
  const custom = s.systemPrompt.trim();
  if (custom) return custom + termsBlock;

  let prompt = `${t.base}\n${t.tone[s.tone]}`;
  prompt += termsBlock;
  if (s.context.trim()) {
    prompt += "\n\n" + t.contextTemplate.replace("{{context}}", s.context.trim());
  }
  return prompt;
}

/**
 * The system prompt for a workflow's chat step, or null for `transcribe`
 * (which has no chat step — the raw transcript is the result).
 */
export function systemPromptFor(workflow: WorkflowType, settings: Settings): string | null {
  switch (workflow) {
    case "transcribe":
      return null;
    case "improve":
      return improvementPrompt(settings.improve);
    case "emoji":
      return promptData.emoji.base.replace(
        "{{density}}",
        promptData.emoji.density[settings.emoji.density],
      );
    case "dampf":
      return settings.dampf.systemPrompt.trim() || promptData.dampfAblassen.default;
  }
}

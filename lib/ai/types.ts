export const AI_ACTIONS = [
  "chat",
  "checkup",
  "brief_daily",
  "brief_weekly",
  "brief_monthly"
] as const;

export type AiAction = (typeof AI_ACTIONS)[number];

export const AI_ACTION_LABELS: Record<AiAction, string> = {
  chat: "只读对话",
  checkup: "资产体检",
  brief_daily: "资产日报",
  brief_weekly: "资产周报",
  brief_monthly: "资产月报"
};

export interface AiRequestBody {
  action: AiAction;
  message?: string;
}


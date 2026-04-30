export interface Task {
  id: string;
  type: string;
  assigned_agent: string;
  priority: "low" | "medium" | "high" | "critical";
  payload: any;
  timestamp: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: any;
}
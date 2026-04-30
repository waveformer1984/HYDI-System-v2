export interface Event {
  id: string;
  type: string;
  source_agent: string;
  target_agent: string | "broadcast";
  priority: "low" | "medium" | "high" | "critical";
  payload: any;
  timestamp: string;
}
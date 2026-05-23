export type CampaignStatus = 'ready' | 'in_progress' | 'planned' | 'partnerships_needed' | 'submitted';
export type CampaignCategory = 'grant' | 'corporate';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export interface Campaign {
  id: string;
  name: string;
  funder: string;
  amount: number;
  deadline: string;
  status: CampaignStatus;
  category: CampaignCategory;
  description: string;
  probability: number;
  completionPct: number;
  priority: Priority;
  missingItems?: string[];
  contacts?: string[];
  tags?: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

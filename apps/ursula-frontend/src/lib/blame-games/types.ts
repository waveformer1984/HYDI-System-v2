export interface BlameUser {
  id: string;
  handle: string;
  displayName: string;
  reputation: number;
  avatarUrl?: string;
  createdAt: string;
}

export type CaseStatus = 'open' | 'voting' | 'resolved' | 'appealed';
export type CaseCategory = 'code_drift' | 'build_failure' | 'agent_error' | 'workflow_block' | 'other';

export interface BlameCase {
  id: string;
  title: string;
  description: string;
  category: CaseCategory;
  status: CaseStatus;
  creatorId: string;
  assigneeId?: string;
  evidence: CaseEvidence[];
  votes: CaseVote[];
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface CaseEvidence {
  id: string;
  type: 'log' | 'screenshot' | 'commit' | 'agent_trace';
  content: string;
  timestamp: string;
  agentId?: string;
}

export interface CaseVote {
  userId: string;
  verdict: 'guilty' | 'innocent' | 'abstain';
  stake: number; // reputation points staked
  timestamp: string;
}

export interface BlameBet {
  id: string;
  caseId: string;
  userId: string;
  prediction: 'guilty' | 'innocent';
  amount: number; // reputation points, not money
  oddsAtPlacement: number;
  status: 'active' | 'won' | 'lost' | 'cancelled';
  placedAt: string;
  resolvedAt?: string;
  payout?: number;
}

export interface VerifierBid {
  id: string;
  caseId: string;
  verifierId: string;
  confidence: number; // 0-1
  analysis: string;
  bidAt: string;
}

export interface LeaderboardEntry {
  userId: string;
  handle: string;
  displayName: string;
  totalReputation: number;
  casesCorrect: number;
  casesTotal: number;
  winRate: number;
  rank: number;
}

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'abandoned';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface ProtoProject {
  id: string;
  title: string;
  description: string;
  category: string; // e.g., "software", "home_renovation", "business_launch"
  status: ProjectStatus;
  priority: Priority;
  ownerId: string;
  startDate?: string;
  targetDate?: string;
  completedDate?: string;
  budget?: number;
  spent?: number;
  milestones: ProtoMilestone[];
  tasks: ProtoTask[];
  resources: ProtoResource[];
  logs: ProtoLog[];
  createdAt: string;
  updatedAt: string;
}

export interface ProtoMilestone {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  completedAt?: string;
  status: 'pending' | 'achieved' | 'missed';
}

export interface ProtoTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigneeId?: string;
  estimatedHours?: number;
  actualHours?: number;
  dependsOn?: string[]; // task IDs
  milestoneId?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ProtoResource {
  id: string;
  name: string;
  type: 'material' | 'tool' | 'budget' | 'time' | 'person';
  quantity?: number;
  unit?: string;
  cost?: number;
  allocated: number;
  used: number;
  notes?: string;
}

export interface ProtoLog {
  id: string;
  type: 'note' | 'photo' | 'voice' | 'metric';
  content: string;
  attachments?: string[];
  createdAt: string;
  createdBy: string;
}

export interface ProtoTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultTasks: Omit<ProtoTask, 'id' | 'createdAt'>[];
  defaultMilestones: Omit<ProtoMilestone, 'id'>[];
  defaultResources: Omit<ProtoResource, 'id'>[];
}

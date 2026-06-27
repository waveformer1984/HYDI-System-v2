export type TaskPriority = 'low' | 'medium' | 'high';
export type MaintenanceInterval = 'weekly' | 'monthly' | 'quarterly' | 'annual';

export interface PorchwiseTask {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  category: string;
  estimatedHours: number;
  estimatedCost: number;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  completedAt?: string;
}

export interface MaintenanceSchedule {
  id: string;
  name: string;
  interval: MaintenanceInterval;
  tasks: string[];
  nextDue: string;
}

export interface ProjectEstimate {
  hours: number;
  cost: number;
  timeline: string;
  breakdown: Array<{
    phase: string;
    hours: number;
    cost: number;
  }>;
}

export interface PropertyProfile {
  id: string;
  name: string;
  type: 'residential' | 'commercial' | 'industrial';
  sizeSqFt: number;
  yearBuilt: number;
  tasks: PorchwiseTask[];
  schedules: MaintenanceSchedule[];
  estimates: ProjectEstimate[];
  createdAt: string;
}

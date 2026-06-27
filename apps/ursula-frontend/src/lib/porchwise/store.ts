import { PropertyProfile, PorchwiseTask, MaintenanceSchedule, ProjectEstimate } from './types';

class PorchwiseStore {
  properties: Map<string, PropertyProfile> = new Map();
  initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const now = new Date().toISOString();
    const nextWeek = new Date(Date.now() + 7 * 864e5).toISOString();
    const nextMonth = new Date(Date.now() + 30 * 864e5).toISOString();

    const tasks: PorchwiseTask[] = [
      {
        id: 'task-001',
        title: 'HVAC Filter Replacement',
        description: 'Replace all air filters in main HVAC units. Use MERV-13 rated filters.',
        priority: 'high',
        category: 'HVAC',
        estimatedHours: 1,
        estimatedCost: 45,
        status: 'pending',
        createdAt: now,
      },
      {
        id: 'task-002',
        title: 'Gutter Cleaning',
        description: 'Clear debris from roof gutters and downspouts. Check for damage.',
        priority: 'medium',
        category: 'Exterior',
        estimatedHours: 3,
        estimatedCost: 120,
        status: 'in_progress',
        createdAt: now,
      },
      {
        id: 'task-003',
        title: 'Smoke Detector Battery Check',
        description: 'Test all smoke/CO detectors. Replace batteries where voltage < 9V.',
        priority: 'high',
        category: 'Safety',
        estimatedHours: 0.5,
        estimatedCost: 15,
        status: 'completed',
        createdAt: now,
        completedAt: now,
      },
      {
        id: 'task-004',
        title: 'Deck Sealant Application',
        description: 'Power wash and apply waterproof sealant to rear deck surfaces.',
        priority: 'low',
        category: 'Exterior',
        estimatedHours: 6,
        estimatedCost: 280,
        status: 'pending',
        createdAt: now,
      },
    ];

    const schedules: MaintenanceSchedule[] = [
      {
        id: 'sched-001',
        name: 'HVAC Service',
        interval: 'quarterly',
        tasks: ['Filter replacement', 'Coil cleaning', 'Duct inspection', 'Thermostat calibration'],
        nextDue: nextMonth,
      },
      {
        id: 'sched-002',
        name: 'Exterior Inspection',
        interval: 'monthly',
        tasks: ['Gutter check', 'Siding inspection', 'Foundation crack scan'],
        nextDue: nextWeek,
      },
      {
        id: 'sched-003',
        name: 'Safety Systems Audit',
        interval: 'quarterly',
        tasks: ['Smoke/CO detector test', 'Fire extinguisher inspection', 'Emergency exit lighting test'],
        nextDue: nextMonth,
      },
    ];

    const estimate: ProjectEstimate = {
      hours: 22,
      cost: 1250,
      timeline: '2-3 weeks',
      breakdown: [
        { phase: 'Diagnostics & Planning', hours: 4, cost: 200 },
        { phase: 'HVAC Service', hours: 8, cost: 500 },
        { phase: 'Exterior Work', hours: 6, cost: 350 },
        { phase: 'Safety Upgrades', hours: 4, cost: 200 },
      ],
    };

    this.properties.set('prop-001', {
      id: 'prop-001',
      name: 'Prototype HQ',
      type: 'commercial',
      sizeSqFt: 4200,
      yearBuilt: 2019,
      tasks,
      schedules,
      estimates: [estimate],
      createdAt: now,
    });
  }
}

export const porchwiseStore = new PorchwiseStore();

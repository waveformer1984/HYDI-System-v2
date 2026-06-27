import { NextRequest, NextResponse } from 'next/server';
import { protoIStore } from '@/lib/protoi/store';

protoIStore.init();

export async function GET(): Promise<NextResponse> {
  const projects = Array.from(protoIStore.projects.values());
  return NextResponse.json({ success: true, projects });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const id = `proj-${Date.now()}`;
    const now = new Date().toISOString();
    const tpl = body.templateId ? protoIStore.templates.get(body.templateId) : undefined;

    const newProject = {
      id,
      title: body.title || 'Untitled Project',
      description: body.description || '',
      category: body.category || 'software',
      status: 'planning' as const,
      priority: body.priority || 'medium',
      ownerId: body.ownerId || 'anonymous',
      startDate: body.startDate,
      targetDate: body.targetDate,
      budget: body.budget,
      spent: 0,
      milestones: tpl ? tpl.defaultMilestones.map((m, i) => ({ ...m, id: `ms-${Date.now()}-${i}` })) : [],
      tasks: tpl ? tpl.defaultTasks.map((t, i) => ({ ...t, id: `task-${Date.now()}-${i}`, createdAt: now })) : [],
      resources: tpl ? tpl.defaultResources.map((r, i) => ({ ...r, id: `res-${Date.now()}-${i}` })) : [],
      logs: [],
      createdAt: now,
      updatedAt: now,
    };

    protoIStore.projects.set(id, newProject);
    return NextResponse.json({ success: true, project: newProject }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }
}

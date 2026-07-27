'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDashboard } from '@/lib/dashboard/dashboard-context';
import { ListTodo, CheckCircle, Loader, AlertCircle, Clock, XCircle } from 'lucide-react';

function statusIcon(status: string) {
  switch (status) {
    case 'running':
      return <Loader className="h-4 w-4 animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case 'cancelled':
      return <XCircle className="h-4 w-4 text-gray-500" />;
    default:
      return <Clock className="h-4 w-4 text-yellow-500" />;
  }
}

function priorityBadge(priority: string) {
  switch (priority) {
    case 'critical':
      return <Badge variant="destructive">{priority}</Badge>;
    case 'high':
      return <Badge className="bg-orange-500">{priority}</Badge>;
    case 'low':
      return <Badge variant="secondary">{priority}</Badge>;
    default:
      return <Badge variant="outline">{priority}</Badge>;
  }
}

export function TaskQueuePanel() {
  const { tasks } = useDashboard();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListTodo className="h-5 w-5" />
          Task Orchestrator
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Task</th>
                <th className="px-3 py-2 text-left font-medium">Agent</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Priority</th>
                <th className="px-3 py-2 text-left font-medium">Progress</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-t">
                  <td className="px-3 py-2">{task.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{task.assignedAgent ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {statusIcon(task.status)}
                      <span className="capitalize">{task.status}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{priorityBadge(task.priority)}</td>
                  <td className="px-3 py-2">
                    <div className="w-full max-w-[120px] h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${task.progress}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={5}>
                    No tasks in queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

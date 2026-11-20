import { auth } from '@/lib/auth';
import { listWorkspacesForUser } from '@/lib/workspace/access';

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  let workspaces: Awaited<ReturnType<typeof listWorkspacesForUser>> = [];
  if (userId) {
    try {
      workspaces = await listWorkspacesForUser(userId);
    } catch {
      workspaces = [];
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        Welcome{session?.user?.name ? `, ${session.user.name}` : ''}. Lead discovery and research ship in
        Stages 2–4.
      </p>
      <section className="mt-8 rounded-lg border border-slate-200 bg-surface p-4 dark:border-slate-700">
        <h2 className="font-medium">Your workspaces</h2>
        {workspaces.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No workspace loaded — check database configuration.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {workspaces.map(({ workspace, role }) => (
              <li key={workspace.id}>
                <span className="font-medium">{workspace.name}</span>{' '}
                <span className="text-slate-500">({role})</span>
                {workspace.demoMode ? <span className="ml-2 text-xs text-amber-600">demo mode</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
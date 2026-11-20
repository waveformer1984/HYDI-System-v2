export function EmptyStage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-surface p-8 text-center dark:border-slate-600">
      <h1 className="text-xl font-medium">{title}</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{detail}</p>
    </div>
  );
}
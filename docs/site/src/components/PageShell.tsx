import type { ReactNode } from 'react';

/** Shared doc-page shell: a centered content column with a title header. */
export default function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-2 text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="prose-dsh">{children}</div>
    </div>
  );
}

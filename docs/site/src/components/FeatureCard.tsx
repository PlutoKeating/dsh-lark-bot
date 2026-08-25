import type { ReactNode } from 'react';

export default function FeatureCard({ icon, title, en, children }: {
  icon: string;
  title: string;
  en?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{icon}</span>
        <div>
          <div className="font-semibold text-slate-900">{title}</div>
          {en ? <div className="text-xs text-slate-500">{en}</div> : null}
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">{children}</p>
    </div>
  );
}

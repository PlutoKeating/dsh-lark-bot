import type { ReactNode } from 'react';

type Variant = 'info' | 'warn' | 'danger' | 'success';

const STYLES: Record<Variant, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

export default function Notice({ children, variant = 'info' }: { children: ReactNode; variant?: Variant }) {
  return (
    <div className={`my-4 rounded-lg border px-4 py-3 text-sm ${STYLES[variant]}`}>{children}</div>
  );
}

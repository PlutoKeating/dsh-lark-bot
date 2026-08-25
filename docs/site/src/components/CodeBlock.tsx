import { useState } from 'react';

export default function CodeBlock({ title, code }: { title?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };
  return (
    <div className="my-4 rounded-lg border border-slate-200 bg-slate-900 text-slate-100 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 text-xs text-slate-300">
        <span>{title ?? 'code'}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-2 py-0.5 text-slate-300 hover:bg-slate-700 transition-colors"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="px-4 py-3 overflow-x-auto text-sm leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

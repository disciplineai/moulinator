'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Toast = {
  id: string;
  tone: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
};

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();

function id() {
  return Math.random().toString(36).slice(2, 10);
}

export const toast = {
  success(title: string, detail?: string) {
    dispatch({ id: id(), tone: 'success', title, detail });
  },
  error(title: string, detail?: string) {
    dispatch({ id: id(), tone: 'error', title, detail });
  },
  info(title: string, detail?: string) {
    dispatch({ id: id(), tone: 'info', title, detail });
  },
};

function dispatch(t: Toast) {
  for (const l of listeners) l(t);
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast: Listener = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 5000);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-6 right-6 z-50 flex w-[360px] flex-col gap-2"
    >
      {items.map((t) => {
        const tone =
          t.tone === 'success'
            ? { border: '#4F7942', label: 'OK', fg: '#3F6434' }
            : t.tone === 'error'
              ? { border: '#B33A23', label: 'ERR', fg: '#8E2E1A' }
              : { border: '#3B6E8F', label: 'LOG', fg: '#2A4A63' };
        return (
          <div
            key={t.id}
            role="status"
            className="paper-plain animate-slide-in"
            style={{ borderLeft: `3px solid ${tone.border}` }}
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <span
                className="stamp"
                style={{ color: tone.fg, borderColor: tone.border }}
              >
                {tone.label}
              </span>
              <div className="flex-1">
                <div className="font-mono text-sm text-ink">{t.title}</div>
                {t.detail && <div className="mt-1 font-mono text-xs text-ink-400">{t.detail}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

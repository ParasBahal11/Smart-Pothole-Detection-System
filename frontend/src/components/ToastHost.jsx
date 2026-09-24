import React from 'react';

export default function ToastHost({ toasts }) {
  if (!toasts?.length) return null;
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

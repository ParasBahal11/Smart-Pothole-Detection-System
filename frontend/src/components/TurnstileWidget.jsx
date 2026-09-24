import React, { useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export default function TurnstileWidget({ siteKey, onToken, resetKey }) {
  const hostRef = useRef(null);
  const widgetId = useRef(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !window.turnstile || !hostRef.current) return;
      if (widgetId.current != null) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
      hostRef.current.innerHTML = '';
      widgetId.current = window.turnstile.render(hostRef.current, {
        sitekey: siteKey,
        theme: 'light',
        callback: (token) => onTokenRef.current?.(token),
        'expired-callback': () => onTokenRef.current?.(''),
        'error-callback': () => onTokenRef.current?.(''),
      });
    };

    const ensureScript = () =>
      new Promise((resolve) => {
        if (window.turnstile) return resolve();
        const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
        if (existing) {
          existing.addEventListener('load', () => resolve(), { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        document.head.appendChild(script);
      });

    ensureScript().then(renderWidget);

    return () => {
      cancelled = true;
      if (widgetId.current != null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey, resetKey]);

  return <div ref={hostRef} className="cf-turnstile" />;
}

'use client';

import { useEffect, useRef } from 'react';

export default function RoadmapEmbed() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Optional: handle messages from the Vite app (e.g., height changes)
      if (event.data?.type === 'roadmap-height' && typeof event.data.height === 'number') {
        if (iframeRef.current) {
          iframeRef.current.style.height = `${event.data.height}px`;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="w-full h-full bg-gray-900 rounded-lg overflow-hidden">
      <iframe
        ref={iframeRef}
        src="http://localhost:3000"
        className="w-full h-full border-0"
        title="ProtoForge Roadmap"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        loading="lazy"
      />
    </div>
  );
}

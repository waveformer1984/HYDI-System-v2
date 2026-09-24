import { useEffect } from 'react';
import Head from 'next/head';
import HeidiMobileApp from '../components/heidi-mobile/HeidiMobileApp';

/**
 * /heidi — Heidi Mobile, the phone-first chat and control surface for HYDI.
 *
 * Installable as a PWA (public/heidi.webmanifest, scope /heidi). All HYDI
 * access goes through the server-side BFF at /api/heidi-mobile/*; this page
 * holds no credentials. See docs/HEIDI_MOBILE.md.
 */
export default function HeidiPage() {
  useEffect(() => {
    // Production only: in dev, chunk URLs are not content-hashed, so a
    // cache-first worker would serve stale code after every edit.
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/heidi-sw.js', { scope: '/heidi' }).catch(() => {
      // Offline shell is an enhancement; the app works without it.
    });
  }, []);

  return (
    <>
      <Head>
        <title>Heidi</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="theme-color" content="#0a0a0f" />
        <meta name="description" content="Heidi — mobile chat and control for HYDI" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Heidi" />
        <meta name="color-scheme" content="dark" />
        <meta name="referrer" content="no-referrer" />
        <link rel="manifest" href="/heidi.webmanifest" />
        <link rel="icon" href="/heidi-icons/icon-192.png" sizes="192x192" type="image/png" />
        <link rel="apple-touch-icon" href="/heidi-icons/icon-192.png" />
      </Head>
      <HeidiMobileApp />
    </>
  );
}

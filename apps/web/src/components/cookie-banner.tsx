'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { getConsent, OPEN_CONSENT_EVENT, saveConsent } from '../lib/consent';

/** Банер згоди: зʼявляється, доки користувач не зробив вибір; повторно — з футера. */
export function CookieBanner() {
  const t = useTranslations('privacy.banner');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(getConsent() === null);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (!open) {
      document.body.style.paddingBottom = '';
      return;
    }
    const apply = () => {
      const height = bannerRef.current?.offsetHeight ?? 0;
      document.body.style.paddingBottom = height > 0 ? `${height}px` : '7rem';
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.body.style.paddingBottom = '';
    };
  }, [open]);

  if (!open) return null;
  const decide = (analytics: boolean) => {
    saveConsent(analytics);
    setOpen(false);
  };
  return (
    <div
      ref={bannerRef}
      role="dialog"
      aria-live="polite"
      aria-label={t('title')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4">
        <p className="min-w-[16rem] flex-1 text-sm text-neutral-700">
          {t('text')}{' '}
          <Link
            href={`/${locale}/privacy#cookies`}
            className="font-medium text-brand-dark underline"
          >
            {t('more')}
          </Link>
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => decide(false)}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            {t('necessary')}
          </button>
          <button
            onClick={() => decide(true)}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-300"
          >
            {t('acceptAll')}
          </button>
        </div>
      </div>
    </div>
  );
}

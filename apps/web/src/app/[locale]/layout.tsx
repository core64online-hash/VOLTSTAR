import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing, type Locale } from '../../i18n/routing';
import { CookieBanner } from '../../components/cookie-banner';
import { ErrorReporter } from '../../components/error-reporter';
import { SiteFooter } from '../../components/site-footer';
import { SiteHeader } from '../../components/site-header';
import { SITE_NAME, SITE_URL } from '../../lib/seo';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t('title'), template: `%s — ${SITE_NAME}` },
    description: t('description'),
    applicationName: SITE_NAME,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  const messages = await getMessages();
  const tA11y = await getTranslations({ locale, namespace: 'a11y' });

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <a
            href="#content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-black focus:px-4 focus:py-2 focus:text-white"
          >
            {tA11y('skipToContent')}
          </a>
          <SiteHeader locale={locale} />
          <div id="content" tabIndex={-1} className="outline-none">
            {children}
          </div>
          <SiteFooter />
          <CookieBanner />
          <ErrorReporter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

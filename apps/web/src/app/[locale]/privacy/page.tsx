import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { pageMetadata } from '../../../lib/seo';
import { policy } from './content';

const legal = {
  name: process.env.NEXT_PUBLIC_LEGAL_NAME ?? 'ТОВ «ВОЛЬТСТАР»',
  edrpou: process.env.NEXT_PUBLIC_LEGAL_EDRPOU ?? '',
  email: process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? 'privacy@voltstar.ua',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const seo = await getTranslations({ locale, namespace: 'seo' });
  return pageMetadata({ locale, path: '/privacy', title: policy(locale, legal).title, description: seo('privacy') });
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const doc = policy(locale, legal);
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mt-2 text-3xl font-bold">{doc.title}</h1>
      <p className="mt-3 text-neutral-600">{doc.intro}</p>
      <nav aria-label={doc.title} className="mt-6 rounded-xl bg-neutral-50 p-4 text-sm">
        <ol className="grid gap-1 sm:grid-cols-2">
          {doc.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-brand-dark hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {doc.sections.map((s) => (
        <section key={s.id} id={s.id} className="mt-8 scroll-mt-6">
          <h2 className="text-xl font-semibold">{s.title}</h2>
          {s.paragraphs?.map((p, i) => (
            <p key={i} className="mt-2 leading-relaxed text-neutral-700">
              {p}
            </p>
          ))}
          {s.items && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-neutral-700">
              {s.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}

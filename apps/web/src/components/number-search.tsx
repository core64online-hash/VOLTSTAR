import { useTranslations } from 'next-intl';

/**
 * Пошук по крос-номеру — головний вхід у каталог. Клієнт приходить із номером, знятим
 * з агрегата або взятим із каталогу техніки, тож поле має бути першим, що він бачить.
 *
 * Звичайна GET-форма без клієнтського JS: працює у будь-якому браузері, результат — окрема
 * адреса, якою можна поділитися з майстром чи постачальником.
 */
export function NumberSearch({ locale, defaultValue }: { locale: string; defaultValue?: string }) {
  const t = useTranslations('lookup');

  return (
    <form action={`/${locale}/lookup`} method="get" className="mx-auto flex w-full max-w-2xl gap-2">
      <input
        type="search"
        name="number"
        required
        defaultValue={defaultValue ?? ''}
        placeholder={t('placeholder')}
        aria-label={t('label')}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-neutral-300 px-4 py-3 font-mono text-base text-neutral-900 placeholder:font-sans placeholder:text-neutral-500"
      />
      <button
        type="submit"
        className="shrink-0 rounded-lg bg-brand px-6 py-3 font-semibold text-black hover:bg-yellow-300"
      >
        {t('submit')}
      </button>
    </form>
  );
}

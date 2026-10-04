import Link from 'next/link';

/** Site header: the VOLTSTAR lockup links home. */
export function SiteHeader({ locale }: { locale: string }) {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center px-4 py-2">
        <Link href={`/${locale}`} className="inline-flex">
          <img
            src="/voltstar-logo.png"
            alt="VOLTSTAR"
            width={320}
            height={192}
            className="h-16 w-auto"
          />
        </Link>
      </div>
    </header>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { loginUser, saveToken } from '../../../lib/auth';

export function LoginForm() {
  const t = useTranslations('account');
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await loginUser({ email, password });
      if (!saveToken(res.accessToken)) {
        setError(t('errorGeneric'));
        return;
      }
      router.push(`/${locale}/account`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  const field = 'mt-1 w-full rounded border border-neutral-300 px-3 py-2';

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm">
        {t('email')}
        <input
          type="email"
          required
          autoComplete="email"
          className={field}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t('password')}
        <input
          type="password"
          required
          autoComplete="current-password"
          className={field}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <p className="text-right text-sm">
        <Link href={`/${locale}/forgot-password`} className="text-neutral-600 hover:underline">
          {t('forgot.link')}
        </Link>
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand px-6 py-3 font-semibold text-black hover:bg-yellow-300 disabled:opacity-50"
      >
        {loading ? t('login.submitting') : t('login.submit')}
      </button>

      <p className="text-sm text-neutral-600">
        {t('login.noAccount')}{' '}
        <Link href={`/${locale}/register`} className="font-medium text-brand-dark hover:underline">
          {t('login.toRegister')}
        </Link>
      </p>
    </form>
  );
}

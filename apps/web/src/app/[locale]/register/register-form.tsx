'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { OrgType, RegisterInput, Segment } from '@voltstar/types';
import { registerUser, saveToken } from '../../../lib/auth';

type AccountType = 'INDIVIDUAL' | 'BUSINESS' | 'GOVERNMENT';

const SEGMENT_BY_TYPE: Record<AccountType, Segment> = {
  INDIVIDUAL: 'B2C',
  BUSINESS: 'B2B',
  GOVERNMENT: 'B2G',
};

export function RegisterForm() {
  const t = useTranslations('account');
  const tPrivacy = useTranslations('privacy');
  const locale = useLocale();
  const router = useRouter();

  const [accountType, setAccountType] = useState<AccountType>('INDIVIDUAL');
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    orgName: '',
    edrpou: '',
    vatNumber: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const isOrg = accountType !== 'INDIVIDUAL';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const input: RegisterInput = {
        email: form.email,
        password: form.password,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        phone: form.phone || undefined,
        organization: isOrg
          ? {
              name: form.orgName,
              type: accountType as OrgType,
              segment: SEGMENT_BY_TYPE[accountType],
              edrpou: form.edrpou || undefined,
              vatNumber: form.vatNumber || undefined,
            }
          : undefined,
      };
      const res = await registerUser(input);
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
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          {t('firstName')}
          <input className={field} value={form.firstName} onChange={set('firstName')} />
        </label>
        <label className="block text-sm">
          {t('lastName')}
          <input className={field} value={form.lastName} onChange={set('lastName')} />
        </label>
      </div>

      <label className="block text-sm">
        {t('email')}
        <input type="email" required autoComplete="email" className={field} value={form.email} onChange={set('email')} />
      </label>
      <label className="block text-sm">
        {t('password')}
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={field}
          value={form.password}
          onChange={set('password')}
        />
      </label>
      <label className="block text-sm">
        {t('phone')}
        <input className={field} value={form.phone} onChange={set('phone')} />
      </label>

      <label className="block text-sm">
        {t('accountType')}
        <select
          className={field}
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as AccountType)}
        >
          <option value="INDIVIDUAL">{t('types.INDIVIDUAL')}</option>
          <option value="BUSINESS">{t('types.BUSINESS')}</option>
          <option value="GOVERNMENT">{t('types.GOVERNMENT')}</option>
        </select>
      </label>

      {isOrg && (
        <div className="space-y-4 rounded-lg border border-neutral-200 p-4">
          <label className="block text-sm">
            {t('orgName')}
            <input required className={field} value={form.orgName} onChange={set('orgName')} />
          </label>
          <label className="block text-sm">
            {t('edrpou')}
            <input
              required
              inputMode="numeric"
              pattern="\d{8}"
              className={field}
              value={form.edrpou}
              onChange={set('edrpou')}
            />
          </label>
          <label className="block text-sm">
            {t('vatNumber')}
            <input inputMode="numeric" className={field} value={form.vatNumber} onChange={set('vatNumber')} />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <p className="text-xs text-neutral-500">
        {tPrivacy('registerNotice')}{' '}
        <Link href={`/${locale}/privacy`} className="underline">
          {tPrivacy('policyLink')}
        </Link>
      </p>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand px-6 py-3 font-semibold text-black hover:bg-yellow-300 disabled:opacity-50"
      >
        {loading ? t('register.submitting') : t('register.submit')}
      </button>

      <p className="text-sm text-neutral-600">
        {t('register.haveAccount')}{' '}
        <Link href={`/${locale}/login`} className="font-medium text-brand-dark hover:underline">
          {t('register.toLogin')}
        </Link>
      </p>
    </form>
  );
}

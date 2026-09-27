'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  DeliveryMethod,
  type Cart,
  type CheckoutResult,
  type DeliveryMethod as DeliveryMethodT,
  type PaymentProviderKind,
} from '@voltstar/types';
import { formatPrice } from '../../../lib/api';
import { checkout, loadCart, redirectToPayment, removeCartItem, updateCartItem } from '../../../lib/cart';

export function CartView() {
  const t = useTranslations('cart');
  const locale = useLocale();
  const [cart, setCart] = useState<Cart | null>(null);
  const [delivery, setDelivery] = useState<DeliveryMethodT>(DeliveryMethod.NOVA_POSHTA);
  const [provider, setProvider] = useState<PaymentProviderKind>('WAYFORPAY');
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<CheckoutResult | null>(null);

  const money = (minor: number) => formatPrice(minor, cart?.currency ?? 'UAH', `${locale}-UA`);

  const run = useCallback(async (action: () => Promise<Cart>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setCart(next);
      setDelivery(next.deliveryMethod);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void run(() => loadCart());
  }, [run]);

  async function onCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!cart) return;
    setBusy(true);
    setError(null);
    try {
      const card = cart.segment === 'B2C';
      const result = await checkout({
        cartId: cart.id,
        deliveryMethod: delivery,
        contact,
        provider: card ? (cart.currency === 'UAH' ? provider : 'STRIPE') : undefined,
        returnUrl: `${window.location.origin}/${locale}/checkout/return`,
      });
      if (!redirectToPayment(result.payment)) setInvoice(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  }

  if (invoice?.payment.invoice) {
    const inv = invoice.payment.invoice;
    return (
      <div className="space-y-4 rounded-xl border border-green-200 bg-green-50 p-6">
        <h2 className="text-xl font-semibold">{t('invoice.title', { number: invoice.orderNumber })}</h2>
        <p className="text-sm text-neutral-700">{t('invoice.text')}</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t('invoice.recipient')} value={inv.recipient} />
          <Row label={t('invoice.edrpou')} value={inv.recipientEdrpou} />
          <Row label="IBAN" value={inv.iban} />
          <Row label={t('invoice.amount')} value={formatPrice(inv.amountMinor, inv.currency, `${locale}-UA`)} />
          <Row label={t('invoice.purpose')} value={inv.purpose} />
        </dl>
      </div>
    );
  }

  if (!cart) {
    return <p className="text-neutral-500">{error ?? t('loading')}</p>;
  }

  const empty = cart.lines.length === 0 && cart.unavailable.length === 0;
  if (empty) {
    return (
      <p className="text-neutral-600">
        {t('empty')}{' '}
        <Link href={`/${locale}/catalog`} className="font-medium text-brand-dark hover:underline">
          {t('toCatalog')}
        </Link>
      </p>
    );
  }

  const field = 'mt-1 w-full rounded border border-neutral-300 px-3 py-2';
  const coreDepositMinor = cart.lines.reduce(
    (sum, l) => sum + (l.coreDepositMinor ?? 0) * l.quantity,
    0,
  );

  return (
    <div className="space-y-8">
      <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
        {cart.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 p-4">
            <span className="flex-1">
              <Link
                href={`/${locale}/catalog/${l.slug}`}
                className="font-medium hover:underline"
              >
                {l.name}
              </Link>
              <span className="block font-mono text-xs text-neutral-600">{l.partNumber}</span>
            </span>
            <input
              type="number"
              min={1}
              aria-label={t('qty')}
              className="w-20 rounded border px-2 py-1"
              value={l.quantity}
              disabled={busy}
              onChange={(e) => {
                const q = Number(e.target.value);
                if (q >= 1) void run(() => updateCartItem(cart.id, l.id, q));
              }}
            />
            <span className="w-32 text-right font-semibold">{money(l.grossMinor)}</span>
            <button
              type="button"
              disabled={busy}
              className="text-sm text-red-600"
              onClick={() => void run(() => removeCartItem(cart.id, l.id))}
            >
              {t('remove')}
            </button>
          </li>
        ))}
        {cart.unavailable.map((u) => (
          <li key={u.id} className="flex items-center gap-3 bg-amber-50 p-4 text-sm">
            <span className="flex-1">
              {u.name} — <span className="text-amber-700">{t('unavailable')}</span>
            </span>
            <button
              type="button"
              disabled={busy}
              className="text-red-600"
              onClick={() => void run(() => removeCartItem(cart.id, u.id))}
            >
              {t('remove')}
            </button>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 md:grid-cols-2">
        <label className="block text-sm">
          {t('delivery')}
          <select
            className={field}
            value={delivery}
            disabled={busy}
            onChange={(e) => {
              const method = e.target.value as DeliveryMethodT;
              void run(() => loadCart(method));
            }}
          >
            {Object.values(DeliveryMethod).map((m) => (
              <option key={m} value={m} disabled={cart.currency !== 'UAH' && m !== 'PICKUP'}>
                {t(`deliveryMethods.${m}`)}
              </option>
            ))}
          </select>
        </label>

        <dl className="space-y-1 text-sm">
          <Row label={t('totals.items')} value={money(cart.totals.itemsGrossMinor)} />
          <Row
            label={t('totals.delivery')}
            value={cart.totals.deliveryMinor === 0 ? t('totals.free') : money(cart.totals.deliveryMinor)}
          />
          <Row label={t('totals.vat')} value={money(cart.totals.vatMinor)} />
          {/* Застава за старий агрегат у суму замовлення не входить: її вносять при отриманні,
              якщо старий агрегат не здано, і повертають, коли здано. */}
          {coreDepositMinor > 0 && (
            <Row label={t('totals.coreDeposit')} value={money(coreDepositMinor)} />
          )}
          <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-bold">
            <dt>{t('totals.total')}</dt>
            <dd>{money(cart.totals.grossMinor)}</dd>
          </div>
        </dl>
      </div>

      <form onSubmit={onCheckout} className="space-y-4 rounded-xl border border-neutral-200 p-5">
        <h2 className="text-lg font-semibold">{t('checkout.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            {t('checkout.name')}
            <input required minLength={2} className={field} value={contact.name}
              onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} />
          </label>
          <label className="block text-sm">
            Email
            <input required type="email" className={field} value={contact.email}
              onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} />
          </label>
          <label className="block text-sm">
            {t('checkout.phone')}
            <input required type="tel" minLength={7} className={field} value={contact.phone}
              onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} />
          </label>
        </div>

        {cart.segment === 'B2C' ? (
          cart.currency === 'UAH' && (
            <label className="block text-sm sm:w-1/2">
              {t('checkout.provider')}
              <select className={field} value={provider} onChange={(e) => setProvider(e.target.value as PaymentProviderKind)}>
                <option value="WAYFORPAY">WayForPay</option>
                <option value="LIQPAY">LiqPay</option>
              </select>
            </label>
          )
        ) : (
          <p className="text-sm text-neutral-600">{t('checkout.invoiceNote')}</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy || cart.lines.length === 0 || cart.unavailable.length > 0}
          className="rounded-lg bg-brand px-6 py-3 font-semibold text-black hover:bg-yellow-300 disabled:opacity-50"
        >
          {busy ? t('checkout.submitting') : cart.segment === 'B2C' ? t('checkout.pay') : t('checkout.invoice')}
        </button>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

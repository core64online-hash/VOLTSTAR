'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Analytics } from '@voltstar/types';
import { formatPrice } from '../../../lib/api';
import { fetchAnalytics } from '../../../lib/admin';
import { useLoad } from '../../../lib/use-load';
import { Card, inputCls } from './ui';

const PRESETS = [7, 30, 90] as const;

/** Дата РРРР-ММ-ДД у Києві (так само рахує сервер). */
const kyivDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d);
const daysAgo = (n: number) => kyivDate(new Date(Date.now() - n * 24 * 3600 * 1000));

export function Dashboard() {
  const t = useTranslations('admin.dashboard');
  const [period, setPeriod] = useState({ from: daysAgo(29), to: kyivDate(new Date()) });
  const { data, error } = useLoad(() => fetchAnalytics(period), [period.from, period.to]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {PRESETS.map((n) => (
          <button
            key={n}
            onClick={() => setPeriod({ from: daysAgo(n - 1), to: kyivDate(new Date()) })}
            className={`rounded-full border px-3 py-1 ${
              period.from === daysAgo(n - 1) && period.to === kyivDate(new Date())
                ? 'border-black bg-black text-white'
                : 'border-neutral-300'
            }`}
          >
            {t('lastDays', { n })}
          </button>
        ))}
        <label>
          {t('from')}{' '}
          <input
            type="date"
            className={inputCls}
            value={period.from}
            max={period.to}
            onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, from: e.target.value }))}
          />
        </label>
        <label>
          {t('to')}{' '}
          <input
            type="date"
            className={inputCls}
            value={period.to}
            min={period.from}
            onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, to: e.target.value }))}
          />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && <Report data={data} />}
    </div>
  );
}

function Report({ data }: { data: Analytics }) {
  const t = useTranslations('admin.dashboard');
  const tCrm = useTranslations('crm');
  const locale = useLocale();
  const money = (minor: number) => formatPrice(minor, data.currency, `${locale}-UA`);
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const { sales, funnel, partRequests } = data;

  const kpis = [
    {
      key: 'revenue',
      value: money(sales.revenueMinor),
      hint: sales.refundsMinor ? t('refunds', { sum: money(sales.refundsMinor) }) : null,
    },
    {
      key: 'paidOrders',
      value: String(sales.paidOrders),
      hint: t('placed', { n: sales.placedOrders }),
    },
    { key: 'aov', value: money(sales.averageOrderMinor), hint: null },
    { key: 'paymentRate', value: pct(sales.paymentRate), hint: null },
    {
      key: 'winRate',
      value: pct(funnel.winRate),
      hint: t('wonLost', { won: funnel.won.count, lost: funnel.lost.count }),
    },
    {
      key: 'partRequestRate',
      value: pct(partRequests.dealRate),
      hint: t('partRequestsHint', { n: partRequests.leads }),
    },
  ];

  const maxDay = Math.max(1, ...sales.byDay.map((d) => d.revenueMinor));
  const maxLead = Math.max(1, ...funnel.leads.map((l) => l.count));
  const maxStage = Math.max(1, ...funnel.openPipeline.map((s) => s.amountMinor));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.key} data-kpi={k.key} className="rounded-xl border border-neutral-200 p-4">
            <p className="text-xs text-neutral-500">{t(`kpi.${k.key}`)}</p>
            <p className="mt-1 text-xl font-bold">{k.value}</p>
            {k.hint && <p className="mt-1 text-xs text-neutral-500">{k.hint}</p>}
          </div>
        ))}
      </div>

      <Card title={t('revenueByDay')}>
        {sales.paidOrders === 0 ? (
          <p className="text-sm text-neutral-500">{t('noSales')}</p>
        ) : (
          <div className="flex h-48 items-end gap-px" role="img" aria-label={t('revenueByDay')}>
            {sales.byDay.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${money(d.revenueMinor)} · ${t('ordersN', { n: d.orders })}`}
                className="flex-1 rounded-t bg-brand"
                style={{
                  height: `${Math.max(d.revenueMinor ? 3 : 0, (d.revenueMinor / maxDay) * 100)}%`,
                }}
              />
            ))}
          </div>
        )}
        <div className="mt-1 flex justify-between text-xs text-neutral-500">
          <span>{data.period.from}</span>
          <span>{data.period.to}</span>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('bySegment')}>
          <table className="w-full text-sm">
            <tbody>
              {sales.bySegment.map((s) => (
                <tr key={s.segment} className="border-b border-neutral-100 last:border-0">
                  <td className="py-1.5 font-medium">{s.segment}</td>
                  <td className="py-1.5 text-neutral-500">{t('ordersN', { n: s.orders })}</td>
                  <td className="py-1.5 text-right">{money(s.revenueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={t('topProducts')}>
          {sales.topProducts.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('noSales')}</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {sales.topProducts.map((p) => (
                <li key={p.productId} className="flex justify-between gap-3">
                  <span>
                    {p.name} <span className="text-neutral-500">× {p.quantity}</span>
                  </span>
                  <span>{money(p.revenueMinor)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t('leads', { n: funnel.leadsTotal })}>
          <ul className="space-y-1.5 text-sm">
            {funnel.leads.map((l) => (
              <li key={l.status}>
                <div className="flex justify-between">
                  <span>{tCrm(`leadStatuses.${l.status}`)}</span>
                  <span>{l.count}</span>
                </div>
                <div className="h-1.5 rounded bg-neutral-100">
                  <div
                    className="h-1.5 rounded bg-neutral-800"
                    style={{ width: `${(l.count / maxLead) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('pipeline')}>
          <ul className="space-y-1.5 text-sm">
            {funnel.openPipeline.map((s) => (
              <li key={s.stage}>
                <div className="flex justify-between gap-2">
                  <span>
                    {tCrm(`stages.${s.stage}`)}{' '}
                    <span className="text-neutral-500">· {s.count}</span>
                  </span>
                  <span>{money(s.amountMinor)}</span>
                </div>
                <div className="h-1.5 rounded bg-neutral-100">
                  <div
                    className="h-1.5 rounded bg-brand"
                    style={{ width: `${(s.amountMinor / maxStage) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500">
            {t('closed', {
              won: money(funnel.won.amountMinor),
              lost: money(funnel.lost.amountMinor),
            })}
          </p>
        </Card>
        <Card title={t('partRequests')}>
          <ol className="space-y-2 text-sm" data-funnel="partRequests">
            {(
              [
                ['partRequestLeads', partRequests.leads],
                ['partRequestDeals', partRequests.deals],
              ] as const
            ).map(([k, v], i, all) => (
              <li key={k} className="flex items-center justify-between gap-2">
                <span>{t(k)}</span>
                <span className="font-semibold">
                  {v}
                  {i > 0 && all[i - 1][1] > 0 && (
                    <span className="ml-2 text-xs font-normal text-neutral-500">
                      {pct(v / all[i - 1][1])}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

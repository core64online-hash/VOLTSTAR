'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  LeadSource,
  LoadType,
  PhaseType,
  UsageMode,
  type EquipmentPreset,
  type LoadItem,
  type PhaseType as PhaseT,
  type PowerCalculation,
  type UsageMode as UsageModeT,
} from '@voltstar/types';
import { calculatePower, fetchPresets } from '../../../lib/api';
import { Recommendations } from './recommendations';
import { LeadForm } from '../../../components/lead-form';

let nextId = 1;
type Row = LoadItem & { _id: number };

const newRow = (): Row => ({
  _id: nextId++,
  label: '',
  powerW: 1000,
  quantity: 1,
  loadType: LoadType.RESISTIVE,
  simultaneousStart: false,
});

export function SelectorForm() {
  const t = useTranslations('selector');
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [phase, setPhase] = useState<PhaseT>(PhaseType.SINGLE);
  const [reservePct, setReservePct] = useState(20);
  const [mode, setMode] = useState<UsageModeT>(UsageMode.BACKUP);
  const [result, setResult] = useState<PowerCalculation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [presets, setPresets] = useState<EquipmentPreset[]>([]);

  useEffect(() => {
    fetchPresets()
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  const addPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setRows((rs) => [
      ...rs,
      { ...newRow(), label: p.label, powerW: p.powerW, loadType: p.loadType },
    ]);
  };

  const patch = (id: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...p } : r)));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    setResult(null);
    try {
      const calc = await calculatePower({
        items: rows.map(({ _id: _drop, ...item }) => item),
        phase,
        reserveFactor: reservePct / 100,
        usageMode: mode,
      });
      setResult(calc);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const fmt = (w: number) => `${(w / 1000).toFixed(2)} кВт`;

  return (
    <div className="space-y-8">
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r._id}
              className="grid grid-cols-12 gap-2 rounded-lg border border-neutral-200 p-3"
            >
              <input
                className="col-span-12 rounded border px-2 py-1 sm:col-span-4"
                placeholder={t('itemLabel')}
                value={r.label}
                onChange={(e) => patch(r._id, { label: e.target.value })}
              />
              <input
                type="number"
                min={1}
                className="col-span-4 rounded border px-2 py-1 sm:col-span-2"
                aria-label={t('power')}
                value={r.powerW}
                onChange={(e) => patch(r._id, { powerW: Number(e.target.value) })}
              />
              <input
                type="number"
                min={1}
                className="col-span-3 rounded border px-2 py-1 sm:col-span-1"
                aria-label={t('qty')}
                value={r.quantity}
                onChange={(e) => patch(r._id, { quantity: Number(e.target.value) })}
              />
              <select
                className="col-span-5 rounded border px-2 py-1 sm:col-span-3"
                aria-label={t('loadType')}
                value={r.loadType}
                onChange={(e) => patch(r._id, { loadType: e.target.value as LoadItem['loadType'] })}
              >
                {Object.values(LoadType).map((lt) => (
                  <option key={lt} value={lt}>
                    {t(`loadTypes.${lt}`)}
                  </option>
                ))}
              </select>
              <label className="col-span-8 flex items-center gap-2 text-sm sm:col-span-1">
                <input
                  type="checkbox"
                  aria-label={t('simultaneous')}
                  checked={r.simultaneousStart}
                  onChange={(e) => patch(r._id, { simultaneousStart: e.target.checked })}
                />
                <span className="sm:hidden">{t('simultaneous')}</span>
              </label>
              <button
                type="button"
                className="col-span-4 text-sm text-red-600 sm:col-span-1"
                onClick={() =>
                  setRows((rs) => (rs.length > 1 ? rs.filter((x) => x._id !== r._id) : rs))
                }
              >
                {t('remove')}
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
            onClick={() => setRows((rs) => [...rs, newRow()])}
          >
            + {t('addItem')}
          </button>
          {presets.length > 0 && (
            <select
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              aria-label={t('preset.add')}
              value=""
              onChange={(e) => {
                if (e.target.value) addPreset(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="">
                {t('preset.add')}: {t('preset.choose')}
              </option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({(p.powerW / 1000).toFixed(2)} кВт)
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            {t('phase')}
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={phase}
              onChange={(e) => setPhase(e.target.value as PhaseT)}
            >
              {Object.values(PhaseType).map((p) => (
                <option key={p} value={p}>
                  {t(`phases.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t('reserve')}
            <input
              type="number"
              min={0}
              max={100}
              className="mt-1 w-full rounded border px-2 py-1"
              value={reservePct}
              onChange={(e) => setReservePct(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            {t('mode')}
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={mode}
              onChange={(e) => setMode(e.target.value as UsageModeT)}
            >
              {Object.values(UsageMode).map((m) => (
                <option key={m} value={m}>
                  {t(`modes.${m}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-6 py-3 font-semibold text-black hover:bg-yellow-300 disabled:opacity-50"
        >
          {loading ? t('calculating') : t('calculate')}
        </button>

        {error && <p className="text-sm text-red-600">{t('error')}</p>}

        {result && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5">
            <h2 className="mb-3 text-lg font-semibold">{t('result.title')}</h2>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="flex justify-between sm:block">
                <dt className="text-sm text-neutral-500">{t('result.running')}</dt>
                <dd className="font-medium">{fmt(result.runningW)}</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-sm text-neutral-500">{t('result.peak')}</dt>
                <dd className="font-medium">{fmt(result.peakW)}</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-sm text-neutral-500">{t('result.recommended')}</dt>
                <dd className="text-lg font-bold text-brand-dark">{fmt(result.recommendedW)}</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-sm text-neutral-500">{t('result.kva')}</dt>
                <dd className="font-medium">{result.recommendedKva} кВА</dd>
              </div>
            </dl>
          </div>
        )}
      </form>

      {result && <Recommendations calc={result} />}

      {result && (
        <section className="rounded-xl border border-neutral-200 p-5">
          <h2 className="text-lg font-semibold">{t('consult.title')}</h2>
          <p className="mb-4 mt-1 text-sm text-neutral-600">{t('consult.text')}</p>
          <LeadForm
            key={result.recommendedW}
            source={LeadSource.SELECTOR_FORM}
            payload={{
              calculation: result,
              phase,
              reserveFactor: reservePct / 100,
              usageMode: mode,
              items: rows.map(({ _id: _drop, ...item }) => item),
            }}
          />
        </section>
      )}
    </div>
  );
}

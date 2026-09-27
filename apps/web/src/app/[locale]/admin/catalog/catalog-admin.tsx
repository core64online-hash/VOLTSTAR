'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AdminProductInputSchema,
  PartCondition,
  PartKind,
  Role,
  Rotation,
  type AdminProduct,
  type CatalogRefs,
} from '@voltstar/types';
import { formatPrice } from '../../../../lib/api';
import {
  createProduct,
  fetchAdminProduct,
  fetchAdminProducts,
  fetchCatalogRefs,
  removeProductPrice,
  setProductPrice,
  setProductStock,
  updateProduct,
} from '../../../../lib/admin';
import { errorText, useLoad } from '../../../../lib/use-load';
import { useStaffRole } from '../admin-shell';
import { Card, inputCls, Pager, primaryBtn, secondaryBtn } from '../ui';

type Editing = { mode: 'new' } | { mode: 'edit'; id: string } | null;

export function CatalogAdmin() {
  const t = useTranslations('admin.catalog');
  const locale = useLocale();
  const isAdmin = useStaffRole() === Role.ADMIN;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Editing>(null);
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(
    () => fetchAdminProducts({ q: query || undefined, page }),
    [query, page, version],
  );
  const { data: refs } = useLoad(fetchCatalogRefs, []);

  const b2c = (p: AdminProduct) =>
    p.prices.find((x) => x.segment === 'B2C' && x.currency === 'UAH');

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_480px]">
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(search.trim());
            }}
          >
            <input
              className={`${inputCls} min-w-[14rem] flex-1`}
              placeholder={t('search')}
              aria-label={t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" className={secondaryBtn}>
              {t('find')}
            </button>
          </form>
          {isAdmin && (
            <button className={primaryBtn} onClick={() => setEditing({ mode: 'new' })}>
              + {t('new')}
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {data && data.items.length === 0 && <p className="text-neutral-500">{t('empty')}</p>}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500">
                <tr>
                  <th className="px-3 py-2">{t('product')}</th>
                  <th className="px-3 py-2">{t('partNumber')}</th>
                  <th className="px-3 py-2 text-right">{t('retail')}</th>
                  <th className="px-3 py-2 text-right">{t('stock')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => {
                  const price = b2c(p);
                  const active = editing?.mode === 'edit' && editing.id === p.id;
                  return (
                    <tr
                      key={p.id}
                      data-product={p.slug}
                      onClick={() => setEditing({ mode: 'edit', id: p.id })}
                      className={`cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 ${active ? 'bg-yellow-50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-neutral-500">
                          {p.brand.name} · {p.slug}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {p.partNumber}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {price ? (
                          formatPrice(price.amountMinor, 'UAH', `${locale}-UA`)
                        ) : (
                          <span className="text-red-600">{t('noPrice')}</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right ${p.stock === 0 ? 'font-medium text-red-600' : ''}`}
                      >
                        {p.stock}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={setPage} />
        )}
      </section>
      {editing && refs && (
        <ProductEditor
          key={editing.mode === 'edit' ? editing.id : 'new'}
          editing={editing}
          refs={refs}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing({ mode: 'edit', id: p.id });
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

type Form = {
  slug: string;
  partNumber: string;
  name: string;
  description: string;
  brandId: string;
  categoryId: string;
  kind: string;
  condition: string;
  voltage: string;
  powerKw: string;
  amperageA: string;
  rotation: string;
  teeth: string;
  /** Застава за старий агрегат, у гривнях (у БД — копійки). */
  coreDeposit: string;
  images: string;
  specs: { key: string; value: string }[];
  crossReferences: { brand: string; number: string }[];
  applications: { machineModelId: string; engine: string }[];
  stock: string;
};

const num = (v: number | null | undefined): string => (v == null ? '' : String(v));

const toForm = (p: AdminProduct | null, refs: CatalogRefs): Form => ({
  slug: p?.slug ?? '',
  partNumber: p?.partNumber ?? '',
  name: p?.name ?? '',
  description: p?.description ?? '',
  brandId: p?.brand.id ?? refs.brands[0]?.id ?? '',
  categoryId: p?.category.id ?? refs.categories[0]?.id ?? '',
  kind: p?.kind ?? PartKind.STARTER,
  condition: p?.condition ?? PartCondition.NEW,
  voltage: num(p?.voltage),
  powerKw: num(p?.powerKw),
  amperageA: num(p?.amperageA),
  rotation: p?.rotation ?? '',
  teeth: num(p?.teeth),
  coreDeposit: p?.coreDepositMinor == null ? '' : String(p.coreDepositMinor / 100),
  images: p?.images.join('\n') ?? '',
  specs: p?.specs.length ? p.specs : [{ key: '', value: '' }],
  crossReferences: p?.crossReferences ?? [],
  applications:
    p?.applications.map((a) => ({ machineModelId: a.machineModelId, engine: a.engine ?? '' })) ?? [],
  stock: p ? String(p.stock) : '0',
});

/** Порожнє поле — «не задано», а не нуль: невідома напруга не повинна ставати 0 В. */
const numberOrUndefined = (v: string): number | undefined =>
  v.trim() === '' ? undefined : Number(v);

function ProductEditor({
  editing,
  refs,
  isAdmin,
  onClose,
  onSaved,
}: {
  editing: NonNullable<Editing>;
  refs: CatalogRefs;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (p: AdminProduct) => void;
}) {
  const t = useTranslations('admin.catalog');
  const tCat = useTranslations('catalog');
  const id = editing.mode === 'edit' ? editing.id : null;
  const { data: loaded, error: loadError } = useLoad(
    () => (id ? fetchAdminProduct(id) : Promise.resolve(null)),
    [id],
  );
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const current = product ?? loaded;
  const [form, setForm] = useState<Form | null>(null);
  const f = form ?? (id && !loaded ? null : toForm(loaded, refs));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loadError) return <aside className="rounded-xl border p-4 text-red-600">{loadError}</aside>;
  if (!f) return <aside className="rounded-xl border p-4">{t('loading')}</aside>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...f, [k]: v });
  const readOnly = !isAdmin;

  async function save() {
    if (!f) return;
    const payload = {
      slug: f.slug.trim(),
      partNumber: f.partNumber.trim(),
      name: f.name.trim(),
      description: f.description.trim() || undefined,
      brandId: f.brandId,
      categoryId: f.categoryId,
      kind: f.kind,
      condition: f.condition,
      voltage: numberOrUndefined(f.voltage),
      powerKw: numberOrUndefined(f.powerKw),
      amperageA: numberOrUndefined(f.amperageA),
      rotation: f.rotation || undefined,
      teeth: numberOrUndefined(f.teeth),
      coreDepositMinor:
        f.coreDeposit.trim() === '' ? undefined : Math.round(Number(f.coreDeposit) * 100),
      images: f.images
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      specs: f.specs.filter((s) => s.key.trim() && s.value.trim()),
      crossReferences: f.crossReferences.filter((x) => x.brand.trim() && x.number.trim()),
      applications: f.applications.filter((a) => a.machineModelId),
      stock: Number(f.stock || 0),
    };
    const parsed = AdminProductInputSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      // Залишок редагується окремо (інвентаризація), тож у PATCH товару його не передаємо.
      const update = { ...parsed.data, stock: undefined, description: parsed.data.description ?? null };
      const saved = current ? await updateProduct(current.id, update) : await createProduct(parsed.data);
      setProduct(saved);
      setForm(toForm(saved, refs));
      setMessage({ ok: true, text: t('saved') });
      onSaved(saved);
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof Form, label: string, input: React.ReactNode) => (
    <label className="block">
      <span className="text-neutral-600">{label}</span>
      {input}
      {errors[key] && <span className="block text-xs text-red-600">{errors[key]}</span>}
    </label>
  );
  const text = (
    key: 'slug' | 'partNumber' | 'name' | 'voltage' | 'powerKw' | 'amperageA' | 'teeth' | 'coreDeposit',
    type = 'text',
  ) => (
    <input
      type={type}
      className={`${inputCls} mt-1 w-full`}
      disabled={readOnly}
      value={f[key]}
      onChange={(e) => set(key, e.target.value)}
    />
  );

  return (
    <aside
      aria-label={current ? t('editTitle') : t('newTitle')}
      className="space-y-5 rounded-xl border border-neutral-200 p-4 text-sm"
    >
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{current ? current.name : t('newTitle')}</h2>
        <button
          onClick={onClose}
          aria-label={t('close')}
          className="text-neutral-500 hover:text-black"
        >
          ✕
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">{field('name', t('name'), text('name'))}</div>
        {field('partNumber', t('partNumber'), text('partNumber'))}
        {field('slug', t('slug'), text('slug'))}
        {field(
          'brandId',
          t('brand'),
          <select
            className={`${inputCls} mt-1 w-full`}
            disabled={readOnly}
            value={f.brandId}
            onChange={(e) => set('brandId', e.target.value)}
          >
            {refs.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>,
        )}
        {field(
          'categoryId',
          t('category'),
          <select
            className={`${inputCls} mt-1 w-full`}
            disabled={readOnly}
            value={f.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
          >
            {refs.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>,
        )}
        {field(
          'kind',
          t('kind'),
          <select
            className={`${inputCls} mt-1 w-full`}
            disabled={readOnly}
            value={f.kind}
            onChange={(e) => set('kind', e.target.value)}
          >
            {Object.values(PartKind).map((x) => (
              <option key={x} value={x}>
                {tCat(`kinds.${x}`)}
              </option>
            ))}
          </select>,
        )}
        {field(
          'condition',
          t('condition'),
          <select
            className={`${inputCls} mt-1 w-full`}
            disabled={readOnly}
            value={f.condition}
            onChange={(e) => set('condition', e.target.value)}
          >
            {Object.values(PartCondition).map((x) => (
              <option key={x} value={x}>
                {tCat(`conditions.${x}`)}
              </option>
            ))}
          </select>,
        )}
        {field('voltage', t('voltage'), text('voltage', 'number'))}
        {field('powerKw', t('powerKw'), text('powerKw', 'number'))}
        {field('amperageA', t('amperageA'), text('amperageA', 'number'))}
        {field('teeth', t('teeth'), text('teeth', 'number'))}
        {field(
          'rotation',
          t('rotation'),
          <select
            className={`${inputCls} mt-1 w-full`}
            disabled={readOnly}
            value={f.rotation}
            onChange={(e) => set('rotation', e.target.value)}
          >
            <option value="">—</option>
            {Object.values(Rotation).map((x) => (
              <option key={x} value={x}>
                {tCat(`rotations.${x}`)}
              </option>
            ))}
          </select>,
        )}
        {field('coreDeposit', t('coreDeposit'), text('coreDeposit', 'number'))}
        {!current &&
          field(
            'stock',
            t('initialStock'),
            <input
              type="number"
              min={0}
              className={`${inputCls} mt-1 w-full`}
              value={f.stock}
              onChange={(e) => set('stock', e.target.value)}
            />,
          )}
        <div className="sm:col-span-2">
          {field(
            'description',
            t('description'),
            <textarea
              rows={3}
              className={`${inputCls} mt-1 w-full`}
              disabled={readOnly}
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
            />,
          )}
        </div>
        <div className="sm:col-span-2">
          {field(
            'images',
            t('images'),
            <textarea
              rows={2}
              className={`${inputCls} mt-1 w-full font-mono text-xs`}
              disabled={readOnly}
              placeholder="https://…"
              value={f.images}
              onChange={(e) => set('images', e.target.value)}
            />,
          )}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-semibold">{t('specs')}</legend>
        {f.specs.map((s, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={`${inputCls} flex-1`}
              placeholder={t('specKey')}
              aria-label={`${t('specKey')} ${i + 1}`}
              disabled={readOnly}
              value={s.key}
              onChange={(e) =>
                set(
                  'specs',
                  f.specs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                )
              }
            />
            <input
              className={`${inputCls} flex-1`}
              placeholder={t('specValue')}
              aria-label={`${t('specValue')} ${i + 1}`}
              disabled={readOnly}
              value={s.value}
              onChange={(e) =>
                set(
                  'specs',
                  f.specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                )
              }
            />
            {!readOnly && (
              <button
                type="button"
                aria-label={t('removeSpec')}
                className="text-red-600"
                onClick={() =>
                  set(
                    'specs',
                    f.specs.filter((_, j) => j !== i),
                  )
                }
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => set('specs', [...f.specs, { key: '', value: '' }])}
          >
            + {t('addSpec')}
          </button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">{t('crossReferences')}</legend>
        {/* Крос-номери — те, за чим клієнт шукає; порожні рядки просто не зберігаються. */}
        {f.crossReferences.map((x, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={`${inputCls} w-40`}
              placeholder={t('xrefBrand')}
              aria-label={`${t('xrefBrand')} ${i + 1}`}
              disabled={readOnly}
              value={x.brand}
              onChange={(e) =>
                set(
                  'crossReferences',
                  f.crossReferences.map((y, j) => (j === i ? { ...y, brand: e.target.value } : y)),
                )
              }
            />
            <input
              className={`${inputCls} flex-1 font-mono`}
              placeholder={t('xrefNumber')}
              aria-label={`${t('xrefNumber')} ${i + 1}`}
              disabled={readOnly}
              value={x.number}
              onChange={(e) =>
                set(
                  'crossReferences',
                  f.crossReferences.map((y, j) => (j === i ? { ...y, number: e.target.value } : y)),
                )
              }
            />
            {!readOnly && (
              <button
                type="button"
                aria-label={t('removeXref')}
                className="text-red-600"
                onClick={() =>
                  set(
                    'crossReferences',
                    f.crossReferences.filter((_, j) => j !== i),
                  )
                }
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => set('crossReferences', [...f.crossReferences, { brand: '', number: '' }])}
          >
            + {t('addXref')}
          </button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">{t('applications')}</legend>
        {refs.machineModels.length === 0 ? (
          <p className="text-neutral-500">{t('noMachineModels')}</p>
        ) : (
          <>
            {f.applications.map((a, i) => (
              <div key={i} className="flex gap-2">
                <select
                  className={`${inputCls} flex-1`}
                  aria-label={`${t('machineModel')} ${i + 1}`}
                  disabled={readOnly}
                  value={a.machineModelId}
                  onChange={(e) =>
                    set(
                      'applications',
                      f.applications.map((y, j) =>
                        j === i ? { ...y, machineModelId: e.target.value } : y,
                      ),
                    )
                  }
                >
                  {refs.machineModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.brand} {m.name}
                    </option>
                  ))}
                </select>
                <input
                  className={`${inputCls} w-48`}
                  placeholder={t('engine')}
                  aria-label={`${t('engine')} ${i + 1}`}
                  disabled={readOnly}
                  value={a.engine}
                  onChange={(e) =>
                    set(
                      'applications',
                      f.applications.map((y, j) => (j === i ? { ...y, engine: e.target.value } : y)),
                    )
                  }
                />
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={t('removeApplication')}
                    className="text-red-600"
                    onClick={() =>
                      set(
                        'applications',
                        f.applications.filter((_, j) => j !== i),
                      )
                    }
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button
                type="button"
                className={secondaryBtn}
                onClick={() =>
                  set('applications', [
                    ...f.applications,
                    { machineModelId: refs.machineModels[0].id, engine: '' },
                  ])
                }
              >
                + {t('addApplication')}
              </button>
            )}
          </>
        )}
      </fieldset>

      {isAdmin && (
        <button className={primaryBtn} disabled={busy} onClick={save}>
          {current ? t('save') : t('create')}
        </button>
      )}
      {message && <p className={message.ok ? 'text-green-700' : 'text-red-600'}>{message.text}</p>}

      {current && (
        <>
          <StockEditor product={current} onSaved={setProduct} />
          <PricesEditor product={current} refs={refs} readOnly={readOnly} onSaved={setProduct} />
        </>
      )}
    </aside>
  );
}

function StockEditor({
  product,
  onSaved,
}: {
  product: AdminProduct;
  onSaved: (p: AdminProduct) => void;
}) {
  const t = useTranslations('admin.catalog');
  const [qty, setQty] = useState(String(product.stock));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card title={t('stock')} className="p-3">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const saved = await setProductStock(product.id, Math.max(0, Math.floor(Number(qty))));
            onSaved(saved);
            setMsg({ ok: true, text: t('stockSaved', { n: saved.stock }) });
          } catch (err) {
            setMsg({ ok: false, text: errorText(err) });
          }
        }}
      >
        <input
          type="number"
          min={0}
          aria-label={t('stockQty')}
          className={`${inputCls} w-28`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <button type="submit" className={secondaryBtn}>
          {t('update')}
        </button>
      </form>
      {msg && <p className={`mt-1 ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
    </Card>
  );
}

function PricesEditor({
  product,
  refs,
  readOnly,
  onSaved,
}: {
  product: AdminProduct;
  refs: CatalogRefs;
  readOnly: boolean;
  onSaved: (p: AdminProduct) => void;
}) {
  const t = useTranslations('admin.catalog');
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title={t('prices')} className="p-3">
      <ul className="space-y-2">
        {refs.priceLists.map((list) => (
          <PriceRow
            key={list.id}
            list={list}
            price={product.prices.find((p) => p.priceListId === list.id)}
            readOnly={readOnly}
            onSave={async (amountMinor, vatRate) => {
              try {
                setError(null);
                onSaved(await setProductPrice(product.id, list.id, { amountMinor, vatRate }));
              } catch (e) {
                setError(errorText(e));
              }
            }}
            onRemove={async () => {
              try {
                setError(null);
                onSaved(await removeProductPrice(product.id, list.id));
              } catch (e) {
                setError(errorText(e));
              }
            }}
          />
        ))}
      </ul>
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </Card>
  );
}

function PriceRow({
  list,
  price,
  readOnly,
  onSave,
  onRemove,
}: {
  list: CatalogRefs['priceLists'][number];
  price?: AdminProduct['prices'][number];
  readOnly: boolean;
  onSave: (amountMinor: number, vatRate: number) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useTranslations('admin.catalog');
  const locale = useLocale();
  const [amount, setAmount] = useState(price ? (price.amountMinor / 100).toFixed(2) : '');
  const [vat, setVat] = useState(String(Math.round((price?.vatRate ?? 0.2) * 100)));
  const label = `${list.name} · ${list.segment} · ${list.currency}`;
  return (
    <li data-pricelist={list.segment} className="space-y-1">
      <p className="flex justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-neutral-500">
          {price ? formatPrice(price.amountMinor, list.currency, `${locale}-UA`) : t('noPrice')}
        </span>
      </p>
      {!readOnly && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const minor = Math.round(Number(amount.replace(',', '.')) * 100);
            if (Number.isFinite(minor) && minor >= 0) void onSave(minor, Number(vat) / 100);
          }}
        >
          <input
            inputMode="decimal"
            aria-label={t('priceFor', { list: label })}
            className={`${inputCls} w-32`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label className="flex items-center gap-1">
            {t('vat')}
            <input
              type="number"
              min={0}
              max={100}
              aria-label={t('vatFor', { list: label })}
              className={`${inputCls} w-16`}
              value={vat}
              onChange={(e) => setVat(e.target.value)}
            />
            %
          </label>
          <button type="submit" className={secondaryBtn} disabled={!amount}>
            {t('setPrice')}
          </button>
          {price && (
            <button
              type="button"
              className="text-xs text-red-600 hover:underline"
              onClick={() => void onRemove()}
            >
              {t('removePrice')}
            </button>
          )}
        </form>
      )}
    </li>
  );
}

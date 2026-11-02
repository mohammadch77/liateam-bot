'use client';

import { useEffect, useState, useTransition } from 'react';
import { toFaDigits } from '@/lib/format/number';
import { Alert, Badge, Button, EmptyState, Select, TextField } from '@/ui';
import { citiesAction, provincesAction, type AddressView } from '../../checkout/actions';
import { ConfirmDialog } from '../_ui/ConfirmDialog';
import s from '../account.module.css';
import {
  createAddressAction,
  deleteAddressAction,
  makeDefaultAddressAction,
  updateAddressAction,
} from './actions';

type Geo = Array<{ id: number; name: string }>;

const lineOf = (a: AddressView) =>
  `${a.province}، ${a.city}، ${a.line}${a.plate ? `، پلاک ${toFaDigits(a.plate)}` : ''}${a.unit ? `، واحد ${toFaDigits(a.unit)}` : ''}`;

/** After a save: a new default takes the flag from every other address. */
const withDefault = (l: AddressView[], a: AddressView) =>
  l.map((x) => ({ ...x, is_default: a.is_default ? x.id === a.id : x.is_default }));

/** The list with its form: `editing` is an address id, 'new', or null. */
export function AddressBook({
  initial,
  defaultName,
  defaultPhone,
}: {
  initial: AddressView[];
  defaultName: string;
  defaultPhone: string;
}) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<string | null>(initial.length ? null : 'new');
  const [removing, setRemoving] = useState<AddressView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const makeDefault = (a: AddressView) =>
    start(async () => {
      setError(null);
      const r = await makeDefaultAddressAction(a.id);
      if (r.ok) setList((l) => l.map((x) => ({ ...x, is_default: x.id === a.id })));
      else setError(r.error);
    });

  const remove = () =>
    start(async () => {
      const gone = removing;
      if (!gone) return;
      const r = await deleteAddressAction(gone.id);
      if (r.ok) {
        setError(null);
        setList((l) => {
          const rest = l.filter((x) => x.id !== gone.id);
          // the server makes the newest remaining address the default when the default goes
          if (gone.is_default && rest[0] && !rest.some((x) => x.is_default)) rest[0] = { ...rest[0], is_default: true };
          return [...rest];
        });
      } else setError(r.error);
      setRemoving(null);
    });

  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      {list.length === 0 && editing !== 'new' && <EmptyState icon="location_on" title="هنوز آدرسی ذخیره نکرده‌اید" />}
      <ul className={s.rows} style={{ gap: 12 }} data-address-list>
        {list.map((a) =>
          editing === a.id ? (
            <li key={a.id} className={s.addr}>
              <AddressForm
                address={a}
                defaultName={defaultName}
                defaultPhone={defaultPhone}
                onSaved={(saved) => {
                  setList((l) =>
                    withDefault(
                      l.map((x) => (x.id === saved.id ? saved : x)),
                      saved,
                    ),
                  );
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={a.id} className={s.addr} data-default={a.is_default} data-address={a.id}>
              <div className={s.rowMain}>
                <b>
                  {a.recipient_name} {a.is_default && <Badge tone="new">پیش‌فرض</Badge>}
                </b>
                <span>{lineOf(a)}</span>
                <span className={s.muted}>
                  <span className="tnum">{toFaDigits(a.recipient_phone)}</span> · کد پستی{' '}
                  <span className="tnum">{toFaDigits(a.postal_code)}</span>
                </span>
              </div>
              <div className={s.btnRow}>
                <Button variant="outline" size="sm" onClick={() => setEditing(a.id)} data-address-edit>
                  ویرایش
                </Button>
                {!a.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => makeDefault(a)}
                    disabled={pending}
                    data-address-default
                  >
                    پیش‌فرض شود
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setRemoving(a)} data-address-delete>
                  حذف
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <section className={`${s.card} ${s.wide}`} aria-label="آدرس جدید">
          <h2 className={s.h2}>آدرس جدید</h2>
          <AddressForm
            defaultName={defaultName}
            defaultPhone={defaultPhone}
            onSaved={(saved) => {
              setList((l) => withDefault([...l, saved], saved).sort((x, y) => Number(y.is_default) - Number(x.is_default)));
              setEditing(null);
            }}
            onCancel={list.length ? () => setEditing(null) : undefined}
          />
        </section>
      ) : (
        editing === null && (
          <div>
            <Button icon="add" onClick={() => setEditing('new')} data-add-address>
              افزودن آدرس
            </Button>
          </div>
        )
      )}
      <ConfirmDialog
        id="address-delete"
        open={removing !== null}
        title="حذف آدرس"
        confirmLabel="حذف آدرس"
        busy={pending}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      >
        <p>این آدرس حذف شود؟ سفارش‌هایی که قبلاً با آن ثبت شده‌اند تغییری نمی‌کنند.</p>
      </ConfirmDialog>
    </>
  );
}

function AddressForm({
  address,
  defaultName,
  defaultPhone,
  onSaved,
  onCancel,
}: {
  address?: AddressView;
  defaultName: string;
  defaultPhone: string;
  onSaved: (a: AddressView) => void;
  onCancel?: (() => void) | undefined;
}) {
  const [provinces, setProvinces] = useState<Geo>([]);
  const [cities, setCities] = useState<Geo>([]);
  const [provinceId, setProvinceId] = useState(address?.province_id ? String(address.province_id) : '');
  const [cityId, setCityId] = useState(address?.city_id ? String(address.city_id) : '');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [loadingGeo, setLoadingGeo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const startProvince = address?.province_id ?? null;

  useEffect(() => {
    let live = true;
    (async () => {
      const p = await provincesAction();
      if (!live) return;
      if (!p.ok) {
        setGeoError(p.error);
        setLoadingGeo(false);
        return;
      }
      setProvinces(p.data);
      if (startProvince) {
        const c = await citiesAction(startProvince);
        if (!live) return;
        if (c.ok) setCities(c.data);
        else setGeoError(c.error);
      }
      setLoadingGeo(false);
    })();
    return () => {
      live = false;
    };
  }, [startProvince]);

  const pickProvince = async (value: string) => {
    setProvinceId(value);
    setCityId('');
    setCities([]);
    if (!value) return;
    setLoadingGeo(true);
    const r = await citiesAction(Number(value));
    setLoadingGeo(false);
    if (r.ok) setCities(r.data);
    else setGeoError(r.error);
  };

  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const input = {
        provinceId: Number(provinceId),
        cityId: Number(cityId),
        line: String(form.get('line') ?? ''),
        plate: String(form.get('plate') ?? ''),
        unit: String(form.get('unit') ?? ''),
        recipientName: String(form.get('name') ?? ''),
        recipientPhone: String(form.get('phone') ?? ''),
        postalCode: String(form.get('postal') ?? ''),
        makeDefault: form.get('default') === 'on',
      };
      const r = address ? await updateAddressAction(address.id, input) : await createAddressAction(input);
      if (r.ok) onSaved(r.data);
      else setError(r.error);
    });

  return (
    <form action={submit} className={s.form} data-address-form>
      {geoError && <Alert tone="danger">{geoError}</Alert>}
      <div className={s.grid}>
        <TextField
          label="نام و نام خانوادگی گیرنده"
          name="name"
          defaultValue={address?.recipient_name ?? defaultName}
          autoComplete="name"
          required
        />
        <TextField
          label="موبایل گیرنده"
          name="phone"
          defaultValue={address?.recipient_phone ?? defaultPhone}
          inputMode="tel"
          autoComplete="tel"
          ltr
          required
        />
        <Select
          label="استان"
          name="province"
          value={provinceId}
          onChange={(e) => void pickProvince(e.target.value)}
          options={[
            { value: '', label: loadingGeo && !provinces.length ? 'در حال بارگذاری…' : 'انتخاب استان' },
            ...provinces.map((p) => ({ value: String(p.id), label: p.name })),
          ]}
          required
        />
        <Select
          label="شهر"
          name="city"
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          disabled={!provinceId}
          options={[
            { value: '', label: 'انتخاب شهر' },
            ...cities.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          required
        />
        <TextField
          label="کد پستی"
          name="postal"
          inputMode="numeric"
          ltr
          autoComplete="postal-code"
          placeholder="۱۰ رقم"
          defaultValue={address?.postal_code ?? ''}
          required
        />
        <TextField label="پلاک" name="plate" inputMode="numeric" defaultValue={address?.plate ?? ''} required />
        <TextField
          label="واحد"
          labelNote="اختیاری"
          name="unit"
          inputMode="numeric"
          defaultValue={address?.unit ?? ''}
        />
        <div className={s.span2}>
          <TextField
            label="نشانی کامل"
            name="line"
            autoComplete="street-address"
            defaultValue={address?.line ?? ''}
            required
          />
        </div>
      </div>
      {!address?.is_default && (
        <label className={s.muted} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" name="default" /> به‌عنوان آدرس پیش‌فرض
        </label>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className={s.btnRow}>
        <Button type="submit" icon="check" loading={pending} loadingText="در حال ذخیره…" disabled={!cityId}>
          ذخیره
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        )}
      </div>
    </form>
  );
}

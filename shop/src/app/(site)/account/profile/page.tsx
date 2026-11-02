import type { Metadata } from 'next';
import { profilePath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { Breadcrumb } from '@/ui';
import s from '../account.module.css';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: 'پروفایل', robots: { index: false } };

export default async function ProfilePage() {
  const user = await requireUser(profilePath());
  return (
    <>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'حساب کاربری', href: '/account' }, { label: 'پروفایل' }]} />
      <h1 className={s.title}>پروفایل</h1>
      <section className={`${s.card} ${s.wide}`} aria-label="مشخصات">
        <ProfileForm name={user.fullName ?? ''} phone={user.phone} />
      </section>
    </>
  );
}

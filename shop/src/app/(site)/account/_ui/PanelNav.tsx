'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/ui';
import { toFaDigits } from '@/lib/format/number';
import s from '../account.module.css';

export type PanelNavItem = {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
  exact?: boolean;
};

export type PanelNavProps = {
  title: string;
  items: readonly PanelNavItem[];
  dataAttr?: string;
  backToSiteHref?: string;
  backToSiteLabel?: string;
};

export function PanelNav({
  title,
  items,
  dataAttr,
  backToSiteHref = '/',
  backToSiteLabel = 'مشاهده فروشگاه',
}: PanelNavProps) {
  const path = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    dialogRef.current?.close();
    setOpen(false);
  }, [path]);

  // Lock background scroll when drawer is open
  useEffect(() => {
    document.documentElement.classList.toggle('panel-drawer-open', open);
    return () => document.documentElement.classList.remove('panel-drawer-open');
  }, [open]);

  const activeItem =
    items.find((i) => (i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`))) ||
    items[0];

  const totalBadges = items.reduce((acc, i) => acc + (i.count && i.count > 0 ? i.count : 0), 0);

  const openDrawer = () => {
    dialogRef.current?.showModal();
    setOpen(true);
  };

  const closeDrawer = () => {
    dialogRef.current?.close();
    setOpen(false);
  };

  return (
    <>
      {/* 1. Desktop Sidebar (>= 900px) */}
      <nav
        className={`${s.nav} ${s.desktopNav}`}
        aria-label={title}
        {...(dataAttr ? { [dataAttr]: true } : {})}
      >
        {items.map((i) => {
          const on = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
          const n = i.count ?? 0;
          return (
            <Link
              key={i.href}
              href={i.href}
              className={s.navLink}
              aria-current={on ? 'page' : undefined}
              data-admin-nav-item={i.href}
            >
              <Icon name={i.icon} size={20} />
              <span>{i.label}</span>
              {n > 0 && (
                <span className={s.navBadge} data-nav-count={n} aria-label={`${toFaDigits(n)} مورد`}>
                  {toFaDigits(n > 99 ? 99 : n)}
                  {n > 99 ? '+' : ''}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 2. Mobile Top Bar (< 900px) */}
      <div className={s.mobileBar} aria-label={`نوار ناوبری ${title}`}>
        <div className={s.mobileBarInfo}>
          <span className={s.mobileBarIcon} aria-hidden="true">
            <Icon name={activeItem.icon} size={22} />
          </span>
          <div className={s.mobileBarText}>
            <span className={s.mobileBarSub}>{title}</span>
            <span className={s.mobileBarTitle}>
              {activeItem.label}
              {activeItem.count && activeItem.count > 0 ? (
                <span className={s.navBadge}>{toFaDigits(activeItem.count)}</span>
              ) : null}
            </span>
          </div>
        </div>

        <button
          type="button"
          className={s.mobileBarBtn}
          onClick={openDrawer}
          aria-label={`باز کردن منوی ${title}`}
          aria-expanded={open}
        >
          {totalBadges > 0 && (
            <span className={s.mobileBadgeDot} aria-label={`${toFaDigits(totalBadges)} مورد نیازمند بررسی`} />
          )}
          <span>بخش‌های پنل</span>
          <Icon name="menu" size={20} />
        </button>
      </div>

      {/* 3. Mobile Navigation Drawer (Modal Dialog) */}
      <dialog
        ref={dialogRef}
        className={s.drawer}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDrawer();
        }}
        onClose={() => setOpen(false)}
        aria-label={`منوی ${title}`}
      >
        <div className={s.drawerSheet}>
          <div className={s.drawerHead}>
            <div className={s.drawerTitle}>
              <Icon name={activeItem.icon} size={22} className={s.drawerTitleIcon} />
              <span>{`منوی ${title}`}</span>
            </div>
            <button
              type="button"
              className={s.drawerClose}
              onClick={closeDrawer}
              aria-label="بستن منو"
            >
              <Icon name="close" size={24} />
            </button>
          </div>

          <div className={s.drawerBody}>
            <div className={s.drawerList} {...(dataAttr ? { [dataAttr]: true } : {})}>
              {items.map((i) => {
                const on = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
                const n = i.count ?? 0;
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={s.drawerLink}
                    aria-current={on ? 'page' : undefined}
                    data-admin-nav-item={i.href}
                    onClick={closeDrawer}
                  >
                    <div className={s.drawerLinkStart}>
                      <Icon name={i.icon} size={22} />
                      <span>{i.label}</span>
                    </div>
                    <div className={s.drawerLinkEnd}>
                      {n > 0 && (
                        <span className={s.navBadge} aria-label={`${toFaDigits(n)} مورد`}>
                          {toFaDigits(n > 99 ? 99 : n)}
                          {n > 99 ? '+' : ''}
                        </span>
                      )}
                      <Icon name="arrow_back" size={16} className={s.drawerChevron} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className={s.drawerFoot}>
            <Link href={backToSiteHref} className={s.drawerSiteLink} onClick={closeDrawer}>
              <Icon name="storefront" size={20} />
              <span>{backToSiteLabel}</span>
            </Link>
          </div>
        </div>
      </dialog>
    </>
  );
}

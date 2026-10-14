import Link from 'next/link';
import type { ReactNode } from 'react';
import { toFaDigits } from '@/lib/format/number';
import { Icon, type IconName } from '../icon/Icon';
import { Container } from '../layout/Layout';
import s from './Footer.module.css';

export type FooterColumn = { title: string; links: ReadonlyArray<{ label: string; href: string }> };
export type TrustItem = { icon: IconName; title: string; sub: string };

export type FooterProps = {
  brandName: string;
  about: string;
  trust: readonly TrustItem[];
  columns: readonly FooterColumn[];
  contact: { phone: string; hours: string; email: string; address: string };
  social: ReadonlyArray<{ label: string; href: string }>;
  /** e-Namad and similar trust seals (their official embed snippets) */
  seals?: ReactNode;
  newsletterAction?: string;
  copyright: string;
};

/** SiteFooter.dc.html: trust strip + dark footer. Mobile columns are native <details> accordions (no JS). */
export function Footer(p: FooterProps) {
  return (
    <footer className={s.footer}>
      <div className={s.trust}>
        <Container className={s.trustGrid}>
          {p.trust.map((t, i) => (
            <div key={t.title} className={i >= 4 ? `${s.trustItem} ${s.trustExtra}` : s.trustItem}>
              <span className={s.trustIcon}>
                <Icon name={t.icon} size={26} />
              </span>
              <span className={s.trustText}>
                <b>{t.title}</b>
                <span className={s.trustSub}>{t.sub}</span>
              </span>
            </div>
          ))}
        </Container>
      </div>

      <div className={s.dark}>
        <Container className={s.grid}>
          <div className={s.about}>
            <span className={s.logo}>
              {p.brandName}
              <span className={s.logoDot}>.</span>
            </span>
            <p className={s.aboutText}>{p.about}</p>
            <ul className={s.contact}>
              <li>
                <Icon name="call" size={18} className={s.darkIcon} />
                <a href={`tel:${p.contact.phone.replace(/[^\d+]/g, '')}`} dir="ltr" className={s.contactLink}>
                  {toFaDigits(p.contact.phone)}
                </a>
                · {p.contact.hours}
              </li>
              <li>
                <Icon name="mail" size={18} className={s.darkIcon} />
                <a href={`mailto:${p.contact.email}`} dir="ltr" className={s.contactLink}>
                  {p.contact.email}
                </a>
              </li>
              <li className={s.address}>
                <Icon name="location_on" size={18} className={s.darkIcon} />
                {p.contact.address}
              </li>
            </ul>
          </div>

          {p.columns.map((c, i) => (
            <div key={c.title} className={s.columnSlot}>
              {/* desktop: always-open list */}
              <div className={s.columnDesktop}>
                <b className={s.columnTitle}>{c.title}</b>
                <FooterLinks links={c.links} />
              </div>
              {/* mobile: accordion, first one open (as in the design) */}
              <details className={s.column} open={i === 0}>
                <summary className={s.columnTitle}>
                  {c.title}
                  <Icon name="keyboard_arrow_down" size={22} className={s.chevron} />
                </summary>
                <FooterLinks links={c.links} />
              </details>
            </div>
          ))}

          <div className={s.newsletter}>
            <b className={s.newsTitle}>از تخفیف‌ها زودتر باخبر شوید</b>
            <span className={s.newsSub}>هفته‌ای یک پیامک؛ فقط پیشنهادهای واقعی.</span>
            <form action={p.newsletterAction} method="post" className={s.newsForm}>
              <input
                type="tel"
                name="phone"
                inputMode="numeric"
                autoComplete="tel"
                aria-label="شماره موبایل"
                placeholder="شماره موبایل"
                className={s.newsInput}
              />
              <button type="submit" className={s.newsButton}>
                عضویت
              </button>
            </form>
            <ul className={s.social}>
              {p.social.map((x) => (
                <li key={x.href}>
                  <a href={x.href} className={s.socialLink} rel="noopener noreferrer" target="_blank">
                    {x.label}
                  </a>
                </li>
              ))}
            </ul>
            {p.seals && <div className={s.seals}>{p.seals}</div>}
          </div>
        </Container>

        <Container className={s.bottom}>
          <span>{p.copyright}</span>
          <span className={s.secure}>
            <Icon name="lock" size={17} className={s.darkIcon} />
            پرداخت امن از طریق درگاه‌های عضو شبکه شاپرک
          </span>
        </Container>
      </div>
    </footer>
  );
}

function FooterLinks({ links }: { links: FooterColumn['links'] }) {
  return (
    <ul className={s.links}>
      {links.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className={s.link}>
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Placeholder seal box from the design until the real e-Namad / Samandehi snippets are issued. */
export function SealPlaceholder({ label }: { label: string }) {
  return (
    <span className={s.seal}>
      <span className={s.sealMark} aria-hidden="true" />
      {label}
    </span>
  );
}

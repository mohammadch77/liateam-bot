'use client';

import type { SeoAnalysisResult } from '@/lib/blog/seo';
import { toFaDigits } from '@/lib/format/number';
import s from './admin-blog.module.css';

export function SeoScorePanel({
  analysis,
  previewTitle,
  previewSlug,
  previewDescription,
}: {
  analysis: SeoAnalysisResult;
  previewTitle: string;
  previewSlug: string;
  previewDescription: string;
}) {
  const toneClass =
    analysis.score >= 80 ? s.seoGood : analysis.score >= 55 ? s.seoWarn : s.seoBad;
  const barColor =
    analysis.score >= 80
      ? 'var(--color-success)'
      : analysis.score >= 55
        ? 'var(--color-warning-dot)'
        : 'var(--color-danger)';

  return (
    <div className={s.cardBox} data-seo-panel>
      <div className={s.seoTop}>
        <div className={`${s.seoRing} ${toneClass}`} data-seo-score>
          {toFaDigits(analysis.score)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>تحلیل سئوی مقاله</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{analysis.gradeLabel}</div>
          <div className={s.muted} style={{ marginTop: 3 }}>
            {toFaDigits(analysis.wordCount)} کلمه · چگالی کلیدواژه: {toFaDigits(analysis.keywordDensityPercent)}٪
          </div>
        </div>
      </div>

      <div className={s.seoProgressTrack}>
        <div
          className={s.seoProgressFill}
          style={{ width: `${analysis.score}%`, background: barColor }}
        />
      </div>

      <div className={s.serpCard}>
        <span className={s.muted} style={{ fontSize: 11, fontWeight: 700 }}>
          پیش‌نمایش نمایش در گوگل (SERP):
        </span>
        <span className={s.serpUrl}>https://avina.ir/blog/{previewSlug || 'article-slug'}</span>
        <span className={s.serpTitle}>{previewTitle || 'عنوان متا مقاله در نتایج گوگل'}</span>
        <span className={s.serpDesc}>
          {previewDescription || 'توضیحات متا دیسکریپشن در این قسمت زیر عنوان مقاله در گوگل نمایش داده می‌شود...'}
        </span>
      </div>

      <div className={s.seoChecklist}>
        {analysis.checks.map((c) => (
          <div key={c.id} className={s.seoCheckRow}>
            <span
              className={`${s.seoDot} ${
                c.status === 'good' ? s.seoDotGood : c.status === 'warn' ? s.seoDotWarn : s.seoDotBad
              }`}
            />
            <div>
              <strong style={{ display: 'block', color: 'var(--color-ink)' }}>{c.label}</strong>
              <span className={s.muted}>{c.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

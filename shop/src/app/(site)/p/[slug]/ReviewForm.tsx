'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert } from '@/ui/feedback/Feedback';
import { Button } from '@/ui/button/Button';
import { Icon } from '@/ui/icon/Icon';
import { submitReviewAction, type ReviewState } from './actions';
import s from './product.module.css';

const LABELS = ['خیلی بد', 'بد', 'معمولی', 'خوب', 'عالی'];

/** «ثبت دیدگاه»: 1-5 stars (radio group, keyboard-friendly) + text. The server validates everything again. */
export function ReviewForm({ productId, maxLength }: { productId: number; maxLength: number }) {
  const [state, action] = useActionState<ReviewState, FormData>(submitReviewAction, null);
  const [rating, setRating] = useState(0);
  const [length, setLength] = useState(0);

  if (state?.ok) {
    return (
      <div role="status" className={s.reviewDone}>
        <Alert tone="success">دیدگاه شما ثبت شد و پس از تأیید نمایش داده می‌شود. ممنون از همراهی‌تان.</Alert>
      </div>
    );
  }
  return (
    <form action={action} className={s.reviewForm} noValidate aria-labelledby="review-form-title">
      <h3 id="review-form-title" className={s.formTitle}>
        دیدگاه خود را بنویسید
      </h3>
      <input type="hidden" name="productId" value={productId} />
      <fieldset className={s.stars}>
        <legend className={s.formLabel}>امتیاز شما</legend>
        <div className={s.starRow}>
          {LABELS.map((label, i) => (
            <label key={label} className={s.starLabel} title={label}>
              <input
                type="radio"
                name="rating"
                value={i + 1}
                checked={rating === i + 1}
                onChange={() => setRating(i + 1)}
                className="sr-only"
                required
              />
              <Icon name="star" size={28} filled={i < rating} className={i < rating ? s.starOn : s.starOff} />
              <span className="sr-only">{`${i + 1} از ۵ — ${label}`}</span>
            </label>
          ))}
          <span className={s.starText} aria-hidden="true">
            {rating ? LABELS[rating - 1] : ''}
          </span>
        </div>
      </fieldset>
      <label className={s.formLabel} htmlFor="review-body">
        متن دیدگاه
      </label>
      <textarea
        id="review-body"
        name="body"
        className={s.textarea}
        rows={4}
        minLength={10}
        maxLength={maxLength}
        required
        placeholder="تجربه‌ی خود از این محصول را بنویسید…"
        onChange={(e) => setLength(e.target.value.length)}
        aria-invalid={state?.ok === false || undefined}
        aria-describedby={state?.ok === false ? 'review-error' : 'review-hint'}
      />
      <span id="review-hint" className={s.hint}>
        {length.toLocaleString('fa-IR')} / {maxLength.toLocaleString('fa-IR')} — دیدگاه‌ها پس از بررسی نمایش
        داده می‌شوند.
      </span>
      {state?.ok === false && (
        <p id="review-error" role="alert" className={s.formError}>
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" loading={pending} className={s.reviewSubmit}>
      ثبت دیدگاه
    </Button>
  );
}

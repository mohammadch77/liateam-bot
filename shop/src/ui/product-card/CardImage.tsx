'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Icon } from '../icon/Icon';
import s from './ProductCard.module.css';

/**
 * The product's picture on the card's stage. No address, or one that fails to load (the optimiser or the supplier answers an error),
 * shows Avina's standard placeholder instead: a card is never empty and never dropped.
 */
export function CardImage({ src, priority }: { src: string | null | undefined; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className={s.noImage} aria-hidden="true" data-card-placeholder>
        <Icon name="spa" size={56} />
      </span>
    );
  }
  return (
    <span className={s.imageBox}>
      <Image
        src={src}
        alt=""
        fill
        sizes="(min-width: 1440px) 240px, (min-width: 1024px) 22vw, (min-width: 768px) 30vw, 46vw"
        className={s.image}
        priority={priority}
        draggable={false}
        onError={() => setFailed(true)}
        data-card-image
      />
    </span>
  );
}

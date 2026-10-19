'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Icon } from '@/ui/icon/Icon';
import s from './product.module.css';

type Img = { url: string; alt: string };

/**
 * Product Page.dc.html gallery: the selected photo large on the pedestal stage, thumbnails below.
 * Thumbnails are real links (?img=N): without JavaScript they reload the page with that photo (the server picks
 * it from the query); with JavaScript the click just swaps the photo. Photos always go through /_next/image.
 */
export function Gallery({
  images,
  initial,
  name,
  out,
  tint,
}: {
  images: Img[];
  initial: number;
  name: string;
  out: boolean;
  /** Liateam's product colour (#rrggbb): a soft wash over the stage, so each product keeps its own mood */
  tint?: string | null;
}) {
  const [index, setIndex] = useState(initial >= 0 && initial < images.length ? initial : 0);
  const current = images[index];

  return (
    <div
      className={s.gallery}
      id="gallery"
      style={tint ? ({ '--tint': tint } as React.CSSProperties) : undefined}
    >
      <div className={out ? `${s.stage} ${s.out}` : s.stage}>
        <span className={s.pedestal} aria-hidden="true" />
        {current ? (
          <span className={s.image}>
            <Image
              key={current.url}
              src={current.url}
              alt={current.alt}
              fill
              priority={index === 0}
              sizes="(min-width: 1024px) 560px, 92vw"
            />
          </span>
        ) : (
          <span className={s.noImage} role="img" aria-label="بدون عکس">
            <Icon name="spa" size={96} />
          </span>
        )}
      </div>
      {images.length > 1 && (
        <ul className={s.thumbs} aria-label="تصاویر محصول">
          {images.map((img, i) => (
            <li key={img.url}>
              <a
                href={`?img=${i + 1}#gallery`}
                className={s.thumb}
                aria-current={i === index ? 'true' : undefined}
                aria-label={`تصویر ${(i + 1).toLocaleString('fa-IR')} از ${images.length.toLocaleString('fa-IR')} — ${name}`}
                onClick={(e) => {
                  e.preventDefault();
                  setIndex(i);
                }}
              >
                <Image src={img.url} alt="" fill sizes="96px" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

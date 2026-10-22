'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Icon } from '@/ui';
import s from './product.module.css';

/**
 * The product video, loaded only when asked for: until then a picture with a play button (no third-party request,
 * none of the player's ~500 KB of scripts). The player is exactly the one the page always showed: Liateam's ArvanCloud
 * player only (the URL is checked on the server), sandboxed, no top navigation.
 */
export function VideoFacade({ src, title, poster }: { src: string; title: string; poster: string | null }) {
  const [play, setPlay] = useState(false);
  if (play) {
    return (
      <iframe
        src={src}
        title={title}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    );
  }
  return (
    <button type="button" className={s.videoFacade} onClick={() => setPlay(true)} aria-label={`پخش ${title}`}>
      {poster && (
        <Image src={poster} alt="" fill sizes="(min-width: 1024px) 50vw, 92vw" className={s.videoPoster} />
      )}
      <span className={s.videoPlay} aria-hidden="true">
        <Icon name="play_arrow" size={40} />
      </span>
    </button>
  );
}

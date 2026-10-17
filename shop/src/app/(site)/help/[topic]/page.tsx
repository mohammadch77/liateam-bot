import { notFound } from 'next/navigation';
import { ComingSoon, comingSoonMetadata } from '../../_soon/ComingSoon';
import { isComingSoonKey } from '../../_soon/sections';

type Props = { params: Promise<{ topic: string }> };

/** /help/<topic>: only the topics linked from the footer exist; anything else is a real 404. */
async function sectionOf(params: Props['params']) {
  const key = `help/${(await params).topic}`;
  if (!isComingSoonKey(key)) notFound();
  return key;
}

export async function generateMetadata({ params }: Props) {
  return comingSoonMetadata(await sectionOf(params));
}

export default async function Page({ params }: Props) {
  return <ComingSoon section={await sectionOf(params)} />;
}

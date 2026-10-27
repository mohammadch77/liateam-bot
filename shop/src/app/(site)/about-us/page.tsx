import { aboutPath } from '@/lib/urls';
import { ComingSoon, comingSoonMetadata } from '../_soon/ComingSoon';

export const metadata = comingSoonMetadata('about', aboutPath());

export default function Page() {
  return <ComingSoon section="about" />;
}

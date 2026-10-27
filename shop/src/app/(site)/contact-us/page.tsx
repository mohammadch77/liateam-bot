import { contactPath } from '@/lib/urls';
import { ComingSoon, comingSoonMetadata } from '../_soon/ComingSoon';

export const metadata = comingSoonMetadata('contact', contactPath());

export default function Page() {
  return <ComingSoon section="contact" />;
}

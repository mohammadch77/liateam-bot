import { ComingSoon, comingSoonMetadata } from '../_soon/ComingSoon';

export const metadata = comingSoonMetadata('newsletter');

export default function Page() {
  return <ComingSoon section="newsletter" />;
}

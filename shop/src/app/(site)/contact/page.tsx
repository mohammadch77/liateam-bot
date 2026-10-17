import { ComingSoon, comingSoonMetadata } from '../_soon/ComingSoon';

export const metadata = comingSoonMetadata('contact');

export default function Page() {
  return <ComingSoon section="contact" />;
}

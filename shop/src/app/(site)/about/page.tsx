import { ComingSoon, comingSoonMetadata } from '../_soon/ComingSoon';

export const metadata = comingSoonMetadata('about');

export default function Page() {
  return <ComingSoon section="about" />;
}

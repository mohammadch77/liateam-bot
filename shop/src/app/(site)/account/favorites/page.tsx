import { ComingSoon, comingSoonMetadata } from '../../_soon/ComingSoon';

export const metadata = comingSoonMetadata('favorites');

export default function Page() {
  return <ComingSoon section="favorites" />;
}

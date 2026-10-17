import { ComingSoon, comingSoonMetadata } from '../../_soon/ComingSoon';

export const metadata = comingSoonMetadata('wallet');

export default function Page() {
  return <ComingSoon section="wallet" />;
}

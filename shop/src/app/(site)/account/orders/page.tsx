import { ComingSoon, comingSoonMetadata } from '../../_soon/ComingSoon';

export const metadata = comingSoonMetadata('orders');

export default function Page() {
  return <ComingSoon section="orders" />;
}

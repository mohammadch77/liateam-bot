import { ComingSoon, comingSoonMetadata } from '../_soon/ComingSoon';

export const metadata = comingSoonMetadata('cart');

export default function Page() {
  return <ComingSoon section="cart" />;
}

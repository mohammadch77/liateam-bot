import { Button, EmptyState } from '@/ui';

/** What a user who is not a sales affiliate sees on the affiliate pages (the data is refused on the server as well). */
export function NotAffiliate() {
  return (
    <EmptyState
      icon="verified"
      title="این بخش مخصوص همکاران فروش است"
      action={<Button href="/affiliate?from=account">همکاری در فروش</Button>}
    >
      برای دریافت کد معرف و پورسانت، درخواست همکاری بدهید.
    </EmptyState>
  );
}

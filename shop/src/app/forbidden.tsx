import { Button, Container, EmptyState } from '@/ui';

/** Rendered with HTTP 403 when a guard calls forbidden(). */
export default function Forbidden() {
  return (
    <Container>
      <div style={{ maxWidth: 480, margin: '48px auto' }}>
        <EmptyState
          icon="lock"
          tone="danger"
          title="به این بخش دسترسی ندارید"
          action={
            <Button href="/" size="sm" variant="outline">
              بازگشت به فروشگاه
            </Button>
          }
        >
          این صفحه فقط برای نقش‌های مجاز باز است.
        </EmptyState>
      </div>
    </Container>
  );
}

import { authorize } from '@/server/auth/guards';
import { chatError } from '@/server/live-chat/http';
import { createSseResponse } from '@/server/live-chat/realtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await authorize('support');
    return createSseResponse('staff', request.signal);
  } catch (err) {
    return chatError(err);
  }
}

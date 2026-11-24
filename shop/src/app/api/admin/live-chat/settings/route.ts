import type { ChatPreChatField, ChatWidgetSettings } from '@/lib/live-chat/types';
import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      settings?: ChatWidgetSettings;
      preChatFields?: ChatPreChatField[];
    };
    const data = await liveChatService.saveSettingsAndPreChat({
      settings: body.settings ?? {
        enabled: true,
        widgetTitle: 'پشتیبانی آنلاین آوینا',
        welcomeMessage: '',
        offlineMessage: '',
        position: 'bottom_left',
        soundEnabled: true,
      },
      preChatFields: Array.isArray(body.preChatFields) ? body.preChatFields : [],
    });
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}

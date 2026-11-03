'use server';

import type { OperatorAction } from '@/lib/orders/operator';
import { runAction, type ActionResult } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { orderOperatorService, type ActionDone } from '@/server/services/order-operator.service';

/**
 * One entry for every operator button: the action's name, the order number and the one text it may need (a reason, a reference,
 * a tracking code, a note). Same-origin check first; the service checks the admin role and the order's status again under the lock.
 */
export async function operatorAction(
  number: string,
  action: OperatorAction,
  value: string,
): Promise<ActionResult<ActionDone>> {
  return runAction(`order.operator.${action}`, async () => {
    const meta = await requestMeta();
    const n = String(number);
    const v = String(value ?? '');
    switch (action) {
      case 'place':
        return orderOperatorService.place(n, meta);
      case 'recheck':
        return orderOperatorService.recheck(n, meta);
      case 'continue_review':
        return orderOperatorService.continueReview(n, meta);
      case 'cancel':
        return orderOperatorService.cancel(n, v, meta);
      case 'approve_cancel':
        return orderOperatorService.approveCancel(n, meta);
      case 'reject_cancel':
        return orderOperatorService.rejectCancel(n, v, meta);
      case 'mark_paid':
        return orderOperatorService.markPaid(n, v, meta);
      case 'ship':
        return orderOperatorService.ship(n, v, meta);
      case 'manual_return':
        return orderOperatorService.manualReturn(n, v, meta);
      case 'note':
        return orderOperatorService.addNote(n, v, meta);
      default:
        return { message: 'اقدام ناشناخته است.' };
    }
  });
}

'use server';

import { runAction, type ActionResult } from '@/server/http/action';
import { accountService } from '@/server/services/account.service';

/** The customer's name. The form sends only the name; the phone number cannot be changed here. */
export async function saveNameAction(fullName: string): Promise<ActionResult<string>> {
  return runAction('account.save_name', () => accountService.updateName(fullName));
}

'use server';

import { runAction, type ActionResult } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { walletTopupService } from '@/server/services/wallet-topup.service';
import { withdrawalService } from '@/server/services/withdrawal.service';

/**
 * Wallet actions. A top-up sends only an amount (the server checks the admin's window and saves it before the gateway is
 * asked); a withdrawal sends the amount, the account number and the holder's name and is allowed only for affiliates (checked in
 * the service, not here). The account number is never logged or returned.
 */
export async function startTopupAction(amount: number): Promise<ActionResult<{ url: string }>> {
  return runAction('wallet.topup', () => walletTopupService.start(Number(amount)));
}

export async function requestWithdrawalAction(input: {
  amount: number;
  iban: string;
  holderName: string;
}): Promise<ActionResult<{ id: string; amount: number }>> {
  return runAction('wallet.withdraw', async () => withdrawalService.request(input, await requestMeta()));
}

export async function cancelWithdrawalAction(id: string): Promise<ActionResult<{ amount: number }>> {
  return runAction('wallet.withdraw_cancel', async () => withdrawalService.cancel(String(id), await requestMeta()));
}

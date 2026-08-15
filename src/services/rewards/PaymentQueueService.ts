import { RewardService, type RewardRow } from './RewardService';
import { formatPaise } from './config';

// PaymentQueueService, read-only view of the helper's reward pipeline. Payouts
// are NEVER instant: rewards sit in the queue and are released by the weekly
// server batch (process_weekly_payouts) after fraud analysis. This service just
// surfaces where each reward is in that pipeline.

export type QueueSummary = {
  pendingPaise: number; // awaiting the weekly batch
  reviewPaise: number; // held for manual review
  paidPaise: number; // released to the wallet
  rewards: RewardRow[];
};

const LABELS: Record<RewardRow['status'], string> = {
  pending_review: 'Queued for weekly payout',
  manual_review: 'Under review',
  approved: 'Approved',
  rejected: 'Not eligible',
  paid: 'Paid',
};

export const PaymentQueueService = {
  statusLabel: (s: RewardRow['status']) => LABELS[s] ?? s,

  async summary(): Promise<QueueSummary> {
    const rewards = await RewardService.myRewards();
    const sum = (pred: (r: RewardRow) => boolean) =>
      rewards.filter(pred).reduce((a, r) => a + r.amountPaise, 0);
    return {
      pendingPaise: sum((r) => r.status === 'pending_review' || r.status === 'approved'),
      reviewPaise: sum((r) => r.status === 'manual_review'),
      paidPaise: sum((r) => r.status === 'paid'),
      rewards,
    };
  },

  formatPaise,
};

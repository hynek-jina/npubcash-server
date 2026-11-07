import { Pool, PoolClient } from "pg";
import { Claim } from "./claim";

export class Withdrawal {
  id: number;
  claim_ids: number[];
  created_at: number;
  pubkey: string;
  amount: number;

  constructor(
    id: number,
    claim_ids: number[],
    pubkey: string,
    amount: number,
    created_at: number,
  ) {
    this.id = id;
    this.claim_ids = claim_ids;
    this.pubkey = pubkey;
    this.amount = amount;
    this.created_at = created_at;
  }
}

export const sumWithdrawalClaimAmounts = (
  claims: ReadonlyArray<Pick<Claim, "proof">>,
): number => {
  let amount = 0;

  for (const claim of claims) {
    const claimAmount = Number(claim.proof?.amount ?? 0);
    if (!Number.isFinite(claimAmount) || claimAmount <= 0) {
      continue;
    }
    amount += Math.trunc(claimAmount);
  }

  return amount;
};

export class WithdrawalStore {
  private pool: Pool;
  static instance: WithdrawalStore;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  static getInstance(pool?: Pool) {
    if (this.instance) {
      return this.instance;
    } else {
      if (pool) {
        this.instance = new WithdrawalStore(pool);
        return this.instance;
      } else {
        throw new Error("Not instantiated yet...");
      }
    }
  }

  async getLastWithdrawlsByPubkey(pubkey: string) {
    const res = await this.pool.query<Withdrawal & { count: number }>(
      `
WITH total_count AS (
  SELECT COUNT(*)::integer AS count
  FROM l_withdrawals
  WHERE pubkey = $1
),
latest_withdrawals AS (
  SELECT
    l_withdrawals.id,
    l_withdrawals.claim_ids,
    l_withdrawals.pubkey,
    l_withdrawals.created_at,
    COALESCE(SUM((l_claims_3.proof ->> 'amount')::integer), 0)::integer AS amount
  FROM l_withdrawals
  LEFT JOIN LATERAL UNNEST(l_withdrawals.claim_ids) AS claim_id ON true
  LEFT JOIN l_claims_3 ON l_claims_3.id = claim_id
  WHERE l_withdrawals.pubkey = $1
  GROUP BY
    l_withdrawals.id,
    l_withdrawals.claim_ids,
    l_withdrawals.pubkey,
    l_withdrawals.created_at
  ORDER BY l_withdrawals.created_at DESC
  LIMIT 50
)
SELECT latest_withdrawals.*, total_count.count
FROM latest_withdrawals, total_count
ORDER BY latest_withdrawals.created_at DESC;
`,
      [pubkey],
    );
    if (res.rowCount === 0) {
      return { withdrawals: [], count: 0 };
    }
    return {
      withdrawals: res.rows.map(
        (row) =>
          new Withdrawal(
            row.id,
            row.claim_ids,
            row.pubkey,
            row.amount,
            Math.floor(new Date(row.created_at).getTime() / 1000),
          ),
      ),
      count: res.rows[0].count,
    };
  }

  async saveWithdrawal(client: PoolClient, claims: Claim[], pubkey: string) {
    const ids = claims.map((c) => c.id);
    await client.query(
      `INSERT INTO l_withdrawals (amount, pubkey, claim_ids) VALUES ($1, $2, $3)`,
      [sumWithdrawalClaimAmounts(claims), pubkey, ids],
    );
    await client.query(
      `UPDATE l_claims_3 SET status = 'inflight', handed_out_at = now() WHERE id = ANY($1)`,
      [ids],
    );
  }
}

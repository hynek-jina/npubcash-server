import { Request, Response } from "express";
import { Claim } from "../models";
import { Withdrawal, WithdrawalStore } from "../models/withdrawal";
import { encodeCashuToken, normalizeMintUrl } from "../utils/cashuToken";
import { queryWrapper } from "../utils/database";

export async function getLatestWithdrawalsController(
  req: Request,
  res: Response,
) {
  const authData = req.authData!;
  try {
    const withdrawals =
      await WithdrawalStore.getInstance().getLastWithdrawlsByPubkey(
        authData.data.pubkey,
      );
    res.status(200).json({
      error: false,
      data: {
        count: withdrawals.count,
        withdrawals: withdrawals.withdrawals,
      },
    });
  } catch (e) {
    console.warn("Failed to get latest withdrawals:");
    console.log(e);
    res.status(500).json({ error: true, message: "Something went wrong" });
  }
}

export async function getWithdrawalDetailsController(
  req: Request,
  res: Response,
) {
  const authData = req.authData!;
  const withdrawlId = req.params.id;
  try {
    const query = `
SELECT
    l_withdrawals.*,
    COALESCE(SUM((l_claims_3.proof ->> 'amount')::integer) OVER (), 0)::integer AS computed_amount,
    l_claims_3.*
FROM
    l_withdrawals
JOIN
    LATERAL UNNEST(l_withdrawals.claim_ids) AS claim_id ON true
JOIN
    l_claims_3 ON l_claims_3.id = claim_id
WHERE
    l_withdrawals.id = $1
AND
    l_withdrawals.pubkey = $2;`;
    const queryRes = await queryWrapper<Claim & Withdrawal>(query, [
      withdrawlId,
      authData.data.pubkey,
    ]);
    if (queryRes.rowCount === 0) {
      return res.status(404).json({ error: true, message: "not found" });
    }
    const claimsByMint = new Map<string, Claim[]>();
    for (const claim of queryRes.rows) {
      const mintUrl =
        normalizeMintUrl(claim.mint_url) || normalizeMintUrl(process.env.MINTURL);
      const claims = claimsByMint.get(mintUrl);
      if (claims) {
        claims.push(claim);
      } else {
        claimsByMint.set(mintUrl, [claim]);
      }
    }
    const tokens = Array.from(claimsByMint.entries()).map(
      ([mintUrl, claims]) => ({
        mintUrl,
        token: encodeCashuToken(
          mintUrl,
          claims.map((claim) => claim.proof),
        ),
        proofs: claims.map((claim) => claim.proof),
      }),
    );
    const singleToken = tokens.length === 1 ? tokens[0] : null;
    res.status(200).json({
      error: false,
      data: {
        amount: queryRes.rows[0].computed_amount,
        ...(singleToken
          ? {
              mintUrl: singleToken.mintUrl,
              proofs: singleToken.proofs,
              token: singleToken.token,
            }
          : {}),
        tokens,
      },
    });
  } catch (e) {
    console.warn("Failed to get withdrawal details");
    console.log(e);
    res.status(500).json({ error: true, message: "Something went wrong" });
  }
}

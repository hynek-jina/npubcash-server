import { CheckStateEnum, hashToCurve } from "@cashu/cashu-ts";
import { Request, Response } from "express";
import { getWallet } from "../config";
import { Claim, User } from "../models";
import { WithdrawalStore } from "../models/withdrawal";
import { encodeCashuToken, normalizeMintUrl } from "../utils/cashuToken";
import { withTransaction } from "../utils/database";

const getClaimMintUrl = (claim: Claim): string => {
  const mintUrl = normalizeMintUrl(claim.mint_url);
  return mintUrl || normalizeMintUrl(process.env.MINTURL!);
};

export async function balanceController(req: Request, res: Response) {
  const isAuth = req.authData!;
  try {
    const user = await User.getUserByPubkey(isAuth.data.pubkey);
    const balance = await Claim.getUserReadyClaimAmount(
      isAuth.data.npub,
      user?.name,
    );
    return res.json({ error: false, data: balance });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: true, message: "Something went wrong..." });
  }
}

const MAX_HANDOUT_PROOFS = 100;
const CHECK_BATCH_SIZE = 100;

const groupByMint = (claims: Claim[]) => {
  const groups = new Map<string, Claim[]>();
  for (const claim of claims) {
    const mintUrl = getClaimMintUrl(claim);
    groups.set(mintUrl, [...(groups.get(mintUrl) ?? []), claim]);
  }
  return groups;
};

async function findUnspentClaims(candidates: Claim[]) {
  const unspent: Claim[] = [];
  const spentIds: number[] = [];
  const failedMintUrls = new Set<string>();
  const neverOffered = candidates.filter((claim) => claim.status === "ready");
  const offered = candidates.filter((claim) => claim.status !== "ready");

  for (const group of [neverOffered, offered]) {
    for (const [mintUrl, claims] of groupByMint(group)) {
      if (failedMintUrls.has(mintUrl)) {
        continue;
      }
      const wallet = getWallet(mintUrl);
      for (
        let i = 0;
        i < claims.length && unspent.length < MAX_HANDOUT_PROOFS;
        i += CHECK_BATCH_SIZE
      ) {
        const batch = claims.slice(i, i + CHECK_BATCH_SIZE);
        try {
          const { states } = await wallet.mint.check({
            Ys: batch.map((claim) =>
              hashToCurve(new TextEncoder().encode(claim.proof.secret)).toHex(
                true,
              ),
            ),
          });
          const withState = (state: CheckStateEnum) =>
            batch.filter((_, index) => states[index]?.state === state);
          spentIds.push(
            ...withState(CheckStateEnum.SPENT).map((claim) => claim.id),
          );
          unspent.push(
            ...withState(CheckStateEnum.UNSPENT).slice(
              0,
              MAX_HANDOUT_PROOFS - unspent.length,
            ),
          );
        } catch (error) {
          failedMintUrls.add(mintUrl);
          console.warn("Failed to verify claim proofs for mint", {
            error,
            mintUrl,
            claimIds: batch.map((claim) => claim.id),
          });
          break;
        }
      }
    }
  }
  return { unspent, spentIds, failedMintUrls };
}

export async function claimGetController(req: Request, res: Response) {
  try {
    const { pubkey, npub } = req.authData!.data;
    const user = await User.getUserByPubkey(pubkey);
    const { candidateCount, unspent, failedMintUrls } = await withTransaction(
      async (client) => {
        const candidates = await Claim.lockClaimableClaims(
          client,
          user?.name ? [npub, user.name] : [npub],
        );
        const found = await findUnspentClaims(candidates);
        await Claim.markClaimsSpent(client, found.spentIds);
        if (found.unspent.length > 0) {
          await WithdrawalStore.getInstance().saveWithdrawal(
            client,
            found.unspent,
            pubkey,
          );
        }
        return { ...found, candidateCount: candidates.length };
      },
    );

    if (unspent.length === 0) {
      if (failedMintUrls.size > 0) {
        return res.status(502).json({
          error: true,
          message: "Failed to verify claimable proofs",
        });
      }
      return res.json({ error: true, message: "No proofs to claim" });
    }

    const tokens = [...groupByMint(unspent)].map(([mintUrl, claims]) =>
      encodeCashuToken(
        mintUrl,
        claims.map((claim) => claim.proof),
      ),
    );
    const singleToken = tokens.length === 1 ? tokens[0] : null;
    res.json({
      error: false,
      data: {
        ...(singleToken ? { token: singleToken } : {}),
        tokens,
        count: unspent.length,
        totalPending: candidateCount,
      },
    });
  } catch (e) {
    console.warn(e);
    res.status(500);
    res.json({ error: true, message: "Something went wrong..." });
  }
}

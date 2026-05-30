import { CheckStateEnum, getEncodedToken, hashToCurve } from "@cashu/cashu-ts";
import { Request, Response } from "express";
import { getWallet } from "../config";
import { Claim, User } from "../models";
import { WithdrawalStore } from "../models/withdrawal";

const getClaimMintUrl = (claim: Claim): string => {
  const mintUrl = String(claim.mint_url ?? "").trim();
  return mintUrl || process.env.MINTURL!;
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

export async function claimGetController(req: Request, res: Response) {
  const user = await User.getUserByPubkey(req.authData!.data.pubkey);
  const allClaims = await Claim.getPaginatedUserReadyClaims(
    1,
    req.authData!.data.npub,
    user?.name,
  );
  if (allClaims.count === 0) {
    return res.json({ error: true, message: "No proofs to claim" });
  }

  const claimsByMint = new Map<string, Claim[]>();
  for (const claim of allClaims.claims) {
    const mintUrl = getClaimMintUrl(claim);
    const existing = claimsByMint.get(mintUrl);
    if (existing) {
      existing.push(claim);
    } else {
      claimsByMint.set(mintUrl, [claim]);
    }
  }

  const tokens: string[] = [];
  let spendableProofCount = 0;
  for (const [mintUrl, claims] of claimsByMint.entries()) {
    const proofs = claims.map((claim) => claim.proof);
    const payload = {
      Ys: proofs.map((proof) =>
        hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true),
      ),
    };
    const wallet = getWallet(mintUrl);
    const { states } = await wallet.mint.check(payload);
    const spendableProofs = proofs.filter(
      (_, index) => states[index]?.state === CheckStateEnum.UNSPENT,
    );
    if (spendableProofs.length === 0) {
      continue;
    }

    spendableProofCount += spendableProofs.length;
    tokens.push(
      getEncodedToken({
        memo: "",
        mint: mintUrl,
        proofs: spendableProofs,
      }),
    );
  }

  if (spendableProofCount === 0) {
    return res.json({ error: true, message: "No proofs to claim" });
  }

  try {
    await WithdrawalStore.getInstance()?.saveWithdrawal(
      allClaims.claims,
      req.authData!.data.pubkey,
    );
    const singleToken = tokens.length === 1 ? tokens[0] : null;
    res.json({
      error: false,
      data: {
        ...(singleToken ? { token: singleToken } : {}),
        tokens,
        count: allClaims.claims.length,
        totalPending: allClaims.count,
      },
    });
  } catch (e) {
    console.warn(e);
    res.status(500);
    res.json({ error: true, message: "Something went wrong..." });
  }
}

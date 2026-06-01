import { CheckStateEnum, getEncodedToken, hashToCurve } from "@cashu/cashu-ts";
import { Request, Response } from "express";
import { getWallet } from "../config";
import { Claim, User } from "../models";
import { WithdrawalStore } from "../models/withdrawal";

const normalizeMintUrl = (value: string | null | undefined): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return raw.replace(/\/+$/, "");
  }
};

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

export async function claimGetController(req: Request, res: Response) {
  try {
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
    const claimedClaims: Claim[] = [];
    const failedMintUrls = new Set<string>();
    let spendableProofCount = 0;

    for (const [mintUrl, claims] of claimsByMint.entries()) {
      try {
        const proofs = claims.map((claim) => claim.proof);
        const payload = {
          Ys: proofs.map((proof) =>
            hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true),
          ),
        };
        const wallet = getWallet(mintUrl);
        const { states } = await wallet.mint.check(payload);
        const spendableClaims = claims.filter(
          (_, index) => states[index]?.state === CheckStateEnum.UNSPENT,
        );
        const spendableProofs = spendableClaims.map((claim) => claim.proof);
        if (spendableProofs.length === 0) {
          continue;
        }

        claimedClaims.push(...spendableClaims);
        spendableProofCount += spendableProofs.length;
        tokens.push(
          getEncodedToken({
            memo: "",
            mint: mintUrl,
            proofs: spendableProofs,
          }),
        );
      } catch (error) {
        failedMintUrls.add(mintUrl);
        console.warn("Failed to verify claim proofs for mint", {
          error,
          mintUrl,
          claimIds: claims.map((claim) => claim.id),
        });
      }
    }

    if (spendableProofCount === 0) {
      if (failedMintUrls.size > 0) {
        return res.status(502).json({
          error: true,
          message: "Failed to verify claimable proofs",
        });
      }
      return res.json({ error: true, message: "No proofs to claim" });
    }

    await WithdrawalStore.getInstance()?.saveWithdrawal(
      claimedClaims,
      req.authData!.data.pubkey,
    );
    const singleToken = tokens.length === 1 ? tokens[0] : null;
    res.json({
      error: false,
      data: {
        ...(singleToken ? { token: singleToken } : {}),
        tokens,
        count: spendableProofCount,
        totalPending: allClaims.count,
      },
    });
  } catch (e) {
    console.warn(e);
    res.status(500);
    res.json({ error: true, message: "Something went wrong..." });
  }
}

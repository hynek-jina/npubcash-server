import { MintQuoteBolt11Response } from "@cashu/cashu-ts";
import { createHash } from "crypto";
import { NextFunction, Request, Response } from "express";
import { Event, nip19 } from "nostr-tools";

import { getWallet } from "../config";
import { Transaction, User } from "../models";
import { PaymentSettlementService } from "../services/paymentSettlement";
import { Analyzer } from "../utils/analytics";
import { createLnurlResponse } from "../utils/lnurl";
import { requestMintQuoteBolt11 } from "../utils/lightning";
import { decodeAndValidateZapRequest } from "../utils/nostr";

interface MintQuoteResult {
  expiry?: number | null;
  quote: string;
  request: string;
}

export async function lnurlController(
  req: Request<
    { user: string },
    unknown,
    unknown,
    { amount?: string; nostr?: string }
  >,
  res: Response,
  next: NextFunction,
) {
  const { amount, nostr } = req.query;
  const userParam = req.params.user;
  let username: string | User | undefined;
  let mintUrl = process.env.MINTURL!;
  let zapRequest: Event | undefined;
  if (userParam.startsWith("npub")) {
    try {
      const decoded = nip19.decode(userParam as `npub1${string}`);
      if (decoded.type !== "npub" || typeof decoded.data !== "string") {
        throw new Error("Invalid npub / public key");
      }
      const userObj = await User.getUserByPubkey(decoded.data);
      if (userObj?.mint_url) {
        mintUrl = userObj.mint_url;
      }
      username = userParam;
    } catch {
      res.status(401);
      return next(new Error("Invalid npub / public key"));
    }
  } else {
    const userObj = await User.getUserByName(userParam.toLowerCase());
    if (!userObj) {
      res.status(404);
      return next(new Error("User not found"));
    }
    username = userObj.name;
    mintUrl = userObj.mint_url;
  }
  if (!amount) {
    const lnurlResponse = createLnurlResponse(username);
    return res.json(lnurlResponse);
  }
  const parsedAmount = parseInt(amount);
  if (
    parsedAmount > Number(process.env.LNURL_MAX_AMOUNT) ||
    parsedAmount < Number(process.env.LNURL_MIN_AMOUNT)
  ) {
    const err = new Error("Invalid amount");
    return next(err);
  }
  if (nostr) {
    try {
      zapRequest = decodeAndValidateZapRequest(nostr, amount);
    } catch (e) {
      return res
        .status(400)
        .json({ error: true, message: "Invalid zap request" });
    }
  }
  const quoteAmount = Math.floor(parsedAmount / 1000);
  const wallet = getWallet(mintUrl);
  let quote: MintQuoteResult;
  try {
    if (zapRequest) {
      quote = await wallet.createMintQuote<MintQuoteBolt11Response>("bolt11", {
        amount: quoteAmount,
        description_hash: createHash("sha256")
          .update(JSON.stringify(zapRequest))
          .digest("hex"),
      });
    } else {
      try {
        quote = await wallet.createMintQuoteBolt11(quoteAmount, "Cashu Address");
      } catch (error) {
        console.warn("Mint quote via cashu-ts failed; trying direct v1 endpoint", {
          error,
          mintUrl,
        });
        quote = await requestMintQuoteBolt11({
          amountSat: quoteAmount,
          mintUrl,
        });
      }
    }
  } catch (e) {
    console.log("Failed to create invoice: Mint failed");
    console.log(e);
    res.status(500);
    return res.json({ error: true, message: "Something went wrong..." });
  }

  Analyzer.getInstance().logPaymentCreated(
    quote.quote,
    quote.expiry ? quote.expiry - Math.floor(Date.now() / 1000) : 3600,
  );
  try {
    const transaction = await Transaction.createCashuTransaction(
      quote.quote,
      quote.request,
      username,
      zapRequest,
      parsedAmount / 1000,
      mintUrl,
    );
    PaymentSettlementService.getInstance().startWatchingTransaction(
      transaction,
    );
    res.json({
      pr: quote.request,
      routes: [],
    });
  } catch (e) {
    console.log("Failed to create invoice: Database connection failed");
    console.log(e);
    res.status(500);
    return res.json({ error: true, message: "Something went wrong..." });
  }
}

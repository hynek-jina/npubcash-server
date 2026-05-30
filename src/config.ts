import { Wallet } from "@cashu/cashu-ts";
import { SimplePool, getPublicKey } from "nostr-tools";

export const wallet = new Wallet(process.env.MINTURL!);
export const nostrPool = new SimplePool();

export function getWallet(mintUrl?: string) {
  const resolvedMintUrl = mintUrl?.trim();
  if (!resolvedMintUrl || resolvedMintUrl === process.env.MINTURL) {
    return wallet;
  }
  return new Wallet(resolvedMintUrl);
}

export let ZAP_PUBKEY: string;
if (process.env.ZAP_SECRET_KEY) {
  ZAP_PUBKEY = getPublicKey(Buffer.from(process.env.ZAP_SECRET_KEY, "hex"));
}

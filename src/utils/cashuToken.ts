import { getEncodedToken, Proof } from "@cashu/cashu-ts";

export const normalizeMintUrl = (value: string | null | undefined): string => {
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

export const encodeCashuToken = (
  mintUrl: string,
  proofs: Proof[],
  memo = "",
) =>
  getEncodedToken({
    memo,
    mint: mintUrl,
    proofs,
  });

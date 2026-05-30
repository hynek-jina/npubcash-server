import { decode } from "light-bolt11-decoder";

interface MintQuoteResponse {
  expiry: number | null;
  quote: string;
  request: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

type InvoiceData = {
  // FIX: parseInvoice returns amount: string
  amount: number;
  paymentHash: string;
  expiresIn: number;
  memo?: string;
};

export function parseInvoice(invoice: string): InvoiceData {
  const sections = decode(invoice).sections;
  const invoiceData: InvoiceData = { expiresIn: 3600 } as InvoiceData;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].name === "amount") {
      invoiceData.amount = sections[i].value;
    }
    if (sections[i].name === "expiry") {
      invoiceData.expiresIn = parseInt(sections[i].value);
    }
    if (sections[i].name === "description") {
      invoiceData.memo = sections[i].value;
    }
    if (sections[i].name === "payment_hash") {
      invoiceData.paymentHash = sections[i].value;
    }
  }
  return invoiceData;
}

export async function requestMintQuoteBolt11(args: {
  amountSat: number;
  mintUrl: string;
}): Promise<MintQuoteResponse> {
  const targetUrl = `${args.mintUrl.replace(/\/+$/, "")}/v1/mint/quote/bolt11`;

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: args.amountSat, unit: "sat" }),
  });

  if (!response.ok) {
    throw new Error(`Mint quote HTTP ${response.status}`);
  }

  const rawText = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = rawText ? JSON.parse(rawText) : null;
    payload = isRecord(parsed) ? parsed : null;
  } catch {
    throw new Error(
      `Mint quote parse failed (${response.status}): ${rawText.slice(0, 200)}`,
    );
  }

  const quote = String(payload?.quote ?? payload?.id ?? "").trim();
  const request = String(
    payload?.request ?? payload?.pr ?? payload?.paymentRequest ?? "",
  ).trim();
  const expiryValue = payload?.expiry;
  const expiry =
    typeof expiryValue === "number" && Number.isFinite(expiryValue)
      ? expiryValue
      : null;

  if (!quote || !request) {
    throw new Error(
      `Missing mint quote (quote=${quote || "-"}, invoice=${request || "-"})`,
    );
  }

  return {
    expiry,
    quote,
    request,
  };
}

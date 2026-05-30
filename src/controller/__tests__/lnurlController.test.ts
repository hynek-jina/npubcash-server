import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { getWallet } from "../../config";
import { Transaction, User } from "../../models";
import * as lightningUtils from "../../utils/lightning";
import { createLnurlResponse } from "../../utils/lnurl";
import { decodeAndValidateZapRequest } from "../../utils/nostr";

vi.mock("../../models/user.ts");
vi.mock("../../models/transaction.ts");

vi.mock("../../utils/nostr", () => ({
  decodeAndValidateZapRequest: vi.fn(),
}));

vi.mock("../../utils/lnurl", () => ({
  createLnurlResponse: vi.fn(),
}));

vi.mock("../utils/lnurl", async () => {
  return {
    createLnurlResponse: vi.fn(),
  };
});

vi.mock("crypto", () => ({
  createHash: () => ({
    update: () => ({
      digest: vi.fn().mockReturnValue("mockedHash"),
    }),
  }),
}));

vi.mock("../utils/lightning", () => ({
  parseInvoice: vi.fn(),
}));

vi.mock("nostr-tools", () => ({
  SimplePool: vi.fn(),
  nip19: {
    decode: vi.fn((value: string) => {
      if (value === "npubIsInvalid") {
        throw new Error("invalid npub");
      }
      return {
        type: "npub",
        data: "decoded-pubkey-hex",
      };
    }),
  },
}));

vi.mock("../../config.ts", () => ({
  wallet: {
    createMintQuote: vi.fn(),
    createMintQuoteBolt11: vi.fn(),
  },
  getWallet: vi.fn(),
}));

const settlementServiceMock = vi.hoisted(() => ({
  startWatchingTransaction: vi.fn(),
}));

vi.mock("../../services/paymentSettlement", () => ({
  PaymentSettlementService: {
    getInstance: vi.fn(() => settlementServiceMock),
  },
}));

describe("lnurlController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    process.env.NODE_ENV = "development";
    vi.mocked(getWallet).mockReturnValue({
      createMintQuote: vi.fn(),
      createMintQuoteBolt11: vi.fn(),
    });
  });

  it("should return 401 for invalid npub", async () => {
    const res = await request(app).get("/.well-known/lnurlp/npubIsInvalid");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({});
  });

  it("should return 404 if user not found", async () => {
    vi.mocked(User.getUserByName).mockResolvedValue(undefined);

    const res = await request(app).get("/.well-known/lnurlp/nonexistentUser");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({});
  });

  it("should use the stored mint for npub aliases too", async () => {
    vi.mocked(User.getUserByPubkey, { partial: true }).mockResolvedValue({
      name: "testUser",
      mint_url: "https://mint.minibits.cash/Bitcoin",
      pubkey: "decoded-pubkey-hex",
    });
    const createMintQuoteBolt11 = vi.fn().mockResolvedValue({
      quote: "quote-id",
      request: "invoice",
      amount: 21,
      state: "UNPAID",
      expiry: null,
      unit: "sat",
    });
    vi.mocked(getWallet).mockReturnValue({
      createMintQuote: vi.fn(),
      createMintQuoteBolt11,
    });
    vi.mocked(Transaction.createCashuTransaction, {
      partial: true,
    }).mockResolvedValue({
      id: 1,
      mint_pr: "invoice",
      mint_hash: "quote-id",
      server_pr: "invoice",
      server_hash: "quote-id",
      cashu_quote_id: "quote-id",
      user: "npub1testuser",
      zap_request: undefined,
      amount: 21,
      fulfilled: false,
    });

    vi.stubEnv("LNURL_MIN_AMOUNT", "10");
    vi.stubEnv("LNURL_MAX_AMOUNT", "1000000");

    const res = await request(app).get(
      "/.well-known/lnurlp/npub1testuser?amount=21000",
    );

    expect(getWallet).toHaveBeenCalledWith(
      "https://mint.minibits.cash/Bitcoin",
    );
    expect(createMintQuoteBolt11).toHaveBeenCalledWith(21, "Cashu Address");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pr: "invoice", routes: [] });
  });

  it("should return lnurl response if no amount provided", async () => {
    vi.mocked(User.getUserByName, { partial: true }).mockResolvedValue({
      name: "testUser",
      mint_url: "https://mint.minibits.cash/Bitcoin",
      pubkey: "testPubkey...",
    });
    vi.mocked(createLnurlResponse).mockReturnValue({
      callback: "https://npub.cash/.well-known/lnurlp/testUser",
      minSendable: 1000,
      maxSendable: 100000,
      metadata: "",
      tag: "pay",
    });

    const res = await request(app).get("/.well-known/lnurlp/testUser");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      callback: "https://npub.cash/.well-known/lnurlp/testUser",
      minSendable: 1000,
      maxSendable: 100000,
      metadata: "",
      tag: "pay",
    });
  });

  it("should return error for invalid amount", async () => {
    vi.stubEnv("LNURL_MIN_AMOUNT", "10");
    vi.stubEnv("LNURL_MAX_AMOUNT", "1000");
    const res = await request(app).get("/.well-known/lnurlp/testUser?amount=5");

    expect(res.status).toBe(500);
  });

  it("should return error for invalid zap request", async () => {
    vi.mocked(decodeAndValidateZapRequest).mockImplementation(() => {
      throw new Error("Invalid zap request");
    });

    const res = await request(app).get(
      "/.well-known/lnurlp/testUser?amount=100&nostr=invalidZapRequest",
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: "Invalid zap request" });
  });

  it("should return invoice for valid request without nostr", async () => {
    vi.mocked(User.getUserByName, { partial: true }).mockResolvedValue({
      name: "testUser",
      mint_url: "https://mint.minibits.cash/Bitcoin",
      pubkey: "testPubkey...",
    });
    const createMintQuoteBolt11 = vi.fn().mockResolvedValue({
      quote: "quote-id",
      request: "invoice",
      amount: 21,
      state: "UNPAID",
      expiry: null,
      unit: "sat",
    });
    vi.mocked(getWallet).mockReturnValue({
      createMintQuote: vi.fn(),
      createMintQuoteBolt11,
    });
    vi.mocked(Transaction.createTransaction, {
      partial: true,
    }).mockResolvedValue({
      mint_pr: "123",
      mint_hash: "456",
      server_pr: "invoice",
      server_hash: "hash",
      user: "testUser",
      zap_request: undefined,
      amount: 21,
      fulfilled: false,
    });
    vi.mocked(Transaction.createCashuTransaction, {
      partial: true,
    }).mockResolvedValue({
      id: 1,
      mint_pr: "invoice",
      mint_hash: "quote-id",
      server_pr: "invoice",
      server_hash: "quote-id",
      cashu_quote_id: "quote-id",
      user: "testUser",
      zap_request: undefined,
      amount: 21,
      fulfilled: false,
    });

    vi.stubEnv("LNURL_MIN_AMOUNT", "10");
    vi.stubEnv("LNURL_MAX_AMOUNT", "1000000");

    const res = await request(app).get(
      "/.well-known/lnurlp/testUser?amount=21000",
    );

    expect(getWallet).toHaveBeenCalledWith(
      "https://mint.minibits.cash/Bitcoin",
    );
    expect(createMintQuoteBolt11).toHaveBeenCalledWith(21, "Cashu Address");
    expect(Transaction.createCashuTransaction).toHaveBeenCalledWith(
      "quote-id",
      "invoice",
      "testUser",
      undefined,
      21,
      "https://mint.minibits.cash/Bitcoin",
    );
    expect(settlementServiceMock.startWatchingTransaction).toHaveBeenCalled();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pr: "invoice", routes: [] });
  });

  it("falls back to the direct v1 mint quote endpoint when cashu-ts quote creation fails", async () => {
    vi.mocked(User.getUserByName, { partial: true }).mockResolvedValue({
      name: "testUser",
      mint_url: "https://mint.minibits.cash/Bitcoin",
      pubkey: "testPubkey...",
    });
    const createMintQuoteBolt11 = vi
      .fn()
      .mockRejectedValue(new Error("legacy quote path failed"));
    vi.mocked(getWallet).mockReturnValue({
      createMintQuote: vi.fn(),
      createMintQuoteBolt11,
    });
    vi.spyOn(lightningUtils, "requestMintQuoteBolt11").mockResolvedValue({
      expiry: null,
      quote: "quote-id",
      request: "invoice",
    });
    vi.mocked(Transaction.createCashuTransaction, {
      partial: true,
    }).mockResolvedValue({
      id: 1,
      mint_pr: "invoice",
      mint_hash: "quote-id",
      server_pr: "invoice",
      server_hash: "quote-id",
      cashu_quote_id: "quote-id",
      user: "testUser",
      zap_request: undefined,
      amount: 21,
      fulfilled: false,
    });

    vi.stubEnv("LNURL_MIN_AMOUNT", "10");
    vi.stubEnv("LNURL_MAX_AMOUNT", "1000000");

    const res = await request(app).get(
      "/.well-known/lnurlp/testUser?amount=21000",
    );

    expect(createMintQuoteBolt11).toHaveBeenCalledWith(21, "Cashu Address");
    expect(lightningUtils.requestMintQuoteBolt11).toHaveBeenCalledWith({
      amountSat: 21,
      mintUrl: "https://mint.minibits.cash/Bitcoin",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pr: "invoice", routes: [] });
  });

  it("should create zap invoices with the zap request description hash", async () => {
    const zapRequest = {
      id: "zap-id",
      pubkey: "zap-pubkey",
      created_at: 1,
      kind: 9734,
      tags: [],
      content: "",
      sig: "sig",
    };
    vi.mocked(User.getUserByName, { partial: true }).mockResolvedValue({
      name: "testUser",
      mint_url: "https://mint.minibits.cash/Bitcoin",
      pubkey: "testPubkey...",
    });
    vi.mocked(decodeAndValidateZapRequest).mockReturnValue(zapRequest);
    const createMintQuote = vi.fn().mockResolvedValue({
      quote: "quote-id",
      request: "invoice",
      amount: 21,
      state: "UNPAID",
      expiry: null,
      unit: "sat",
    });
    const createMintQuoteBolt11 = vi.fn();
    vi.mocked(getWallet).mockReturnValue({
      createMintQuote,
      createMintQuoteBolt11,
    });
    vi.mocked(Transaction.createCashuTransaction, {
      partial: true,
    }).mockResolvedValue({
      id: 1,
      mint_pr: "invoice",
      mint_hash: "quote-id",
      server_pr: "invoice",
      server_hash: "quote-id",
      cashu_quote_id: "quote-id",
      user: "testUser",
      zap_request: zapRequest,
      amount: 21,
      fulfilled: false,
    });

    vi.stubEnv("LNURL_MIN_AMOUNT", "10");
    vi.stubEnv("LNURL_MAX_AMOUNT", "1000000");

    const res = await request(app).get(
      "/.well-known/lnurlp/testUser?amount=21000&nostr=zapRequest",
    );

    expect(getWallet).toHaveBeenCalledWith(
      "https://mint.minibits.cash/Bitcoin",
    );
    expect(createMintQuote).toHaveBeenCalledWith("bolt11", {
      amount: 21,
      description_hash: "mockedHash",
    });
    expect(createMintQuoteBolt11).not.toHaveBeenCalled();
    expect(Transaction.createCashuTransaction).toHaveBeenCalledWith(
      "quote-id",
      "invoice",
      "testUser",
      zapRequest,
      21,
      "https://mint.minibits.cash/Bitcoin",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pr: "invoice", routes: [] });
  });
});

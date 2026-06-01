import supertest from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import app from "../../app";
import { getWallet } from "../../config";
import { Claim, User } from "../../models";

const pubkey =
  "ca9881c70e72981b356353453f4bbfd8153d209acd9b7b5b4200e80c7dec8c7a";
const npub = "npub1e2vgr3cww2vpkdtr2dzn7jalmq2n6gy6ekdhkk6zqr5qcl0v33aqa87qqk";

const mockAuthMiddleware = vi.hoisted(() =>
  vi.fn((req, _res, next) => {
    req.authData = {
      authorized: true,
      data: { pubkey, npub },
    };
    next();
  }),
);

const saveWithdrawalMock = vi.hoisted(() => vi.fn());
const getEncodedTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../../middleware/auth.ts", () => ({
  isAuthMiddleware: () => mockAuthMiddleware,
}));

vi.mock("../../models/claim.ts");
vi.mock("../../models/user.ts");
vi.mock("../../models/withdrawal", () => ({
  WithdrawalStore: {
    getInstance: vi.fn(() => ({ saveWithdrawal: saveWithdrawalMock })),
  },
}));

vi.mock("../../config", () => ({
  getWallet: vi.fn(),
}));

vi.mock("@cashu/cashu-ts", () => ({
  CheckStateEnum: { UNSPENT: "UNSPENT", SPENT: "SPENT" },
  getEncodedToken: getEncodedTokenMock,
  hashToCurve: vi.fn(() => ({
    toHex: vi.fn(() => "Y"),
  })),
}));

describe("claimGetController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MINTURL", "https://cashu.cz");
  });

  test("returns one token per mint group and preserves the mint in the encoded token", async () => {
    vi.mocked(User.getUserByPubkey, { partial: true }).mockResolvedValue({
      pubkey,
      name: "alice",
      mint_url: "https://minibits.cash/Bitcoin",
    });

    vi.mocked(Claim.getPaginatedUserReadyClaims, {
      partial: true,
    }).mockResolvedValue({
      claims: [
        {
          id: 1,
          user: "alice",
          mint_url: "https://minibits.cash/Bitcoin",
          proof: { amount: 10, secret: "secret-1" },
          status: "ready",
        },
        {
          id: 2,
          user: npub,
          mint_url: "https://cashu.cz",
          proof: { amount: 20, secret: "secret-2" },
          status: "ready",
        },
      ],
      count: 2,
      totalPending: 2,
    });

    const minibitsCheck = vi.fn().mockResolvedValue({
      states: [{ state: "UNSPENT" }],
    });
    const cashuCheck = vi.fn().mockResolvedValue({
      states: [{ state: "UNSPENT" }],
    });

    vi.mocked(getWallet)
      .mockReturnValueOnce({ mint: { check: minibitsCheck } })
      .mockReturnValueOnce({ mint: { check: cashuCheck } });

    getEncodedTokenMock
      .mockReturnValueOnce("cashuAminibits")
      .mockReturnValueOnce("cashuAcashucz");

    const res = await supertest(app)
      .get("/api/v1/claim")
      .set("authorization", "validHeader");

    expect(res.status).toBe(200);
    expect(getWallet).toHaveBeenNthCalledWith(
      1,
      "https://minibits.cash/Bitcoin",
    );
    expect(getWallet).toHaveBeenNthCalledWith(2, "https://cashu.cz");
    expect(getEncodedTokenMock).toHaveBeenNthCalledWith(1, {
      memo: "",
      mint: "https://minibits.cash/Bitcoin",
      proofs: [{ amount: 10, secret: "secret-1" }],
    });
    expect(getEncodedTokenMock).toHaveBeenNthCalledWith(2, {
      memo: "",
      mint: "https://cashu.cz",
      proofs: [{ amount: 20, secret: "secret-2" }],
    });
    expect(saveWithdrawalMock).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({
      error: false,
      data: {
        tokens: ["cashuAminibits", "cashuAcashucz"],
        count: 2,
        totalPending: 2,
      },
    });
  });

  test("normalizes trailing slash mint URLs before encoding claim tokens", async () => {
    vi.mocked(User.getUserByPubkey, { partial: true }).mockResolvedValue({
      pubkey,
      name: "alice",
      mint_url: "https://cashu.cz/",
    });

    vi.mocked(Claim.getPaginatedUserReadyClaims, {
      partial: true,
    }).mockResolvedValue({
      claims: [
        {
          id: 1,
          user: "alice",
          mint_url: "https://cashu.cz/",
          proof: { amount: 20, secret: "secret-1" },
          status: "ready",
        },
      ],
      count: 1,
      totalPending: 1,
    });

    const cashuCheck = vi.fn().mockResolvedValue({
      states: [{ state: "UNSPENT" }],
    });

    vi.mocked(getWallet).mockReturnValue({ mint: { check: cashuCheck } });
    getEncodedTokenMock.mockReturnValueOnce("cashuAcanonical");

    const res = await supertest(app)
      .get("/api/v1/claim")
      .set("authorization", "validHeader");

    expect(res.status).toBe(200);
    expect(getWallet).toHaveBeenCalledWith("https://cashu.cz");
    expect(getEncodedTokenMock).toHaveBeenCalledWith({
      memo: "",
      mint: "https://cashu.cz",
      proofs: [{ amount: 20, secret: "secret-1" }],
    });
    expect(res.body).toEqual({
      error: false,
      data: {
        token: "cashuAcanonical",
        tokens: ["cashuAcanonical"],
        count: 1,
        totalPending: 1,
      },
    });
  });

  test("persists only spendable claims when some ready claims are already spent", async () => {
    vi.mocked(User.getUserByPubkey, { partial: true }).mockResolvedValue({
      pubkey,
      name: "alice",
      mint_url: "https://cashu.cz",
    });

    vi.mocked(Claim.getPaginatedUserReadyClaims, {
      partial: true,
    }).mockResolvedValue({
      claims: [
        {
          id: 1,
          user: "alice",
          mint_url: "https://cashu.cz",
          proof: { amount: 10, secret: "secret-spent" },
          status: "ready",
        },
        {
          id: 2,
          user: "alice",
          mint_url: "https://cashu.cz",
          proof: { amount: 20, secret: "secret-unspent" },
          status: "ready",
        },
      ],
      count: 2,
      totalPending: 2,
    });

    const cashuCheck = vi.fn().mockResolvedValue({
      states: [{ state: "SPENT" }, { state: "UNSPENT" }],
    });

    vi.mocked(getWallet).mockReturnValue({ mint: { check: cashuCheck } });

    getEncodedTokenMock.mockReturnValueOnce("cashuAunspentonly");

    const res = await supertest(app)
      .get("/api/v1/claim")
      .set("authorization", "validHeader");

    expect(res.status).toBe(200);
    expect(getEncodedTokenMock).toHaveBeenCalledWith({
      memo: "",
      mint: "https://cashu.cz",
      proofs: [{ amount: 20, secret: "secret-unspent" }],
    });
    expect(saveWithdrawalMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 2,
          proof: { amount: 20, secret: "secret-unspent" },
        }),
      ],
      pubkey,
    );
    expect(res.body).toEqual({
      error: false,
      data: {
        token: "cashuAunspentonly",
        tokens: ["cashuAunspentonly"],
        count: 1,
        totalPending: 2,
      },
    });
  });

  test("skips a mint group when its proof check fails but still returns other claimable tokens", async () => {
    vi.mocked(User.getUserByPubkey, { partial: true }).mockResolvedValue({
      pubkey,
      name: "alice",
      mint_url: "https://cashu.cz",
    });

    vi.mocked(Claim.getPaginatedUserReadyClaims, {
      partial: true,
    }).mockResolvedValue({
      claims: [
        {
          id: 1,
          user: "alice",
          mint_url: "https://broken-mint.example",
          proof: { amount: 10, secret: "secret-broken" },
          status: "ready",
        },
        {
          id: 2,
          user: "alice",
          mint_url: "https://cashu.cz",
          proof: { amount: 20, secret: "secret-ok" },
          status: "ready",
        },
      ],
      count: 2,
      totalPending: 2,
    });

    const brokenCheck = vi.fn().mockRejectedValue(new Error("mint down"));
    const cashuCheck = vi.fn().mockResolvedValue({
      states: [{ state: "UNSPENT" }],
    });

    vi.mocked(getWallet)
      .mockReturnValueOnce({ mint: { check: brokenCheck } })
      .mockReturnValueOnce({ mint: { check: cashuCheck } });

    getEncodedTokenMock.mockReturnValueOnce("cashuAok");

    const res = await supertest(app)
      .get("/api/v1/claim")
      .set("authorization", "validHeader");

    expect(res.status).toBe(200);
    expect(saveWithdrawalMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 2,
          mint_url: "https://cashu.cz",
        }),
      ],
      pubkey,
    );
    expect(res.body).toEqual({
      error: false,
      data: {
        token: "cashuAok",
        tokens: ["cashuAok"],
        count: 1,
        totalPending: 2,
      },
    });
  });

  test("returns an explicit error when no mint group can be verified", async () => {
    vi.mocked(User.getUserByPubkey, { partial: true }).mockResolvedValue({
      pubkey,
      name: "alice",
      mint_url: "https://broken-mint.example",
    });

    vi.mocked(Claim.getPaginatedUserReadyClaims, {
      partial: true,
    }).mockResolvedValue({
      claims: [
        {
          id: 1,
          user: "alice",
          mint_url: "https://broken-mint.example",
          proof: { amount: 10, secret: "secret-broken" },
          status: "ready",
        },
      ],
      count: 1,
      totalPending: 1,
    });

    const brokenCheck = vi.fn().mockRejectedValue(new Error("mint down"));

    vi.mocked(getWallet).mockReturnValue({ mint: { check: brokenCheck } });

    const res = await supertest(app)
      .get("/api/v1/claim")
      .set("authorization", "validHeader");

    expect(res.status).toBe(502);
    expect(saveWithdrawalMock).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      error: true,
      message: "Failed to verify claimable proofs",
    });
  });
});

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
});

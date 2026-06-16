import supertest from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import app from "../../app";
import { queryWrapper } from "../../utils/database";

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

const getEncodedTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../../middleware/auth.ts", () => ({
  isAuthMiddleware: () => mockAuthMiddleware,
}));

vi.mock("../../utils/database", () => ({
  queryWrapper: vi.fn(),
}));

vi.mock("@cashu/cashu-ts", () => ({
  CheckStateEnum: { UNSPENT: "UNSPENT", SPENT: "SPENT" },
  Wallet: vi.fn(),
  getEncodedToken: getEncodedTokenMock,
  hashToCurve: vi.fn(() => ({
    toHex: vi.fn(() => "Y"),
  })),
}));

describe("getWithdrawalDetailsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MINTURL", "https://cashu.cz");
  });

  test("returns history tokens grouped by mint", async () => {
    vi.mocked(queryWrapper).mockResolvedValue({
      rowCount: 3,
      rows: [
        {
          computed_amount: 30,
          mint_url: "https://mint-a.example/",
          proof: { amount: 10, secret: "secret-a-1" },
        },
        {
          computed_amount: 30,
          mint_url: "https://mint-b.example",
          proof: { amount: 5, secret: "secret-b-1" },
        },
        {
          computed_amount: 30,
          mint_url: "https://mint-a.example/",
          proof: { amount: 15, secret: "secret-a-2" },
        },
      ],
    } as any);
    getEncodedTokenMock
      .mockReturnValueOnce("cashuBmintA")
      .mockReturnValueOnce("cashuBmintB");

    const res = await supertest(app)
      .get("/api/v1/withdrawals/1")
      .set("authorization", "validHeader");

    expect(res.status).toBe(200);
    expect(getEncodedTokenMock).toHaveBeenNthCalledWith(1, {
      memo: "",
      mint: "https://mint-a.example",
      proofs: [
        { amount: 10, secret: "secret-a-1" },
        { amount: 15, secret: "secret-a-2" },
      ],
    });
    expect(getEncodedTokenMock).toHaveBeenNthCalledWith(2, {
      memo: "",
      mint: "https://mint-b.example",
      proofs: [{ amount: 5, secret: "secret-b-1" }],
    });
    expect(res.body).toEqual({
      error: false,
      data: {
        amount: 30,
        tokens: [
          {
            mintUrl: "https://mint-a.example",
            token: "cashuBmintA",
            proofs: [
              { amount: 10, secret: "secret-a-1" },
              { amount: 15, secret: "secret-a-2" },
            ],
          },
          {
            mintUrl: "https://mint-b.example",
            token: "cashuBmintB",
            proofs: [{ amount: 5, secret: "secret-b-1" }],
          },
        ],
      },
    });
  });

  test("keeps the legacy single-token fields for one mint", async () => {
    vi.mocked(queryWrapper).mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          computed_amount: 21,
          mint_url: "https://cashu.cz",
          proof: { amount: 21, secret: "secret" },
        },
      ],
    } as any);
    getEncodedTokenMock.mockReturnValueOnce("cashuBsingle");

    const res = await supertest(app)
      .get("/api/v1/withdrawals/1")
      .set("authorization", "validHeader");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      error: false,
      data: {
        amount: 21,
        mintUrl: "https://cashu.cz",
        proofs: [{ amount: 21, secret: "secret" }],
        token: "cashuBsingle",
        tokens: [
          {
            mintUrl: "https://cashu.cz",
            token: "cashuBsingle",
            proofs: [{ amount: 21, secret: "secret" }],
          },
        ],
      },
    });
  });
});

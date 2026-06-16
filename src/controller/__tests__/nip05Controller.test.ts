import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { User } from "../../models";

vi.mock("../../models/user.ts");

const pubkey =
  "ca9881c70e72981b356353453f4bbfd8153d209acd9b7b5b4200e80c7dec8c7a";

describe("GET /.well-known/nostr.json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    process.env.NODE_ENV = "development";
  });

  it("returns an empty NIP-05 response without a name", async () => {
    const res = await request(app).get("/.well-known/nostr.json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ names: {}, relays: {} });
    expect(User.getUserByName).not.toHaveBeenCalled();
  });

  it("normalizes the requested name before lookup", async () => {
    vi.mocked(User.getUserByName, { partial: true }).mockResolvedValue({
      name: "hynek",
      pubkey,
    });

    const res = await request(app)
      .get("/.well-known/nostr.json")
      .query({ name: " Hynek " });

    expect(User.getUserByName).toHaveBeenCalledWith("hynek");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      names: { hynek: pubkey },
      relays: {},
    });
  });

  it("returns an empty response for invalid names", async () => {
    const res = await request(app)
      .get("/.well-known/nostr.json")
      .query({ name: "npub1234" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ names: {}, relays: {} });
    expect(User.getUserByName).not.toHaveBeenCalled();
  });

  it("includes configured NIP-05 relays keyed by pubkey", async () => {
    vi.stubEnv(
      "NIP05_RELAYS",
      "wss://relay.linky.fit, https://ignored.test, wss://relay.linky.fit, ws://localhost:7777",
    );
    vi.mocked(User.getUserByName, { partial: true }).mockResolvedValue({
      name: "hynek",
      pubkey,
    });

    const res = await request(app)
      .get("/.well-known/nostr.json")
      .query({ name: "hynek" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      names: { hynek: pubkey },
      relays: {
        [pubkey]: ["wss://relay.linky.fit", "ws://localhost:7777"],
      },
    });
  });

  it("returns an empty response when the user is not found", async () => {
    vi.mocked(User.getUserByName).mockResolvedValue(undefined);

    const res = await request(app)
      .get("/.well-known/nostr.json")
      .query({ name: "missing" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ names: {}, relays: {} });
  });
});

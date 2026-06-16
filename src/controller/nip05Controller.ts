import { Request, Response } from "express";
import { User } from "../models";
import { usernameRegex } from "../constants/regex";

const parseNip05Relays = (pubkey: string): Record<string, string[]> => {
  const rawRelays = String(process.env.NIP05_RELAYS ?? "").trim();
  if (!rawRelays) return {};

  const relays = rawRelays
    .split(",")
    .map((relay) => relay.trim())
    .filter((relay, index, allRelays) => {
      if (!(relay.startsWith("wss://") || relay.startsWith("ws://"))) {
        return false;
      }
      return allRelays.indexOf(relay) === index;
    });

  return relays.length > 0 ? { [pubkey]: relays } : {};
};

export async function nip05Controller(
  req: Request<unknown, unknown, unknown, { name?: string }>,
  res: Response,
) {
  const name = String(req.query.name ?? "")
    .trim()
    .toLowerCase();
  if (!name) {
    return res.json({ names: {}, relays: {} });
  }
  if (!name.match(usernameRegex) || name.length < 3) {
    return res.json({ names: {}, relays: {} });
  }
  try {
    const user = await User.getUserByName(name);
    if (!user) {
      return res.json({ names: {}, relays: {} });
    }
    return res.json({
      names: { [user.name]: user.pubkey },
      relays: parseNip05Relays(user.pubkey),
    });
  } catch {
    res.json({ error: true, message: "Failed to check nostr.json" });
  }
}

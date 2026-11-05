import { RequestHandler, Router } from "express";
import { lnurlController } from "./controller/lnurlController";
import { paidController } from "./controller/paidController";
import {
  balanceController,
  claimGetController,
} from "./controller/claimController";
import {
  getInfoController,
  putMintInfoController,
  putUsernameInfoController,
} from "./controller/infoController";
import { isAuthMiddleware } from "./middleware/auth";
import { nip05Controller } from "./controller/nip05Controller";
import {
  getLatestWithdrawalsController,
  getWithdrawalDetailsController,
} from "./controller/withdrawalController";

const routes = Router();

// Express 4 ignores rejected promises from async handlers, which crashes Node.
const forwardErrors =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

function route(
  method: "get" | "put" | "post",
  path: string,
  ...handlers: RequestHandler[]
) {
  routes[method](path, ...handlers.map(forwardErrors));
}

route("get", "/.well-known/lnurlp/:user", lnurlController);
route("get", "/.well-known/nostr.json", nip05Controller);

route(
  "get",
  "/api/v1/info",
  isAuthMiddleware(`/api/v1/info`, "GET"),
  getInfoController,
);
route(
  "put",
  "/api/v1/info/mint",
  isAuthMiddleware(`/api/v1/info/mint`, "PUT"),
  putMintInfoController,
);
route(
  "put",
  "/api/v1/info/username",
  isAuthMiddleware(`/api/v1/info/username`, "PUT"),
  putUsernameInfoController,
);
route("post", "/api/v1/paid", paidController);
route(
  "get",
  "/api/v1/claim",
  isAuthMiddleware("/api/v1/claim", "GET"),
  claimGetController,
);
route(
  "get",
  "/api/v1/balance",
  isAuthMiddleware("/api/v1/balance", "GET"),
  balanceController,
);
route(
  "get",
  "/api/v1/withdrawals",
  isAuthMiddleware("/api/v1/withdrawals", "GET"),
  getLatestWithdrawalsController,
);

route(
  "get",
  "/api/v1/withdrawals/:id",
  isAuthMiddleware("/api/v1/withdrawals/:id", "GET"),
  getWithdrawalDetailsController,
);

export default routes;

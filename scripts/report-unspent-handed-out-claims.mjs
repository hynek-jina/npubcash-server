// Read-only. Lists handed-out claims whose proofs the mint still reports UNSPENT, per user and mint.
// Run with the server's PG* and MINTURL env: node scripts/report-unspent-handed-out-claims.mjs
import { CheckStateEnum, Mint, hashToCurve } from "@cashu/cashu-ts";
import pg from "pg";

const pool = new pg.Pool();
const { rows } = await pool.query(
  `SELECT id, "user", mint_url, proof FROM l_claims_3 WHERE status IN ('spent', 'inflight') ORDER BY id`,
);
await pool.end();

const rowsByMint = Map.groupBy(rows, (row) =>
  (row.mint_url || process.env.MINTURL).replace(/\/+$/, ""),
);
const report = new Map();

for (const [mintUrl, mintRows] of rowsByMint) {
  const mint = new Mint(mintUrl);
  for (let i = 0; i < mintRows.length; i += 100) {
    const batch = mintRows.slice(i, i + 100);
    try {
      const { states } = await mint.check({
        Ys: batch.map((row) =>
          hashToCurve(new TextEncoder().encode(row.proof.secret)).toHex(true),
        ),
      });
      batch.forEach((row, index) => {
        if (states[index]?.state !== CheckStateEnum.UNSPENT) return;
        const key = `${row.user}\t${mintUrl}`;
        const entry = report.get(key) ?? { proofs: 0, amount: 0, ids: [] };
        entry.proofs += 1;
        entry.amount += Number(row.proof.amount);
        entry.ids.push(row.id);
        report.set(key, entry);
      });
    } catch (error) {
      console.error(
        `${mintUrl}: check failed for ids ${batch[0].id}..${batch.at(-1).id}`,
        error,
      );
    }
  }
}

console.log("user\tmint\tproofs\tamount\tclaim ids");
for (const [key, { proofs, amount, ids }] of report) {
  console.log(`${key}\t${proofs}\t${amount}\t${ids.join(",")}`);
}

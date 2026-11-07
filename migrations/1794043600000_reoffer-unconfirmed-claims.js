/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.addColumn("l_claims_3", {
    handed_out_at: { type: "timestamp with time zone" },
  });
  // Handouts used to mark rows spent before the wallet had them; only the mint's SPENT state proves delivery.
  pgm.sql(`UPDATE l_claims_3 SET status = 'inflight' WHERE status = 'spent'`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.sql(`UPDATE l_claims_3 SET status = 'spent' WHERE status = 'inflight'`);
  pgm.dropColumn("l_claims_3", "handed_out_at");
};

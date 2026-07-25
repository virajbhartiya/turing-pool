CREATE VIEW turing_activity_mix AS
SELECT
  count(*) AS fills,
  count(*) FILTER (WHERE tight) AS tight_fills,
  count(*) FILTER (WHERE NOT tight) AS wide_fills,
  coalesce(sum(amount_in_dec) FILTER (WHERE tight), 0) AS tight_volume,
  coalesce(sum(amount_in_dec) FILTER (WHERE NOT tight), 0) AS wide_volume,
  coalesce(
    round(
      10000 * sum(amount_in_dec) FILTER (WHERE tight)
      / nullif(sum(amount_in_dec), 0)
    ),
    0
  ) AS human_share_bps,
  max(block_number) AS indexed_trade_block
FROM turing_all_trades;

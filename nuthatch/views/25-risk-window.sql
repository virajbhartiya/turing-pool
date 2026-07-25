CREATE VIEW turing_risk_window AS
WITH ranked AS (
  SELECT
    *,
    row_number() OVER (
      ORDER BY block_number DESC, log_index DESC
    ) AS recency_rank,
    CASE
      WHEN lower(token_in) = lower('0xb68A4fa68E967e107BDEDD3A8C990D3cF110Fb52')
        THEN amount_in_dec
      ELSE amount_out_dec
    END AS token0_volume,
    CASE
      WHEN lower(token_in) = lower('0xb68A4fa68E967e107BDEDD3A8C990D3cF110Fb52')
        THEN amount_out_dec / nullif(amount_in_dec, 0)
      ELSE amount_in_dec / nullif(amount_out_dec, 0)
    END AS execution_price
  FROM turing_all_trades
),
windowed AS (
  SELECT *
  FROM ranked
  WHERE recency_rank <= 50
)
SELECT
  count(*) AS fills,
  count(*) FILTER (WHERE tight) AS tight_fills,
  count(*) FILTER (WHERE NOT tight) AS wide_fills,
  coalesce(sum(token0_volume) FILTER (WHERE tight), 0) AS tight_volume_token0,
  coalesce(sum(token0_volume) FILTER (WHERE NOT tight), 0) AS wide_volume_token0,
  coalesce(
    round(
      10000 * sum(token0_volume) FILTER (WHERE tight)
      / nullif(sum(token0_volume), 0)
    ),
    0
  ) AS tight_share_bps,
  coalesce(avg(fee_bps) FILTER (WHERE tight), 0) AS avg_tight_fee_bps,
  coalesce(avg(fee_bps) FILTER (WHERE NOT tight), 0) AS avg_wide_fee_bps,
  coalesce(avg(execution_price) FILTER (WHERE tight), 0) AS avg_tight_price,
  coalesce(avg(execution_price) FILTER (WHERE NOT tight), 0) AS avg_wide_price,
  max(block_number) AS indexed_trade_block,
  min(block_number) AS window_start_block
FROM windowed;

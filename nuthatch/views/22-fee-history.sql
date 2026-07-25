CREATE VIEW turing_fee_history AS
WITH fee_events AS (
  SELECT
    'primary' AS pool,
    0 AS source_priority,
    block_number,
    block_timestamp,
    tx_hash,
    log_index,
    token,
    "tightFeeBps" AS tight_fee_bps,
    "wideFeeBps" AS wide_fee_bps,
    "tightVolume" AS tight_volume,
    "wideVolume" AS wide_volume,
    "humanShareBps" AS human_share_bps
  FROM quota__fee_schedule_updated
  UNION ALL
  SELECT
    'vault' AS pool,
    1 AS source_priority,
    block_number,
    block_timestamp,
    tx_hash,
    log_index,
    token,
    "tightFeeBps" AS tight_fee_bps,
    "wideFeeBps" AS wide_fee_bps,
    "tightVolume" AS tight_volume,
    "wideVolume" AS wide_volume,
    "humanShareBps" AS human_share_bps
  FROM vault_quota__fee_schedule_updated
),
ranked AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY lower(tx_hash), log_index, lower(token)
      ORDER BY source_priority DESC
    ) AS duplicate_rank
  FROM fee_events
)
SELECT
  pool,
  block_number,
  block_timestamp,
  tx_hash,
  log_index,
  token,
  tight_fee_bps,
  wide_fee_bps,
  tight_volume,
  wide_volume,
  human_share_bps
FROM ranked
WHERE duplicate_rank = 1;

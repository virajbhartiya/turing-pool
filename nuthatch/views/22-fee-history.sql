CREATE VIEW turing_fee_history AS
SELECT
  'vault' AS pool,
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
FROM vault_quota__fee_schedule_updated;

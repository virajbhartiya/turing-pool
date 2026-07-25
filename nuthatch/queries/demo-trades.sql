SELECT
  block_number,
  tx_hash,
  pool,
  CASE WHEN tight THEN 'HUMAN · TIGHT' ELSE 'BOT · WIDE' END AS lane,
  round(amount_in_dec / 1e18, 2) AS amount_in_teth,
  round(amount_out_dec / 1e18, 2) AS amount_out_tusd,
  fee_bps,
  CASE WHEN human_id = '0' THEN 'anonymous' ELSE 'World verified' END AS identity
FROM turing_all_trades
ORDER BY block_number DESC, log_index DESC
LIMIT 10;

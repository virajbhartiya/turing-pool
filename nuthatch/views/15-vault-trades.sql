CREATE VIEW turing_vault_trades AS
SELECT
  fill.block_number,
  fill.block_timestamp,
  fill.tx_hash,
  fill.log_index,
  fill."orderHash" AS order_hash,
  fill.maker,
  fill.taker,
  gate."humanId" AS human_id,
  gate.tight,
  fill."tokenIn" AS token_in,
  fill."tokenOut" AS token_out,
  fill."amountIn" AS amount_in,
  fill."amountIn_dec" AS amount_in_dec,
  fill."amountOut" AS amount_out,
  fill."amountOut_dec" AS amount_out_dec,
  CAST(gate."feeE9_dec" / 100000 AS BIGINT) AS fee_bps
FROM vault_router__swapped AS fill
JOIN vault_router__human_gated AS gate
  ON fill.tx_hash = gate.tx_hash
 AND lower(fill."orderHash") = lower(gate."orderHash");

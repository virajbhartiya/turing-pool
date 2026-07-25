CREATE VIEW turing_all_trades AS
SELECT 'primary' AS pool, * FROM turing_trades
UNION ALL
SELECT 'vault' AS pool, * FROM turing_vault_trades;

-- statusの実際の値とバイト数を確認
SELECT DISTINCT status, octet_length(status) as bytes, length(status) as chars,
  encode(status::bytea, 'hex') as hex_value
FROM staff;

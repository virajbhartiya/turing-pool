import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the copy-paste Nuthatch demo query contains SQL literals, not shell escapes', async () => {
  const query = await readFile(
    new URL('../../nuthatch/queries/demo-trades.sql', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(
    query,
    /\\'/,
    'checked-in SQL must use direct single-quoted literals; shell escaping is not valid SQL',
  );
  assert.match(query, /THEN 'HUMAN · TIGHT'/);
  assert.match(query, /human_id = '0'/);
});

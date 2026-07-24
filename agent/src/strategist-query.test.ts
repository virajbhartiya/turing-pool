import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSchema, parse, validate } from 'graphql';

import { requireStrategistGraphData, STRATEGIST_QUERY } from './strategist-query.js';

const here = dirname(fileURLToPath(import.meta.url));
const graphRuntimeSchema = `
  scalar Bytes
  scalar BigInt
  directive @entity(immutable: Boolean) on OBJECT
  directive @derivedFrom(field: String!) on FIELD_DEFINITION
  enum OrderDirection { asc desc }
  enum Swap_orderBy { blockNumber }
  enum Strategy_orderBy { shippedAtBlock }
  input Strategy_filter { active: Boolean, app: Bytes }
  type Query {
    swaps(first: Int, orderBy: Swap_orderBy, orderDirection: OrderDirection): [Swap!]!
    strategies(
      first: Int
      orderBy: Strategy_orderBy
      orderDirection: OrderDirection
      where: Strategy_filter
    ): [Strategy!]!
  }
`;
const schema = buildSchema(
  graphRuntimeSchema + readFileSync(resolve(here, '../../subgraph/schema.graphql'), 'utf8'),
);

test('the strategist query is valid against the shipped subgraph schema', () => {
  const errors = validate(schema, parse(STRATEGIST_QUERY));
  assert.deepEqual(
    errors.map((error) => error.message),
    [],
  );
});

test('the strategist selects the active strategy for the configured app', () => {
  assert.match(STRATEGIST_QUERY, /query\s+StrategistInput\s*\(\s*\$app:\s*Bytes!\s*\)/);
  assert.match(STRATEGIST_QUERY, /strategies\s*\([^)]*where:\s*\{[^}]*app:\s*\$app/s);
});

test('GraphQL errors fail loudly', () => {
  assert.throws(
    () => requireStrategistGraphData({ errors: [{ message: 'indexer unavailable' }] }),
    /The Graph query failed: indexer unavailable/,
  );
});

test('a missing app strategy fails loudly', () => {
  assert.throws(
    () => requireStrategistGraphData({ data: { swaps: [], strategies: [] } }),
    /no active strategy for the configured app/,
  );
});

test('valid Graph data is accepted', () => {
  const data = {
    swaps: [],
    strategies: [{ balance0: '1000000000000000000', balance1: '2000000000000000000' }],
  };
  assert.equal(requireStrategistGraphData({ data }), data);
});

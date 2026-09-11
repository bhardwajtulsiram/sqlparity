import { describe, it, expect } from 'vitest';
import { checkFieldsAgainstSchema, type ListedField } from '../lib/schema-check';
import type { DdlColumn } from '../lib/ddl';

const col = (name: string, type: string): DdlColumn => ({ name, type, line: 0 });

const SCHEMA: DdlColumn[] = [
  col('customer_id', 'string'),
  col('customer_segment', 'varchar(50)'),
  col('order_count', 'bigint'),
  col('last_order_at', 'timestamp'),
  col('amount', 'decimal(38,9)'),
];

const field = (name: string, type?: string): ListedField => ({ name, type });

describe('a list that matches the schema', () => {
  it('is clean', () => {
    const result = checkFieldsAgainstSchema(
      [field('customer_id', 'string'), field('order_count', 'bigint')],
      SCHEMA,
    );
    expect(result.clean).toBe(true);
    expect(result.unknown).toEqual([]);
    expect(result.typeMismatches).toEqual([]);
    expect(result.matched).toBe(2);
  });

  it('matches names case-insensitively, as unquoted SQL identifiers do', () => {
    const result = checkFieldsAgainstSchema([field('Customer_ID', 'string')], SCHEMA);
    expect(result.unknown).toEqual([]);
    expect(result.matched).toBe(1);
  });

  it('tolerates surrounding whitespace on either side', () => {
    const result = checkFieldsAgainstSchema([field('  order_count  ', ' bigint ')], SCHEMA);
    expect(result.clean).toBe(true);
    expect(result.matched).toBe(1);
  });
});

describe('unknown fields', () => {
  it('flags a field that is not in the schema at all', () => {
    const result = checkFieldsAgainstSchema(
      [field('customer_id', 'string'), field('custmer_segment', 'varchar')],
      SCHEMA,
    );
    expect(result.unknown).toEqual(['custmer_segment']);
    expect(result.clean).toBe(false);
  });

  it('reports the name as the user wrote it, not lowercased', () => {
    const result = checkFieldsAgainstSchema([field('TotallyMadeUp')], SCHEMA);
    expect(result.unknown).toEqual(['TotallyMadeUp']);
  });

  it('flags several at once', () => {
    const result = checkFieldsAgainstSchema([field('a'), field('b'), field('customer_id')], SCHEMA);
    expect(result.unknown).toEqual(['a', 'b']);
    expect(result.matched).toBe(1);
  });
});

describe('type mismatches', () => {
  it('flags a genuinely different type', () => {
    const result = checkFieldsAgainstSchema([field('order_count', 'varchar')], SCHEMA);
    expect(result.typeMismatches).toEqual([
      { name: 'order_count', listed: 'varchar', actual: 'bigint' },
    ]);
    expect(result.clean).toBe(false);
  });

  it('does not flag a precision-only difference, which generates identical SQL', () => {
    // varchar(50) and varchar(200) both resolve to the same sentinel, so interrupting
    // over the difference would be noise.
    const result = checkFieldsAgainstSchema([field('customer_segment', 'varchar(200)')], SCHEMA);
    expect(result.typeMismatches).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it('does not flag a decimal scale change for the same reason', () => {
    const result = checkFieldsAgainstSchema([field('amount', 'decimal(10,2)')], SCHEMA);
    expect(result.typeMismatches).toEqual([]);
  });

  it('ignores case differences in the type', () => {
    const result = checkFieldsAgainstSchema([field('order_count', 'BIGINT')], SCHEMA);
    expect(result.typeMismatches).toEqual([]);
  });

  it('does not flag a type conflict for a names-only list', () => {
    const result = checkFieldsAgainstSchema([field('order_count')], SCHEMA);
    expect(result.typeMismatches).toEqual([]);
    expect(result.matched).toBe(1);
  });

  it('counts a mismatched field as neither matched nor unknown', () => {
    const result = checkFieldsAgainstSchema([field('order_count', 'varchar')], SCHEMA);
    expect(result.matched).toBe(0);
    expect(result.unknown).toEqual([]);
  });
});

describe('coverage', () => {
  it('lists schema columns the field list does not mention', () => {
    const result = checkFieldsAgainstSchema([field('customer_id', 'string')], SCHEMA);
    expect(result.uncovered).toEqual([
      'customer_segment',
      'order_count',
      'last_order_at',
      'amount',
    ]);
  });

  it('reports nothing uncovered when the list is exhaustive', () => {
    const all = SCHEMA.map((c) => field(c.name, c.type));
    const result = checkFieldsAgainstSchema(all, SCHEMA);
    expect(result.uncovered).toEqual([]);
    expect(result.clean).toBe(true);
    expect(result.matched).toBe(SCHEMA.length);
  });

  it('does not treat uncovered columns as making the result unclean', () => {
    // Checking a deliberate subset is a normal thing to do.
    const result = checkFieldsAgainstSchema([field('customer_id', 'string')], SCHEMA);
    expect(result.clean).toBe(true);
    expect(result.uncovered.length).toBeGreaterThan(0);
  });
});

describe('edge cases', () => {
  it('returns a clean empty result when there is no field list', () => {
    const result = checkFieldsAgainstSchema([], SCHEMA);
    expect(result.clean).toBe(true);
    expect(result.unknown).toEqual([]);
    expect(result.uncovered).toEqual([]);
  });

  it('returns a clean empty result when there is no schema', () => {
    const result = checkFieldsAgainstSchema([field('anything')], []);
    expect(result.clean).toBe(true);
    expect(result.unknown).toEqual([]);
  });

  it('skips blank field names rather than reporting them as unknown', () => {
    const result = checkFieldsAgainstSchema([field(''), field('   '), field('customer_id')], SCHEMA);
    expect(result.unknown).toEqual([]);
    expect(result.matched).toBe(1);
  });

  it('handles a duplicated field without double-counting coverage', () => {
    const result = checkFieldsAgainstSchema(
      [field('customer_id', 'string'), field('customer_id', 'string')],
      SCHEMA,
    );
    expect(result.unknown).toEqual([]);
    expect(result.uncovered).not.toContain('customer_id');
  });
});

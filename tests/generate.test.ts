import { describe, it, expect } from 'vitest';
import { getDialect } from '../lib/dialects';
import {
  extractPlaceholders,
  markVariable,
  applyBindings,
  generate,
  parseGrid,
  TYPE_COLUMN,
  type GenerateInput,
  type Variable,
} from '../lib/generate';
import { defaultTypeMap, normalizeType, resolveType, effectiveTypeMap } from '../lib/typemap';

const trino = getDialect('athena');
const mysql = getDialect('mysql');

const TEMPLATE = `SELECT
  a.customer_id,
  a.{{field}},
  b.{{field}}
FROM {{table_a}} a, {{table_b}} b
WHERE a.customer_id = b.customer_id
  AND coalesce(a.{{field}}, {{null_default}}) <> coalesce(b.{{field}}, {{null_default}})
LIMIT 10`;

const VARIABLES: Variable[] = [
  { name: 'field', kind: 'bulk', value: '' },
  { name: 'null_default', kind: 'typed', value: '' },
  { name: 'table_a', kind: 'constant', value: 'input_db' },
  { name: 'table_b', kind: 'constant', value: 'output_db' },
];

const input = (overrides: Partial<GenerateInput> = {}): GenerateInput => ({
  template: TEMPLATE,
  variables: VARIABLES,
  dialect: trino,
  typeMap: defaultTypeMap(trino),
  mode: 'rowwise',
  columns: ['field', TYPE_COLUMN],
  rows: [
    ['customer_segment', 'varchar'],
    ['order_count', 'bigint'],
    ['last_seen_at', 'timestamp'],
  ],
  lists: {},
  ...overrides,
});

describe('placeholders', () => {
  it('finds each distinct name once, in order', () => {
    expect(extractPlaceholders(TEMPLATE)).toEqual([
      'field',
      'table_a',
      'table_b',
      'null_default',
    ]);
  });

  it('tolerates internal whitespace', () => {
    expect(extractPlaceholders('SELECT {{ a }}, {{b}}')).toEqual(['a', 'b']);
  });

  it('leaves unknown placeholders in place when binding', () => {
    expect(applyBindings('{{a}} {{b}}', { a: '1' })).toBe('1 {{b}}');
  });
});

describe('marking a variable from a highlighted token', () => {
  const column = 'customer_segment';

  it('replaces every whole-token occurrence', () => {
    const sql = `SELECT a.${column}, b.${column} FROM t`;
    expect(markVariable(sql, column, 'field', trino)).toBe(
      'SELECT a.{{field}}, b.{{field}} FROM t',
    );
  });

  it('does not touch a longer column that contains the token', () => {
    const sql = `SELECT ${column}, ${column}_range FROM t`;
    expect(markVariable(sql, column, 'field', trino)).toBe(
      `SELECT {{field}}, ${column}_range FROM t`,
    );
  });
});

describe('type map', () => {
  it('normalises away precision and case', () => {
    expect(normalizeType('VARCHAR(50)')).toBe('varchar');
    expect(normalizeType('  decimal(38, 9) ')).toBe('decimal');
    expect(normalizeType('DOUBLE PRECISION')).toBe('double precision');
  });

  it('gives dialect-appropriate date syntax', () => {
    expect(resolveType('date', defaultTypeMap(trino)).value).toBe("DATE '1900-01-01'");
    expect(resolveType('date', defaultTypeMap(mysql)).value).toBe("'1900-01-01'");
  });

  it('gives dialect-appropriate booleans', () => {
    expect(resolveType('boolean', defaultTypeMap(trino)).value).toBe('false');
    expect(resolveType('boolean', defaultTypeMap(mysql)).value).toBe('0');
  });

  it('reports a missing type rather than guessing', () => {
    expect(resolveType('geography', defaultTypeMap(trino)).missing).toBe('geography');
    expect(resolveType('', defaultTypeMap(trino)).missing).toBe('(blank)');
  });

  it('layers template overrides on top of global overrides', () => {
    const map = effectiveTypeMap(trino, { varchar: "'GLOBAL'" }, { varchar: "'TEMPLATE'" });
    expect(map.varchar).toBe("'TEMPLATE'");
    expect(map.bigint).toBe('-1');
  });
});

describe('row-wise generation', () => {
  it('produces one query per row', () => {
    const result = generate(input());
    expect(result.blocked).toBe(false);
    expect(result.queries).toHaveLength(3);
    expect(result.queries[0]!.index).toBe(1);
    expect(result.queries[0]!.label).toBe('customer_segment');
  });

  it('substitutes the bulk variable everywhere it appears', () => {
    const sql = generate(input()).queries[0]!.sql;
    expect(sql).toContain('a.customer_segment');
    expect(sql).toContain('b.customer_segment');
    expect(sql).not.toContain('{{');
  });

  it('substitutes constants once for every row', () => {
    for (const query of generate(input()).queries) {
      expect(query.sql).toContain('FROM input_db a, output_db b');
    }
  });

  it('resolves the typed variable from each row data type', () => {
    const queries = generate(input()).queries;
    expect(queries[0]!.sql).toContain("coalesce(a.customer_segment, '~')");
    expect(queries[1]!.sql).toContain('coalesce(a.order_count, -1)');
    expect(queries[2]!.sql).toContain("coalesce(a.last_seen_at, TIMESTAMP '1900-01-01 00:00:00')");
  });

  it('uses MySQL syntax for the same rows when the dialect changes', () => {
    const queries = generate(
      input({ dialect: mysql, typeMap: defaultTypeMap(mysql) }),
    ).queries;
    expect(queries[2]!.sql).toContain("coalesce(a.last_seen_at, '1900-01-01 00:00:00')");
  });

  it('skips entirely blank rows', () => {
    const result = generate(
      input({ rows: [['a', 'varchar'], ['', ''], ['b', 'varchar']] }),
    );
    expect(result.queries).toHaveLength(2);
  });

  it('handles a single column with no typed variable', () => {
    const result = generate(
      input({
        template: 'SELECT count(*) FROM t WHERE {{field}} IS NULL',
        variables: [{ name: 'field', kind: 'bulk', value: '' }],
        columns: ['field'],
        rows: [['a'], ['b']],
      }),
    );
    expect(result.queries.map((q) => q.sql)).toEqual([
      'SELECT count(*) FROM t WHERE a IS NULL',
      'SELECT count(*) FROM t WHERE b IS NULL',
    ]);
  });
});

describe('blocking problems', () => {
  it('blocks on an unknown data type rather than guessing a sentinel', () => {
    const result = generate(input({ rows: [['geo_col', 'geography']] }));
    expect(result.blocked).toBe(true);
    expect(result.queries).toHaveLength(0);
    expect(
      result.problems.some(
        (p) => /no type-map entry/.test(p.message) && /"geography" \(geo_col\)/.test(p.message),
      ),
    ).toBe(true);
  });

  it('names every missing type at once', () => {
    const result = generate(
      input({ rows: [['a', 'geography'], ['b', 'hllsketch']] }),
    );
    expect(
      result.problems.some((p) => /"geography" \(a\); "hllsketch" \(b\)/.test(p.message)),
    ).toBe(true);
  });

  it('skips only the columns it has no sentinel for, and says which', () => {
    const result = generate(
      input({
        rows: [
          ['customer_segment', 'varchar'],
          ['tags', 'array<string>'],
          ['n', 'bigint'],
        ],
      }),
    );
    expect(result.blocked).toBe(false);
    expect(result.queries.map((q) => q.label)).toEqual(['customer_segment', 'n']);
    const warning = result.problems.find(
      (p) => p.level === 'warn' && /Skipped 1 column/.test(p.message),
    );
    expect(warning?.message).toContain('"array" (tags)');
    expect(warning?.message).toContain('null-safe');
  });

  it('blocks when the template uses an undefined variable', () => {
    const result = generate(input({ template: 'SELECT {{nope}}' }));
    expect(result.blocked).toBe(true);
    expect(result.problems.some((p) => /no variable named "nope"/.test(p.message))).toBe(true);
  });

  it('blocks when a typed variable has no data-type column', () => {
    const result = generate(input({ columns: ['field'], rows: [['a']] }));
    expect(result.blocked).toBe(true);
    expect(result.problems.some((p) => /no column is marked as the data type/.test(p.message))).toBe(
      true,
    );
  });

  it('warns about an unused variable without blocking', () => {
    const result = generate(
      input({
        template: 'SELECT {{field}} FROM t',
        variables: [
          { name: 'field', kind: 'bulk', value: '' },
          { name: 'spare', kind: 'constant', value: 'x' },
        ],
        columns: ['field'],
        rows: [['a']],
      }),
    );
    expect(result.blocked).toBe(false);
    expect(
      result.problems.some((p) => p.level === 'warn' && /not used in the template/.test(p.message)),
    ).toBe(true);
  });
});

describe('cartesian mode', () => {
  it('produces every combination', () => {
    const result = generate(
      input({
        mode: 'cartesian',
        template: 'SELECT {{field}} FROM {{table}}',
        variables: [
          { name: 'field', kind: 'bulk', value: '' },
          { name: 'table', kind: 'bulk', value: '' },
        ],
        lists: { field: ['a', 'b'], table: ['t1', 't2', 't3'] },
        rows: [],
        columns: [],
      }),
    );
    expect(result.queries).toHaveLength(6);
    expect(result.queries.map((q) => q.sql)).toContain('SELECT a FROM t2');
    expect(result.queries.map((q) => q.sql)).toContain('SELECT b FROM t3');
  });
});

describe('grid parsing', () => {
  it('splits a tab-separated paste', () => {
    expect(parseGrid('a\tvarchar\nb\tbigint').rows).toEqual([
      ['a', 'varchar'],
      ['b', 'bigint'],
    ]);
  });

  it('splits a comma-separated paste', () => {
    expect(parseGrid('a,varchar\nb,bigint').columnCount).toBe(2);
  });

  it('treats a plain list as one column', () => {
    expect(parseGrid('a\nb\nc')).toEqual({
      rows: [['a'], ['b'], ['c']],
      columnCount: 1,
    });
  });

  it('ignores trailing blank lines', () => {
    expect(parseGrid('a\nb\n\n').rows).toHaveLength(2);
  });

  it('returns nothing for empty input', () => {
    expect(parseGrid('   ')).toEqual({ rows: [], columnCount: 0 });
  });
});

describe('unused-variable reporting', () => {
  it('collapses to a single warning when nothing is used', () => {
    const result = generate(
      input({
        template: 'CREATE EXTERNAL TABLE t (a string, b bigint)',
        columns: ['field', TYPE_COLUMN],
      }),
    );
    const warnings = result.problems.filter((p) => p.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/uses none of the variables/);
  });

  it('lists only the unused ones when some are used', () => {
    const result = generate(
      input({
        template: 'SELECT {{field}} FROM t',
        variables: [
          { name: 'field', kind: 'bulk', value: '' },
          { name: 'spare_a', kind: 'constant', value: 'x' },
          { name: 'spare_b', kind: 'constant', value: 'y' },
        ],
        columns: ['field'],
        rows: [['a']],
      }),
    );
    const warnings = result.problems.filter((p) => p.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('{{spare_a}}, {{spare_b}}');
    expect(warnings[0]!.message).not.toContain('{{field}}');
  });
});

describe('two bulk variables paired row by row', () => {
  it('compares a column that was renamed between the two tables', () => {
    // The input table calls it customer_segment; the output table calls it
    // cust_segment. Each row pairs the two names positionally.
    const result = generate(
      input({
        template:
          'SELECT a.{{in_field}} AS was, b.{{out_field}} AS now FROM t a JOIN u b ON a.id = b.id ' +
          'WHERE coalesce(a.{{in_field}}, {{null_default}}) <> coalesce(b.{{out_field}}, {{null_default}})',
        variables: [
          { name: 'in_field', kind: 'bulk', value: '' },
          { name: 'out_field', kind: 'bulk', value: '' },
          { name: 'null_default', kind: 'typed', value: '' },
        ],
        columns: ['in_field', 'out_field', TYPE_COLUMN],
        rows: [
          ['customer_segment', 'cust_segment', 'varchar'],
          ['order_count', 'total_orders', 'bigint'],
        ],
      }),
    );

    expect(result.blocked).toBe(false);
    expect(result.queries).toHaveLength(2);
    expect(result.queries[0]!.sql).toContain('a.customer_segment AS was');
    expect(result.queries[0]!.sql).toContain('b.cust_segment AS now');
    // The sentinel still comes from the third column, not from either name.
    expect(result.queries[0]!.sql).toContain("coalesce(a.customer_segment, '~')");
    expect(result.queries[1]!.sql).toContain('coalesce(b.total_orders, -1)');
  });

  it('does not cross rows over — each pair stays on its own row', () => {
    const result = generate(
      input({
        template: 'SELECT a.{{in_field}}, b.{{out_field}}',
        variables: [
          { name: 'in_field', kind: 'bulk', value: '' },
          { name: 'out_field', kind: 'bulk', value: '' },
        ],
        columns: ['in_field', 'out_field'],
        rows: [
          ['one_in', 'one_out'],
          ['two_in', 'two_out'],
        ],
      }),
    );
    expect(result.queries.map((q) => q.sql)).toEqual([
      'SELECT a.one_in, b.one_out',
      'SELECT a.two_in, b.two_out',
    ]);
  });
});

describe('the output-side variable on shipped presets', () => {
  it('every two-table comparison preset has its own output-side variable', async () => {
    const { PRESETS } = await import('../lib/presets');
    const twoTable = PRESETS.filter((p) => p.templates.default.includes('b.{{field_out}}'));
    expect(twoTable.length).toBeGreaterThan(0);
    for (const preset of twoTable) {
      const names = preset.variables.filter((v) => v.kind === 'bulk').map((v) => v.name);
      expect(names, preset.id).toContain('field');
      expect(names, preset.id).toContain('field_out');
    }
  });

  it('presets that touch only one table keep a single name variable', async () => {
    const { getPreset } = await import('../lib/presets');
    for (const id of ['column-exists', 'row-count']) {
      const preset = getPreset(id)!;
      const names = preset.variables.filter((v) => v.kind === 'bulk').map((v) => v.name);
      expect(names, id).not.toContain('field_out');
    }
  });

  it('generates the same name on both sides when the output name repeats the input', () => {
    // This is what an empty "Output column names" box produces: the caller passes the
    // input name through for the output column too.
    const result = generate(
      input({
        template: 'SELECT a.{{field}}, b.{{field_out}}',
        variables: [
          { name: 'field', kind: 'bulk', value: '' },
          { name: 'field_out', kind: 'bulk', value: '' },
        ],
        columns: ['field', 'field_out'],
        rows: [
          ['order_count', 'order_count'],
          ['segment', 'segment'],
        ],
      }),
    );
    expect(result.queries.map((q) => q.sql)).toEqual([
      'SELECT a.order_count, b.order_count',
      'SELECT a.segment, b.segment',
    ]);
  });

  it('generates different names when an output name is supplied', () => {
    const result = generate(
      input({
        template: 'SELECT a.{{field}}, b.{{field_out}}',
        variables: [
          { name: 'field', kind: 'bulk', value: '' },
          { name: 'field_out', kind: 'bulk', value: '' },
        ],
        columns: ['field', 'field_out'],
        rows: [['order_count', 'total_orders']],
      }),
    );
    expect(result.queries[0]!.sql).toBe('SELECT a.order_count, b.total_orders');
  });
});

describe('blank rows in the name list', () => {
  it('skips a row whose name is blank even when its type is filled', () => {
    // A blank line left behind after deleting a column, paired with a leftover type.
    const result = generate(
      input({
        rows: [
          ['customer_segment', 'varchar'],
          ['', 'bigint'],
          ['order_count', 'bigint'],
        ],
      }),
    );
    expect(result.queries).toHaveLength(2);
    expect(result.queries.map((q) => q.label)).toEqual(['customer_segment', 'order_count']);
  });

  it('does not generate a query against a nameless column', () => {
    const result = generate(input({ rows: [['   ', 'varchar']] }));
    expect(result.queries).toHaveLength(0);
  });
});

describe('an output-side constant that falls back', () => {
  const withKeys = (keyOut: string) =>
    generate(
      input({
        template: 'SELECT 1 FROM {{table_a}} a JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}',
        variables: [
          { name: 'table_a', kind: 'constant', value: 'input_db' },
          { name: 'table_b', kind: 'constant', value: 'output_db' },
          { name: 'key', kind: 'constant', value: 'customer_id' },
          // The component resolves fallbacks before calling generate, so a blank
          // value arriving here has already been replaced.
          { name: 'key_out', kind: 'constant', value: keyOut, fallbackTo: 'key' },
          { name: 'field', kind: 'bulk', value: '' },
        ],
        columns: ['field'],
        rows: [['a_col']],
      }),
    );

  it('joins on the same key when the output key repeats the input', () => {
    expect(withKeys('customer_id').queries[0]!.sql).toBe(
      'SELECT 1 FROM input_db a JOIN output_db b ON a.customer_id = b.customer_id',
    );
  });

  it('joins on a different key when the output table names it differently', () => {
    expect(withKeys('cust_key').queries[0]!.sql).toBe(
      'SELECT 1 FROM input_db a JOIN output_db b ON a.customer_id = b.cust_key',
    );
  });
});

describe('shipped presets join on the output key', () => {
  it('every comparison preset declares key_out falling back to key', async () => {
    const { PRESETS } = await import('../lib/presets');
    const joining = PRESETS.filter(
      (p) =>
        p.templates.default.includes('b.{{key_out}}') ||
        Object.values(p.combine ?? {}).some((c) => c.footer.includes('b.{{key_out}}')),
    );
    expect(joining.length).toBeGreaterThan(0);
    for (const preset of joining) {
      const keyOut = preset.variables.find((v) => v.name === 'key_out');
      expect(keyOut, preset.id).toBeDefined();
      expect(keyOut!.fallbackTo, preset.id).toBe('key');
      expect(keyOut!.value, preset.id).toBe('');
    }
  });
})

describe('names that need quoting', () => {
  const nameVars: Variable[] = [
    { name: 'field', kind: 'bulk', value: '', identifier: true },
    { name: 'table_a', kind: 'constant', value: 'input_db' },
  ];
  const run = (dialectId: string, field: string) =>
    generate({
      template: "SELECT '{{field}}' AS field, a.{{field}} FROM {{table_a}} a",
      variables: nameVars,
      dialect: getDialect(dialectId),
      typeMap: defaultTypeMap(getDialect(dialectId)),
      mode: 'rowwise',
      columns: ['field'],
      rows: [[field]],
      lists: {},
    }).queries[0]!;

  it('leaves an ordinary name bare', () => {
    expect(run('trino', 'customer_id').sql).toBe(
      "SELECT 'customer_id' AS field, a.customer_id FROM input_db a",
    );
  });

  it('quotes a reserved word as a name, but not inside a string literal', () => {
    expect(run('trino', 'order').sql).toBe(`SELECT 'order' AS field, a."order" FROM input_db a`);
    expect(run('mysql', 'order').sql).toBe("SELECT 'order' AS field, a.`order` FROM input_db a");
  });

  it('folds a reserved word to the case the engine stores it in', () => {
    expect(run('snowflake', 'order').sql).toContain('a."ORDER"');
    expect(run('postgresql', 'ORDER').sql).toContain('a."order"');
  });

  it('quotes a name with spaces and escapes an apostrophe in the label', () => {
    expect(run('postgresql', "Owner's Name").sql).toBe(
      `SELECT 'Owner''s Name' AS field, a."Owner's Name" FROM input_db a`,
    );
  });

  it('keeps a name that was already quoted, and labels it without the quotes', () => {
    const query = run('postgresql', '"CustomerId"');
    expect(query.sql).toBe(`SELECT 'CustomerId' AS field, a."CustomerId" FROM input_db a`);
    expect(query.label).toBe('CustomerId');
  });

  it('trims stray spaces and carriage returns from pasted names', () => {
    expect(run('trino', '  customer_id \r').sql).toContain('a.customer_id FROM');
  });

  it('never quotes a value that is not a name', () => {
    const result = generate({
      template: 'SELECT * FROM t WHERE id = {{value}}',
      variables: [{ name: 'value', kind: 'bulk', value: '' }],
      dialect: trino,
      typeMap: defaultTypeMap(trino),
      mode: 'rowwise',
      columns: ['value'],
      rows: [['12345']],
      lists: {},
    });
    expect(result.queries[0]!.sql).toBe('SELECT * FROM t WHERE id = 12345');
  });
});

describe('declared types as the engines print them', () => {
  it('drops lengths and modifiers without gluing words together', () => {
    expect(normalizeType('timestamp(6) with time zone')).toBe('timestamp with time zone');
    expect(normalizeType('int(11) unsigned')).toBe('int');
    expect(normalizeType('Nullable(String)')).toBe('string');
    expect(normalizeType('LowCardinality(Nullable(String))')).toBe('string');
    expect(normalizeType('array<struct<a:int>>')).toBe('array');
    expect(normalizeType('text[]')).toBe('array');
  });

  it('has an entry for the types real schemas use', () => {
    const cases: [string, string[]][] = [
      ['postgresql', ['timestamptz', 'int4', 'int8', 'float8', 'bool', 'jsonb', 'uuid', 'bytea', 'serial']],
      ['mysql', ['int(11) unsigned', 'longtext', 'mediumtext', 'tinyint(1)', 'datetime(6)', "enum('a','b')", 'bit(1)']],
      ['transactsql', ['money', 'uniqueidentifier', 'datetimeoffset', 'smalldatetime', 'nvarchar(max)']],
      ['plsql', ['VARCHAR2(20 BYTE)', 'NVARCHAR2(50)', 'NUMBER(6,0)', 'RAW(16)', 'TIMESTAMP(6)']],
      ['snowflake', ['TIMESTAMP_NTZ(9)', 'TIMESTAMP_LTZ', 'NUMBER(38,0)', 'VARCHAR(16777216)']],
      ['bigquery', ['INT64', 'BIGNUMERIC', 'DATETIME', 'BYTES']],
      ['trino', ['timestamp(6) with time zone', 'varbinary', 'uuid', 'char(2)']],
      ['clickhouse', ['UInt64', 'Nullable(String)', 'LowCardinality(String)', 'DateTime', 'Date32', 'UUID']],
    ];
    for (const [dialectId, types] of cases) {
      const map = defaultTypeMap(getDialect(dialectId));
      for (const type of types) {
        expect(resolveType(type, map).missing, `${dialectId}: ${type}`).toBeUndefined();
      }
    }
  });

  it('marks collections as having no sentinel at all', () => {
    expect(resolveType('array<string>', defaultTypeMap(trino))).toMatchObject({
      missing: 'array',
      unsentinelable: true,
    });
  });
});

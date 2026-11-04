type BoundedQuery<Row> = {
  take(limit: number): Promise<Row[]>;
};

export async function readCompleteFixture<Row>({
  label,
  maxRows,
  query,
}: {
  label: string;
  maxRows: number;
  query: BoundedQuery<Row>;
}): Promise<Row[]> {
  const rows = await query.take(maxRows + 1);
  if (rows.length > maxRows) {
    throw new Error(
      `Test fixture overflow for ${label}: expected at most ${maxRows} rows`,
    );
  }
  return rows;
}

/**
 * B1, second part (2026-10-27): a test's draft row as it was always shaped,
 * its own text on it. Every row a test inserts with `content` is one.
 */
export function withStoredText<T extends { content?: string }>(row: T): T & { content: string } {
  if (row.content === undefined) throw new Error("Test fixture row holds no text of its own");
  return row as T & { content: string };
}

export function rowsWithStoredText<T extends { content?: string }>(rows: readonly T[]): Array<T & { content: string }> {
  return rows.map(withStoredText);
}

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

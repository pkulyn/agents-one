export interface ConsumedNativePage<T> {
  rows: T[];
  hasMore: boolean;
  nextOffset: number;
}

/** Runtime conversations are not passed here; only native cached rows paginate. */
export function consumeNativeSessionPage<T>(
  rowsWithLookahead: T[],
  currentOffset: number,
  pageSize: number,
): ConsumedNativePage<T> {
  const rows = rowsWithLookahead.slice(0, pageSize);
  return {
    rows,
    hasMore: rowsWithLookahead.length > pageSize,
    nextOffset: currentOffset + rows.length,
  };
}

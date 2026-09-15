export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface SqlConnection {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}
export interface Database extends SqlConnection {
  transaction<T>(run: (tx: SqlConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

import type { ReactNode } from 'react';

type Column = { key: string; label: string };
type ChartRow = { [key: string]: string | number | null | undefined };

/** A native, color-independent route to every value, including missing data. */
export default function ChartDataTable({ caption, columns, rows }: {
  caption: string;
  columns: Column[];
  rows: ChartRow[];
}) {
  if (!rows.length) return null;
  const format = (value: ChartRow[string]): ReactNode =>
    value === null || value === undefined ? 'No data' : typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <details className="stats-data-alternative mt-3">
      <summary>View data table: {caption}</summary>
      <div className="table-responsive" tabIndex={0} role="region" aria-label={`${caption} data`}>
        <table className="table table-sm mb-0">
          <caption>{caption}</caption>
          <thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={index}>{columns.map((column, columnIndex) => columnIndex === 0
              ? <th key={column.key} scope="row">{format(row[column.key])}</th>
              : <td key={column.key}>{format(row[column.key])}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

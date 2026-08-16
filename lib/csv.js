// Client-side CSV — plain text, no library needed, opens natively in every spreadsheet app. Used by
// components/ui.js's ReportToolbar so any table screen can export what it already has loaded.

function escapeCsvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// columns: [{ key, label }] — key reads (possibly nested via a dotted path) off each row, or a
// column can supply its own `value(row)` getter for computed cells.
export function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => escapeCsvCell(c.value ? c.value(row) : c.key.split('.').reduce((v, k) => v?.[k], row)))
      .join(',')
  );
  return [header, ...lines].join('\n');
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

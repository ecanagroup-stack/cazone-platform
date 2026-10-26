// Totals under the Summary Book: what came in, what sold, what it earned and the tolerance allowed, for
// the whole range and for each product. Only rows for a real product count (the "unconfirmed pump
// readings" row carries no figures). Litres are rounded to 3 places so float noise never reaches the page.
const round3 = (value) => Math.round(value * 1000) / 1000;
const blankTotals = () => ({ stockIn: 0, sales: 0, revenue: 0, tolerance: 0, shortage: 0 });

function add(totals, row) {
  totals.stockIn += row.stockIn || 0;
  totals.sales += row.sales || 0;
  totals.revenue += row.totalAmount || 0;
  totals.tolerance += row.tolerance || 0;
  totals.shortage += row.shortage || 0;
}

function finish(totals) {
  return { ...totals, stockIn: round3(totals.stockIn), sales: round3(totals.sales), tolerance: round3(totals.tolerance) };
}

export function summaryBookTotals(rows) {
  const overall = blankTotals();
  const byProduct = new Map();
  for (const row of rows) {
    if (!row.productId) continue;
    add(overall, row);
    const entry = byProduct.get(row.productId) || { product: row.product, ...blankTotals() };
    add(entry, row);
    byProduct.set(row.productId, entry);
  }
  return {
    overall: finish(overall),
    byProduct: [...byProduct.values()].map(({ product, ...totals }) => ({ product, ...finish(totals) }))
      .sort((a, b) => a.product.localeCompare(b.product)),
  };
}

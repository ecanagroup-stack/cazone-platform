import { effectiveDate } from './businessDates.mjs';

// An ATC's display reference, e.g. "DAN-001" (cement brand abbreviation + the ATC's own number).
// `allocation` is a Delivery with its product (abbreviation) loaded.
export function atcReference(allocation) {
  return [allocation?.product?.abbreviation, allocation?.atcNumber].filter(Boolean).join('-');
}

// Where a line's goods came from. Cement is identified by the ATC it was sold down, not by the
// supplier — rows recorded before the ATC reference was snapshotted hold the supplier's name in
// sourceName, so the allocation is read first. Aggregate keeps its quarry snapshot.
function lineSource(line) {
  return atcReference(line.allocation) || line.sourceName || line.allocation?.supplier?.name || line.product.supplier?.name || null;
}

export function salesReportLine(line) {
  return {
    id: line.id,
    product: line.product.name,
    unit: line.product.unit,
    qty: line.qty,
    stockQty: line.stockQty,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    transportFee: line.transportFee,
    costs: line.costs.map((cost) => ({ id: cost.id, type: cost.type, detail: cost.detail, amount: cost.amount })),
    truck: line.sourceTruckNumber || line.allocation?.vehicle?.plateNumber || null,
    driver: line.sourceDriverName || line.allocation?.vehicle?.driverName || null,
    source: lineSource(line),
  };
}

const joinedUnique = (values) => [...new Set(values.filter(Boolean))].join(', ') || '—';

// One report row per order. `lines` carries the per-item detail; the joined strings remain for
// callers that want a single cell. `deliveryEnabled` (shop only) adds the delivery state the sale
// detail shows, and `canEdit(order)` is the caller's permission/branch check for editing it.
export function salesReportRow(order, { branchNameById, deliveryEnabled, canEdit }) {
  const lines = order.lines.map(salesReportLine);
  const pending = order.deliveryStatus === 'pending';
  return {
    id: order.id,
    date: effectiveDate(order, 'saleDate'),
    enteredAt: order.createdAt,
    branch: branchNameById[order.branchId] || '—',
    customer: order.customer?.name || 'Walk-in',
    lines,
    products: lines.map((line) => line.product).join(', '),
    truck: joinedUnique(lines.map((line) => line.truck)),
    driver: joinedUnique(lines.map((line) => line.driver)),
    source: joinedUnique(lines.map((line) => line.source)),
    salesAmount: order.subtotal - order.discount,
    discount: order.discount,
    transportAmount: order.transportFee,
    total: order.grandTotal,
    reference: order.orderNumber,
    paymentMethod: order.paymentMethod || 'unspecified',
    channel: order.channel || 'unspecified',
    count: 1,
    ...(deliveryEnabled ? {
      deliveryStatus: order.deliveryStatus,
      deliveryDate: order.deliveryDate?.toISOString().slice(0, 10) || order.deliveredAt?.toISOString().slice(0, 10) || null,
      editable: pending && !!canEdit(order) && order.lines.every((line) => line.stockQty != null),
      edit: pending ? {
        revision: order.deliveryRevision,
        saleDate: effectiveDate(order, 'saleDate'),
        discount: order.discount,
        orderTransportFee: order.transportFee - order.lines.reduce((sum, line) => sum + line.transportFee, 0),
        lines: lines.map((line) => ({
          id: line.id, product: line.product, unit: line.unit, qty: line.qty, stockQty: line.stockQty,
          unitPrice: line.unitPrice, transportFee: line.transportFee, costs: line.costs,
        })),
      } : null,
    } : {}),
  };
}

// The CSV carries one row per line item. The order's own money (sales, transport, total) is stated
// once, on the first line, so a column sum still equals the report total; everything that identifies
// the sale repeats on each line so the rows can be filtered on their own.
export function salesCsvRows(rows) {
  return rows.flatMap((row) => row.lines.map((line, index) => ({
    date: row.date,
    enteredAt: row.enteredAt,
    branch: row.branch,
    customer: row.customer,
    product: line.product,
    truck: line.truck || '',
    driver: line.driver || '',
    source: line.source || '',
    quantity: line.qty,
    unit: line.unit,
    unitPrice: line.unitPrice,
    salesAmount: index === 0 ? row.salesAmount : null,
    transportAmount: index === 0 ? row.transportAmount : null,
    total: index === 0 ? row.total : null,
    reference: row.reference,
  })));
}

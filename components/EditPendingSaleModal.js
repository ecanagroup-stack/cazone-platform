'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal, Field, NumberInput, OtpField, FormButtons, BusinessDateField, Card, inputCls } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { todayLocalDate } from '@/lib/saleDates.mjs';

// Edits a sale that is still awaiting delivery (PATCH /api/admin/orders/[id]/delivery) and can mark it
// delivered in the same save. `startDelivered` opens it with "Mark Delivered" already ticked.
export default function EditPendingSaleModal({ sale, onClose, onSaved, startDelivered = false }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null);
  const [overridePin, setOverridePin] = useState('');
  useEffect(() => {
    setCreditWarning(null);
    setOverridePin('');
    setForm(sale?.edit ? {
      revision: sale.edit.revision, delivered: startDelivered,
      saleDate: sale.edit.saleDate, deliveryDate: todayLocalDate(),
      discount: (sale.edit.discount / 100).toString(),
      orderTransportFee: (sale.edit.orderTransportFee / 100).toString(),
      reason: '', discountOtp: '', backdateOtp: '',
      lines: sale.edit.lines.map((line) => ({
        ...line, qty: String(line.qty), stockQty: String(line.stockQty),
        unitPrice: (line.unitPrice / 100).toString(), transportFee: (line.transportFee / 100).toString(),
        costs: line.costs.map((cost) => ({ ...cost, amount: (cost.amount / 100).toString() })),
      })),
    } : null);
  }, [sale, startDelivered]);
  if (!sale || !form) return null;

  const updateLine = (id, key, value) => setForm((current) => ({
    ...current, lines: current.lines.map((line) => line.id === id ? { ...line, [key]: value } : line),
  }));
  const updateCost = (lineId, costId, value) => setForm((current) => ({
    ...current, lines: current.lines.map((line) => line.id === lineId
      ? { ...line, costs: line.costs.map((cost) => cost.id === costId ? { ...cost, amount: value } : cost) }
      : line),
  }));
  const calculatedTotal = form.lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.unitPrice || 0)
    + Number(line.transportFee || 0) + line.costs.reduce((costSum, cost) => costSum + Number(cost.amount || 0), 0), 0)
    + Number(form.orderTransportFee || 0) - Number(form.discount || 0);
  const discountOtpNeeded = Math.round(Number(form.discount) * 100) !== sale.edit.discount;

  const save = async (event, overrideCredit = false) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/orders/${sale.id}/delivery`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, overrideCredit, otp: overridePin }),
      });
      const result = await response.json();
      if (result.needsApproval) { setCreditWarning(result); return; }
      if (!result.success) return toast.error(result.error || 'Could not update this sale');
      toast.success(form.delivered ? 'Sale marked Delivered' : 'Pending sale updated');
      onSaved();
    } finally { setSaving(false); }
  };

  return <Modal open onClose={onClose} title={startDelivered ? `Mark sale ${sale.reference} delivered` : `Edit pending sale ${sale.reference}`} size="2xl">
    <form onSubmit={save} className="space-y-4">
      {startDelivered && <p className="text-sm text-gray-600">Confirm the delivery date and quantities, and give a reason (at least 5 characters) for the record, then save to mark this sale delivered.</p>}
      <p className="text-sm text-gray-600">Edit the billed and physical quantities and amounts before delivery. Stock, customer balance, and payment allocations will be corrected together.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-3">
          <BusinessDateField label="Sale date" value={form.saleDate} onChange={(saleDate) => setForm({ ...form, saleDate })}
            otp={form.backdateOtp} onOtpChange={(backdateOtp) => setForm((current) => ({ ...current, backdateOtp }))}
            otpRequired={form.saleDate < todayLocalDate() && form.saleDate !== sale.edit.saleDate} />
        </div>
        {form.delivered && <Field label="Delivery date"><input type="date" required min={form.saleDate} max={todayLocalDate()} value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} className={inputCls} /></Field>}
      </div>
      {sale.paymentMethod !== 'credit' && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">This sale was paid immediately. Changing its value corrects the recorded sale and report; settle any cash difference with the customer separately.</p>}
      {form.lines.map((line) => <Card key={line.id} className="p-4 space-y-3">
        <h3 className="font-semibold">{line.product}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label={`Physical quantity (${line.unit})`}><NumberInput required value={line.stockQty} onChange={(e) => updateLine(line.id, 'stockQty', e.target.value)} /></Field>
          <Field label={`Billed quantity (${line.unit})`}><NumberInput required value={line.qty} onChange={(e) => updateLine(line.id, 'qty', e.target.value)} /></Field>
          <Field label="Unit price"><p className={`${inputCls} bg-gray-50 text-gray-700`}>{formatMoney(Number(line.unitPrice))}</p></Field>
          <Field label="Transport"><NumberInput required value={line.transportFee} onChange={(e) => updateLine(line.id, 'transportFee', e.target.value)} /></Field>
        </div>
        {line.costs.map((cost) => <Field key={cost.id} label={`${cost.type}${cost.detail ? `: ${cost.detail}` : ''}`}><NumberInput required value={cost.amount} onChange={(e) => updateCost(line.id, cost.id, e.target.value)} /></Field>)}
      </Card>)}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Other transport"><NumberInput required value={form.orderTransportFee} onChange={(e) => setForm({ ...form, orderTransportFee: e.target.value })} /></Field>
        <Field label="Discount"><NumberInput required value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></Field>
      </div>
      {discountOtpNeeded && <OtpField purpose="sale_discount" value={form.discountOtp} onChange={(discountOtp) => setForm((current) => ({ ...current, discountOtp }))} />}
      <p className="font-semibold">Revised total: {formatMoney(calculatedTotal)}</p>
      <Field label="Reason for change" required><input required minLength={5} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.delivered} onChange={(e) => setForm({ ...form, delivered: e.target.checked })} /> Mark Delivered after saving</label>
      {creditWarning && <Card className="p-3 border-amber-300 bg-amber-50 space-y-2">
        <p className="text-sm text-amber-800">{creditWarning.error}</p>
        <OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} />
        <button type="button" disabled={saving || !overridePin} onClick={(event) => save(event, true)} className="text-sm font-medium text-amber-900 underline disabled:opacity-50">Proceed with verification code</button>
      </Card>}
      <FormButtons onCancel={onClose} submitting={saving} submitLabel={form.delivered ? 'Save and mark Delivered' : 'Save pending sale'} />
    </form>
  </Modal>;
}

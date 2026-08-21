'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls,
  EmptyRow, tableScrollCls, theadCls,
} from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const blankEdit = { name: '', phone: '', position: '', employmentType: 'full_time', dateOfBirth: '', gender: '', employmentDate: '', photoUrl: '' };

// Ported from petrol-station-app's /manager/attendants/[id] scorecard + notes log — the one thing
// AttendantNote existed for in the schema with no UI anywhere until now.
export default function AttendantDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(blankEdit);
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/fuel/attendants/${id}`);
    const d = await r.json();
    if (d.success) {
      setData(d.data);
      const a = d.data.attendant;
      setEditForm({
        name: a.name, phone: a.phone || '', position: a.position || '',
        employmentType: a.employmentType || 'full_time',
        dateOfBirth: a.dateOfBirth ? a.dateOfBirth.slice(0, 10) : '',
        gender: a.gender || '',
        employmentDate: a.employmentDate ? a.employmentDate.slice(0, 10) : '',
        photoUrl: a.photoUrl || '',
      });
    } else toast.error(d.error || 'Failed to load');
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleEdit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/attendants/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm),
      });
      const d = await r.json();
      if (d.success) { toast.success('Saved'); setShowEdit(false); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async () => {
    const goingActive = !data.attendant.isActive;
    if (!goingActive && !confirm(`Deactivate ${data.attendant.name}? Their history stays, they just can't be assigned to a pump.`)) return;
    const r = await fetch(`/api/admin/fuel/attendants/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: goingActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/attendants/${id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: noteText }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Note added'); setShowNote(false); setNoteText(''); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!data) return <Loader />;

  const { attendant, summary, byDay, notes } = data;

  return (
    <div>
      <Link href="/admin/fuel/tanks?tab=attendants" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <FiArrowLeft size={14} /> Attendants
      </Link>

      <PageHeader
        title={attendant.name}
        subtitle={`Staff # ${attendant.staffNumber}${attendant.position ? ` — ${attendant.position}` : ''}`}
        action={
          <div className="flex gap-2">
            <button onClick={toggleActive} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50">
              {attendant.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
            <button onClick={() => setShowEdit(true)} className={btnPrimaryCls}>Edit</button>
          </div>
        }
      />

      <div className="mb-4">
        <StatusPill status={attendant.isActive ? 'Active' : 'Inactive'} color={attendant.isActive ? 'green' : 'gray'} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        <Card className="p-4"><p className="text-xs text-gray-500">Days Worked</p><p className="text-2xl font-bold mt-1">{summary.daysWorked}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Total Sales</p><p className="text-2xl font-bold mt-1">{formatMoney(summary.totalMeterSales / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Total Collected</p><p className="text-2xl font-bold mt-1">{formatMoney(summary.totalCollected / 100)}</p></Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Total Shortage</p>
          <p className={`text-2xl font-bold mt-1 ${summary.totalShortage > 0 ? 'text-red-600' : 'text-green-700'}`}>
            {summary.totalShortage > 0 ? formatMoney(summary.totalShortage / 100) : 'Clean'}
          </p>
        </Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Longest Clean Streak</p><p className="text-2xl font-bold mt-1">{summary.longestCleanStreak}d</p></Card>
      </div>

      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Day-by-Day History</h3></div>
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Pumps</th>
                <th className="px-4 py-2 text-right font-medium">Meter Sales</th>
                <th className="px-4 py-2 text-right font-medium">Collected</th>
                <th className="px-4 py-2 text-right font-medium">Shortage / Overage</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {byDay.length === 0 && <EmptyRow colSpan={5} text="No shifts worked yet" />}
              {byDay.map((row) => (
                <tr key={row.date}>
                  <td className="px-4 py-2 text-gray-500">{formatDate(row.date)}</td>
                  <td className="px-4 py-2">{row.pumps.join(', ')}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(row.meterSales / 100)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(row.collected / 100)}</td>
                  <td className={`px-4 py-2 text-right ${row.shortage > 0 ? 'text-red-600 font-medium' : row.overage > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                    {row.shortage > 0 ? `-${formatMoney(row.shortage / 100)}` : row.overage > 0 ? `+${formatMoney(row.overage / 100)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-sm">Manager Notes</h3>
          <button onClick={() => setShowNote(true)} className={btnPrimaryCls}>Add Note</button>
        </div>
        <div className="divide-y">
          {notes.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No notes yet</p>}
          {notes.map((n) => (
            <div key={n.id} className="px-4 py-3">
              <p className="text-sm">{n.note}</p>
              <p className="text-xs text-gray-400 mt-1">{n.addedBy || 'Unknown'} — {formatDate(n.createdAt)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Attendant">
        <form onSubmit={handleEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" required>
              <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} required autoFocus />
            </Field>
            <Field label="Phone">
              <input type="text" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Position">
              <input type="text" value={editForm.position} onChange={(e) => setEditForm({ ...editForm, position: e.target.value })} className={inputCls} placeholder="e.g., Pump Attendant" />
            </Field>
            <Field label="Employment type">
              <select value={editForm.employmentType} onChange={(e) => setEditForm({ ...editForm, employmentType: e.target.value })} className={inputCls}>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="casual">Casual</option>
              </select>
            </Field>
          </div>
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">HR details (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date of birth">
                <input type="date" value={editForm.dateOfBirth} onChange={(e) => setEditForm({ ...editForm, dateOfBirth: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Gender">
                <select value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} className={inputCls}>
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Field label="Employment date">
                <input type="date" value={editForm.employmentDate} onChange={(e) => setEditForm({ ...editForm, employmentDate: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Photo URL">
                <input type="text" value={editForm.photoUrl} onChange={(e) => setEditForm({ ...editForm, photoUrl: e.target.value })} className={inputCls} placeholder="Optional" />
              </Field>
            </div>
          </div>
          <FormButtons onCancel={() => setShowEdit(false)} submitting={submitting} submitLabel="Save" />
        </form>
      </Modal>

      <Modal open={showNote} onClose={() => setShowNote(false)} title="Add Note">
        <form onSubmit={handleAddNote} className="space-y-4">
          <Field label="Note" required>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} className={inputCls} rows={4} required autoFocus placeholder="What should the next manager know?" />
          </Field>
          <FormButtons onCancel={() => setShowNote(false)} submitting={submitting} submitLabel="Add Note" />
        </form>
      </Modal>
    </div>
  );
}

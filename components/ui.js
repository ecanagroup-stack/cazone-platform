'use client';

import { useState, useRef } from 'react';
import { FiX, FiPrinter, FiDownload, FiLink, FiMail, FiEye, FiEyeOff, FiImage } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { toCsv, downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';

export function Logo({ className = 'h-8 w-8' }) {
  return (
    <svg className={className} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="8" width="84" height="84" rx="20" fill="#0f7a5c" />
      <path d="M30 62 L50 30 L70 62 Z" fill="#ffffff" />
      <circle cx="50" cy="70" r="6" fill="#ffffff" />
    </svg>
  );
}

// An org's actual uploaded mark — never the generic <Logo/> as a stand-in, so "no logo yet" reads as
// exactly that rather than looking like a real (wrong) brand. Used on the platform's organizations
// list/detail and anywhere else an org's own logo is shown, not the app's own chrome. `dim` must be
// a literal Tailwind size pair (e.g. "h-8 w-8") — Tailwind's JIT scanner needs the class text to
// appear verbatim in source, so this can't be built from a numeric prop at runtime.
export function OrgLogo({ org, dim = 'h-16 w-16', className = '' }) {
  const src = org?.logoUrlSmall || org?.logoUrl;
  if (!src) {
    return (
      <div title="No logo uploaded" className={`${dim} rounded border border-dashed bg-gray-50 flex items-center justify-center text-gray-300 shrink-0 ${className}`}>
        <FiImage size={16} />
      </div>
    );
  }
  return <img src={src} alt={org.name ? `${org.name} logo` : 'Logo'} className={`${dim} rounded object-contain border bg-white shrink-0 ${className}`} />;
}

export const btnPrimaryCls = 'px-4 py-2 bg-brand-600 text-white rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50';
export const btnDangerCls = 'px-4 py-2 bg-red-700 text-white rounded text-sm font-medium hover:bg-red-800 disabled:opacity-50';
export const tableActionCls = 'text-sm font-medium text-brand-600 hover:text-brand-700';
export const tableDangerActionCls = 'text-sm font-medium text-red-700 hover:text-red-800';

// Table head: brand green, sticky so it acts as a frozen pane while the body scrolls. Must sit
// inside a bounded-height scroll wrapper (tableScrollCls) — a page-level sticky element elsewhere
// (e.g. a future top bar) would otherwise defeat this, same lesson learned in the sibling apps.
export const theadCls = 'bg-brand-600 text-white sticky top-0 z-10';
export const tableScrollCls = 'overflow-auto max-h-[70vh] print:overflow-visible print:max-h-none';

export const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-brand-500';

// Every password field in the app goes through this — a bare type="password" input with a peek
// toggle, not a bespoke one per form. tabIndex={-1} keeps the toggle out of the tab order between
// the field and the next one.
export function PasswordInput({ className = inputCls, ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input type={visible ? 'text' : 'password'} className={`${className} pr-10`} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <FiEyeOff size={16} /> : <FiEye size={16} />}
      </button>
    </div>
  );
}

function formatWithCommas(raw) {
  if (raw === '' || raw == null) return '';
  const negative = String(raw).startsWith('-');
  const [intPart, decPart] = String(raw).replace('-', '').split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${withCommas}${decPart !== undefined ? `.${decPart}` : ''}`;
}

// Every numeric field in the app goes through this instead of a bare type="number" input — that
// native type has two problems: its spinner buttons (and, worse, the scroll wheel while hovering
// it, even unfocused in some browsers) silently increment/decrement the value, and it can't display
// thousands separators at all. This is a type="text" field instead — no spinner, no scroll-wheel
// surprise — that formats with commas as you type while keeping the (value, onChange) contract a
// plain number input has, so callers that already do `onChange={(e) => setForm({...form, x:
// e.target.value})}` and `Number(form.x)` on submit don't need to change at all.
export function NumberInput({ value, onChange, className = inputCls, ...props }) {
  const ref = useRef(null);

  const handleChange = (e) => {
    const typed = e.target.value;
    const cursorPos = e.target.selectionStart;
    const digitsBeforeCursor = typed.slice(0, cursorPos).replace(/[^\d.-]/g, '').length;

    const cleaned = typed.replace(/,/g, '');
    if (cleaned !== '' && !/^-?\d*\.?\d*$/.test(cleaned)) return; // reject anything not a plain number

    onChange({ target: { value: cleaned } });

    // Reformatting on every keystroke moves the cursor to the end unless we put it back — walk the
    // freshly-formatted string to the position with the same count of digits before it.
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const formatted = formatWithCommas(cleaned);
      let seen = 0;
      let pos = 0;
      for (; pos < formatted.length; pos++) {
        if (/[\d.-]/.test(formatted[pos])) seen++;
        if (seen >= digitsBeforeCursor) { pos++; break; }
      }
      ref.current.setSelectionRange(pos, pos);
    });
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={formatWithCommas(value)}
      onChange={handleChange}
      className={className}
      {...props}
    />
  );
}

export function Loader() {
  return (
    <div className="flex justify-center py-12">
      <div className="animate-spin h-8 w-8 border-4 border-gray-800 border-t-transparent rounded-full" />
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`bg-white border rounded-lg ${className}`}>{children}</div>;
}

export function StatusPill({ status, color }) {
  const colors = {
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-700',
    gray: 'bg-gray-100 text-gray-700',
  };
  return <span className={`px-2 py-1 text-xs rounded ${colors[color] || colors.gray}`}>{status}</span>;
}

export function EmptyRow({ colSpan, text = 'No data' }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center py-8 text-gray-500">{text}</td>
    </tr>
  );
}

export function EmptyState({ title, subtitle, action }) {
  return (
    <div className="text-center py-16 px-6">
      <p className="text-gray-900 font-medium">{title}</p>
      {subtitle && <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl', '2xl': 'max-w-4xl' };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-lg w-full ${sizes[size]} max-h-[90vh] overflow-y-auto`}>
        <div className="p-6">
          <div className="flex justify-between items-start gap-4 mb-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="Close">
              <FiX size={20} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function FormButtons({ onCancel, submitLabel = 'Save', submitting }) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 border rounded hover:bg-gray-50">
        Cancel
      </button>
      <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
        {submitting ? 'Saving...' : submitLabel}
      </button>
    </div>
  );
}

// In-page tab bar — closely-related sub-features live inside a page as tabs rather than each
// earning their own sidebar entry (e.g. Fuel Setup's Tanks & Dispensers / Attendants, Deliveries'
// Deliveries / Suppliers).
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 border-b mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            active === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, required }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

// The global print/export/share mechanism — drop onto any report-like table screen. Print uses the
// browser's native dialog (which already offers "Save as PDF"); Export CSV and Copy Link need
// nothing configured; Email needs RESEND_API_KEY set server-side (lib/email.js) and shows a clear
// error if it isn't, rather than pretending to send.
export function ReportToolbar({ title, csvRows, csvColumns, csvFilename, allowEmail = true }) {
  const [showEmail, setShowEmail] = useState(false);
  const [emailForm, setEmailForm] = useState({ to: '', note: '' });
  const [sending, setSending] = useState(false);

  const buildCsv = () => toCsv(csvRows, csvColumns);

  const handlePrint = () => window.print();

  const handleExport = () => downloadCsv(csvFilename, buildCsv());

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast.success('Link copied');
  };

  const handleEmail = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const r = await fetch('/api/admin/reports/email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emailForm.to, subject: title, note: emailForm.note, csvFilename, csv: buildCsv() }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Emailed'); setShowEmail(false); setEmailForm({ to: '', note: '' }); }
      else toast.error(d.error);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="print:hidden flex items-center gap-4">
      <button type="button" onClick={handlePrint} className={`flex items-center gap-1.5 ${tableActionCls}`}><FiPrinter size={14} /> Print</button>
      <button type="button" onClick={handleExport} className={`flex items-center gap-1.5 ${tableActionCls}`}><FiDownload size={14} /> Export CSV</button>
      <button type="button" onClick={handleCopyLink} className={`flex items-center gap-1.5 ${tableActionCls}`}><FiLink size={14} /> Copy Link</button>
      {allowEmail && (
        <button type="button" onClick={() => setShowEmail(true)} className={`flex items-center gap-1.5 ${tableActionCls}`}><FiMail size={14} /> Email</button>
      )}

      <Modal open={showEmail} onClose={() => setShowEmail(false)} title={`Email — ${title}`}>
        <form onSubmit={handleEmail} className="space-y-4">
          <Field label="Recipient email" required>
            <input type="email" value={emailForm.to} onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })} className={inputCls} required autoFocus />
          </Field>
          <Field label="Note">
            <textarea value={emailForm.note} onChange={(e) => setEmailForm({ ...emailForm, note: e.target.value })} className={inputCls} rows={2} placeholder="Optional" />
          </Field>
          <FormButtons onCancel={() => setShowEmail(false)} submitting={sending} submitLabel="Send" />
        </form>
      </Modal>
    </div>
  );
}

// The printable-document header (petrol-station-app has no receipt of its own — this is
// ecana_shop-app's proven ReceiptHeader pattern, ported: logo + org identity on the left, a
// reference number/date on the right, the document title centered below). No logo → the header
// just runs without one, same as any receipt from a business that hasn't set one up — unlike
// OrgLogo elsewhere in the app, this deliberately does NOT print a "No logo" placeholder box.
export function ReceiptHeader({ org, refNumber, date, title }) {
  const logoSrc = org?.logoUrlSmall || org?.logoUrl;
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {logoSrc && <img src={logoSrc} alt={org.name} className="h-14 w-14 object-contain rounded" />}
          <div>
            <p className="font-bold text-lg leading-tight">{org?.name}</p>
            {org?.address && <p className="text-xs text-gray-500">{org.address}</p>}
            {(org?.phone || org?.email) && <p className="text-xs text-gray-500">{[org?.phone, org?.email].filter(Boolean).join(' · ')}</p>}
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          {refNumber && <p className="font-medium text-gray-700">{refNumber}</p>}
          {date && <p>{formatDate(date)}</p>}
        </div>
      </div>
      {title && <h2 className="text-center text-sm font-semibold uppercase tracking-wide mt-4 border-t border-b py-2">{title}</h2>}
    </div>
  );
}

// The verification-code step for the highest-stakes actions (credit-limit overrides, price
// approvals — lib/otp.js). Sends a fresh code to the organization's OTP email each time, rather
// than a pre-set PIN. `purpose` must match one lib/otp.js recognizes; `value`/`onChange` hold the
// code the caller sends back to the confirming API call as `otp`.
export function OtpField({ purpose, value, onChange }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const sendCode = async () => {
    setSending(true);
    try {
      const r = await fetch('/api/admin/otp/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Code sent'); setSent(true); }
      else toast.error(d.error);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      {sent && (
        <input
          type="text" inputMode="numeric" maxLength={6} placeholder="6-digit code"
          value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1 border rounded text-xs"
        />
      )}
      <button type="button" onClick={sendCode} disabled={sending} className="text-xs font-medium text-brand-600 hover:text-brand-700 underline disabled:opacity-50">
        {sending ? 'Sending...' : sent ? 'Resend code' : 'Send verification code to admin email'}
      </button>
    </div>
  );
}

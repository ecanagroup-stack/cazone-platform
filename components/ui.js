'use client';

import { FiX } from 'react-icons/fi';

export function Logo({ className = 'h-8 w-8' }) {
  return (
    <svg className={className} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="8" width="84" height="84" rx="20" fill="#0f7a5c" />
      <path d="M30 62 L50 30 L70 62 Z" fill="#ffffff" />
      <circle cx="50" cy="70" r="6" fill="#ffffff" />
    </svg>
  );
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

import { requireBusinessPage } from '@/lib/businessPage';

export default async function RetailLayout({ children }) {
  await requireBusinessPage('general_store');
  return children;
}

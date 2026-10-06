import { requireBusinessPage } from '@/lib/businessPage';

export default async function MaterialsLayout({ children }) {
  await requireBusinessPage('shop');
  return children;
}

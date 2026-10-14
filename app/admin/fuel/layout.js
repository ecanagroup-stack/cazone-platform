import { requireBusinessPage } from '@/lib/businessPage';

export default async function FuelLayout({ children }) {
  await requireBusinessPage('fuel_station');
  return children;
}

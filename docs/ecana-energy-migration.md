# Ecana Energy fuel migration (2025 onward)

## Scope and source audit

Source: the sibling `petrol-station-app` MongoDB. Target: a new CaZone organization with slug `ecana-energy`, one `fuel_station` service, and the three current branches EE1 Jikwoyi, EE3 Guzape, and EE2 New Nyanya. The existing Ecana Family organization is separate.

The cutoff is 2025-01-01 UTC. The 2026-10-04 read-only preflight found no genuine 2025 operating records. It found 345 shifts (first 2026-02-04), 2,818 sales, 2,929 in-range meter readings, 2,875 tank-stock entries, 200 stock movements, 268 cash deposits, 43 payment records, 40 price changes, 135 attendant assignments, and 306 audit logs. Seven `2000-01-01` placeholder meters are before the cutoff. Source data changes while the old app remains in use, so rerun preflight at cutover.

All 2,818 sales link to a saved shift and meter. The other 111 in-range meter readings are retained without creating sales. Only eight of the 43 payment records have manager approval **and** a positive received amount. The other 35 are retained in the source archive; they do not establish a verified pump collection or an attendant debt. Older pumps without approved collections are marked `unknown` in CaZone.

Historical station IDs `6a306aa5ebcd1418d8ec556f` and `697ef6d85a9ad0e86a84e2fd` are explicitly mapped into current Guzape and New Nyanya respectively, following the owner's choice to merge by matching station name. Three other missing station IDs appear only in audit history, so their original IDs are kept in the archive. Jikwoyi tank `PMS2` has 101 historical dips but is absent from current station settings; it is represented as an inactive historical tank with unknown capacity rather than relabelled as an active tank.

The latest saved closing dips (2026-10-03) are not manager approved. Their measured totals differ substantially from MongoDB's mutable `currentStock` fields. A new signed physical tank reading after the final old-app shift is required to establish CaZone's starting on-hand stock. The importer records that balance as a dated stocktake adjustment, preserving the imported receipt and sale ledger.

## Cutover sequence

1. Finish and close all shifts in the old app. The preflight currently finds one `in_progress` shift and blocks import while it remains open.
2. Stop new entries in the old app and take a manager-signed reading of every active tank. Fill [ecana-cutover-stock.template.json](./ecana-cutover-stock.template.json) with ISO timestamps, approver name, and litres. Keep the signed source document outside Git; pass its path to the importer.
3. Run `node scripts/preflight-ecana-fuel.mjs` and `node scripts/import-ecana-fuel.mjs --cutover-file=PATH` from CaZone. The latter is dry-run unless `--apply` is present. Resolve every blocker and review the source counts against a frozen source snapshot.
4. Apply the additive PostgreSQL schema migration with `npx prisma migrate deploy`. Run the importer with `--apply --cutover-file=PATH`. It uses stable source-derived IDs and `skipDuplicates` so an interrupted run can resume without duplicating records.
5. Verify source-to-target counts, branch prices, per-pump unknown/verified collection status, closing dips, go-live stock per product, and representative historical days. Only then switch daily operation to CaZone and commit/push/deploy the application changes in the correct database-before-code order.

## Mapping and limits

The importer creates CaZone users (retaining compatible bcrypt password hashes), branches, fuel products, current and historical tanks, pumps, attendants, shifts, confirmed meter sales, orders, stock moves, approved collections, deposits, receipt deliveries, dips, prices, and audit entries. Source documents from every MongoDB collection are also stored by collection and source ID in `LegacyFuelRecord`, excluding the user password hash from that archive. This keeps fields without direct CaZone equivalents available for reconciliation.

Source `sale` stock movements are archived but are not posted again to CaZone's stock ledger: the 2,818 saved SalesEntry records already generate sale moves. Source payment records that are pending or zero value are archived without treating them as received cash. Tank dips are historical measurements, not evidence of manager approval. Historical physical tank capacity absent from current settings is recorded as unknown (`0`) on the inactive historical tank.

The small non-fuel MongoDB commerce collections (for example, source `orders`, `transactions`, and `topups`) are preserved in `LegacyFuelRecord`; they do not become new CaZone shop transactions as part of this **fuel** migration. A separate mapping is needed if those workflows must become operational in CaZone.

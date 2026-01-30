/**
 * Inventory Table Component
 *
 * Reusable inventory table component with per-store quantities
 */

import { IndexTable, Badge, Text, Button } from "@shopify/polaris";

interface InventoryItem {
  id: string;
  sku: string;
  title: string;
  centralQty: number;
  stores: Array<{
    name: string;
    quantity: number | null;
    status: "synced" | "out-of-sync" | "error";
  }>;
  syncStatus: "synced" | "out-of-sync" | "error";
}

interface Store {
  id: string;
  name: string;
}

interface InventoryTableProps {
  items: InventoryItem[];
  stores: Store[];
  onSync?: (sku: string, storeId: string) => void;
  loading?: boolean;
}

export function InventoryTable({ items, stores, onSync, loading = false }: InventoryTableProps) {
  const resourceName = {
    singular: "product",
    plural: "products",
  };

  const rowMarkup = items.map((item, index) => (
    <IndexTable.Row id={item.id} key={item.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {item.sku}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {item.title}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">{item.centralQty}</Badge>
      </IndexTable.Cell>
      {stores.map((store) => {
        const storeData = item.stores.find((s) => s.name === store.name);
        return (
          <IndexTable.Cell key={store.id}>
            {storeData?.quantity !== null ? (
              <Badge
                tone={
                  storeData.status === "synced"
                    ? "success"
                    : storeData.status === "error"
                    ? "critical"
                    : "warning"
                }
              >
                {storeData.quantity}
              </Badge>
            ) : (
              <Text as="span" tone="subdued">
                -
              </Text>
            )}
          </IndexTable.Cell>
        );
      })}
      <IndexTable.Cell>
        <Badge
          tone={
            item.syncStatus === "synced"
              ? "success"
              : item.syncStatus === "error"
              ? "critical"
              : "warning"
          }
        >
          {item.syncStatus}
        </Badge>
      </IndexTable.Cell>
      {onSync && (
        <IndexTable.Cell>
          {stores.map((store) => (
            <Button
              key={store.id}
              size="micro"
              onClick={() => onSync(item.sku, store.id)}
              loading={loading}
            >
              Sync
            </Button>
          ))}
        </IndexTable.Cell>
      )}
    </IndexTable.Row>
  ));

  return (
    <IndexTable
      resourceName={resourceName}
      itemCount={items.length}
      headings={[
        { title: "SKU" },
        { title: "Product Title" },
        { title: "Central Qty" },
        ...stores.map((store) => ({ title: store.name })),
        { title: "Status" },
        ...(onSync ? [{ title: "Actions" }] : []),
      ]}
      selectable={false}
      loading={loading}
    >
      {rowMarkup}
    </IndexTable>
  );
}

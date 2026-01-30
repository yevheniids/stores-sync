import { BlockStack, InlineStack, Text, Button, Badge, Divider } from "@shopify/polaris";

interface StoreConnection {
  id: string;
  shopName: string;
  shopDomain: string;
  isActive: boolean;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  productCount: number;
  errorCount: number;
}

interface StoreConnectionCardProps {
  store: StoreConnection;
  onToggleSync: (storeId: string, enabled: boolean) => void;
  onFullSync: (shopDomain: string) => void;
  isLoading: boolean;
}

export function StoreConnectionCard({
  store,
  onToggleSync,
  onFullSync,
  isLoading,
}: StoreConnectionCardProps) {
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {store.shopName}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {store.shopDomain}
          </Text>
        </BlockStack>
        <InlineStack gap="200">
          <Badge tone={store.isActive ? "success" : "critical"}>
            {store.isActive ? "Active" : "Inactive"}
          </Badge>
          <Badge tone={store.syncEnabled ? "success" : "info"}>
            {store.syncEnabled ? "Sync On" : "Sync Off"}
          </Badge>
        </InlineStack>
      </InlineStack>
      <InlineStack gap="400">
        <Text as="p" variant="bodySm" tone="subdued">
          Products: {store.productCount}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Last sync: {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleString() : "Never"}
        </Text>
        {store.errorCount > 0 && (
          <Badge tone="critical">{store.errorCount} errors (24h)</Badge>
        )}
      </InlineStack>
      <InlineStack gap="200">
        <Button
          size="slim"
          onClick={() => onToggleSync(store.id, !store.syncEnabled)}
          disabled={isLoading}
        >
          {store.syncEnabled ? "Disable Sync" : "Enable Sync"}
        </Button>
        <Button
          size="slim"
          onClick={() => onFullSync(store.shopDomain)}
          disabled={isLoading}
        >
          Full Sync
        </Button>
      </InlineStack>
      <Divider />
    </BlockStack>
  );
}

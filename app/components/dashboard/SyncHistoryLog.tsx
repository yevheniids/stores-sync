import { BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";

interface Operation {
  id: string;
  operationType: string;
  status: string;
  startedAt: string;
  productSku?: string;
  storeName?: string;
  errorMessage?: string;
}

interface SyncHistoryLogProps {
  operations: Operation[];
  compact?: boolean;
}

export function SyncHistoryLog({ operations, compact }: SyncHistoryLogProps) {
  if (operations.length === 0) {
    return (
      <Text as="p" variant="bodyMd" tone="subdued">
        No sync operations yet.
      </Text>
    );
  }

  const statusTone = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "success" as const;
      case "FAILED":
        return "critical" as const;
      case "IN_PROGRESS":
        return "info" as const;
      default:
        return "info" as const;
    }
  };

  return (
    <BlockStack gap="300">
      {operations.map((op) => (
        <InlineStack key={op.id} align="space-between" blockAlign="center" gap="200">
          <BlockStack gap="100">
            <Text as="p" variant="bodyMd">
              {op.operationType}
              {op.productSku ? ` — ${op.productSku}` : ""}
            </Text>
            {!compact && op.storeName && (
              <Text as="p" variant="bodySm" tone="subdued">
                {op.storeName} • {new Date(op.startedAt).toLocaleString()}
              </Text>
            )}
            {compact && (
              <Text as="p" variant="bodySm" tone="subdued">
                {new Date(op.startedAt).toLocaleString()}
              </Text>
            )}
          </BlockStack>
          <Badge tone={statusTone(op.status)}>{op.status}</Badge>
        </InlineStack>
      ))}
    </BlockStack>
  );
}

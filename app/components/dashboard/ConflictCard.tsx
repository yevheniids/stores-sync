import { BlockStack, InlineStack, Text, Button, ButtonGroup, Badge, Divider } from "@shopify/polaris";
import type { ConflictResolutionStrategy } from "@prisma/client";

interface ConflictData {
  id: string;
  conflictType: string;
  productSku: string;
  productTitle: string;
  storeName: string;
  centralValue: any;
  storeValue: any;
  detectedAt: string;
  resolutionStrategy: string;
}

interface ConflictCardProps {
  conflict: ConflictData;
  onResolve: (conflictId: string, strategy: ConflictResolutionStrategy) => void;
  isLoading: boolean;
}

export function ConflictCard({ conflict, onResolve, isLoading }: ConflictCardProps) {
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {conflict.productSku} — {conflict.productTitle}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {conflict.storeName} • {conflict.conflictType} •{" "}
            {new Date(conflict.detectedAt).toLocaleString()}
          </Text>
        </BlockStack>
        <Badge tone="warning">Pending</Badge>
      </InlineStack>
      <InlineStack gap="400">
        <Text as="p" variant="bodySm">
          Central: {JSON.stringify(conflict.centralValue)}
        </Text>
        <Text as="p" variant="bodySm">
          Store: {JSON.stringify(conflict.storeValue)}
        </Text>
      </InlineStack>
      <ButtonGroup>
        <Button
          size="slim"
          onClick={() => onResolve(conflict.id, "USE_DATABASE" as ConflictResolutionStrategy)}
          disabled={isLoading}
        >
          Use Central
        </Button>
        <Button
          size="slim"
          onClick={() => onResolve(conflict.id, "USE_STORE" as ConflictResolutionStrategy)}
          disabled={isLoading}
        >
          Use Store
        </Button>
        <Button
          size="slim"
          onClick={() => onResolve(conflict.id, "USE_LOWEST" as ConflictResolutionStrategy)}
          disabled={isLoading}
        >
          Use Lowest
        </Button>
      </ButtonGroup>
      <Divider />
    </BlockStack>
  );
}

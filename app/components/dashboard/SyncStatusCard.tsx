import { Card, BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";

interface SyncStatusCardProps {
  health: "healthy" | "warning" | "critical";
  lastSyncAt: string | null;
  pendingConflicts: number;
}

export function SyncStatusCard({ health, lastSyncAt, pendingConflicts }: SyncStatusCardProps) {
  const toneMap = {
    healthy: "success" as const,
    warning: "warning" as const,
    critical: "critical" as const,
  };

  const labelMap = {
    healthy: "All Systems Operational",
    warning: "Minor Issues Detected",
    critical: "Attention Required",
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Sync Status
          </Text>
          <Badge tone={toneMap[health]} size="large">
            {health.toUpperCase()}
          </Badge>
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">
          {labelMap[health]}
        </Text>
        <InlineStack gap="400">
          <Text as="p" variant="bodySm" tone="subdued">
            Last sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "Never"}
          </Text>
          {pendingConflicts > 0 && (
            <Badge tone="warning">{pendingConflicts} pending conflicts</Badge>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

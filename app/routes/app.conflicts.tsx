/**
 * Conflicts Page
 *
 * Display and resolve inventory conflicts
 */

import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Button,
  ButtonGroup,
  Badge,
  Divider,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { resolveConflict } from "~/lib/sync/conflict-resolver.server";
import { ConflictCard } from "~/components/dashboard/ConflictCard";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const [pendingConflicts, resolvedConflicts] = await Promise.all([
    prisma.conflict.findMany({
      where: { resolved: false },
      include: {
        product: true,
        store: true,
      },
      orderBy: { detectedAt: "desc" },
    }),
    prisma.conflict.findMany({
      where: { resolved: true },
      include: {
        product: true,
        store: true,
      },
      orderBy: { resolvedAt: "desc" },
      take: 20,
    }),
  ]);

  const pending: ConflictData[] = pendingConflicts.map((c) => ({
    id: c.id,
    conflictType: c.conflictType,
    productSku: c.product.sku,
    productTitle: c.product.title,
    storeName: c.store.shopName,
    centralValue: c.centralValue,
    storeValue: c.storeValue,
    detectedAt: c.detectedAt.toISOString(),
    resolutionStrategy: c.resolutionStrategy,
  }));

  const resolved: ConflictData[] = resolvedConflicts.map((c) => ({
    id: c.id,
    conflictType: c.conflictType,
    productSku: c.product.sku,
    productTitle: c.product.title,
    storeName: c.store.shopName,
    centralValue: c.centralValue,
    storeValue: c.storeValue,
    detectedAt: c.detectedAt.toISOString(),
    resolutionStrategy: c.resolutionStrategy,
  }));

  return json({
    pending,
    resolved,
    stats: {
      total: pending.length + resolved.length,
      pending: pending.length,
      resolved: resolved.length,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const actionType = formData.get("action");
  const conflictId = formData.get("conflictId");
  const strategy = formData.get("strategy") as ConflictResolutionStrategy;

  if (actionType === "resolve" && conflictId && strategy) {
    try {
      await resolveConflict(conflictId.toString(), strategy, "manual");
      return json({ success: true });
    } catch (error) {
      return json(
        { success: false, error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function ConflictsPage() {
  const { pending, resolved, stats } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const isLoading = navigation.state === "submitting";

  const handleResolve = (conflictId: string, strategy: ConflictResolutionStrategy) => {
    const formData = new FormData();
    formData.append("action", "resolve");
    formData.append("conflictId", conflictId);
    formData.append("strategy", strategy);
    submit(formData, { method: "post" });
  };

  const emptyStateMarkup = (
    <EmptyState
      heading="No conflicts detected"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>All inventory is in sync across stores. Great job!</p>
    </EmptyState>
  );

  return (
    <Page title="Conflicts">
      <BlockStack gap="500">
        {pending.length > 0 && (
          <Banner
            title={`${pending.length} pending conflict${pending.length > 1 ? "s" : ""} require resolution`}
            tone="warning"
          >
            <p>
              Review the conflicts below and choose a resolution strategy. Unresolved conflicts may
              lead to inventory discrepancies.
            </p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Statistics
              </Text>
            </InlineStack>
            <Divider />
            <InlineStack gap="400">
              <Badge tone="info">Total: {stats.total}</Badge>
              <Badge tone="warning">Pending: {stats.pending}</Badge>
              <Badge tone="success">Resolved: {stats.resolved}</Badge>
            </InlineStack>
          </BlockStack>
        </Card>

        {pending.length > 0 ? (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Pending Conflicts
              </Text>
              <Divider />
              <BlockStack gap="400">
                {pending.map((conflict) => (
                  <ConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    onResolve={handleResolve}
                    isLoading={isLoading}
                  />
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        ) : (
          <Card>
            {emptyStateMarkup}
          </Card>
        )}

        {resolved.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recently Resolved Conflicts
              </Text>
              <Divider />
              <BlockStack gap="400">
                {resolved.map((conflict) => (
                  <div key={conflict.id}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {conflict.productSku} - {conflict.productTitle}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {conflict.storeName} • {conflict.conflictType}
                        </Text>
                      </BlockStack>
                      <Badge tone="success">Resolved</Badge>
                    </InlineStack>
                    <Divider />
                  </div>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

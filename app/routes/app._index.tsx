import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Divider,
  Box,
  InlineGrid,
  Button,
  Banner,
} from "@shopify/polaris";
import { useCallback } from "react";
import { prisma } from "~/db.server";
import { authenticate, wrapAdminGraphQL } from "~/shopify.server";
import { syncProductCatalog } from "~/lib/sync/product-mapper.server";
import { SyncStatusCard } from "~/components/dashboard/SyncStatusCard";
import { SyncHistoryLog } from "~/components/dashboard/SyncHistoryLog";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session: adminSession, admin } = await authenticate.admin(request);

  // Refresh Store.accessToken on every authenticated request
  // so the sync engine always has a valid token
  if (adminSession.accessToken) {
    await prisma.store.upsert({
      where: { shopDomain: adminSession.shop },
      create: {
        shopDomain: adminSession.shop,
        shopName: adminSession.shop,
        accessToken: adminSession.accessToken,
        scope: adminSession.scope || "",
        isActive: true,
        syncEnabled: true,
      },
      update: {
        accessToken: adminSession.accessToken,
        updatedAt: new Date(),
      },
    });
  }

  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "syncAll") {
    const stores = await prisma.store.findMany({ where: { isActive: true } });

    if (stores.length === 0) {
      return json({ success: false, error: "No active stores found" }, { status: 400 });
    }

    const results = [];
    for (const store of stores) {
      const startedAt = new Date();
      try {
        // For the currently authenticated store, use admin.graphql() (Shopify's
        // recommended approach — handles token exchange automatically).
        // For other stores, fall back to stored tokens.
        const isCurrentStore = store.shopDomain === adminSession.shop;
        const stats = await syncProductCatalog(store.shopDomain, {
          adminGraphQL: isCurrentStore ? wrapAdminGraphQL(admin) : undefined,
          accessToken: isCurrentStore ? adminSession.accessToken : undefined,
        });
        results.push({ shopDomain: store.shopDomain, ...stats, success: true });

        await prisma.syncOperation.create({
          data: {
            operationType: "BULK_SYNC",
            direction: "STORE_TO_CENTRAL",
            storeId: store.id,
            status: "COMPLETED",
            startedAt,
            completedAt: new Date(),
            newValue: { created: stats.created, updated: stats.updated, total: stats.total },
            triggeredBy: "manual",
          },
        });
      } catch (error) {
        results.push({
          shopDomain: store.shopDomain,
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        });

        await prisma.syncOperation.create({
          data: {
            operationType: "BULK_SYNC",
            direction: "STORE_TO_CENTRAL",
            storeId: store.id,
            status: "FAILED",
            startedAt,
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : "Sync failed",
            triggeredBy: "manual",
          },
        });
      }
    }

    const totalCreated = results.reduce((sum, r) => sum + (r.created || 0), 0);
    const totalUpdated = results.reduce((sum, r) => sum + (r.updated || 0), 0);
    const allUpdatedSkus = results.flatMap((r) => r.updatedSkus || []);
    const allCreatedSkus = results.flatMap((r) => r.createdSkus || []);
    const failed = results.filter((r) => !r.success);

    let message = `Synced ${results.length} store(s): ${totalCreated} created, ${totalUpdated} updated`;
    if (failed.length > 0) message += `, ${failed.length} failed`;
    if (allUpdatedSkus.length > 0) message += `\nUpdated SKUs: ${allUpdatedSkus.join(", ")}`;
    if (allCreatedSkus.length > 0 && allCreatedSkus.length <= 20) {
      message += `\nCreated SKUs: ${allCreatedSkus.join(", ")}`;
    }

    return json({
      success: failed.length === 0,
      message,
      results,
    });
  }

  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Authenticate and refresh Store.accessToken on every page load
  const { session: loaderSession } = await authenticate.admin(request);
  if (loaderSession.accessToken) {
    await prisma.store.upsert({
      where: { shopDomain: loaderSession.shop },
      create: {
        shopDomain: loaderSession.shop,
        shopName: loaderSession.shop,
        accessToken: loaderSession.accessToken,
        scope: loaderSession.scope || "",
        isActive: true,
        syncEnabled: true,
      },
      update: {
        accessToken: loaderSession.accessToken,
        updatedAt: new Date(),
      },
    });
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const [
      totalProducts,
      connectedStores,
      pendingConflicts,
      recentSyncs,
      failedSyncs,
      recentOperations,
      lastSync,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.store.count({ where: { isActive: true } }),
      prisma.conflict.count({ where: { resolved: false } }),
      prisma.syncOperation.count({
        where: { startedAt: { gte: oneDayAgo }, status: "COMPLETED" },
      }),
      prisma.syncOperation.count({
        where: { startedAt: { gte: oneDayAgo }, status: "FAILED" },
      }),
      prisma.syncOperation.findMany({
        take: 10,
        orderBy: { startedAt: "desc" },
        include: { product: true, store: true },
      }),
      prisma.syncOperation.findFirst({
        where: { status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      }),
    ]);

    const syncHealth: "healthy" | "warning" | "critical" =
      pendingConflicts > 10 || failedSyncs > 20
        ? "critical"
        : pendingConflicts > 0 || failedSyncs > 5
        ? "warning"
        : "healthy";

    return json({
      stats: {
        totalProducts,
        connectedStores,
        pendingConflicts,
        recentSyncs,
        failedSyncs,
      },
      recentOperations: recentOperations.map((op) => ({
        id: op.id,
        operationType: op.operationType,
        status: op.status,
        startedAt: op.startedAt.toISOString(),
        productSku: op.product?.sku,
        storeName: op.store?.shopName,
        errorMessage: op.errorMessage || undefined,
      })),
      syncHealth,
      lastSyncAt: lastSync?.completedAt?.toISOString() || null,
    });
  } catch (error) {
    console.error("Dashboard loader error:", error);
    return json({
      stats: {
        totalProducts: 0,
        connectedStores: 0,
        pendingConflicts: 0,
        recentSyncs: 0,
        failedSyncs: 0,
      },
      recentOperations: [],
      syncHealth: "healthy" as const,
      lastSyncAt: null,
    });
  }
};

export default function DashboardIndex() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const isSyncing = navigation.state === "submitting" || navigation.state === "loading";

  const handleSyncAll = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "syncAll");
    submit(formData, { method: "post" });
  }, [submit]);

  return (
    <Page title="Dashboard">
      <BlockStack gap="500">
        {(actionData?.message || actionData?.error) && (
          <Banner
            title={actionData.success ? "Sync completed" : "Sync error"}
            tone={actionData.success ? "success" : "critical"}
          >
            {(actionData.message || actionData.error || "").split("\n").map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Product Sync
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Sync products from all connected Shopify stores to the central database
                </Text>
              </BlockStack>
              <Button
                variant="primary"
                onClick={handleSyncAll}
                loading={isSyncing}
              >
                Sync to Database
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <SyncStatusCard
          health={data.syncHealth}
          lastSyncAt={data.lastSyncAt}
          pendingConflicts={data.stats.pendingConflicts}
        />

        <Layout>
          <Layout.Section variant="oneThird">
            <InlineGrid columns={1} gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Products
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {data.stats.totalProducts}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Total synced products
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Connected Stores
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {data.stats.connectedStores}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Active store connections
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Pending Conflicts
                    </Text>
                    {data.stats.pendingConflicts > 0 && (
                      <Badge tone="warning">
                        {data.stats.pendingConflicts}
                      </Badge>
                    )}
                  </InlineStack>
                  <Text as="p" variant="heading2xl">
                    {data.stats.pendingConflicts}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Requiring resolution
                  </Text>
                </BlockStack>
              </Card>
            </InlineGrid>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Last 24 Hours
                </Text>
                <Divider />
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodyMd">
                      Successful Syncs
                    </Text>
                    <Badge tone="success">{data.stats.recentSyncs}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodyMd">
                      Failed Syncs
                    </Text>
                    <Badge tone={data.stats.failedSyncs > 0 ? "critical" : "info"}>
                      {data.stats.failedSyncs}
                    </Badge>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Sync Health Status
                </Text>
                <Divider />
                <Box paddingBlock="400">
                  <InlineStack align="center" blockAlign="center" gap="200">
                    <Badge
                      tone={
                        data.syncHealth === "healthy"
                          ? "success"
                          : data.syncHealth === "warning"
                          ? "warning"
                          : "critical"
                      }
                      size="large"
                    >
                      {data.syncHealth.toUpperCase()}
                    </Badge>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      {data.syncHealth === "healthy"
                        ? "All systems operational"
                        : data.syncHealth === "warning"
                        ? "Minor issues detected"
                        : "Attention required"}
                    </Text>
                  </InlineStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Recent Sync Operations
            </Text>
            <Divider />
            <SyncHistoryLog operations={data.recentOperations} compact />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

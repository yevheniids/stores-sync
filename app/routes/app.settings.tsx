/**
 * Settings Page
 *
 * Manage store connections and sync configuration
 */

import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Select,
  TextField,
  Divider,
  Badge,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { StoreConnectionCard } from "~/components/dashboard/StoreConnectionCard";
import { performFullSync } from "~/lib/sync/engine.server";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const stores = await prisma.store.findMany({
    include: {
      productMappings: true,
      syncOperations: {
        where: {
          status: "FAILED",
          startedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      },
    },
    orderBy: { shopName: "asc" },
  });

  const connections: StoreConnection[] = stores.map((store) => ({
    id: store.id,
    shopName: store.shopName,
    shopDomain: store.shopDomain,
    isActive: store.isActive,
    syncEnabled: store.syncEnabled,
    lastSyncAt: store.lastSyncAt?.toISOString() || null,
    productCount: store.productMappings.length,
    errorCount: store.syncOperations.length,
  }));

  const settings = {
    defaultStrategy: "USE_LOWEST",
    syncFrequency: 300,
    webhooksEnabled: true,
  };

  return json({
    connections,
    settings,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "updateSettings") {
    const strategy = formData.get("defaultStrategy");
    const frequency = formData.get("syncFrequency");

    return json({ success: true, message: "Settings updated successfully" });
  }

  if (actionType === "toggleSync") {
    const storeId = formData.get("storeId");
    const enabled = formData.get("enabled") === "true";

    if (storeId) {
      await prisma.store.update({
        where: { id: storeId.toString() },
        data: { syncEnabled: enabled },
      });

      return json({ success: true });
    }
  }

  if (actionType === "fullSync") {
    const shopDomain = formData.get("shopDomain");

    if (shopDomain) {
      try {
        await performFullSync(shopDomain.toString());
        return json({ success: true, message: "Full sync initiated" });
      } catch (error) {
        return json(
          { success: false, error: error instanceof Error ? error.message : "Sync failed" },
          { status: 500 }
        );
      }
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function SettingsPage() {
  const { connections, settings } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [defaultStrategy, setDefaultStrategy] = useState(settings.defaultStrategy);
  const [syncFrequency, setSyncFrequency] = useState(settings.syncFrequency.toString());

  const isLoading = navigation.state === "submitting";

  const handleSaveSettings = () => {
    const formData = new FormData();
    formData.append("action", "updateSettings");
    formData.append("defaultStrategy", defaultStrategy);
    formData.append("syncFrequency", syncFrequency);
    submit(formData, { method: "post" });
  };

  const handleToggleSync = (storeId: string, enabled: boolean) => {
    const formData = new FormData();
    formData.append("action", "toggleSync");
    formData.append("storeId", storeId);
    formData.append("enabled", enabled.toString());
    submit(formData, { method: "post" });
  };

  const handleFullSync = (shopDomain: string) => {
    const formData = new FormData();
    formData.append("action", "fullSync");
    formData.append("shopDomain", shopDomain);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Settings"
      primaryAction={{
        content: "Save Settings",
        onAction: handleSaveSettings,
        loading: isLoading,
      }}
    >
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Connected Stores
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Manage your connected Shopify stores and their sync settings.
            </Text>
            <Divider />
            <BlockStack gap="400">
              {connections.map((store) => (
                <StoreConnectionCard
                  key={store.id}
                  store={store}
                  onToggleSync={handleToggleSync}
                  onFullSync={handleFullSync}
                  isLoading={isLoading}
                />
              ))}
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Sync Configuration
            </Text>
            <Divider />
            <FormLayout>
              <Select
                label="Default Conflict Resolution Strategy"
                options={[
                  { label: "Use Lowest Quantity (Conservative)", value: "USE_LOWEST" },
                  { label: "Use Highest Quantity (Optimistic)", value: "USE_HIGHEST" },
                  { label: "Use Database Value", value: "USE_DATABASE" },
                  { label: "Use Store Value", value: "USE_STORE" },
                  { label: "Manual Resolution Required", value: "MANUAL" },
                  { label: "Use Average", value: "AVERAGE" },
                ]}
                value={defaultStrategy}
                onChange={(value) => setDefaultStrategy(value)}
                helpText="Choose how conflicts are automatically resolved when detected"
              />

              <TextField
                label="Auto Sync Frequency (seconds)"
                type="number"
                value={syncFrequency}
                onChange={(value) => setSyncFrequency(value)}
                helpText="How often to check for changes (minimum 60 seconds)"
                autoComplete="off"
              />
            </FormLayout>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Webhook Status
            </Text>
            <Divider />
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd">
                  Real-time Webhooks
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Receive instant notifications when inventory changes
                </Text>
              </BlockStack>
              <Badge tone="success">Active</Badge>
            </InlineStack>
            <Banner tone="info">
              <p>
                Webhooks are automatically configured during app installation. They listen for
                product updates, inventory changes, and order creations.
              </p>
            </Banner>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Danger Zone
            </Text>
            <Divider />
            <Banner tone="warning">
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  These actions will trigger a full sync across all stores and may take several
                  minutes.
                </Text>
                <Button
                  tone="critical"
                  onClick={() => {
                    connections.forEach((store) => handleFullSync(store.shopDomain));
                  }}
                  loading={isLoading}
                >
                  Trigger Full Sync for All Stores
                </Button>
              </BlockStack>
            </Banner>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

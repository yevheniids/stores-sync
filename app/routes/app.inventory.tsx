/**
 * Inventory Table Page
 *
 * Display and manage inventory across all stores
 */

import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Button,
  TextField,
  Select,
  InlineStack,
  BlockStack,
  Text,
  ButtonGroup,
  Filters,
  Pagination,
  EmptyState,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { syncProductToStore } from "~/lib/sync/engine.server";

interface InventoryItem {
  id: string;
  sku: string;
  title: string;
  centralQty: number;
  stores: Array<{
    name: string;
    quantity: number | null;
    status: "synced" | "out-of-sync" | "error";
    lastSynced: string | null;
  }>;
  syncStatus: "synced" | "out-of-sync" | "error";
  lastSynced: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("search") || "";
  const statusFilter = url.searchParams.get("status") || "";
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 20;

  const where: any = {};

  if (searchQuery) {
    where.OR = [
      { sku: { contains: searchQuery, mode: "insensitive" } },
      { title: { contains: searchQuery, mode: "insensitive" } },
    ];
  }

  const [products, totalCount, stores] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        inventory: true,
        storeMappings: {
          include: {
            store: true,
          },
        },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { sku: "asc" },
    }),
    prisma.product.count({ where }),
    prisma.store.findMany({
      where: { isActive: true },
      orderBy: { shopName: "asc" },
    }),
  ]);

  const inventoryItems: InventoryItem[] = products.map((product) => {
    const storeData = stores.map((store) => {
      const mapping = product.storeMappings.find((m) => m.storeId === store.id);
      return {
        name: store.shopName,
        quantity: mapping ? product.inventory?.availableQuantity || 0 : null,
        status: mapping?.syncStatus === "COMPLETED" ? "synced" : mapping?.syncStatus === "FAILED" ? "error" : "out-of-sync" as const,
        lastSynced: mapping?.lastSyncedAt?.toISOString() || null,
      };
    });

    const allSynced = storeData.every((s) => s.status === "synced");
    const hasError = storeData.some((s) => s.status === "error");

    return {
      id: product.id,
      sku: product.sku,
      title: product.title,
      centralQty: product.inventory?.availableQuantity || 0,
      stores: storeData,
      syncStatus: hasError ? "error" : allSynced ? "synced" : "out-of-sync",
      lastSynced: product.inventory?.lastAdjustedAt?.toISOString() || null,
    };
  });

  const filteredItems = statusFilter
    ? inventoryItems.filter((item) => item.syncStatus === statusFilter)
    : inventoryItems;

  return json({
    items: filteredItems,
    stores: stores.map((s) => ({ id: s.id, name: s.shopName, domain: s.shopDomain })),
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const actionType = formData.get("action");
  const sku = formData.get("sku");
  const shopDomain = formData.get("shopDomain");

  if (actionType === "sync" && sku && shopDomain) {
    await syncProductToStore(sku.toString(), shopDomain.toString());
    return json({ success: true });
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function InventoryPage() {
  const { items, stores, pagination } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [searchValue, setSearchValue] = useState(searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");

  const isLoading = navigation.state === "loading" || navigation.state === "submitting";

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  const handleFiltersClearAll = useCallback(() => {
    setSearchValue("");
    setStatusFilter("");
    setSearchParams({});
  }, [setSearchParams]);

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams();
    if (searchValue) params.set("search", searchValue);
    if (statusFilter) params.set("status", statusFilter);
    setSearchParams(params);
  }, [searchValue, statusFilter, setSearchParams]);

  const handleSync = useCallback(
    (sku: string, shopDomain: string) => {
      const formData = new FormData();
      formData.append("action", "sync");
      formData.append("sku", sku);
      formData.append("shopDomain", shopDomain);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <Select
          label="Status"
          labelHidden
          options={[
            { label: "All", value: "" },
            { label: "Synced", value: "synced" },
            { label: "Out of Sync", value: "out-of-sync" },
            { label: "Error", value: "error" },
          ]}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value)}
        />
      ),
    },
  ];

  const appliedFilters = [];
  if (statusFilter) {
    appliedFilters.push({
      key: "status",
      label: `Status: ${statusFilter}`,
      onRemove: () => {
        setStatusFilter("");
        const params = new URLSearchParams(searchParams);
        params.delete("status");
        setSearchParams(params);
      },
    });
  }

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
      <IndexTable.Cell>
        <ButtonGroup>
          {stores.map((store) => (
            <Button
              key={store.id}
              size="micro"
              onClick={() => handleSync(item.sku, store.domain)}
              loading={isLoading}
            >
              Sync {store.name}
            </Button>
          ))}
        </ButtonGroup>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const emptyStateMarkup = (
    <EmptyState
      heading="No products found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Try adjusting your search or filters to find what you're looking for.</p>
    </EmptyState>
  );

  return (
    <Page
      title="Inventory"
      primaryAction={{
        content: "Refresh",
        onAction: () => window.location.reload(),
      }}
    >
      <BlockStack gap="400">
        <Card padding="0">
          <BlockStack gap="0">
            <div style={{ padding: "16px" }}>
              <Filters
                queryValue={searchValue}
                queryPlaceholder="Search by SKU or product name"
                filters={filters}
                appliedFilters={appliedFilters}
                onQueryChange={handleSearchChange}
                onQueryClear={() => setSearchValue("")}
                onClearAll={handleFiltersClearAll}
              >
                <Button onClick={handleSearch}>Search</Button>
              </Filters>
            </div>

            <IndexTable
              resourceName={resourceName}
              itemCount={items.length}
              headings={[
                { title: "SKU" },
                { title: "Product Title" },
                { title: "Central Qty" },
                ...stores.map((store) => ({ title: store.name })),
                { title: "Status" },
                { title: "Actions" },
              ]}
              selectable={false}
              emptyState={emptyStateMarkup}
              loading={isLoading}
            >
              {rowMarkup}
            </IndexTable>

            {pagination.totalPages > 1 && (
              <div style={{ padding: "16px", display: "flex", justifyContent: "center" }}>
                <Pagination
                  hasPrevious={pagination.page > 1}
                  hasNext={pagination.page < pagination.totalPages}
                  onPrevious={() => {
                    const params = new URLSearchParams(searchParams);
                    params.set("page", (pagination.page - 1).toString());
                    setSearchParams(params);
                  }}
                  onNext={() => {
                    const params = new URLSearchParams(searchParams);
                    params.set("page", (pagination.page + 1).toString());
                    setSearchParams(params);
                  }}
                />
              </div>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

/**
 * Sync History Page
 *
 * Display paginated log of all sync operations
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  TextField,
  Select,
  InlineStack,
  BlockStack,
  Text,
  Filters,
  Pagination,
  EmptyState,
  Button,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";

interface HistoryItem {
  id: string;
  timestamp: string;
  productSku: string | null;
  operationType: string;
  direction: string;
  status: string;
  storeName: string | null;
  errorMessage: string | null;
  details: any;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 50;
  const statusFilter = url.searchParams.get("status") || "";
  const operationFilter = url.searchParams.get("operation") || "";
  const searchQuery = url.searchParams.get("search") || "";

  const where: any = {};

  if (statusFilter) {
    where.status = statusFilter;
  }

  if (operationFilter) {
    where.operationType = operationFilter;
  }

  if (searchQuery) {
    where.product = {
      sku: { contains: searchQuery, mode: "insensitive" },
    };
  }

  const [operations, totalCount] = await Promise.all([
    prisma.syncOperation.findMany({
      where,
      include: {
        product: true,
        store: true,
      },
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.syncOperation.count({ where }),
  ]);

  const historyItems: HistoryItem[] = operations.map((op) => ({
    id: op.id,
    timestamp: op.startedAt.toISOString(),
    productSku: op.product?.sku || null,
    operationType: op.operationType,
    direction: op.direction,
    status: op.status,
    storeName: op.store?.shopName || null,
    errorMessage: op.errorMessage,
    details: {
      previousValue: op.previousValue,
      newValue: op.newValue,
      triggeredBy: op.triggeredBy,
    },
  }));

  return json({
    items: historyItems,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    },
  });
};

export default function HistoryPage() {
  const { items, pagination } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchValue, setSearchValue] = useState(searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [operationFilter, setOperationFilter] = useState(searchParams.get("operation") || "");

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  const handleFiltersClearAll = useCallback(() => {
    setSearchValue("");
    setStatusFilter("");
    setOperationFilter("");
    setSearchParams({});
  }, [setSearchParams]);

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams();
    if (searchValue) params.set("search", searchValue);
    if (statusFilter) params.set("status", statusFilter);
    if (operationFilter) params.set("operation", operationFilter);
    setSearchParams(params);
  }, [searchValue, statusFilter, operationFilter, setSearchParams]);

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
            { label: "Completed", value: "COMPLETED" },
            { label: "Failed", value: "FAILED" },
            { label: "In Progress", value: "IN_PROGRESS" },
            { label: "Pending", value: "PENDING" },
          ]}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value)}
        />
      ),
    },
    {
      key: "operation",
      label: "Operation Type",
      filter: (
        <Select
          label="Operation"
          labelHidden
          options={[
            { label: "All", value: "" },
            { label: "Inventory Update", value: "INVENTORY_UPDATE" },
            { label: "Product Create", value: "PRODUCT_CREATE" },
            { label: "Product Update", value: "PRODUCT_UPDATE" },
            { label: "Bulk Sync", value: "BULK_SYNC" },
          ]}
          value={operationFilter}
          onChange={(value) => setOperationFilter(value)}
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
  if (operationFilter) {
    appliedFilters.push({
      key: "operation",
      label: `Operation: ${operationFilter}`,
      onRemove: () => {
        setOperationFilter("");
        const params = new URLSearchParams(searchParams);
        params.delete("operation");
        setSearchParams(params);
      },
    });
  }

  const resourceName = {
    singular: "operation",
    plural: "operations",
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const rowMarkup = items.map((item, index) => (
    <IndexTable.Row id={item.id} key={item.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {formatDate(item.timestamp)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {item.productSku || "-"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge>{item.operationType}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">{item.direction}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge
          tone={
            item.status === "COMPLETED"
              ? "success"
              : item.status === "FAILED"
              ? "critical"
              : item.status === "IN_PROGRESS"
              ? "info"
              : "warning"
          }
        >
          {item.status}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {item.storeName || "-"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {item.errorMessage ? (
          <Text as="span" variant="bodySm" tone="critical">
            {item.errorMessage.substring(0, 50)}
            {item.errorMessage.length > 50 ? "..." : ""}
          </Text>
        ) : (
          <Text as="span" variant="bodySm" tone="subdued">
            -
          </Text>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const emptyStateMarkup = (
    <EmptyState
      heading="No sync operations found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Try adjusting your search or filters to find what you're looking for.</p>
    </EmptyState>
  );

  return (
    <Page
      title="Sync History"
      subtitle={`${pagination.totalCount} total operations`}
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
                queryPlaceholder="Search by product SKU"
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
                { title: "Timestamp" },
                { title: "Product SKU" },
                { title: "Operation" },
                { title: "Direction" },
                { title: "Status" },
                { title: "Store" },
                { title: "Details" },
              ]}
              selectable={false}
              emptyState={emptyStateMarkup}
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

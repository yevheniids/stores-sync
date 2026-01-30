import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return json({ showForm: Boolean(login) });
};

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.heading}>Store Sync App</h1>
        <p style={styles.text}>Multi-store inventory synchronization</p>
        {showForm && (
          <Form method="post" action="/auth/login">
            <label style={styles.label}>
              <span>Shop domain</span>
              <input
                type="text"
                name="shop"
                placeholder="my-store.myshopify.com"
                style={styles.input}
              />
            </label>
            <button type="submit" style={styles.button}>
              Log in
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    background: "#f6f6f7",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  } as React.CSSProperties,
  card: {
    background: "white",
    borderRadius: "8px",
    padding: "40px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
    maxWidth: "400px",
    width: "100%",
  } as React.CSSProperties,
  heading: {
    fontSize: "24px",
    fontWeight: 600,
    color: "#202223",
    marginBottom: "8px",
  } as React.CSSProperties,
  text: {
    fontSize: "16px",
    color: "#6d7175",
    marginBottom: "24px",
  } as React.CSSProperties,
  label: {
    display: "block",
    marginBottom: "16px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#202223",
  } as React.CSSProperties,
  input: {
    display: "block",
    width: "100%",
    padding: "8px 12px",
    fontSize: "14px",
    border: "1px solid #c9cccf",
    borderRadius: "4px",
    marginTop: "4px",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  button: {
    display: "block",
    width: "100%",
    padding: "12px",
    background: "#008060",
    color: "white",
    border: "none",
    borderRadius: "4px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,
};

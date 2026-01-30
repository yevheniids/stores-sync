/**
 * Webhook Route: products/delete
 * 
 * This route handles webhook callbacks from Shopify for product deletion.
 * All webhooks are processed by the unified webhook handler.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { action as webhookAction } from "./webhooks";

export const action = webhookAction;

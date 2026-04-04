/**
 * MCP tool handlers for the Verified Data Marketplace.
 */

import type { McpQueryBackend } from "./mcp-query-backend";

type McpTextResult = { content: Array<{ type: "text"; text: string }> };

export async function handleMarketplaceListData(
  backend: McpQueryBackend,
  activeOnly: boolean,
): Promise<McpTextResult> {
  const baseUrl = process.env.REMOTE_QUERY_API_BASE_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/marketplace/listings`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { content: [{ type: "text", text: `Failed to list marketplace data: ${res.status} ${res.statusText}` }] };
    }
    const listings = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(listings, null, 2) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error listing marketplace data: ${msg}` }] };
  }
}

export async function handleMarketplaceBuyData(
  backend: McpQueryBackend,
  listingId: string,
  cashuToken: string,
): Promise<McpTextResult> {
  const baseUrl = process.env.REMOTE_QUERY_API_BASE_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/marketplace/data/${listingId}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-cashu": cashuToken,
      },
    });

    const body = await res.text();
    if (!res.ok) {
      return { content: [{ type: "text", text: `Purchase failed (${res.status}): ${body}` }] };
    }
    return { content: [{ type: "text", text: body }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error purchasing data: ${msg}` }] };
  }
}

export async function handleMarketplaceSearchListings(
  backend: McpQueryBackend,
  query: string,
): Promise<McpTextResult> {
  const baseUrl = process.env.REMOTE_QUERY_API_BASE_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/marketplace/listings`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { content: [{ type: "text", text: `Failed to search listings: ${res.status} ${res.statusText}` }] };
    }
    const listings = (await res.json()) as Array<{ name?: string; description?: string }>;
    const lowerQuery = query.toLowerCase();
    const matched = listings.filter((l) => {
      const name = (l.name ?? "").toLowerCase();
      const desc = (l.description ?? "").toLowerCase();
      return name.includes(lowerQuery) || desc.includes(lowerQuery);
    });
    return { content: [{ type: "text", text: JSON.stringify(matched, null, 2) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error searching listings: ${msg}` }] };
  }
}

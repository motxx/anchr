import React from "react";
import { DSBadge, type DSBadgeProps } from "./ds";
import type { QueryStatus } from "../api/types";

const STATUS_CONFIG: Record<QueryStatus, DSBadgeProps> = {
  pending: { label: "Pending", variant: "default" },
  awaiting_quotes: { label: "Awaiting Quotes", dotColor: "bg-violet-500", textColor: "text-violet-400" },
  worker_selected: { label: "Worker Selected", dotColor: "bg-indigo-500", textColor: "text-indigo-400" },
  processing: { label: "Processing", variant: "warning" },
  verifying: { label: "Verifying", variant: "info" },
  submitted: { label: "Submitted", variant: "default" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "error" },
  expired: { label: "Expired", variant: "muted" },
};

export function StatusBadge({ status }: { status: QueryStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return <DSBadge {...config} />;
}

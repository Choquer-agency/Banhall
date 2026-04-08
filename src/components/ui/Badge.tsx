const statusConfig: Record<string, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-gray-100 text-gray-600",
  },
  generating: {
    label: "Generating",
    className: "bg-blue-50 text-blue-600 animate-pulse",
  },
  review: {
    label: "Review",
    className: "bg-amber-50 text-amber-700",
  },
  client_review: {
    label: "Client Review",
    className: "bg-purple-50 text-purple-600",
  },
  final: {
    label: "Final",
    className: "bg-primary/15 text-navy",
  },
};

export function Badge({ status }: { status: string }) {
  const config = statusConfig[status] ?? {
    label: status,
    className: "bg-gray-100 text-gray-600",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

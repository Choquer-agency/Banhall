"use client";

import Link from "next/link";

interface IconActionProps {
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}

/** Sub-menu action showing an icon with its label beside it. */
export function IconAction({
  icon,
  label,
  title,
  onClick,
  href,
  disabled,
}: IconActionProps) {
  const className =
    "flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-navy transition-colors hover:bg-chrome disabled:opacity-50";

  const inner = (
    <>
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} title={title ?? label} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {inner}
    </button>
  );
}

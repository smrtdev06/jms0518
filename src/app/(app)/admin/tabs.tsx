"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Bot, Briefcase, DatabaseBackup, FileStack, Mail, ScrollText, Settings, Users } from "lucide-react";

const TABS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/jobs", label: "Job links", icon: Briefcase },
  { href: "/admin/bot-links", label: "Bot links", icon: Bot },
  { href: "/admin/templates", label: "Templates", icon: FileStack },
  { href: "/admin/activity", label: "Activity log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/backup", label: "Backup", icon: DatabaseBackup },
  { href: "/admin/gmail", label: "Gmail", icon: Mail },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    // Scrolls sideways on narrow screens (scrollbar hidden). The active underline is drawn inside the tab, so nothing
    // sticks out below the bar (that used to give it a vertical scrollbar).
    <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm transition",
              active ? "text-fg shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

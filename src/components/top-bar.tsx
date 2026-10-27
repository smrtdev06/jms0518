"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogOut } from "lucide-react";
import { can, ROLE_LABELS, type Role } from "@/lib/roles";

type Props = { user: { displayName: string; role: Role } };

const MENU = [
  { href: "/tailor", label: "Resume Tailor", show: can.tailor },
  { href: "/applying", label: "Applying Management", show: can.apply },
  { href: "/interviews", label: "Interview Schedule", show: can.viewInterviews },
  { href: "/dashboard", label: "Dashboard", show: can.viewDashboard },
  { href: "/team", label: "Team", show: can.manageTeam },
  { href: "/admin", label: "Administrator", show: can.administer },
];

export function TopBar({ user }: Props) {
  const pathname = usePathname();
  const items = MENU.filter((m) => m.show(user.role));
  // Administrators, bosses, bidders and callers work on a single page, so they get a title instead of a menu.
  const showMenu = items.length > 1;

  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-sky-400 text-xs font-bold text-white">
          J
        </div>
        {showMenu ? (
          <nav className="-mx-1 flex h-full min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* Full header height so the active underline sits inside the nav and never causes overflow. */}
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} className="relative flex items-center whitespace-nowrap">
                  <span
                    className={clsx(
                      "rounded-md px-3 py-1.5 text-sm transition",
                      active ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
                    )}
                  >
                    {item.label}
                  </span>
                  {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
                </Link>
              );
            })}
          </nav>
        ) : (
          <div className="flex-1 truncate text-sm font-medium">{items[0]?.label}</div>
        )}
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-xs font-medium leading-tight">{user.displayName}</div>
            <div className="text-[11px] leading-tight text-muted">{ROLE_LABELS[user.role]}</div>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="btn btn-ghost px-2" title="Sign out" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

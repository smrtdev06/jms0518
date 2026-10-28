import { NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { createBackup, readBackup, restoreBackup } from "@/lib/backup";

export const maxDuration = 300;

// GET: download the whole database as jms-backup-<date>.json.gz.
export const GET = route(async () => {
  const admin = await requireApiUser(can.administer);
  const file = await createBackup();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  await audit(admin.id, "db.backup_downloaded", "database", null, { bytes: file.length });
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="jms-backup-${stamp}.json.gz"`,
      "Cache-Control": "no-store",
    },
  });
});

// POST (body = the backup file): replace the whole database with the backup.
export const POST = route(async (request) => {
  const admin = await requireApiUser(can.administer);
  const file = readBackup(Buffer.from(await request.arrayBuffer()));
  const restored = await restoreBackup(file);
  // Written after the restore, so the log of the restored database keeps this entry. The administrator's id may
  // not exist in the backup; then the entry has no user.
  await audit(admin.id, "db.restored", "database", null, { backup_from: file.created_at, ...restored }).catch(() =>
    audit(null, "db.restored", "database", null, { backup_from: file.created_at, by: admin.username, ...restored }),
  );
  return NextResponse.json({ ok: true, restored, backup_from: file.created_at });
});

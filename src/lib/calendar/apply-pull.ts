import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  expandEventWindow,
  instanceWindow,
  type EventException,
  type EventMaster,
  type EventStatus,
  type Transparency,
} from "@/lib/calendar/expand";
import type { PullResult, RemoteEvent } from "@/lib/calendar/providers/types";

type ReplicaEvent = {
  id: string;
  providerEventId: string;
  icalUid: string | null;
  recurrenceId: Date | null;
  masterEventId: string | null;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  transparency: string;
  status: string;
};

function asJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function isRemoteException(event: RemoteEvent): boolean {
  return event.recurrenceId != null || event.masterProviderEventId != null;
}

function isReplicaMaster(row: ReplicaEvent): boolean {
  return row.recurrenceId == null && row.masterEventId == null;
}

function asReplica(row: ReplicaEvent): ReplicaEvent {
  return {
    id: row.id,
    providerEventId: row.providerEventId,
    icalUid: row.icalUid ?? null,
    recurrenceId: row.recurrenceId ?? null,
    masterEventId: row.masterEventId ?? null,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    isAllDay: row.isAllDay,
    timezone: row.timezone ?? null,
    rrule: row.rrule ?? null,
    rdate: row.rdate ?? null,
    exdate: row.exdate ?? null,
    transparency: row.transparency,
    status: row.status,
  };
}

function replicaFields(
  event: RemoteEvent,
  userId: string,
  calendarId: string,
  masterEventId: string | null,
) {
  return {
    providerEventId: event.providerEventId,
    icalUid: event.icalUid,
    etag: event.etag,
    sequence: event.sequence,
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    isAllDay: event.isAllDay,
    timezone: event.timezone,
    status: event.status,
    transparency: event.transparency,
    rrule: event.rrule,
    rdate: event.rdate,
    exdate: event.exdate,
    masterEventId,
    recurrenceId: event.recurrenceId,
    organizerJson: asJson(event.organizerJson),
    attendeesJson: asJson(event.attendeesJson),
    rawJson: asJson(event.rawJson),
    calendarId,
    userId,
  };
}

function findMaster(
  byProviderId: Map<string, ReplicaEvent>,
  mastersByIcalUid: Map<string, ReplicaEvent>,
  event: RemoteEvent,
): ReplicaEvent | undefined {
  if (event.masterProviderEventId) {
    return byProviderId.get(event.masterProviderEventId);
  }
  // CalDAV exceptions omit masterProviderEventId; join via UID.
  if (event.icalUid) return mastersByIcalUid.get(event.icalUid);
  return undefined;
}

function indexMasters(byId: Map<string, ReplicaEvent>): Map<string, ReplicaEvent> {
  const mastersByIcalUid = new Map<string, ReplicaEvent>();
  for (const row of byId.values()) {
    if (isReplicaMaster(row) && row.icalUid) {
      mastersByIcalUid.set(row.icalUid, row);
    }
  }
  return mastersByIcalUid;
}

function toEventMaster(row: ReplicaEvent): EventMaster {
  const transparency: Transparency =
    row.transparency === "free" ? "free" : "busy";
  const status: EventStatus =
    row.status === "cancelled" || row.status === "tentative"
      ? row.status
      : "confirmed";
  return {
    id: row.id,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    rrule: row.rrule,
    rdate: row.rdate,
    exdate: row.exdate,
    transparency,
    status,
  };
}

function exceptionsForMaster(
  master: ReplicaEvent,
  byId: Map<string, ReplicaEvent>,
): EventException[] {
  const rows: EventException[] = [];
  for (const row of byId.values()) {
    if (row.id === master.id || row.recurrenceId == null) continue;
    const linked =
      row.masterEventId === master.id ||
      (row.masterEventId == null &&
        row.icalUid != null &&
        row.icalUid === master.icalUid);
    if (!linked) continue;
    rows.push({
      masterEventId: master.id,
      recurrenceId: row.recurrenceId,
      startAt: row.startAt,
      endAt: row.endAt,
      isAllDay: row.isAllDay,
      isCancelled: row.status === "cancelled",
      title: row.title,
    });
  }
  return rows;
}

type ReplicaTx = Pick<
  typeof db,
  "calendarEvent" | "calendarEventInstance" | "calendarTombstone"
>;

export async function applyPull(input: {
  userId: string;
  accountId: string;
  calendarId: string;
  pull: PullResult;
  now: Date;
}): Promise<{ upserted: number; deleted: number }> {
  return db.$transaction((tx) => applyPullTx(tx, input));
}

async function applyPullTx(
  tx: ReplicaTx,
  input: {
    userId: string;
    accountId: string;
    calendarId: string;
    pull: PullResult;
    now: Date;
  },
): Promise<{ upserted: number; deleted: number }> {
  const { userId, calendarId, pull, now } = input;

  const existing = await tx.calendarEvent.findMany({
    where: { userId, calendarId },
  });

  const byId = new Map<string, ReplicaEvent>();
  const byProviderId = new Map<string, ReplicaEvent>();
  for (const raw of existing) {
    const row = asReplica(raw);
    byId.set(row.id, row);
    byProviderId.set(row.providerEventId, row);
  }

  const masters = pull.upserts.filter((event) => !isRemoteException(event));
  const exceptions = pull.upserts.filter(isRemoteException);
  const touchedMasterIds = new Set<string>();

  for (const event of masters) {
    const data = replicaFields(event, userId, calendarId, null);
    const saved = asReplica(
      (await tx.calendarEvent.upsert({
        where: {
          calendarId_providerEventId: {
            calendarId,
            providerEventId: event.providerEventId,
          },
        },
        create: data,
        update: data,
      })) as ReplicaEvent,
    );
    byId.set(saved.id, saved);
    byProviderId.set(saved.providerEventId, saved);
    touchedMasterIds.add(saved.id);
  }

  const mastersByIcalUid = indexMasters(byId);
  for (const event of exceptions) {
    const master = findMaster(byProviderId, mastersByIcalUid, event);
    const data = replicaFields(event, userId, calendarId, master?.id ?? null);
    const saved = asReplica(
      (await tx.calendarEvent.upsert({
        where: {
          calendarId_providerEventId: {
            calendarId,
            providerEventId: event.providerEventId,
          },
        },
        create: data,
        update: data,
      })) as ReplicaEvent,
    );
    byId.set(saved.id, saved);
    byProviderId.set(saved.providerEventId, saved);
    if (master) touchedMasterIds.add(master.id);
  }

  const upsertProviderIds = new Set(
    pull.upserts.map((event) => event.providerEventId),
  );
  const deletedProviderIds = new Set(pull.deletedProviderIds);
  // complete+reset is an exhaustive listing (no token, or retry after 410 /
  // invalid token). Incremental pages may still set complete today; missing
  // replica rows must stay unless the provider named them in deletedProviderIds.
  const deleteMissing = pull.complete && pull.reset;
  const deleteIds: string[] = [];
  for (const row of byId.values()) {
    const named = deletedProviderIds.has(row.providerEventId);
    const missing = deleteMissing && !upsertProviderIds.has(row.providerEventId);
    if (named || missing) deleteIds.push(row.id);
  }

  const deletedRows = deleteIds.map((id) => byId.get(id)!);
  for (const row of deletedRows) {
    if (isReplicaMaster(row)) continue;
    if (row.masterEventId) {
      touchedMasterIds.add(row.masterEventId);
      continue;
    }
    if (row.icalUid) {
      const master = mastersByIcalUid.get(row.icalUid);
      if (master) touchedMasterIds.add(master.id);
    }
  }

  const deletedMasters = deletedRows.filter(isReplicaMaster);
  if (deletedMasters.length > 0) {
    await tx.calendarTombstone.createMany({
      data: deletedMasters.map((row) => ({
        eventId: row.id,
        providerEventId: row.providerEventId,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  if (deleteIds.length > 0) {
    await tx.calendarEvent.deleteMany({
      where: { userId, calendarId, id: { in: deleteIds } },
    });
  }

  for (const id of deleteIds) {
    const row = byId.get(id);
    byId.delete(id);
    if (row) byProviderId.delete(row.providerEventId);
    touchedMasterIds.delete(id);
  }

  const rebuildIds = [...touchedMasterIds].filter((id) => byId.has(id));
  if (rebuildIds.length > 0) {
    await tx.calendarEventInstance.deleteMany({
      where: { userId, calendarId, eventId: { in: rebuildIds } },
    });

    const { from, to } = instanceWindow(now);
    const instanceRows: Array<{
      startAt: Date;
      endAt: Date;
      isAllDay: boolean;
      isCancelled: boolean;
      isException: boolean;
      eventId: string;
      calendarId: string;
      userId: string;
    }> = [];
    for (const id of rebuildIds) {
      const master = byId.get(id);
      if (!master) continue;
      for (const row of expandEventWindow(
        toEventMaster(master),
        exceptionsForMaster(master, byId),
        from,
        to,
      )) {
        instanceRows.push({
          startAt: row.startAt,
          endAt: row.endAt,
          isAllDay: row.isAllDay,
          isCancelled: row.isCancelled,
          isException: row.isException,
          eventId: row.eventId,
          calendarId,
          userId,
        });
      }
    }

    if (instanceRows.length > 0) {
      await tx.calendarEventInstance.createMany({ data: instanceRows });
    }
  }

  return { upserted: pull.upserts.length, deleted: deleteIds.length };
}

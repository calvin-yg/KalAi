import { promises as fs } from "node:fs";
import path from "node:path";
import type { Database, Entry, Profile, UserRecord, UserSummary, WeighIn } from "./types";

/**
 * Small shared-household datastore: a JSON file for the log, and real files on
 * disk for the photos. Reads and writes are serialised through one promise chain
 * so two phones posting at once can't interleave a read-modify-write.
 *
 * Photos live outside the JSON deliberately — inlined as data URLs they would
 * push the file into the tens of megabytes within a few weeks of two people
 * logging, and every read parses the whole thing.
 */

const DATA_DIR = process.env.KALAI_DATA_DIR
  ? path.resolve(process.env.KALAI_DATA_DIR)
  : path.join(process.cwd(), "data");

const DB_PATH = path.join(DATA_DIR, "db.json");
export const PHOTO_DIR = path.join(DATA_DIR, "photos");

function emptyUser(id: string): UserRecord {
  return { id, profile: null, entries: [], weighIns: [] };
}

let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // Keep the chain alive even if this piece of work rejected.
  queue = next.catch(() => undefined);
  return next;
}

async function readRaw(): Promise<Database> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await fs.readFile(DB_PATH, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { users: {} };
    throw error;
  }

  // Migrate the original single-user file shape into the first user's record.
  if (!parsed.users && (parsed.profile || parsed.entries)) {
    return {
      users: {
        one: {
          id: "one",
          profile: (parsed.profile as Profile | null) ?? null,
          entries: (parsed.entries as Entry[]) ?? [],
          weighIns: (parsed.weighIns as WeighIn[]) ?? [],
        },
      },
    };
  }

  return { users: (parsed.users as Record<string, UserRecord>) ?? {} };
}

async function writeRaw(db: Database): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

function mutate<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  return serialise(async () => {
    const db = await readRaw();
    const result = await fn(db);
    await writeRaw(db);
    return result;
  });
}

function userIn(db: Database, userId: string): UserRecord {
  db.users[userId] ??= emptyUser(userId);
  return db.users[userId];
}

export function readUser(userId: string): Promise<UserRecord> {
  return serialise(async () => {
    const db = await readRaw();
    return db.users[userId] ?? emptyUser(userId);
  });
}

/** Everyone with a completed profile, for the switcher on the dashboard. */
export function listUsers(): Promise<UserSummary[]> {
  return serialise(async () => {
    const db = await readRaw();
    return Object.values(db.users)
      .filter((user) => user.profile !== null)
      .map((user) => ({ id: user.id, name: user.profile?.name || "Unnamed" }));
  });
}

export function saveProfile(userId: string, profile: Profile): Promise<Profile> {
  return mutate((db) => {
    userIn(db, userId).profile = profile;
    return profile;
  });
}

export function addEntry(userId: string, entry: Entry): Promise<Entry> {
  return mutate((db) => {
    const user = userIn(db, userId);
    user.entries.push(entry);
    user.entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return entry;
  });
}

export function updateEntry(
  userId: string,
  id: string,
  patch: Partial<Omit<Entry, "id">>,
): Promise<Entry | null> {
  return mutate((db) => {
    const found = userIn(db, userId).entries.find((e) => e.id === id);
    if (!found) return null;
    Object.assign(found, patch);
    return found;
  });
}

export function deleteEntry(userId: string, id: string): Promise<Entry | null> {
  return mutate((db) => {
    const user = userIn(db, userId);
    const found = user.entries.find((e) => e.id === id);
    if (!found) return null;
    user.entries = user.entries.filter((e) => e.id !== id);
    return found;
  });
}

export function recordWeighIn(userId: string, weighIn: WeighIn): Promise<WeighIn> {
  return mutate((db) => {
    const user = userIn(db, userId);
    const existing = user.weighIns.find((w) => w.date === weighIn.date);
    if (existing) {
      existing.weightKg = weighIn.weightKg;
    } else {
      user.weighIns.push(weighIn);
      user.weighIns.sort((a, b) => a.date.localeCompare(b.date));
    }
    if (user.profile) user.profile.weightKg = weighIn.weightKg;
    return weighIn;
  });
}

/** Write a photo to disk and return the filename to store on the entry. */
export async function savePhoto(entryId: string, jpegBase64: string): Promise<string> {
  await fs.mkdir(PHOTO_DIR, { recursive: true });
  const name = `${entryId}.jpg`;
  await fs.writeFile(path.join(PHOTO_DIR, name), Buffer.from(jpegBase64, "base64"));
  return name;
}

export async function readPhoto(name: string): Promise<Buffer | null> {
  // Only ever a bare filename we generated — never a caller-supplied path.
  if (!/^[\w-]+\.jpg$/.test(name)) return null;
  try {
    return await fs.readFile(path.join(PHOTO_DIR, name));
  } catch {
    return null;
  }
}

export async function deletePhoto(name: string | null): Promise<void> {
  if (!name || !/^[\w-]+\.jpg$/.test(name)) return;
  await fs.rm(path.join(PHOTO_DIR, name), { force: true });
}

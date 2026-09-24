import { Readable } from "node:stream";
import { google } from "googleapis";
import { env, googleDriveConfigured } from "../../config/env.js";

/**
 * Archives generated invoice PDFs to Google Drive, alongside the zip
 * download the admin already gets — see the Settings → Google Drive section
 * for how a folder gets connected.
 *
 * A service account, not an OAuth app: there is no per-user consent screen
 * or refresh token to manage, only one long-lived credential (like HA_TOKEN
 * or CF_API_TOKEN) — the key file's whole JSON content, in the environment
 * rather than a mounted file, since not every host this app runs on has a
 * convenient way to get an extra file into the container. Its entire access
 * boundary is Drive's own sharing model — it can only ever see a folder its
 * owner explicitly shared with the account's email address, nothing else in
 * anyone's Drive, regardless of the OAuth scope requested. `drive` (not the
 * narrower `drive.file`) is used because `drive.file` only grants access to
 * items the *app itself* created — a folder the admin created and shared by
 * hand would not be visible under that scope.
 */

export { googleDriveConfigured };

interface ServiceAccountKey {
  client_email?: string;
}

let cachedKey: ServiceAccountKey | null | undefined;

function serviceAccountKey(): ServiceAccountKey | null {
  if (!googleDriveConfigured) return null;
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = JSON.parse(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON!) as ServiceAccountKey;
  return cachedKey;
}

/** The service account's own address — what a site's admin shares a folder with. */
export async function serviceAccountEmail(): Promise<string | null> {
  return serviceAccountKey()?.client_email ?? null;
}

function driveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey() ?? undefined,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

export class DriveFolderAccessError extends Error {}

/**
 * Confirms the service account can actually see `folderId` and that it is a
 * folder, not some other file — the two ways a pasted id is wrong. Returns
 * the folder's own name, so the Settings page can show what got connected
 * rather than just an opaque id.
 */
export async function verifyFolderAccess(folderId: string): Promise<{ name: string }> {
  if (!googleDriveConfigured) {
    throw new DriveFolderAccessError("Google Drive isn't configured on the server.");
  }
  const drive = driveClient();

  // A Shared Drive's own root (id starting "0A...") is a Drive resource, not
  // a File one — files.get 404s on it even with supportsAllDrives. Try that
  // first since its id shape is recognisable, then fall back to a regular
  // folder (or a folder *inside* a Shared Drive, which files.get does cover).
  if (folderId.startsWith("0A")) {
    try {
      const res = await drive.drives.get({ driveId: folderId, fields: "id, name" });
      return { name: res.data.name ?? folderId };
    } catch {
      throw new DriveFolderAccessError(
        "Couldn't access that shared drive — check the id and that the service account is a member.",
      );
    }
  }

  let data;
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType, trashed",
      supportsAllDrives: true,
    });
    data = res.data;
  } catch {
    throw new DriveFolderAccessError(
      "Couldn't access that folder — check the id and that it's shared with the service account.",
    );
  }
  if (data.trashed) throw new DriveFolderAccessError("That folder is in the trash.");
  if (data.mimeType !== "application/vnd.google-apps.folder") {
    throw new DriveFolderAccessError("That id isn't a folder.");
  }
  return { name: data.name ?? folderId };
}

/**
 * Escapes a name for Drive's `q` search syntax — single quotes end the
 * string literal, and a backslash is its own escape character.
 */
function escapeForDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Finds a subfolder by exact name directly under `parentId`, creating it if
 * none exists yet — one call per period per batch (see generateInvoices),
 * not per invoice, so every party in the same period's batch lands in the
 * same folder rather than racing to create their own.
 */
export async function findOrCreateSubfolder(parentId: string, name: string): Promise<string> {
  const drive = driveClient();
  const q = [
    `'${parentId}' in parents`,
    `name = '${escapeForDriveQuery(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");
  const list = await drive.files.list({
    q,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
    pageSize: 1,
  });
  const existing = list.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: { name, parents: [parentId], mimeType: "application/vnd.google-apps.folder" },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error(`Drive subfolder "${name}" created but returned no id.`);
  return created.data.id;
}

/**
 * Uploads one PDF into an already-verified folder. Called from invoice
 * generation, always best-effort — a failure here must never fail the
 * generate call itself, so callers catch and log rather than propagate.
 *
 * The file is left with no sharing of its own: the service account created
 * it, so it can always read it back, and that is the only reader this app
 * needs. A participant's download instead goes through this server (see
 * `downloadPdf` and invoices/routes.ts's `/pdf` route), which checks their
 * session and that the invoice is theirs before ever asking Drive for it —
 * so the PDF's real access control is the app's own auth, not an
 * unguessable Drive link that anyone holding it could open.
 */
export async function uploadPdf(folderId: string, filename: string, pdf: Buffer): Promise<string> {
  const drive = driveClient();
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: "application/pdf", body: Readable.from(pdf) },
    fields: "id",
    supportsAllDrives: true,
  });
  const fileId = res.data.id;
  if (!fileId) throw new Error("Drive upload succeeded but returned no file id.");
  return fileId;
}

export class DrivePdfNotFoundError extends Error {}

/**
 * Streams a previously uploaded PDF back out, for the app's own download
 * route to relay to a browser. `alt: "media"` is what turns a Drive `files`
 * call from metadata into the file's actual bytes; `responseType: "stream"`
 * keeps the whole PDF from being buffered into memory before the first byte
 * reaches the client.
 */
export async function downloadPdf(fileId: string): Promise<NodeJS.ReadableStream> {
  const drive = driveClient();
  try {
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" },
    );
    return res.data;
  } catch {
    throw new DrivePdfNotFoundError(`Drive file ${fileId} could not be read.`);
  }
}

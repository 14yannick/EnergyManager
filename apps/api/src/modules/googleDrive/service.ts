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
 * Uploads one PDF into an already-verified folder. Called from invoice
 * generation, always best-effort — a failure here must never fail the
 * generate call itself, so callers catch and log rather than propagate.
 *
 * The uploaded file is given "anyone with the link" read access. The folder
 * being shared with the service account only gives *its owner* (the admin)
 * access to what's inside — a participant is a different identity entirely,
 * often with no Google account at all, so without this the Account page's
 * download link would 403 for every participant but the admin. The link
 * itself (a long, unguessable file id) is not discoverable or indexed —
 * this is the same trade-off "unlisted" video/doc links make, not a public
 * listing — but it does mean anyone who obtains that exact URL can open it.
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
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });
  return fileId;
}

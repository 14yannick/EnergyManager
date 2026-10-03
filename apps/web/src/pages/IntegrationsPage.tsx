import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CfAccessSyncResult, Site } from "@energy-manager/shared";
import { api } from "../api/client";
import { Field } from "../components/Field";
import { useT } from "../i18n/context";
import { useCanEdit } from "../lib/useIdentity";
import { useCurrentSite } from "../lib/useCurrentSite";

/**
 * The outside services this installation talks to, and whether each is
 * reachable: Home Assistant for the energy data, Cloudflare Access for who
 * may sign in, Google Drive for the invoice archive.
 *
 * They sat at the bottom of the site's own settings, below sensors and
 * investment figures that are about one site. These are about the
 * installation: one Home Assistant and one Cloudflare application serve
 * every site. Drive is the exception that proves the split useful — the
 * account is the installation's, the folder is the site's, so its card
 * names the site it is showing.
 */
export function IntegrationsPage() {
  const t = useT();
  const { site } = useCurrentSite();
  // Admin-only writes, as on Site administration: a viewer sees the state
  // of each connection and no button that would only be refused.
  const { canEdit, isKnown } = useCanEdit();

  if (!site) return <p className="text-slate-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("integrations.title")}</h1>
        <p className="max-w-3xl text-sm text-slate-500">{t("integrations.intro")}</p>
      </div>

      {isKnown && !canEdit && (
        <p className="rounded-lg border border-slate-300 bg-slate-100 p-4 text-sm text-slate-600">
          {t("common.readOnly")}
        </p>
      )}

      <HomeAssistantSection />

      <CloudflareAccessSection canEdit={canEdit} />

      <GoogleDriveSection site={site} canEdit={canEdit} />
    </div>
  );
}

/**
 * Whether the server can reach Home Assistant, and how often it pulls.
 * Read-only: the address and the token are the server's environment, not
 * something this page can change. Which sensors a site reads is that
 * site's business, under Site administration.
 */
function HomeAssistantSection() {
  const t = useT();
  const statusQuery = useQuery({ queryKey: ["ha-status"], queryFn: api.homeAssistant.status });
  const status = statusQuery.data;

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.ha")}</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">{t("settings.haIntro")}</p>
      </div>
      {status && !status.configured && (
        <p className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-900 dark:text-amber-200">
          {t("settings.haUnconfigured")}
        </p>
      )}
      {status?.configured && (
        <p className="text-sm text-slate-600">
          {t("settings.haConnected", { url: status.url ?? "" })}{" "}
          {status.syncEnabled
            ? t("settings.haSyncing", { minutes: status.syncIntervalMinutes ?? 0 })
            : t("settings.haSyncOff")}
        </p>
      )}
    </div>
  );
}

/**
 * Whether the Cloudflare Access allow-list stays in step with the parties
 * table, and a way to push it by hand.
 *
 * Every party save already triggers this automatically (see
 * parties/routes.ts) — the button here exists for when that background push
 * failed (a bad token, Cloudflare briefly unreachable) and the admin wants
 * to retry it without re-saving a party. Shown whether or not it's
 * configured, same as the Home Assistant section above: an unconfigured
 * integration is useful to see, not just to use.
 */
function CloudflareAccessSection({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const statusQuery = useQuery({ queryKey: ["cf-access-status"], queryFn: api.cloudflareAccess.status });
  const [result, setResult] = useState<CfAccessSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncMutation = useMutation({
    mutationFn: api.cloudflareAccess.sync,
    onSuccess: (data) => {
      setError(null);
      setResult(data);
    },
    onError: (err: Error) => setError(err.message),
  });

  const configured = statusQuery.data?.configured ?? false;

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.cfAccess")}</h2>
        <p className="mt-1 text-xs text-slate-500">{t("settings.cfAccessNote")}</p>
      </div>

      {!configured ? (
        <p className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-900 dark:text-amber-200">
          {t("settings.cfAccessUnconfigured")}
        </p>
      ) : (
        <>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={!canEdit || syncMutation.isPending}
            className="btn-primary px-4 py-2 text-sm"
          >
            {syncMutation.isPending ? t("settings.syncing") : t("settings.cfAccessSyncNow")}
          </button>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {result && (
            <div className="space-y-1.5 border-t pt-3 text-sm">
              {result.policyName && (
                <p className="text-xs text-slate-400">
                  {result.created
                    ? t("settings.cfAccessCreated", { name: result.policyName })
                    : t("settings.cfAccessPolicy", { name: result.policyName })}
                </p>
              )}
              {result.added.length === 0 && result.removed.length === 0 ? (
                <p className="text-slate-500">
                  {t("settings.cfAccessUnchanged", { count: result.unchangedCount })}
                </p>
              ) : (
                <>
                  {result.added.length > 0 && (
                    <p>
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">{t("settings.cfAccessAdded")}</span>{" "}
                      {result.added.join(", ")}
                    </p>
                  )}
                  {result.removed.length > 0 && (
                    <p>
                      <span className="font-medium text-amber-700 dark:text-amber-300">{t("settings.cfAccessRemoved")}</span>{" "}
                      {result.removed.join(", ")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Where generated invoice PDFs are archived, alongside the zip every Generate
 * click already downloads (see BillingPage). A service account, not an OAuth
 * app: its whole access boundary is Drive's own sharing model, so connecting
 * a folder here means the admin already shared it with the address shown
 * below — nothing is typed or picked from inside this app itself.
 */
function GoogleDriveSection({ site, canEdit }: { site: Site; canEdit: boolean }) {
  const t = useT();
  const siteId = site.id;
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["drive-status", siteId],
    queryFn: () => api.googleDrive.status(siteId),
  });
  const [folderId, setFolderId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.googleDrive.verifyFolder(siteId, id),
    onSuccess: () => {
      setError(null);
      setFolderId("");
      void queryClient.invalidateQueries({ queryKey: ["drive-status", siteId] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const disconnectMutation = useMutation({
    mutationFn: () => api.googleDrive.disconnectFolder(siteId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["drive-status", siteId] }),
  });

  const status = statusQuery.data;

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">{t("settings.drive")}</h2>
        <p className="mt-1 text-xs font-medium text-slate-600">{t("integrations.driveSite", { site: site.name })}</p>
        <p className="mt-1 text-xs text-slate-500">{t("settings.driveNote")}</p>
      </div>

      {status && !status.configured && (
        <p className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-900 dark:text-amber-200">
          {t("settings.driveUnconfigured")}
        </p>
      )}

      {status?.configured && (
        <>
          {status.serviceAccountEmail && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t("settings.driveServiceAccount", { email: status.serviceAccountEmail })}
            </p>
          )}

          {status.folderId ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-emerald-700 dark:text-emerald-400">
                {t("settings.driveConnected", { name: status.folderName ?? status.folderId })}
              </span>
              {canEdit && (
                <button
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("settings.driveDisconnect")}
                </button>
              )}
            </div>
          ) : (
            canEdit && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t("settings.driveFolderId")} hint={t("settings.driveFolderIdHint")}>
                  <input
                    type="text"
                    className="input w-64"
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz"
                  />
                </Field>
                <button
                  onClick={() => verifyMutation.mutate(folderId)}
                  disabled={!folderId.trim() || verifyMutation.isPending}
                  className="btn-primary px-4 py-2 text-sm"
                >
                  {verifyMutation.isPending ? t("settings.driveConnecting") : t("settings.driveConnect")}
                </button>
              </div>
            )
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}

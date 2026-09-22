import { useT } from "../i18n/context";
import { useSession } from "../lib/useIdentity";
import { logoutHref } from "../lib/session";
import { LanguageSwitch } from "../components/LanguageSwitch";

/**
 * Who you are, and the way out of the session — for every role.
 *
 * Only an active session is ever routed here: a rejected one sees `NoAccess`
 * instead, which carries its own sign-out, and an expired one is already on
 * its way back to the sign-in page.
 */
export function ProfilePage() {
  const t = useT();
  const session = useSession();
  const identity = session.kind === "active" ? session.identity : null;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("profile.title")}</h1>
        <p className="text-sm text-slate-500">{t("profile.intro")}</p>
      </div>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">{t("profile.account")}</h2>
        {identity ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {identity.partyName && (
              <>
                <dt className="text-slate-500">{t("profile.party")}</dt>
                <dd className="font-medium text-slate-900">{identity.partyName}</dd>
              </>
            )}
            <dt className="text-slate-500">{t("profile.email")}</dt>
            <dd className="break-all text-slate-900">{identity.email}</dd>
            <dt className="text-slate-500">{t("profile.role")}</dt>
            <dd className="text-slate-900">{t(`role.${identity.role}`)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">{t("profile.noAuth")}</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">{t("session.language")}</h2>
        <LanguageSwitch size="md" />
      </section>

      {identity &&
        (identity.simulated ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {t("profile.previewNote")}
          </p>
        ) : (
          <section className="space-y-2 rounded-lg border bg-white p-4">
            <a
              href={logoutHref()}
              className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {t("session.signOut")}
            </a>
            <p className="text-xs text-slate-500">{t("profile.signOutHint")}</p>
          </section>
        ))}
    </div>
  );
}

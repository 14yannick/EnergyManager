import { useT } from "../i18n/context";
import { useSession } from "../lib/useIdentity";
import { chooseSite, useCurrentSite } from "../lib/useCurrentSite";
import { logoutHref } from "../lib/session";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { ThemeSwitch } from "../components/ThemeSwitch";

/**
 * Who you are, which site you are on, and the way out of the session — for
 * every role.
 *
 * Only an active session is ever routed here: a rejected one sees `NoAccess`
 * instead, which carries its own sign-out, and an expired one is already on
 * its way back to the sign-in page.
 */
export function ProfilePage() {
  const t = useT();
  const session = useSession();
  const identity = session.kind === "active" ? session.identity : null;
  // An admin or a viewer may look at any site, so which one is a choice
  // made here. A participant is shown theirs and has nothing to choose:
  // the site list is closed to them, and so is every other site.
  const participant = identity?.role === "participant";
  const { site, sites } = useCurrentSite({ enabled: session.kind !== "loading" && !participant });
  const homeSite = identity?.homeSite ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("profile.title")}</h1>
        <p className="max-w-2xl text-sm text-slate-500">{t("profile.intro")}</p>
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

      {(homeSite || site) && (
        <section className="space-y-3 rounded-lg border bg-white p-4">
          <h2 className="text-sm font-medium text-slate-700">{t("profile.site")}</h2>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {homeSite && (
              <>
                <dt className="text-slate-500">{t("profile.siteAssigned")}</dt>
                <dd className="font-medium text-slate-900">{homeSite.name}</dd>
              </>
            )}
            {!participant && site && (
              <>
                <dt className="text-slate-500">
                  <label htmlFor="profile-site">{t("profile.siteViewing")}</label>
                </dt>
                <dd>
                  {/* A select even with one site to pick from: it says the
                      site is a choice, and where the next one will appear. */}
                  <select
                    id="profile-site"
                    value={site.id}
                    onChange={(e) => chooseSite(e.target.value)}
                    className="max-w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                  >
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </dd>
              </>
            )}
          </dl>
          {!participant && site && <p className="text-xs text-slate-500">{t("profile.siteHint")}</p>}
        </section>
      )}

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">{t("session.language")}</h2>
        <LanguageSwitch size="md" />
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">{t("profile.appearance")}</h2>
        <ThemeSwitch size="md" />
        <p className="text-xs text-slate-500">{t("profile.appearanceHint")}</p>
      </section>

      {identity &&
        (identity.simulated ? (
          <p className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-900 dark:text-amber-200">
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

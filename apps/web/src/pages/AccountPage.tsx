import { useT } from "../i18n/context";
import { useIdentity, useSession } from "../lib/useIdentity";
import { logoutHref } from "../lib/session";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { InvoiceList } from "../components/InvoiceList";

/**
 * The personal page, for every role: who you are, which site you are on,
 * the language and the look, and the way out of the session — and your own
 * household's invoices, where the address is on a party: a participant's,
 * or an admin's who is billed like anyone. Everyone's are settled under
 * Billing.
 *
 * Only an active session is ever routed here: a rejected one sees `NoAccess`
 * instead, which carries its own sign-out, and an expired one is already on
 * its way back to the sign-in page.
 */
export function AccountPage() {
  const t = useT();
  const session = useSession();
  const identity = session.kind === "active" ? session.identity : null;
  const me = useIdentity().data;
  // Whose invoices to show: the party behind the address, on its site.
  const own = me?.homeParty && me.homeSite ? { siteId: me.homeSite.id, partyId: me.homeParty.id } : null;
  // Where this address is assigned. Shown, not chosen: which site an admin
  // or a viewer looks at is picked under Site administration, beside the
  // list of sites it is a choice among.
  const homeSite = identity?.homeSite ?? null;

  const tile = "space-y-3 rounded-lg border bg-white p-4";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t("account.title")}</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          {own ? t("account.intro") : t("profile.intro")}
        </p>
      </div>

      {/* Short tiles, so they sit two or three abreast where there is room
          rather than each taking a full row for three lines of text. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <section className={tile}>
          <h2 className="text-sm font-medium text-slate-700">{t("profile.account")}</h2>
          {identity ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {/* The party behind the address — an admin's household too,
                  now that the identity names it, not only a participant's. */}
              {identity.homeParty && (
                <>
                  <dt className="text-slate-500">{t("profile.party")}</dt>
                  <dd className="font-medium text-slate-900">{identity.homeParty.name}</dd>
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

        {homeSite && (
          <section className={tile}>
            <h2 className="text-sm font-medium text-slate-700">{t("profile.site")}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">{t("profile.siteAssigned")}</dt>
              <dd className="font-medium text-slate-900">{homeSite.name}</dd>
            </dl>
          </section>
        )}

        <section className={tile}>
          <h2 className="text-sm font-medium text-slate-700">{t("session.language")}</h2>
          <LanguageSwitch size="md" />
        </section>

        <section className={tile}>
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

      {own && <InvoiceList siteId={own.siteId} partyId={own.partyId} showParty={false} canEdit={false} />}
    </div>
  );
}

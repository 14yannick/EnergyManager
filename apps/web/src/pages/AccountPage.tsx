import { useT } from "../i18n/context";
import { useIdentity, useSession } from "../lib/useIdentity";
import { useCurrentSite } from "../lib/useCurrentSite";
import { clearParty, useProxy } from "../lib/useViewedParty";
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
 * An admin or a viewer in a member's shoes (see useProxy) gets the page as
 * the member would: the member's household, addresses and invoices, with
 * the one addition of the way back to their own view, beside the sign-out.
 * The language and the look stay the browser's.
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
  const isParticipant = me?.role === "participant";
  const { proxy, pending } = useProxy();
  const { site } = useCurrentSite({ enabled: me != null && !isParticipant });
  const inProxy = proxy != null || pending;
  // Whose invoices to show: the member's, in their shoes; else the party
  // behind the address, on its site.
  const own = proxy
    ? { siteId: proxy.siteId, partyId: proxy.party.id }
    : me?.homeParty && me.homeSite
      ? { siteId: me.homeSite.id, partyId: me.homeParty.id }
      : null;
  // Where this address is assigned. Shown, not chosen: which site an admin
  // or a viewer looks at is picked under Site administration, beside the
  // list of sites it is a choice among. In a member's shoes, their site.
  const homeSite = proxy ? { id: proxy.siteId, name: site?.name ?? "" } : (identity?.homeSite ?? null);
  // Whom the page is about: the member, in their shoes, else oneself.
  const person = proxy
    ? { party: proxy.party.name, email: proxy.party.emails.join(", ") || "—", role: "participant" as const }
    : identity
      ? { party: identity.homeParty?.name ?? null, email: identity.email, role: identity.role }
      : null;
  const endProxy = () => {
    if (site) clearParty(site.id);
  };

  const tile = "space-y-3 rounded-lg border bg-white p-4";

  return (
    <div className="space-y-6">
      {/* Short tiles, so they sit two or three abreast where there is room
          rather than each taking a full row for three lines of text. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <section className={tile}>
          <h2 className="text-sm font-medium text-slate-700">{t("profile.account")}</h2>
          {person ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {/* The party behind the address — an admin's household too,
                  now that the identity names it, not only a participant's. */}
              {person.party && (
                <>
                  <dt className="text-slate-500">{t("profile.party")}</dt>
                  <dd className="font-medium text-slate-900">{person.party}</dd>
                </>
              )}
              <dt className="text-slate-500">{t("profile.email")}</dt>
              <dd className="break-all text-slate-900">{person.email}</dd>
              <dt className="text-slate-500">{t("profile.role")}</dt>
              <dd className="text-slate-900">{t(`role.${person.role}`)}</dd>
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
          (identity.simulated && !inProxy ? (
            <p className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-900 dark:text-amber-200">
              {t("profile.previewNote")}
            </p>
          ) : (
            <section className="space-y-2 rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* The way back to one's own view, first: it is the one
                    thing on this page that is not the member's. */}
                {inProxy && (
                  <button
                    type="button"
                    onClick={endProxy}
                    className="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
                  >
                    {t("account.endProxy")}
                  </button>
                )}
                {!identity.simulated && (
                  <a
                    href={logoutHref()}
                    className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {t("session.signOut")}
                  </a>
                )}
              </div>
              {inProxy && (
                <p className="text-xs text-slate-500">{t("account.endProxyHint", { name: proxy?.party.name ?? "" })}</p>
              )}
              {!identity.simulated && <p className="text-xs text-slate-500">{t("profile.signOutHint")}</p>}
            </section>
          ))}
      </div>

      {own && <InvoiceList siteId={own.siteId} partyId={own.partyId} showParty={false} canEdit={false} />}
    </div>
  );
}

import type { en } from "./en";

/**
 * The German catalogue. Typed against the English one, so every key it is
 * missing is a compile error rather than an English string appearing in a
 * German page.
 *
 * The billing and invoice wording follows a real BKW electricity bill —
 * Zwischentotal, Zu bezahlender Betrag, Bezug/Preis/Betrag as the quantity,
 * rate and amount columns, Rp. for cents — so a participant reading their RCP
 * invoice recognises the same terms as on the bill it replaces.
 */
export const de: Record<keyof typeof en, string> = {
  // ---- Chrome ------------------------------------------------------------
  "app.name": "EnergyManager",
  "nav.dashboard": "Übersicht",
  "nav.tariffs": "Tarifperioden",
  "nav.calculation": "Berechnungsdetails",
  "nav.readings": "Messwerte importieren",
  "nav.settings": "Einstellungen",
  "nav.billing": "Fakturierung",
  "session.signOut": "Abmelden",
  "session.noAccess": "kein Zugriff",
  "session.language": "Sprache",
  "role.admin": "Administrator",
  "role.viewer": "Nur Lesen",
  "role.participant": "Teilnehmer",

  "noAccess.title": "Kein Zugriff",
  "noAccess.knownAs":
    "Sie sind als {email} angemeldet, doch diese Adresse ist in EnergyManager nicht hinterlegt.",
  "noAccess.unknown": "Ihre Adresse ist in EnergyManager nicht hinterlegt.",
  "noAccess.askAdmin":
    "Bitten Sie den Administrator, sie Ihrem Teilnehmereintrag hinzuzufügen, und laden Sie diese Seite anschliessend neu. Wenn Sie ein anderes Konto verwenden wollten, melden Sie sich zuerst ab.",
  "noAccess.unrecognised":
    "Ihre Sitzung wurde nicht erkannt. Melden Sie sich ab und wieder an.",

  // ---- Shared ------------------------------------------------------------
  "common.loading": "Wird geladen…",
  "common.from": "Von",
  "common.to": "Bis",
  "common.period": "Zeitperiode",
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  "common.add": "Hinzufügen",
  "common.delete": "Löschen",
  "common.edit": "Bearbeiten",
  "common.today": "Heute",
  "common.total": "Total",
  "common.readOnly":
    "Nur Lesen — das Ändern dieser Einstellungen ist dem RCP-Administrator vorbehalten.",
  "common.nothingInRange": "Nichts in diesem Zeitraum.",

  // ---- Calculation detail ------------------------------------------------
  "calc.title": "Berechnungsdetails",
  "calc.intro":
    "Ein Tag, und jede Zahl, die dahintersteht. Jeder Tarif ist der über den Tag nach Energie gewichtete Durchschnitt — klappen Sie eine Zeile auf, um die Intervalle zu sehen, aus denen er entstanden ist.",
  "calc.prevDay": "Vorheriger Tag",
  "calc.nextDay": "Nächster Tag",
  "calc.nothingToday": "An diesem Tag wurde nichts erfasst.",
  "calc.flow": "Fluss",
  "calc.avgRate": "ø CHF/kWh",
  "calc.interval": "Intervall",
  "calc.intervalCount": "{count} Intervalle",
  "calc.noInterval": "Kein Intervall trägt zu dieser Zahl bei.",
  "calc.noParties":
    "An diesem Tag wurde kein Teilnehmerverbrauch erfasst. Messwerte pro Teilnehmer folgen mit dem vZEV-Import.",
  "calc.party": "Teilnehmer",

  "calc.solar": "Solar",
  "calc.solarSub": "Wohin die Produktion des Tages ging, und was sie wert war",
  "calc.production": "Produktion",
  "calc.productionNote": "Anteil der Photovoltaik an der AC-Abgabe des Wechselrichters",
  "calc.directUse": "Direktverbrauch",
  "calc.directUseNote":
    "Produktion, die das Haus im Moment der Erzeugung verbraucht hat — wert so viel wie der vermiedene Bezug",
  "calc.partyDraw": "Von Teilnehmern bezogen",
  "calc.partyDrawNote": "Aus dem lokalen Pool von den übrigen Teilnehmern bezogen, zum RCP-Tarif",
  "calc.exportGrid": "Einspeisung ins Netz",
  "calc.exportGridNote": "Was übrig blieb, zum Rücklieferungstarif",

  "calc.battery": "Batterie",
  "calc.batterySub": "Was das Speichern gekostet und das Zurückgeben eingebracht hat",
  "calc.charged": "Geladen",
  "calc.chargedNote": "DC-seitig gemessen, vor Umwandlungsverlusten",
  "calc.forgone": "Entgangene Einspeisung",
  "calc.forgoneNote":
    "Die Ladung als AC, also die verdrängte Einspeisung, bewertet zum Rücklieferungstarif des Moments, in dem sie gespeichert wurde",
  "calc.toHouse": "Ins Haus entladen",
  "calc.toHouseNote": "Hat Verbrauch gedeckt, also wert so viel wie der vermiedene Bezug",
  "calc.toGrid": "Ins Netz entladen",
  "calc.toGridNote":
    "Es hat mehr Energie das Haus verlassen, als die Module erzeugen konnten — der Rest stammt aus der Batterie",
  "calc.net": "Netto",
  "calc.netNote": "Was die Batterie eingebracht hat, abzüglich der Kosten des Speicherns",

  "calc.rangeTable": "Alle Zahlen, über einen Zeitraum",
  "calc.rangeTableSub": "— die vollständige Ausgabe der Berechnung, und der CSV-Export",
  "calc.exportCsv": "CSV exportieren",
  "calc.periodCount": "{count} Perioden",
  "calc.g.hourly": "stündlich",
  "calc.g.daily": "täglich",
  "calc.g.monthly": "monatlich",
  "calc.g.quarterly": "quartalsweise",
  "calc.g.yearly": "jährlich",
  "calc.g.overall": "gesamt",
  "calc.col.production": "Produktion",
  "calc.col.directUse": "Direktverbrauch",
  "calc.col.exportGrid": "Einspeisung (Netz)",
  "calc.col.exportTotal": "Einspeisung (total)",
  "calc.col.partyDraw": "Bezug Teilnehmer",
  "calc.col.batteryCharge": "Batterieladung",
  "calc.col.batteryDischarge": "Batterieentladung",
  "calc.col.ofWhichUsed": "…davon verbraucht",
  "calc.col.ofWhichExported": "…davon eingespeist",
  "calc.col.purchaseRate": "Bezugstarif",
  "calc.col.feedInRate": "Rücklieferungstarif",
  "calc.col.partyRate": "Teilnehmertarif",
  "calc.col.directConsumption": "Direktverbrauch",
  "calc.col.directExport": "Direkte Einspeisung",
  "calc.col.batteryToHouse": "Batterie → Haus",
  "calc.col.batteryToGrid": "Batterie → Netz",
  "calc.col.chargingCost": "Ladekosten",
  "calc.col.batteryNet": "Netto Batterie",
  "calc.col.partySales": "Verkauf an Teilnehmer",
  "calc.col.selfConsumption": "Wert des Eigenverbrauchs",
  "calc.col.exportRevenue": "Einspeiseertrag",
  "calc.col.totalWithBattery": "Total (mit Batterie)",
  "calc.col.totalWithoutBattery": "Total (ohne Batterie)",
  "calc.col.batteryOnly": "Ersparnis nur durch Batterie",

  // ---- Settings ----------------------------------------------------------
  "settings.title": "Einstellungen",
  "settings.intro":
    "Investitionssummen für die Amortisation, und die Home-Assistant-Verbindung, welche die Energiedaten liefert.",

  "settings.ha": "Home Assistant",
  "settings.haIntro":
    "Holt die Energiestatistiken direkt aus Home Assistant, statt CSV-Dateien zu importieren. Gelesen werden die Langzeitstatistiken (dieselben Zahlen wie im Energie-Dashboard), Zählerrücksetzungen sind darin bereits berücksichtigt.",
  "settings.haUnconfigured":
    "Nicht konfiguriert — setzen Sie HA_URL und HA_TOKEN in der Umgebung der API und starten Sie sie neu.",
  "settings.haConnected": "Verbunden mit {url}.",
  "settings.haSyncing": "Automatische Synchronisierung alle {minutes} Minuten.",
  "settings.haSyncOff": "Die automatische Synchronisierung ist deaktiviert.",

  "settings.mapping": "Zuordnung der Entitäten",
  "settings.mappingNote":
    "Welche Home-Assistant-Statistik welche Messgrösse speist. Aufgeführt sind nur Statistiken mit einem kumulierten Zählerstand — nur für diese kann Home Assistant Energie pro Periode ausweisen.",
  "settings.statListFailed": "Die Statistikliste konnte nicht gelesen werden: {message}",
  "settings.metric": "Messgrösse",
  "settings.haStatistic": "Home-Assistant-Statistik",
  "settings.notSynced": "— nicht synchronisiert —",
  "settings.mapped": "zugeordnet",
  "settings.derivedNote":
    "Produktion und Batterieentladung (AC) sind nicht aufgeführt, weil sie keine Sensoren sind. Der Wechselrichter meldet eine einzige AC-Zahl für Module und Batterie zusammen; beide werden nach jeder Synchronisierung daraus abgeleitet, im Verhältnis des jeweils gelieferten DC. Genau das verhindert, dass um Mitternacht Solarproduktion erfasst wird.",

  "settings.metric.inverterAc": "AC-Abgabe des Wechselrichters",
  "settings.metric.inverterAcHint": "Gesamte AC-Abgabe — Photovoltaik und Batterie zusammen",
  "settings.metric.pvDc": "Photovoltaik-Ertrag (DC)",
  "settings.metric.pvDcHint": "Modulertrag, dient der Aufteilung der AC-Zahl",
  "settings.metric.ownConsumption": "Eigenverbrauch",
  "settings.metric.ownConsumptionHint": "Gesamter Verbrauch des Haushalts",
  "settings.metric.exportGrid": "Einspeisung — Netz",
  "settings.metric.exportGridHint": "Ins Netz eingespeist",
  "settings.metric.exportLocal": "Einspeisung — lokal",
  "settings.metric.exportLocalHint": "Gesamte Abgabe aus dem Haushalt",
  "settings.metric.importGrid": "Bezug — Netz",
  "settings.metric.importGridHint": "Aus dem Netz bezogen",
  "settings.metric.batteryCharge": "Batterieladung",
  "settings.metric.batteryChargeHint": "Energie in die Batterie",
  "settings.metric.batteryDischarge": "Batterieentladung",
  "settings.metric.batteryDischargeHint": "Energie aus der Batterie",

  "settings.sync": "Synchronisierung",
  "settings.syncNote":
    "Home Assistant behält 5-Minuten-Statistiken rund 10 Tage und stündliche unbegrenzt. Die Viertelstunde reicht daher nur in dieses jüngste Fenster zurück; für ältere Zeiträume verwenden Sie die stündliche Auflösung. Eine Periode erneut zu synchronisieren ist unbedenklich — Zeilen werden ersetzt, nicht dupliziert.",
  "settings.granularity": "Auflösung",
  "settings.quarterHour": "Viertelstunde",
  "settings.hourly": "Stündlich",
  "settings.dateRange": "Bestimmter Zeitraum",
  "settings.syncNow": "Jetzt synchronisieren",
  "settings.syncing": "Wird synchronisiert…",
  "settings.rangeInvalid": "« Bis » muss gleich « Von » oder später sein.",
  "settings.inserted": "hinzugefügt",
  "settings.updated": "aktualisiert",
  "settings.rows": "{count} Zeilen",

  "settings.investment": "Investition",
  "settings.investmentNote":
    "Was die Anlage gekostet hat, Grundlage für Amortisation und Break-even. Ein Betrag pro Kategorie; enthält eine Kategorie mehrere Einträge (etwa eine separat verbuchte Förderung), wird ihr Total nur angezeigt, statt zu raten, welcher Eintrag zu ändern wäre.",
  "settings.battery": "Batterie",
  "settings.solar": "Solar",
  "settings.splitItems": "{count} separate Einträge — als Total angezeigt, hier nicht änderbar",

  "settings.productionStart": "Produktionsbeginn",
  "settings.productionStartNote":
    "Wann die Anlage zu produzieren begann. Die Übersicht misst die Amortisation nicht über frühere Tage, die sonst als ertraglose Perioden zählen würden.",
  "settings.productionStartDate": "Datum des Produktionsbeginns",
  "settings.productionStartFallback":
    "Nicht angegeben — standardmässig {date}, der erste Tag mit erfasster Produktion.",
  "settings.resetProductionStart": "Auf den ersten Produktionstag zurücksetzen",
  "settings.conversionLoss": "Umwandlungsverluste der Batterie (%)",
  "settings.conversionLossNote":
    "Die Ladung wird DC gemessen, bewertet wird aber alles in AC; die verdrängte Einspeisung wird deshalb um diesen Anteil gekürzt, bevor sie der Batterie angelastet wird.",

  // ---- Tariff periods ----------------------------------------------------
  "tariff.title": "Tarifperioden",
  "tariff.intro":
    "Bezugs-, Rücklieferungs- und Teilnehmertarife, jeder für einen Zeitraum — von einer Viertelstunde bis zu einem Jahr. Perioden derselben Art dürfen sich nicht überschneiden. Jede Periode gibt zudem an, wie sie bewertet wird: zum eigenen festen Tarif oder nach dem Day-ahead-Feed.",
  "tariff.kind": "Art",
  "tariff.start": "Beginn",
  "tariff.end": "Ende",
  "tariff.pricedBy": "Bewertet nach",
  "tariff.rate": "Tarif",
  "tariff.rateChf": "Tarif (CHF/kWh)",
  "tariff.label": "Bezeichnung",
  "tariff.labelOptional": "Bezeichnung (optional)",
  "tariff.fallbackRate": "Ersatztarif (optional)",
  "tariff.fallbackHint":
    "Wird nur dort verwendet, wo der Feed keinen Preis liefert. Leer lassen, um diese Intervalle unbewertet zu lassen.",
  "tariff.saveChanges": "Speichern",
  "tariff.addPeriod": "Periode hinzufügen",
  "tariff.addSurcharge": "Zuschlag hinzufügen",
  "tariff.fromFeed": "aus dem Feed",
  "tariff.fallback": "Ersatz",
  "tariff.kind.purchase": "Bezug",
  "tariff.kind.feedIn": "Rücklieferung",
  "tariff.kind.neighborSell": "Verkauf an Teilnehmer",
  "tariff.mode.flat": "Quartalsweise (fester Tarif)",
  "tariff.mode.dynamic": "Day-ahead (Spot)",

  "tariff.dynamic": "Dynamische Rücklieferungstarife (BKW)",
  "tariff.dynamicLoaded":
    "{count} Viertelstundentarife für das aktuelle Fenster geladen, publiziert am {published}.",
  "tariff.dynamicEmpty":
    "Noch keine dynamischen Tarife geladen — bis dahin gelten die festen Rücklieferungsperioden oben.",

  "tariff.surcharges": "Zuschläge",
  "tariff.surchargesNote":
    "Additive Bestandteile pro kWh, die auf den Tarif einer Periode aufgeschlagen werden — etwa ein Herkunftsnachweis oder eine Mindestvergütungsprämie zusätzlich zum Rücklieferungstarif. Anders als die Perioden oben dürfen sich Zuschläge überschneiden; jeder passende wird zum Grundtarif addiert.",

  // ---- Import readings ---------------------------------------------------
  "readings.title": "Messwerte importieren",
  "readings.csvNote":
    "CSV-Spalten: timestamp, metric_kind, party, value_kwh — eine Zeile pro Zeitstempel und Messgrösse. metric_kind ist eines von production, export_local, export_grid, import_grid, battery_charge, battery_discharge, consumption. party ist erforderlich (der Name eines Teilnehmers), wenn metric_kind consumption ist, und muss sonst leer bleiben. Ein erneuter Import überschreibt sich überschneidende Zeilen.",
  "readings.modeDelta": "Delta — die Werte sind bereits kWh pro Intervall",
  "readings.modeCumulative":
    "Kumuliert — die Werte sind fortlaufende Zählerstände, je Messgrösse und Teilnehmer",
  "readings.import": "Importieren",
  "readings.importing": "Import läuft…",
  "readings.skipped": "übersprungen",
  "readings.row": "Zeile",
  "readings.message": "Meldung",

  "readings.export": "Export",
  "readings.exportNote":
    "Rohe Messwerte als Excel-Datei — eine Zeile pro Zeitstempel und Messgrösse, Daten in Europe/Zurich (der UTC-Zeitstempel bleibt in der letzten Spalte erhalten).",
  "readings.metrics": "Messgrössen",
  "readings.all": "alle",
  "readings.none": "keine",
  "readings.download": ".xlsx herunterladen",
  "readings.pickMetric": "Wählen Sie mindestens eine Messgrösse.",

  "readings.metric.production": "Produktion (PV, AC-Anteil)",
  "readings.metric.inverterAc": "AC-Abgabe des Wechselrichters (PV + Batterie)",
  "readings.metric.pvDc": "Photovoltaik-Ertrag (DC)",
  "readings.metric.batteryDischargeAc": "Batterieentladung (AC-Anteil)",
  "readings.metric.exportLocal": "Einspeisung — lokal",
  "readings.metric.exportGrid": "Einspeisung — Netz",
  "readings.metric.importGrid": "Bezug — Netz",
  "readings.metric.batteryCharge": "Batterieladung",
  "readings.metric.batteryDischarge": "Batterieentladung",
  "readings.metric.consumption": "Verbrauch (pro Teilnehmer)",
  "readings.metric.consumptionOwn": "Eigenverbrauch (Haushalt)",
  "readings.metric.consumptionGrid": "Netzbezug (pro Teilnehmer)",

  "parties.title": "Teilnehmer",
  "parties.note":
    "Die Nachbarn, die Ihren Netzanschluss teilen. Ihr Verbrauch wird separat fakturiert und sie zählen zur Grösse des Pools. Neue Namen in einem importierten CSV werden hier automatisch angelegt, ohne Nummer und E-Mail — ergänzen Sie diese anschliessend. Die Postadresse ist das, was der QR-Einzahlungsschein als Zahlungspflichtigen druckt; eine Rechnung funktioniert auch ohne, dann bleibt das Feld zum Ausfüllen leer. Geben Sie sich selbst die Rolle RCP-Administrator und hinterlegen Sie Ihre IBAN — das ist das Konto, auf das der QR-Einzahlungsschein lautet, und Sie werden weiterhin für Ihren eigenen Verbrauch fakturiert. Nur « Nur RCP-Administrator » und « Nur Lesen » stehen ausserhalb des RCP: nie fakturiert, nie mitgezählt.",
  "parties.number": "Teilnehmer-Nr.",
  "parties.numberShort": "Nr.",
  "parties.name": "Name",
  "parties.street": "Strasse",
  "parties.buildingNo": "Nr.",
  "parties.postcode": "PLZ",
  "parties.town": "Ort",
  "parties.address": "Adresse",
  "parties.emails": "E-Mails (eine pro Zeile oder mit Komma getrennt)",
  "parties.emailsShort": "E-Mails",
  "parties.iban": "IBAN (nur Administrator)",
  "parties.role": "Rolle",
  "parties.roleIban": "Rolle / IBAN",
  "parties.addParticipant": "Teilnehmer hinzufügen",
  "parties.empty": "Noch keine Teilnehmer.",
  "parties.noAddress": "keine Adresse",
  "parties.noEmail": "keine E-Mail",
  "parties.noIban": "keine IBAN",
  "parties.role.party": "RCP-Teilnehmer",
  "parties.role.partyHint":
    "Ein Mitglied: verbraucht, wird fakturiert, zählt zur Verteilung der gemeinsamen Kosten",
  "parties.role.admin": "RCP-Administrator",
  "parties.role.adminHint": "Betreibt die App und ist Mitglied — wird wie alle anderen fakturiert",
  "parties.role.adminOnly": "Nur RCP-Administrator",
  "parties.role.adminOnlyHint":
    "Betreibt die App, ohne Teil des RCP zu sein: nie fakturiert, nie mitgezählt",
  "parties.role.viewer": "Nur Lesen",
  "parties.role.viewerHint": "Sieht alles nur lesend, verbraucht nichts",

  // ---- Billing -----------------------------------------------------------
  "billing.title": "Fakturierung",
  "billing.cat.energie": "Energie",
  "billing.cat.netznutzung": "Netznutzung",
  "billing.cat.messung": "Messung",
  "billing.cat.abgaben": "Abgaben & Leistungen",
  "billing.alloc.perKwh": "pro kWh aus dem Netz bezogen",
  "billing.alloc.perKwhTotal": "pro kWh verbraucht (Netz + lokale Produktion)",
  "billing.alloc.poolShared": "einmal dem RCP verrechnet, auf die Teilnehmer aufgeteilt",
  "billing.alloc.perParticipant": "einmal pro Teilnehmer verrechnet",

  "billing.positions": "Tarifpositionen des Netzbetreibers",
  "billing.positionsNote":
    "Eine Zeile pro Position auf der Rechnung des Netzbetreibers. Die Aufteilung gibt an, wie jede Position an das RCP weitergegeben wird: Grundtarife, die dem Anschluss nur einmal verrechnet werden, teilen sich die Teilnehmer, während die Messung für jeden von ihnen anfällt.",
  "billing.category": "Rubrik",
  "billing.position": "Position",
  "billing.allocation": "Aufteilung",
  "billing.ratePerKwh": "Preis (CHF/kWh)",
  "billing.ratePerYear": "Preis (CHF/a)",
  "billing.rate": "Preis",
  "billing.validFrom": "Gültig ab",
  "billing.validTo": "Gültig bis",
  "billing.existsWithout": "Besteht auch ohne RCP",
  "billing.withoutRcp": "Ohne RCP",
  "billing.addPosition": "Position hinzufügen",
  "billing.noPositions":
    "Keine Positionen — erfassen Sie sie so, wie sie auf der Netzrechnung stehen.",
  "billing.validRange": "Gültig vom {from} bis {to}",
  "billing.positionCount": "{count} Positionen",
  "billing.yes": "ja",
  "billing.no": "nein",
  "billing.perYear": "CHF/a",

  "billing.period.yearly": "Jahr",
  "billing.period.quarterly": "Quartal",
  "billing.period.monthly": "Monat",
  "billing.period.custom": "Benutzerdefiniert",
  "billing.prevPeriod": "Vorherige Periode",
  "billing.nextPeriod": "Nächste Periode",
  "billing.generate": "Rechnungen erstellen",
  "billing.futurePeriod": "· künftige Periode",
  "billing.currentPeriod": "· laufende Periode",
  "billing.print": "Drucken / als PDF speichern",
  "billing.summary": "{days} Tage · RCP mit {participants} Teilnehmern",
  "billing.localRate": " · lokale Energie {rate} {cents}",

  "invoice.participantNo": "Teilnehmer-Nr. {reference}",
  "invoice.header":
    "Fakturierung vom {from} bis {to} · {days} Tage · RCP mit {participants} Teilnehmern",
  "invoice.subtotal": "Zwischentotal",
  "invoice.amountDue": "Zu bezahlender Betrag",
  "invoice.footnote":
    "Netzbezug {grid} kWh · Verbrauch aus lokaler Produktion {local} kWh. Beträge inkl. MWST (die MWST des Lieferanten wird weitergegeben, es kommt keine zusätzliche MWST hinzu).",
  "invoice.benefitTitle": "Ihr Vorteil im RCP — {name}",
  "invoice.benefitIntro":
    "Was Sie bezahlt hätten, wenn Sie direkt vom Netzbetreiber beliefert würden.",
  "invoice.directSupply": "Direkte Belieferung (Vergleich)",
  "invoice.directSupplyTotal": "Total direkte Belieferung",
  "invoice.directly": "Direkt vom Netzbetreiber",
  "invoice.yourRcpBill": "Ihre RCP-Rechnung",
  "invoice.yourBenefit": "Ihr Vorteil",
  "invoice.benefitNote":
    "Der Vorteil hat zwei Quellen: Die Grundtarife des Anschlusses werden im RCP auf {participants} Teilnehmer aufgeteilt, statt einzeln verrechnet zu werden, und {local} kWh stammten aus der lokalen Produktion statt aus dem Netz.",
  "invoice.quantity": "Bezug",
  "invoice.price": "Preis",
  "invoice.amountChf": "Betrag in CHF",
  "invoice.days": "{count} Tage",
  "billing.intro":
    "Erfassen Sie die Rechnung des Netzbetreibers Position für Position und erstellen Sie anschliessend für jeden RCP-Teilnehmer eine Rechnung. Die Beträge verstehen sich inkl. MWST: Die MWST des Lieferanten wird unverändert weitergegeben, es kommt keine zusätzliche MWST hinzu.",

  // ---- QR-bill -----------------------------------------------------------
  "qr.noBill":
    "Kein Einzahlungsschein: Kennzeichnen Sie einen Teilnehmer als RCP-Administrator und ergänzen Sie dessen IBAN und Adresse unter « Messwerte importieren » → Teilnehmer.",
  "qr.failed": "Einzahlungsschein nicht möglich: {message}",
  "qr.message": "RCP-Rechnung {from}-{to}",
  "qr.error": "Der QR-Einzahlungsschein konnte nicht erzeugt werden",

  // ---- Dashboard ---------------------------------------------------------
  "dash.title": "Ersparnis und Amortisation",
  "dash.intro":
    "Was die Anlage im gewählten Zeitraum eingebracht oder vermieden hat, und wie lange sie braucht, um ihre Kosten zu decken.",
  "dash.view": "Ansicht",
  "dash.g.hourly": "stündlich",
  "dash.g.daily": "täglich",
  "dash.g.monthly": "monatlich",
  "dash.g.quarterly": "quartalsweise",
  "dash.g.yearly": "jährlich",
  "dash.g.overall": "gesamt",
  "dash.hourlyCap":
    "Die stündliche Ansicht zeigt höchstens {days} Tage auf einmal — ein Quartal wären über 2000 Balken. Wird ein Ende verschoben, wandert das andere mit, damit das Fenster gleich lang bleibt.",
  "dash.overallNote":
    "Gesamtansicht: Der ganze Zeitraum bildet eine einzige Periode von {days} Tagen. Die Amortisation wird auf diese tatsächliche Länge hochgerechnet statt auf einen angenommenen ganzen Monat oder ein ganzes Jahr, sodass eine angebrochene Periode sie nicht verfälschen kann.",
  // "pro {unit}" rather than "Kalender{unit}": the interpolated word would
  // otherwise have to form a compound (Kalendermonat, Kalenderquartal) and a
  // hyphen there reads as a typo. "pro" also needs no article, so the unit's
  // gender never has to agree with anything.
  "dash.periodNote":
    "Jede Zahl unten gilt jeweils pro {unit} — die Durchschnitte, die Hochrechnung der Amortisation ({periods} Perioden pro Jahr statt 365), und ein Ertragsbalken pro {unit}. Die Totale sind in beiden Fällen gleich; nur die Periode der Aufteilung ändert sich.",

  "dash.unit.hour": "Stunde",
  "dash.unit.day": "Tag",
  "dash.unit.month": "Monat",
  "dash.unit.quarter": "Quartal",
  "dash.unit.year": "Jahr",
  "dash.unit.period": "Zeitraum",
  "dash.units.hour": "Stunden",
  "dash.units.day": "Tage",
  "dash.units.month": "Monate",
  "dash.units.quarter": "Quartale",
  "dash.units.year": "Jahre",
  "dash.units.period": "Perioden",

  "dash.kpi": "Kennzahlen",
  "dash.withBatteryTotal": "Gesamtersparnis — mit Batterie",
  "dash.noBatteryTotal": "Gesamtersparnis — ohne Batterie",
  "dash.batteryOnly": "Ersparnis nur durch die Batterie",
  "dash.batteryOnlyHint":
    "gegenüber demselben Zeitraum ohne Batterie — ohne Berücksichtigung der Zyklusverluste",
  "dash.batteryRevenue": "Ertrag der Batterie",
  "dash.batteryRevenueHint":
    "Wert der Entladung abzüglich der Ladekosten — die zutreffendere Zahl",
  "dash.avgSuffix": "CHF {value}/{unit} im Schnitt",

  "dash.payback": "Amortisation nach Kategorie",
  "dash.paybackNote":
    "Keine Messung, sondern eine Hochrechnung. Die Investitionskosten werden durch die durchschnittliche Ersparnis pro {unit} im gewählten Zeitraum geteilt{annualised}. Ein Zeitraum, der kein ganzes Jahr abbildet, macht die Zahl irreführend: Ein reiner Sommerzeitraum rechnet eine Amortisation hoch, die nie eintritt, ein reiner Winterzeitraum das Gegenteil. Der Break-even unten ist das Gegenstück — ein tatsächliches Datum, das nur ausgewiesen wird, wenn die kumulierte Ersparnis die Kosten innerhalb des Zeitraums überschritten hat.",
  "dash.annualisedOverall": ", hochgerechnet auf die tatsächliche Länge des Zeitraums ({days} Tage)",
  "dash.annualisedYearly": ", was bereits eine Jahreszahl ist",
  "dash.annualisedOther": ", hochgerechnet auf {periods} {units} pro Jahr",
  "dash.withBattery": "Mit Batterie",
  "dash.noBattery": "Ohne Batterie",
  "dash.batteryOnlyShort": "Nur Batterie",
  "dash.years": "{value} Jahre",
  "dash.breakeven": "Break-even: {date}",
  "dash.notReached": "im Zeitraum nicht erreicht",

  "dash.revenue": "Erträge",
  "dash.revenueNote":
    "Direktverbrauch (vermiedener Bezug), direkte Einspeisung, Batterie und Verkauf an Teilnehmer, pro {unit}",
  "dash.revenueKwh": " — die Energie hinter jeder Ertragszahl",
  "dash.revenueBoth": " — mit derselben Aufteilung in kWh schraffiert daneben, auf der rechten Achse",
  "dash.revenueCharging":
    " Das Laden erscheint unterhalb der Achse: In diesem Intervall hat die Batterie Energie aufgenommen, die sonst zum Rücklieferungstarif vergütet worden wäre.",
  "dash.production": "Produktion",
  "dash.totalRevenue": "Gesamtertrag",
  "dash.totalEnergy": "Gesamtenergie",

  "dash.flow.consumption": "Direktverbrauch",
  "dash.flow.direct": "Direkte Einspeisung",
  "dash.flow.battery": "Batterieentladung",
  "dash.flow.neighborSale": "Verkauf an Teilnehmer",
  "dash.flow.neighborSupply": "Lieferung an Teilnehmer",
  "dash.flow.neighbor": "Teilnehmer",
  "dash.wholePeriod": "Ganzer Zeitraum",
  "dash.chargingForgone": "Laden (entgangene Einspeisung)",
  "dash.batteryNet": "Netto Batterie",
  "dash.productionPlusCharging": "Produktion + Laden",
  "dash.chargingCostSeries": "Batterieladung (Kosten)",
  "dash.productionSeries": "Produktion + Laden (kWh)",

  "dash.preset.last24h": "Letzte 24 Stunden",
  "dash.preset.last7d": "Letzte 7 Tage",
  "dash.preset.last30d": "Letzte 30 Tage",
  "dash.preset.thisMonth": "Dieser Monat",
  "dash.preset.last3m": "Letzte 3 Monate",
  "dash.preset.thisQuarter": "Dieses Quartal",
  "dash.preset.lastQuarter": "Letztes Quartal",
  "dash.preset.last12m": "Letzte 12 Monate",
  "dash.preset.thisYear": "Dieses Jahr",
  "dash.preset.lastYear": "Letztes Jahr",
  "dash.preset.all": "Alle Daten",
  "dash.preset.custom": "Benutzerdefiniert…",
  "dash.overallAvg": "über {days} Tage",

  "tariff.emptyPeriods": "Noch keine Tarifperioden.",
  "tariff.emptySurcharges": "Noch keine Zuschläge.",
  "billing.cents": "Rp.",
  "billing.centsPerKwh": "Rp./kWh",
};

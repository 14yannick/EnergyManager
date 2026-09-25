import { skyFor, type Sky } from "@energy-manager/shared";
import { useT } from "../i18n/context";
import { useIdentity } from "../lib/useIdentity";
import { useDefaultSite } from "../lib/useDefaultSite";
import { useLiveView } from "./LiveCards";

/**
 * The brand mark, as the sky over the installation right now: a moon at
 * night, the sun on the horizon at dawn and dusk, and by day the sun
 * behind as much cloud as the panels' output says there is (the
 * thresholds live in shared/sky.ts). The plain sun stands in until the
 * live view has answered, and wherever there is nothing live to read.
 *
 * Reads the same live query the "Right now" cards do, so it costs no
 * request of its own; a participant's site comes from their identity, an
 * admin's from the site list, the same way every page finds it.
 */
export function SkyIcon() {
  const t = useT();
  // The same lookup every page makes — `isSuccess` covers a rejected or
  // expired session, and an admin browser with authentication off.
  const identity = useIdentity();
  const participant = identity.data?.role === "participant";
  const { site } = useDefaultSite({ enabled: identity.isSuccess && !participant });
  const siteId = participant ? identity.data?.siteId : site?.id;
  const live = useLiveView(siteId).data;

  const sky: Sky | null =
    live && live.configured
      ? skyFor({ sun: live.sun, pvW: live.pvW, hour: new Date().getHours() })
      : live?.sun
        ? skyFor({ sun: live.sun, pvW: null, hour: new Date().getHours() })
        : null;
  const kw = live?.pvW != null ? (live.pvW / 1000).toFixed(1) : null;
  const title = sky == null ? undefined : t(`sky.${sky}`, { kw: kw ?? "—" });

  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <Glyph sky={sky ?? "clear"} />
    </svg>
  );
}

const STROKE = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

/** The sun: the wordmark as it always was. */
function Sun() {
  return (
    <g className="text-sun">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <path
        d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"
        {...STROKE}
      />
    </g>
  );
}

/** Half a sun on the horizon, its rays above; the arrow says which way it is going. */
function Horizon({ rising }: { rising: boolean }) {
  return (
    <g className="text-sun">
      <path d="M7.5 17a4.5 4.5 0 0 1 9 0" fill="currentColor" />
      <path d="M12 6v3M4.9 9.9l1.4 1.4M19.1 9.9l-1.4 1.4M2 17h2.5M19.5 17H22M2 21h20" {...STROKE} />
      <path d={rising ? "M9.5 4.5 12 2l2.5 2.5" : "M9.5 2 12 4.5 14.5 2"} {...STROKE} />
    </g>
  );
}

function Moon() {
  return (
    <g className="text-slate-500">
      <path d="M20 13.2A8 8 0 1 1 10.8 4a6.2 6.2 0 0 0 9.2 9.2z" fill="currentColor" />
    </g>
  );
}

/** Feather's cloud, in the 24-box, filled in the surface colour so it hides what sits behind it. */
const CLOUD = "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z";

function Partly() {
  return (
    <>
      <g className="text-sun">
        <circle cx="8.5" cy="8" r="3" fill="currentColor" />
        <path d="M8.5 1.5v2M2 8h2M3.9 3.4l1.4 1.4M13.1 3.4l-1.4 1.4" {...STROKE} />
      </g>
      <g className="text-slate-500" transform="translate(6.5 7.5) scale(0.72)">
        <path d={CLOUD} {...STROKE} style={{ fill: "rgb(var(--c-surface))" }} />
      </g>
    </>
  );
}

function Cloudy() {
  return (
    <g className="text-slate-500">
      <path d={CLOUD} {...STROKE} />
    </g>
  );
}

/** Feather's cloud-snow: the cloud open at the bottom, and flakes under it. */
function Snow() {
  return (
    <g className="text-slate-500">
      <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" {...STROKE} />
      <path d="M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01" {...STROKE} strokeWidth={2.4} />
    </g>
  );
}

function Glyph({ sky }: { sky: Sky }) {
  switch (sky) {
    case "night":
      return <Moon />;
    case "dawn":
      return <Horizon rising />;
    case "dusk":
      return <Horizon rising={false} />;
    case "partly":
      return <Partly />;
    case "cloudy":
      return <Cloudy />;
    case "snow":
      return <Snow />;
    default:
      return <Sun />;
  }
}

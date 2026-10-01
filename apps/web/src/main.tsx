import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { SessionExpiredError } from "./api/client";
import { I18nProvider } from "./i18n/context";
import { ThemeProvider } from "./lib/theme";
import "./index.css";

/**
 * Any request can be the first to learn that the session is gone — a live
 * card's minute poll, a refetch when the tab comes back, a save. Each used
 * to fail quietly where it stood, while the identity query, cached for the
 * life of the tab, still said "signed in" and the page kept showing the
 * last data it had. Re-asking `/api/me` moves the answer to the one query
 * the shell watches: it is turned away the same way, the session reads as
 * expired, and the shell goes to sign in (see SessionExpired in App.tsx).
 */
function onRequestError(error: unknown) {
  if (error instanceof SessionExpiredError) void queryClient.invalidateQueries({ queryKey: ["me"] });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onRequestError }),
  mutationCache: new MutationCache({ onError: onRequestError }),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

// Registered only so Chrome offers "Install app" instead of a plain
// shortcut — see public/sw.js for why it does no caching.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

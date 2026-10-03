import { describe, expect, it } from "vitest";
import { sitesToSync } from "./selection.js";

const home = { id: "a", syncPaused: false };
const paused = { id: "b", syncPaused: true };

describe("sitesToSync", () => {
  it("leaves a paused site out of the scheduled run", () => {
    expect(sitesToSync([home, paused])).toEqual([home]);
  });

  it("takes only the site a manual sync names, never its neighbours", () => {
    expect(sitesToSync([home, paused], "a")).toEqual([home]);
  });

  it("still runs a paused site when it is asked for by hand", () => {
    expect(sitesToSync([home, paused], "b")).toEqual([paused]);
  });

  it("covers nothing for a site that does not exist", () => {
    expect(sitesToSync([home, paused], "zz")).toEqual([]);
  });
});

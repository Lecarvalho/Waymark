"use client";

import { useEffect, useState } from "react";
import type { ProviderCapabilities } from "../src/orchestration/provider-capabilities.mjs";

const serviceUrl =
  process.env.NEXT_PUBLIC_WAYMARK_SERVICE_URL ?? "http://127.0.0.1:4318";

export type CapabilityState = "loading" | "ready" | "unavailable";

export function useProviderCapabilities(auditMode: string) {
  const [capabilities, setCapabilities] =
    useState<ProviderCapabilities | null>(null);
  const [databasePath, setDatabasePath] = useState<string | null>(null);
  const [state, setState] = useState<CapabilityState>("loading");
  const [loadedAuditMode, setLoadedAuditMode] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const query = new URLSearchParams({ auditMode });
    const readJson = async <Value,>(path: string) => {
      const response = await fetch(`${serviceUrl}${path}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Waymark service returned ${response.status}.`);
      }
      return (await response.json()) as Value;
    };

    Promise.all([
      readJson<ProviderCapabilities>(`/api/provider-capabilities?${query}`),
      readJson<{ databasePath: string }>("/health"),
    ])
      .then(([value, health]) => {
        if (
          typeof health.databasePath !== "string" ||
          health.databasePath.trim() === ""
        ) {
          throw new Error("Waymark service did not report its audit journal.");
        }
        setCapabilities(value);
        setDatabasePath(health.databasePath);
        setState("ready");
        setLoadedAuditMode(auditMode);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setCapabilities(null);
        setDatabasePath(null);
        setState("unavailable");
        setLoadedAuditMode(auditMode);
      });

    return () => controller.abort();
  }, [auditMode]);

  const loaded = loadedAuditMode === auditMode;
  return {
    capabilities: loaded ? capabilities : null,
    databasePath: loaded ? databasePath : null,
    serviceUrl,
    state: loaded ? state : "loading",
  };
}

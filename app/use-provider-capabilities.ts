"use client";

import { useEffect, useState } from "react";
import type { ProviderCapabilities } from "../src/orchestration/provider-capabilities.mjs";

const serviceUrl =
  process.env.NEXT_PUBLIC_WAYMARK_SERVICE_URL ?? "http://127.0.0.1:4318";

export type CapabilityState = "loading" | "ready" | "unavailable";

export function useProviderCapabilities(auditMode: string) {
  const [capabilities, setCapabilities] =
    useState<ProviderCapabilities | null>(null);
  const [state, setState] = useState<CapabilityState>("loading");
  const [loadedAuditMode, setLoadedAuditMode] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const query = new URLSearchParams({ auditMode });
    fetch(`${serviceUrl}/api/provider-capabilities?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Waymark service returned ${response.status}.`);
        }
        return response.json() as Promise<ProviderCapabilities>;
      })
      .then((value) => {
        setCapabilities(value);
        setState("ready");
        setLoadedAuditMode(auditMode);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setCapabilities(null);
        setState("unavailable");
        setLoadedAuditMode(auditMode);
      });

    return () => controller.abort();
  }, [auditMode]);

  const loaded = loadedAuditMode === auditMode;
  return {
    capabilities: loaded ? capabilities : null,
    state: loaded ? state : "loading",
  };
}

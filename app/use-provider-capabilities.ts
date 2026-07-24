"use client";

import { useEffect, useState } from "react";
import type { ProviderCapabilities } from "../src/orchestration/provider-capabilities.mjs";

const serviceUrl =
  process.env.NEXT_PUBLIC_WAYMARK_SERVICE_URL ?? "http://127.0.0.1:4318";

export type CapabilityState = "loading" | "ready" | "unavailable";

export function useProviderCapabilities() {
  const [capabilities, setCapabilities] =
    useState<ProviderCapabilities | null>(null);
  const [state, setState] = useState<CapabilityState>("loading");

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${serviceUrl}/api/provider-capabilities`, {
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
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setCapabilities(null);
        setState("unavailable");
      });

    return () => controller.abort();
  }, []);

  return { capabilities, state };
}

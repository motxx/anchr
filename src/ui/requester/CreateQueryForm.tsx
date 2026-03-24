import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Globe, Loader2, MapPin, Plus } from "lucide-react";
import React, { useRef, useState } from "react";
import { apiFetch } from "../api-config";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

interface CreateResponse {
  query_id: string;
  status: string;
  description: string;
  challenge_nonce: string | null;
}

type QueryMode = "tlsn" | "photo";

export function CreateQueryForm() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QueryMode>("tlsn");

  // Shared
  const descRef = useRef<HTMLTextAreaElement>(null);
  const bountyRef = useRef<HTMLInputElement>(null);
  const ttlRef = useRef<HTMLInputElement>(null);

  // TLSNotary
  const urlRef = useRef<HTMLInputElement>(null);
  const conditionTypeRef = useRef<HTMLSelectElement>(null);
  const conditionExprRef = useRef<HTMLInputElement>(null);
  const conditionDescRef = useRef<HTMLInputElement>(null);

  // Photo
  const locationRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lonRef = useRef<HTMLInputElement>(null);
  const [gettingLocation, setGettingLocation] = useState(false);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current) latRef.current.value = pos.coords.latitude.toFixed(6);
        if (lonRef.current) lonRef.current.value = pos.coords.longitude.toFixed(6);
        setGettingLocation(false);
      },
      () => setGettingLocation(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const mutation = useMutation<CreateResponse, Error>({
    mutationFn: async () => {
      const description = descRef.current?.value?.trim();
      if (!description) throw new Error("Description is required");

      const body: Record<string, unknown> = { description };

      if (mode === "tlsn") {
        const targetUrl = urlRef.current?.value?.trim();
        if (!targetUrl) throw new Error("Target URL is required");

        body.verification_requirements = ["tlsn"];
        const tlsn: Record<string, unknown> = { target_url: targetUrl };

        const condType = conditionTypeRef.current?.value;
        const condExpr = conditionExprRef.current?.value?.trim();
        if (condType && condExpr) {
          const cond: Record<string, string> = { type: condType, expression: condExpr };
          const condDesc = conditionDescRef.current?.value?.trim();
          if (condDesc) cond.description = condDesc;
          tlsn.conditions = [cond];
        }

        body.tlsn_requirements = tlsn;
      } else {
        // Photo
        const location = locationRef.current?.value?.trim();
        if (location) body.location_hint = location;

        const lat = Number(latRef.current?.value);
        const lon = Number(lonRef.current?.value);
        if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
          body.expected_gps = { lat, lon };
        }
      }

      const bountyVal = Number(bountyRef.current?.value);
      if (bountyVal > 0) body.bounty = { amount_sats: bountyVal };

      const ttlVal = Number(ttlRef.current?.value);
      if (ttlVal > 0) body.ttl_seconds = ttlVal * 60;

      const res = await apiFetch("/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error ?? `Error ${res.status}`);
      }
      return res.json() as Promise<CreateResponse>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queries-all"] });
      // Reset all fields
      [descRef, urlRef, conditionExprRef, conditionDescRef, locationRef, bountyRef, ttlRef, latRef, lonRef].forEach(
        (r) => { if (r.current) (r.current as HTMLInputElement | HTMLTextAreaElement).value = ""; },
      );
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="w-full gap-2">
        <Plus className="w-4 h-4" />
        Create Query
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">New Query</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-1 p-0.5 bg-muted rounded-md">
          {([
            { key: "tlsn" as QueryMode, label: "Web Proof", icon: Globe },
            { key: "photo" as QueryMode, label: "Photo", icon: Camera },
          ]).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                mode === m.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <m.icon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          ))}
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Description <span className="text-red-500">*</span>
          </label>
          <Textarea
            ref={descRef}
            placeholder={mode === "tlsn"
              ? "e.g. Verify BTC price from CoinGecko"
              : "e.g. Photo of Shibuya Scramble Crossing right now"}
            rows={2}
          />
        </div>

        {/* TLSNotary fields */}
        {mode === "tlsn" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Target URL <span className="text-red-500">*</span>
              </label>
              <Input
                ref={urlRef}
                type="url"
                placeholder="https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Condition (optional)
              </label>
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <select
                  ref={conditionTypeRef}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
                  defaultValue="jsonpath"
                >
                  <option value="jsonpath">JSONPath</option>
                  <option value="contains">Contains</option>
                  <option value="regex">Regex</option>
                </select>
                <Input ref={conditionExprRef} placeholder="bitcoin.usd" />
              </div>
              <Input
                ref={conditionDescRef}
                placeholder="Description (e.g. BTC price exists)"
                className="mt-1.5"
              />
            </div>
          </>
        )}

        {/* Photo fields */}
        {mode === "photo" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Location hint</label>
              <Input ref={locationRef} placeholder="e.g. Shibuya, Tokyo" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">GPS (proximity check)</label>
                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={gettingLocation}
                  className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 disabled:opacity-50"
                >
                  {gettingLocation ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <MapPin className="w-3 h-3" />
                  )}
                  Use my location
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input ref={latRef} type="number" step="any" placeholder="Lat (e.g. 35.6595)" />
                <Input ref={lonRef} type="number" step="any" placeholder="Lon (e.g. 139.7004)" />
              </div>
            </div>
          </>
        )}

        {/* Shared: bounty + TTL */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Bounty (sats)</label>
            <Input ref={bountyRef} type="number" min={1} placeholder="21" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">TTL (minutes)</label>
            <Input ref={ttlRef} type="number" min={1} placeholder="10" />
          </div>
        </div>

        {/* Feedback */}
        {mutation.isError && (
          <p className="text-sm text-red-500">{mutation.error.message}</p>
        )}
        {mutation.isSuccess && (
          <p className="text-sm text-emerald-500">
            Created: {mutation.data.query_id}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1 gap-2"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

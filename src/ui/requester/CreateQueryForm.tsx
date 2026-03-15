import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Plus } from "lucide-react";
import React, { useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

interface CreateResponse {
  query_id: string;
  status: string;
  description: string;
  challenge_nonce: string;
}

export function CreateQueryForm() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const bountyRef = useRef<HTMLInputElement>(null);
  const ttlRef = useRef<HTMLInputElement>(null);
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
      if (!description) throw new Error("内容を入力してください");

      const body: Record<string, unknown> = { description };

      const location = locationRef.current?.value?.trim();
      if (location) body.location_hint = location;

      const lat = Number(latRef.current?.value);
      const lon = Number(lonRef.current?.value);
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
        body.expected_gps = { lat, lon };
      }

      const bountyVal = Number(bountyRef.current?.value);
      if (bountyVal > 0) body.bounty = { amount_sats: bountyVal };

      const ttlVal = Number(ttlRef.current?.value);
      if (ttlVal > 0) body.ttl_seconds = ttlVal * 60;

      const res = await fetch("/queries", {
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
      if (descRef.current) descRef.current.value = "";
      if (locationRef.current) locationRef.current.value = "";
      if (bountyRef.current) bountyRef.current.value = "";
      if (ttlRef.current) ttlRef.current.value = "";
      if (latRef.current) latRef.current.value = "";
      if (lonRef.current) lonRef.current.value = "";
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="w-full gap-2">
        <Plus className="w-4 h-4" />
        新しいリクエストを作成
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">新しいリクエスト</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            内容 <span className="text-red-500">*</span>
          </label>
          <Textarea
            ref={descRef}
            placeholder="例: 渋谷スクランブル交差点の今の様子を撮影してほしい"
            rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">場所のヒント</label>
          <Input ref={locationRef} placeholder="例: 東京都渋谷区" />
        </div>

        {/* GPS coordinates */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">GPS座標 (近接チェック用)</label>
            <button
              type="button"
              onClick={useMyLocation}
              disabled={gettingLocation}
              className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              {gettingLocation ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <MapPin className="w-3 h-3" />
              )}
              現在地を使用
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input ref={latRef} type="number" step="any" placeholder="緯度 (例: 35.6595)" />
            <Input ref={lonRef} type="number" step="any" placeholder="経度 (例: 139.7004)" />
          </div>
          <p className="text-[10px] text-muted-foreground">
            設定すると、写真のGPSが半径50km以内か検証します
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">報酬 (sats)</label>
            <Input ref={bountyRef} type="number" min={1} placeholder="21" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">有効期限 (分)</label>
            <Input ref={ttlRef} type="number" min={1} placeholder="10" />
          </div>
        </div>

        {mutation.isError && (
          <p className="text-sm text-red-500">{mutation.error.message}</p>
        )}

        {mutation.isSuccess && (
          <p className="text-sm text-emerald-600">
            リクエスト作成完了: {mutation.data.query_id}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setOpen(false)}
          >
            キャンセル
          </Button>
          <Button
            className="flex-1 gap-2"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            作成
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

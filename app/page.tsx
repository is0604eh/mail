"use client";

import React, { useEffect, useMemo, useState } from "react";

type Service = "lunch" | "dinner";
type EventMode = "none" | "yes";

type Inputs = {
  service: Service;

  // ✅ ランチのみ必須
  weather: string;

  // ✅ 両方必須
  customers: string[];
  customersFree: string;

  // ✅ 両方必須
  peak: string; // 例 "12-14" / "12:00-14:00"

  // ✅ 両方必須
  hits: string[];
  hitsFree: string;

  // ✅ 任意（フードコート雰囲気）
  seatFeel: string;

  // 任意
  eventMode: EventMode;
  eventName: string;
  notice: string;

  // 任意（矛盾防止に使える）
  openTime: string; // 例 "10:30"
};

const CUSTOMER_OPTIONS = [
  "家族連れ",
  "学生",
  "会社員",
  "カップル",
  "おひとり様",
  "観光客",
] as const;

const HIT_OPTIONS = [
  "親子丼",
  "親子丼セット",
  "チーズの親子丼",
  "極上",
  "ゆず塩親子丼",
  "から揚げ",
  "持ち帰り親子丼",
  "持ち帰りから揚げ",
  "からあげ丼",
  "ジュース",
  "スタッフメニュー",
] as const;

const STORAGE_KEY = "mail-gen:free:v2";

// -------------------- utils --------------------
function normalizeText(s: string) {
  return (s ?? "").trim().replace(/\s+/g, " ");
}
function isBlank(s: string) {
  return normalizeText(s).length === 0;
}
function unique(items: string[]) {
  return Array.from(new Set(items.map(normalizeText).filter(Boolean)));
}
function splitFreeText(s: string) {
  const t = normalizeText(s);
  if (!t) return [];
  return t
    .split(/[、,]/)
    .map((x) => normalizeText(x))
    .filter(Boolean);
}
function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function joinNatural(items: string[]) {
  const xs = unique(items);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]}や${xs[1]}`;
  return `${xs.slice(0, -1).join("、")}など`;
}

// 禁止語（出力に絶対入れない）
function sanitizeForbidden(text: string) {
  const forbidden = [
    "今日の流れを共有します",
    "本日の流れを共有します",
    "共有します",
    "着席率",
    "推移",
    "回転",
  ];
  let t = text ?? "";
  for (const w of forbidden) t = t.replaceAll(w, "");
  t = t.replace(/、、+/g, "、").replace(/。。+/g, "。");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// "12-14" / "12:00-14:00" -> "12時から14時"
function formatTimeRange(rangeRaw: string) {
  const range = normalizeText(rangeRaw);
  if (!range.includes("-")) return range;

  const [startRaw, endRaw] = range.split("-").map((x) => x.trim());

  const toJP = (t: string) => {
    if (!t) return "";
    if (t.includes(":")) {
      const [h, m] = t.split(":");
      const hh = Number(h);
      const mm = Number(m);
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        return mm === 0 ? `${hh}時` : `${hh}時${mm}分`;
      }
      return t;
    }
    const hh = Number(t);
    return Number.isFinite(hh) ? `${hh}時` : t;
  };

  const start = toJP(startRaw);
  const end = toJP(endRaw);
  return start && end ? `${start}から${end}` : range;
}

// "12-14" -> 12, "12:00-14:00" -> 12
function parseStartHour(peakRaw: string) {
  const range = normalizeText(peakRaw);
  const start = range.split("-")[0]?.trim() ?? "";
  const hStr = start.includes(":") ? start.split(":")[0] : start;
  const h = Number(hStr);
  return Number.isFinite(h) ? h : null;
}

// ✅ 「穏やかなスタート」を出して良い条件
// - ランチのみ
// - ピーク開始が12時以降
function canSayGentleStart(i: Inputs) {
  if (i.service !== "lunch") return false;
  const h = parseStartHour(i.peak);
  if (h === null) return false;
  return h >= 12;
}

type CrowdLevel = "busy" | "normal" | "quiet";

function inferCrowdLevel(seatFeelRaw: string): CrowdLevel {
  const s = normalizeText(seatFeelRaw);

  if (
    /満席|混み|混ん|行列|立て込|立て込み|ばたつ|ぎゅうぎゅう|詰ま/i.test(s)
  ) {
    return "busy";
  }
  if (/空席|空いて|ガラガラ|落ち着|暇|ゆったり/i.test(s)) {
    return "quiet";
  }
  return "normal";
}

// 文章の仕上げ（事故を減らす）
function polishJapanese(text: string) {
  let t = sanitizeForbidden(text);
  t = t.replace(/、で、/g, "、");
  t = t.replace(/  +/g, " ");
  t = t.replace(/。+/g, "。");
  return t.trim();
}

// 2〜3文に抑える：句点数を調整（最大3文）
function clampTo3Sentences(text: string) {
  const t = polishJapanese(text);
  const parts = t.split("。").map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 3) return t;
  return `${parts.slice(0, 3).join("。")}。`;
}

// -------------------- template engine (no LLM) --------------------

// ✅ ランチ：天気必須 / 片づけ禁止 / 「共有」系禁止 / 2〜3文へ統合
function buildLunchText(i: Inputs, customersMerged: string[], hitsMerged: string[]) {
  const weather = normalizeText(i.weather);
  const customersText = joinNatural(customersMerged);
  const hits = hitsMerged;
  const peakJP = formatTimeRange(i.peak);
  const seatFeel = normalizeText(i.seatFeel);
  const crowd = inferCrowdLevel(seatFeel);

  const eventName = i.eventMode === "yes" ? normalizeText(i.eventName) : "";
  const notice = normalizeText(i.notice);

  // ---- ① 導入（天気＋立ち上がり） ----
  const intro = (() => {
    const head = pick([
      `天気は${weather}で、`,
      `天気が${weather}で、`,
      `天気は${weather}でした。`,
    ]);

    if (head.endsWith("。")) {
      // 「天気は晴れでした。」タイプのときは次節を繋げて1文に寄せる
      const next =
        canSayGentleStart(i)
          ? pick(["立ち上がりは落ち着いた入りでした。", "序盤は比較的穏やかでした。"])
          : pick(["早い時間帯から動きが出ていました。", "序盤から注文が入りやすい流れでした。"]);
      return `${head} ${next}`;
    }

    const tail =
      canSayGentleStart(i)
        ? pick(["立ち上がりは落ち着いた入りでした。", "序盤は比較的穏やかでした。", "出だしは落ち着いた入りでした。"])
        : pick(["早い時間帯から動きが出ていました。", "序盤から店前がにぎわいました。", "早めの時間から注文が入りやすい日でした。"]);

    return `${head}${tail}`;
  })();

  // ---- ② 客層＋ピーク（1文にまとめる） ----
  const mid = (() => {
    const customerClause = customersText
      ? pick([
          `${customersText}の来店が目立ち、`,
          `${customersText}が多い印象で、`,
          `${customersText}が中心で、`,
        ])
      : ""; // 必須だが保険

    const peakClause = peakJP
      ? pick([
          `${peakJP}にかけて注文が重なりました。`,
          `${peakJP}あたりが一番立て込みました。`,
          `${peakJP}頃がピークでした。`,
        ])
      : "ピークの波がありました。";

    // 「目立ち、〜」のように読点で繋ぐ
    return `${customerClause}${peakClause}`;
  })();

  // ---- ③ 全体印象＋売れ筋＋（任意で雰囲気/イベント/連絡） ----
  const end = (() => {
    const base =
      crowd === "busy"
        ? pick([
            "立て込みましたが、崩れるほどではなく回せています。",
            "注文が重なる場面はありましたが、大きな混乱はありませんでした。",
          ])
        : crowd === "quiet"
        ? pick([
            "比較的落ち着いて対応できました。",
            "落ち着いた時間帯が多めでした。",
          ])
        : pick([
            "波はありつつも無理なく回せた印象です。",
            "ほどよい動きの中で回せました。",
          ]);

    const hitClause =
      hits.length > 0
        ? (() => {
            const a = hits[0];
            const b = hits[1];
            const text = b ? `${a}と${b}` : a;
            return pick([
              `${text}が多めに出ています。`,
              `${text}の注文が目立ちました。`,
              `${text}がよく動きました。`,
            ]);
          })()
        : "";

    // 雰囲気は“補足”として末尾に任意で載せる（矛盾しにくい）
    const feelClause = seatFeel
      ? pick([
          `フードコート内は体感で「${seatFeel}」くらいでした。`,
          `フードコート内は「${seatFeel}」に近い印象でした。`,
        ])
      : "";

    const eventClause = eventName
      ? pick([`（${eventName}も入っていました）`, `（${eventName}が入っていました）`])
      : "";

    // 連絡事項は最後に別枠（短く）
    const noticeClause = notice ? `連絡事項：${notice}` : "";

    // 文章の伸びすぎ防止：雰囲気/イベントはどちらか片方に寄せる
    const extra = pick([
      feelClause,
      eventClause,
      "", // 何も付けないパターンも残す
    ]);

    // base と hitClause は同一文にまとめる
    const baseAndHit = (() => {
      if (!hitClause) return base;
      // baseの句点を外して読点接続
      const baseNoDot = base.replace(/。$/, "");
      return `${baseNoDot}、${hitClause}`;
    })();

    // 連絡事項がある場合は最後に別文で付けやすい
    const chunks = [baseAndHit];
    if (extra) chunks.push(extra);
    if (noticeClause) chunks.push(noticeClause);

    return chunks.join(" ");
  })();

  // ランチは「片づけ」絶対排除
  let out = `${intro} ${mid} ${end}`.replace(/片づけ|片付け/g, "");
  out = clampTo3Sentences(out);
  return polishJapanese(out);
}

// ✅ ディナー：天気は出さない / 2〜3文へ統合 / 「片づけ」は落ち着き寄りの時だけ
function buildDinnerText(i: Inputs, customersMerged: string[], hitsMerged: string[]) {
  const customersText = joinNatural(customersMerged);
  const hits = hitsMerged;
  const peakJP = formatTimeRange(i.peak);
  const seatFeel = normalizeText(i.seatFeel);
  const crowd = inferCrowdLevel(seatFeel);

  const eventName = i.eventMode === "yes" ? normalizeText(i.eventName) : "";
  const notice = normalizeText(i.notice);

  // ---- ① 導入＋客層 ----
  const intro = (() => {
    const head = pick(
      crowd === "busy"
        ? ["夕方以降も立て込み、", "夜も動きが多く、", "後半も注文が重なりやすく、"]
        : crowd === "quiet"
        ? ["夕方以降は落ち着いた雰囲気で、", "後半は比較的落ち着いて、", "夜は静かめで、"]
        : ["夕方以降はほどよい混み具合で、", "後半は無理のない流れで、", "夜はほどよい動きで、"]
    );

    const customerClause = customersText
      ? pick([
          `${customersText}の来店が目立ちました。`,
          `${customersText}が多い印象でした。`,
        ])
      : "来店がありました。";

    return `${head}${customerClause}`;
  })();

  // ---- ② ピーク＋雰囲気（任意） ----
  const mid = (() => {
    const peakClause = peakJP
      ? pick([
          `${peakJP}あたりで注文が重なりました。`,
          `${peakJP}頃がピークでした。`,
          `${peakJP}にかけて立て込みました。`,
        ])
      : pick(["ピークの波がありました。", "時間帯で波がありました。"]);

    const feelClause = seatFeel
      ? pick([
          `フードコート内は体感で「${seatFeel}」くらいでした。`,
          `フードコート内は「${seatFeel}」に近い印象でした。`,
        ])
      : "";

    return feelClause ? `${peakClause} ${feelClause}` : peakClause;
  })();

  // ---- ③ 全体印象＋売れ筋＋（条件で片づけ）＋（任意でイベント/連絡） ----
  const end = (() => {
    const base =
      crowd === "busy"
        ? pick([
            "忙しい時間帯もありましたが、大きな混乱はありませんでした。",
            "立て込みましたが、崩れるほどではありませんでした。",
          ])
        : crowd === "quiet"
        ? pick([
            "落ち着いた時間帯が多めでした。",
            "比較的落ち着いて対応できました。",
          ])
        : pick([
            "波はありつつも無理なく回せた印象です。",
            "ほどよい動きの中で対応できました。",
          ]);

    const hitClause =
      hits.length > 0
        ? (() => {
            const a = hits[0];
            const b = hits[1];
            const text = b ? `${a}と${b}` : a;
            return pick([
              `${text}の注文が目立ちました。`,
              `${text}が多めに出ています。`,
              `${text}がよく動きました。`,
            ]);
          })()
        : "";

    const cleanupClause =
      crowd === "quiet"
        ? pick(["仕込みや片づけも進められました。", "片づけまで含めて整えやすい日でした。"])
        : "";

    const eventClause = eventName
      ? pick([`（${eventName}も入っていました）`, `（${eventName}が入っていました）`])
      : "";

    const noticeClause = notice ? `連絡事項：${notice}` : "";

    const baseAndHit = (() => {
      if (!hitClause) return base;
      const baseNoDot = base.replace(/。$/, "");
      return `${baseNoDot}、${hitClause}`;
    })();

    // 伸びすぎ防止：event と cleanup はどちらか片方に寄せる
    const extra = pick([cleanupClause, eventClause, ""]);

    const chunks = [baseAndHit];
    if (extra) chunks.push(extra);
    if (noticeClause) chunks.push(noticeClause);

    return chunks.join(" ");
  })();

  let out = `${intro} ${mid} ${end}`;
  out = clampTo3Sentences(out);
  return polishJapanese(out);
}

function buildDailyMail(i: Inputs, customersMerged: string[], hitsMerged: string[]) {
  return i.service === "lunch"
    ? buildLunchText(i, customersMerged, hitsMerged)
    : buildDinnerText(i, customersMerged, hitsMerged);
}

// -------------------- UI components --------------------
function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-3 py-2 rounded-lg border text-sm transition",
        active
          ? "bg-black text-white border-black"
          : "bg-white text-black hover:bg-gray-50",
      ].join(" ")}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function MultiSelect({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <ToggleChip
            key={opt}
            label={opt}
            active={active}
            onClick={() => {
              if (active) onChange(value.filter((x) => x !== opt));
              else onChange([...value, opt]);
            }}
          />
        );
      })}
    </div>
  );
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export default function Page() {
  const [inputs, setInputs] = useState<Inputs>({
    service: "lunch",
    weather: "",

    customers: [],
    customersFree: "",

    peak: "",

    hits: [],
    hitsFree: "",

    seatFeel: "",

    eventMode: "none",
    eventName: "",
    notice: "",
    openTime: "10:30",
  });

  const [output, setOutput] = useState("");
  const [toast, setToast] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // restore
  useEffect(() => {
    const saved = safeParse<Partial<Inputs>>(localStorage.getItem(STORAGE_KEY));
    if (saved) setInputs((p) => ({ ...p, ...saved }));
  }, []);

  // autosave
  useEffect(() => {
    const id = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    }, 200);
    return () => window.clearTimeout(id);
  }, [inputs]);

  // toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 1400);
    return () => window.clearTimeout(id);
  }, [toast]);

  const customersMerged = useMemo(
    () => unique([...inputs.customers, ...splitFreeText(inputs.customersFree)]),
    [inputs.customers, inputs.customersFree]
  );

  const hitsMerged = useMemo(
    () => unique([...inputs.hits, ...splitFreeText(inputs.hitsFree)]),
    [inputs.hits, inputs.hitsFree]
  );

  const validate = () => {
    const errs: string[] = [];
    if (inputs.service === "lunch" && isBlank(inputs.weather))
      errs.push("ランチは天気が必須");
    if (customersMerged.length === 0) errs.push("客層は必須");
    if (isBlank(inputs.peak)) errs.push("ピーク時間は必須");
    if (hitsMerged.length === 0) errs.push("売れ筋は必須");
    return errs;
  };

  const isReadyToGenerate = validate().length === 0;

  const generate = () => {
    const errs = validate();
    if (errs.length) {
      setToast(errs[0]);
      return;
    }
    setOutput(buildDailyMail(inputs, customersMerged, hitsMerged));
  };

  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setToast("コピーしました");
    } catch {
      const el = document.getElementById(
        "output-area"
      ) as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.select();
        setToast("選択しました（手動でコピー）");
      }
    }
  };

  const toLunch = () => {
    setInputs((p) => ({ ...p, service: "lunch" }));
    setOutput("");
  };

  const toDinner = () => {
    setInputs((p) => ({ ...p, service: "dinner" }));
    setOutput("");
  };

  const resetAll = () => {
    localStorage.removeItem(STORAGE_KEY);
    setInputs({
      service: "lunch",
      weather: "",
      customers: [],
      customersFree: "",
      peak: "",
      hits: [],
      hitsFree: "",
      seatFeel: "",
      eventMode: "none",
      eventName: "",
      notice: "",
      openTime: "10:30",
    });
    setOutput("");
    setToast("クリアしました");
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === "Enter") {
        e.preventDefault();
        generate();
      }
      if ((e.key === "C" || e.key === "c") && e.shiftKey) {
        e.preventDefault();
        copy();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output, inputs]);

  const peakPlaceholder =
    inputs.service === "lunch"
      ? "例）12-14 / 12:00-14:00（11- のとき“穏やかスタート”は出さない）"
      : "例）19-20 / 19:00-20:00";

  return (
    <main className="min-h-screen bg-gray-50 text-black">
      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded-xl bg-black text-white px-4 py-2 text-sm shadow">
          {toast}
        </div>
      )}

      <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold">
            らくらくめーる
          </h1>
          <p className="text-sm text-gray-600">
            ルール＋文法テンプレで自然文を2〜3文にまとめて生成。（Cmd/Ctrl+Enterで生成、Cmd/Ctrl+Shift+Cでコピー）
          </p>
        </header>

        {/* 入力 */}
        <section className="bg-white rounded-2xl border p-5 md:p-6 space-y-5">
          {/* 時間帯切替 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border p-1 bg-white">
              <button
                type="button"
                onClick={toLunch}
                className={[
                  "px-4 py-2 rounded-lg text-sm transition",
                  inputs.service === "lunch"
                    ? "bg-black text-white"
                    : "text-black hover:bg-gray-100",
                ].join(" ")}
              >
                ランチ
              </button>
              <button
                type="button"
                onClick={toDinner}
                className={[
                  "px-4 py-2 rounded-lg text-sm transition",
                  inputs.service === "dinner"
                    ? "bg-black text-white"
                    : "text-black hover:bg-gray-100",
                ].join(" ")}
              >
                ディナー
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-sm underline text-gray-600 hover:text-black"
            >
              {showAdvanced ? "詳細（任意）を閉じる" : "詳細（任意）を開く"}
            </button>

            <button
              type="button"
              onClick={resetAll}
              className="ml-auto px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm"
            >
              入力クリア
            </button>
          </div>

          {/* ✅ ランチ：天気必須 */}
          {inputs.service === "lunch" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">天気（ランチ必須）</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="例）晴れ / くもり / 雨 / 風強め"
                value={inputs.weather}
                onChange={(e) =>
                  setInputs((p) => ({ ...p, weather: e.target.value }))
                }
              />
            </div>
          )}

          {/* ✅ 客層（両方必須） */}
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <label className="text-sm font-medium">客層（必須）</label>
              <span className="text-xs text-gray-500">＋ 手入力OK</span>
            </div>
            <MultiSelect
              options={CUSTOMER_OPTIONS}
              value={inputs.customers}
              onChange={(v) => setInputs((p) => ({ ...p, customers: v }))}
            />
            <input
              className="w-full rounded-xl border px-3 py-2"
              placeholder="手入力（例）ベビーカー多め、部活帰り など"
              value={inputs.customersFree}
              onChange={(e) =>
                setInputs((p) => ({ ...p, customersFree: e.target.value }))
              }
            />
          </div>

          {/* ✅ ピーク（両方必須） */}
          <div className="space-y-2">
            <label className="text-sm font-medium">ピーク時間（必須）</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              placeholder={peakPlaceholder}
              value={inputs.peak}
              onChange={(e) => setInputs((p) => ({ ...p, peak: e.target.value }))}
            />
            <p className="text-xs text-gray-500 mt-1">
              出力では「12-14」→「12時から14時」のように自然表現に変換
            </p>
          </div>

          {/* ✅ 売れ筋（両方必須） */}
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <label className="text-sm font-medium">売れ筋（必須）</label>
              <span className="text-xs text-gray-500">
                選択 or 手入力どちらでもOK
              </span>
            </div>
            <MultiSelect
              options={HIT_OPTIONS}
              value={inputs.hits}
              onChange={(v) => setInputs((p) => ({ ...p, hits: v }))}
            />
            <input
              className="w-full rounded-xl border px-3 py-2"
              placeholder="手入力（例）から揚げ多め、セット強い、持ち帰り多め など"
              value={inputs.hitsFree}
              onChange={(e) =>
                setInputs((p) => ({ ...p, hitsFree: e.target.value }))
              }
            />
          </div>

          {/* ✅ フードコート雰囲気（任意） */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              フードコート内の雰囲気（任意）
            </label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              placeholder="例）満席 / 席は埋まり気味 / 落ち着いてた / 行列あり"
              value={inputs.seatFeel}
              onChange={(e) =>
                setInputs((p) => ({ ...p, seatFeel: e.target.value }))
              }
            />
            <p className="text-xs text-gray-500">
              ※ 出力では「着席率」「推移」「回転」などの機械語は使わない
            </p>
          </div>

          {/* 詳細（任意） */}
          {showAdvanced && (
            <div className="pt-2 space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">イベント（任意）</label>
                  <div className="flex items-center gap-2">
                    <ToggleChip
                      label="なし"
                      active={inputs.eventMode === "none"}
                      onClick={() =>
                        setInputs((p) => ({ ...p, eventMode: "none" }))
                      }
                    />
                    <ToggleChip
                      label="あり"
                      active={inputs.eventMode === "yes"}
                      onClick={() =>
                        setInputs((p) => ({ ...p, eventMode: "yes" }))
                      }
                    />
                  </div>
                  {inputs.eventMode === "yes" && (
                    <input
                      className="w-full rounded-xl border px-3 py-2 mt-2"
                      placeholder="任意：イベント名（例）三連休 / セール / 近隣ライブ"
                      value={inputs.eventName}
                      onChange={(e) =>
                        setInputs((p) => ({ ...p, eventName: e.target.value }))
                      }
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">開店時刻（任意）</label>
                  <input
                    className="w-full rounded-xl border px-3 py-2"
                    placeholder="例）10:30"
                    value={inputs.openTime}
                    onChange={(e) =>
                      setInputs((p) => ({ ...p, openTime: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">連絡事項（任意）</label>
                <textarea
                  className="w-full rounded-2xl border px-3 py-2 min-h-[90px]"
                  placeholder="例）明日は開店前にタレ補充 / レジ操作変更あり など"
                  value={inputs.notice}
                  onChange={(e) =>
                    setInputs((p) => ({ ...p, notice: e.target.value }))
                  }
                />
              </div>
            </div>
          )}

          {/* actions */}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={generate}
              disabled={!isReadyToGenerate}
              className="px-5 py-2 rounded-xl bg-black text-white hover:opacity-90 disabled:opacity-50"
              title={isReadyToGenerate ? "" : validate()[0]}
            >
              生成
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={!isReadyToGenerate}
              className="px-5 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              再生成（言い回し変更）
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={!output}
              className="px-5 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              コピー
            </button>

            {inputs.service === "lunch" ? (
              <button
                type="button"
                onClick={toDinner}
                className="px-5 py-2 rounded-xl border bg-white hover:bg-gray-50"
              >
                ディナー入力へ
              </button>
            ) : (
              <button
                type="button"
                onClick={toLunch}
                className="px-5 py-2 rounded-xl border bg-white hover:bg-gray-50"
              >
                ランチ入力へ
              </button>
            )}
          </div>
        </section>

        {/* 出力 */}
        <section className="bg-white rounded-2xl border p-5 md:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">出力（文章のみ）</h2>
            <span className="text-xs text-gray-500">
              {output ? "生成済み" : "未生成"}
            </span>
          </div>
          <textarea
            id="output-area"
            className="w-full rounded-2xl border px-3 py-3 min-h-[220px] text-sm"
            value={output}
            readOnly
            placeholder="ここに日報メール文が出ます"
          />
        </section>
      </div>
    </main>
  );
}

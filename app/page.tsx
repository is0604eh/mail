"use client";

import React, { useEffect, useState } from "react";

type Service = "lunch" | "dinner";
type EventMode = "none" | "yes";

type Inputs = {
  // 1日情報（基本：ランチでだけ使う）
  weather: string;
  eventMode: EventMode;
  eventName: string;
  customers: string[];
  customersFree: string;

  // 時間帯情報（ランチ/ディナーで毎回使う）
  service: Service;
  seatFeel: string; // 自由入力（出力では機械語を避ける）
  lunchPeak: string; // 例 "12-14" / "12:00-14:00"
  dinnerPeak: string;

  hits: string[];
  hitsFree: string;

  // 任意
  notice: string;
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

// -------------------- utils --------------------
function normalizeText(s: string) {
  return (s ?? "").trim().replace(/\s+/g, " ");
}
function isBlank(s: string) {
  return normalizeText(s).length === 0;
}
function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
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
function joinNatural(items: string[]) {
  const xs = unique(items);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]}や${xs[1]}`;
  return `${xs.slice(0, -1).join("、")}など`;
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
    if (Number.isFinite(hh)) return `${hh}時`;
    return t;
  };

  const start = toJP(startRaw);
  const end = toJP(endRaw);
  if (!start || !end) return range;
  return `${start}から${end}`;
}

// "19-20" -> "19時"（ディナーは開始時刻だけ使うと人間っぽい）
function formatStartTime(rangeRaw: string) {
  const range = normalizeText(rangeRaw);
  if (!range) return "";
  if (!range.includes("-")) return range;

  const [startRaw] = range.split("-").map((x) => x.trim());

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
    if (Number.isFinite(hh)) return `${hh}時`;
    return t;
  };

  return toJP(startRaw);
}

type CrowdLevel = "busy" | "normal" | "quiet";

function inferCrowdLevel(seatFeelRaw: string): CrowdLevel {
  const s = normalizeText(seatFeelRaw);

  // 忙しい寄り
  if (
    /満席|ぎゅうぎゅう|混み|混ん|行列|立て込|ばたつ|9割|8割|7割後半|80%|90%/i.test(
      s
    )
  )
    return "busy";

  // 空いてる寄り
  if (/空席|空いて|ガラガラ|落ち着|暇|3割|2割|20%|30%|40%/i.test(s))
    return "quiet";

  return "normal";
}

// 体感文（主語を必ず「フードコート内」にする）
function feelClause(seatFeelRaw: string) {
  const feel = normalizeText(seatFeelRaw);
  if (!feel) return "";
  return pick([
    `フードコート内は体感で「${feel}」くらいの混み具合でした。`,
    `フードコート内の混み具合は、体感で「${feel}」に近い印象でした。`,
  ]);
}

// 文章の最後に軽く整形（事故を減らす）
function polishJapanese(text: string) {
  let t = text;
  t = t.replace(/、、+/g, "、").replace(/。。+/g, "。");
  t = t.replace(/、で、/g, "、");
  t = t.replace(/  +/g, " ");
  return t.trim();
}

// -------------------- prediction --------------------
// 天気×客層×売れ筋から「人間が書きそうな予測コメント」を最大1文だけ足す
function predictSentence(i: Inputs) {
  const weather = normalizeText(i.weather);
  const customers = unique([...i.customers, ...splitFreeText(i.customersFree)]);
  const hits = unique([...i.hits, ...splitFreeText(i.hitsFree)]);

  const isGoodWeather = /晴|快晴|日差し|暖|ぽかぽか|暑/i.test(weather);
  const isBadWeather = /雨|雪|風|寒|荒れ/i.test(weather);

  const hasFamily = customers.some((c) => /家族|親子|ベビーカー/i.test(c));
  const hasTourist = customers.some((c) => /観光/i.test(c));
  const hasStudents = customers.some((c) => /学生|部活/i.test(c));

  const hasTakeout = hits.some((h) => /持ち帰り|テイク/i.test(h));
  const hasSet = hits.some((h) => /セット/i.test(h));
  const hasKaraage = hits.some((h) => /から揚げ|からあげ/i.test(h));

  const cand: string[] = [];

  if (hasFamily) {
    cand.push(
      pick([
        "家族連れが多い日は、2点以上の注文やセットが入りやすい流れでした。",
        "家族連れが多かった分、複数点の注文やセットが増えやすい印象でした。",
      ])
    );
  }

  if (isGoodWeather && !hasTakeout) {
    cand.push(
      pick([
        "天気が良い日は持ち帰りが伸びやすいので、テイクアウト系の動きも意識したいです。",
        "天気が良い日は持ち帰りが増えがちなので、テイクアウトの準備も厚めにしておきたいです。",
      ])
    );
  }

  if (isBadWeather) {
    cand.push(
      pick([
        "天候が崩れる日は館内利用が増えやすいので、ピーク前の段取りを早めに揃えたいです。",
        "悪天候の日は客足の寄り方が変わりやすいので、ピーク前に一度整えておきたいです。",
      ])
    );
  }

  if (hasSet) {
    cand.push(
      pick([
        "セットが強い日は作業が重なりやすいので、ピーク前の準備が効きました。",
        "セットが多い日は提供が詰まりやすいので、ピーク前に手順を揃えると回しやすいです。",
      ])
    );
  }

  if (hasKaraage) {
    cand.push(
      pick([
        "から揚げは追加注文が入りやすいので、ピーク前に一度整えておくと安心でした。",
        "から揚げが動く日は追加が入りやすいので、揚げのリズムを崩さないのが大事でした。",
      ])
    );
  }

  if (hasTourist) {
    cand.push(
      pick([
        "観光客が多い日は、最初の案内と注文確認を丁寧にすると流れが安定しやすいです。",
        "観光客が多い日は、注文確認を揃えると後がスムーズでした。",
      ])
    );
  }

  if (hasStudents) {
    cand.push(
      pick([
        "学生が多い日は単品が早く動きやすいので、仕込みの見え方を意識したいです。",
        "学生が多い日は回転が早くなりやすいので、ピーク前の準備が効きました。",
      ])
    );
  }

  const uniq = Array.from(new Set(cand.map(normalizeText))).filter(Boolean);
  return uniq.length ? pick(uniq) : "";
}

// -------------------- human-like builders --------------------
function lunchSentenceHuman(i: Inputs) {
  const weather = normalizeText(i.weather);
  const peak = formatTimeRange(i.lunchPeak);
  const customers = joinNatural([
    ...i.customers,
    ...splitFreeText(i.customersFree),
  ]);
  const hits = unique([...i.hits, ...splitFreeText(i.hitsFree)]);
  const level = inferCrowdLevel(i.seatFeel);

  const eventName = normalizeText(i.eventName);
  const hasEvent = i.eventMode === "yes";
  const eventPhrase = hasEvent
    ? eventName
      ? pick([
          `（${eventName}の影響もあって）`,
          `（${eventName}もあったため）`,
          `（${eventName}が入っていたこともあり）`,
        ])
      : pick(["（イベント日ということもあり）", "（催しが入っていたこともあり）"])
    : "";

  const parts: string[] = [];

  // 1文目：天気→スタート（＋イベント）
  if (weather) {
    parts.push(
      pick([
        `天気が良かった影響か、穏やかにスタートしました。`,
        `天気が${weather}だった影響か、穏やかにスタートしました。`,
        `天気が${weather}で、落ち着いてスタートしました。`,
      ]) + (eventPhrase ? ` ${eventPhrase}` : "")
    );
  } else {
    parts.push(
      pick(["穏やかにスタートしました。", "落ち着いてスタートしました。"]) +
        (eventPhrase ? ` ${eventPhrase}` : "")
    );
  }

  // 2文目：客層
  if (customers) {
    parts.push(
      pick([
        `${customers}の来店が多く、フードコート内はゆるやかに賑わっていました。`,
        `${customers}の来店が多い印象でした。`,
        `${customers}が多く、にぎわいが出ていました。`,
      ])
    );
  }

  // 3文目：ピーク
  if (!isBlank(peak)) {
    parts.push(
      pick([
        `${peak}までピークが続きました。`,
        `${peak}にかけてピークが続きました。`,
        `${peak}あたりが一番立て込みました。`,
      ])
    );
  }

  // 4文目：混み具合（“軸”は必ず level で固定し、体感は補足に回す）
  const crowdByLevel: Record<CrowdLevel, string[]> = {
    busy: [
      "注文が重なる時間帯が多く、手が止まらない感じでした。",
      "慌ただしい時間帯が続きましたが、大きな混乱なく対応できました。",
      "立て込みましたが、崩れるほどではなく回せています。",
    ],
    normal: [
      "波はありつつも、無理なく回せた印象です。",
      "ほどよく動きのある時間帯でした。",
      "全体としては安定した流れでした。",
    ],
    quiet: [
      "比較的落ち着いていて、ゆとりを持って対応できました。",
      "落ち着いた雰囲気で、仕込みや片付けも進められました。",
      "全体的にゆったり進みました。",
    ],
  };

  parts.push(pick(crowdByLevel[level]));
  if (!isBlank(i.seatFeel) && pick([true, false, false])) {
    parts.push(feelClause(i.seatFeel));
  }

  // 5文目：売れ筋
  if (hits.length > 0) {
    const a = hits[0];
    const b = hits[1];
    const text = b ? `${a}と${b}` : a;
    parts.push(
      pick([
        `${text}がいつもより多かったです。`,
        `${text}が多めに出ています。`,
        `${text}の注文が目立ちました。`,
      ])
    );
  }

  // 予測コメント（最大1文）
  const pred = predictSentence(i);
  if (!isBlank(pred) && pick([true, false])) {
    parts.push(pred);
  }

  // 連絡事項（任意）
  const notice = normalizeText(i.notice);
  if (notice) {
    parts.push(
      pick([
        `連絡事項：${notice}`,
        `共有：${notice}`,
        `念のため共有します。${notice}`,
      ])
    );
  }

  return polishJapanese(parts.join(" "));
}

function dinnerSentenceHuman(i: Inputs) {
  const peakStart = formatStartTime(i.dinnerPeak);
  const hits = unique([...i.hits, ...splitFreeText(i.hitsFree)]);
  const level = inferCrowdLevel(i.seatFeel);

  const parts: string[] = [];

  // 1文目：導入（混み具合に合わせて矛盾を消す）
  const introByLevel: Record<CrowdLevel, string[]> = {
    busy: [
      "後半もかなり混み、店前の動きが多い時間帯でした。",
      "夕方以降も立て込み、慌ただしい流れでした。",
      "夜も混みが続き、忙しい時間帯が多かったです。",
    ],
    normal: [
      "ランチと違い、ほどよい混み具合でした。",
      "後半は、比較的落ち着いた雰囲気でした。",
      "夕方以降は、無理のない混み具合でした。",
    ],
    quiet: [
      "ランチに比べると落ち着いていて、ゆったり対応できました。",
      "後半は静かめで、余裕を持って進められました。",
      "夕方以降は落ち着いた雰囲気でした。",
    ],
  };
  parts.push(pick(introByLevel[level]));

  // 2文目：ピーク（開始だけ）
  if (!isBlank(peakStart)) {
    parts.push(
      pick([
        `${peakStart}からピークがありました。`,
        `${peakStart}あたりで注文が重なる場面がありました。`,
      ])
    );
  }

  // 3文目：混み具合（“軸”固定＋体感は補足）
  const crowdByLevel: Record<CrowdLevel, string[]> = {
    busy: [
      "一時的にかなり立て込みましたが、崩れるほどではありませんでした。",
      "忙しい時間帯もありましたが、大きな混乱はありませんでした。",
    ],
    normal: [
      "波はありつつも、無理なく回せた印象です。",
      "ほどよい混み具合でした。",
    ],
    quiet: [
      "全体的にゆったりした流れでした。",
      "落ち着いた時間帯が多めでした。",
    ],
  };
  parts.push(pick(crowdByLevel[level]));
  if (!isBlank(i.seatFeel) && pick([true, false, false])) {
    parts.push(feelClause(i.seatFeel));
  }

  // 4文目：売れ筋
  if (hits.length > 0) {
    parts.push(
      pick([
        `${hits[0]}を頼まれるお客様が多かったです。`,
        `${hits[0]}を頼まれるお客様が多かった印象です。`,
        `${hits[0]}の注文が多めでした。`,
      ])
    );
  }

  // 予測コメント（最大1文）
  const pred = predictSentence(i);
  if (!isBlank(pred) && pick([true, false])) {
    parts.push(pred);
  }

  // 連絡事項（任意）
  const notice = normalizeText(i.notice);
  if (notice) {
    parts.push(
      pick([
        `連絡事項：${notice}`,
        `共有：${notice}`,
        `念のため共有します。${notice}`,
      ])
    );
  }

  return polishJapanese(parts.join(" "));
}

function buildDailyMail(i: Inputs) {
  return i.service === "lunch" ? lunchSentenceHuman(i) : dinnerSentenceHuman(i);
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

const STORAGE_KEY = "mail-gen:v2";

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
    weather: "",
    eventMode: "none",
    eventName: "",
    customers: [],
    customersFree: "",

    service: "lunch",
    seatFeel: "",
    lunchPeak: "",
    dinnerPeak: "",

    hits: [],
    hitsFree: "",

    notice: "",
  });

  const [output, setOutput] = useState("");
  const [toast, setToast] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ✅ 修正案A：previewHintは「マウント後」に生成（SSR時にMath.randomが走らないようにする）
  const [mounted, setMounted] = useState(false);
  const [previewHint, setPreviewHint] = useState("");

  // restore
  useEffect(() => {
    const saved = safeParse<Inputs>(localStorage.getItem(STORAGE_KEY));
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

  // mounted flag
  useEffect(() => {
    setMounted(true);
  }, []);

  // ✅ preview generation (client only)
  useEffect(() => {
    if (!mounted) return;

    const sample: Inputs =
      inputs.service === "lunch"
        ? {
            ...inputs,
            weather: inputs.weather || "晴れ",
            customers: inputs.customers.length
              ? inputs.customers
              : ["家族連れ", "観光客"],
            lunchPeak: inputs.lunchPeak || "12-14",
            seatFeel: inputs.seatFeel || "満席",
            hits: inputs.hits.length ? inputs.hits : ["親子丼", "親子丼セット"],
            eventMode: inputs.eventMode,
            eventName:
              inputs.eventMode === "yes" ? inputs.eventName || "三連休" : "",
          }
        : {
            ...inputs,
            dinnerPeak: inputs.dinnerPeak || "19-20",
            seatFeel: inputs.seatFeel || "満席",
            hits: inputs.hits.length ? inputs.hits : ["から揚げ"],
          };

    setPreviewHint(buildDailyMail(sample));
  }, [mounted, inputs]);

  const peakValue =
    inputs.service === "lunch" ? inputs.lunchPeak : inputs.dinnerPeak;
  const setPeakValue = (v: string) => {
    setInputs((p) =>
      p.service === "lunch" ? { ...p, lunchPeak: v } : { ...p, dinnerPeak: v }
    );
  };

  const peakPlaceholder =
    inputs.service === "lunch"
      ? "例）12-14 / 12:00-14:00"
      : "例）19-20 / 19:00-20:00";

  const generate = () => setOutput(buildDailyMail(inputs));

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
      weather: "",
      eventMode: "none",
      eventName: "",
      customers: [],
      customersFree: "",
      service: "lunch",
      seatFeel: "",
      lunchPeak: "",
      dinnerPeak: "",
      hits: [],
      hitsFree: "",
      notice: "",
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

  const isReadyToGenerate =
    !isBlank(inputs.seatFeel) &&
    !isBlank(peakValue) &&
    (!isBlank(inputs.hitsFree) || inputs.hits.length > 0);

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
            日報メール文 自動生成
          </h1>
          <p className="text-sm text-gray-600">
            ランチは「1日の始まり」っぽく、ディナーは「続き」っぽく自然文で出す。
            （Cmd/Ctrl+Enterで生成、Cmd/Ctrl+Shift+Cでコピー）
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
                aria-pressed={inputs.service === "lunch"}
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
                aria-pressed={inputs.service === "dinner"}
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

          {/* 必須：混み具合・ピーク・売れ筋 */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                フードコートの雰囲気（必須）
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

            <div className="space-y-2">
              <label className="text-sm font-medium">
                ピーク時間（必須）
              </label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder={peakPlaceholder}
                value={peakValue}
                onChange={(e) => setPeakValue(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                出力では「12-14」→「12時から14時」のように自然表現に変換
              </p>
            </div>
          </div>

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

          {/* 詳細（任意） */}
          {showAdvanced && (
            <div className="pt-2 space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    天気（任意・主にランチ向け）
                  </label>
                  <input
                    className="w-full rounded-xl border px-3 py-2"
                    placeholder="例）晴れ / くもり / 雨 / 風強め"
                    value={inputs.weather}
                    onChange={(e) =>
                      setInputs((p) => ({ ...p, weather: e.target.value }))
                    }
                  />
                  <p className="text-xs text-gray-500">
                    ※ ディナーでは天気は基本出さない（続きの文章になる）
                  </p>
                </div>

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
              </div>

              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <label className="text-sm font-medium">客層（任意）</label>
                  <span className="text-xs text-gray-500">＋ 手入力OK</span>
                </div>
                <MultiSelect
                  options={CUSTOMER_OPTIONS}
                  value={inputs.customers}
                  onChange={(v) =>
                    setInputs((p) => ({ ...p, customers: v }))
                  }
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
              title={
                isReadyToGenerate
                  ? ""
                  : "混み具合・ピーク・売れ筋（選択or手入力）を入れると生成できます"
              }
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

          <div className="pt-2 text-xs text-gray-500">
            生成イメージ：
            <div className="mt-2 whitespace-pre-wrap rounded-xl border bg-gray-50 p-3 text-gray-700">
              {mounted ? previewHint : "（プレビューを表示中…）"}
            </div>
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

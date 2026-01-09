"use client";

import React, { useMemo, useState } from "react";

type Service = "lunch" | "dinner";
type EventMode = "none" | "yes";

type Inputs = {
  weather: string;

  eventMode: EventMode;
  eventName: string;

  // 「着席率」という単語は出力で使わない。入力は自由（7割/70%/混んでた/空席あり等）
  seatFeel: string;

  service: Service;
  lunchPeak: string; // 例 "12-14" / "12:00-14:00"
  dinnerPeak: string;

  customers: string[];
  customersFree: string;

  hits: string[];
  hitsFree: string;

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
function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
        // 00分は省略
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

type CrowdLevel = "busy" | "normal" | "quiet";

// 入力の雰囲気から雑に分類（矛盾文が出ないように“軸”を固定するため）
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

  // それ以外は普通
  return "normal";
}

// -------------------- phrase sets --------------------
const serviceLead: Record<Service, string[]> = {
  lunch: ["ランチタイムは", "昼どきは", "お昼は"],
  dinner: ["ディナータイムは", "夜は", "夕方以降は"],
};

function weatherEventCustomerSentence(i: Inputs) {
  const weather = normalizeText(i.weather);
  const eventName = normalizeText(i.eventName);
  const customers = joinNatural([
    ...i.customers,
    ...splitFreeText(i.customersFree),
  ]);

  const weatherPart = weather
    ? pick([
        `今日は${weather}で`,
        `天気は${weather}で`,
        `${weather}の一日で`,
        `今日は${weather}の中、`,
      ])
    : pick(["今日は", "本日は", "きょうは"]);

  let eventPart = "";
  if (i.eventMode === "yes") {
    eventPart = eventName
      ? pick([
          `${eventName}もあり`,
          `${eventName}が入っていたこともあり`,
          `${eventName}の影響もあって`,
        ])
      : pick([
          "イベントもあり",
          "催しが入っていたこともあり",
          "イベント日ということもあり",
        ]);
  } else {
    // 触れない日もある（機械感を下げる）
    eventPart = pick(["", "", "", "特に大きなイベントはなく"]);
  }

  const customerPart = customers
    ? pick([
        `${customers}の来店が目立ちました。`,
        `${customers}が多い印象でした。`,
        `${customers}が中心の雰囲気でした。`,
      ])
    : pick([
        "来客の波はほどよく、落ち着いた雰囲気でした。",
        "全体的に安定した客足でした。",
      ]);

  // つなぎの調整（「で、」の重複回避）
  const mid = eventPart ? `、${eventPart}、` : "、";
  const head = weatherPart.endsWith("、")
    ? weatherPart.slice(0, -1)
    : weatherPart; // 末尾カンマ調整
  return `${head}${mid}${customerPart}`
    .replace(/、、/g, "、")
    .replace(/、、/g, "、");
}

function serviceCrowdSentence(i: Inputs) {
  const lead = pick(serviceLead[i.service]);

  const peakRaw = i.service === "lunch" ? i.lunchPeak : i.dinnerPeak;
  const peak = formatTimeRange(peakRaw);

  const level = inferCrowdLevel(i.seatFeel);
  const feel = normalizeText(i.seatFeel);

  const peakPart = peak
    ? pick([
        `${peak}前後にかけて一気に立て込み`,
        `${peak}あたりが山になり`,
        `${peak}にかけて忙しい時間帯があり`,
        `${peak}付近で注文が重なる場面があり`,
      ])
    : pick([
        "一気に立て込む場面があり",
        "忙しい時間帯があり",
        "波はありつつも",
        "全体としては",
      ]);

  // 「軸」を固定した混み具合（矛盾が出ないように level ごとに別セット）
  const crowdByLevel: Record<CrowdLevel, string[]> = {
    busy: [
      "席は埋まり気味で",
      "人の動きが多く",
      "少し慌ただしい場面もあり",
      "手が止まらない感じの時間帯があり",
    ],
    normal: [
      "席はそこそこ埋まり",
      "ほどよい混み具合で",
      "落ち着きすぎない動きがあり",
      "忙しすぎない範囲で",
    ],
    quiet: [
      "比較的落ち着いていて",
      "空席が目立つ時間もあり",
      "ゆったり対応できる時間が多く",
      "全体としては静かめで",
    ],
  };

  // 入力が「7割」「70%」等でも“率”は使わず「体感」を添える（入れても矛盾しない位置に）
  const addFeel =
    !isBlank(feel) && pick([true, false, false]) // 1/3くらいで挿入
      ? pick([
          `（体感としては「${feel}」くらい）`,
          `（${feel}くらいの印象）`,
          `（感覚的には${feel}ぐらい）`,
        ])
      : "";

  const tail =
    level === "busy"
      ? pick([
          "でしたが、大きな混乱はなく対応できています。",
          "でしたが、全体としては落ち着いて対応できました。",
          "でしたが、崩れるほどではなく回せています。",
        ])
      : level === "quiet"
      ? pick([
          "だったので、仕込みや片付けも進められました。",
          "で、比較的落ち着いて対応できました。",
          "で、全体的にゆとりを持って進行しました。",
        ])
      : pick([
          "でしたが、全体としては安定していました。",
          "で、ほどよく動きのある時間帯でした。",
          "で、無理なく回せた印象です。",
        ]);

  const crowdCore = pick(crowdByLevel[level]);

  // 1文にまとめて“箇条書き感”を消す
  return `${lead}${peakPart}${crowdCore}${addFeel}、${tail}`.replace(
    /、、/g,
    "、"
  );
}

function hitsSentence(i: Inputs) {
  const hits = unique([...i.hits, ...splitFreeText(i.hitsFree)]);
  if (hits.length === 0) return "";

  const top = hits.slice(0, 2);
  const text = top.length === 1 ? top[0] : `${top[0]}と${top[1]}`;

  return pick([
    `注文は${text}が中心で、全体的に動きの良い一日でした。`,
    `${text}がよく出ていて、注文の偏りも少なめでした。`,
    `${text}が目立ち、全体としては安定した出方でした。`,
  ]);
}

function noticeSentence(i: Inputs) {
  const n = normalizeText(i.notice);
  if (!n) return "";
  return pick([
    `なお、${n}ので、確認をお願いします。`,
    `連絡事項として、${n}を共有します。`,
    `${n}の件、周知お願いします。`,
  ]);
}

// 最終組み立て：端的・わかりやすい“文章”として出す（改行は最大4行）
function buildDailyMail(i: Inputs) {
  const parts: string[] = [];

  parts.push(weatherEventCustomerSentence(i));
  parts.push(serviceCrowdSentence(i));

  const hits = hitsSentence(i);
  if (!isBlank(hits)) parts.push(hits);

  const notice = noticeSentence(i);
  if (!isBlank(notice)) parts.push(notice);

  // たまに締め（短く）
  if (pick([true, false, false])) {
    parts.push(
      pick(["以上です。", "以上、共有です。", "よろしくお願いします。"])
    );
  }

  // 重複（同一文）排除
  const uniq = Array.from(
    new Set(parts.map((p) => normalizeText(p)).filter(Boolean))
  );

  // “箇条書き感”を避けるため、改行は意味の区切りに限定
  return uniq.slice(0, 4).join("\n");
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

export default function Page() {
  const [inputs, setInputs] = useState<Inputs>({
    weather: "",
    eventMode: "none",
    eventName: "",
    seatFeel: "",
    service: "lunch",
    lunchPeak: "",
    dinnerPeak: "",
    customers: [],
    customersFree: "",
    hits: [],
    hitsFree: "",
    notice: "",
  });

  const [output, setOutput] = useState("");

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
      : "例）18-20 / 18:00-20:00";

  const generate = () => setOutput(buildDailyMail(inputs));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      // noop
    }
  };

  // 生成例の“雰囲気”を画面に出す（入力が空でも迷わない）
  const previewHint = useMemo(() => {
    const sample = buildDailyMail({
      ...inputs,
      weather: inputs.weather || "晴れ",
      eventMode: inputs.eventMode,
      eventName: inputs.eventMode === "yes" ? inputs.eventName || "三連休" : "",
      seatFeel: inputs.seatFeel || "席は埋まり気味",
      lunchPeak: inputs.lunchPeak || "12-14",
      dinnerPeak: inputs.dinnerPeak || "18-20",
      customers: inputs.customers.length
        ? inputs.customers
        : ["家族連れ", "観光客"],
      hits: inputs.hits.length ? inputs.hits : ["親子丼", "親子丼セット"],
      notice: inputs.notice || "レジが新しくなった",
    });
    return sample;
  }, [inputs]);

  return (
    <main className="min-h-screen bg-gray-50 text-black">
      <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold">
            日報メール文 自動生成
          </h1>
          <p className="text-sm text-gray-600">
            同じ入力でも「再生成」で言い回しが変わる。箇条書きっぽくせず、端的な文章にまとめる。
          </p>
        </header>

        <section className="bg-white rounded-2xl border p-5 md:p-6 space-y-5">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">天気</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="例）晴れ / くもり / 雨 / 風強め"
                value={inputs.weather}
                onChange={(e) =>
                  setInputs((p) => ({ ...p, weather: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">イベント</label>
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
                  onClick={() => setInputs((p) => ({ ...p, eventMode: "yes" }))}
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
              <label className="text-sm font-medium">
                フードコートの混み具合（自由入力）
              </label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="例）席は埋まり気味 / 7割くらい / 空席多め / 落ち着いてた"
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
              <label className="text-sm font-medium">時間帯</label>
              <div className="inline-flex rounded-xl border p-1 bg-white">
                <button
                  type="button"
                  onClick={() => setInputs((p) => ({ ...p, service: "lunch" }))}
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
                  onClick={() =>
                    setInputs((p) => ({ ...p, service: "dinner" }))
                  }
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

              <div className="mt-2">
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
          </div>

          <div className="grid md:grid-cols-2 gap-5 pt-2">
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <label className="text-sm font-medium">客層（複数選択）</label>
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

            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <label className="text-sm font-medium">
                  売れ筋（複数選択）
                </label>
                <span className="text-xs text-gray-500">＋ 手入力OK</span>
              </div>
              <MultiSelect
                options={HIT_OPTIONS}
                value={inputs.hits}
                onChange={(v) => setInputs((p) => ({ ...p, hits: v }))}
              />
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="手入力（例）大盛り多め、セット強い など"
                value={inputs.hitsFree}
                onChange={(e) =>
                  setInputs((p) => ({ ...p, hitsFree: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <label className="text-sm font-medium">連絡事項（任意）</label>
            <textarea
              className="w-full rounded-2xl border px-3 py-2 min-h-[90px]"
              placeholder="例）レジが新しくなった / 明日は開店前にタレ補充 など"
              value={inputs.notice}
              onChange={(e) =>
                setInputs((p) => ({ ...p, notice: e.target.value }))
              }
            />
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={generate}
              className="px-5 py-2 rounded-xl bg-black text-white hover:opacity-90"
            >
              生成
            </button>
            <button
              type="button"
              onClick={generate}
              className="px-5 py-2 rounded-xl border bg-white hover:bg-gray-50"
            >
              再生成（同じ入力で言い回し変更）
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={!output}
              className="px-5 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              コピー
            </button>
          </div>

          <div className="pt-2 text-xs text-gray-500">
            生成イメージ（入力が空でも雰囲気が分かるように表示）：
            <div className="mt-2 whitespace-pre-wrap rounded-xl border bg-gray-50 p-3 text-gray-700">
              {previewHint}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border p-5 md:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">出力（文章のみ）</h2>
            <span className="text-xs text-gray-500">
              {output ? "生成済み" : "未生成"}
            </span>
          </div>
          <textarea
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

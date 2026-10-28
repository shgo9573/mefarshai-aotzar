"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dafLabel } from "@/lib/hebrew";
import { SEDER_ORDER, TRACTATES, clampDaf, getTractate, stepDaf, type Tractate } from "@/lib/shas";
import { LAYER_LABELS, type Amud, type Bubble, type CommentaryItem, type DafPayload, type LayerKind, type RecentDaf } from "@/lib/types";

const LAYER_ORDER: LayerKind[] = ["gemara", "rashi", "tosafot"];
const LAYER_DOT: Record<LayerKind, string> = {
  gemara: "#e2b15c",
  rashi: "#4894d6",
  tosafot: "#54b076",
};

type CommentariesState = {
  line: number;
  commentators: string[];
  items: CommentaryItem[];
};

export function DafStudio({ initialRecent }: { initialRecent: RecentDaf[] }) {
  const [tractateName, setTractateName] = useState("ברכות");
  const [daf, setDaf] = useState(2);
  const [amud, setAmud] = useState<Amud>("a");
  const [payload, setPayload] = useState<DafPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hotId, setHotId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.9);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [seder, setSeder] = useState("זרעים");
  const [query, setQuery] = useState("");
  const [commentator, setCommentator] = useState("הכל");
  const [search, setSearch] = useState("");
  const [commentaries, setCommentaries] = useState<CommentariesState | null>(null);
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [commentaryError, setCommentaryError] = useState<string | null>(null);
  const [recent, setRecent] = useState(initialRecent);
  const [infoOpen, setInfoOpen] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKind, boolean>>({ gemara: true, rashi: true, tosafot: true });
  const stageRef = useRef<HTMLDivElement>(null);

  const tractate = getTractate(tractateName) ?? TRACTATES[0];
  const selected = payload?.bubbles.find((bubble) => bubble.id === selectedId) || null;
  const hot = payload?.bubbles.find((bubble) => bubble.id === hotId) || selected;

  const openDaf = useCallback((nextTractate: string, nextDaf: number, nextAmud: Amud) => {
    const found = getTractate(nextTractate) ?? TRACTATES[0];
    const placed = clampDaf(found, nextDaf, nextAmud);
    setTractateName(found.name);
    setSeder(found.seder);
    setDaf(placed.daf);
    setAmud(placed.amud);
    setSelectedId(null);
    setCommentaries(null);
    setPickerOpen(false);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("m");
    const number = Number(params.get("d"));
    const side = params.get("a") === "b" ? "b" : "a";
    if (name && getTractate(name)) openDaf(name, Number.isFinite(number) ? number : 2, side);
  }, [openDaf]);

  useEffect(() => {
    const params = new URLSearchParams({ m: tractate.name, d: String(daf), a: amud });
    window.history.replaceState(null, "", `/?${params.toString()}`);
  }, [tractate.name, daf, amud]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/daf?masechta=${encodeURIComponent(tractate.name)}&daf=${daf}&amud=${amud}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as DafPayload & { error?: string };
        if (!response.ok) throw new Error(data.error || "טעינת הדף נכשלה");
        setPayload(data);
        setRecent((current) => {
          const next = [
            { tractate: data.tractate, daf: data.daf, amud: data.amud, visitedAt: new Date().toISOString() },
            ...current.filter((item) => !(item.tractate === data.tractate && item.daf === data.daf && item.amud === data.amud)),
          ];
          return next.slice(0, 8);
        });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "טעינת הדף נכשלה");
        setPayload(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tractate.name, daf, amud]);

  useEffect(() => {
    setImageError(false);
  }, [payload?.tractate, payload?.daf, payload?.amud]);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !payload) return;
    const widthFit = (stage.clientWidth - 28) / payload.pageWidth;
    const heightFit = (stage.clientHeight - 28) / payload.pageHeight;
    setZoom(Math.max(0.42, Math.min(widthFit, heightFit, 1.45)));
  }, [payload]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    if (!selected?.lineIndex || !selected.bookId) {
      setCommentaries(null);
      return;
    }
    const controller = new AbortController();
    setCommentaryLoading(true);
    setCommentaryError(null);
    setCommentator("הכל");
    setSearch("");
    fetch(
      `/api/commentaries?bookId=${selected.bookId}&line=${selected.lineIndex}&base=${encodeURIComponent(tractate.name)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const data = (await response.json()) as CommentariesState & { error?: string };
        if (!response.ok) throw new Error(data.error || "טעינת המפרשים נכשלה");
        setCommentaries(data);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCommentaryError(reason instanceof Error ? reason.message : "טעינת המפרשים נכשלה");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommentaryLoading(false);
      });
    return () => controller.abort();
  }, [selected?.lineIndex, selected?.bookId, tractate.name]);

  function move(direction: 1 | -1) {
    const next = stepDaf(tractate, daf, amud, direction);
    if (next) openDaf(tractate.name, next.daf, next.amud);
  }

  function moveSegment(direction: 1 | -1) {
    if (!payload?.bubbles.length) return;
    const index = payload.bubbles.findIndex((bubble) => bubble.id === selectedId);
    const next = payload.bubbles[index + direction] || payload.bubbles[direction === 1 ? 0 : payload.bubbles.length - 1];
    setSelectedId(next.id);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") move(1);
      if (event.key === "ArrowRight") move(-1);
      if (event.key === "ArrowDown") moveSegment(1);
      if (event.key === "ArrowUp") moveSegment(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const filteredCommentaries = useMemo(() => {
    if (!commentaries) return [];
    const needle = search.trim();
    return commentaries.items.filter((item) => {
      if (commentator !== "הכל" && item.commentator !== commentator) return false;
      if (!needle) return true;
      return `${item.commentator} ${item.dibbur} ${item.text}`.includes(needle);
    });
  }, [commentaries, commentator, search]);

  const visibleTractates = TRACTATES.filter((item) => {
    const matchesSeder = !query && item.seder === seder;
    const matchesQuery = query && item.name.includes(query.trim());
    return Boolean(matchesSeder || matchesQuery);
  });

  return (
    <main className="desk-grid flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-amber-200/15 bg-[#160f0c]/90 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <img src="/emblem.png" alt="" className="h-11 w-11 rounded-full object-cover ring-1 ring-amber-200/40" />
            <div>
              <p className="font-[family-name:var(--font-frank)] text-xl leading-none text-amber-100">בועות הדף</p>
              <p className="mt-1 text-[11px] tracking-wide text-amber-100/60">גמרא במרכז · מפרשים בלחיצה</p>
            </div>
          </div>

          <div className="mx-auto flex flex-wrap items-center gap-2">
            <button className="chip rounded-full px-3 py-1.5 text-sm" onClick={() => move(-1)} type="button">
              הקודם
            </button>
            <button
              className="rounded-full bg-[#f3e4c4] px-4 py-1.5 text-sm font-semibold text-[#2a1a0c]"
              onClick={() => setPickerOpen(true)}
              type="button"
            >
              {tractate.name} · {dafLabel(daf, amud)}
            </button>
            <button className="chip rounded-full px-3 py-1.5 text-sm" onClick={() => move(1)} type="button">
              הבא
            </button>
            <div className="chip flex overflow-hidden rounded-full text-sm">
              <button className={`px-3 py-1.5 ${amud === "a" ? "bg-amber-300 text-[#2a1a0c]" : ""}`} onClick={() => openDaf(tractate.name, daf, "a")} type="button">
                ע״א
              </button>
              <button className={`px-3 py-1.5 ${amud === "b" ? "bg-amber-300 text-[#2a1a0c]" : ""}`} onClick={() => openDaf(tractate.name, daf, "b")} type="button">
                ע״ב
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button className="chip h-9 w-9 rounded-full" onClick={() => setZoom((value) => Math.max(0.4, value - 0.12))} type="button" aria-label="הקטן">
              −
            </button>
            <button className="chip h-9 rounded-full px-3 text-xs" onClick={fit} type="button">
              התאם
            </button>
            <button className="chip h-9 w-9 rounded-full" onClick={() => setZoom((value) => Math.min(2.2, value + 0.12))} type="button" aria-label="הגדל">
              +
            </button>
            {LAYER_ORDER.map((layer) => (
              <button
                key={layer}
                className={`chip flex h-9 items-center gap-1.5 rounded-full px-3 text-xs ${layers[layer] ? "is-on" : "opacity-55"}`}
                onClick={() => setLayers((value) => ({ ...value, [layer]: !value[layer] }))}
                type="button"
                aria-pressed={layers[layer]}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: LAYER_DOT[layer] }} />
                {LAYER_LABELS[layer]}
                <span className="opacity-70">{payload?.stats.layers?.[layer] ?? 0}</span>
              </button>
            ))}
            <button className="chip h-9 rounded-full px-3 text-xs" onClick={() => setInfoOpen((value) => !value)} type="button">
              איך זה עובד
            </button>
          </div>
        </div>
        <div className="gold-rule" />
      </header>

      {infoOpen && (
        <div className="border-b border-amber-200/10 bg-[#24180f] px-6 py-3 text-sm leading-6 text-amber-50/80">
          הדף והטקסט נמשכים משרת אוצריא. הגמרא מזוהה לפי גודל האות הגדול ולפי רצף השורות, כך שגם כשהיא
          מתרחבת לצד בתחתית הדף היא נקלטת. רש״י ותוספות הם המידה הקטנה יותר, וכל קטע בהם מזוהה לפי
          התאמה לטקסט של רש״י ותוספות באוצריא — ולכן רבינו חננאל, מסורת הש״ס, עין משפט ותורה אור
          לעולם אינם מסומנים. שכבה שאינה מזוהה בוודאות נשארת ריקה, ושתי בועות לעולם אינן חופפות.
        </div>
      )}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_390px]">
        <section ref={stageRef} className="relative min-h-[70vh] overflow-auto p-4 lg:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-amber-100/70">
            {recent.map((item) => (
              <button
                key={`${item.tractate}-${item.daf}-${item.amud}`}
                className="chip rounded-full px-2.5 py-1"
                onClick={() => openDaf(item.tractate, item.daf, item.amud)}
                type="button"
              >
                {item.tractate} {dafLabel(item.daf, item.amud)}
              </button>
            ))}
            {payload && (
              <span className="ms-auto">
                אות גמרא {payload.stats.gemaraFont || "—"} · אות מפרשים {payload.stats.commentaryFont || "—"} ·{" "}
                {payload.stats.lines ?? "—"} שורות
                {payload.stats.wideLines ? ` (${payload.stats.wideLines} מתרחבות לצד)` : ""} · {payload.bubbles.length} בועות
              </span>
            )}
          </div>

          <div className="daf-frame mx-auto w-fit rounded-sm p-3">
            {loading && !payload && <DafSkeleton />}
            {error && (
              <div className="grid h-[70vh] w-[min(72vw,520px)] place-items-center px-8 text-center text-amber-100">
                <div>
                  <p className="font-[family-name:var(--font-frank)] text-2xl">הדף לא נפתח</p>
                  <p className="mt-2 text-sm text-amber-100/70">{error}</p>
                </div>
              </div>
            )}
            {payload && (
              <div className="relative" style={{ width: payload.pageWidth * zoom }}>
                <img
                  src={`/api/page-image?masechta=${encodeURIComponent(payload.apiName)}&daf=${payload.daf}&amud=${payload.amud}`}
                  alt={`צורת הדף ${payload.tractate} ${payload.label}`}
                  className="block h-auto w-full bg-[#f7f1e4]"
                  draggable={false}
                  onError={() => setImageError(true)}
                />
                <div className="absolute inset-0" onClick={() => setSelectedId(null)}>
                  {payload.bubbles.filter((bubble) => layers[bubble.layer]).map((bubble) =>
                    bubble.rects.map((rect, index) => (
                      <button
                        key={`${bubble.id}-${index}`}
                        className={`bubble bubble-${bubble.layer} ${selectedId === bubble.id ? "is-selected" : ""} ${hotId === bubble.id ? "is-hot" : ""} ${bubble.score <= 0.5 ? "is-soft" : ""}`}
                        style={{
                          left: `${(rect.x / payload.pageWidth) * 100}%`,
                          top: `${(rect.y / payload.pageHeight) * 100}%`,
                          width: `${(rect.w / payload.pageWidth) * 100}%`,
                          height: `${(rect.h / payload.pageHeight) * 100}%`,
                        }}
                        onMouseEnter={() => setHotId(bubble.id)}
                        onMouseLeave={() => setHotId(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(bubble.id);
                        }}
                        type="button"
                        aria-label={`${LAYER_LABELS[bubble.layer]}: ${bubble.preview}`}
                      />
                    )),
                  )}
                </div>
                {imageError && (
                  <div className="absolute inset-x-3 bottom-3 rounded-xl bg-[#2a1608]/90 px-4 py-3 text-center text-sm text-amber-50">
                    תמונת הדף לא נטענה.{" "}
                    <a
                      className="underline"
                      href={`/api/pdf?masechta=${encodeURIComponent(payload.apiName)}&daf=${payload.daf}&amud=${payload.amud}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      פתיחת ה־PDF המקורי
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="mx-auto mt-3 max-w-3xl text-center text-[11px] leading-5 text-amber-100/45">
            {hot ? hot.preview : "עברו על בועה כדי לראות את הקטע, ולחצו כדי לפתוח מפרשים."} · המקור: אוצריא / מים חיים, סריקת HebrewBooks
          </p>
        </section>

        <aside className="panel-scroll flex max-h-screen flex-col border-t border-amber-200/10 bg-[#f6ecd8] text-[#2a1c12] lg:border-t-0 lg:border-r">
          <div className="border-b border-[#e4d2b0] px-5 py-4">
            <p className="text-xs tracking-wide text-[#8a6840]">מפרשים</p>
            <h2 className="font-[family-name:var(--font-frank)] text-2xl">{tractate.name} {dafLabel(daf, amud)}</h2>
            {tractate.note && <p className="mt-1 text-xs leading-5 text-[#7a5a38]">{tractate.note}</p>}
          </div>

          <div className="panel-scroll min-h-0 flex-1 overflow-auto px-5 py-4">
            {!selected && (
              <SegmentList bubbles={payload?.bubbles || []} onPick={setSelectedId} loading={loading} />
            )}
            {selected && (
              <div>
                <div className="mb-4 rounded-2xl bg-[#fff8ec] p-4 shadow-sm ring-1 ring-[#ead7b4]">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[#8a6840]">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: LAYER_DOT[selected.layer] }} />
                      {LAYER_LABELS[selected.layer]}
                    </span>
                    <span>
                      {selected.segmentIndex ? `קטע ${selected.segmentIndex}` : "שורת גמרא"}
                      {selected.kind === "segment"
                        ? selected.score <= 0.5
                          ? " · מיקום משוער בין קטעים מותאמים"
                          : ` · התאמה ${Math.round(selected.score * 100)}%`
                        : ""}
                    </span>
                    <button className="underline" onClick={() => setSelectedId(null)} type="button">
                      כל הקטעים
                    </button>
                  </div>
                  <p className="font-[family-name:var(--font-serif)] text-lg leading-8">{selected.text}</p>
                </div>

                {selected.lineIndex && selected.bookId ? (
                  <>
                    {selected.layer !== "gemara" && (
                      <p className="mb-3 text-xs leading-5 text-[#8a6840]">
                        מפרשים ומקורות שאוצריא מקשר לקטע הזה של {LAYER_LABELS[selected.layer]}
                      </p>
                    )}
                    <div className="mb-3 flex gap-2">
                      <select
                        className="min-w-0 flex-1 rounded-xl border border-[#e4d2b0] bg-white px-3 py-2 text-sm"
                        value={commentator}
                        onChange={(event) => setCommentator(event.target.value)}
                      >
                        <option>הכל</option>
                        {(commentaries?.commentators || []).map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                      <input
                        className="w-28 rounded-xl border border-[#e4d2b0] bg-white px-3 py-2 text-sm"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="חיפוש"
                      />
                    </div>
                    {commentaryLoading && <p className="text-sm text-[#8a6840]">מבקש מפרשים מאוצריא…</p>}
                    {commentaryError && <p className="text-sm text-[#8a3030]">{commentaryError}</p>}
                    <div className="space-y-3">
                      {filteredCommentaries.map((item, index) => (
                        <article key={`${item.commentator}-${index}`} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ead7b4]">
                          <header className="mb-2 flex items-baseline justify-between gap-3">
                            <h3 className="font-[family-name:var(--font-frank)] text-lg text-[#7d3b32]">{item.commentator}</h3>
                            <span className="text-[11px] text-[#8a6840]">{index + 1}</span>
                          </header>
                          {item.dibbur && <p className="mb-2 text-xs text-[#8a6840]">{item.dibbur}</p>}
                          <div
                            className="commentary-body font-[family-name:var(--font-serif)] text-[15px] leading-7"
                            dangerouslySetInnerHTML={{ __html: item.text }}
                          />
                        </article>
                      ))}
                      {!commentaryLoading && commentaries && filteredCommentaries.length === 0 && (
                        <p className="text-sm text-[#8a6840]">
                          {commentaries.items.length === 0
                            ? `אוצריא לא מקשר מפרשים לקטע הזה של ${LAYER_LABELS[selected.layer]}.`
                            : "אין מפרשים התואמים לסינון."}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm leading-6 text-[#7a5a38]">
                    זו שורה של {LAYER_LABELS[selected.layer]} שזוהתה לפי גודל האות והעמודה, אבל לא הותאמה לקטע מסוים
                    בטקסט של אוצריא, ולכן אין לה מפרשים מקושרים.
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/55 p-4" onClick={() => setPickerOpen(false)}>
          <div className="picker-card max-h-[86vh] w-full max-w-3xl overflow-auto rounded-3xl p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-frank)] text-2xl text-amber-50">בחירת דף מכל הש״ס</h2>
              <button className="chip rounded-full px-3 py-1 text-sm" onClick={() => setPickerOpen(false)} type="button">
                סגור
              </button>
            </div>
            <input
              className="mb-3 w-full rounded-2xl border border-amber-200/20 bg-black/30 px-4 py-2 text-sm text-amber-50 outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חיפוש מסכת"
            />
            <div className="mb-4 flex flex-wrap gap-2">
              {SEDER_ORDER.map((name) => (
                <button key={name} className={`chip rounded-full px-3 py-1 text-sm ${seder === name && !query ? "is-on" : ""}`} onClick={() => { setSeder(name); setQuery(""); }} type="button">
                  {name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleTractates.map((item) => (
                <button
                  key={item.name}
                  className={`rounded-2xl px-3 py-3 text-right text-sm ${item.name === tractate.name ? "bg-amber-300 text-[#2a1a0c]" : "bg-white/5 text-amber-50"}`}
                  onClick={() => openDaf(item.name, item.startDaf, item.startAmud || "a")}
                  type="button"
                >
                  <span className="block font-[family-name:var(--font-frank)] text-lg">{item.name}</span>
                  <span className="text-[11px] opacity-70">{item.seder} · {item.startDaf}–{item.endDaf}</span>
                </button>
              ))}
            </div>
            <DafJump tractate={tractate} daf={daf} amud={amud} onOpen={openDaf} />
          </div>
        </div>
      )}
    </main>
  );
}

function SegmentList({
  bubbles,
  onPick,
  loading,
}: {
  bubbles: Bubble[];
  onPick: (id: string) => void;
  loading: boolean;
}) {
  if (loading) return <p className="text-sm text-[#8a6840]">מזהה את הגמרא במרכז הדף…</p>;
  if (!bubbles.length) return <p className="text-sm leading-6 text-[#7a5a38]">לא נמצאו בועות גמרא בדף הזה. אפשר לעבור לדף אחר.</p>;
  return (
    <div className="space-y-2">
      <p className="mb-3 text-sm text-[#7a5a38]">לחצו על קטע, או על הבועה שמעליו בדף.</p>
      {bubbles.map((bubble) => (
        <button
          key={bubble.id}
          className="block w-full rounded-2xl bg-white px-4 py-3 text-right shadow-sm ring-1 ring-[#ead7b4]"
          onClick={() => onPick(bubble.id)}
          type="button"
        >
          <span className="mb-1 block text-[11px] text-[#8a6840]">
            {bubble.segmentIndex ? `קטע ${bubble.segmentIndex}` : "שורת גמרא"}
          </span>
          <span className="font-[family-name:var(--font-serif)] text-[15px] leading-7">{bubble.preview}</span>
        </button>
      ))}
    </div>
  );
}

function DafJump({
  tractate,
  daf,
  amud,
  onOpen,
}: {
  tractate: Tractate;
  daf: number;
  amud: Amud;
  onOpen: (name: string, daf: number, amud: Amud) => void;
}) {
  const [value, setValue] = useState(String(daf));
  return (
    <form
      className="mt-5 flex items-end gap-2 border-t border-amber-200/15 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        onOpen(tractate.name, Number(value), amud);
      }}
    >
      <label className="flex-1 text-xs text-amber-100/70">
        קפיצה לדף ב{tractate.name}
        <input
          className="mt-1 w-full rounded-xl border border-amber-200/20 bg-black/30 px-3 py-2 text-sm text-amber-50"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-[#2a1a0c]" type="submit">
        פתח
      </button>
    </form>
  );
}

function DafSkeleton() {
  return (
    <div className="grid h-[72vh] w-[min(70vw,480px)] place-items-center bg-[#f4efe4] text-[#8a6840]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-16 w-12 rounded-sm border border-[#d9c39a]" />
        <p className="font-[family-name:var(--font-frank)] text-xl">פותח את צורת הדף</p>
      </div>
    </div>
  );
}

# בועות הדף — מדריך מלא: איך זה עובד ואיך לבנות את זה מחדש

מסמך זה מסביר, שלב אחר שלב, איך האתר מושך את צורת הדף של הש״ס, מזהה בה את הגמרא, רש״י ותוספות, מחבר אותם לטקסט של אוצריא,
ומציג מפרשים בלחיצה. כל קטעי הקוד במסמך הועתקו אוטומטית מהקבצים האמיתיים בפרויקט (`python3 docs/make-instructions.py`), ולכן הם תואמים בדיוק למה שרץ.

> **קרדיט ורישיון.** קובצי ה־PDF של צורת הדף מקורם ב־HebrewBooks.org (הוצאת מוזניים / ח. וגשל) ומופצים חינם לשימוש לא מסחרי עם ציון המקור.
> הטקסטים והמפרשים נמשכים משרת אוצריא (otzaria.duckdns.org). יש להשאיר את שורת המקור שבתחתית הדף.

---

## 1. מה המערכת עושה, בקצרה

1. מורידה מאוצריא את ה־PDF של דף ועמוד (למשל ברכות ב ע״א).
2. מורידה מאוצריא את הטקסט של **הגמרא**, של **רש״י** ושל **תוספות** לאותו דף ועמוד.
3. קוראת מתוך ה־PDF כל מילה עם המיקום, הגודל והגופן שלה.
4. מפרידה את שלוש השכבות: גמרא, רש״י, תוספות. אין שימוש במיקום קבוע אלא בגודל האות, ברצף השורות ובטקסט עצמו.
5. מתאימה כל קטע טקסט של אוצריא למקומו בדף, ומציירת עליו **בועה אחת**.
6. בלחיצה על בועה מבקשת מאוצריא את המפרשים של אותו קטע ומציגה אותם בצד.

התוצאה נשמרת במטמון (זיכרון ו־PostgreSQL), כך שדף שכבר נותח נטען מיד.

---

## 2. מבנה הקבצים

```
src/
  app/
    page.tsx                  דף הבית (שרת) — טוען את הדפים האחרונים ומציג את DafStudio
    layout.tsx                פונטים, כיוון RTL
    globals.css               עיצוב, צבעי הבועות לפי שכבה
    api/
      daf/route.ts            ניתוח דף: PDF + טקסטים → בועות (עם מטמון)
      page-image/route.ts     ציור ה־PDF לתמונה בשרת
      pdf/route.ts            העברת ה־PDF המקורי
      commentaries/route.ts   מפרשים לקטע (גמרא / רש״י / תוספות)
      recent/route.ts         הדפים האחרונים שנפתחו
      health/route.ts         בדיקת תקינות
  components/DafStudio.tsx    כל הממשק: בחירת דף, תמונה, בועות, פאנל מפרשים
  lib/
    otzaria.ts                קריאות לשרת אוצריא (PDF, תוכן עניינים, טקסט)
    hebrew.ts                 פענוח עברית מה־PDF, נרמול, כלי טקסט
    detect.ts                 הלב: זיהוי שכבות, התאמה, בניית מלבנים
    render.ts                 ציור ה־PDF לתמונה (pdf.js + @napi-rs/canvas)
    commentaries.ts           שליפה, סינון ומיון של מפרשים
    shas.ts                   טבלת כל המסכתות: טווחי דפים, מזהי ספרים באוצריא
    store.ts                  מטמון בזיכרון וב־PostgreSQL
    types.ts                  טיפוסים משותפים
  db/schema.ts                טבלאות daf_overlays ו־daf_visits
docs/make-instructions.py     מפיק את המסמך הזה מהקוד
```

---

## 3. מקורות הנתונים (אוצריא)

| מה | כתובת |
|---|---|
| ה־PDF של הדף | `GET /api/tzurat-hadaf/page?masechta=<שם בעברית>&daf=<מספר>&amud=a\|b` |
| תוכן עניינים של ספר | `GET /api/books/{bookId}/toc` — רשומות כמו "דף ב." (ע״א) ו"דף ב:" (ע״ב) עם מספר שורה |
| טקסט הספר | `GET /api/books/{bookId}/content?start=<שורה>&end=<שורה>` |
| מפרשים וקישורים לשורה | `GET /api/books/{bookId}/links?line=<שורה>` |
| מזהי הספרים | `GET /api/library/tree` (המזהים כבר שמורים ב־`src/lib/shas.ts`) |

לכל מסכת יש שלושה ספרים נפרדים באוצריא: הגמרא (למשל 103 לברכות), רש״י על המסכת (2182) ותוספות על המסכת (1927).
שלושתם מחולקים לפי דף ועמוד, ולכן אפשר לקחת בדיוק את הטקסט של דף אחד.

### 3.1 הורדת ה־PDF והטקסט
````ts
function parseDafTitle(title: string): { daf: number; amud: Amud } | null {
  const match = title.match(/דף\s+([א-ת]{1,4})\s*([.:]|ע[״"']?[אב])?/);
  if (!match) return null;
  const daf = fromHebrewNumber(match[1]);
  if (!daf) return null;
  const marker = match[2] || ".";
  const amud: Amud = marker.includes(":") || marker.includes("ב") ? "b" : "a";
  return { daf, amud };
}
````
````ts
export async function fetchPdf(apiName: string, daf: number, amud: Amud): Promise<Uint8Array> {
  const url = `${ORACLE}/api/tzurat-hadaf/page?masechta=${encodeURIComponent(apiName)}&daf=${daf}&amud=${amud}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`לא נמצא דף PDF (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
    throw new Error("השרת לא החזיר קובץ PDF");
  }
  return new Uint8Array(await response.arrayBuffer());
}
````
````ts
export async function fetchSegments(bookId: number, daf: number, amud: Amud): Promise<Segment[]> {
  const toc = await fetchToc(bookId);
  const located = toc
    .map((entry) => ({ ...entry, parsed: parseDafTitle(entry.title) }))
    .filter((entry) => entry.parsed);
  const current = located.find((entry) => entry.parsed?.daf === daf && entry.parsed.amud === amud);
  if (!current) return [];
  const next = located.find((entry) => entry.index > current.index);
  const end = next ? next.index - 1 : current.index + 48;
  const response = await fetch(
    `${ORACLE}/api/books/${bookId}/content?start=${current.index}&end=${end + 5}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("טעינת טקסט הגמרא נכשלה");
  const data = (await response.json()) as { lines?: { lineIndex: number; content: string }[] };
  return (data.lines || [])
    .filter((line) => line.lineIndex >= current.index && line.lineIndex <= end)
    .filter((line) => !/^<h\d/i.test(line.content.trim()))
    .map((line) => ({ lineIndex: line.lineIndex, text: stripTags(line.content) }))
    .filter((line) => line.text.replace(/\s/g, "").length > 1);
}
````

**איך זה עובד.** התוכן העניינים מחזיר, לכל דף, את מספר השורה שבה הוא מתחיל. הקוד מוצא את הרשומה של הדף המבוקש,
את הרשומה שאחריה, וקורא את כל השורות שביניהן. כל שורה כזו היא **קטע** (קטע גמרא, או הערה אחת של רש״י או של תוספות),
והוא מסומן במספר השורה שלו. מספר השורה הוא גם המפתח לבקשת המפרשים אחר כך.

---

## 4. שלב ראשון: פענוח העברית שב־PDF

הטקסט שנשלף מה־PDF אינו עברית תקינה. הגופנים מקודדים את האותיות כסימנים אחרים (למשל `˙ÂÎ¯·` במקום `ברכות`), והסדר הפוך.
כדי לפענח, מנסים שלוש גרסאות ובוחרים את זו שיש בה הכי הרבה אותיות עבריות:

1. הטקסט כמו שהוא.
2. מיפוי Mac Hebrew (`˙` ← ת, `¯` ← ר, `Î` ← כ ...) והיפוך.
3. מיפוי Latin-1 (`ø` ← ר, `ù` ← ש ...) והיפוך.

````ts
function hebrewRatio(value: string): number {
  const letters = [...value].filter((char) => char.charCodeAt(0) > 32 && !/[\d\p{P}\p{S}]/u.test(char));
  if (!letters.length) return 0;
  return letters.filter((char) => HEBREW_RE.test(char)).length / letters.length;
}

function applyMap(value: string, map: Record<string, string>): string {
  return [...value].reverse().map((char) => map[char] || char).join("");
}

export function decodePdfString(raw: string): string {
  const mac = applyMap(raw, MAC_HEBREW);
  const latin = applyMap(raw, LATIN1_HEBREW);
  const candidates = [
    { text: raw, ratio: hebrewRatio(raw) },
    { text: mac, ratio: hebrewRatio(mac) },
    { text: latin, ratio: hebrewRatio(latin) },
  ];
  return candidates.reduce((best, candidate) => (candidate.ratio > best.ratio ? candidate : best)).text;
}
````

הערה: בגופן אחד האות נ' מקודדת כתו בקרה (למשל `\u0002`), ולכן הוא נוסף למיפוי.

---

## 5. שלב שני: גודלי האות — בלי מספרים קבועים

הדף מורכב מכמה "שכבות" של טקסט, וכל אחת בגודל אות אחר. בברכות, לדוגמה:

| שכבה | גודל אות (נקודות) |
|---|---|
| כותרות הדף ומילות הפתיחה של הפרק | 18 ומעלה |
| **דיבור המתחיל של תוספות** | 16.4 (גדול מהגמרא!) |
| **גמרא** | 13.7 |
| **רש״י ותוספות** (אותו גודל) | 11.2 (הדיבור המתחיל של רש״י מודגש: 11.4–11.9) |
| מסורת הש״ס, עין משפט, תורה אור, גליון הש״ס, הגהות | 5–9 |

בבדיקה התברר שהגודלים משתנים בין מסכתות (במנחות הגמרא היא 11.7 ורש״י 9.6), ולכן אסור לקבוע טווחים קבועים.
הפתרון: לספור כמה אותיות יש בכל גודל, לאחד גדלים סמוכים, ולהגדיר:

* **גמרא** — הגודל הגדול ביותר שיש בו כמות מינימלית של אותיות (כ־15 מילים). הסף מוחלט ולא יחסי, כי בדף פתיחה יש רק כמה שורות גמרא.
* **רש״י ותוספות** — הגודל הבא מתחתיו שיש בו חלק משמעותי מהטקסט.
* כותרות ומילות מעבר דלילות מדי כדי להיחשב, והערות השוליים קטנות מדי.

````ts
function detectFonts(words: RawWord[], pageHeight: number): { gemara: number; commentary: number } {
  const buckets = new Map<number, { mass: number; sizes: number[] }>();
  for (const word of words) {
    if (word.y < pageHeight * 0.03 || word.fontSize < 8.8 || word.fontSize > 18) continue;
    const letters = letterCount(word.text);
    if (letters < 2) continue;
    const key = Math.round(word.fontSize * 10);
    const bucket = buckets.get(key) || { mass: 0, sizes: [] };
    bucket.mass += letters;
    bucket.sizes.push(word.fontSize);
    buckets.set(key, bucket);
  }
  const clusters: { mass: number; sizes: number[] }[] = [];
  let previousKey = -Infinity;
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(key)!;
    const last = clusters[clusters.length - 1];
    if (last && key - previousKey <= 3) {
      last.mass += bucket.mass;
      last.sizes.push(...bucket.sizes);
    } else {
      clusters.push({ mass: bucket.mass, sizes: [...bucket.sizes] });
    }
    previousKey = key;
  }
  if (!clusters.length) return { gemara: 0, commentary: 0 };
  const top = Math.max(...clusters.map((cluster) => cluster.mass));
  const sizes = clusters
    .map((cluster) => ({ size: median(cluster.sizes), mass: cluster.mass }))
    .sort((a, b) => b.size - a.size);
  // Opening pages hold only a few lines of Gemara, so its floor is absolute (about 15 words), not a share of the page.
  const floor = Math.max(70, top * 0.03);
  const gemara = sizes.find((cluster) => cluster.mass >= floor)?.size || 0;
  const commentary = sizes.find((cluster) => cluster.size <= gemara * 0.93 && cluster.mass >= top * 0.12)?.size || 0;
  return { gemara, commentary };
}
````

---

## 6. שלב שלישי: הגמרא

### 6.1 שורות

המילים שבגודל הגמרא מקובצות לשורות לפי קו הבסיס שלהן (הגובה שעליו האותיות יושבות). הסבילות היא כ־28% מגודל האות.

````ts
function groupRows(words: RawWord[], font: number): Row[] {
  const sorted = [...words].sort((a, b) => a.y + a.h - (b.y + b.h));
  const tolerance = Math.max(2.2, font * 0.28);
  const rows: Row[] = [];
  for (const word of sorted) {
    const baseline = word.y + word.h;
    const row = rows[rows.length - 1];
    if (row && baseline - row.baseline <= tolerance) {
      row.words.push(word);
      row.baseline = row.words.reduce((sum, item) => sum + item.y + item.h, 0) / row.words.length;
    } else {
      rows.push({ baseline, words: [word] });
    }
  }
  return rows;
}
````

### 6.2 גוש מחובר — גם כשהגמרא מתרחבת לצדדים

הגמרא איננה תמיד עמודה צרה במרכז. כשרש״י או תוספות נגמרים, הגמרא נפרשת לצד אחד או לשני הצדדים ויוצרת צורת זווית (L) או T.
לכן אין עמודה קבועה. במקום זה שורות מחוברות זו לזו כשהן קרובות אנכית וחופפות אופקית, והגוש הגדול ביותר הוא הגמרא:

````ts
function components(clusters: Cluster[], reach: number): Component[] {
  const parent = clusters.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  for (let a = 0; a < clusters.length; a += 1) {
    for (let b = a + 1; b < clusters.length; b += 1) {
      const first = clusters[a];
      const second = clusters[b];
      if (first.row === second.row) continue;
      if (Math.abs(first.baseline - second.baseline) > reach) continue;
      const overlap = Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX);
      if (overlap > -6) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, Component>();
  clusters.forEach((cluster, index) => {
    const root = find(index);
    const group =
      groups.get(root) ||
      ({ members: [], letters: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity } as Component);
    group.members.push(index);
    group.letters += cluster.letters;
    group.minX = Math.min(group.minX, cluster.minX);
    group.maxX = Math.max(group.maxX, cluster.maxX);
    group.minY = Math.min(group.minY, cluster.baseline);
    group.maxY = Math.max(group.maxY, cluster.baseline);
    groups.set(root, group);
  });
  return [...groups.values()].sort((a, b) => b.letters - a.letters);
}
````

כל שורה נשברת תחילה במקום שיש בו רווח רחב במיוחד, כדי ששני גושים באותו גובה לא יידבקו:

````ts
function splitRow(row: Row, rowIndex: number, gap: number): Cluster[] {
  const sorted = [...row.words].sort((a, b) => b.x + b.w - (a.x + a.w));
  const clusters: Cluster[] = [];
  let current: RawWord[] = [];
  let left = Infinity;
  const flush = () => {
    if (!current.length) return;
    clusters.push({
      row: rowIndex,
      baseline: row.baseline,
      minX: Math.min(...current.map((word) => word.x)),
      maxX: Math.max(...current.map((word) => word.x + word.w)),
      letters: current.reduce((sum, word) => sum + letterCount(word.text), 0),
      words: current,
    });
    current = [];
    left = Infinity;
  };
  for (const word of sorted) {
    if (current.length && left - (word.x + word.w) > gap) flush();
    current.push(word);
    left = Math.min(left, word.x);
  }
  flush();
  return clusters;
}
````

### 6.3 אותיות גדולות בתוך הגמרא — ומה לא שייך לה

מילת הפתיחה של פרק, וסימנים כמו "גמ׳" ו"מתני׳", מודפסים באות גדולה יותר. הקוד מצרף אותם לשורה שהם יושבים עליה,
או יוצר להם מלבן משלהם. המלבן נחתך כך שלא ייכנס לשורות השכנות.

חשוב: **הדיבור המתחיל של תוספות גם הוא באות גדולה** (גדולה אפילו מהגמרא). כדי שלא ייבלע בגמרא, שלב המפרשים (סעיף 8) רץ
לפני הצירוף הזה ומוסר רשימת אזורים שמורים (`reserved`): כל מילה גדולה שיושבת בתוך שורת מפרש מתויגת נפסלת כאן.

````ts
function attachMarkers(
  words: RawWord[],
  lines: Line[],
  font: number,
  pitch: number,
  pageHeight: number,
  reserved: { minX: number; maxX: number; minY: number; maxY: number }[] = [],
) {
  const body = lines.filter((line) => !line.marker);
  if (!body.length) return;
  const markers = words.filter((word) => {
    if (word.fontSize < font + 1 || word.fontSize > 40 || word.y <= pageHeight * 0.03 || letterCount(word.text) === 0) return false;
    const cx = word.x + word.w / 2;
    const cy = word.y + word.h / 2;
    return !reserved.some((box) => cx >= box.minX - 3 && cx <= box.maxX + 3 && cy >= box.minY - 3 && cy <= box.maxY + 3);
  });
  const added: Line[] = [];
  for (const word of markers) {
    const center = word.x + word.w / 2;
    const base = word.y + word.h;
    let host: Line | null = null;
    let distance = Infinity;
    for (const line of body) {
      const gap = Math.abs(line.bottom - 1.4 - base);
      if (gap <= pitch * 0.9 && center >= line.minX - 8 && center <= line.maxX + 8 && gap < distance) {
        host = line;
        distance = gap;
      }
    }
    if (host) {
      host.words.push(word);
      continue;
    }
    const markerLine: Line = {
      top: base - word.h * 0.8,
      bottom: base + word.h * 0.14,
      minX: word.x,
      maxX: word.x + word.w,
      words: [word],
      marker: true,
    };
    const first = body[0];
    if (base <= first.bottom && base >= first.top - pitch * 4.5 && center >= first.minX - 10 && center <= first.maxX + 10) {
      added.push(markerLine);
      continue;
    }
    const upper = [...body].reverse().find((line) => line.bottom <= word.y + 3);
    const lower = body.find((line) => line.top >= base - 3);
    if (
      upper &&
      lower &&
      lower.top - upper.bottom <= pitch * 5 &&
      center >= upper.minX &&
      center <= upper.maxX &&
      center >= lower.minX &&
      center <= lower.maxX
    ) {
      added.push(markerLine);
    }
  }
  lines.push(...added);
  // A marker line never reaches into its neighbours: clip it to the free band between them.
  for (const marker of added) {
    for (const other of lines) {
      if (other === marker || other.marker) continue;
      if (overlapLength(marker.minX, marker.maxX, other.minX, other.maxX) <= 0) continue;
      if (other.top < marker.top && other.bottom > marker.top && other.bottom + 0.4 < marker.bottom - 6) {
        marker.top = other.bottom + 0.4;
      }
      if (other.top < marker.bottom && other.bottom > marker.bottom && other.top - 0.4 > marker.top + 6) {
        marker.bottom = other.top - 0.4;
      }
    }
  }
  lines.sort((a, b) => a.top - b.top || (a.marker === b.marker ? 0 : a.marker ? -1 : 1));
}
````

---

## 7. שלב רביעי: התאמת הטקסט של אוצריא למקום בדף

לכל שכבה בונים "זרם" אחד של אותיות מהשורות שזוהו, מימין לשמאל ומלמעלה למטה, ומנרמלים אותו: בלי ניקוד, בלי פיסוק, אותיות סופיות כרגילות.
אחר כך מתאימים כל קטע מאוצריא למקומו בזרם, לפי **מרחק עריכה** (כמה אותיות צריך להוסיף, להוריד או להחליף). זה סובל קיצורים, שגיאות פענוח ושינויי נוסח.

**הצמדה לתחילת השורה.** ההדפסה מקצרת שמות ("דר׳ מאיר" במקום "דרבי מאיר"). היישור הזול ביותר מעדיף אז לדלג על המילה המקוצרת,
והבועה הייתה מתחילה באמצע השורה. לכן, אם הטקסט שדולג עליו הוא תחילית מסודרת של הקטע, ההתחלה חוזרת לסוף הקטע הקודם.

````ts
function alignSegment(target: string, stream: string, from: number, slack: number) {
  const n = target.length;
  const to = Math.min(stream.length, from + Math.ceil(n * 1.35) + 60 + slack);
  const m = to - from;
  if (n < 3 || m < 3) return null;
  let prevCost = new Int32Array(m + 1);
  let prevStart = new Int32Array(m + 1);
  let prevMatch = new Int32Array(m + 1);
  let curCost = new Int32Array(m + 1);
  let curStart = new Int32Array(m + 1);
  let curMatch = new Int32Array(m + 1);
  for (let j = 0; j <= m; j += 1) prevStart[j] = j;
  for (let i = 1; i <= n; i += 1) {
    const code = target.charCodeAt(i - 1);
    curCost[0] = prevCost[0] + 1;
    curStart[0] = prevStart[0];
    curMatch[0] = prevMatch[0];
    for (let j = 1; j <= m; j += 1) {
      const same = stream.charCodeAt(from + j - 1) === code;
      let cost = prevCost[j - 1] + (same ? 0 : 1);
      let start = prevStart[j - 1];
      let match = prevMatch[j - 1] + (same ? 1 : 0);
      const up = prevCost[j] + 1;
      if (up < cost || (up === cost && prevMatch[j] > match)) {
        cost = up;
        start = prevStart[j];
        match = prevMatch[j];
      }
      const left = curCost[j - 1] + 1;
      if (left < cost || (left === cost && curMatch[j - 1] > match)) {
        cost = left;
        start = curStart[j - 1];
        match = curMatch[j - 1];
      }
      curCost[j] = cost;
      curStart[j] = start;
      curMatch[j] = match;
    }
    [prevCost, curCost] = [curCost, prevCost];
    [prevStart, curStart] = [curStart, prevStart];
    [prevMatch, curMatch] = [curMatch, prevMatch];
  }
  let bestJ = -1;
  let bestCost = Infinity;
  let bestMatch = -1;
  for (let j = 1; j <= m; j += 1) {
    if (prevCost[j] < bestCost || (prevCost[j] === bestCost && prevMatch[j] > bestMatch)) {
      bestCost = prevCost[j];
      bestMatch = prevMatch[j];
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;
  let start = from + prevStart[bestJ];
  // Printed text abbreviates ("דר׳" for "דרבי"), so the cheapest alignment may skip the segment's first letters.
  // The previous segment ended at `from`; if the gap to it is short and the skipped stream text is a prefix of the
  // segment, the segment really starts where the previous one ended.
  const skipped = start - from;
  if (skipped > 0 && skipped <= Math.max(6, Math.floor(n * 0.2))) {
    // Strict: the skipped stream text must read as an in-order prefix of the segment (e.g. "קשיאדר" vs "קשיאדרבי").
    const head = stream.slice(from, start);
    let cursorInTarget = 0;
    let ordered = 0;
    for (const char of head) {
      const at = target.indexOf(char, cursorInTarget);
      if (at >= 0 && at - cursorInTarget <= 2) {
        ordered += 1;
        cursorInTarget = at + 1;
      }
    }
    if (ordered === head.length) start = from;
  }
  return { start, end: from + bestJ, coverage: bestMatch / n };
}
````

ההתאמה עוברת על הקטעים לפי הסדר, וכל קטע מתחיל מהמקום שבו הקודם נגמר.
עוגן אחד שגוי דוחס את כל הקטעים שאחריו למעט מדי טקסט; לכן יש **מעבר שחזור**: רצף של שלושה קטעים ומעלה שלא הותאמו מיושר מחדש
בכל האזור הפנוי שבין העוגנים הטובים שסביבו, ובמידת הצורך העוגן החשוד שלפניו נזרק. אחר כך:

* קטע שהכיסוי שלו נמוך מ־68% נחשב לא מותאם. קטע **רציף וקצר מהמקור** (כלומר מקוצר בהדפסה) מתקבל גם ב־56%.
* קטע שלא הותאם **בין שני קטעים שכן הותאמו** מקבל את המקום שביניהם, בחלוקה לפי אורך הטקסט. הוא מסומן בקו מקווקו כ"מיקום משוער".
* פערים קטנים בין שני קטעים נסגרים, כך שאין חורים בין הבועות.

````ts
function placeSegments(targets: string[], stream: string): Placement[] {
  const aligned: (Placement | null)[] = targets.map(() => null);
  const accept = (result: ReturnType<typeof alignSegment>, target: string, cursor: number) => {
    if (!result) return false;
    const span = result.end - result.start;
    const tight = result.start - cursor <= 2 && span <= target.length * 1.05 && span >= target.length * 0.5;
    const threshold = tight ? MIN_COVERAGE - 0.12 : MIN_COVERAGE;
    return result.coverage >= threshold && span <= target.length * 1.6 + 10;
  };

  // Forward pass: each segment is searched right after the previous match. If a segment cannot be found there,
  // the search window for the next ones grows by its length (slack), so one missing segment does not stall the rest.
  let cursor = 0;
  let slack = 0;
  targets.forEach((target, index) => {
    if (target.length < 3) return;
    const result = alignSegment(target, stream, cursor, slack);
    if (accept(result, target, cursor) && result) {
      aligned[index] = { segment: index, start: Math.max(result.start, cursor), end: result.end, score: Math.round(result.coverage * 100) / 100 };
      cursor = result.end;
      slack = 0;
    } else {
      slack += target.length;
    }
  });

  // Recovery pass: a wrong anchor squeezes every later segment into too little text. Detect such runs (three or
  // more consecutive misses) and re-align them in the whole free region between the surrounding good anchors.
  for (let index = 0; index < targets.length; ) {
    if (aligned[index] || targets[index].length < 3) {
      index += 1;
      continue;
    }
    let runEnd = index;
    while (runEnd < targets.length && !aligned[runEnd]) runEnd += 1;
    const runLength = runEnd - index;
    if (runLength >= 3) {
      let previous = index - 1;
      while (previous >= 0 && !aligned[previous]) previous -= 1;
      let regionStart = previous >= 0 ? (aligned[previous] as Placement).end : 0;
      const regionEnd = runEnd < targets.length ? (aligned[runEnd] as Placement).start : stream.length;
      // The anchor just before the run is the usual suspect: drop it and let the run re-claim its text.
      const suspect = previous >= 0 ? (aligned[previous] as Placement) : null;
      if (suspect && regionEnd - regionStart < targets.slice(index, runEnd).reduce((sum, t) => sum + t.length, 0) * 0.6) {
        regionStart = suspect.start;
        aligned[previous] = null;
        index = previous;
      }
      let local = regionStart;
      for (let k = index; k < runEnd; k += 1) {
        const target = targets[k];
        if (target.length < 3) continue;
        const room = regionEnd - local;
        if (room < 3) break;
        const result = alignSegment(target, stream.slice(0, regionEnd), local, Math.max(0, room - target.length));
        if (accept(result, target, local) && result) {
          aligned[k] = { segment: k, start: Math.max(result.start, local), end: result.end, score: Math.round(result.coverage * 100) / 100 };
          local = result.end;
        }
      }
    }
    index = Math.max(index + 1, runEnd);
  }

  if (aligned.some(Boolean)) {
    let previousEnd = 0;
    let pending: number[] = [];
    const flush = (nextStart: number) => {
      const span = nextStart - previousEnd;
      if (pending.length && span >= 3) {
        const total = pending.reduce((sum, index) => sum + targets[index].length, 0) || 1;
        let position = previousEnd;
        pending.forEach((index, order) => {
          const share =
            order === pending.length - 1 ? nextStart - position : Math.round((span * targets[index].length) / total);
          const end = Math.min(nextStart, position + share);
          if (end - position >= 3) aligned[index] = { segment: index, start: position, end, score: 0.5 };
          position = end;
        });
      }
      pending = [];
    };
    targets.forEach((target, index) => {
      if (target.length < 3) return;
      const placement = aligned[index];
      if (placement) {
        flush(placement.start);
        previousEnd = placement.end;
      } else {
        pending.push(index);
      }
    });
    flush(stream.length);
  }

  const placed = aligned.filter((item): item is Placement => Boolean(item)).sort((a, b) => a.start - b.start);
  if (placed.length) {
    if (placed[0].start <= SMALL_GAP) placed[0].start = 0;
    const last = placed[placed.length - 1];
    if (stream.length - last.end <= SMALL_GAP) last.end = stream.length;
    for (let index = 1; index < placed.length; index += 1) {
      const gap = placed[index].start - placed[index - 1].end;
      if (gap > 0 && gap <= SMALL_GAP) {
        const middle = placed[index - 1].end + Math.floor(gap / 2);
        placed[index - 1].end = middle;
        placed[index].start = middle;
      }
    }
  }
  return placed;
}
````

### 7.1 בניית המלבנים

כל קטע מתפרש על כמה שורות. לכל שורה נבנה מלבן אחד: בשורה הראשונה הוא מתחיל מהמילה הראשונה של הקטע, בשורה האחרונה הוא נגמר במילה האחרונה,
ובשורות שבאמצע הוא תופס את השורה כולה. הגובה אחיד ומחושב ממרווח השורות, ולכן המלבנים לא חופפים זה לזה.

````ts
function rectsForRange(stream: Stream, layer: LayerKind, start: number, end: number): RectDraft[] {
  const spans = new Map<number, { minX: number; maxX: number; first: boolean; last: boolean }>();
  for (let index = start; index < end; index += 1) {
    const char = stream.chars[index];
    if (!char) continue;
    const span = spans.get(char.line) || { minX: Infinity, maxX: -Infinity, first: false, last: false };
    span.minX = Math.min(span.minX, char.x);
    span.maxX = Math.max(span.maxX, char.x + char.w);
    if (index === stream.lineStart[char.line]) span.first = true;
    if (index === stream.lineEnd[char.line]) span.last = true;
    spans.set(char.line, span);
  }
  const drafts: RectDraft[] = [];
  for (const [lineIndex, span] of [...spans.entries()].sort((a, b) => a[0] - b[0])) {
    const line = stream.lines[lineIndex];
    const right = span.first ? line.maxX + 2.2 : Math.min(line.maxX + 2.2, span.maxX + 1.8);
    const left = span.last ? line.minX - 2.2 : Math.max(line.minX - 2.2, span.minX - 1.8);
    if (right - left < 4) continue;
    drafts.push({ layer, line: lineIndex, rect: { x: left, y: line.top, w: right - left, h: line.bottom - line.top } });
  }
  return drafts;
}
````

---

## 8. שלב חמישי: רש״י ותוספות — בדיוק

זה החלק הקשה ביותר, כי **רש״י ותוספות באותו גודל אות**. אי אפשר להפריד ביניהם לפי הגופן, והמיקום מטעה. בבדיקה נמצאו ארבע בעיות:

1. **הרווח בין העמודות קטן.** בראש הדף רש״י ותוספות יושבים זה ליד זה, והרווח ביניהם הוא כ־11 נקודות.
   אבל בשורה מוצדקת גם הרווחים בין מילים נמתחים לכ־9 נקודות. סף של רווח אחד לא מפריד נכון: או שהשורות נדבקות לגוש ברוחב כל הדף, או שהן נחתכות באמצע משפט.
2. **הצד משתנה.** רש״י מימין בברכות ב ע״א אבל משמאל בברכות ב ע״ב. כלל מבוסס צד טועה בחצי מהדפים.
3. **העמודות מתחברות.** מעל הגמרא ומתחתיה הן נוגעות זו בזו, ולכן אי אפשר לזהות "שני גושים".
4. **כותרות השוליים** (מסורת הש״ס, הגהות הב״ח, תורה אור, מוסף רש״י) באות באותו גודל כמו מילת הדיבור המתחיל המודגשת (11.9), ונכנסות לחישוב.

### 8.0 הדיבור המתחיל

זה היה מקור הבלבול העיקרי, ובשלוש השכבות:

* **בתוספות** מילת הפתיחה מודפסת באות גדולה (16.4 נקודות בברכות) — גדולה אפילו מהגמרא. קוד שמסנן לפי גודל האות של המפרשים מאבד אותה, וקוד שמחפש "אותיות גדולות" מצרף אותה לגמרא.
  הפתרון: מילה גדולה שיושבת על קו בסיס של שורת מפרשים, בתוך העמודה, ובקצה הימני של השורה — היא הדיבור המתחיל של אותה שורה. היא מצורפת לעמודת המפרש (`openers` ב־`labelCommentary`), ונחסמת מראש מלהיכנס לגמרא (`reserved` ב־`attachMarkers`).
  סימני "גמ׳" ו"מתני׳" שהמדפיס שם בשוליים נראים דומים, ולכן נדרשות לפחות 3 אותיות ובלי גרש.
* **ברש״י** הדיבור המתחיל מודגש אך באותו גודל, ולכן הוא זוהה נכון מלכתחילה. מה שנכשל היה השורה הראשונה של רש״י בראש הדף, שלא הייתה מתויגת כי הקולות שלה חלשים; שלב ג (מיקום הרווח משורות שכנות) פותר את זה.
* **בגמרא** אין דיבור מתחיל, אבל ה־PDF מקצר שמות ("דר׳ מאיר" במקום "דרבי מאיר"). ההתאמה מעדיפה להתחיל *אחרי* המילה המקוצרת כדי לחסוך מחיקות, וכך הבועה מתחילה באמצע השורה.
  הפתרון ב־`alignSegment`: אם הטקסט שדולג עליו הוא תחילית מסודרת של הקטע, ההתחלה חוזרת לסוף הקטע הקודם. בנוסף, קטע רציף וקצר מהמקור (מקוצר) מתקבל גם בכיסוי נמוך יותר.

### הפתרון: ראיות מהטקסט עצמו

אוצריא מחזיק את רש״י ואת תוספות כספרים נפרדים, ולכן אפשר לשאול על כל מילה: **האם הטקסט הזה שייך לרש״י או לתוספות?**
כדי שהתשובה תהיה אמינה, משתמשים רק ברצפים של שלוש אותיות שמופיעים **באחד הספרים ולא בשני**. ביטויים נפוצים כמו "דאמר רב" מופיעים בשניהם ואינם מצביעים לשום צד.

הקוד עובד בחמישה שלבים:

**שלב א: סינון.** רק טקסט בטווח האופקי של הגוף נשאר. מי שמחוץ לו הוא כותרת שוליים. רק גודל אות של שכבת המפרשים נכנס, בתוספת מילות הפתיחה הגדולות של תוספות.

**שלב ב: הצבעה לכל שורה.** כל שורה נשברת במקום שיש בו רווח רחב (העמודה של הגמרא). כך כל שורה נשארת שלמה, או מתפצלת לשני חלקים לכל היותר: עמודה אחת ועמודה שנייה.
לכל פריט בשורה סופרים כמה רצפים ייחודיים לרש״י וכמה ייחודיים לתוספות. אחר כך בודקים **כל נקודת חיתוך אפשרית** בשורה:
לכל אחת מחשבים כמה ראיות יש לכל צד, ובוחרים את החיתוך עם התמיכה הטובה ביותר. החיתוך מתקבל רק אם:

* יש לפחות 3 הצבעות בכל צד,
* הרווח ברוחב 5.5 נקודות לפחות,
* החיתוך עדיף על "כל השורה היא פירוש אחד" ב־5 הצבעות לפחות.

אחרת השורה כולה מקבלת את התווית של הצד החזק, ורק אם יש לפחות 4 הצבעות וגם יתרון ברור. בלי ראיות, השורה נשארת ללא תווית.

````ts
function uniqueGrams(source: Set<string>, other: Set<string>): Set<string> {
  const unique = new Set<string>();
  for (const gram of source) if (!other.has(gram)) unique.add(gram);
  return unique;
}
````
````ts
function itemVotes(text: string, onlyRashi: Set<string>, onlyTosafot: Set<string>) {
  const normalized = normalizeHebrew(text);
  let r = 0;
  let t = 0;
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    const gram = normalized.slice(index, index + 3);
    if (onlyRashi.has(gram)) r += 1;
    else if (onlyTosafot.has(gram)) t += 1;
  }
  return { r, t };
}
````
````ts
function decideGroup(items: RawWord[], votes: { r: number; t: number }[]): { split: SplitPoint | null; label: Side | null } {
  const n = items.length;
  const preR = [0];
  const preT = [0];
  const preRight = [-Infinity];
  for (let index = 0; index < n; index += 1) {
    preR.push(preR[index] + votes[index].r);
    preT.push(preT[index] + votes[index].t);
    preRight.push(Math.max(preRight[index], items[index].x + items[index].w));
  }
  const totalR = preR[n];
  const totalT = preT[n];
  const total = totalR + totalT;
  const singleScore = Math.abs(totalR - totalT);

  let best: SplitPoint | null = null;
  let bestScore = -Infinity;
  for (let k = 1; k < n; k += 1) {
    const gap = items[k].x - preRight[k];
    if (gap < MIN_GUTTER) continue;
    const leftR = preR[k];
    const leftT = preT[k];
    const rightR = totalR - leftR;
    const rightT = totalT - leftT;
    if (leftR + leftT < MIN_SIDE_VOTES || rightR + rightT < MIN_SIDE_VOTES) continue;
    const leftDiff = leftR - leftT;
    const rightDiff = rightR - rightT;
    const bonus = 0.35 * Math.min(gap, 16);
    if (leftDiff > 0 && rightDiff < 0) {
      const score = leftDiff - rightDiff + bonus;
      if (score > bestScore) {
        bestScore = score;
        best = { index: k, x0: preRight[k], x1: items[k].x, left: "rashi", right: "tosafot" };
      }
    }
    if (leftDiff < 0 && rightDiff > 0) {
      const score = rightDiff - leftDiff + bonus;
      if (score > bestScore) {
        bestScore = score;
        best = { index: k, x0: preRight[k], x1: items[k].x, left: "tosafot", right: "rashi" };
      }
    }
  }
  if (best && bestScore - singleScore >= SPLIT_MARGIN) return { split: best, label: null };
  if (total >= 4 && singleScore >= Math.max(3, total * 0.5)) {
    return { split: null, label: totalR >= totalT ? "rashi" : "tosafot" };
  }
  return { split: null, label: null };
}
````

**שלב ג: מיקום הרווח משורות שכנות.** שורה קצרה, כמו המילים האחרונות של פסקה, אין בה מספיק ראיות. אבל בשורות שמעליה ומתחתיה כבר ידוע
היכן עובר הרווח בין העמודות. לכן, אם בשורה יש רווח שחופף לרווח הזה ב־4 נקודות לפחות, היא נחתכת שם ומקבלת את אותן תוויות.
ההחלטה נדחית אם הטקסט סותר אותה.

**שלב ד: מילוי בין שורות.** קטע שנשאר בלי תווית מקבל תווית רק אם **מעליו ומתחתיו, באותה עמודה, יש אותו פירוש**. כותרת שבסוף העמודה, למשל "הגהות הב״ח", אין מתחתיה כלום ולכן היא לא מסומנת.

**שלב ה: המפרש ששורד.** פעמים רבות תוספות נגמר באמצע העמוד ורש״י ממשיך לבדו, גם ברצועה הרחבה שמתחת לגמרא. שורות כאלה אין להן "שכן מתחת", ולכן שלב ד לא מטפל בהן.
הפתרון: הולכים מלמעלה למטה, וקטע ללא תווית שנוגע מלמעלה בקטע מתויג — ואין בקרבתו תווית מנוגדת — יורש את התווית. כך רש״י נמשך עד תחתית הדף גם כשהוא מתרחב לרוחב כולו (נבדק ביבמות מ ע״ב).

````ts
function labelCommentary(
  words: RawWord[],
  font: number,
  input: LayerInput,
  pageHeight: number,
): { fragments: Fragment[]; pitch: number } {
  if (!font) return { fragments: [], pitch: 10.4 };
  const body = words.filter(
    (word) => Math.abs(word.fontSize - font) <= 0.3 && letterCount(word.text) >= 2 && word.y > pageHeight * 0.03,
  );
  if (!body.length) return { fragments: [], pitch: font * 0.93 };
  const low = percentile(body.map((word) => word.x), 0.01) - 5;
  const high = percentile(body.map((word) => word.x + word.w), 0.99) + 5;
  const sized = words.filter(
    (word) =>
      word.fontSize >= font * COMMENTARY_LOW &&
      word.fontSize <= font * COMMENTARY_HIGH &&
      word.w > 0.6 &&
      word.y > pageHeight * 0.03 &&
      word.x >= low &&
      word.x + word.w <= high,
  );
  // Large opening words ("דיבור המתחיל" of Tosafot) sit on a commentary baseline, inside the column, above the
  // Gemara size. They belong to the commentary line they open, not to the Gemara.
  const openers = words.filter((word) => {
    if (word.fontSize <= font * COMMENTARY_HIGH || word.fontSize > 40) return false;
    // A real opening word, not a "גמ׳" / "מתני׳" marker the printer placed in the margin.
    if (letterCount(word.text) < 3 || /['׳"״]/.test(word.text)) return false;
    if (word.y <= pageHeight * 0.03 || word.x < low || word.x + word.w > high) return false;
    const base = word.y + word.h;
    const sameLine = sized.filter((other) => Math.abs(other.y + other.h - base) <= font * 0.4);
    const continues = sameLine.some(
      (other) => other.x + other.w <= word.x + 2 && word.x - (other.x + other.w) <= font * 1.6,
    );
    // It must be the right-most text of its commentary line: nothing of commentary size to its right nearby.
    const rightNeighbour = sameLine.some(
      (other) => other.x >= word.x + word.w - 2 && other.x - (word.x + word.w) <= font * 1.6,
    );
    return continues && !rightNeighbour;
  });
  const candidates = [...sized, ...openers];
  const rows = groupRows(candidates, font);
  const pitch = estimatePitch(rows, font * 0.93);

  const rashiGrams = trigrams(input.rashi.map((segment) => normalizeHebrew(segment.text)).join(""));
  const tosafotGrams = trigrams(input.tosafot.map((segment) => normalizeHebrew(segment.text)).join(""));
  const onlyRashi = uniqueGrams(rashiGrams, tosafotGrams);
  const onlyTosafot = uniqueGrams(tosafotGrams, rashiGrams);

  const groups: Group[] = [];
  rows.forEach((row, rowIndex) => {
    const sorted = [...row.words].sort((a, b) => a.x - b.x);
    let current: RawWord[] = [];
    let edge = -Infinity;
    const flush = () => {
      if (!current.length) return;
      const votes = current.map((word) => itemVotes(word.text, onlyRashi, onlyTosafot));
      groups.push({ row: rowIndex, baseline: row.baseline, items: current, votes, ...decideGroup(current, votes) });
      current = [];
      edge = -Infinity;
    };
    for (const word of sorted) {
      if (current.length && word.x - edge > font * 1.6) flush();
      current.push(word);
      edge = Math.max(edge, word.x + word.w);
    }
    flush();
  });

  // Pass 2: reuse the gutter seen in nearby rows where this row's own text is too thin to decide.
  const gutters = groups
    .filter((group) => group.split)
    .map((group) => ({ baseline: group.baseline, ...(group.split as SplitPoint) }));
  for (const group of groups) {
    if (group.split || !gutters.length) continue;
    const near = gutters.filter((gutter) => Math.abs(gutter.baseline - group.baseline) <= pitch * 3.2);
    if (!near.length) continue;
    let reach = -Infinity;
    const rights = group.items.map((word) => (reach = Math.max(reach, word.x + word.w)));
    let chosen: SplitPoint | null = null;
    let chosenOverlap = 0;
    for (let k = 1; k < group.items.length; k += 1) {
      const x0 = rights[k - 1];
      const x1 = group.items[k].x;
      if (x1 - x0 < MIN_GUTTER) continue;
      for (const gutter of near) {
        const shared = overlapLength(x0, x1, gutter.x0, gutter.x1);
        if (shared < 4 || shared <= chosenOverlap) continue;
        if (support(group.votes.slice(0, k), gutter.left) < -2) continue;
        if (support(group.votes.slice(k), gutter.right) < -2) continue;
        chosen = { index: k, x0, x1, left: gutter.left, right: gutter.right };
        chosenOverlap = shared;
      }
    }
    if (chosen) {
      group.split = chosen;
      group.label = null;
    }
  }

  const fragments: Fragment[] = [];
  const make = (group: Group, items: RawWord[], label: Side | null): Fragment => ({
    row: group.row,
    baseline: group.baseline,
    minX: Math.min(...items.map((word) => word.x)),
    maxX: Math.max(...items.map((word) => word.x + word.w)),
    letters: items.reduce((sum, word) => sum + letterCount(word.text), 0),
    words: items,
    label,
  });
  for (const group of groups) {
    if (group.split) {
      fragments.push(make(group, group.items.slice(0, group.split.index), group.split.left));
      fragments.push(make(group, group.items.slice(group.split.index), group.split.right));
    } else {
      fragments.push(make(group, group.items, group.label));
    }
  }

  // Pass 3: an unlabelled fragment inside a column takes the label of its labelled neighbours above and below.
  const sameStrip = (a: Fragment, b: Fragment) =>
    overlapLength(a.minX, a.maxX, b.minX, b.maxX) / Math.max(1, Math.min(a.maxX - a.minX, b.maxX - b.minX)) >= 0.6;
  const neighbours = (fragment: Fragment) => {
    let above: Fragment | null = null;
    let below: Fragment | null = null;
    for (const other of fragments) {
      if (other === fragment || !other.label || !sameStrip(fragment, other)) continue;
      const delta = other.baseline - fragment.baseline;
      if (delta < -0.5 && delta >= -pitch * 3.2 && (!above || other.baseline > above.baseline)) above = other;
      if (delta > 0.5 && delta <= pitch * 3.2 && (!below || other.baseline < below.baseline)) below = other;
    }
    return { above, below };
  };
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const fragment of fragments) {
      if (fragment.label) continue;
      const { above, below } = neighbours(fragment);
      if (above && below && above.label === below.label) {
        fragment.label = above.label;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Pass 4: one commentary can outlive the other. Once Tosafot (or Rashi) has ended, the remaining rows of the
  // page belong to the survivor, including the wide strip under the Gemara. Walk down the page: an unlabelled
  // fragment that touches a labelled fragment directly above it, with no opposing label in reach, inherits it.
  const ordered = [...fragments].sort((a, b) => a.baseline - b.baseline);
  const hasOpposing = (fragment: Fragment, label: Side) =>
    fragments.some(
      (other) =>
        other.label &&
        other.label !== label &&
        Math.abs(other.baseline - fragment.baseline) <= pitch * 1.2 &&
        overlapLength(other.minX, other.maxX, fragment.minX, fragment.maxX) > -font * 1.6,
    );
  for (let pass = 0; pass < 40; pass += 1) {
    let changed = false;
    for (const fragment of ordered) {
      if (fragment.label) continue;
      const feeders = fragments.filter((other) => {
        if (!other.label) return false;
        const delta = fragment.baseline - other.baseline;
        if (delta <= 0.5 || delta > pitch * 1.6) return false;
        return overlapLength(other.minX, other.maxX, fragment.minX, fragment.maxX) >= Math.min(20, (fragment.maxX - fragment.minX) * 0.4);
      });
      if (!feeders.length) continue;
      const labels = new Set(feeders.map((other) => other.label));
      if (labels.size !== 1) continue;
      const label = feeders[0].label as Side;
      if (hasOpposing(fragment, label)) continue;
      fragment.label = label;
      changed = true;
    }
    if (!changed) break;
  }
  return { fragments, pitch };
}
````

### 8.1 הבטחה: שום בועה לא נוגעת באחרת

שלוש שכבות הגנה, בסדר הזה:

1. **גמרא תמיד מנצחת.** בועת מפרש שנוגעת בגמרא נסוגה לצד הפנוי.
2. **בתוך אותה שכבה** שתי בועות על אותה שורה נפגשות בקו אמצע משותף.
3. **מעבר אחרון** על כל זוגות המלבנים בדף: כל חפיפה שנשארה מצומצמת.

````ts
function clipAgainst(target: RectDraft[], blockers: RectDraft[]): number {
  let clipped = 0;
  for (const draft of target) {
    for (const blocker of blockers) {
      const a = draft.rect;
      const b = blocker.rect;
      const vertical = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (vertical <= Math.min(a.h, b.h) * 0.25) continue;
      const horizontal = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (horizontal <= 0) continue;
      clipped += 1;
      const centerA = a.x + a.w / 2;
      const centerB = b.x + b.w / 2;
      if (centerA <= centerB) {
        const edge = Math.min(a.x + a.w, b.x - 1.2);
        a.w = edge - a.x;
      } else {
        const edge = Math.max(a.x, b.x + b.w + 1.2);
        a.w = a.x + a.w - edge;
        a.x = edge;
      }
    }
  }
  return clipped;
}
````
````ts
function separateWithinLayer(drafts: RectDraft[]) {
  const byLine = new Map<string, RectDraft[]>();
  for (const draft of drafts) {
    const key = `${draft.layer}:${draft.line}`;
    const list = byLine.get(key) || [];
    list.push(draft);
    byLine.set(key, list);
  }
  for (const list of byLine.values()) {
    list.sort((a, b) => a.rect.x - b.rect.x);
    for (let index = 1; index < list.length; index += 1) {
      const left = list[index - 1].rect;
      const right = list[index].rect;
      const edge = left.x + left.w;
      if (edge > right.x - 1.2) {
        const middle = (edge + right.x) / 2;
        left.w = Math.max(2, middle - 0.7 - left.x);
        const rightEdge = right.x + right.w;
        right.x = middle + 0.7;
        right.w = Math.max(2, rightEdge - right.x);
      }
    }
  }
}
````
````ts
function resolveOverlaps(items: { layer: LayerKind; owner: number; rect: BubbleRect }[]): number {
  const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y);
  let fixed = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.rect.y >= a.rect.y + a.rect.h) break;
      if (a.owner === b.owner) continue;
      const vertical = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
      if (vertical <= 0.6) continue;
      const horizontal = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
      if (horizontal <= 0.6) continue;
      fixed += 1;
      const victim =
        a.layer !== b.layer ? (a.layer === "gemara" ? b : a) : a.owner > b.owner ? a : b;
      const keeper = victim === a ? b : a;
      if (victim.rect.x + victim.rect.w / 2 <= keeper.rect.x + keeper.rect.w / 2) {
        const edge = Math.min(victim.rect.x + victim.rect.w, keeper.rect.x - 1.2);
        victim.rect.w = Math.max(0, edge - victim.rect.x);
      } else {
        const edge = Math.max(victim.rect.x, keeper.rect.x + keeper.rect.w + 1.2);
        victim.rect.w = Math.max(0, victim.rect.x + victim.rect.w - edge);
        victim.rect.x = edge;
      }
    }
  }
  return fixed;
}
````

### 8.2 מה קורה כשאין התאמה

אם הספר של רש״י או של תוספות חסר באוצריא, או שהמפרש המודפס בדף הוא אחר, אין ראיות, ולכן **אין בועות בשכבה הזו**. המערכת לא מנחשת.
דוגמאות שנבדקו: בנדרים המפרש המודפס הוא הר״ן ולא רש״י; בבבא בתרא מדף כט ואילך הוא רשב״ם; בשקלים, קנים, תמיד ומידות אין בכלל ספרי רש״י ותוספות באוצריא.

---

## 9. הרכבה: הפונקציה הראשית

הפונקציה `analyzePdf` מחברת את כל השלבים: מחלצת מילים, מזהה גדלים, בונה את שורות הגמרא, מתייגת את המפרשים, מוסרת את מילות הפתיחה שלהם כאזורים שמורים,
מצרפת לגמרא את סימניה הגדולים, מתאימה טקסטים לכל שכבה, מונעת חפיפות ומחזירה את הבועות.

````ts
export async function analyzePdf(buffer: Uint8Array, input: LayerInput): Promise<DetectionResult> {
  const pdf = await getDocument({ data: buffer, disableWorker: true }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;
  const words = extractWords(content.items as PdfTextItem[], viewport);

  // ---------- Gemara: the dominant body size, as one connected block ----------
  const fonts = detectFonts(words, pageHeight);
  const gemaraFont = fonts.gemara || dominantFont(words, 12.2, 16.2, pageHeight) || 13.68;
  const gemaraWords = words.filter(
    (word) => Math.abs(word.fontSize - gemaraFont) <= GEMARA_TOLERANCE && word.w > 0.6 && word.y > pageHeight * 0.03,
  );
  const gemaraRows = groupRows(gemaraWords, gemaraFont);
  const pitch = estimatePitch(gemaraRows, gemaraFont * 0.87);
  const gemaraClusters = gemaraRows.flatMap((row, index) => splitRow(row, index, gemaraFont * 2.4));
  const gemaraParts = components(gemaraClusters, pitch * 4.5);
  const gemaraMembers: number[] = [];
  if (gemaraParts.length) {
    const main = gemaraParts[0];
    gemaraMembers.push(...main.members);
    for (const part of gemaraParts.slice(1)) {
      const overlap = Math.min(part.maxX, main.maxX) - Math.max(part.minX, main.minX);
      if (part.letters >= 30 && overlap > 20) gemaraMembers.push(...part.members);
    }
  }
  const gemaraLines = buildLines(gemaraClusters, gemaraMembers, pitch, gemaraFont);
  const gemaraBox = gemaraLines.length
    ? {
        minX: Math.min(...gemaraLines.map((line) => line.minX)),
        maxX: Math.max(...gemaraLines.map((line) => line.maxX)),
        minY: gemaraLines[0].top,
        maxY: gemaraLines[gemaraLines.length - 1].bottom,
      }
    : null;

  // ---------- Rashi and Tosafot: the next size down, labelled by their own text ----------
  const commentaryFont = fonts.commentary || dominantFont(words, gemaraFont * 0.6, gemaraFont * 0.93, pageHeight);
  const { fragments: commentaryClusters, pitch: commentaryPitch } = labelCommentary(
    words,
    commentaryFont,
    input,
    pageHeight,
  );

  const columns: { layer: Side; members: number[]; minX: number; maxX: number }[] = [];
  for (const layer of ["rashi", "tosafot"] as const) {
    const members = commentaryClusters.map((_, index) => index).filter((index) => commentaryClusters[index].label === layer);
    const letters = members.reduce((sum, index) => sum + commentaryClusters[index].letters, 0);
    if (members.length < 3 || letters < 90) continue;
    columns.push({
      layer,
      members,
      minX: Math.min(...members.map((index) => commentaryClusters[index].minX)),
      maxX: Math.max(...members.map((index) => commentaryClusters[index].maxX)),
    });
  }
  const columnStreams = columns.map((column) =>
    buildStream(buildLines(commentaryClusters, column.members, commentaryPitch, commentaryFont || 11.2)),
  );

  // Gemara markers come last: a big glyph standing inside a commentary line is that commentary's opening word.
  const reserved = commentaryClusters
    .filter((cluster) => cluster.label)
    .map((cluster) => ({
      minX: cluster.minX,
      maxX: cluster.maxX,
      minY: cluster.baseline - (commentaryFont || 11.2),
      maxY: cluster.baseline + 1,
    }));
  attachMarkers(words, gemaraLines, gemaraFont, pitch, pageHeight, reserved);
  const gemaraStream = buildStream(gemaraLines);

  // ---------- Bubbles per layer ----------
  const gemara = buildLayerBubbles(gemaraStream, "gemara", input.gemara, "gemara");
  const allDrafts: Draft[] = [...gemara.drafts];
  const sides: DetectionStats["sides"] = { rashi: null, tosafot: null };
  const layerCounts: Record<LayerKind, number> = { gemara: gemara.drafts.length, rashi: 0, tosafot: 0 };
  let matched = gemara.matched;
  let filled = gemara.filled;

  columnStreams.forEach((stream, index) => {
    const column = columns[index];
    const layer = column.layer;
    const segments = layer === "rashi" ? input.rashi : input.tosafot;
    const built = buildLayerBubbles(stream, layer, segments, layer, false);
    allDrafts.push(...built.drafts);
    layerCounts[layer] = built.drafts.length;
    matched += built.matched;
    filled += built.filled;
    const centers = column.members.map((member) => (commentaryClusters[member].minX + commentaryClusters[member].maxX) / 2);
    sides[layer] = median(centers) > pageWidth / 2 ? "right" : "left";
  });

  const gemaraRects = gemara.drafts.flatMap((draft) => draft.rects);
  const commentaryRects = allDrafts.filter((draft) => draft.bubble.layer !== "gemara").flatMap((draft) => draft.rects);
  let collisions = clipAgainst(commentaryRects, gemaraRects);
  separateWithinLayer(allDrafts.flatMap((draft) => draft.rects));

  allDrafts.sort((a, b) => a.order - b.order);
  collisions += resolveOverlaps(
    allDrafts.flatMap((draft, owner) => draft.rects.map((item) => ({ layer: item.layer, owner, rect: item.rect }))),
  );
  const bubbles: Bubble[] = allDrafts
    .map((draft) => ({
      ...draft.bubble,
      rects: draft.rects
        .filter((item) => item.rect.w > 7 && item.rect.h > 3.5)
        .map((item) => ({
          x: round(item.rect.x),
          y: round(item.rect.y),
          w: round(item.rect.w),
          h: round(item.rect.h),
        })),
    }))
    .filter((bubble) => bubble.rects.length);

  const bodyLines = gemaraLines.filter((line) => !line.marker);
  const widths = bodyLines.map((line) => line.maxX - line.minX);
  const typicalWidth = median(widths);
  return {
    pageWidth: round(pageWidth),
    pageHeight: round(pageHeight),
    bubbles,
    stats: {
      gemaraFont: round(gemaraFont),
      commentaryFont: round(commentaryFont),
      pitch: round(pitch),
      column: gemaraBox
        ? {
            minX: round(gemaraBox.minX),
            maxX: round(gemaraBox.maxX),
            minY: round(gemaraBox.minY),
            maxY: round(gemaraBox.maxY),
          }
        : null,
      segments: input.gemara.length + input.rashi.length + input.tosafot.length,
      matched,
      filled,
      gemaraWords: gemaraLines.reduce((sum, line) => sum + line.words.length, 0),
      lines: bodyLines.length,
      wideLines: widths.filter((width) => width > typicalWidth * 1.25).length,
      layers: layerCounts,
      sides,
      collisions,
      method: "גודל פונט לכל שכבה, רצף שורות, והתאמה לטקסט של אוצריא",
    },
  };
}
````

---

## 10. מפרשים על כל שכבה

בלחיצה על בועה נשלחת בקשה ל־`/api/commentaries` עם מזהה הספר ומספר השורה של הקטע.
לכל בועה יש `bookId` ו־`lineIndex` משלה, ולכן אותה פעולה עובדת לגמרא, לרש״י ולתוספות:

* **בועת גמרא** — כל המפרשים על הקטע (רש״י, תוספות, מהרש״א, ריטב״א, פני יהושע ועוד), ממוינים לפי חשיבות.
* **בועת תוספות** — המפרשים שאוצריא מקשר אליה (למשל מהרש״א ופסקי תוספות), ובראשם **"הגמרא שעליה נאמר"**.
* **בועת רש״י** — אוצריא מקשר לרוב רק את הגמרא שעליה נאמר, והיא מוצגת. אם יש מפרשים נוספים הם יופיעו.

אוצריא מחזיר לכל שורה של רש״י ותוספות קישור חזרה אל הגמרא, ושמו הוא שם המסכת בלבד. הקוד מזהה אותו ומציג אותו בשם "הגמרא שעליה נאמר" בראש הרשימה.

````ts
export async function fetchCommentaries(bookId: number, line: number, baseTitle = ""): Promise<{
  lineText: string;
  commentators: string[];
  items: CommentaryItem[];
}> {
  const response = await fetch(`${ORACLE}/api/books/${bookId}/links?line=${line}`, { cache: "no-store" });
  if (!response.ok) throw new Error("טעינת המפרשים נכשלה");
  const data = (await response.json()) as { dafLabel?: string; links?: RawLink[]; lineText?: string };
  const seen = new Set<string>();
  const items: CommentaryItem[] = [];
  for (const link of data.links || []) {
    if (link.category && link.category !== "COMMENTARY" && link.category !== "LINKER") continue;
    const text = sanitizeCommentaryHtml(link.text || "");
    const plain = stripTags(text);
    if (plain.length < 8) continue;
    const rawName = commentatorName(link.sourceBook || "מפרש");
    // Rashi and Tosafot lines are linked back to the Gemara they explain; that link is named after the tractate only.
    const isBase = Boolean(baseTitle) && keyOf(rawName) === keyOf(baseTitle);
    const commentator = isBase ? BASE_LABEL : rawName;
    const signature = `${keyOf(commentator)}:${plain.slice(0, 180)}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    items.push({
      commentator,
      title: link.sourceBook || commentator,
      dibbur: stripTags(link.dibburHamatchil || "").replace(/^.*על\s+/u, ""),
      text,
    });
  }
  items.sort((a, b) => priority(a.commentator) - priority(b.commentator) || a.commentator.localeCompare(b.commentator, "he"));
  const commentators = [...new Set(items.map((item) => item.commentator))].sort(
    (a, b) => priority(a) - priority(b) || a.localeCompare(b, "he"),
  );
  return {
    lineText: data.dafLabel || data.lineText || plainPreview(items[0]?.dibbur || "", 40),
    commentators,
    items,
  };
}
````

הקוד בממשק שמבקש את המפרשים (מתוך `DafStudio.tsx`):

````ts
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
````

---

## 11. ציור הדף ומטמון

**ציור בשרת.** הדף מצויר לתמונה בשרת (pdf.js + `@napi-rs/canvas`) ונשלח כ־JPEG. כך הדפדפן לא תלוי ב־worker חיצוני, והבועות יושבות על אותה תמונה בדיוק שמהן חושבו הקואורדינטות.
הבועות ממוקמות באחוזים מגודל הדף, ולכן הן נשארות צמודות לתמונה בכל זום.

````ts
export async function renderDafImage(
  apiName: string,
  daf: number,
  amud: "a" | "b",
  scale = 2,
): Promise<Buffer> {
  const key = `${apiName}:${daf}:${amud}@${scale}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;

  const job = (async () => {
    ensureGlobals();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = await fetchPdf(apiName, daf, amud);
    const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const buffer = canvas.toBuffer("image/jpeg", 88);
    if (cache.size >= MAX_ENTRIES) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    cache.set(key, buffer);
    return buffer;
  })();

  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
````

**מטמון.** תוצאת הניתוח נשמרת בזיכרון וגם בטבלת `daf_overlays` ב־PostgreSQL. בכל שינוי בלוגיקה יש להעלות את `ALGO_VERSION`
בראש `detect.ts`; רשומות של גרסה ישנה מתעלמים מהן ומחשבים מחדש. אפשר גם למחוק את המטמון ידנית:

```sql
DELETE FROM daf_overlays;
```

**נתיב הניתוח המלא:**

````ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tractate = getTractate(url.searchParams.get("masechta") || "ברכות");
  if (!tractate) return Response.json({ error: "המסכת לא נמצאה בש״ס" }, { status: 404 });
  const requestedDaf = Number(url.searchParams.get("daf") || tractate.startDaf);
  const requestedAmud = parseAmud(url.searchParams.get("amud"));
  const placed = clampDaf(tractate, requestedDaf, requestedAmud);
  if (!dafExists(tractate, placed.daf, placed.amud)) {
    return Response.json({ error: "הדף הזה אינו קיים במסכת" }, { status: 400 });
  }

  const cached = await readCachedDaf(tractate.name, placed.daf, placed.amud);
  if (cached) {
    await recordVisit(tractate.name, placed.daf, placed.amud);
    return Response.json(cached);
  }

  const load = (bookId: number | null | undefined) =>
    bookId ? fetchSegments(bookId, placed.daf, placed.amud).catch(() => []) : Promise.resolve([]);

  try {
    const [pdf, gemara, rashi, tosafot] = await Promise.all([
      fetchPdf(tractate.apiName, placed.daf, placed.amud),
      load(tractate.bookId),
      load(tractate.rashiBookId),
      load(tractate.tosafotBookId),
    ]);
    const analysis = await analyzePdf(pdf, { gemara, rashi, tosafot });
    const payload: DafPayload = {
      algo: ALGO_VERSION,
      tractate: tractate.name,
      apiName: tractate.apiName,
      daf: placed.daf,
      amud: placed.amud,
      label: dafLabel(placed.daf, placed.amud),
      bookId: tractate.bookId,
      pageWidth: analysis.pageWidth,
      pageHeight: analysis.pageHeight,
      bubbles: analysis.bubbles.map((bubble) => ({
        ...bubble,
        bookId:
          bubble.layer === "gemara"
            ? tractate.bookId
            : bubble.layer === "rashi"
              ? (tractate.rashiBookId ?? null)
              : (tractate.tosafotBookId ?? null),
      })),
      stats: analysis.stats,
    };
    await writeCachedDaf(payload);
    await recordVisit(tractate.name, placed.daf, placed.amud);
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ניתוח הדף נכשל";
    return Response.json({ error: message }, { status: 502 });
  }
}
````

---

## 12. כיול ופתרון תקלות

אם משהו נראה לא נכון, הטבלה הבאה מראה איזה קבוע לשנות. הקבועים נמצאים בראש `src/lib/detect.ts` ובתוך `decideGroup`:

| תסמין | מה לבדוק |
|---|---|
| בועה אחת על שתי עמודות | `MIN_GUTTER` (רווח מינימלי בין עמודות) וגבול הרווח הרחב בתוך `labelCommentary` (`font * 1.6`) |
| רש״י ותוספות מתחלפים | `SPLIT_MARGIN` ו־`MIN_SIDE_VOTES`; בדקו שהטקסטים של אוצריא קיימים ושייכים לדף הנכון |
| שורות גמרא חסרות | `GEMARA_TOLERANCE` ובדיקת `detectFonts` (הסף המוחלט `70` אותיות) |
| דיבור המתחיל של תוספות נבלע בגמרא | תנאי ה־`openers` ב־`labelCommentary` ורשימת `reserved` שמועברת ל־`attachMarkers` |
| בועת גמרא מתחילה באמצע השורה | הצמדת ההתחלה ב־`alignSegment` והסף המרוכך ב־`placeSegments` (`accept`) |
| הרבה בועות "מיקום משוער" ברצף | מעבר השחזור ב־`placeSegments`; לרוב עוגן אחד שגוי |
| רש״י נעצר באמצע העמוד | שלב ה (הפצה כלפי מטה) ב־`labelCommentary` |
| קטע לא הותאם | `MIN_COVERAGE`; יתכן שהנוסח באוצריא שונה מאוד מהמודפס |
| בועות הגמרא חוצות את רש״י | `clipAgainst` ו־`resolveOverlaps` |
| כותרת שוליים מסומנת כמפרש | טווח ה־x שמחושב בתחילת `labelCommentary` |

**שיטת בדיקה מומלצת.** לצייר את המלבנים על תמונת הדף בצבעים לפי שכבה (גמרא באדום, רש״י בכחול, תוספות בירוק)
ולהסתכל. שיטה זו חשפה את כל הבעיות שתוארו במסמך. אחרי כל שינוי מעלים את `ALGO_VERSION`.

**מגבלות ידועות.**

* הערות השוליים (מסורת הש״ס, עין משפט, תורה אור, גליון הש״ס, הגהות, רבינו חננאל) **אינן מסומנות בכוונה**. הן קטנות, ואין להן טקסט באוצריא בפורמט שמתאים להתאמה.
* ההתאמה תלויה בדמיון בין הנוסח המודפס לנוסח של אוצריא. נוסחים שונים מאוד יתנו כיסוי נמוך ויסומנו כמיקום משוער או לא יסומנו.
* דיבור המתחיל קצר מאוד של רש״י (שתי מילים) לפעמים לא מאושר בהתאמה ומקבל מיקום משוער בין שכניו.
* במסכתות שבהן המפרש המודפס אינו רש״י (נדרים, בבא בתרא מדף כט) אין בועות מפרשים בשכבה הזו.

---

## 13. איך לבנות את זה מחדש מאפס

1. פרויקט Next.js (App Router) עם TypeScript, Tailwind ו־PostgreSQL דרך Drizzle.
2. התקנת החבילות:

```bash
npm install pdfjs-dist @napi-rs/canvas
```

3. ב־`next.config.ts`:

```ts
const nextConfig = { serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"] };
export default nextConfig;
```

4. יצירת הקבצים לפי הסדר: `types.ts`, `hebrew.ts`, `shas.ts`, `otzaria.ts`, `detect.ts`, `render.ts`, `commentaries.ts`, `store.ts` ואז נתיבי ה־API והממשק.
5. הגדרת הטבלאות ב־`src/db/schema.ts` והרצת `npx drizzle-kit push`.
6. בנייה והרצה: `npm run build && npm run start`.

הנקודה החשובה ביותר: **אל תקבעו גדלי אות או מיקומי עמודות מראש.** כל ההחלטות בנויות על יחסים (גדלים יחסיים, רווחים שנמשכים משורות שכנות, ראיות מהטקסט),
ולכן הן עובדות בכל מסכתות הש״ס.

---

## נספח: הקוד המלא של הליבה

### `src/lib/detect.ts`

````ts
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { decodePdfString, normalizeHebrew, plainPreview, stripTags } from "./hebrew";
import type { Bubble, BubbleRect, LayerKind } from "./types";

export const ALGO_VERSION = 8;

const GEMARA_TOLERANCE = 0.16;
const COMMENTARY_LOW = 0.93;
const COMMENTARY_HIGH = 1.1;
const MIN_COVERAGE = 0.68;
const SMALL_GAP = 14;

export type Segment = {
  lineIndex: number;
  text: string;
};

export type LayerInput = {
  gemara: Segment[];
  rashi: Segment[];
  tosafot: Segment[];
};

type RawWord = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
};

type Row = { baseline: number; words: RawWord[] };

type Cluster = {
  row: number;
  baseline: number;
  minX: number;
  maxX: number;
  letters: number;
  words: RawWord[];
};

type Line = {
  top: number;
  bottom: number;
  minX: number;
  maxX: number;
  words: RawWord[];
  marker: boolean;
};

type Component = {
  members: number[];
  letters: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type CharRef = { ch: string; x: number; w: number; line: number };

type Placement = { segment: number; start: number; end: number; score: number };

type RectDraft = { layer: LayerKind; line: number; rect: BubbleRect };

type Draft = { order: number; rects: RectDraft[]; bubble: Omit<Bubble, "rects"> };

type Stream = {
  lines: Line[];
  chars: CharRef[];
  lineStart: number[];
  lineEnd: number[];
  lineText: string[];
  text: string;
};

type PdfTextItem = {
  str?: string;
  transform: number[];
  width?: number;
  height?: number;
};

export type DetectionStats = {
  gemaraFont: number;
  commentaryFont: number;
  pitch: number;
  column: { minX: number; maxX: number; minY: number; maxY: number } | null;
  segments: number;
  matched: number;
  filled: number;
  gemaraWords: number;
  lines: number;
  wideLines: number;
  layers: Record<LayerKind, number>;
  sides: { rashi: "right" | "left" | null; tosafot: "right" | "left" | null };
  collisions: number;
  method: string;
};

export type DetectionResult = {
  pageWidth: number;
  pageHeight: number;
  bubbles: Bubble[];
  stats: DetectionStats;
};

const GLYPH_WIDTH: Record<string, number> = {
  א: 0.62, ב: 0.58, ג: 0.42, ד: 0.55, ה: 0.6, ו: 0.28, ז: 0.32, ח: 0.6, ט: 0.58, י: 0.28,
  כ: 0.53, ך: 0.55, ל: 0.55, מ: 0.6, ם: 0.6, נ: 0.4, ן: 0.28, ס: 0.58, ע: 0.58, פ: 0.58,
  ף: 0.55, צ: 0.55, ץ: 0.55, ק: 0.58, ר: 0.55, ש: 0.68, ת: 0.62,
};

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function letterCount(text: string): number {
  return normalizeHebrew(text).length;
}

function glyphWidth(char: string): number {
  if (char === " ") return 0.3;
  if (GLYPH_WIDTH[char]) return GLYPH_WIDTH[char];
  if (/[\u0591-\u05C7]/.test(char)) return 0;
  return 0.25;
}

function wordToChars(word: RawWord, line: number): CharRef[] {
  const glyphs = [...word.text];
  const weights = glyphs.map(glyphWidth);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let right = word.x + word.w;
  const chars: CharRef[] = [];
  glyphs.forEach((glyph, index) => {
    const width = (weights[index] / total) * word.w;
    const x = right - width;
    right = x;
    const normalized = normalizeHebrew(glyph);
    if (normalized) chars.push({ ch: normalized, x, w: Math.max(width, 0.8), line });
  });
  return chars;
}

function extractWords(
  items: PdfTextItem[],
  viewport: { convertToViewportPoint: (x: number, y: number) => [number, number] },
): RawWord[] {
  const words: RawWord[] = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const fontSize = Math.hypot(item.transform[2] || 0, item.transform[3] || 0) || Math.abs(item.transform[3] || 0);
    const height = item.height || fontSize;
    const width = item.width || 0;
    if (width < 0.4 || height < 0.4) continue;
    const [x, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    words.push({
      text: decodePdfString(item.str).replace(/\s+/g, " ").trim(),
      x,
      y: baseline - height,
      w: width,
      h: height,
      fontSize,
    });
  }
  return words;
}

/** Dominant font size by letter mass inside a range. */
function dominantFont(words: RawWord[], min: number, max: number, pageHeight: number): number {
  const buckets = new Map<number, { weight: number; sizes: number[] }>();
  for (const word of words) {
    if (word.y < pageHeight * 0.03 || word.fontSize < min || word.fontSize > max) continue;
    const letters = letterCount(word.text);
    if (letters < 2) continue;
    const key = Math.round(word.fontSize * 10);
    const bucket = buckets.get(key) || { weight: 0, sizes: [] };
    bucket.weight += letters;
    bucket.sizes.push(word.fontSize);
    buckets.set(key, bucket);
  }
  let best: { weight: number; sizes: number[] } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  return best ? median(best.sizes) : 0;
}

/**
 * Page typography differs between tractates (the Gemara is 13.7pt in Berachot but about 11.8pt in Menachot),
 * so sizes are never hard-coded. Count letters per font size, merge neighbouring sizes, and take the largest
 * size that carries a real share of the text as the Gemara and the next size down as Rashi / Tosafot.
 * Titles, catch-words and chapter openers are too sparse to qualify; margin notes are too small.
 */
function detectFonts(words: RawWord[], pageHeight: number): { gemara: number; commentary: number } {
  const buckets = new Map<number, { mass: number; sizes: number[] }>();
  for (const word of words) {
    if (word.y < pageHeight * 0.03 || word.fontSize < 8.8 || word.fontSize > 18) continue;
    const letters = letterCount(word.text);
    if (letters < 2) continue;
    const key = Math.round(word.fontSize * 10);
    const bucket = buckets.get(key) || { mass: 0, sizes: [] };
    bucket.mass += letters;
    bucket.sizes.push(word.fontSize);
    buckets.set(key, bucket);
  }
  const clusters: { mass: number; sizes: number[] }[] = [];
  let previousKey = -Infinity;
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(key)!;
    const last = clusters[clusters.length - 1];
    if (last && key - previousKey <= 3) {
      last.mass += bucket.mass;
      last.sizes.push(...bucket.sizes);
    } else {
      clusters.push({ mass: bucket.mass, sizes: [...bucket.sizes] });
    }
    previousKey = key;
  }
  if (!clusters.length) return { gemara: 0, commentary: 0 };
  const top = Math.max(...clusters.map((cluster) => cluster.mass));
  const sizes = clusters
    .map((cluster) => ({ size: median(cluster.sizes), mass: cluster.mass }))
    .sort((a, b) => b.size - a.size);
  // Opening pages hold only a few lines of Gemara, so its floor is absolute (about 15 words), not a share of the page.
  const floor = Math.max(70, top * 0.03);
  const gemara = sizes.find((cluster) => cluster.mass >= floor)?.size || 0;
  const commentary = sizes.find((cluster) => cluster.size <= gemara * 0.93 && cluster.mass >= top * 0.12)?.size || 0;
  return { gemara, commentary };
}

function groupRows(words: RawWord[], font: number): Row[] {
  const sorted = [...words].sort((a, b) => a.y + a.h - (b.y + b.h));
  const tolerance = Math.max(2.2, font * 0.28);
  const rows: Row[] = [];
  for (const word of sorted) {
    const baseline = word.y + word.h;
    const row = rows[rows.length - 1];
    if (row && baseline - row.baseline <= tolerance) {
      row.words.push(word);
      row.baseline = row.words.reduce((sum, item) => sum + item.y + item.h, 0) / row.words.length;
    } else {
      rows.push({ baseline, words: [word] });
    }
  }
  return rows;
}

function estimatePitch(rows: Row[], fallback: number): number {
  const gaps: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const gap = rows[index].baseline - rows[index - 1].baseline;
    if (gap > fallback * 0.45 && gap < fallback * 2.4) gaps.push(gap);
  }
  return gaps.length ? median(gaps) : fallback;
}

/** Break a row at wide horizontal gaps so two columns on the same line stay apart. */
function splitRow(row: Row, rowIndex: number, gap: number): Cluster[] {
  const sorted = [...row.words].sort((a, b) => b.x + b.w - (a.x + a.w));
  const clusters: Cluster[] = [];
  let current: RawWord[] = [];
  let left = Infinity;
  const flush = () => {
    if (!current.length) return;
    clusters.push({
      row: rowIndex,
      baseline: row.baseline,
      minX: Math.min(...current.map((word) => word.x)),
      maxX: Math.max(...current.map((word) => word.x + word.w)),
      letters: current.reduce((sum, word) => sum + letterCount(word.text), 0),
      words: current,
    });
    current = [];
    left = Infinity;
  };
  for (const word of sorted) {
    if (current.length && left - (word.x + word.w) > gap) flush();
    current.push(word);
    left = Math.min(left, word.x);
  }
  flush();
  return clusters;
}

/** Connected components: lines that are vertically near and horizontally overlapping form one block. */
function components(clusters: Cluster[], reach: number): Component[] {
  const parent = clusters.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  for (let a = 0; a < clusters.length; a += 1) {
    for (let b = a + 1; b < clusters.length; b += 1) {
      const first = clusters[a];
      const second = clusters[b];
      if (first.row === second.row) continue;
      if (Math.abs(first.baseline - second.baseline) > reach) continue;
      const overlap = Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX);
      if (overlap > -6) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, Component>();
  clusters.forEach((cluster, index) => {
    const root = find(index);
    const group =
      groups.get(root) ||
      ({ members: [], letters: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity } as Component);
    group.members.push(index);
    group.letters += cluster.letters;
    group.minX = Math.min(group.minX, cluster.minX);
    group.maxX = Math.max(group.maxX, cluster.maxX);
    group.minY = Math.min(group.minY, cluster.baseline);
    group.maxY = Math.max(group.maxY, cluster.baseline);
    groups.set(root, group);
  });
  return [...groups.values()].sort((a, b) => b.letters - a.letters);
}

function buildLines(clusters: Cluster[], members: number[], pitch: number, font: number): Line[] {
  const byRow = new Map<number, { words: RawWord[]; baseline: number }>();
  for (const index of members) {
    const cluster = clusters[index];
    const entry = byRow.get(cluster.row) || { words: [], baseline: cluster.baseline };
    entry.words.push(...cluster.words);
    byRow.set(cluster.row, entry);
  }
  const band = Math.max(6, Math.min(pitch - 0.8, font * 0.95));
  const lines: Line[] = [];
  for (const entry of byRow.values()) {
    if (!entry.words.some((word) => letterCount(word.text) > 0)) continue;
    const bottom = entry.baseline + 1.4;
    lines.push({
      top: bottom - band,
      bottom,
      minX: Math.min(...entry.words.map((word) => word.x)),
      maxX: Math.max(...entry.words.map((word) => word.x + word.w)),
      words: entry.words,
      marker: false,
    });
  }
  return lines.sort((a, b) => a.top - b.top);
}

/** Oversized Gemara glyphs: a chapter's opening word, and גמ׳ / מתני׳ markers. */
function attachMarkers(
  words: RawWord[],
  lines: Line[],
  font: number,
  pitch: number,
  pageHeight: number,
  reserved: { minX: number; maxX: number; minY: number; maxY: number }[] = [],
) {
  const body = lines.filter((line) => !line.marker);
  if (!body.length) return;
  const markers = words.filter((word) => {
    if (word.fontSize < font + 1 || word.fontSize > 40 || word.y <= pageHeight * 0.03 || letterCount(word.text) === 0) return false;
    const cx = word.x + word.w / 2;
    const cy = word.y + word.h / 2;
    return !reserved.some((box) => cx >= box.minX - 3 && cx <= box.maxX + 3 && cy >= box.minY - 3 && cy <= box.maxY + 3);
  });
  const added: Line[] = [];
  for (const word of markers) {
    const center = word.x + word.w / 2;
    const base = word.y + word.h;
    let host: Line | null = null;
    let distance = Infinity;
    for (const line of body) {
      const gap = Math.abs(line.bottom - 1.4 - base);
      if (gap <= pitch * 0.9 && center >= line.minX - 8 && center <= line.maxX + 8 && gap < distance) {
        host = line;
        distance = gap;
      }
    }
    if (host) {
      host.words.push(word);
      continue;
    }
    const markerLine: Line = {
      top: base - word.h * 0.8,
      bottom: base + word.h * 0.14,
      minX: word.x,
      maxX: word.x + word.w,
      words: [word],
      marker: true,
    };
    const first = body[0];
    if (base <= first.bottom && base >= first.top - pitch * 4.5 && center >= first.minX - 10 && center <= first.maxX + 10) {
      added.push(markerLine);
      continue;
    }
    const upper = [...body].reverse().find((line) => line.bottom <= word.y + 3);
    const lower = body.find((line) => line.top >= base - 3);
    if (
      upper &&
      lower &&
      lower.top - upper.bottom <= pitch * 5 &&
      center >= upper.minX &&
      center <= upper.maxX &&
      center >= lower.minX &&
      center <= lower.maxX
    ) {
      added.push(markerLine);
    }
  }
  lines.push(...added);
  // A marker line never reaches into its neighbours: clip it to the free band between them.
  for (const marker of added) {
    for (const other of lines) {
      if (other === marker || other.marker) continue;
      if (overlapLength(marker.minX, marker.maxX, other.minX, other.maxX) <= 0) continue;
      if (other.top < marker.top && other.bottom > marker.top && other.bottom + 0.4 < marker.bottom - 6) {
        marker.top = other.bottom + 0.4;
      }
      if (other.top < marker.bottom && other.bottom > marker.bottom && other.top - 0.4 > marker.top + 6) {
        marker.bottom = other.top - 0.4;
      }
    }
  }
  lines.sort((a, b) => a.top - b.top || (a.marker === b.marker ? 0 : a.marker ? -1 : 1));
}

function buildStream(lines: Line[]): Stream {
  const chars: CharRef[] = [];
  const lineStart: number[] = [];
  const lineEnd: number[] = [];
  const lineText: string[] = [];
  lines.forEach((line, index) => {
    const ordered = [...line.words].sort((a, b) => b.x + b.w - (a.x + a.w));
    lineStart[index] = chars.length;
    for (const word of ordered) chars.push(...wordToChars(word, index));
    lineEnd[index] = chars.length - 1;
    lineText[index] = ordered.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
  });
  return { lines, chars, lineStart, lineEnd, lineText, text: chars.map((char) => char.ch).join("") };
}

/** Semi-global edit distance: find where a segment sits inside the page stream. */
function alignSegment(target: string, stream: string, from: number, slack: number) {
  const n = target.length;
  const to = Math.min(stream.length, from + Math.ceil(n * 1.35) + 60 + slack);
  const m = to - from;
  if (n < 3 || m < 3) return null;
  let prevCost = new Int32Array(m + 1);
  let prevStart = new Int32Array(m + 1);
  let prevMatch = new Int32Array(m + 1);
  let curCost = new Int32Array(m + 1);
  let curStart = new Int32Array(m + 1);
  let curMatch = new Int32Array(m + 1);
  for (let j = 0; j <= m; j += 1) prevStart[j] = j;
  for (let i = 1; i <= n; i += 1) {
    const code = target.charCodeAt(i - 1);
    curCost[0] = prevCost[0] + 1;
    curStart[0] = prevStart[0];
    curMatch[0] = prevMatch[0];
    for (let j = 1; j <= m; j += 1) {
      const same = stream.charCodeAt(from + j - 1) === code;
      let cost = prevCost[j - 1] + (same ? 0 : 1);
      let start = prevStart[j - 1];
      let match = prevMatch[j - 1] + (same ? 1 : 0);
      const up = prevCost[j] + 1;
      if (up < cost || (up === cost && prevMatch[j] > match)) {
        cost = up;
        start = prevStart[j];
        match = prevMatch[j];
      }
      const left = curCost[j - 1] + 1;
      if (left < cost || (left === cost && curMatch[j - 1] > match)) {
        cost = left;
        start = curStart[j - 1];
        match = curMatch[j - 1];
      }
      curCost[j] = cost;
      curStart[j] = start;
      curMatch[j] = match;
    }
    [prevCost, curCost] = [curCost, prevCost];
    [prevStart, curStart] = [curStart, prevStart];
    [prevMatch, curMatch] = [curMatch, prevMatch];
  }
  let bestJ = -1;
  let bestCost = Infinity;
  let bestMatch = -1;
  for (let j = 1; j <= m; j += 1) {
    if (prevCost[j] < bestCost || (prevCost[j] === bestCost && prevMatch[j] > bestMatch)) {
      bestCost = prevCost[j];
      bestMatch = prevMatch[j];
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;
  let start = from + prevStart[bestJ];
  // Printed text abbreviates ("דר׳" for "דרבי"), so the cheapest alignment may skip the segment's first letters.
  // The previous segment ended at `from`; if the gap to it is short and the skipped stream text is a prefix of the
  // segment, the segment really starts where the previous one ended.
  const skipped = start - from;
  if (skipped > 0 && skipped <= Math.max(6, Math.floor(n * 0.2))) {
    // Strict: the skipped stream text must read as an in-order prefix of the segment (e.g. "קשיאדר" vs "קשיאדרבי").
    const head = stream.slice(from, start);
    let cursorInTarget = 0;
    let ordered = 0;
    for (const char of head) {
      const at = target.indexOf(char, cursorInTarget);
      if (at >= 0 && at - cursorInTarget <= 2) {
        ordered += 1;
        cursorInTarget = at + 1;
      }
    }
    if (ordered === head.length) start = from;
  }
  return { start, end: from + bestJ, coverage: bestMatch / n };
}

function placeSegments(targets: string[], stream: string): Placement[] {
  const aligned: (Placement | null)[] = targets.map(() => null);
  const accept = (result: ReturnType<typeof alignSegment>, target: string, cursor: number) => {
    if (!result) return false;
    const span = result.end - result.start;
    const tight = result.start - cursor <= 2 && span <= target.length * 1.05 && span >= target.length * 0.5;
    const threshold = tight ? MIN_COVERAGE - 0.12 : MIN_COVERAGE;
    return result.coverage >= threshold && span <= target.length * 1.6 + 10;
  };

  // Forward pass: each segment is searched right after the previous match. If a segment cannot be found there,
  // the search window for the next ones grows by its length (slack), so one missing segment does not stall the rest.
  let cursor = 0;
  let slack = 0;
  targets.forEach((target, index) => {
    if (target.length < 3) return;
    const result = alignSegment(target, stream, cursor, slack);
    if (accept(result, target, cursor) && result) {
      aligned[index] = { segment: index, start: Math.max(result.start, cursor), end: result.end, score: Math.round(result.coverage * 100) / 100 };
      cursor = result.end;
      slack = 0;
    } else {
      slack += target.length;
    }
  });

  // Recovery pass: a wrong anchor squeezes every later segment into too little text. Detect such runs (three or
  // more consecutive misses) and re-align them in the whole free region between the surrounding good anchors.
  for (let index = 0; index < targets.length; ) {
    if (aligned[index] || targets[index].length < 3) {
      index += 1;
      continue;
    }
    let runEnd = index;
    while (runEnd < targets.length && !aligned[runEnd]) runEnd += 1;
    const runLength = runEnd - index;
    if (runLength >= 3) {
      let previous = index - 1;
      while (previous >= 0 && !aligned[previous]) previous -= 1;
      let regionStart = previous >= 0 ? (aligned[previous] as Placement).end : 0;
      const regionEnd = runEnd < targets.length ? (aligned[runEnd] as Placement).start : stream.length;
      // The anchor just before the run is the usual suspect: drop it and let the run re-claim its text.
      const suspect = previous >= 0 ? (aligned[previous] as Placement) : null;
      if (suspect && regionEnd - regionStart < targets.slice(index, runEnd).reduce((sum, t) => sum + t.length, 0) * 0.6) {
        regionStart = suspect.start;
        aligned[previous] = null;
        index = previous;
      }
      let local = regionStart;
      for (let k = index; k < runEnd; k += 1) {
        const target = targets[k];
        if (target.length < 3) continue;
        const room = regionEnd - local;
        if (room < 3) break;
        const result = alignSegment(target, stream.slice(0, regionEnd), local, Math.max(0, room - target.length));
        if (accept(result, target, local) && result) {
          aligned[k] = { segment: k, start: Math.max(result.start, local), end: result.end, score: Math.round(result.coverage * 100) / 100 };
          local = result.end;
        }
      }
    }
    index = Math.max(index + 1, runEnd);
  }

  if (aligned.some(Boolean)) {
    let previousEnd = 0;
    let pending: number[] = [];
    const flush = (nextStart: number) => {
      const span = nextStart - previousEnd;
      if (pending.length && span >= 3) {
        const total = pending.reduce((sum, index) => sum + targets[index].length, 0) || 1;
        let position = previousEnd;
        pending.forEach((index, order) => {
          const share =
            order === pending.length - 1 ? nextStart - position : Math.round((span * targets[index].length) / total);
          const end = Math.min(nextStart, position + share);
          if (end - position >= 3) aligned[index] = { segment: index, start: position, end, score: 0.5 };
          position = end;
        });
      }
      pending = [];
    };
    targets.forEach((target, index) => {
      if (target.length < 3) return;
      const placement = aligned[index];
      if (placement) {
        flush(placement.start);
        previousEnd = placement.end;
      } else {
        pending.push(index);
      }
    });
    flush(stream.length);
  }

  const placed = aligned.filter((item): item is Placement => Boolean(item)).sort((a, b) => a.start - b.start);
  if (placed.length) {
    if (placed[0].start <= SMALL_GAP) placed[0].start = 0;
    const last = placed[placed.length - 1];
    if (stream.length - last.end <= SMALL_GAP) last.end = stream.length;
    for (let index = 1; index < placed.length; index += 1) {
      const gap = placed[index].start - placed[index - 1].end;
      if (gap > 0 && gap <= SMALL_GAP) {
        const middle = placed[index - 1].end + Math.floor(gap / 2);
        placed[index - 1].end = middle;
        placed[index].start = middle;
      }
    }
  }
  return placed;
}

function rectsForRange(stream: Stream, layer: LayerKind, start: number, end: number): RectDraft[] {
  const spans = new Map<number, { minX: number; maxX: number; first: boolean; last: boolean }>();
  for (let index = start; index < end; index += 1) {
    const char = stream.chars[index];
    if (!char) continue;
    const span = spans.get(char.line) || { minX: Infinity, maxX: -Infinity, first: false, last: false };
    span.minX = Math.min(span.minX, char.x);
    span.maxX = Math.max(span.maxX, char.x + char.w);
    if (index === stream.lineStart[char.line]) span.first = true;
    if (index === stream.lineEnd[char.line]) span.last = true;
    spans.set(char.line, span);
  }
  const drafts: RectDraft[] = [];
  for (const [lineIndex, span] of [...spans.entries()].sort((a, b) => a[0] - b[0])) {
    const line = stream.lines[lineIndex];
    const right = span.first ? line.maxX + 2.2 : Math.min(line.maxX + 2.2, span.maxX + 1.8);
    const left = span.last ? line.minX - 2.2 : Math.max(line.minX - 2.2, span.minX - 1.8);
    if (right - left < 4) continue;
    drafts.push({ layer, line: lineIndex, rect: { x: left, y: line.top, w: right - left, h: line.bottom - line.top } });
  }
  return drafts;
}

/** Neighbours on the same line of the same layer meet at a shared edge. */
function separateWithinLayer(drafts: RectDraft[]) {
  const byLine = new Map<string, RectDraft[]>();
  for (const draft of drafts) {
    const key = `${draft.layer}:${draft.line}`;
    const list = byLine.get(key) || [];
    list.push(draft);
    byLine.set(key, list);
  }
  for (const list of byLine.values()) {
    list.sort((a, b) => a.rect.x - b.rect.x);
    for (let index = 1; index < list.length; index += 1) {
      const left = list[index - 1].rect;
      const right = list[index].rect;
      const edge = left.x + left.w;
      if (edge > right.x - 1.2) {
        const middle = (edge + right.x) / 2;
        left.w = Math.max(2, middle - 0.7 - left.x);
        const rightEdge = right.x + right.w;
        right.x = middle + 0.7;
        right.w = Math.max(2, rightEdge - right.x);
      }
    }
  }
}

/** A commentary rect never covers Gemara: it is trimmed back to the free side. */
function clipAgainst(target: RectDraft[], blockers: RectDraft[]): number {
  let clipped = 0;
  for (const draft of target) {
    for (const blocker of blockers) {
      const a = draft.rect;
      const b = blocker.rect;
      const vertical = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (vertical <= Math.min(a.h, b.h) * 0.25) continue;
      const horizontal = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (horizontal <= 0) continue;
      clipped += 1;
      const centerA = a.x + a.w / 2;
      const centerB = b.x + b.w / 2;
      if (centerA <= centerB) {
        const edge = Math.min(a.x + a.w, b.x - 1.2);
        a.w = edge - a.x;
      } else {
        const edge = Math.max(a.x, b.x + b.w + 1.2);
        a.w = a.x + a.w - edge;
        a.x = edge;
      }
    }
  }
  return clipped;
}

/** Final guarantee: no two bubbles share a pixel. Gemara wins over commentary; earlier wins over later. */
function resolveOverlaps(items: { layer: LayerKind; owner: number; rect: BubbleRect }[]): number {
  const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y);
  let fixed = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.rect.y >= a.rect.y + a.rect.h) break;
      if (a.owner === b.owner) continue;
      const vertical = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
      if (vertical <= 0.6) continue;
      const horizontal = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
      if (horizontal <= 0.6) continue;
      fixed += 1;
      const victim =
        a.layer !== b.layer ? (a.layer === "gemara" ? b : a) : a.owner > b.owner ? a : b;
      const keeper = victim === a ? b : a;
      if (victim.rect.x + victim.rect.w / 2 <= keeper.rect.x + keeper.rect.w / 2) {
        const edge = Math.min(victim.rect.x + victim.rect.w, keeper.rect.x - 1.2);
        victim.rect.w = Math.max(0, edge - victim.rect.x);
      } else {
        const edge = Math.max(victim.rect.x, keeper.rect.x + keeper.rect.w + 1.2);
        victim.rect.w = Math.max(0, victim.rect.x + victim.rect.w - edge);
        victim.rect.x = edge;
      }
    }
  }
  return fixed;
}

function buildLayerBubbles(
  stream: Stream,
  layer: LayerKind,
  segments: Segment[],
  idPrefix: string,
  includeLeftovers = true,
): { drafts: Draft[]; matched: number; filled: number } {
  const targets = segments.map((segment) => normalizeHebrew(segment.text));
  const placed = placeSegments(targets, stream.text);
  const covered = new Uint8Array(stream.text.length);
  for (const placement of placed) covered.fill(1, placement.start, placement.end);

  const drafts: Draft[] = [];
  for (const placement of placed) {
    const segment = segments[placement.segment];
    const rects = rectsForRange(stream, layer, placement.start, placement.end);
    if (!rects.length) continue;
    drafts.push({
      order: placement.start,
      rects,
      bubble: {
        id: `${idPrefix}-${segment.lineIndex}`,
        layer,
        lineIndex: segment.lineIndex,
        segmentIndex: placement.segment + 1,
        text: stripTags(segment.text),
        preview: plainPreview(segment.text),
        score: placement.score,
        kind: "segment",
      },
    });
  }

  let leftovers = 0;
  if (includeLeftovers) stream.lines.forEach((_, line) => {
    let runStart = -1;
    for (let index = stream.lineStart[line]; index <= stream.lineEnd[line] + 1; index += 1) {
      const free = index <= stream.lineEnd[line] && !covered[index];
      if (free && runStart < 0) runStart = index;
      if (!free && runStart >= 0) {
        if (index - runStart >= 3) {
          const rects = rectsForRange(stream, layer, runStart, index);
          if (rects.length) {
            leftovers += 1;
            drafts.push({
              order: runStart,
              rects,
              bubble: {
                id: `${idPrefix}-line-${leftovers}`,
                layer,
                lineIndex: null,
                segmentIndex: 0,
                text: stream.lineText[line],
                preview: plainPreview(stream.lineText[line], 80),
                score: 1,
                kind: "line",
              },
            });
          }
        }
        runStart = -1;
      }
    }
  });

  const matched = placed.filter((placement) => placement.score !== 0.5).length;
  return { drafts, matched, filled: placed.length - matched };
}

type Side = "rashi" | "tosafot";

type Fragment = Cluster & { label: Side | null };

type SplitPoint = { index: number; x0: number; x1: number; left: Side; right: Side };

type Group = {
  row: number;
  baseline: number;
  items: RawWord[];
  votes: { r: number; t: number }[];
  split: SplitPoint | null;
  label: Side | null;
};

/** Narrowest empty strip we accept as the gutter between two columns. */
const MIN_GUTTER = 5.5;
/** A split needs real text evidence on both sides. */
const MIN_SIDE_VOTES = 3;
/** The split must beat "the whole line is one commentary" by this many votes. */
const SPLIT_MARGIN = 5;

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function overlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function trigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let index = 0; index + 3 <= value.length; index += 1) set.add(value.slice(index, index + 3));
  return set;
}

/** Trigrams that appear in `source` and nowhere in `other`: the only evidence that actually discriminates. */
function uniqueGrams(source: Set<string>, other: Set<string>): Set<string> {
  const unique = new Set<string>();
  for (const gram of source) if (!other.has(gram)) unique.add(gram);
  return unique;
}

function itemVotes(text: string, onlyRashi: Set<string>, onlyTosafot: Set<string>) {
  const normalized = normalizeHebrew(text);
  let r = 0;
  let t = 0;
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    const gram = normalized.slice(index, index + 3);
    if (onlyRashi.has(gram)) r += 1;
    else if (onlyTosafot.has(gram)) t += 1;
  }
  return { r, t };
}

function support(votes: { r: number; t: number }[], label: Side): number {
  return votes.reduce((sum, vote) => sum + (label === "rashi" ? vote.r - vote.t : vote.t - vote.r), 0);
}

/**
 * One physical line segment (items sorted left to right) holds either one commentary or two side by side.
 * Try every gap as a possible gutter and keep the split with the best textual support.
 */
function decideGroup(items: RawWord[], votes: { r: number; t: number }[]): { split: SplitPoint | null; label: Side | null } {
  const n = items.length;
  const preR = [0];
  const preT = [0];
  const preRight = [-Infinity];
  for (let index = 0; index < n; index += 1) {
    preR.push(preR[index] + votes[index].r);
    preT.push(preT[index] + votes[index].t);
    preRight.push(Math.max(preRight[index], items[index].x + items[index].w));
  }
  const totalR = preR[n];
  const totalT = preT[n];
  const total = totalR + totalT;
  const singleScore = Math.abs(totalR - totalT);

  let best: SplitPoint | null = null;
  let bestScore = -Infinity;
  for (let k = 1; k < n; k += 1) {
    const gap = items[k].x - preRight[k];
    if (gap < MIN_GUTTER) continue;
    const leftR = preR[k];
    const leftT = preT[k];
    const rightR = totalR - leftR;
    const rightT = totalT - leftT;
    if (leftR + leftT < MIN_SIDE_VOTES || rightR + rightT < MIN_SIDE_VOTES) continue;
    const leftDiff = leftR - leftT;
    const rightDiff = rightR - rightT;
    const bonus = 0.35 * Math.min(gap, 16);
    if (leftDiff > 0 && rightDiff < 0) {
      const score = leftDiff - rightDiff + bonus;
      if (score > bestScore) {
        bestScore = score;
        best = { index: k, x0: preRight[k], x1: items[k].x, left: "rashi", right: "tosafot" };
      }
    }
    if (leftDiff < 0 && rightDiff > 0) {
      const score = rightDiff - leftDiff + bonus;
      if (score > bestScore) {
        bestScore = score;
        best = { index: k, x0: preRight[k], x1: items[k].x, left: "tosafot", right: "rashi" };
      }
    }
  }
  if (best && bestScore - singleScore >= SPLIT_MARGIN) return { split: best, label: null };
  if (total >= 4 && singleScore >= Math.max(3, total * 0.5)) {
    return { split: null, label: totalR >= totalT ? "rashi" : "tosafot" };
  }
  return { split: null, label: null };
}

/**
 * Labels every piece of commentary-size text as Rashi, Tosafot, or neither.
 *  1. Keep only text inside the body x-range, which removes margin headings (Masoret HaShas, Hagahot HaBach...).
 *  2. Cut each row at wide gaps (the Gemara channel), then decide each segment by unique-trigram votes.
 *  3. Rows with no clear evidence reuse the gutter position found in neighbouring rows.
 *  4. A fragment with no evidence is labelled only if the same commentary sits right above AND below it.
 */
function labelCommentary(
  words: RawWord[],
  font: number,
  input: LayerInput,
  pageHeight: number,
): { fragments: Fragment[]; pitch: number } {
  if (!font) return { fragments: [], pitch: 10.4 };
  const body = words.filter(
    (word) => Math.abs(word.fontSize - font) <= 0.3 && letterCount(word.text) >= 2 && word.y > pageHeight * 0.03,
  );
  if (!body.length) return { fragments: [], pitch: font * 0.93 };
  const low = percentile(body.map((word) => word.x), 0.01) - 5;
  const high = percentile(body.map((word) => word.x + word.w), 0.99) + 5;
  const sized = words.filter(
    (word) =>
      word.fontSize >= font * COMMENTARY_LOW &&
      word.fontSize <= font * COMMENTARY_HIGH &&
      word.w > 0.6 &&
      word.y > pageHeight * 0.03 &&
      word.x >= low &&
      word.x + word.w <= high,
  );
  // Large opening words ("דיבור המתחיל" of Tosafot) sit on a commentary baseline, inside the column, above the
  // Gemara size. They belong to the commentary line they open, not to the Gemara.
  const openers = words.filter((word) => {
    if (word.fontSize <= font * COMMENTARY_HIGH || word.fontSize > 40) return false;
    // A real opening word, not a "גמ׳" / "מתני׳" marker the printer placed in the margin.
    if (letterCount(word.text) < 3 || /['׳"״]/.test(word.text)) return false;
    if (word.y <= pageHeight * 0.03 || word.x < low || word.x + word.w > high) return false;
    const base = word.y + word.h;
    const sameLine = sized.filter((other) => Math.abs(other.y + other.h - base) <= font * 0.4);
    const continues = sameLine.some(
      (other) => other.x + other.w <= word.x + 2 && word.x - (other.x + other.w) <= font * 1.6,
    );
    // It must be the right-most text of its commentary line: nothing of commentary size to its right nearby.
    const rightNeighbour = sameLine.some(
      (other) => other.x >= word.x + word.w - 2 && other.x - (word.x + word.w) <= font * 1.6,
    );
    return continues && !rightNeighbour;
  });
  const candidates = [...sized, ...openers];
  const rows = groupRows(candidates, font);
  const pitch = estimatePitch(rows, font * 0.93);

  const rashiGrams = trigrams(input.rashi.map((segment) => normalizeHebrew(segment.text)).join(""));
  const tosafotGrams = trigrams(input.tosafot.map((segment) => normalizeHebrew(segment.text)).join(""));
  const onlyRashi = uniqueGrams(rashiGrams, tosafotGrams);
  const onlyTosafot = uniqueGrams(tosafotGrams, rashiGrams);

  const groups: Group[] = [];
  rows.forEach((row, rowIndex) => {
    const sorted = [...row.words].sort((a, b) => a.x - b.x);
    let current: RawWord[] = [];
    let edge = -Infinity;
    const flush = () => {
      if (!current.length) return;
      const votes = current.map((word) => itemVotes(word.text, onlyRashi, onlyTosafot));
      groups.push({ row: rowIndex, baseline: row.baseline, items: current, votes, ...decideGroup(current, votes) });
      current = [];
      edge = -Infinity;
    };
    for (const word of sorted) {
      if (current.length && word.x - edge > font * 1.6) flush();
      current.push(word);
      edge = Math.max(edge, word.x + word.w);
    }
    flush();
  });

  // Pass 2: reuse the gutter seen in nearby rows where this row's own text is too thin to decide.
  const gutters = groups
    .filter((group) => group.split)
    .map((group) => ({ baseline: group.baseline, ...(group.split as SplitPoint) }));
  for (const group of groups) {
    if (group.split || !gutters.length) continue;
    const near = gutters.filter((gutter) => Math.abs(gutter.baseline - group.baseline) <= pitch * 3.2);
    if (!near.length) continue;
    let reach = -Infinity;
    const rights = group.items.map((word) => (reach = Math.max(reach, word.x + word.w)));
    let chosen: SplitPoint | null = null;
    let chosenOverlap = 0;
    for (let k = 1; k < group.items.length; k += 1) {
      const x0 = rights[k - 1];
      const x1 = group.items[k].x;
      if (x1 - x0 < MIN_GUTTER) continue;
      for (const gutter of near) {
        const shared = overlapLength(x0, x1, gutter.x0, gutter.x1);
        if (shared < 4 || shared <= chosenOverlap) continue;
        if (support(group.votes.slice(0, k), gutter.left) < -2) continue;
        if (support(group.votes.slice(k), gutter.right) < -2) continue;
        chosen = { index: k, x0, x1, left: gutter.left, right: gutter.right };
        chosenOverlap = shared;
      }
    }
    if (chosen) {
      group.split = chosen;
      group.label = null;
    }
  }

  const fragments: Fragment[] = [];
  const make = (group: Group, items: RawWord[], label: Side | null): Fragment => ({
    row: group.row,
    baseline: group.baseline,
    minX: Math.min(...items.map((word) => word.x)),
    maxX: Math.max(...items.map((word) => word.x + word.w)),
    letters: items.reduce((sum, word) => sum + letterCount(word.text), 0),
    words: items,
    label,
  });
  for (const group of groups) {
    if (group.split) {
      fragments.push(make(group, group.items.slice(0, group.split.index), group.split.left));
      fragments.push(make(group, group.items.slice(group.split.index), group.split.right));
    } else {
      fragments.push(make(group, group.items, group.label));
    }
  }

  // Pass 3: an unlabelled fragment inside a column takes the label of its labelled neighbours above and below.
  const sameStrip = (a: Fragment, b: Fragment) =>
    overlapLength(a.minX, a.maxX, b.minX, b.maxX) / Math.max(1, Math.min(a.maxX - a.minX, b.maxX - b.minX)) >= 0.6;
  const neighbours = (fragment: Fragment) => {
    let above: Fragment | null = null;
    let below: Fragment | null = null;
    for (const other of fragments) {
      if (other === fragment || !other.label || !sameStrip(fragment, other)) continue;
      const delta = other.baseline - fragment.baseline;
      if (delta < -0.5 && delta >= -pitch * 3.2 && (!above || other.baseline > above.baseline)) above = other;
      if (delta > 0.5 && delta <= pitch * 3.2 && (!below || other.baseline < below.baseline)) below = other;
    }
    return { above, below };
  };
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const fragment of fragments) {
      if (fragment.label) continue;
      const { above, below } = neighbours(fragment);
      if (above && below && above.label === below.label) {
        fragment.label = above.label;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Pass 4: one commentary can outlive the other. Once Tosafot (or Rashi) has ended, the remaining rows of the
  // page belong to the survivor, including the wide strip under the Gemara. Walk down the page: an unlabelled
  // fragment that touches a labelled fragment directly above it, with no opposing label in reach, inherits it.
  const ordered = [...fragments].sort((a, b) => a.baseline - b.baseline);
  const hasOpposing = (fragment: Fragment, label: Side) =>
    fragments.some(
      (other) =>
        other.label &&
        other.label !== label &&
        Math.abs(other.baseline - fragment.baseline) <= pitch * 1.2 &&
        overlapLength(other.minX, other.maxX, fragment.minX, fragment.maxX) > -font * 1.6,
    );
  for (let pass = 0; pass < 40; pass += 1) {
    let changed = false;
    for (const fragment of ordered) {
      if (fragment.label) continue;
      const feeders = fragments.filter((other) => {
        if (!other.label) return false;
        const delta = fragment.baseline - other.baseline;
        if (delta <= 0.5 || delta > pitch * 1.6) return false;
        return overlapLength(other.minX, other.maxX, fragment.minX, fragment.maxX) >= Math.min(20, (fragment.maxX - fragment.minX) * 0.4);
      });
      if (!feeders.length) continue;
      const labels = new Set(feeders.map((other) => other.label));
      if (labels.size !== 1) continue;
      const label = feeders[0].label as Side;
      if (hasOpposing(fragment, label)) continue;
      fragment.label = label;
      changed = true;
    }
    if (!changed) break;
  }
  return { fragments, pitch };
}

export async function analyzePdf(buffer: Uint8Array, input: LayerInput): Promise<DetectionResult> {
  const pdf = await getDocument({ data: buffer, disableWorker: true }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;
  const words = extractWords(content.items as PdfTextItem[], viewport);

  // ---------- Gemara: the dominant body size, as one connected block ----------
  const fonts = detectFonts(words, pageHeight);
  const gemaraFont = fonts.gemara || dominantFont(words, 12.2, 16.2, pageHeight) || 13.68;
  const gemaraWords = words.filter(
    (word) => Math.abs(word.fontSize - gemaraFont) <= GEMARA_TOLERANCE && word.w > 0.6 && word.y > pageHeight * 0.03,
  );
  const gemaraRows = groupRows(gemaraWords, gemaraFont);
  const pitch = estimatePitch(gemaraRows, gemaraFont * 0.87);
  const gemaraClusters = gemaraRows.flatMap((row, index) => splitRow(row, index, gemaraFont * 2.4));
  const gemaraParts = components(gemaraClusters, pitch * 4.5);
  const gemaraMembers: number[] = [];
  if (gemaraParts.length) {
    const main = gemaraParts[0];
    gemaraMembers.push(...main.members);
    for (const part of gemaraParts.slice(1)) {
      const overlap = Math.min(part.maxX, main.maxX) - Math.max(part.minX, main.minX);
      if (part.letters >= 30 && overlap > 20) gemaraMembers.push(...part.members);
    }
  }
  const gemaraLines = buildLines(gemaraClusters, gemaraMembers, pitch, gemaraFont);
  const gemaraBox = gemaraLines.length
    ? {
        minX: Math.min(...gemaraLines.map((line) => line.minX)),
        maxX: Math.max(...gemaraLines.map((line) => line.maxX)),
        minY: gemaraLines[0].top,
        maxY: gemaraLines[gemaraLines.length - 1].bottom,
      }
    : null;

  // ---------- Rashi and Tosafot: the next size down, labelled by their own text ----------
  const commentaryFont = fonts.commentary || dominantFont(words, gemaraFont * 0.6, gemaraFont * 0.93, pageHeight);
  const { fragments: commentaryClusters, pitch: commentaryPitch } = labelCommentary(
    words,
    commentaryFont,
    input,
    pageHeight,
  );

  const columns: { layer: Side; members: number[]; minX: number; maxX: number }[] = [];
  for (const layer of ["rashi", "tosafot"] as const) {
    const members = commentaryClusters.map((_, index) => index).filter((index) => commentaryClusters[index].label === layer);
    const letters = members.reduce((sum, index) => sum + commentaryClusters[index].letters, 0);
    if (members.length < 3 || letters < 90) continue;
    columns.push({
      layer,
      members,
      minX: Math.min(...members.map((index) => commentaryClusters[index].minX)),
      maxX: Math.max(...members.map((index) => commentaryClusters[index].maxX)),
    });
  }
  const columnStreams = columns.map((column) =>
    buildStream(buildLines(commentaryClusters, column.members, commentaryPitch, commentaryFont || 11.2)),
  );

  // Gemara markers come last: a big glyph standing inside a commentary line is that commentary's opening word.
  const reserved = commentaryClusters
    .filter((cluster) => cluster.label)
    .map((cluster) => ({
      minX: cluster.minX,
      maxX: cluster.maxX,
      minY: cluster.baseline - (commentaryFont || 11.2),
      maxY: cluster.baseline + 1,
    }));
  attachMarkers(words, gemaraLines, gemaraFont, pitch, pageHeight, reserved);
  const gemaraStream = buildStream(gemaraLines);

  // ---------- Bubbles per layer ----------
  const gemara = buildLayerBubbles(gemaraStream, "gemara", input.gemara, "gemara");
  const allDrafts: Draft[] = [...gemara.drafts];
  const sides: DetectionStats["sides"] = { rashi: null, tosafot: null };
  const layerCounts: Record<LayerKind, number> = { gemara: gemara.drafts.length, rashi: 0, tosafot: 0 };
  let matched = gemara.matched;
  let filled = gemara.filled;

  columnStreams.forEach((stream, index) => {
    const column = columns[index];
    const layer = column.layer;
    const segments = layer === "rashi" ? input.rashi : input.tosafot;
    const built = buildLayerBubbles(stream, layer, segments, layer, false);
    allDrafts.push(...built.drafts);
    layerCounts[layer] = built.drafts.length;
    matched += built.matched;
    filled += built.filled;
    const centers = column.members.map((member) => (commentaryClusters[member].minX + commentaryClusters[member].maxX) / 2);
    sides[layer] = median(centers) > pageWidth / 2 ? "right" : "left";
  });

  const gemaraRects = gemara.drafts.flatMap((draft) => draft.rects);
  const commentaryRects = allDrafts.filter((draft) => draft.bubble.layer !== "gemara").flatMap((draft) => draft.rects);
  let collisions = clipAgainst(commentaryRects, gemaraRects);
  separateWithinLayer(allDrafts.flatMap((draft) => draft.rects));

  allDrafts.sort((a, b) => a.order - b.order);
  collisions += resolveOverlaps(
    allDrafts.flatMap((draft, owner) => draft.rects.map((item) => ({ layer: item.layer, owner, rect: item.rect }))),
  );
  const bubbles: Bubble[] = allDrafts
    .map((draft) => ({
      ...draft.bubble,
      rects: draft.rects
        .filter((item) => item.rect.w > 7 && item.rect.h > 3.5)
        .map((item) => ({
          x: round(item.rect.x),
          y: round(item.rect.y),
          w: round(item.rect.w),
          h: round(item.rect.h),
        })),
    }))
    .filter((bubble) => bubble.rects.length);

  const bodyLines = gemaraLines.filter((line) => !line.marker);
  const widths = bodyLines.map((line) => line.maxX - line.minX);
  const typicalWidth = median(widths);
  return {
    pageWidth: round(pageWidth),
    pageHeight: round(pageHeight),
    bubbles,
    stats: {
      gemaraFont: round(gemaraFont),
      commentaryFont: round(commentaryFont),
      pitch: round(pitch),
      column: gemaraBox
        ? {
            minX: round(gemaraBox.minX),
            maxX: round(gemaraBox.maxX),
            minY: round(gemaraBox.minY),
            maxY: round(gemaraBox.maxY),
          }
        : null,
      segments: input.gemara.length + input.rashi.length + input.tosafot.length,
      matched,
      filled,
      gemaraWords: gemaraLines.reduce((sum, line) => sum + line.words.length, 0),
      lines: bodyLines.length,
      wideLines: widths.filter((width) => width > typicalWidth * 1.25).length,
      layers: layerCounts,
      sides,
      collisions,
      method: "גודל פונט לכל שכבה, רצף שורות, והתאמה לטקסט של אוצריא",
    },
  };
}
````

### `src/lib/otzaria.ts`

````ts
import { fromHebrewNumber, stripTags } from "./hebrew";
import type { Amud } from "./types";
import type { Segment } from "./detect";

export const ORACLE = "https://otzaria.duckdns.org";

export type TocEntry = { title: string; index: number };

function parseDafTitle(title: string): { daf: number; amud: Amud } | null {
  const match = title.match(/דף\s+([א-ת]{1,4})\s*([.:]|ע[״"']?[אב])?/);
  if (!match) return null;
  const daf = fromHebrewNumber(match[1]);
  if (!daf) return null;
  const marker = match[2] || ".";
  const amud: Amud = marker.includes(":") || marker.includes("ב") ? "b" : "a";
  return { daf, amud };
}

export async function fetchPdf(apiName: string, daf: number, amud: Amud): Promise<Uint8Array> {
  const url = `${ORACLE}/api/tzurat-hadaf/page?masechta=${encodeURIComponent(apiName)}&daf=${daf}&amud=${amud}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`לא נמצא דף PDF (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
    throw new Error("השרת לא החזיר קובץ PDF");
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchToc(bookId: number): Promise<TocEntry[]> {
  const response = await fetch(`${ORACLE}/api/books/${bookId}/toc`, { cache: "no-store" });
  if (!response.ok) throw new Error("טעינת תוכן המסכת נכשלה");
  const data = (await response.json()) as { toc?: TocEntry[] };
  return data.toc || [];
}

export async function fetchSegments(bookId: number, daf: number, amud: Amud): Promise<Segment[]> {
  const toc = await fetchToc(bookId);
  const located = toc
    .map((entry) => ({ ...entry, parsed: parseDafTitle(entry.title) }))
    .filter((entry) => entry.parsed);
  const current = located.find((entry) => entry.parsed?.daf === daf && entry.parsed.amud === amud);
  if (!current) return [];
  const next = located.find((entry) => entry.index > current.index);
  const end = next ? next.index - 1 : current.index + 48;
  const response = await fetch(
    `${ORACLE}/api/books/${bookId}/content?start=${current.index}&end=${end + 5}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("טעינת טקסט הגמרא נכשלה");
  const data = (await response.json()) as { lines?: { lineIndex: number; content: string }[] };
  return (data.lines || [])
    .filter((line) => line.lineIndex >= current.index && line.lineIndex <= end)
    .filter((line) => !/^<h\d/i.test(line.content.trim()))
    .map((line) => ({ lineIndex: line.lineIndex, text: stripTags(line.content) }))
    .filter((line) => line.text.replace(/\s/g, "").length > 1);
}
````

### `src/lib/commentaries.ts`

````ts
import { plainPreview, sanitizeCommentaryHtml, stripTags } from "./hebrew";
import type { CommentaryItem } from "./types";
import { ORACLE } from "./otzaria";

const PRIORITY = [
  "רשי",
  "תוספות",
  "תוספות הראש",
  "תוספות ישנים",
  "רבינו חננאל",
  "ריף",
  "רשב״א",
  "רשבא",
  "ריטבא",
  "רן",
  "ראש",
  "רמבן",
  "מהרשא",
  "מהרם",
  "פני יהושע",
  "שפת אמת",
  "בן יהוידע",
  "מאירי",
  "רשיש",
];

function keyOf(name: string): string {
  return name.replace(/[״"׳'\s]/g, "");
}

function commentatorName(sourceBook: string): string {
  return sourceBook.replace(/\s+על\s+.*/u, "").trim() || sourceBook;
}

export const BASE_LABEL = "הגמרא שעליה נאמר";

function priority(name: string): number {
  if (name === BASE_LABEL) return -1;
  const key = keyOf(name);
  const index = PRIORITY.findIndex((item) => {
    const needle = keyOf(item);
    return key === needle || (key.startsWith(needle) && key.length <= needle.length + 1);
  });
  return index === -1 ? 80 : index;
}

type RawLink = {
  sourceBook?: string;
  category?: string;
  text?: string;
  dibburHamatchil?: string;
  isLineMatch?: boolean;
};

export async function fetchCommentaries(bookId: number, line: number, baseTitle = ""): Promise<{
  lineText: string;
  commentators: string[];
  items: CommentaryItem[];
}> {
  const response = await fetch(`${ORACLE}/api/books/${bookId}/links?line=${line}`, { cache: "no-store" });
  if (!response.ok) throw new Error("טעינת המפרשים נכשלה");
  const data = (await response.json()) as { dafLabel?: string; links?: RawLink[]; lineText?: string };
  const seen = new Set<string>();
  const items: CommentaryItem[] = [];
  for (const link of data.links || []) {
    if (link.category && link.category !== "COMMENTARY" && link.category !== "LINKER") continue;
    const text = sanitizeCommentaryHtml(link.text || "");
    const plain = stripTags(text);
    if (plain.length < 8) continue;
    const rawName = commentatorName(link.sourceBook || "מפרש");
    // Rashi and Tosafot lines are linked back to the Gemara they explain; that link is named after the tractate only.
    const isBase = Boolean(baseTitle) && keyOf(rawName) === keyOf(baseTitle);
    const commentator = isBase ? BASE_LABEL : rawName;
    const signature = `${keyOf(commentator)}:${plain.slice(0, 180)}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    items.push({
      commentator,
      title: link.sourceBook || commentator,
      dibbur: stripTags(link.dibburHamatchil || "").replace(/^.*על\s+/u, ""),
      text,
    });
  }
  items.sort((a, b) => priority(a.commentator) - priority(b.commentator) || a.commentator.localeCompare(b.commentator, "he"));
  const commentators = [...new Set(items.map((item) => item.commentator))].sort(
    (a, b) => priority(a) - priority(b) || a.localeCompare(b, "he"),
  );
  return {
    lineText: data.dafLabel || data.lineText || plainPreview(items[0]?.dibbur || "", 40),
    commentators,
    items,
  };
}
````

### `src/lib/render.ts`

````ts
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { fetchPdf } from "./otzaria";

const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
const MAX_ENTRIES = 24;
let globalsReady = false;

function ensureGlobals() {
  if (globalsReady) return;
  const target = globalThis as Record<string, unknown>;
  target.DOMMatrix = DOMMatrix;
  target.Path2D = Path2D;
  target.ImageData = ImageData;
  globalsReady = true;
}

export async function renderDafImage(
  apiName: string,
  daf: number,
  amud: "a" | "b",
  scale = 2,
): Promise<Buffer> {
  const key = `${apiName}:${daf}:${amud}@${scale}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;

  const job = (async () => {
    ensureGlobals();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = await fetchPdf(apiName, daf, amud);
    const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const buffer = canvas.toBuffer("image/jpeg", 88);
    if (cache.size >= MAX_ENTRIES) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    cache.set(key, buffer);
    return buffer;
  })();

  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
````

### `src/app/api/daf/route.ts`

````ts
import { dafLabel, parseAmud } from "@/lib/hebrew";
import { ALGO_VERSION, analyzePdf } from "@/lib/detect";
import { fetchPdf, fetchSegments } from "@/lib/otzaria";
import { clampDaf, dafExists, getTractate } from "@/lib/shas";
import { readCachedDaf, recordVisit, writeCachedDaf } from "@/lib/store";
import type { DafPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tractate = getTractate(url.searchParams.get("masechta") || "ברכות");
  if (!tractate) return Response.json({ error: "המסכת לא נמצאה בש״ס" }, { status: 404 });
  const requestedDaf = Number(url.searchParams.get("daf") || tractate.startDaf);
  const requestedAmud = parseAmud(url.searchParams.get("amud"));
  const placed = clampDaf(tractate, requestedDaf, requestedAmud);
  if (!dafExists(tractate, placed.daf, placed.amud)) {
    return Response.json({ error: "הדף הזה אינו קיים במסכת" }, { status: 400 });
  }

  const cached = await readCachedDaf(tractate.name, placed.daf, placed.amud);
  if (cached) {
    await recordVisit(tractate.name, placed.daf, placed.amud);
    return Response.json(cached);
  }

  const load = (bookId: number | null | undefined) =>
    bookId ? fetchSegments(bookId, placed.daf, placed.amud).catch(() => []) : Promise.resolve([]);

  try {
    const [pdf, gemara, rashi, tosafot] = await Promise.all([
      fetchPdf(tractate.apiName, placed.daf, placed.amud),
      load(tractate.bookId),
      load(tractate.rashiBookId),
      load(tractate.tosafotBookId),
    ]);
    const analysis = await analyzePdf(pdf, { gemara, rashi, tosafot });
    const payload: DafPayload = {
      algo: ALGO_VERSION,
      tractate: tractate.name,
      apiName: tractate.apiName,
      daf: placed.daf,
      amud: placed.amud,
      label: dafLabel(placed.daf, placed.amud),
      bookId: tractate.bookId,
      pageWidth: analysis.pageWidth,
      pageHeight: analysis.pageHeight,
      bubbles: analysis.bubbles.map((bubble) => ({
        ...bubble,
        bookId:
          bubble.layer === "gemara"
            ? tractate.bookId
            : bubble.layer === "rashi"
              ? (tractate.rashiBookId ?? null)
              : (tractate.tosafotBookId ?? null),
      })),
      stats: analysis.stats,
    };
    await writeCachedDaf(payload);
    await recordVisit(tractate.name, placed.daf, placed.amud);
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ניתוח הדף נכשל";
    return Response.json({ error: message }, { status: 502 });
  }
}
````

### `src/app/api/commentaries/route.ts`

````ts
import { fetchCommentaries } from "@/lib/commentaries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bookId = Number(url.searchParams.get("bookId"));
  const line = Number(url.searchParams.get("line"));
  if (!Number.isFinite(bookId) || !Number.isFinite(line) || bookId <= 0 || line <= 0) {
    return Response.json({ error: "חסרים פרטי הקטע" }, { status: 400 });
  }
  try {
    const result = await fetchCommentaries(bookId, line, url.searchParams.get("base") || "");
    return Response.json({ bookId, line, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "טעינת המפרשים נכשלה";
    return Response.json({ error: message }, { status: 502 });
  }
}
````


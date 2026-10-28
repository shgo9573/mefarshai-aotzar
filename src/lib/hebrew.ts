const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];

const FINALS: Record<string, string> = {
  ך: "כ",
  ם: "מ",
  ן: "נ",
  ף: "פ",
  ץ: "צ",
};

const MAC_HEBREW: Record<string, string> = {
  "‡": "א",
  "·": "ב",
  "‚": "ג",
  "„": "ד",
  "‰": "ה",
  Â: "ו",
  Ê: "ז",
  Á: "ח",
  Ë: "ט",
  È: "י",
  Í: "ך",
  Î: "כ",
  Ï: "ל",
  Ì: "ם",
  Ó: "מ",
  Ô: "ן",
  Ò: "ס",
  Ú: "ע",
  Û: "ף",
  Ù: "פ",
  ı: "ץ",
  "ˆ": "צ",
  "˜": "ק",
  "¯": "ר",
  "˘": "ש",
  "˙": "ת",
  "": "נ",
  ð: "נ",
  "\u0002": "נ",
  "\u0005": "נ",
  "\u0008": "נ",
  "\u000b": "נ",
  "\u000e": "נ",
  "\u000f": "נ",
};

const LATIN1_HEBREW: Record<string, string> = {
  à: "א",
  á: "ב",
  â: "ג",
  ã: "ד",
  ä: "ה",
  å: "ו",
  æ: "ז",
  ç: "ח",
  è: "ט",
  é: "י",
  ê: "ך",
  ë: "כ",
  ì: "ל",
  í: "ם",
  î: "מ",
  ï: "ן",
  ð: "נ",
  ñ: "ס",
  ò: "ע",
  ó: "ף",
  ô: "פ",
  õ: "ץ",
  ö: "צ",
  "÷": "ק",
  ø: "ר",
  ù: "ש",
  ú: "ת",
};

const HEBREW_RE = /[\u05D0-\u05EA]/;

export function toHebrewNumber(value: number): string {
  if (value <= 0) return String(value);
  const hundreds = Math.floor(value / 100);
  let rest = value % 100;
  let result = HUNDREDS[hundreds] || "";
  if (rest === 15) return result + "טו";
  if (rest === 16) return result + "טז";
  result += TENS[Math.floor(rest / 10)] || "";
  rest %= 10;
  result += ONES[rest] || "";
  return result || String(value);
}

export function fromHebrewNumber(value: string): number {
  const clean = value.replace(/[^\u05D0-\u05EA]/g, "");
  if (!clean) return 0;
  if (clean === "טו") return 15;
  if (clean === "טז") return 16;
  const values: Record<string, number> = {
    א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9,
    י: 10, כ: 20, ל: 30, מ: 40, נ: 50, ס: 60, ע: 70, פ: 80, צ: 90,
    ק: 100, ר: 200, ש: 300, ת: 400,
  };
  return [...clean].reduce((sum, char) => sum + (values[char] || 0), 0);
}

export function dafLabel(daf: number, amud: "a" | "b"): string {
  return `דף ${toHebrewNumber(daf)} ע״${amud === "a" ? "א" : "ב"}`;
}

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

export function stripTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function normalizeHebrew(value: string): string {
  const stripped = stripTags(value)
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״"׳'`´„“”]/g, "")
    .replace(/[.,:;!?()[\]{}<>\-–—־/\\|]/g, "")
    .replace(/\s+/g, "");
  return [...stripped].map((char) => FINALS[char] || char).filter((char) => HEBREW_RE.test(char)).join("");
}

export function sanitizeCommentaryHtml(value: string): string {
  const withBreaks = value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(b|strong)[^>]*>/gi, "<strong>")
    .replace(/<\/(b|strong)>/gi, "</strong>")
    .replace(/<(i|em)[^>]*>/gi, "<em>")
    .replace(/<\/(i|em)>/gi, "</em>")
    .replace(/<br\s*\/?>/gi, "<br>")
    .replace(/<\/?p[^>]*>/gi, "<br>");
  return withBreaks
    .replace(/<(?!\/?(strong|em|br)\b)[^>]*>/gi, "")
    .replace(/<(strong|em)>\s*<\/\1>/gi, "")
    .replace(/<(strong|em)>\s*<\/\1>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/(<br>\s*){3,}/g, "<br><br>")
    .trim();
}

export function plainPreview(value: string, limit = 92): string {
  const plain = stripTags(value).replace(/\s+/g, " ");
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

export function parseAmud(value: string | null | undefined): "a" | "b" {
  const clean = (value || "a").trim().toLowerCase();
  if (["b", "2", "bet", "ב", "עב", "בת"].includes(clean)) return "b";
  return "a";
}

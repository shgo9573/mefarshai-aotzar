import type { Amud } from "./types";

export type Tractate = {
  name: string;
  apiName: string;
  seder: string;
  bookId: number | null;
  rashiBookId?: number;
  tosafotBookId?: number;
  startDaf: number;
  endDaf: number;
  endAmud: Amud;
  startAmud?: Amud;
  sefaria?: string;
  note?: string;
};

export const SEDER_ORDER = ["זרעים", "מועד", "נשים", "נזיקין", "קדשים", "טהרות"] as const;

export const TRACTATES: Tractate[] = [
  { name: "ברכות", apiName: "ברכות", seder: "זרעים", bookId: 103, startDaf: 2, endDaf: 64, endAmud: "a", sefaria: "Berakhot", rashiBookId: 2182, tosafotBookId: 1927 },
  { name: "שבת", apiName: "שבת", seder: "מועד", bookId: 104, startDaf: 2, endDaf: 157, endAmud: "b", sefaria: "Shabbat", rashiBookId: 2156, tosafotBookId: 1907 },
  { name: "עירובין", apiName: "עירובין", seder: "מועד", bookId: 105, startDaf: 2, endDaf: 105, endAmud: "a", sefaria: "Eruvin", rashiBookId: 2166, tosafotBookId: 1911 },
  { name: "פסחים", apiName: "פסחים", seder: "מועד", bookId: 106, startDaf: 2, endDaf: 121, endAmud: "b", sefaria: "Pesachim", rashiBookId: 2162, tosafotBookId: 1905 },
  { name: "שקלים", apiName: "שקלים", seder: "מועד", bookId: null, startDaf: 2, endDaf: 22, endAmud: "b", note: "שקלים בדפוס וילנא הוא ירושלמי. הבועות לפי שורות הגמרא בדף." },
  { name: "יומא", apiName: "יומא", seder: "מועד", bookId: 107, startDaf: 2, endDaf: 88, endAmud: "a", sefaria: "Yoma", rashiBookId: 2157, tosafotBookId: 1908 },
  { name: "סוכה", apiName: "סוכה", seder: "מועד", bookId: 108, startDaf: 2, endDaf: 56, endAmud: "b", sefaria: "Sukkah", rashiBookId: 2163, tosafotBookId: 1903 },
  { name: "ביצה", apiName: "ביצה", seder: "מועד", bookId: 109, startDaf: 2, endDaf: 40, endAmud: "b", sefaria: "Beitzah", rashiBookId: 2160, tosafotBookId: 1910 },
  { name: "ראש השנה", apiName: "ראש השנה", seder: "מועד", bookId: 110, startDaf: 2, endDaf: 35, endAmud: "a", sefaria: "Rosh_Hashanah", rashiBookId: 2158, tosafotBookId: 1904 },
  { name: "תענית", apiName: "תענית", seder: "מועד", bookId: 111, startDaf: 2, endDaf: 31, endAmud: "a", sefaria: "Taanit", rashiBookId: 2165, tosafotBookId: 1909 },
  { name: "מגילה", apiName: "מגילה", seder: "מועד", bookId: 112, startDaf: 2, endDaf: 32, endAmud: "a", sefaria: "Megillah", rashiBookId: 2159, tosafotBookId: 1902 },
  { name: "מועד קטן", apiName: "מועד קטן", seder: "מועד", bookId: 113, startDaf: 2, endDaf: 29, endAmud: "a", sefaria: "Moed_Katan", rashiBookId: 2164, tosafotBookId: 1901 },
  { name: "חגיגה", apiName: "חגיגה", seder: "מועד", bookId: 114, startDaf: 2, endDaf: 27, endAmud: "a", sefaria: "Chagigah", rashiBookId: 2161, tosafotBookId: 1906 },
  { name: "יבמות", apiName: "יבמות", seder: "נשים", bookId: 115, startDaf: 2, endDaf: 122, endAmud: "a", sefaria: "Yevamot", rashiBookId: 2167, tosafotBookId: 1918 },
  { name: "כתובות", apiName: "כתובות", seder: "נשים", bookId: 116, startDaf: 2, endDaf: 112, endAmud: "b", sefaria: "Ketubot", rashiBookId: 2168, tosafotBookId: 1914 },
  { name: "נדרים", apiName: "נדרים", seder: "נשים", bookId: 117, startDaf: 2, endDaf: 91, endAmud: "b", sefaria: "Nedarim", rashiBookId: 2170, tosafotBookId: 1915 },
  { name: "נזיר", apiName: "נזיר", seder: "נשים", bookId: 118, startDaf: 2, endDaf: 66, endAmud: "b", sefaria: "Nazir", rashiBookId: 2171, tosafotBookId: 1913 },
  { name: "סוטה", apiName: "סוטה", seder: "נשים", bookId: 119, startDaf: 2, endDaf: 49, endAmud: "b", sefaria: "Sotah", rashiBookId: 2172, tosafotBookId: 1912 },
  { name: "גיטין", apiName: "גיטין", seder: "נשים", bookId: 120, startDaf: 2, endDaf: 90, endAmud: "b", sefaria: "Gittin", rashiBookId: 2169, tosafotBookId: 1917 },
  { name: "קידושין", apiName: "קידושין", seder: "נשים", bookId: 121, startDaf: 2, endDaf: 82, endAmud: "b", sefaria: "Kiddushin", rashiBookId: 2173, tosafotBookId: 1916 },
  { name: "בבא קמא", apiName: "בבא קמא", seder: "נזיקין", bookId: 122, startDaf: 2, endDaf: 119, endAmud: "b", sefaria: "Bava_Kamma", rashiBookId: 2177, tosafotBookId: 1925 },
  { name: "בבא מציעא", apiName: "בבא מציעא", seder: "נזיקין", bookId: 123, startDaf: 2, endDaf: 119, endAmud: "a", sefaria: "Bava_Metzia", rashiBookId: 2181, tosafotBookId: 1920 },
  { name: "בבא בתרא", apiName: "בבא בתרא", seder: "נזיקין", bookId: 124, startDaf: 2, endDaf: 176, endAmud: "b", sefaria: "Bava_Batra", rashiBookId: 2178, tosafotBookId: 1923 },
  { name: "סנהדרין", apiName: "סנהדרין", seder: "נזיקין", bookId: 125, startDaf: 2, endDaf: 113, endAmud: "b", sefaria: "Sanhedrin", rashiBookId: 2180, tosafotBookId: 1921 },
  { name: "מכות", apiName: "מכות", seder: "נזיקין", bookId: 126, startDaf: 2, endDaf: 24, endAmud: "b", sefaria: "Makkot", rashiBookId: 2176, tosafotBookId: 1922 },
  { name: "שבועות", apiName: "שבועות", seder: "נזיקין", bookId: 127, startDaf: 2, endDaf: 49, endAmud: "b", sefaria: "Shevuot", rashiBookId: 2174, tosafotBookId: 1926 },
  { name: "עבודה זרה", apiName: "עבודה זרה", seder: "נזיקין", bookId: 128, startDaf: 2, endDaf: 76, endAmud: "b", sefaria: "Avodah_Zarah", rashiBookId: 2175, tosafotBookId: 1919 },
  { name: "הוריות", apiName: "הוריות", seder: "נזיקין", bookId: 129, startDaf: 2, endDaf: 14, endAmud: "a", sefaria: "Horayot", rashiBookId: 2179, tosafotBookId: 1924 },
  { name: "זבחים", apiName: "זבחים", seder: "קדשים", bookId: 130, startDaf: 2, endDaf: 120, endAmud: "b", sefaria: "Zevachim", rashiBookId: 2191, tosafotBookId: 1936 },
  { name: "מנחות", apiName: "מנחות", seder: "קדשים", bookId: 131, startDaf: 2, endDaf: 110, endAmud: "a", sefaria: "Menachot", rashiBookId: 2186, tosafotBookId: 1933 },
  { name: "חולין", apiName: "חולין", seder: "קדשים", bookId: 132, startDaf: 2, endDaf: 142, endAmud: "a", sefaria: "Chullin", rashiBookId: 2184, tosafotBookId: 1935 },
  { name: "בכורות", apiName: "בכורות", seder: "קדשים", bookId: 133, startDaf: 2, endDaf: 61, endAmud: "a", sefaria: "Bekhorot", rashiBookId: 2188, tosafotBookId: 1929 },
  { name: "ערכין", apiName: "ערכין", seder: "קדשים", bookId: 134, startDaf: 2, endDaf: 34, endAmud: "a", sefaria: "Arakhin", rashiBookId: 2190, tosafotBookId: 1930 },
  { name: "תמורה", apiName: "תמורה", seder: "קדשים", bookId: 135, startDaf: 2, endDaf: 34, endAmud: "a", sefaria: "Temurah", rashiBookId: 2185, tosafotBookId: 1932 },
  { name: "כריתות", apiName: "כריתות", seder: "קדשים", bookId: 136, startDaf: 2, endDaf: 28, endAmud: "b", sefaria: "Keritot", rashiBookId: 2189, tosafotBookId: 1934 },
  { name: "מעילה", apiName: "מעילה", seder: "קדשים", bookId: 137, startDaf: 2, endDaf: 22, endAmud: "a", sefaria: "Meilah", rashiBookId: 2187, tosafotBookId: 1931 },
  { name: "קנים", apiName: "קנים", seder: "קדשים", bookId: null, startDaf: 23, endDaf: 25, endAmud: "a", note: "קנים נדפס בסוף מעילה. הבועות לפי שורות המרכז." },
  { name: "תמיד", apiName: "תמיד", seder: "קדשים", bookId: 138, startDaf: 25, endDaf: 33, endAmud: "b", startAmud: "b", sefaria: "Tamid" },
  { name: "מידות", apiName: "מידות", seder: "קדשים", bookId: null, startDaf: 34, endDaf: 37, endAmud: "b", note: "מידות נדפסות אחרי תמיד. הבועות לפי שורות המרכז." },
  { name: "נדה", apiName: "נדה", seder: "טהרות", bookId: 139, startDaf: 2, endDaf: 73, endAmud: "a", sefaria: "Niddah", rashiBookId: 2183, tosafotBookId: 1928 },
];

const ALIASES: Record<string, string> = {
  נידה: "נדה",
  נדה: "נדה",
  מדות: "מידות",
  מידות: "מידות",
  קינים: "קנים",
  קנים: "קנים",
  "בבא מציעא": "בבא מציעא",
  "בבא מציאה": "בבא מציעא",
  בבאמציעא: "בבא מציעא",
};

export function getTractate(name: string | null | undefined): Tractate | null {
  if (!name) return null;
  const clean = name.replace(/[״"׳']/g, "").replace(/\s+/g, " ").trim();
  const alias = ALIASES[clean] || ALIASES[name.trim()] || name.trim();
  return (
    TRACTATES.find((tractate) => tractate.name === alias || tractate.apiName === alias || tractate.name === name.trim()) ||
    null
  );
}

export function dafExists(tractate: Tractate, daf: number, amud: Amud): boolean {
  if (daf < tractate.startDaf || daf > tractate.endDaf) return false;
  if (daf === tractate.startDaf && tractate.startAmud === "b" && amud === "a") return false;
  if (daf === tractate.endDaf && tractate.endAmud === "a" && amud === "b") return false;
  return true;
}

export function clampDaf(tractate: Tractate, daf: number, amud: Amud): { daf: number; amud: Amud } {
  let nextDaf = Math.min(tractate.endDaf, Math.max(tractate.startDaf, daf));
  let nextAmud = amud;
  if (!dafExists(tractate, nextDaf, nextAmud)) {
    nextAmud = nextDaf === tractate.startDaf && tractate.startAmud === "b" ? "b" : "a";
    if (!dafExists(tractate, nextDaf, nextAmud)) nextAmud = tractate.endAmud;
  }
  return { daf: nextDaf, amud: nextAmud };
}

export function stepDaf(tractate: Tractate, daf: number, amud: Amud, direction: 1 | -1): { daf: number; amud: Amud } | null {
  if (direction === 1) {
    if (amud === "a" && dafExists(tractate, daf, "b")) return { daf, amud: "b" };
    if (dafExists(tractate, daf + 1, tractate.startAmud === "b" && daf + 1 === tractate.startDaf ? "b" : "a")) {
      const nextAmud: Amud = dafExists(tractate, daf + 1, "a") ? "a" : "b";
      return { daf: daf + 1, amud: nextAmud };
    }
    return null;
  }
  if (amud === "b" && dafExists(tractate, daf, "a")) return { daf, amud: "a" };
  const prev = daf - 1;
  if (prev < tractate.startDaf) return null;
  const prevAmud: Amud = dafExists(tractate, prev, "b") ? "b" : "a";
  return dafExists(tractate, prev, prevAmud) ? { daf: prev, amud: prevAmud } : null;
}

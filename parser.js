/*
 * Freight Mail Parser – wersja demonstracyjna (działa w całości w przeglądarce).
 *
 * Parser oparty na regułach (wyrażeniach regularnych): bez AI, bez serwera
 * i bez wysyłania danych. Treść maila jest analizowana lokalnie.
 *
 * Najważniejsza funkcja: FreightParser.parseEmail(text, today?)
 */
(function (root) {
  "use strict";

  // -------------------------------------------------------------------------
  // Pomocnik: wzorce piszemy w składni Pythona, a ta funkcja zamienia je na
  // JavaScript. W JS "\b" i "\w" nie znają polskich liter (ą, ł, ż…), więc
  // zastępujemy je odpowiednikami opartymi na Unicode.
  // -------------------------------------------------------------------------
  const W = "[\\p{L}\\p{N}_]";
  const NW = "[^\\p{L}\\p{N}_]";
  const BOUND = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

  function py(src) {
    src = src.split("[^\\W\\d_]").join("\\p{L}");
    let out = "";
    let inClass = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "\\") {
        const e = src.slice(i, i + 2);
        i++;
        if (inClass) out += e === "\\w" ? "\\p{L}\\p{N}_" : e;
        else out += e === "\\b" ? BOUND : e === "\\w" ? W : e === "\\W" ? NW : e;
      } else if (!inClass && src.startsWith("(?P<", i)) {
        out += "(?<";
        i += 3;
      } else if (!inClass && src.startsWith("(?P=", i)) {
        const end = src.indexOf(")", i);
        out += "\\k<" + src.slice(i + 4, end) + ">";
        i = end;
      } else {
        if (c === "[" && !inClass) inClass = true;
        else if (c === "]" && inClass) inClass = false;
        out += c;
      }
    }
    return out;
  }

  const rx = (src, flags = "") => new RegExp(py(src), flags + "u");
  const alt = (words) => words.join("|");
  // Wielkość liter bez znaczenia tylko dla jednego słowa: "from" -> [fF][rR][oO][mM]
  const ci = (word) => [...word].map((ch) => `[${ch.toLowerCase()}${ch.toUpperCase()}]`).join("");

  // -------------------------------------------------------------------------
  // Słowniki: słowa kluczowe, kraje, miesiące, kategorie ładunku
  // -------------------------------------------------------------------------
  const D = {
    LOADING_WORDS: [
      "za[łl]adun\\w*", "odbi[óo]r\\w*", "loading(?!\\s*met)", "pick[\\s-]?up", "collection",
      "belad\\w*", "abhol\\w*", "ladestelle", "ladeort", "ladedatum", "ladetermin",
    ],
    UNLOADING_WORDS: [
      "roz[łl]adun\\w*", "dostaw\\w*", "unloading", "delivery", "drop[\\s-]?off", "destination",
      "entlad\\w*", "zustell\\w*", "liefer\\w*",
    ],
    ROUTE_WORDS: ["trasa", "relacj\\w*", "route", "lane", "strecke", "kierunek"],
    LABEL_PREFIXES: [
      "miejsce", "adres", "data", "termin", "godzina",
      "date", "place", "address", "datum", "ort", "adresse",
    ],
    CARGO_LABELS: [
      "towar\\w*", "[łl]adun(?:ek|ku)", "cargo", "goods", "commodity",
      "ware", "g[üu]ter", "ladung", "produkt\\w*", "product\\w*",
    ],
    LOCATION_STOPWORDS: new Set([
      "godz", "godzina", "godziny", "od", "do", "h", "ok", "około", "ca",
      "am", "um", "uhr", "dnia", "dn", "r", "rano", "fix", "asap", "w", "we",
      "at", "on", "the", "till", "until", "bis", "zwischen", "between", "and",
      "i", "oraz", "und", "data", "date", "datum", "termin",
    ]),
    COUNTRY_CODES: new Set([
      "PL", "DE", "CZ", "SK", "AT", "HU", "LT", "LV", "EE", "FR", "BE", "NL",
      "LU", "IT", "ES", "PT", "DK", "SE", "FI", "NO", "CH", "GB", "UK", "IE",
      "RO", "BG", "HR", "SI", "GR", "UA", "RS", "TR",
    ]),
    COUNTRY_NAMES: {
      "polska": "PL", "poland": "PL", "polen": "PL",
      "niemcy": "DE", "niemiec": "DE", "germany": "DE", "deutschland": "DE",
      "czechy": "CZ", "czech republic": "CZ", "tschechien": "CZ",
      "słowacja": "SK", "slovakia": "SK", "slowakei": "SK",
      "austria": "AT", "österreich": "AT",
      "węgry": "HU", "hungary": "HU", "ungarn": "HU",
      "litwa": "LT", "lithuania": "LT", "litauen": "LT",
      "francja": "FR", "france": "FR", "frankreich": "FR",
      "belgia": "BE", "belgium": "BE", "belgien": "BE",
      "holandia": "NL", "netherlands": "NL", "niederlande": "NL",
      "włochy": "IT", "italy": "IT", "italien": "IT",
      "hiszpania": "ES", "spain": "ES", "spanien": "ES",
      "dania": "DK", "denmark": "DK", "dänemark": "DK",
      "szwecja": "SE", "sweden": "SE", "schweden": "SE",
      "rumunia": "RO", "romania": "RO", "rumänien": "RO",
      "ukraina": "UA", "ukraine": "UA",
      "szwajcaria": "CH", "switzerland": "CH", "schweiz": "CH",
    },
    MONTHS: {
      "stycz": 1, "lut": 2, "mar": 3, "kwie": 4, "maj": 5, "czerw": 6,
      "lip": 7, "sierp": 8, "wrze": 9, "paźdz": 10, "pazdz": 10, "listop": 11,
      "grud": 12,
      "jan": 1, "feb": 2, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8,
      "sep": 9, "oct": 10, "okt": 10, "nov": 11, "dec": 12, "dez": 12,
      "januar": 1, "februar": 2, "märz": 3, "mai": 5,
    },
    CARGO_CATEGORIES: {
      "napoje": ["napoj", "napój", "wod[ay]", "piw", "sok", "beverage", "drink", "getränk", "wasser", "bier"],
      "żywność": ["żywn", "spożyw", "food", "lebensmittel", "mięs", "owoc", "warzyw", "nabiał", "słodycz", "mrożon", "frozen"],
      "stal / metale": ["stal", "steel", "metal", "blach", "pręt", "stahl", "alumin", "coil"],
      "chemia": ["chemi", "chemical", "farb", "lakier", "paint", "klej", "rozpuszczaln"],
      "meble": ["mebl", "furniture", "möbel"],
      "elektronika / AGD": ["elektron", "agd", "rtv", "electronic"],
      "materiały budowlane": ["budowlan", "cement", "cegł", "płyt", "building material", "baustoff", "kostk"],
      "papier / opakowania": ["papier", "paper", "karton", "opakowa", "packaging", "verpackung", "tektur"],
      "części samochodowe": ["części samochod", "automotive", "car parts", "autoteile", "opon", "tyre", "tire", "reifen"],
      "maszyny / urządzenia": ["maszyn", "machine", "maschine", "urządze", "equipment"],
      "tekstylia": ["tekstyl", "odzież", "textile", "clothing", "kleidung"],
      "drewno": ["drewn", "wood", "timber", "holz", "tarcic"],
    },
  };

  const MISSING_LABELS = {
    origin: "miejsce załadunku",
    destination: "miejsce rozładunku",
    loading_date: "data załadunku",
    unloading_date: "data rozładunku",
    weight: "waga",
    pallets: "liczba palet / LDM",
    adr: "informacja o ADR",
    cargo: "rodzaj ładunku",
  };

  const QUESTIONS = {
    "miejsce załadunku": "Dokładny adres załadunku (kod pocztowy i miejscowość)?",
    "miejsce rozładunku": "Dokładny adres rozładunku (kod pocztowy i miejscowość)?",
    "data załadunku": "Planowana data (i godziny) załadunku?",
    "data rozładunku": "Wymagana data (i godziny) rozładunku?",
    "waga": "Łączna waga ładunku (kg)?",
    "liczba palet / LDM": "Liczba i rodzaj palet lub liczba metrów ładunkowych (LDM)?",
    "informacja o ADR": "Czy towar jest niebezpieczny (ADR)? Jeśli tak – numer UN i klasa.",
    "rodzaj ładunku": "Jaki towar będzie przewożony?",
  };

  // -------------------------------------------------------------------------
  // Wyrażenia regularne (te same co w parser.py)
  // -------------------------------------------------------------------------
  const WORD = "[^\\W\\d_]";
  const CAP = "[A-ZĄĆĘŁŃÓŚŹŻÄÖÜ][\\wąćęłńóśźżäöüß\\-]+";

  const LABEL_SRC =
    `\\b(?:(?:${alt(D.LABEL_PREFIXES)})\\s+)?` +
    `(?:(?P<load>${alt(D.LOADING_WORDS)})|(?P<unload>${alt(D.UNLOADING_WORDS)})` +
    `|(?P<route>${alt(D.ROUTE_WORDS)}))\\b` +
    `(?P<strong>(?:\\s+\\(?${WORD}+\\)?\\.?){0,2}?\\s*(?::|\\s[-–]\\s))?`;
  const LABEL_RE_G = rx(LABEL_SRC, "gi");
  const LABEL_RE = rx(LABEL_SRC, "i");

  const HEADER_RE = rx("^\\s*(?:from|to|cc|sent|subject|date|od|do|dw|wysłano|temat|von|an|gesendet|betreff)\\s*:", "i");
  const KEY_VALUE_RE = rx(`^\\s*${WORD}[\\w .()/-]{1,30}:\\s`);

  const byLengthDesc = (words) => [...words].sort((a, b) => b.length - a.length);
  const MONTH_STEMS = byLengthDesc(Object.keys(D.MONTHS));
  const DATE_SRC = [
    "(?P<iso>\\b(?P<iy>20\\d{2})-(?P<im>\\d{1,2})-(?P<id>\\d{1,2})\\b)",
    "(?P<range>\\b(?P<rd>\\d{1,2})\\s*[-–]\\s*\\d{1,2}[./](?P<rm>\\d{1,2})(?:[./](?P<ry>\\d{4}|\\d{2}))?\\b(?![.,]?\\d))",
    "(?P<dmy>\\b(?P<dd>\\d{1,2})(?P<sep>[./-])(?P<dm>\\d{1,2})(?P=sep)(?P<dy>\\d{4}|\\d{2})\\b(?![.,]?\\d))",
    "(?P<dm_only>\\b(?P<sd>\\d{1,2})[./](?P<sm>\\d{1,2})\\b(?![.,]?\\d)(?!\\s*(?:t|kg|ton\\w*|ldm|lm|m|%)\\b))",
    `(?P<named>\\b(?P<td>\\d{1,2})(?:\\s*[-–]\\s*\\d{1,2})?\\.?\\s*(?P<tm>${alt(MONTH_STEMS)})\\w*\\.?(?:\\s+(?P<ty>20\\d{2}))?)`,
    "(?P<rel>\\b(?:dzisiaj|dziś|today|heute|jutro|tomorrow|pojutrze)\\b)",
  ].join("|");
  const DATE_RE = rx(DATE_SRC, "gi");
  const TIME_RE = rx("\\b\\d{1,2}[:.]\\d{2}\\b(?:\\s*[-–]\\s*\\d{1,2}[:.]\\d{2}\\b)?|\\b\\d{1,2}\\s*[-–]\\s*\\d{1,2}\\s*(?:h|uhr)\\b", "gi");

  const POSTAL_RE = rx(
    "\\b(?:(?P<country>[A-Z]{2})[\\s-]?)?(?P<postal>\\d{2}-\\d{3}|\\d{4,5})\\b" +
    `(?:[ \\t]*,?[ \\t]*(?P<city>${CAP}(?:(?:[ \\t]+|-)(?![A-Z]{2}\\b)${CAP})*))?`,
    "g",
  );

  const LOC_TOKEN = `(?:[A-Z]{2}[\\s-]?\\d[\\d-]{3,6}(?:\\s+${CAP})?|${CAP}(?:\\s+${CAP})?)`;
  const FROM_TO_RE = rx(
    `\\b(?:${["z", "ze", "from", "von", "ex"].map(ci).join("|")})\\s+(?P<a>${LOC_TOKEN})` +
    `\\s+(?:${["do", "to", "nach"].map(ci).join("|")})\\s+(?P<b>${LOC_TOKEN})`,
  );
  const ARROW_RE = rx(`(?P<a>${LOC_TOKEN})\\s*(?:->|→|=>|>)\\s*(?P<b>${LOC_TOKEN})`);
  const ROUTE_SPLIT_RE = rx("\\s+(?:-|–|—|->|→|=>|>)\\s+|\\s*(?:->|→|=>)\\s*");

  const WEIGHT_SRC =
    "(?<![\\d.,])(?P<num>\\d{1,3}(?:[ \\u00a0.,]\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*" +
    "(?P<unit>kg|kilo\\w*|tony|tona|ton\\w*|t)\\b";
  const WEIGHT_RE = rx(WEIGHT_SRC, "gi");
  const WEIGHT_LABEL_RE = rx("\\b(?:waga|wagi|weight|gewicht|brutto|gross|łącznie|total|masa|ciężar)\\b", "i");
  const WEIGHT_NO_UNIT_RE = rx("\\b(?:waga|weight|gewicht|masa)\\w*\\s*[:\\-–]?\\s*(?P<num>\\d+(?:[.,]\\d+)?)\\b(?!\\s*[a-z%])", "i");
  const LDM_SRC =
    "(?P<num>\\d+(?:[.,]\\d+)?)\\s*(?:ldm|lm|mb)\\b" +
    "|\\b(?:ldm|loading\\s+met(?:er|re)s?|metr\\w*\\s+[łl]adunk\\w*|lademeter)\\s*[:\\-–]?\\s*(?P<num2>\\d+(?:[.,]\\d+)?)";
  const LDM_RE = rx(LDM_SRC, "i");
  const LDM_RE_G = rx(LDM_SRC, "gi");

  const PALLET_WORD = "(?:euro\\s*-?\\s*)?(?:palet\\w*|pallet\\w*|paletten|plt\\.?|europalet\\w*|epal\\w*|ep)";
  const PALLETS_BEFORE_RE = rx(`(?<![\\d.,x×])(?P<n>\\d{1,3})\\s*(?:x\\s*)?(?:szt\\.?\\s*)?(?:${WORD}+\\s+){0,2}?${PALLET_WORD}\\b`, "i");
  const PALLETS_AFTER_RE = rx("\\b(?:palet\\w*|pallets?|paletten|plt)\\s*[:\\-–]?\\s*(?P<n>\\d{1,3})\\b(?!\\s*[x×,.]\\s*\\d)", "i");
  const PALLETS_DIM_RE = rx("(?<![\\d.,])(?P<n>\\d{1,3})\\s*(?:szt\\.?|pcs\\.?)?\\s*x\\s*120\\s*[x×]\\s*(?:80|100)\\b", "i");
  const EUR_PALLET_RE = rx("\\b(?:euro\\s*-?\\s*palet\\w*|euro\\s*-?\\s*pallet\\w*|europalet\\w*|epal\\w*|ep\\b)|120\\s*[x×]\\s*80", "i");
  const IND_PALLET_RE = rx("przemys[łl]ow\\w*|industrial|industrie\\w*|120\\s*[x×]\\s*100", "i");

  const ADR_NEGATIVE_RE = rx(
    "\\b(?:bez|non|no|nie|not|kein\\w*)[\\s-]*adr\\b" +
    "|\\badr\\s*[:\\-–]?\\s*(?:nie|no|brak|nein|n/?a|none)\\b" +
    "|\\bnie\\s+(?:jest\\s+)?(?:to\\s+)?(?:towar(?:em)?\\s+)?niebezpieczn\\w*" +
    "|\\b(?:towar\\s+)?niebezpieczn\\w*\\s*:\\s*nie\\b" +
    "|\\bkein\\w*\\s+gefahrgut|\\bnon[\\s-]*(?:dangerous|hazardous)\\b|\\bnot\\s+dangerous\\b",
    "i",
  );
  const ADR_POSITIVE_RE = rx("\\badr\\b|\\bniebezpieczn\\w*|\\bdangerous\\s+goods\\b|\\bhazardous\\b|\\bgefahrgut\\b", "i");
  const UN_RE = rx("\\bUN\\s?-?(\\d{4})\\b", "gi");
  const ADR_CLASS_RE = rx("\\b(?:klas[aey]|kl\\.|class|klasse)\\s*(\\d(?:\\.\\d)?)\\b", "gi");

  const CARGO_LABEL_RE = rx(
    `^\\W*(?:(?:rodzaj|opis|type\\s+of|description\\s+of|art\\s+der)\\s+)?(?:${alt(D.CARGO_LABELS)})\\s*[:\\-–]\\s*(?P<value>.+)$`,
    "im",
  );

  // -------------------------------------------------------------------------
  // Drobne pomocniki
  // -------------------------------------------------------------------------
  // Jak str.splitlines() w Pythonie: końcowy znak nowej linii nie tworzy pustej linii.
  function splitLines(text) {
    const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  function strip(s, chars) {
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
  }

  // Daty trzymamy jako tekst "RRRR-MM-DD" (łatwo je porównywać i wyświetlać).
  function iso(y, m, d) {
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function addDays(isoDate, days) {
    const [y, m, d] = isoDate.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  function validDate(y, m, d) {
    if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
    const t = new Date(Date.UTC(2000, m - 1, d));
    const leapOk = !(m === 2 && d === 29) || (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
    return t.getUTCMonth() === m - 1 && leapOk ? iso(y, m, d) : null;
  }

  function todayIso() {
    const t = new Date();
    return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }

  const niceNumber = (v) => (Number.isInteger(v) ? v : Math.round(v * 100) / 100);

  // -------------------------------------------------------------------------
  // Daty
  // -------------------------------------------------------------------------
  function makeDate(day, month, year, today) {
    if (year != null) {
      if (year < 100) year += 2000;
      return validDate(year, month, day);
    }
    const ty = Number(today.slice(0, 4));
    let result = validDate(ty, month, day);
    if (result && result < addDays(today, -60)) result = validDate(ty + 1, month, day);
    return result;
  }

  function monthNumber(name) {
    name = name.toLowerCase();
    for (const stem of MONTH_STEMS) if (name.startsWith(stem)) return D.MONTHS[stem];
    return null;
  }

  function findDates(text, today) {
    for (const re of [LDM_RE_G, WEIGHT_RE]) text = text.replace(re, (m) => " ".repeat(m.length));
    const found = [];
    const int = (s) => (s == null ? null : parseInt(s, 10));
    for (const m of text.matchAll(DATE_RE)) {
      const g = m.groups;
      let value = null;
      if (g.iso) value = makeDate(int(g.id), int(g.im), int(g.iy), today);
      else if (g.range) value = makeDate(int(g.rd), int(g.rm), int(g.ry), today);
      else if (g.dmy) value = makeDate(int(g.dd), int(g.dm), int(g.dy), today);
      else if (g.dm_only) value = makeDate(int(g.sd), int(g.sm), null, today);
      else if (g.named) {
        const month = monthNumber(g.tm);
        if (month) value = makeDate(int(g.td), month, int(g.ty), today);
      } else if (g.rel) {
        const word = g.rel.toLowerCase();
        const offset = word === "pojutrze" ? 2 : word === "jutro" || word === "tomorrow" ? 1 : 0;
        value = addDays(today, offset);
      }
      if (value) found.push(value);
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // Podział maila na fragmenty
  // -------------------------------------------------------------------------
  function labelKind(m) {
    if (m.groups.load) return "loading";
    if (m.groups.unload) return "unloading";
    return "route";
  }

  function cleanLocationText(text) {
    text = text.replace(DATE_RE, " ").replace(TIME_RE, " ");
    const words = [];
    for (const word of text.split(/\s+/u)) {
      const bare = strip(word, ".,;:()-–").toLowerCase();
      if (bare && !D.LOCATION_STOPWORDS.has(bare)) words.push(word);
    }
    return strip(words.join(" "), " ,;:-–");
  }

  const hasLocation = (text) => (cleanLocationText(text).match(/\p{L}/gu) || []).length >= 2;

  function splitSegments(text) {
    const lines = splitLines(text);
    const segments = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (HEADER_RE.test(line)) {
        segments.push({ kind: "header", text: line, strong: false });
        i++;
        continue;
      }
      const matches = [...line.matchAll(LABEL_RE_G)];
      if (!matches.length) {
        segments.push({ kind: "general", text: line, strong: false });
        i++;
        continue;
      }
      if (matches[0].index > 0) segments.push({ kind: "general", text: line.slice(0, matches[0].index), strong: false });
      matches.forEach((m, idx) => {
        const end = idx + 1 < matches.length ? matches[idx + 1].index : line.length;
        let content = line.slice(m.index + m[0].length, end);
        const strong = Boolean(m.groups.strong);
        if (strong && idx === matches.length - 1 && !hasLocation(content)) {
          const extra = [];
          let j = i + 1;
          while (j < lines.length && extra.length < 3) {
            const nxt = lines[j];
            if (!nxt.trim() || LABEL_RE.test(nxt) || KEY_VALUE_RE.test(nxt)) break;
            extra.push(nxt);
            j++;
          }
          if (extra.length) {
            content = content + "\n" + extra.join("\n");
            i = j - 1;
          }
        }
        segments.push({ kind: labelKind(m), text: content, strong });
      });
      i++;
    }
    return segments;
  }

  // -------------------------------------------------------------------------
  // Lokalizacje
  // -------------------------------------------------------------------------
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function countryFromName(text) {
    const lower = text.toLowerCase();
    for (const [name, code] of Object.entries(D.COUNTRY_NAMES)) {
      if (rx(`\\b${escapeRe(name)}\\b`).test(lower)) return code;
    }
    return null;
  }

  function shortLocation(loc) {
    const parts = [loc.country, loc.postal_code, loc.city].filter(Boolean);
    return parts.length ? parts.join(" ") : loc.raw;
  }

  function parseLocation(text, allowPlainCity = true) {
    const cleaned = cleanLocationText(text.split("\n").join(", "));
    if (!cleaned) return null;
    const raw = cleaned.replace(/(\s*,\s*)+/gu, ", ").slice(0, 120);

    for (const m of cleaned.matchAll(POSTAL_RE)) {
      let country = m.groups.country || null;
      const postal = m.groups.postal;
      if (country && !D.COUNTRY_CODES.has(country)) continue;
      if (!country && !/^\d{2}-\d{3}$/.test(postal)) continue;
      if (!country && postal.includes("-")) country = "PL";
      return { raw, country, postal_code: postal, city: m.groups.city || null };
    }

    const country = countryFromName(cleaned);
    if (!country && !allowPlainCity) return null;
    let city = null;
    for (const m of cleaned.matchAll(rx(`${CAP}(?:\\s+${CAP})*`, "g"))) {
      if (!countryFromName(m[0])) {
        city = m[0];
        break;
      }
    }
    if (!city && !country) return null;
    return { raw, country, postal_code: null, city };
  }

  function routeFromFreeText(text) {
    for (const re of [FROM_TO_RE, ARROW_RE]) {
      const m = re.exec(text);
      if (m) return [parseLocation(m.groups.a), parseLocation(m.groups.b)];
    }
    return [null, null];
  }

  function postalLocations(text) {
    const found = [];
    for (const line of splitLines(text)) {
      for (const m of line.matchAll(POSTAL_RE)) {
        const loc = parseLocation(m[0], false);
        if (loc && loc.postal_code) found.push(loc);
      }
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // Waga, palety, ADR, ładunek
  // -------------------------------------------------------------------------
  function toNumber(num, thousandsAllowed) {
    const s = num.replace(/ /g, " ");
    if (/^\d{1,3}(?:[ .,]\d{3})+$/.test(s) && (thousandsAllowed || s.includes(" "))) {
      return parseFloat(s.replace(/[ .,]/g, ""));
    }
    return parseFloat(s.replace(/ /g, "").replace(",", "."));
  }

  function findWeightKg(text) {
    const labeled = [], other = [];
    for (const line of splitLines(text)) {
      const hasLabel = WEIGHT_LABEL_RE.test(line);
      const matches = [...line.matchAll(WEIGHT_RE)];
      for (const m of matches) {
        const isKg = m.groups.unit.toLowerCase().startsWith("k");
        const value = toNumber(m.groups.num, isKg);
        (hasLabel ? labeled : other).push(isKg ? value : value * 1000);
      }
      if (hasLabel && !matches.length) {
        const m = WEIGHT_NO_UNIT_RE.exec(line);
        if (m) {
          const value = toNumber(m.groups.num, true);
          labeled.push(value > 100 ? value : value * 1000);
        }
      }
    }
    const candidates = labeled.length ? labeled : other;
    return candidates.length ? niceNumber(Math.max(...candidates)) : null;
  }

  function findPallets(text) {
    let count = null;
    for (const re of [PALLETS_DIM_RE, PALLETS_BEFORE_RE, PALLETS_AFTER_RE]) {
      const m = re.exec(text);
      if (m) {
        const n = parseInt(m.groups.n, 10);
        if (n > 0 && n <= 200) {
          count = n;
          break;
        }
      }
    }
    let type = null;
    if (EUR_PALLET_RE.test(text)) type = "EUR/EPAL 120x80";
    else if (IND_PALLET_RE.test(text)) type = "przemysłowe 120x100";
    return [count, type];
  }

  function findLdm(text) {
    const m = LDM_RE.exec(text);
    if (!m) return null;
    return niceNumber(parseFloat((m.groups.num || m.groups.num2).replace(",", ".")));
  }

  function findAdr(text) {
    const unique = (arr) => [...new Set(arr)];
    const uns = unique([...text.matchAll(UN_RE)].map((m) => m[1]));
    const classes = unique([...text.matchAll(ADR_CLASS_RE)].map((m) => m[1]));
    const details = [...uns.map((n) => `UN ${n}`), ...classes.map((c) => `klasa ${c}`)];
    if (uns.length) return [true, details];
    if (ADR_NEGATIVE_RE.test(text)) return [false, []];
    if (ADR_POSITIVE_RE.test(text)) return [true, details];
    return [null, []];
  }

  function category(text) {
    const lower = text.toLowerCase();
    for (const [cat, stems] of Object.entries(D.CARGO_CATEGORIES)) {
      for (const stem of stems) if (rx(`\\b${stem}`).test(lower)) return cat;
    }
    return null;
  }

  function findCargo(text) {
    const m = CARGO_LABEL_RE.exec(text);
    if (m) {
      const value = strip(m.groups.value, " .;");
      return [value, category(value)];
    }
    return [null, category(text)];
  }

  // -------------------------------------------------------------------------
  // Główna funkcja
  // -------------------------------------------------------------------------
  function parseEmail(text, today) {
    today = today || todayIso();
    text = text.replace(/\r\n?/g, "\n");
    const r = {
      origin: null, destination: null, loading_date: null, unloading_date: null,
      weight_kg: null, pallets: null, pallet_type: null, ldm: null,
      adr: null, adr_details: [], cargo: null, cargo_category: null, missing: [],
    };
    const segments = splitSegments(text);
    const body = segments.filter((s) => s.kind !== "header").map((s) => s.text).join("\n");

    // --- trasa ---
    for (const seg of segments) {
      if (seg.kind === "route" && !(r.origin || r.destination)) {
        const parts = seg.text.split(ROUTE_SPLIT_RE).filter(hasLocation);
        if (parts.length >= 2) {
          r.origin = parseLocation(parts[0]);
          r.destination = parseLocation(parts[parts.length - 1]);
        }
      } else if (seg.kind === "loading" && !r.origin) {
        r.origin = parseLocation(seg.text, seg.strong);
      } else if (seg.kind === "unloading" && !r.destination) {
        r.destination = parseLocation(seg.text, seg.strong);
      }
    }

    if (!(r.origin && r.destination)) {
      const [o, d] = routeFromFreeText(body);
      r.origin = r.origin || o;
      r.destination = r.destination || d;
    }

    if (!(r.origin && r.destination)) {
      const known = new Set([r.origin, r.destination].filter(Boolean).map((l) => l.postal_code));
      const extra = postalLocations(body).filter((l) => !known.has(l.postal_code));
      if (!r.origin && extra.length) r.origin = extra.shift();
      if (!r.destination && extra.length) r.destination = extra.shift();
    }

    // --- daty ---
    let loading = [], unloading = [], general = [];
    for (const seg of segments) {
      const dates = findDates(seg.text, today);
      if (seg.kind === "loading") loading = loading.concat(dates);
      else if (seg.kind === "unloading") unloading = unloading.concat(dates);
      else if (seg.kind === "general" || seg.kind === "route") general = general.concat(dates);
    }
    if (!loading.length && general.length) loading.push(general.shift());
    if (!unloading.length && general.length && (!loading.length || general[0] >= loading[0])) {
      unloading.push(general.shift());
    }
    r.loading_date = loading[0] || null;
    r.unloading_date = unloading[0] || null;

    // --- ładunek ---
    r.weight_kg = findWeightKg(body);
    [r.pallets, r.pallet_type] = findPallets(body);
    r.ldm = findLdm(body);
    [r.adr, r.adr_details] = findAdr(body);
    [r.cargo, r.cargo_category] = findCargo(body);

    // --- czego brakuje ---
    const checks = {
      origin: r.origin,
      destination: r.destination,
      loading_date: r.loading_date,
      unloading_date: r.unloading_date,
      weight: r.weight_kg,
      pallets: r.pallets || r.ldm,
      adr: r.adr !== null,
      cargo: r.cargo || r.cargo_category,
    };
    r.missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => MISSING_LABELS[k]);
    return r;
  }

  function draftReply(result) {
    const questions = result.missing.map((m) => `- ${QUESTIONS[m]}`).join("\n");
    return (
      "Dzień dobry,\n\n" +
      "dziękujemy za zapytanie. Aby przygotować wycenę, prosimy o uzupełnienie:\n" +
      `${questions}\n\n` +
      "Pozdrawiamy"
    );
  }

  const api = { parseEmail, draftReply, shortLocation };
  root.FreightParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

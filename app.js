/*
 * Freight Mail Parser – demo: wysyła mail do Cloudflare Workera, który pyta
 * Claude AI, i wyświetla wynik. Klucz API jest tylko w Workerze (sekret
 * Cloudflare) – ta strona go nie zna.
 */
(function () {
  "use strict";

  const CONFIG = {
    // Adres Workera (Cloudflare).
    WORKER_URL: "https://freight-mail-parser.barsadrob.workers.dev",
    // Publiczny klucz witryny Turnstile. Pusty = strona nie wysyła tokenu
    // (Worker musi mieć wtedy REQUIRE_TURNSTILE = false).
    TURNSTILE_SITE_KEY: "",
  };

  const $ = (id) => document.getElementById(id);
  const mail = $("mail"), btn = $("analyze"), out = $("result"), select = $("examples"), received = $("received");

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    for (const c of children) if (c != null && c !== false) node.append(c);
    return node;
  }

  // --- Formatowanie --------------------------------------------------------------

  const DAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
  function fmtDate(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y} (${DAYS[new Date(iso + "T12:00:00").getDay()]})`;
  }
  const fmtNum = (n) => Number(n).toLocaleString("pl-PL");

  function fmtTiming(t) {
    if (!t) return null;
    const date = t.date ? fmtDate(t.date) : null;
    const hours = t.time_from && t.time_to ? `${t.time_from}–${t.time_to}` : t.time_from ? `od ${t.time_from}` : t.time_to ? `do ${t.time_to}` : "";
    switch (t.kind) {
      case "asap": return "jak najszybciej";
      case "exact": return date ? [date, hours && `godz. ${hours}`].filter(Boolean).join(", ") : "konkretny dzień (nieokreślony)";
      case "window": {
        const range = date && t.date_to ? `${fmtDate(t.date)} – ${fmtDate(t.date_to)}` : date;
        return range ? [range, hours].filter(Boolean).join(", ") : "przedział (nieokreślony)";
      }
      case "deadline": return date ? `najpóźniej ${date}${t.time_to ? ` do ${t.time_to}` : ""}` : "najpóźniej do… (termin nieprecyzyjny)";
      case "not_before": return date ? `nie wcześniej niż ${date}${t.time_from ? ` od ${t.time_from}` : ""}` : "nie wcześniej niż… (termin nieprecyzyjny)";
      case "unspecified": return null;
      default: return date;
    }
  }

  function fmtLocation(l) {
    if (!l) return null;
    return [l.country_code, l.postal_code, l.city].filter(Boolean).join(" ") || null;
  }

  function fmtQuantity(q) {
    if (!q) return null;
    const parts = [];
    if (q.pallet_count) parts.push(`${q.pallet_count} palet${q.pallet_type !== "nieznany" ? ` ${q.pallet_type}` : ""}`);
    if (q.package_count) parts.push(`${q.package_count} szt.`);
    if (q.loading_meters) parts.push(`${fmtNum(q.loading_meters)} LDM`);
    if (q.volume_m3) parts.push(`${fmtNum(q.volume_m3)} m³`);
    if (q.full_truck) parts.push("całe auto");
    return parts.join(", ") || null;
  }

  function fmtWeight(w) {
    if (!w || !w.kg) return null;
    return `${w.qualifier === "approx" ? "ok. " : w.qualifier === "max" ? "maks. " : ""}${fmtNum(w.kg)} kg`;
  }

  function fmtDimensions(d) {
    if (!d || !d.items.length) return null;
    return d.items.map((i) => {
      const size = [i.length_cm, i.width_cm, i.height_cm].map((v) => (v === "" ? "?" : fmtNum(v))).join(" × ");
      return `${i.count ? `${i.count} × ` : ""}${size} cm${i.description ? ` (${i.description})` : ""}`;
    }).join("; ");
  }

  function fmtVehicle(v) {
    if (!v) return null;
    const temp = v.temperature_min_c !== "" || v.temperature_max_c !== ""
      ? `${v.temperature_min_c || "?"}…${v.temperature_max_c || "?"} °C` : null;
    const type = v.type !== "dowolny" && v.type !== "nieznany" ? v.type : null;
    const text = [type, temp, ...v.requirements].filter(Boolean).join(", ");
    return text || (v.type === "dowolny" ? "dowolny" : null);
  }

  const STATUS_LABEL = { explicit: "wprost", inferred: "wywnioskowane", ambiguous: "niejasne", missing: "brak" };

  // Jeden wiersz wyniku: etykieta, wartość, status, cytat z maila, notatka modelu.
  function item(label, value, field, optional = false) {
    const status = field ? field.status : "missing";
    const empty = value == null || value === "";
    const badge = el("span", { class: `badge ${status}${optional ? " optional" : ""}` }, STATUS_LABEL[status] || status);
    const node = el("div", { class: "item" },
      el("span", { class: "label" }, label),
      el("span", { class: "value" + (empty ? " empty" : "") }, empty ? (status === "ambiguous" ? "niejasne" : "brak") : value),
      badge);
    if (field && field.source_quote) node.append(el("span", { class: "extra quote" }, `„${field.source_quote}”`));
    if (field && field.note_pl) node.append(el("span", { class: "extra" }, field.note_pl));
    return node;
  }

  // --- Wynik AI ------------------------------------------------------------------

  function renderAI(data) {
    const r = data.result;
    out.replaceChildren(el("h2", {}, "Wynik analizy – Claude AI"));

    if (!r.is_transport_request) {
      out.append(el("div", { class: "status info" }, "To nie wygląda na zapytanie transportowe."));
    } else if (data.critical_gaps.length) {
      out.append(el("div", { class: "status warn" }, `Brakuje lub jest niejasne (krytyczne do wyceny): ${data.critical_gaps.length}`,
        el("ul", {}, ...data.critical_gaps.map((g) => el("li", {}, g)))));
    } else {
      out.append(el("div", { class: "status ok" }, "✔ Wszystkie informacje krytyczne do wyceny są w mailu"));
    }

    if (r.warnings.length) {
      out.append(el("div", { class: "status warn" }, "Uwagi:", el("ul", {}, ...r.warnings.map((w) => el("li", {}, w)))));
    }

    const c = r.critical;
    out.append(el("h3", {}, "Krytyczne do wyceny"));
    const counters = { pickup: 0, delivery: 0 };
    const totals = { pickup: c.stops.filter((s) => s.role === "pickup").length, delivery: c.stops.filter((s) => s.role === "delivery").length };
    for (const s of c.stops) {
      const n = ++counters[s.role];
      const name = (s.role === "pickup" ? "Załadunek" : "Rozładunek") + (totals[s.role] > 1 ? ` ${n}` : "");
      const loc = s.location.value;
      const extra = loc ? [loc.address, loc.company].filter(Boolean).join(", ") : "";
      const locItem = item(name, fmtLocation(loc), s.location);
      if (extra) locItem.insertBefore(el("span", { class: "extra" }, extra), locItem.children[3] || null);
      out.append(locItem, item(`Termin – ${name.toLowerCase()}`, fmtTiming(s.timing.value), s.timing));
    }
    out.append(
      item("Ilość / objętość", fmtQuantity(c.quantity.value), c.quantity),
      item("Waga", fmtWeight(c.weight.value), c.weight),
      item("Rodzaj towaru", c.cargo_type.value.description ? `${c.cargo_type.value.description} (${c.cargo_type.value.category})` : null, c.cargo_type),
    );

    const o = r.optional;
    const adr = o.adr;
    const adrText = adr.answer === "yes" ? `TAK${[...adr.un_numbers, ...adr.classes.map((k) => `kl. ${k}`)].length ? " – " + [...adr.un_numbers, ...adr.classes.map((k) => `kl. ${k}`)].join(", ") : ""}`
      : adr.answer === "no" ? "NIE" : adr.ask_client ? "nieznane – zapytaj klienta" : null;
    out.append(
      el("h3", {}, "Opcjonalne"),
      item("Wymiary", fmtDimensions(o.dimensions.value), o.dimensions, true),
      item("Piętrowanie", { yes: "można piętrować", no: "nie piętrować" }[o.stackable.value] || null, o.stackable, true),
      item("ADR", adrText, adr, true),
      item("Pojazd", fmtVehicle(o.vehicle.value), o.vehicle, true),
    );

    if (r.questions_to_client.length) {
      out.append(el("h3", {}, "Pytania do klienta"), el("ul", { class: "list" }, ...r.questions_to_client.map((q) => el("li", {}, q))));
    }
    if (r.reply_draft) {
      const copy = el("button", { type: "button" }, "Kopiuj odpowiedź");
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(r.reply_draft); copy.textContent = "Skopiowano ✔"; }
        catch { copy.textContent = "Zaznacz tekst i skopiuj ręcznie"; }
        setTimeout(() => (copy.textContent = "Kopiuj odpowiedź"), 2000);
      };
      out.append(el("div", { class: "row space" }, el("h3", {}, "Proponowana odpowiedź do klienta"), copy),
        el("pre", { class: "reply" }, r.reply_draft));
    }
    if (data.problems.length) {
      out.append(el("details", {}, el("summary", {}, `Uwagi techniczne (${data.problems.length})`),
        el("ul", { class: "list hint" }, ...data.problems.map((p) => el("li", {}, p)))));
    }
    out.append(el("details", {}, el("summary", {}, "Dane techniczne (JSON)"), el("pre", {}, JSON.stringify(r, null, 2))));
  }

  // --- Zapasowy parser regułowy (bez AI) ---------------------------------------------

  function renderRules() {
    const r = FreightParser.parseEmail(mail.value);
    const rows = [
      ["Załadunek", r.origin && FreightParser.shortLocation(r.origin)],
      ["Rozładunek", r.destination && FreightParser.shortLocation(r.destination)],
      ["Data załadunku", fmtDate(r.loading_date)],
      ["Data rozładunku", fmtDate(r.unloading_date)],
      ["Waga", r.weight_kg != null ? `${fmtNum(r.weight_kg)} kg` : null],
      ["Palety", r.pallets ? `${r.pallets}${r.pallet_type ? ` (${r.pallet_type})` : ""}` : null],
      ["LDM", r.ldm != null ? String(r.ldm) : null],
      ["ADR", r.adr === true ? "TAK" : r.adr === false ? "NIE" : null],
      ["Ładunek", r.cargo || r.cargo_category],
    ];
    out.replaceChildren(
      el("h2", {}, "Wynik analizy – parser regułowy (bez AI)"),
      el("div", { class: "status info" }, "Prosta analiza na regułach, wykonana w przeglądarce. Jest mniej dokładna niż AI."),
      el("dl", { class: "rules" }, ...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v || "—")])),
    );
    if (r.missing.length) {
      out.append(el("h3", {}, "Brakujące informacje"), el("ul", { class: "list" }, ...r.missing.map((m) => el("li", {}, m))));
    }
  }

  // --- Komunikacja z Workerem --------------------------------------------------------

  function showError(message, offerRules) {
    out.replaceChildren(el("h2", {}, "Wynik analizy"), el("div", { class: "status bad" }, message));
    if (offerRules && mail.value.trim()) {
      const b = el("button", { type: "button", class: "link" }, "Użyj prostego parsera regułowego (bez AI)");
      b.onclick = renderRules;
      out.append(b);
    }
  }

  let turnstileToken = null;
  let turnstileWidget = null;

  async function analyze() {
    if (!mail.value.trim()) { showError("Wklej najpierw treść maila."); mail.focus(); return; }
    if (CONFIG.TURNSTILE_SITE_KEY && !turnstileToken) { showError("Poczekaj chwilę na weryfikację antyspamową pod polem maila."); return; }

    btn.disabled = true; btn.textContent = "Analizuję…";
    out.replaceChildren(el("h2", {}, "Wynik analizy"), el("p", { class: "placeholder" }, "Claude AI analizuje mail – to zwykle trwa kilka sekund…"));
    const body = { email: mail.value };
    if (received.value) body.received_date = received.value;
    if (turnstileToken) body.turnstile_token = turnstileToken;

    try {
      const res = await fetch(CONFIG.WORKER_URL + "/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data = null;
      try { data = await res.json(); } catch { /* odpowiedź bez JSON */ }
      if (res.ok && data && data.ok) renderAI(data);
      else showError((data && data.message) || `Błąd serwera (${res.status}).`, true);
    } catch {
      showError("Nie udało się połączyć z serwerem AI. Sprawdź połączenie z internetem i spróbuj ponownie.", true);
    } finally {
      btn.disabled = false; btn.textContent = "Analizuj";
      // Token Turnstile jest jednorazowy – po każdej analizie pobieramy nowy.
      if (turnstileWidget !== null && window.turnstile) { turnstileToken = null; window.turnstile.reset(turnstileWidget); }
    }
  }

  // --- Turnstile (tylko gdy ustawiono klucz witryny) ---------------------------------

  if (CONFIG.TURNSTILE_SITE_KEY) {
    window.onTurnstileLoad = () => {
      turnstileWidget = window.turnstile.render("#turnstile", {
        sitekey: CONFIG.TURNSTILE_SITE_KEY,
        callback: (token) => { turnstileToken = token; },
        "expired-callback": () => { turnstileToken = null; },
      });
    };
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
    s.async = true;
    document.head.append(s);
  }

  // --- Start ---------------------------------------------------------------------------

  const t = new Date();
  received.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;

  btn.onclick = analyze;
  mail.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyze(); });
  $("clear").onclick = () => { mail.value = ""; select.value = ""; mail.focus(); };

  const examples = window.FREIGHT_EXAMPLES || {};
  for (const name of Object.keys(examples)) select.append(el("option", { value: name }, name));
  select.onchange = () => { if (select.value) mail.value = examples[select.value]; };
})();

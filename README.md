# Freight Mail Parser – demo

Wersja demonstracyjna aplikacji, która analizuje maile z zapytaniami
transportowymi i rozpoznaje:

- trasę (miejsce załadunku i rozładunku: kraj, kod pocztowy, miasto),
- daty załadunku i rozładunku,
- wagę (w kg), liczbę i typ palet, LDM,
- ADR (tak / nie, numer UN, klasa),
- rodzaj ładunku,
- brakujące informacje, razem z propozycją odpowiedzi do klienta.

Rozumie maile po polsku, angielsku i niemiecku.

## Jak to działa

To jest statyczna strona (HTML, CSS, JavaScript). **Wszystko dzieje się
w przeglądarce**: nie ma serwera, bazy danych, kluczy API ani płatnych usług.
Treść wklejonego maila nie jest nigdzie wysyłana ani zapisywana.

Rozpoznawanie działa na regułach (wyrażeniach regularnych), więc może się
mylić przy nietypowych mailach. Zawsze sprawdź wynik.

## Pliki

| Plik | Do czego służy |
|---|---|
| `index.html` | strona: pole na maila, przycisk „Analizuj”, wynik |
| `parser.js` | logika rozpoznawania |
| `examples.js` | fikcyjne przykładowe maile |
| `.nojekyll` | mówi GitHub Pages, żeby podał pliki bez przetwarzania |

## Uruchomienie

- **Lokalnie:** pobierz repozytorium i kliknij dwukrotnie `index.html`.
- **GitHub Pages:** Settings → Pages → Source: *Deploy from a branch* →
  Branch: `main`, folder: `/ (root)` → Save. Strona będzie pod adresem
  `https://barsadrob.github.io/freight-mail-parser-demo/`.

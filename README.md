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

```
Ta strona (GitHub Pages)  ──►  Cloudflare Worker  ──►  Claude AI
```

Strona wysyła treść maila do Cloudflare Workera, a Worker przekazuje ją do
modelu Claude AI. **Klucz API jest przechowywany wyłącznie w Workerze jako
sekret Cloudflare.** Na tej stronie i w tym repozytorium nie ma żadnych kluczy
ani kodu serwera.

Treść maila nie jest zapisywana. Obowiązuje limit 10 analiz na godzinę z jednego
adresu IP. Gdy Worker jest niedostępny, można użyć prostego parsera regułowego,
który działa w całości w przeglądarce.

Wynik może zawierać błędy, dlatego zawsze go sprawdź. Każde pole ma status
(wprost / wywnioskowane / niejasne / brak) i cytat z maila, na którym się opiera.

## Pliki

| Plik | Do czego służy |
|---|---|
| `index.html` | strona: pole na maila, przycisk „Analizuj”, wynik |
| `app.js` | wysyłanie maila do Workera i wyświetlanie wyniku AI |
| `parser.js` | zapasowy parser regułowy (bez AI) |
| `examples.js` | zmyślone przykładowe maile |
| `.nojekyll` | mówi GitHub Pages, żeby podał pliki bez przetwarzania |

Adres Workera i publiczny klucz witryny Turnstile ustawia się na początku `app.js`.

## Uruchomienie

GitHub Pages: Settings → Pages → Source: *Deploy from a branch* → Branch: `main`,
folder: `/ (root)` → Save. Strona będzie pod adresem
`https://barsadrob.github.io/freight-mail-parser-demo/`.

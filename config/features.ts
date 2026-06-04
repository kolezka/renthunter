/**
 * Feature taxonomy — the controlled vocabulary that AI-extracted offer features
 * are snapped onto, so the facet chips and feature filtering stay consistent
 * instead of fragmenting into bilingual / inflected near-duplicates
 * (e.g. "winda" / "elevator" / "windy" → "winda").
 *
 * `canonical` is the stored, displayed value (Polish). `aliases` are other
 * surface forms that map onto it; matching is diacritic-insensitive and
 * case-insensitive (see normalizeText in src/keywords/gazetteer.ts), so you only
 * need one spelling per distinct form. The canonical is always its own alias.
 *
 * Extend freely. Tags that match no canonical/alias pass through normalized
 * (lowercased, trimmed) so nothing is lost; add them here when a cluster grows.
 */
export const FEATURE_TAXONOMY: { canonical: string; aliases: string[] }[] = [
  { canonical: "umeblowane", aliases: ["furnished", "umeblowany", "umeblowany salon", "wyposażone", "w pełni wyposażone", "fully equipped", "fully equipped kitchen", "nowe wyposażenie", "new furnishings", "equipped"] },
  { canonical: "gotowe do zamieszkania", aliases: ["ready to move in", "move-in ready", "do zamieszkania od zaraz", "dostępne od zaraz", "available now", "available immediately", "do wynajęcia od zaraz"] },
  { canonical: "parking", aliases: ["miejsce parkingowe", "miejsce postojowe", "parking space", "parking spot"] },
  { canonical: "garaż", aliases: ["garage", "hala garażowa", "garaż podziemny", "underground garage"] },
  { canonical: "balkon", aliases: ["balcony"] },
  { canonical: "taras", aliases: ["terrace", "patio"] },
  { canonical: "loggia", aliases: ["loggia"] },
  { canonical: "ogród", aliases: ["garden", "ogródek", "private garden"] },
  { canonical: "winda", aliases: ["elevator", "lift", "windy"] },
  { canonical: "pralka", aliases: ["washing machine", "washer"] },
  { canonical: "suszarka", aliases: ["dryer", "tumble dryer"] },
  { canonical: "zmywarka", aliases: ["dishwasher"] },
  { canonical: "piekarnik", aliases: ["oven"] },
  { canonical: "lodówka", aliases: ["refrigerator", "fridge"] },
  { canonical: "mikrofalówka", aliases: ["microwave"] },
  { canonical: "telewizor", aliases: ["tv", "telewizja", "television"] },
  { canonical: "internet", aliases: ["wifi", "wi-fi", "światłowód", "fibre", "fiber"] },
  { canonical: "klimatyzacja", aliases: ["air conditioning", "ac", "klima", "aircon"] },
  { canonical: "ogrzewanie podłogowe", aliases: ["underfloor heating", "floor heating"] },
  { canonical: "ogrzewanie miejskie", aliases: ["district heating", "ogrzewanie z sieci", "miejskie"] },
  { canonical: "odkurzacz", aliases: ["odkurzacz robot", "robot vacuum", "robot odkurzający", "vacuum cleaner", "vacuum"] },
  { canonical: "dwie łazienki", aliases: ["two bathrooms", "2 łazienki", "second bathroom"] },
  { canonical: "prysznic", aliases: ["shower", "łazienka z prysznicem", "walk-in shower"] },
  { canonical: "strych", aliases: ["attic", "poddasze"] },
  { canonical: "apartamentowiec", aliases: ["apartment building", "apartment complex"] },
  { canonical: "blisko mariny", aliases: ["near marina", "marina nearby"] },
  { canonical: "blisko centrum biznesowego", aliases: ["near business center", "near business centre", "blisko biznesu"] },
  { canonical: "piwnica", aliases: ["basement", "cellar"] },
  { canonical: "komórka lokatorska", aliases: ["storage room", "storage", "storage unit"] },
  { canonical: "aneks kuchenny", aliases: ["kitchenette"] },
  { canonical: "osobna kuchnia", aliases: ["separate kitchen", "kuchnia z oknem"] },
  { canonical: "blisko morza", aliases: ["near the sea", "near sea", "close to the sea", "sea nearby"] },
  { canonical: "widok na morze", aliases: ["sea view", "ocean view"] },
  { canonical: "blisko plaży", aliases: ["near beach", "near the beach", "close to the beach"] },
  { canonical: "blisko parku", aliases: ["near park", "park nearby", "near the park", "park"] },
  { canonical: "widok na park", aliases: ["park view"] },
  { canonical: "zielone otoczenie", aliases: ["green area", "greenery", "blisko zieleni", "green surroundings"] },
  { canonical: "cicha okolica", aliases: ["quiet area", "quiet neighborhood", "quiet neighbourhood", "quiet", "peaceful area"] },
  { canonical: "blisko centrum", aliases: ["near center", "near the center", "city center", "centrum", "central", "near city centre"] },
  { canonical: "blisko starego miasta", aliases: ["near old town", "old town nearby"] },
  { canonical: "blisko sklepów", aliases: ["near shops", "shops nearby", "blisko sklepy"] },
  { canonical: "dobra komunikacja", aliases: ["good transport", "public transport", "blisko komunikacji", "blisko przystanku", "blisko przystanek", "near public transport", "good public transport", "good transit", "komunikacja"] },
  { canonical: "plac zabaw", aliases: ["playground", "blisko placu zabaw", "blisko plac zabaw"] },
  { canonical: "siłownia", aliases: ["gym", "fitness", "fitness room", "fitness centre"] },
  { canonical: "sauna", aliases: ["sauna"] },
  { canonical: "rowerownia", aliases: ["bike storage", "bike parking", "bike room", "bicycle storage"] },
  { canonical: "monitoring", aliases: ["monitorowany", "cctv", "surveillance"] },
  { canonical: "ochrona", aliases: ["security", "ochrona całodobowa", "recepcja z ochroną", "24h security", "concierge", "recepcja"] },
  { canonical: "osiedle zamknięte", aliases: ["gated community", "gated", "ogrodzony teren", "ogrodzone podwórze", "ogrodzony", "fenced"] },
  { canonical: "domofon", aliases: ["intercom", "wideodomofon", "video intercom"] },
  { canonical: "drzwi antywłamaniowe", aliases: ["anti-burglary door", "security door"] },
  { canonical: "pet friendly", aliases: ["akceptuje zwierzęta", "zwierzaczki", "zwierzęta", "pets allowed", "pets", "zwierzęta akceptowane"] },
  { canonical: "nowoczesne", aliases: ["modern", "modern building", "modern apartment"] },
  { canonical: "wyremontowane", aliases: ["renovated", "po remoncie", "odnowiony", "odświeżony", "newly renovated", "after renovation"] },
  { canonical: "wysoki standard", aliases: ["high standard", "high-end", "premium", "luxury"] },
  { canonical: "smart home", aliases: ["inteligentny dom", "smart-home"] },
  { canonical: "coworking", aliases: ["coworking space", "przestrzeń coworkingowa"] },
  { canonical: "biurko", aliases: ["desk", "miejsce do pracy", "workspace"] },
  { canonical: "słoneczne", aliases: ["sunny", "słoneczna ekspozycja", "dużo światła", "bright"] },
];

/**
 * Tags to drop entirely — these are not features but room counts, areas, floors,
 * etc. that the model sometimes emits (the offer already has dedicated columns
 * for rooms/area). Tested against the normalized tag.
 */
export const FEATURE_NOISE: RegExp[] = [
  /^\d/,        // "2 pokoje", "51 m2", "48 m2", "5 pietro", "3 pietro"
  /\bm2\b/,     // areas
  /pokoj/,      // "pokoje", "dwupokojowe", "nieprzechodnie pokoje"
  /pietr/,      // "pietro 1", "5 pietro"
];

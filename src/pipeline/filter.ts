export interface FilterBounds {
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  minRooms: number | null;
}
export interface FilterableOffer {
  price: number | null;
  area: number | null;
  rooms: number | null;
}

export function passesFilters(o: FilterableOffer, b: FilterBounds): boolean {
  if (b.minPrice != null && o.price != null && o.price < b.minPrice) return false;
  if (b.maxPrice != null && o.price != null && o.price > b.maxPrice) return false;
  if (b.minArea != null && o.area != null && o.area < b.minArea) return false;
  if (b.minRooms != null && o.rooms != null && o.rooms < b.minRooms) return false;
  return true;
}
